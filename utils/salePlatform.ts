import type { InventoryItem, Platform, TaxMode } from '../types';
import { ItemStatus } from '../types';
import {
  computeItemProfitBeforeOverhead,
  resolveSaleProfitParts,
  resolvedSaleRevenue,
  roundMoney,
} from '../services/financialAggregation';
import { calculateSaleProfit } from './saleProfit';
import { expandUpdatesWithContainerSaleMeta } from './containerSaleCascade';

const PLATFORM_LABELS: Record<string, string> = {
  'ebay.de': 'eBay',
  'kleinanzeigen.de': 'Kleinanzeigen',
  'In Person': 'In person',
  Amazon: 'Amazon',
  Other: 'Other',
};

/** Filter token for sold tab — items with no platform explicitly selected. */
export const MISSING_PLATFORM_FILTER = '__MISSING__';

export const SALE_PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'ebay.de', label: 'eBay' },
  { value: 'kleinanzeigen.de', label: 'Kleinanzeigen' },
  { value: 'In Person', label: 'In person (pickup)' },
  { value: 'Amazon', label: 'Amazon' },
  { value: 'Other', label: 'Other' },
];

export type ResolvedSalePlatform = Platform | 'unknown';

export type SalePlatformFields = Pick<
  InventoryItem,
  'platformSold' | 'paymentType' | 'ebayOrderId' | 'ebayUsername'
>;

/** eBay order ID, username, or payment type — even when platformSold was never set (common after CSV import). */
export function hasEbaySaleSignals(item: SalePlatformFields): boolean {
  if (item.ebayOrderId?.trim()) return true;
  if (item.ebayUsername?.trim()) return true;
  if (item.paymentType === 'ebay.de') return true;
  return false;
}

/**
 * Resolve where the item was sold. Explicit platformSold wins; otherwise infer from eBay fields / payment type.
 */
export function resolveSalePlatform(item: SalePlatformFields): ResolvedSalePlatform {
  if (item.platformSold) return item.platformSold;
  if (hasEbaySaleSignals(item)) return 'ebay.de';
  const pt = item.paymentType;
  if (pt?.startsWith('Kleinanzeigen')) return 'kleinanzeigen.de';
  return 'unknown';
}

export function itemMatchesSalePlatformFilter(
  item: SalePlatformFields & Pick<InventoryItem, 'status' | 'platformSold'>,
  filter: Platform | typeof MISSING_PLATFORM_FILTER
): boolean {
  if (filter === MISSING_PLATFORM_FILTER) return isMissingExplicitSalePlatform(item);
  return resolveSalePlatform(item) === filter;
}

export function isSoldOrTradedItem(item: Pick<InventoryItem, 'status'>): boolean {
  return item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
}

/** Sold item with no platform chosen in the form (may still infer eBay from order ID). */
export function isMissingExplicitSalePlatform(
  item: Pick<InventoryItem, 'status' | 'platformSold'>
): boolean {
  return isSoldOrTradedItem(item) && !item.platformSold?.trim();
}

export function formatSalePlatformLabel(platform?: ResolvedSalePlatform | string): string {
  if (!platform || platform === 'unknown') return 'Unknown';
  return PLATFORM_LABELS[platform] ?? platform;
}

export function formatItemSalePlatform(item: SalePlatformFields): string {
  return formatSalePlatformLabel(resolveSalePlatform(item));
}

export type PlatformGroupKey = 'ebay' | 'kleinanzeigen' | 'inPerson' | 'amazon' | 'other' | 'unknown';

export const PLATFORM_GROUP_LABEL: Record<PlatformGroupKey, string> = {
  ebay: 'eBay',
  kleinanzeigen: 'Kleinanzeigen',
  inPerson: 'In person',
  amazon: 'Amazon',
  other: 'Other',
  unknown: 'Unknown',
};

function toPlatformGroupKey(platform: ResolvedSalePlatform): PlatformGroupKey {
  if (platform === 'ebay.de') return 'ebay';
  if (platform === 'kleinanzeigen.de') return 'kleinanzeigen';
  if (platform === 'In Person') return 'inPerson';
  if (platform === 'Amazon') return 'amazon';
  if (platform === 'Other') return 'other';
  return 'unknown';
}

export function platformGroupKey(item: SalePlatformFields): PlatformGroupKey {
  return toPlatformGroupKey(resolveSalePlatform(item));
}

export function groupSalesByPlatform<T extends SalePlatformFields>(sold: T[]): Record<PlatformGroupKey, T[]> {
  const groups: Record<PlatformGroupKey, T[]> = {
    ebay: [],
    kleinanzeigen: [],
    inPerson: [],
    amazon: [],
    other: [],
    unknown: [],
  };
  for (const item of sold) {
    groups[platformGroupKey(item)].push(item);
  }
  return groups;
}

export type PlatformSalesCounts = {
  ebay: number;
  kleinanzeigen: number;
  inPerson: number;
  amazon: number;
  other: number;
  unknown: number;
};

export function countSalesByPlatform(sold: SalePlatformFields[]): PlatformSalesCounts {
  const groups = groupSalesByPlatform(sold);
  return {
    ebay: groups.ebay.length,
    kleinanzeigen: groups.kleinanzeigen.length,
    inPerson: groups.inPerson.length,
    amazon: groups.amazon.length,
    other: groups.other.length,
    unknown: groups.unknown.length,
  };
}

export type PlatformRevenueTotals = Record<PlatformGroupKey, number>;

export function sumRevenueByPlatform(sold: InventoryItem[]): PlatformRevenueTotals {
  const groups = groupSalesByPlatform(sold);
  const totals: PlatformRevenueTotals = {
    ebay: 0,
    kleinanzeigen: 0,
    inPerson: 0,
    amazon: 0,
    other: 0,
    unknown: 0,
  };
  for (const key of Object.keys(totals) as PlatformGroupKey[]) {
    totals[key] = sumDedupedSaleRevenue(groups[key]);
  }
  return totals;
}

/** Sold on eBay (by signals) but stored under another / missing platform tag. */
export function findLikelyMisclassifiedEbayItems(sold: InventoryItem[]): InventoryItem[] {
  return sold.filter((i) => platformGroupKey(i) !== 'ebay' && hasEbaySaleSignals(i));
}

/** Sold with no platform field set — needs manual tagging in inventory. */
export function findItemsNeedingPlatformTag(sold: InventoryItem[]): InventoryItem[] {
  return sold.filter((i) => isMissingExplicitSalePlatform(i));
}

export function countMissingExplicitSalePlatform(sold: InventoryItem[]): number {
  return sold.filter((i) => isMissingExplicitSalePlatform(i)).length;
}

/** Apply eBay platform tags where order ID / username / payment prove eBay but platformSold was empty. */
export function buildEbayTagFixUpdates(items: InventoryItem[]): InventoryItem[] {
  const tagged = items
    .map((item) => {
      if (platformGroupKey(item) === 'ebay' && item.platformSold === 'ebay.de') return null;
      if (!hasEbaySaleSignals(item)) return null;
      if (item.platformSold && item.platformSold !== 'ebay.de') return null;
      return {
        ...item,
        platformSold: 'ebay.de' as Platform,
        paymentType: item.paymentType || 'ebay.de',
      } as InventoryItem;
    })
    .filter((x): x is InventoryItem => x !== null);
  // Sold PC/bundle tags also stamp every linked part.
  return expandUpdatesWithContainerSaleMeta(tagged, items);
}

export type PlatformReconciliation = {
  platformRevenue: PlatformRevenueTotals;
  unknownRevenue: number;
  misclassifiedEbay: InventoryItem[];
  misclassifiedEbayRevenue: number;
  needingTag: InventoryItem[];
  needingTagRevenue: number;
  zeroSellPrice: InventoryItem[];
};

export function buildPlatformReconciliation(sold: InventoryItem[]): PlatformReconciliation {
  const platformRevenue = sumRevenueByPlatform(sold);
  const misclassifiedEbay = findLikelyMisclassifiedEbayItems(sold);
  const needingTag = findItemsNeedingPlatformTag(sold);
  const zeroSellPrice = sold.filter((i) => !(Number(i.sellPrice) > 0));
  return {
    platformRevenue,
    unknownRevenue: platformRevenue.unknown,
    misclassifiedEbay,
    misclassifiedEbayRevenue: roundMoney(
      misclassifiedEbay.reduce((acc, i) => acc + resolvedSaleRevenue(i), 0)
    ),
    needingTag,
    needingTagRevenue: roundMoney(needingTag.reduce((acc, i) => acc + resolvedSaleRevenue(i), 0)),
    zeroSellPrice,
  };
}

export type MarketplaceOrderStats = {
  /** Inventory rows counted (bundle parts = multiple items). */
  itemCount: number;
  /** Buyer-facing orders — matches eBay “Stückzahl” when order IDs / bundle splits align. */
  orderCount: number;
};

function marketplaceOrderKey(item: InventoryItem): string {
  const oid = item.ebayOrderId?.trim();
  if (oid) return `oid:${oid}`;
  const sellDay = item.sellDate?.slice(0, 10) || '';
  if (item.parentContainerId && sellDay) return `bundle:${item.parentContainerId}:${sellDay}`;
  return `solo:${item.id}`;
}

/** Count marketplace orders vs inventory line items (bundles / shared order IDs collapse to one order). */
export function countMarketplaceOrders(items: InventoryItem[]): MarketplaceOrderStats {
  const itemCount = items.length;
  if (itemCount === 0) return { itemCount: 0, orderCount: 0 };
  const keys = new Set(items.map(marketplaceOrderKey));
  return { itemCount, orderCount: keys.size };
}

export type MarketplaceOrderGroup = {
  key: string;
  label: string;
  items: InventoryItem[];
  revenue: number;
};

/** True when every row in an eBay order group carries the same order-level buyer total. */
export function isDuplicateOrderLevelGross(group: InventoryItem[]): boolean {
  if (group.length < 2) return false;
  if (!group[0]!.ebayOrderId?.trim()) return false;
  const amounts = group.map((i) => resolvedSaleRevenue(i));
  const max = Math.max(...amounts);
  if (!amounts.every((a) => Math.abs(a - max) < 0.02)) return false;
  const buyerTotals = group
    .map((i) => i.saleProceeds?.buyerTotalEur)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0.01);
  return buyerTotals.length === group.length && buyerTotals.every((v) => Math.abs(v - max) < 0.02);
}

/** Revenue for one marketplace-order group — avoids counting duplicate order-level gross on every Abrechnung line. */
export function dedupeOrderGroupRevenue(group: InventoryItem[]): number {
  if (!group.length) return 0;
  if (group.length === 1) return resolvedSaleRevenue(group[0]!);
  if (isDuplicateOrderLevelGross(group)) {
    return roundMoney(Math.max(...group.map((i) => resolvedSaleRevenue(i))));
  }
  return roundMoney(group.reduce((acc, i) => acc + resolvedSaleRevenue(i), 0));
}

/**
 * Profit for one marketplace-order group.
 * When Abrechnung copied the full order gross onto every linked SKU, sum of per-line profits
 * is massively inflated — recompute once as (order net/gross − sum of EKs − fees).
 */
export function dedupeOrderGroupProfit(group: InventoryItem[], taxMode: TaxMode): number {
  if (!group.length) return 0;
  if (group.length === 1) return computeItemProfitBeforeOverhead(group[0]!, taxMode);
  if (!isDuplicateOrderLevelGross(group)) {
    return roundMoney(group.reduce((acc, i) => acc + computeItemProfitBeforeOverhead(i, taxMode), 0));
  }
  const buySum = roundMoney(group.reduce((acc, i) => acc + (Number(i.buyPrice) || 0), 0));
  const { sell, fee } = resolveSaleProfitParts(group[0]!);
  return roundMoney(calculateSaleProfit(sell, buySum, fee, taxMode));
}

/** Sum sale revenue once per marketplace order (bundle splits still sum part prices). */
export function sumDedupedSaleRevenue(items: InventoryItem[], allItems?: InventoryItem[]): number {
  const groups = groupItemsByMarketplaceOrder(items, allItems);
  return roundMoney(groups.reduce((acc, g) => acc + g.revenue, 0));
}

/** Sum sale profit once per marketplace order (mirrors revenue dedupe for Abrechnung duplicates). */
export function sumDedupedSaleProfit(
  items: InventoryItem[],
  taxMode: TaxMode,
  allItems?: InventoryItem[]
): number {
  const groups = groupItemsByMarketplaceOrder(items, allItems);
  return roundMoney(groups.reduce((acc, g) => acc + dedupeOrderGroupProfit(g.items, taxMode), 0));
}

export function groupItemsByMarketplaceOrder(
  items: InventoryItem[],
  allItems?: InventoryItem[]
): MarketplaceOrderGroup[] {
  const map = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = marketplaceOrderKey(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, groupItems]) => {
    const first = groupItems[0]!;
    const oid = first.ebayOrderId?.trim();
    let label: string;
    if (oid) {
      label = groupItems.length > 1 ? `eBay order #${oid} (${groupItems.length} parts)` : `eBay order #${oid}`;
    } else if (first.parentContainerId) {
      const parent = allItems?.find((i) => i.id === first.parentContainerId);
      const day = first.sellDate?.slice(0, 10) || '';
      label = parent
        ? `Bundle: ${parent.name} (${groupItems.length} parts${day ? ` · ${day}` : ''})`
        : `Bundle split · ${groupItems.length} parts`;
    } else {
      label = first.name;
    }
    const revenue = dedupeOrderGroupRevenue(groupItems);
    return { key, label, items: groupItems, revenue };
  });
}

export type PlatformOrderStatsMap = Record<PlatformGroupKey, MarketplaceOrderStats>;

export function countOrdersByPlatform(sold: InventoryItem[]): PlatformOrderStatsMap {
  const groups = groupSalesByPlatform(sold);
  const out = {} as PlatformOrderStatsMap;
  for (const key of Object.keys(groups) as PlatformGroupKey[]) {
    out[key] = countMarketplaceOrders(groups[key]);
  }
  return out;
}
