/**
 * One-time backfill: composed PC / Bundle / Mixed Bundle / Aufrustkit containers
 * with empty Acquired (buyDate) get a date derived from their parts.
 *
 * Prefer the latest child buyDate (when the kit could first be complete).
 * Fallbacks: container sellDate, then today.
 */
import type { InventoryItem } from '../types';
import { isInventoryContainer } from './containerMembership';
import { todayLocalDateKey, toLocalCalendarDateKey } from './calendarDate';
import { getChildren } from '../services/financialAggregation';

export const CONTAINER_BUY_DATE_BACKFILL_KEY = 'container_buy_date_backfill_v2';

function isBlankBuyDate(value: string | undefined | null): boolean {
  return !toLocalCalendarDateKey(value || '');
}

/** Latest YYYY-MM-DD among values (lexicographic works for ISO dates). */
function latestDateKey(dates: string[]): string {
  const keys = dates.map((d) => toLocalCalendarDateKey(d)).filter(Boolean);
  if (!keys.length) return '';
  return keys.reduce((a, b) => (a >= b ? a : b));
}

export function resolveContainerAcquiredDate(
  container: InventoryItem,
  allItems: InventoryItem[]
): string {
  const children = getChildren(container, allItems);
  const fromParts = latestDateKey(children.map((c) => c.buyDate || ''));
  if (fromParts) return fromParts;

  const fromSale = toLocalCalendarDateKey(container.sellDate || '');
  if (fromSale) return fromSale;

  return todayLocalDateKey();
}

export function backfillContainerBuyDates(items: InventoryItem[]): {
  items: InventoryItem[];
  updatedCount: number;
} {
  let updatedCount = 0;
  const next = items.map((item) => {
    if (!isInventoryContainer(item)) return item;
    if (!isBlankBuyDate(item.buyDate)) return item;

    const buyDate = resolveContainerAcquiredDate(item, items);
    if (!buyDate) return item;
    updatedCount += 1;
    return { ...item, buyDate };
  });

  return { items: next, updatedCount };
}
