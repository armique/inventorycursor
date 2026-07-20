/**
 * Fill empty Acquired (buyDate) on composed PC / Bundle / Mixed Bundle / Aufrustkit.
 *
 * Prefer the latest child buyDate (when the kit could first be complete).
 * Fallbacks: container sellDate, then today.
 *
 * Runs continuously whenever blank container dates remain (not a one-shot flag),
 * so cloud snapshots that wipe local fills get corrected again.
 */
import type { InventoryItem } from '../types';
import { isInventoryContainer } from './containerMembership';
import { todayLocalDateKey, toLocalCalendarDateKey } from './calendarDate';
import { getChildren } from '../services/financialAggregation';

/** @deprecated kept so factory-reset / clear-all still removes the old keys */
export const CONTAINER_BUY_DATE_BACKFILL_KEY = 'container_buy_date_backfill_v3';

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

export function countBlankContainerBuyDates(items: InventoryItem[]): number {
  return items.filter((item) => isInventoryContainer(item) && isBlankBuyDate(item.buyDate)).length;
}

/**
 * When cloud remote wins but has no Acquired date, keep a filled local container date
 * so sync does not erase a just-backfilled composition date.
 */
export function preferFilledContainerBuyDate(
  remote: InventoryItem,
  local: InventoryItem | undefined
): InventoryItem {
  if (!local) return remote;
  if (!isInventoryContainer(remote) && !isInventoryContainer(local)) return remote;
  if (!isBlankBuyDate(remote.buyDate)) return remote;
  const localDate = toLocalCalendarDateKey(local.buyDate || '');
  if (!localDate) return remote;
  return { ...remote, buyDate: localDate };
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
