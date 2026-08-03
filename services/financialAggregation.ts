/**
 * Single source of truth for which inventory rows count toward totals (Dashboard, tax, Finanzamt).
 * All money math uses JavaScript numbers (IEEE-754); display uses formatEUR() separately — commas never enter calculations.
 */
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { isRealizedDisposal } from '../utils/itemDisposition';

export function roundMoney(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function getChildren(container: InventoryItem, items: InventoryItem[]): InventoryItem[] {
  const byIds = (container.componentIds || [])
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is InventoryItem => !!x)
    // Stale componentIds on an older shell must not steal parts that now belong
    // to another PC/bundle (historical compose ran twice on the same sale).
    .filter((c) => !c.parentContainerId || c.parentContainerId === container.id);
  if (byIds.length > 0) return byIds;
  return items.filter((i) => i.parentContainerId === container.id);
}

/** Sold bundle/PC where sell price & profit live on each component. */
export function isSoldWithProportionalChildren(container: InventoryItem, items: InventoryItem[]): boolean {
  if (!container.isBundle && !container.isPC) return false;
  const children = getChildren(container, items);
  if (children.length === 0) return false;
  if (container.status !== ItemStatus.SOLD) return false;
  return children.every((c) => c.status === ItemStatus.SOLD && !!c.sellDate);
}

/** Omit container row when components carry all sales (avoids double revenue). */
export function shouldSkipContainerRow(item: InventoryItem, items: InventoryItem[]): boolean {
  return isSoldWithProportionalChildren(item, items);
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

export function getParentContainer(item: InventoryItem, items: InventoryItem[]): InventoryItem | undefined {
  if (item.parentContainerId) {
    const direct = items.find((i) => i.id === item.parentContainerId);
    if (direct) return direct;
  }
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
  _opts?: { showInComposition?: boolean }
): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = getParentContainer(item, items);
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
export function isPartOfRealizedContainer(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = getParentContainer(item, items);
  return Boolean(parent && (parent.isPC || parent.isBundle) && isRealizedDisposal(parent));
}

/**
 * On SOLD + Components/GPU (etc.), show the nested part as its own row — otherwise the pin
 * only matches standalone GPUs and build sales look empty.
 */
export function shouldSurfaceSoldContainerPartInList(
  item: InventoryItem,
  items: InventoryItem[],
  statusFilter: string,
  categoryFilter: string,
  subCategoryFilter: string
): boolean {
  if (statusFilter !== 'SOLD') return false;
  if (categoryFilter === 'ALL' && !subCategoryFilter) return false;
  if (!matchesInventoryCategoryPin(item, categoryFilter, subCategoryFilter)) return false;
  return isPartOfRealizedContainer(item, items);
}

/** Sell/disposition date for a nested part when drilling sold category pins. */
export function soldContainerPartDispositionDate(
  item: InventoryItem,
  items: InventoryItem[]
): string | undefined {
  if (item.sellDate) return item.sellDate;
  const parent = getParentContainer(item, items);
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
  matchesFn: (item: InventoryItem, query: string) => boolean
): boolean {
  if (matchesFn(item, query)) return true;
  if (!item.isBundle && !item.isPC) return false;
  return getChildren(item, items).some((c) => matchesFn(c, query));
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
  if ((item.isPC || item.isBundle) && isRealizedDisposal(item)) {
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
  if ((item.isPC || item.isBundle) && isRealizedDisposal(item)) {
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
    const sellPrice = children.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0);
    const profit = children.reduce((s, c) => s + computeItemProfitBeforeOverhead(c, taxMode), 0);
    return {
      sellPrice: roundMoney(sellPrice),
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
  if (shouldSkipContainerRow(item, allItems)) return true;
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

/** Per-line profit (fees included) for dashboard / checks — matches SaleModal logic. */
export function computeItemProfitBeforeOverhead(item: InventoryItem, taxMode: TaxMode): number {
  const sell = getEffectiveSellPriceForProfit(item);
  const buy = Number(item.buyPrice) || 0;
  const fee = Number(item.feeAmount) || 0;
  if (taxMode === 'RegularVAT') {
    const netSell = sell / 1.19;
    return roundMoney(netSell - buy - fee);
  }
  if (taxMode === 'DifferentialVAT') {
    const margin = sell - buy;
    if (margin <= 0) return roundMoney(margin - fee);
    const tax = margin - margin / 1.19;
    return roundMoney(margin - tax - fee);
  }
  return roundMoney(sell - buy - fee);
}
