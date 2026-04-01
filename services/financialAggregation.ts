/**
 * Single source of truth for which inventory rows count toward totals (Dashboard, tax, Finanzamt).
 * All money math uses JavaScript numbers (IEEE-754); display uses formatEUR() separately — commas never enter calculations.
 */
import { InventoryItem, ItemStatus, TaxMode } from '../types';

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

/** Per-line profit (fees included) for dashboard / checks — matches SaleModal logic. */
export function computeItemProfitBeforeOverhead(item: InventoryItem, taxMode: TaxMode): number {
  const sell = Number(item.sellPrice) || 0;
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
