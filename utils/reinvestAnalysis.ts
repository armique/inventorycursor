/**
 * Reinvest Assistant analysis engine: groups realized sales (and active stock) into
 * "what to rebuy" units — either a component sub-variant (e.g. storage:ssd-512gb) or a
 * repeating "anchor bundle" (e.g. any motherboard + i7-4790K). Pure functions only; pricing
 * math itself lives in utils/buyHelper.ts and is reused by the UI layer, not duplicated here.
 */
import { InventoryItem, ItemStatus } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import {
  getChildren,
  getEffectiveSellPriceForProfit,
  roundMoney,
} from '../services/financialAggregation';
import { extractPrimaryComponentKey, prettifyComponentKey, type ComponentCategory } from './componentKeyExtractor';
import { resolveSalePlatform } from './salePlatform';

export type ReinvestConfidence = 'low' | 'medium' | 'high';
export type ReinvestTrend = 'up' | 'down' | 'flat';

export const COMPONENT_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  gpu: 'GPU',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  motherboard: 'Motherboard',
  psu: 'PSU',
  case: 'Case',
  cooler: 'Cooler',
};

/** Pocket P&L for ranking: list sell − shipping you paid − buy − marketplace fees. */
export function pocketProfitForReinvest(item: InventoryItem): number {
  const sell = getEffectiveSellPriceForProfit(item);
  const buy = Number(item.buyPrice) || 0;
  const fee = Number(item.feeAmount) || 0;
  return roundMoney(sell - buy - fee);
}

export type ReinvestGroupBase = {
  key: string;
  label: string;
  category: string;
  /** Real InventoryItem.category/subCategory from the sold sample — used to prefill the add-item
   * form; `category` above can be a coarser component-level bucket for bundle groups. */
  sampleCategory: string;
  sampleSubCategory?: string;
  soldCount: number;
  lossCount: number;
  /** Avg pocket profit over profitable trades only; null when none were profitable. */
  profitOnlyAvgProfit: number | null;
  /** Avg pocket profit (sell − buy − fees − shipping) over ALL realized trades. */
  allInclAvgProfit: number;
  /** Avg sell − buy only (no fees) — for transparency when fees were missing on some rows. */
  grossAvgProfit: number;
  /** True when at least one sale in the sample had feeAmount or seller shipping recorded. */
  feesObserved: boolean;
  avgBuyPrice: number;
  avgDaysToSell: number;
  sellKaMedian: number | null;
  sellKaCount: number;
  sellEbayMedian: number | null;
  sellEbayCount: number;
  overallSellMedian: number | null;
  sellLow: number | null;
  sellHigh: number | null;
  currentStock: number;
  targetStock: number;
  confidence: ReinvestConfidence;
  warning?: string;
  /** Extra one-line context that isn't a loss warning (e.g. an AI hypothesis' rationale). */
  reasonNote?: string;
  /** "Sells higher this month historically" — only set once the account has enough history. */
  seasonalNote?: string;
  trend: ReinvestTrend;
  /** allInclAvgProfit / avgDaysToSell — "fast and profitable" ranking, not just raw profit. */
  profitPerDay: number;
  /** restock: buy more. stocked: doing fine, no action needed. skip: not worth buying more of. */
  verdict: 'restock' | 'stocked' | 'skip';
  skipReason?: string;
  sampleItemIds: string[];
  /** How many sample sales came from sold PC/bundle attributed parts. */
  attributedFromKitCount: number;
};

export type ReinvestGroup = ReinvestGroupBase & { kind: 'variant' | 'hypothesis' };

export type AnchorBundleGroup = ReinvestGroupBase & {
  kind: 'bundle';
  anchorComponentKey: string;
  siblingCategory: string;
};

export type ReinvestData = {
  variants: ReinvestGroup[];
  bundles: AnchorBundleGroup[];
  /** Component categories that ride along in bundles but have no real standalone track record. */
  adjacentCategories: string[];
  agingListings: AgingListing[];
  seasonalityReady: boolean;
  historyDays: number;
};

function median(values: number[]): number | null {
  const sorted = [...values].filter((n) => n > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return roundMoney(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return roundMoney(values.reduce((a, b) => a + b, 0) / values.length);
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = values[0] || 'Other';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function shortestName(names: string[]): string {
  return names.reduce((best, n) => (n && n.length < best.length ? n : best), names[0] || '');
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const KNOWN_COMPONENT_CATEGORIES = new Set<ComponentCategory>([
  'gpu', 'cpu', 'ram', 'storage', 'motherboard', 'psu', 'case', 'cooler',
]);

function categoryFromGroupKey(key: string): ComponentCategory | null {
  const prefix = key.split(':')[0];
  return KNOWN_COMPONENT_CATEGORIES.has(prefix as ComponentCategory) ? (prefix as ComponentCategory) : null;
}

/** Whole-account sold history span — seasonal claims need real repeat-year signal, not a fluke. */
export function totalHistorySpanDays(items: InventoryItem[]): number {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const item of items) {
    if (item.buyDate) earliest = Math.min(earliest, new Date(item.buyDate).getTime());
    if (item.sellDate) latest = Math.max(latest, new Date(item.sellDate).getTime());
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || latest <= earliest) return 0;
  return Math.round((latest - earliest) / 86400000);
}

/** Only claims a seasonal edge when ≥2 sales actually happened in this calendar month and the
 * effect is large enough to matter — otherwise stays silent rather than inventing a pattern. */
function computeSeasonalNote(sold: InventoryItem[], overallAvgSell: number): string | undefined {
  if (overallAvgSell <= 0) return undefined;
  const currentMonth = new Date().getMonth();
  const inMonth = sold.filter((i) => i.sellDate && new Date(i.sellDate).getMonth() === currentMonth);
  if (inMonth.length < 2) return undefined;
  const monthAvg = average(inMonth.map((i) => Number(i.sellPrice) || 0));
  const diffPct = ((monthAvg - overallAvgSell) / overallAvgSell) * 100;
  if (diffPct < 10) return undefined;
  return `Sells ~${Math.round(diffPct)}% higher in ${MONTH_NAMES[currentMonth]} historically (n=${inMonth.length}).`;
}

function daysBetween(buyDate?: string, sellDate?: string): number | null {
  if (!buyDate || !sellDate) return null;
  const a = new Date(buyDate).getTime();
  const b = new Date(sellDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Every item id that is a child of some bundle/PC container (sold or in stock) — excluded from
 * standalone variant grouping so bundle components never double-count as separate products. */
function collectContainerChildIds(items: InventoryItem[]): Set<string> {
  const ids = new Set<string>();
  for (const container of items) {
    if (!container.isBundle && !container.isPC) continue;
    for (const child of getChildren(container, items)) ids.add(child.id);
  }
  return ids;
}

/** Sold/traded/gifted bundle/PC parent by child id — used to attribute redistributed component sales. */
function collectRealizedContainerByChildId(items: InventoryItem[]): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  for (const container of items) {
    if (!container.isBundle && !container.isPC) continue;
    if (!isRealizedDisposal(container)) continue;
    if (!((Number(container.sellPrice) || 0) > 0)) continue;
    for (const child of getChildren(container, items)) {
      if (!map.has(child.id)) map.set(child.id, container);
    }
  }
  return map;
}

export function variantKeyForItem(item: Pick<InventoryItem, 'name' | 'category' | 'subCategory'>): string {
  const match = extractPrimaryComponentKey(item.name || '');
  if (match) return match.componentKey;
  return item.subCategory || item.category || 'Other';
}

export function confidenceForGroup(soldCount: number, lossCount: number): ReinvestConfidence {
  let level: ReinvestConfidence = soldCount >= 8 ? 'high' : soldCount >= 3 ? 'medium' : 'low';
  if (lossCount >= 2) {
    if (level === 'high') level = 'medium';
    else level = 'low';
  }
  return level;
}

export function lossWarning(lossCount: number, soldCount: number): string | undefined {
  if (lossCount < 2) return undefined;
  return `${lossCount} of the last ${soldCount} sales in this group lost money — average profit is lower than the winners alone suggest.`;
}

/** Little's Law: average units in stock = sales rate/day × avg days to sell. */
export function targetStockQty(
  soldCount: number,
  avgDaysToSell: number,
  historySpanDays: number,
  confidence: ReinvestConfidence,
): number {
  if (confidence === 'low' || soldCount < 1 || historySpanDays <= 0) return 1;
  const salesPerDay = soldCount / historySpanDays;
  const raw = Math.round(salesPerDay * Math.max(1, avgDaysToSell));
  return Math.min(5, Math.max(1, raw));
}

/** Objective, data-only verdict — no fuzzy vibes. `skip` needs either a real average loss or a
 * genuinely thin margin relative to how long it sits (matches the "not worth buying" section). */
function classifyVerdict(
  allInclAvgProfit: number,
  avgDaysToSell: number,
  soldCount: number,
  currentStock: number,
  targetStock: number,
): { verdict: 'restock' | 'stocked' | 'skip'; skipReason?: string } {
  if (allInclAvgProfit <= 0) {
    return {
      verdict: 'skip',
      skipReason: `Averaged a €${Math.abs(roundMoney(allInclAvgProfit))} loss across ${soldCount} sales — skip for now.`,
    };
  }
  if (avgDaysToSell > 30 && allInclAvgProfit < 10) {
    return {
      verdict: 'skip',
      skipReason: `Sits ${Math.round(avgDaysToSell)}+ days for €${Math.round(allInclAvgProfit)} profit — thin margin for the wait.`,
    };
  }
  return { verdict: currentStock < targetStock ? 'restock' : 'stocked' };
}

/** Trend in own sell prices over time: oldest third vs newest third, ±2% deadband. */
export function calculateOwnSalesTrend(
  sales: Array<{ sellDate?: string; sellPrice?: number }>,
): ReinvestTrend {
  const dated = sales
    .filter((s) => s.sellDate && (s.sellPrice || 0) > 0)
    .sort((a, b) => new Date(a.sellDate!).getTime() - new Date(b.sellDate!).getTime());
  if (dated.length < 4) return 'flat';
  const window = Math.max(1, Math.floor(dated.length / 3));
  const firstAvg = average(dated.slice(0, window).map((s) => s.sellPrice!));
  const lastAvg = average(dated.slice(-window).map((s) => s.sellPrice!));
  if (firstAvg <= 0) return 'flat';
  const change = ((lastAvg - firstAvg) / firstAvg) * 100;
  if (change > 2) return 'up';
  if (change < -2) return 'down';
  return 'flat';
}

type SoldBucket = {
  items: InventoryItem[];
  categories: string[];
  names: string[];
};

/** Standalone realized sales (not part of any bundle/PC), grouped by sub-variant. */
export function groupSalesByVariant(items: InventoryItem[]): Map<string, SoldBucket> {
  const childIds = collectContainerChildIds(items);
  const soldParentByChildId = collectRealizedContainerByChildId(items);
  const buckets = new Map<string, SoldBucket>();
  for (const item of items) {
    if (item.isBundle || item.isPC) continue;
    const isContainerChild = childIds.has(item.id);
    const soldParent = isContainerChild ? soldParentByChildId.get(item.id) : undefined;
    const isAttributedFromSoldContainer = Boolean(soldParent && (Number(item.sellPrice) || 0) > 0);
    if (isContainerChild && !isAttributedFromSoldContainer) continue;
    if (!isAttributedFromSoldContainer && !isRealizedDisposal(item)) continue;
    if (!((item.sellPrice || 0) > 0)) continue;

    const soldLikeItem: InventoryItem =
      isAttributedFromSoldContainer && soldParent
        ? {
            ...item,
            status: ItemStatus.SOLD,
            sellDate: item.sellDate || soldParent.sellDate,
            platformSold: item.platformSold || soldParent.platformSold,
            paymentType: item.paymentType || soldParent.paymentType,
          }
        : item;
    const key = variantKeyForItem(item);
    const bucket = buckets.get(key) || { items: [], categories: [], names: [] };
    bucket.items.push(soldLikeItem);
    bucket.categories.push(soldLikeItem.subCategory || soldLikeItem.category || 'Other');
    bucket.names.push(soldLikeItem.name);
    buckets.set(key, bucket);
  }
  return buckets;
}

/** In-stock count per sub-variant, same keying as groupSalesByVariant. */
export function computeActiveInventoryByVariant(items: InventoryItem[]): Map<string, number> {
  const childIds = collectContainerChildIds(items);
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.isBundle || item.isPC) continue;
    if (childIds.has(item.id)) continue;
    if (item.status !== ItemStatus.IN_STOCK) continue;
    const key = variantKeyForItem(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function buildGroupFromSales(
  key: string,
  label: string,
  category: string,
  sold: InventoryItem[],
  currentStock: number,
  seasonalityReady: boolean,
): ReinvestGroupBase {
  const soldCount = sold.length;
  const pocketProfits = sold.map((i) => pocketProfitForReinvest(i));
  const grossProfits = sold.map((i) => roundMoney((Number(i.sellPrice) || 0) - (Number(i.buyPrice) || 0)));
  const profitable = pocketProfits.filter((p) => p > 0);
  const lossCount = pocketProfits.filter((p) => p <= 0).length;
  const days = sold.map((i) => daysBetween(i.buyDate, i.sellDate)).filter((d): d is number => d != null);
  const feesObserved = sold.some(
    (i) => (Number(i.feeAmount) || 0) > 0 || Boolean(i.sellerPaidShipping && (Number(i.sellerShippingAmount) || 0) > 0),
  );
  const attributedFromKitCount = sold.filter(
    (i) => Boolean(i.parentContainerId) || i.status === ItemStatus.IN_COMPOSITION,
  ).length;

  const kaSells: number[] = [];
  const ebaySells: number[] = [];
  const allSells: number[] = [];
  let earliestBuy = Infinity;
  let latestSell = -Infinity;
  for (const item of sold) {
    const sell = Number(item.sellPrice) || 0;
    if (sell > 0) allSells.push(sell);
    const platform = resolveSalePlatform(item);
    if (platform === 'kleinanzeigen.de' && sell > 0) kaSells.push(sell);
    else if (platform === 'ebay.de' && sell > 0) ebaySells.push(sell);
    if (item.buyDate) earliestBuy = Math.min(earliestBuy, new Date(item.buyDate).getTime());
    if (item.sellDate) latestSell = Math.max(latestSell, new Date(item.sellDate).getTime());
  }
  const historySpanDays =
    Number.isFinite(earliestBuy) && Number.isFinite(latestSell) && latestSell > earliestBuy
      ? Math.max(1, Math.round((latestSell - earliestBuy) / 86400000))
      : 30;

  const confidence = confidenceForGroup(soldCount, lossCount);
  const avgDaysToSell = days.length ? average(days) : 14;
  const sampleCategory = mostCommon(sold.map((i) => i.category || 'Components'));
  const subCats = sold.map((i) => i.subCategory).filter((s): s is string => !!s);
  const sampleSubCategory = subCats.length ? mostCommon(subCats) : undefined;
  const allInclAvgProfit = average(pocketProfits);
  const grossAvgProfit = average(grossProfits);
  const targetStock = targetStockQty(soldCount, avgDaysToSell, historySpanDays, confidence);
  const { verdict, skipReason } = classifyVerdict(allInclAvgProfit, avgDaysToSell, soldCount, currentStock, targetStock);

  return {
    key,
    label,
    category,
    sampleCategory,
    sampleSubCategory,
    soldCount,
    lossCount,
    profitOnlyAvgProfit: profitable.length ? average(profitable) : null,
    allInclAvgProfit,
    grossAvgProfit,
    feesObserved,
    avgBuyPrice: average(sold.map((i) => Number(i.buyPrice) || 0)),
    avgDaysToSell,
    sellKaMedian: median(kaSells),
    sellKaCount: kaSells.length,
    sellEbayMedian: median(ebaySells),
    sellEbayCount: ebaySells.length,
    overallSellMedian: median(allSells),
    sellLow: allSells.length ? roundMoney(Math.min(...allSells)) : null,
    sellHigh: allSells.length ? roundMoney(Math.max(...allSells)) : null,
    currentStock,
    targetStock,
    confidence,
    warning: lossWarning(lossCount, soldCount),
    seasonalNote: seasonalityReady ? computeSeasonalNote(sold, average(allSells)) : undefined,
    trend: calculateOwnSalesTrend(sold),
    profitPerDay: roundMoney(allInclAvgProfit / Math.max(1, avgDaysToSell)),
    verdict,
    skipReason,
    sampleItemIds: sold.slice(0, 20).map((i) => i.id),
    attributedFromKitCount,
  };
}

export function buildVariantGroups(items: InventoryItem[], seasonalityReady = false): ReinvestGroup[] {
  const sales = groupSalesByVariant(items);
  const stock = computeActiveInventoryByVariant(items);
  const groups: ReinvestGroup[] = [];
  for (const [key, bucket] of sales) {
    const category = mostCommon(bucket.categories);
    // Generic, brand-free label ("SSD 512GB", not "Samsung 970 EVO 512GB") — this is also the
    // search query fed to the parser buttons, so it must match ANY listing of this variant, not
    // one specific product someone happened to sell before.
    const label = prettifyComponentKey(key) ?? category;
    const base = buildGroupFromSales(key, label, category, bucket.items, stock.get(key) || 0, seasonalityReady);
    groups.push({ ...base, kind: base.soldCount <= 1 ? 'hypothesis' : 'variant' });
  }
  // In-stock variants with zero sales still deserve a stock-only row isn't needed here —
  // zero-sale groups have no sold comps to price from, so they surface via the AI-hypothesis
  // path (services/reinvestAI.ts) instead of this sales-grounded list.
  return groups.sort((a, b) => b.profitPerDay - a.profitPerDay);
}

type AnchorCandidate = {
  containerId: string;
  container: InventoryItem;
  identity: string;
  category: string;
  child: InventoryItem;
};

function componentIdentity(item: InventoryItem): { identity: string; category: string; isExtracted: boolean } {
  const match = extractPrimaryComponentKey(item.name || '');
  if (match) return { identity: match.componentKey, category: match.category, isExtracted: true };
  const slug = (item.name || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 40);
  const category = item.subCategory || item.category || 'Other';
  return { identity: `raw:${category}:${slug}`, category, isExtracted: false };
}

function cpuPlatformFromKeys(cpuKey?: string, motherboardKey?: string): string | null {
  const cpu = (cpuKey || '').toLowerCase();
  const mobo = (motherboardKey || '').toLowerCase();

  if (mobo.includes('motherboard:b450') || mobo.includes('motherboard:b550') || mobo.includes('motherboard:x470') || mobo.includes('motherboard:x570')) {
    return 'AMD AM4';
  }
  if (mobo.includes('motherboard:b650') || mobo.includes('motherboard:b850') || mobo.includes('motherboard:x670') || mobo.includes('motherboard:x870')) {
    return 'AMD AM5';
  }
  if (mobo.includes('motherboard:z390')) return 'Intel LGA1151';
  if (mobo.includes('motherboard:h410') || mobo.includes('motherboard:h510') || mobo.includes('motherboard:z490') || mobo.includes('motherboard:z590')) {
    return 'Intel LGA1200';
  }
  if (mobo.includes('motherboard:h610') || mobo.includes('motherboard:h710') || mobo.includes('motherboard:z690') || mobo.includes('motherboard:z790')) {
    return 'Intel LGA1700';
  }

  if (cpu.includes('cpu:i3-4') || cpu.includes('cpu:i5-4') || cpu.includes('cpu:i7-4') || cpu.includes('cpu:i9-4')) {
    return 'Intel LGA1150';
  }
  if (cpu.includes('cpu:i3-6') || cpu.includes('cpu:i5-6') || cpu.includes('cpu:i7-6') || cpu.includes('cpu:i9-6') || cpu.includes('cpu:i3-7') || cpu.includes('cpu:i5-7') || cpu.includes('cpu:i7-7') || cpu.includes('cpu:i9-7') || cpu.includes('cpu:i3-8') || cpu.includes('cpu:i5-8') || cpu.includes('cpu:i7-8') || cpu.includes('cpu:i9-8') || cpu.includes('cpu:i3-9') || cpu.includes('cpu:i5-9') || cpu.includes('cpu:i7-9') || cpu.includes('cpu:i9-9')) {
    return 'Intel LGA1151';
  }
  if (cpu.includes('cpu:i3-10') || cpu.includes('cpu:i5-10') || cpu.includes('cpu:i7-10') || cpu.includes('cpu:i9-10') || cpu.includes('cpu:i3-11') || cpu.includes('cpu:i5-11') || cpu.includes('cpu:i7-11') || cpu.includes('cpu:i9-11')) {
    return 'Intel LGA1200';
  }
  if (cpu.includes('cpu:i3-12') || cpu.includes('cpu:i5-12') || cpu.includes('cpu:i7-12') || cpu.includes('cpu:i9-12') || cpu.includes('cpu:i3-13') || cpu.includes('cpu:i5-13') || cpu.includes('cpu:i7-13') || cpu.includes('cpu:i9-13') || cpu.includes('cpu:i3-14') || cpu.includes('cpu:i5-14') || cpu.includes('cpu:i7-14') || cpu.includes('cpu:i9-14')) {
    return 'Intel LGA1700';
  }
  if (cpu.includes('cpu:ryzen1-') || cpu.includes('cpu:ryzen2-') || cpu.includes('cpu:ryzen3-') || cpu.includes('cpu:ryzen4-') || cpu.includes('cpu:ryzen5-')) {
    return 'AMD AM4';
  }
  if (cpu.includes('cpu:ryzen7-') || cpu.includes('cpu:ryzen8-') || cpu.includes('cpu:ryzen9-')) {
    return 'AMD AM5';
  }
  if (cpu.includes('cpu:ryzen-')) return 'AMD Ryzen';
  if (cpu.startsWith('cpu:i')) return 'Intel Core';
  return null;
}

/** Repeating "anchor + varying sibling" bundles (e.g. any motherboard + i7-4790K), scored on
 * the bundle as a single sale, per section 1.1 — never split into per-component numbers. */
export function findAnchorBundles(items: InventoryItem[], seasonalityReady = false): AnchorBundleGroup[] {
  const containers = items.filter(
    (i) => (i.isBundle || i.isPC) && isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0,
  );
  if (!containers.length) return [];

  const stockByKey = computeActiveInventoryByVariant(items);
  const byIdentity = new Map<string, AnchorCandidate[]>();
  const siblingsByContainer = new Map<string, string[]>();
  const categoryByIdentity = new Map<string, string>();

  for (const container of containers) {
    const children = getChildren(container, items);
    if (!children.length) continue;
    const identities = children.map((child) => ({ child, ...componentIdentity(child) }));
    siblingsByContainer.set(
      container.id,
      identities.map((x) => x.identity),
    );
    for (const x of identities) {
      categoryByIdentity.set(x.identity, x.category);
      if (!x.isExtracted) continue; // only recognizable components can anchor a bundle pattern
      const list = byIdentity.get(x.identity) || [];
      list.push({ containerId: container.id, container, identity: x.identity, category: x.category, child: x.child });
      byIdentity.set(x.identity, list);
    }
  }

  const bundles: AnchorBundleGroup[] = [];
  for (const [identity, candidates] of byIdentity) {
    const containerIds = new Set(candidates.map((c) => c.containerId));
    if (containerIds.size < 3) continue;
    const siblingIdentities = new Set<string>();
    for (const cid of containerIds) {
      for (const sib of siblingsByContainer.get(cid) || []) {
        if (sib !== identity) siblingIdentities.add(sib);
      }
    }
    if (siblingIdentities.size < 2) continue; // same exact kit repeated — not an anchor pattern

    const bundleContainers = [...containerIds].map((cid) => items.find((i) => i.id === cid)!).filter(Boolean);
    const siblingCategory = mostCommon(
      [...siblingIdentities].map((sib) => categoryByIdentity.get(sib) || 'Other'),
    );
    const anchorLabel = prettifyComponentKey(identity) ?? shortestName(candidates.map((c) => c.child.name));

    const soldRows: InventoryItem[] = bundleContainers.map((container) => {
      const children = getChildren(container, items);
      const totalChildBuy = children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
      const buyPrice = roundMoney(totalChildBuy + (Number(container.buyPrice) || 0));
      const earliestChildBuy = children
        .map((c) => c.buyDate)
        .filter(Boolean)
        .sort()[0];
      return {
        ...container,
        buyPrice,
        buyDate: container.buyDate || earliestChildBuy || container.sellDate || '',
      } as InventoryItem;
    });

    const key = `bundle:${identity}`;
    const label = `${COMPONENT_CATEGORY_LABELS[siblingCategory as ComponentCategory] || siblingCategory} (any) + ${anchorLabel}`;
    // currentStock is a proxy: how many spare units of the anchor component (e.g. the CPU) are
    // sitting in stock unbundled — the actual "ready to sell" bundle count isn't tracked pre-assembly.
    const base = buildGroupFromSales(
      key,
      label,
      siblingCategory,
      soldRows,
      stockByKey.get(identity) || 0,
      seasonalityReady,
    );
    bundles.push({ ...base, kind: 'bundle', anchorComponentKey: identity, siblingCategory });
  }

  // CPU-centric bundle groups: these are often the actual buying intent
  // (e.g. "i7-4790K bundle"), with motherboard being a compatibility carrier.
  const cpuBuckets = new Map<string, { soldRows: InventoryItem[]; cpuLabel: string; platform: string; anchorKey: string }>();
  for (const container of containers) {
    const children = getChildren(container, items);
    const cpuChild = children.find((c) => extractPrimaryComponentKey(c.name || '')?.category === 'cpu');
    if (!cpuChild) continue;
    const cpuMatch = extractPrimaryComponentKey(cpuChild.name || '');
    const cpuKey = cpuMatch?.componentKey;
    if (!cpuKey) continue;
    const moboChild = children.find((c) => extractPrimaryComponentKey(c.name || '')?.category === 'motherboard');
    const moboKey = moboChild ? extractPrimaryComponentKey(moboChild.name || '')?.componentKey : undefined;
    const platform = cpuPlatformFromKeys(cpuKey, moboKey || undefined) || 'CPU Bundle';
    const cpuLabel = prettifyComponentKey(cpuKey) || cpuChild.name;
    const groupKey = `bundle-cpu:${platform}:${cpuKey}`;
    const existing = cpuBuckets.get(groupKey) || { soldRows: [], cpuLabel, platform, anchorKey: cpuKey };
    const totalChildBuy = children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
    existing.soldRows.push({
      ...container,
      buyPrice: roundMoney(totalChildBuy + (Number(container.buyPrice) || 0)),
      buyDate: container.buyDate || cpuChild.buyDate || container.sellDate || '',
    } as InventoryItem);
    cpuBuckets.set(groupKey, existing);
  }

  for (const [groupKey, bucket] of cpuBuckets) {
    if (bucket.soldRows.length < 2) continue;
    const stockByKey = computeActiveInventoryByVariant(items);
    const currentStock = stockByKey.get(bucket.anchorKey) || 0;
    const label = `${bucket.platform} bundle · ${bucket.cpuLabel}`;
    const base = buildGroupFromSales(
      groupKey,
      label,
      'CPU Bundle',
      bucket.soldRows,
      currentStock,
      seasonalityReady,
    );
    bundles.push({
      ...base,
      kind: 'bundle',
      anchorComponentKey: bucket.anchorKey,
      siblingCategory: 'motherboard',
      reasonNote: `CPU-first bundle group: buyers mostly choose this set for ${bucket.cpuLabel}.`,
    });
  }
  const deduped = new Map<string, AnchorBundleGroup>();
  for (const b of bundles) {
    const prev = deduped.get(b.key);
    if (!prev || b.soldCount > prev.soldCount || b.profitPerDay > prev.profitPerDay) deduped.set(b.key, b);
  }
  return [...deduped.values()].sort((a, b) => b.profitPerDay - a.profitPerDay);
}

/** Categories that show up repeatedly as bundle components (e.g. PSUs riding along in built PCs)
 * but that the user has never — or barely — sold as a standalone product. Section 2.4: adjacency
 * grounded in the user's own co-occurrence data, not a random AI guess. */
export function findAdjacentCategories(items: InventoryItem[], variants: ReinvestGroup[]): string[] {
  const established = new Set(
    variants
      .filter((g) => g.soldCount >= 3)
      .map((g) => categoryFromGroupKey(g.key))
      .filter((c): c is ComponentCategory => c != null),
  );

  const bundleCategoryCounts = new Map<ComponentCategory, number>();
  for (const container of items) {
    if (!container.isBundle && !container.isPC) continue;
    for (const child of getChildren(container, items)) {
      const match = extractPrimaryComponentKey(child.name || '');
      if (!match) continue;
      bundleCategoryCounts.set(match.category, (bundleCategoryCounts.get(match.category) || 0) + 1);
    }
  }

  const adjacent: string[] = [];
  for (const [category, count] of bundleCategoryCounts) {
    if (count < 3 || established.has(category)) continue;
    adjacent.push(COMPONENT_CATEGORY_LABELS[category]);
  }
  return adjacent;
}

export type AgingListing = {
  itemId: string;
  name: string;
  category: string;
  daysHeld: number;
  avgDaysToSell: number;
};

/** In-stock items sitting well past their category's usual time-to-sell — a soft nudge to bump
 * the listing or touch up price/photos. Informational only; publishing stays a user action. */
export function computeAgingListings(items: InventoryItem[], variants: ReinvestGroup[]): AgingListing[] {
  const byKey = new Map(variants.map((g) => [g.key, g]));
  const childIds = collectContainerChildIds(items);
  const now = Date.now();
  const out: AgingListing[] = [];

  for (const item of items) {
    if (item.isBundle || item.isPC) continue;
    if (childIds.has(item.id)) continue;
    if (item.status !== ItemStatus.IN_STOCK) continue;
    if (!item.buyDate) continue;

    const group = byKey.get(variantKeyForItem(item));
    if (!group || group.confidence === 'low') continue; // avg too thin to trust as a benchmark

    const daysHeld = Math.max(0, Math.round((now - new Date(item.buyDate).getTime()) / 86400000));
    const overDays = daysHeld - group.avgDaysToSell;
    if (daysHeld < group.avgDaysToSell * 1.3 || overDays < 5) continue;

    out.push({
      itemId: item.id,
      name: item.name,
      category: item.subCategory || item.category || 'Other',
      daysHeld,
      avgDaysToSell: Math.round(group.avgDaysToSell),
    });
  }

  return out.sort((a, b) => b.daysHeld - b.avgDaysToSell - (a.daysHeld - a.avgDaysToSell));
}

export function buildReinvestData(items: InventoryItem[]): ReinvestData {
  const historyDays = totalHistorySpanDays(items);
  const seasonalityReady = historyDays >= 180;
  const variants = buildVariantGroups(items, seasonalityReady);
  const bundles = findAnchorBundles(items, seasonalityReady);
  return {
    variants,
    bundles,
    adjacentCategories: findAdjacentCategories(items, variants),
    agingListings: computeAgingListings(items, variants),
    seasonalityReady,
    historyDays,
  };
}
