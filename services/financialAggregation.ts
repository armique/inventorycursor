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
    .filter((x): x is InventoryItem => !!x);
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

/** Aggregated sell price + profit for a sold bundle/PC row in the inventory list. */
export function getSoldContainerDisplayTotals(
  container: InventoryItem,
  items: InventoryItem[],
  taxMode: TaxMode
): SoldContainerDisplayTotals {
  if (!isRealizedDisposal(container)) return { sellPrice: null, profit: null, feeAmount: 0 };
  const children = getChildren(container, items);
  if (children.length === 0) {
    const sellPrice = Number(container.sellPrice) || 0;
    if (!sellPrice) return { sellPrice: null, profit: null, feeAmount: 0 };
    return {
      sellPrice: roundMoney(sellPrice),
      profit: roundMoney(computeItemProfitBeforeOverhead(container, taxMode)),
      feeAmount: getItemDisplayFeeAmount(container, items),
    };
  }
  if (isSoldWithProportionalChildren(container, items)) {
    const sellPrice = children.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0);
    const profit = children.reduce((s, c) => s + computeItemProfitBeforeOverhead(c, taxMode), 0);
    return {
      sellPrice: roundMoney(sellPrice),
      profit: roundMoney(profit),
      feeAmount: getItemDisplayFeeAmount(container, items),
    };
  }
  const parentSell = Number(container.sellPrice) || 0;
  if (parentSell > 0) {
    return {
      sellPrice: roundMoney(parentSell),
      profit: roundMoney(computeItemProfitBeforeOverhead(container, taxMode)),
      feeAmount: getItemDisplayFeeAmount(container, items),
    };
  }
  return { sellPrice: null, profit: null, feeAmount: 0 };
}

/** Sold / traded revenue & profit: same rows as Finanzamt ware sheet. */
export function shouldSkipForAggregatedSaleLine(item: InventoryItem, allItems: InventoryItem[]): boolean {
  if (item.isDraft) return true;
  if (shouldSkipCompositionChild(item, allItems)) return true;
  if (shouldSkipContainerRow(item, allItems)) return true;
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
