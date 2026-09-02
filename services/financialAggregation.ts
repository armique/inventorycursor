/**
 * Single source of truth for which inventory rows count toward totals (Dashboard, tax, Finanzamt).
 * All money math uses JavaScript numbers (IEEE-754); display uses formatEUR() separately — commas never enter calculations.
 */
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { calculateSaleProfit } from '../utils/saleProfit';
import { netPayoutAfterRefund, saleProceedsFeeTotal, saleColumnSplit, isTrustedEbayProceeds } from '../utils/saleProceeds';

export function roundMoney(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Prebuilt O(1) lookups over an items array (QW7). Build once per items identity and pass to
 * the helpers below — otherwise each call falls back to a full array scan (O(N) per call,
 * O(N²) per filter pass). All maps preserve first-match semantics of the original scans.
 */
export type InventoryLookup = {
  itemById: Map<string, InventoryItem>;
  childrenByParentId: Map<string, InventoryItem[]>;
  containerByComponentId: Map<string, InventoryItem>;
};

export function buildInventoryLookup(items: InventoryItem[]): InventoryLookup {
  const itemById = new Map<string, InventoryItem>();
  const childrenByParentId = new Map<string, InventoryItem[]>();
  const containerByComponentId = new Map<string, InventoryItem>();
  for (const i of items) {
    // First-wins mirrors items.find(...) on duplicate ids.
    if (!itemById.has(i.id)) itemById.set(i.id, i);
    if (i.parentContainerId) {
      const arr = childrenByParentId.get(i.parentContainerId);
      if (arr) arr.push(i);
      else childrenByParentId.set(i.parentContainerId, [i]);
    }
  }
  for (const i of items) {
    if ((i.isBundle || i.isPC) && i.componentIds?.length) {
      for (const cid of i.componentIds) {
        if (!containerByComponentId.has(cid)) containerByComponentId.set(cid, i);
      }
    }
  }
  return { itemById, childrenByParentId, containerByComponentId };
}

export function getChildren(
  container: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): InventoryItem[] {
  const byIds = (container.componentIds || [])
    .map((id) => (lookup ? lookup.itemById.get(id) : items.find((i) => i.id === id)))
    .filter((x): x is InventoryItem => !!x)
    // Stale componentIds on an older shell must not steal parts that now belong
    // to another PC/bundle (historical compose ran twice on the same sale).
    .filter((c) => !c.parentContainerId || c.parentContainerId === container.id);
  if (byIds.length > 0) return byIds;
  if (lookup) return lookup.childrenByParentId.get(container.id) || [];
  return items.filter((i) => i.parentContainerId === container.id);
}

/** Sold bundle/PC where sell price & profit live on each component. */
export function isSoldWithProportionalChildren(
  container: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  const isContainer =
    container.isBundle ||
    container.isPC ||
    Boolean(container.componentIds && container.componentIds.length > 0);
  if (!isContainer) return false;
  const children = getChildren(container, items, lookup);
  if (children.length === 0) return false;
  if (container.status !== ItemStatus.SOLD) return false;
  return children.every((c) => c.status === ItemStatus.SOLD && !!c.sellDate);
}

/** Omit container row when components carry all sales (avoids double revenue). */
export function shouldSkipContainerRow(item: InventoryItem, items: InventoryItem[]): boolean {
  return isSoldWithProportionalChildren(item, items);
}

/**
 * Nested part of a sold PC/bundle whose checkout total lives on the parent.
 * Dashboard / tax must count the parent Gesamtbetrag once — not child item prices.
 */
export function shouldSkipSoldContainerChildForSaleTotals(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (!item.parentContainerId) return false;
  const parent =
    lookup?.itemById.get(item.parentContainerId) ??
    items.find((row) => row.id === item.parentContainerId);
  if (!parent) return false;
  return isSoldWithProportionalChildren(parent, items, lookup);
}

/** Buyer Gesamtbetrag for a sale line — Hub total wins over a drifted sellPrice. */
export function resolvedSaleRevenue(item: InventoryItem): number {
  const buyer = item.saleProceeds?.buyerTotalEur;
  if (buyer != null && Number.isFinite(buyer) && buyer >= 0.01) return roundMoney(buyer);
  return roundMoney(Number(item.sellPrice) || 0);
}

/** Component inside a bundle/PC — stock and sales are on the parent row. */
export function shouldSkipCompositionChild(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.status !== ItemStatus.IN_COMPOSITION) return false;
  if (!item.parentContainerId) return false;
  const p = items.find((i) => i.id === item.parentContainerId);
  if (!p || (!p.isBundle && !p.isPC)) return false;
  return true;
}

export function isBundleSoldOnParentOnly(parent: InventoryItem, items: InventoryItem[]): boolean {
  if (!parent.isBundle && !parent.isPC) return false;
  if (parent.status !== ItemStatus.SOLD) return false;
  const children = getChildren(parent, items);
  if (children.length === 0) return false;
  return children.some((c) => c.status === ItemStatus.IN_COMPOSITION);
}

/**
 * Sold PC/bundle still lists componentIds, but every part now belongs to another
 * container (stale shell after a second historical compose on the same sale).
 */
export function isOrphanSoldContainerShell(container: InventoryItem, items: InventoryItem[]): boolean {
  if (!container.isBundle && !container.isPC) return false;
  if (container.status !== ItemStatus.SOLD && container.status !== ItemStatus.TRADED) return false;
  const listed = container.componentIds || [];
  if (listed.length === 0) return false;
  return getChildren(container, items).length === 0;
}

export function getParentContainer(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): InventoryItem | undefined {
  if (item.parentContainerId) {
    const direct = lookup
      ? lookup.itemById.get(item.parentContainerId)
      : items.find((i) => i.id === item.parentContainerId);
    if (direct) return direct;
  }
  if (lookup) return lookup.containerByComponentId.get(item.id);
  return items.find(
    (p) =>
      (p.isBundle || p.isPC) &&
      (p.componentIds || []).includes(item.id)
  );
}

/** Hide bundle/PC component rows — they always render nested under the parent. */
export function shouldHideContainerChildInList(
  item: InventoryItem,
  items: InventoryItem[],
  _opts?: { showInComposition?: boolean },
  lookup?: InventoryLookup
): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = getParentContainer(item, items, lookup);
  if (!parent || (!parent.isBundle && !parent.isPC)) return false;
  return true;
}

/** Same category pin rules as the inventory list (Components+GPU or top-level GPU). */
export function matchesInventoryCategoryPin(
  item: Pick<InventoryItem, 'category' | 'subCategory'>,
  categoryFilter: string,
  subCategoryFilter: string
): boolean {
  if (categoryFilter === 'ALL' && !subCategoryFilter) return true;
  const itemSub = item.subCategory || '';
  const filterSub = subCategoryFilter || '';
  const subMatches = !filterSub || inventorySubcategoryAliasesMatch(filterSub, itemSub);
  const matchParentAndSub =
    categoryFilter !== 'ALL' && item.category === categoryFilter && subMatches;
  // Top-level rows like category "Processors" / "CPU" (no Components parent)
  const matchSubAsTopLevel = Boolean(
    filterSub && inventorySubcategoryAliasesMatch(filterSub, item.category)
  );
  return Boolean(matchParentAndSub || matchSubAsTopLevel);
}

/** GPU / CPU (and DE) subcategory renames — pins and stale rows must still match. */
export function inventorySubcategoryAliasesMatch(a: string, b: string): boolean {
  const left = (a || '').trim();
  const right = (b || '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const norm = (s: string) => s.trim().toLowerCase();
  const l = norm(left);
  const r = norm(right);
  if (l === r) return true;

  const gpu = new Set([
    'gpu',
    'graphics cards',
    'graphic cards',
    'grafikkarten',
    'grafikkarte',
  ]);
  if (gpu.has(l) && gpu.has(r)) return true;

  const cpu = new Set([
    'cpu',
    'processors',
    'processor',
    'prozessoren',
    'prozessor',
  ]);
  if (cpu.has(l) && cpu.has(r)) return true;

  return false;
}

/** Part nested under a sold/traded/gifted PC/bundle (status often stays IN_COMPOSITION). */
export function isPartOfRealizedContainer(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = getParentContainer(item, items, lookup);
  return Boolean(parent && (parent.isPC || parent.isBundle) && isRealizedDisposal(parent));
}

/**
 * On SOLD + Components/GPU (etc.), show the nested part as its own row — otherwise the pin
 * only matches standalone GPUs and build sales look empty.
 */

/** Active tab (and Active search): stock/ordered, plus composition only under Active parents. */
export function itemMatchesActiveInventoryTab(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) return true;
  if (item.status !== ItemStatus.IN_COMPOSITION) return false;
  // Parts under a sold/traded/gifted PC must not leak into Active search/results.
  return !isPartOfRealizedContainer(item, items, lookup);
}

export function shouldSurfaceSoldContainerPartInList(
  item: InventoryItem,
  items: InventoryItem[],
  statusFilter: string,
  categoryFilter: string,
  subCategoryFilter: string,
  lookup?: InventoryLookup
): boolean {
  if (statusFilter !== 'SOLD') return false;
  if (categoryFilter === 'ALL' && !subCategoryFilter) return false;
  if (!matchesInventoryCategoryPin(item, categoryFilter, subCategoryFilter)) return false;
  return isPartOfRealizedContainer(item, items, lookup);
}

/** Sell/disposition date for a nested part when drilling sold category pins. */
export function soldContainerPartDispositionDate(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): string | undefined {
  if (item.sellDate) return item.sellDate;
  const parent = getParentContainer(item, items, lookup);
  return parent?.sellDate;
}

/** @deprecated Use shouldHideContainerChildInList — kept for call-site compatibility. */
export function shouldHideSoldContainerChildInList(
  item: InventoryItem,
  items: InventoryItem[],
  _statusFilter: 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL',
  searchActive: boolean
): boolean {
  // Search no longer un-hides children; parents are included when a child matches.
  void searchActive;
  return shouldHideContainerChildInList(item, items);
}

/**
 * Bundle/PC matches search when its own fields match OR any nested child matches.
 * Used so searching "i7-4790K" surfaces the parent PC/bundle row.
 */
export function containerOrChildMatchesSearch(
  item: InventoryItem,
  items: InventoryItem[],
  query: string,
  matchesFn: (item: InventoryItem, query: string) => boolean,
  lookup?: InventoryLookup
): boolean {
  if (matchesFn(item, query)) return true;
  if (!item.isBundle && !item.isPC) return false;
  return getChildren(item, items, lookup).some((c) => matchesFn(c, query));
}

export type SoldContainerDisplayTotals = {
  sellPrice: number | null;
  profit: number | null;
  feeAmount: number;
  shippingAmount: number;
};

/**
 * Marketplace fees recorded on the item (eBay etc.).
 * For sold bundles/PCs with proportional children, sums child fees.
 */
export function getItemDisplayFeeAmount(item: InventoryItem, items: InventoryItem[]): number {
  const isContainer =
    item.isPC ||
    item.isBundle ||
    Boolean(item.componentIds && item.componentIds.length > 0);
  if (isContainer && isRealizedDisposal(item)) {
    const children = getChildren(item, items);
    if (children.length > 0 && isSoldWithProportionalChildren(item, items)) {
      return roundMoney(children.reduce((s, c) => s + (Number(c.feeAmount) || 0), 0));
    }
  }
  return roundMoney(Number(item.feeAmount) || 0);
}

/**
 * Shipping you paid out of pocket on the sale (buyer's paid amount already includes it).
 * For sold bundles/PCs with proportional children, sums child shipping amounts.
 */
export function getItemDisplayShippingAmount(item: InventoryItem, items: InventoryItem[]): number {
  const isContainer =
    item.isPC ||
    item.isBundle ||
    Boolean(item.componentIds && item.componentIds.length > 0);
  if (isContainer && isRealizedDisposal(item)) {
    const children = getChildren(item, items);
    if (children.length > 0 && isSoldWithProportionalChildren(item, items)) {
      return roundMoney(children.reduce((s, c) => s + getSellerShippingDeduction(c), 0));
    }
  }
  return getSellerShippingDeduction(item);
}

/** Aggregated sell price + profit for a sold bundle/PC row in the inventory list. */
export function getSoldContainerDisplayTotals(
  container: InventoryItem,
  items: InventoryItem[],
  taxMode: TaxMode
): SoldContainerDisplayTotals {
  if (!isRealizedDisposal(container)) return { sellPrice: null, profit: null, feeAmount: 0, shippingAmount: 0 };
  const children = getChildren(container, items);
  if (children.length === 0) {
    const sellPrice = Number(container.sellPrice) || 0;
    if (!sellPrice) return { sellPrice: null, profit: null, feeAmount: 0, shippingAmount: 0 };
    return {
      sellPrice: roundMoney(sellPrice),
      profit: roundMoney(computeItemProfitBeforeOverhead(container, taxMode)),
      feeAmount: getItemDisplayFeeAmount(container, items),
      shippingAmount: getItemDisplayShippingAmount(container, items),
    };
  }
  if (isSoldWithProportionalChildren(container, items)) {
    const childrenSum = roundMoney(children.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0));
    const hubBuyerTotal = container.saleProceeds?.buyerTotalEur;
    const parentSell = Number(container.sellPrice) || 0;
    const sellPrice =
      hubBuyerTotal != null && hubBuyerTotal > childrenSum + 0.02
        ? roundMoney(hubBuyerTotal)
        : parentSell > childrenSum + 0.02
          ? roundMoney(parentSell)
          : childrenSum;
    const childBuy = roundMoney(children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
    const hubNet = Number(container.saleProceeds?.netPayoutEur);
    const profit =
      Number.isFinite(hubNet) && Math.abs(hubNet) >= 0.01
        ? roundMoney(hubNet - childBuy)
        : children.reduce((s, c) => s + computeItemProfitBeforeOverhead(c, taxMode), 0);
    return {
      sellPrice,
      profit: roundMoney(profit),
      feeAmount: getItemDisplayFeeAmount(container, items),
      shippingAmount: getItemDisplayShippingAmount(container, items),
    };
  }
  const parentSell = Number(container.sellPrice) || 0;
  if (parentSell > 0) {
    return {
      sellPrice: roundMoney(parentSell),
      profit: roundMoney(computeItemProfitBeforeOverhead(container, taxMode)),
      feeAmount: getItemDisplayFeeAmount(container, items),
      shippingAmount: getItemDisplayShippingAmount(container, items),
    };
  }
  return { sellPrice: null, profit: null, feeAmount: 0, shippingAmount: 0 };
}

/** Sold / traded revenue & profit: same rows as Finanzamt ware sheet. */
export function shouldSkipForAggregatedSaleLine(item: InventoryItem, allItems: InventoryItem[]): boolean {
  if (item.isDraft) return true;
  if (shouldSkipCompositionChild(item, allItems)) return true;
  if (shouldSkipSoldContainerChildForSaleTotals(item, allItems)) return true;
  // Ghost sold PC/bundle left after a second historical compose on the same parts.
  if (isOrphanSoldContainerShell(item, allItems)) return true;
  return false;
}

/** Stock value at cost: count bundle/PC parent, not embedded components. */
export function shouldSkipForInventoryCostLine(item: InventoryItem, allItems: InventoryItem[]): boolean {
  if (item.isDraft) return true;
  return shouldSkipCompositionChild(item, allItems);
}

/**
 * Wareneingang (COGS purchase) in tax year: count this row's buyPrice once.
 * Skip bundle/PC container if children exist (their buys are summed on child rows).
 */
export function shouldSkipContainerForPurchaseCogs(item: InventoryItem, allItems: InventoryItem[]): boolean {
  if (item.isDraft) return true;
  if (!(item.isPC || item.isBundle)) return false;
  const children = getChildren(item, allItems);
  return children.length > 0;
}

/** Shipping you paid (label, carrier) — deducted from sellPrice for profit, not from recorded payout. */
export function getSellerShippingDeduction(item: InventoryItem): number {
  if (!item.sellerPaidShipping) return 0;
  return roundMoney(Number(item.sellerShippingAmount) || 0);
}

export function getEffectiveSellPriceForProfit(item: InventoryItem): number {
  const sell = Number(item.sellPrice) || 0;
  return roundMoney(Math.max(0, sell - getSellerShippingDeduction(item)));
}

/**
 * Hub / screenshot Bestelleinnahmen already have ads, eBay fee, label, and refunds out.
 * Margin is tax-mode profit on that net vs EK — never subtract those costs a second time.
 */
function coerceTaxMode(taxMode: unknown): TaxMode {
  if (taxMode === 'RegularVAT' || taxMode === 'DifferentialVAT' || taxMode === 'SmallBusiness') return taxMode;
  return 'SmallBusiness';
}

function trustedSaleProceeds(item: InventoryItem): NonNullable<InventoryItem['saleProceeds']> | null {
  const p = item.saleProceeds;
  if (!p || p.feesEstimated) return null;
  if (p.source !== 'ebay_seller_hub' && p.source !== 'ebay_screenshot' && p.source !== 'ebay_order') return null;
  return p;
}

export function resolveSaleProfitParts(item: InventoryItem): { sell: number; fee: number } {
  const p = trustedSaleProceeds(item);
  if (p) {
    const net = netPayoutAfterRefund(
      p.buyerTotalEur ?? item.sellPrice,
      saleProceedsFeeTotal(p),
      p.netPayoutEur,
      p.refundEur ?? 0
    );
    if (net != null && Number.isFinite(net)) {
      return { sell: roundMoney(net), fee: 0 };
    }
  }
  const sell = getEffectiveSellPriceForProfit(item);
  let fee = Number(item.feeAmount) || 0;
  const label = roundMoney(Math.abs(Number(item.saleProceeds?.shippingLabelEur) || 0));
  if (getSellerShippingDeduction(item) >= 0.01 && label >= 0.01 && fee + 0.001 >= label) {
    fee = roundMoney(Math.max(0, fee - label));
  }
  return { sell, fee };
}

/**
 * Sold tab shows cash in pocket, no VAT taken out.
 *
 * This once meant something: the Dashboard passed the real TaxMode and got a
 * VAT-adjusted figure, while the Sold tab forced SmallBusiness to show gross.
 * calculateSaleProfit now ignores tax mode entirely (see utils/saleProfit.ts —
 * the owner's Steuerberater handles VAT), so both paths return the same number
 * and this constant no longer changes any output. Kept because it still names
 * the intent at the call sites; it is not a behavioural switch.
 */
export const POCKET_PROFIT_TAX_MODE: TaxMode = 'SmallBusiness';

/**
 * Pocket margin (Bestelleinnahmen − EK) — for Hub/screenshot sales, match the sell-cell net line.
 * Non-eBay sales keep the classic sell − shipping − fees − EK path.
 */
export function computeSoldTabMargin(item: InventoryItem): number {
  const buy = Number(item.buyPrice) || 0;
  if (isTrustedEbayProceeds(item.saleProceeds)) {
    const split = saleColumnSplit(item, {
      displaySellEur: item.saleProceeds?.buyerTotalEur ?? item.sellPrice,
    });
    if (split?.netEur != null && Number.isFinite(split.netEur)) {
      return roundMoney(split.netEur - buy);
    }
  }
  return computeItemProfitBeforeOverhead(item, POCKET_PROFIT_TAX_MODE);
}

/** Per-line profit (fees included) for dashboard / checks — matches SaleModal logic. */
export function computeItemProfitBeforeOverhead(item: InventoryItem, taxMode: TaxMode): number {
  const buy = Number(item.buyPrice) || 0;
  const { sell, fee } = resolveSaleProfitParts(item);
  return roundMoney(calculateSaleProfit(sell, buy, fee, coerceTaxMode(taxMode)));
}

/**
 * Stamp `profit` from current saleProceeds / fees. Returns the same reference when unchanged.
 */
export function withSyncedRealizedProfit(item: InventoryItem): InventoryItem {
  if (item.isBundle || item.isPC) return item;
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED && item.status !== ItemStatus.GIFTED) {
    return item;
  }
  if (item.sellPrice == null || !Number.isFinite(Number(item.sellPrice))) {
    if (item.profit == null) return item;
    return { ...item, profit: undefined };
  }
  // Inventory always shows the clean, tax-mode-agnostic margin (cash in pocket, no VAT taken
  // out) — same as computeSoldTabMargin's own contract. The Dashboard is the only place that
  // applies the selected TaxMode, recomputing from sell/buy/fee at aggregation time rather than
  // reading this stored field. Stamping a VAT-adjusted number here was the bug: it depended on
  // whatever TaxMode happened to be selected when this heal last ran, so the same sale could
  // show a different "profit" on different days with no user action.
  const profit = computeSoldTabMargin(item);
  if (item.profit != null && Math.abs(Number(item.profit) - profit) < 0.015) return item;
  return { ...item, profit };
}

/** Patch sold/traded rows whose stored margin drifted from saleProceeds math. */
export function healRealizedProfitsFromSaleProceeds(items: InventoryItem[]): InventoryItem[] {
  const out: InventoryItem[] = [];
  for (const item of items) {
    if (item.isBundle || item.isPC) continue;
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED && item.status !== ItemStatus.GIFTED) {
      continue;
    }
    if (!item.saleProceeds && !(Number(item.feeAmount) > 0) && item.sellPrice == null) continue;
    const next = withSyncedRealizedProfit(item);
    if (next !== item) out.push(next);
  }
  return out;
}
