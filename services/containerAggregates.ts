import { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import {
  resolveContainerAcquiredDate,
  resolveContainerAcquiredDateFromChildren,
} from '../utils/backfillContainerBuyDates';
import { toLocalCalendarDateKey } from '../utils/calendarDate';

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

function updateTouchesContainers(items: InventoryItem[], updatedIds: Set<string>): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const componentIdsInContainers = new Set<string>();
  for (const row of items) {
    if (!row.isPC && !row.isBundle) continue;
    for (const cid of row.componentIds || []) componentIdsInContainers.add(cid);
  }
  for (const id of updatedIds) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.isPC || item.isBundle || item.parentContainerId) return true;
    if (item.componentIds && item.componentIds.length > 0) return true;
    if (componentIdsInContainers.has(id)) return true;
  }
  return false;
}

/**
 * Sets each PC/bundle parent's buyPrice to the sum of its components' buy prices
 * so inventory totals stay correct when a child's price is edited.
 */
export function syncContainerBuyTotalsFromComponents(
  items: InventoryItem[],
  updatedIds?: string[]
): InventoryItem[] {
  if (updatedIds?.length) {
    const idSet = new Set(updatedIds);
    if (!updateTouchesContainers(items, idSet)) return items;
  }
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

/**
 * Keep each PC/bundle Acquired (buyDate) aligned with its parts:
 * same date when all children match, otherwise the latest child date.
 */
export function syncContainerBuyDatesFromComponents(
  items: InventoryItem[],
  updatedIds?: string[]
): InventoryItem[] {
  if (updatedIds?.length) {
    const idSet = new Set(updatedIds);
    if (!updateTouchesContainers(items, idSet)) return items;
  }
  let anyChange = false;
  const next = items.map((item) => {
    if (!item.isPC && !item.isBundle) return item;
    if (
      item.status === ItemStatus.SOLD ||
      item.status === ItemStatus.TRADED ||
      item.status === ItemStatus.GIFTED
    ) {
      return item;
    }
    const children = getComponentsForContainer(item, items);
    if (children.length === 0) return item;

    const fromChildren = resolveContainerAcquiredDateFromChildren(children);
    const current = toLocalCalendarDateKey(item.buyDate || '');

    if (fromChildren) {
      if (current === fromChildren) return item;
      anyChange = true;
      return { ...item, buyDate: fromChildren };
    }

    if (current) return item;
    const fallback = resolveContainerAcquiredDate(item, items);
    if (!fallback || current === fallback) return item;
    anyChange = true;
    return { ...item, buyDate: fallback };
  });
  return anyChange ? next : items;
}
