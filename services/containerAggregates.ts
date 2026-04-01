import { InventoryItem } from '../types';

/** Components linked to a PC or bundle container (same rules as InventoryList). */
export function getComponentsForContainer(
  container: InventoryItem,
  allItems: InventoryItem[]
): InventoryItem[] {
  if (!container.isPC && !container.isBundle) return [];
  return allItems.filter(
    (i) =>
      (container.componentIds && container.componentIds.includes(i.id)) ||
      i.parentContainerId === container.id
  );
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sets each PC/bundle parent's buyPrice to the sum of its components' buy prices
 * so inventory totals stay correct when a child's price is edited.
 */
export function syncContainerBuyTotalsFromComponents(items: InventoryItem[]): InventoryItem[] {
  let anyChange = false;
  const next = items.map((item) => {
    if (!item.isPC && !item.isBundle) return item;
    const children = getComponentsForContainer(item, items);
    if (children.length === 0) return item;
    const sumBuy = roundMoney(children.reduce((s, c) => s + Number(c.buyPrice || 0), 0));
    if (roundMoney(Number(item.buyPrice || 0)) === sumBuy) return item;
    anyChange = true;
    return { ...item, buyPrice: sumBuy };
  });
  return anyChange ? next : items;
}
