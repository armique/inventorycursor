/**
 * Fill / repair Acquired (buyDate) on composed PC / Bundle / Mixed Bundle / Aufrustkit.
 *
 * Child dates: use the shared date when all match, otherwise the latest (kit complete).
 * Fallbacks when no child dates: container sellDate, then today.
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { isInventoryContainer } from './containerMembership';
import { todayLocalDateKey, toLocalCalendarDateKey } from './calendarDate';
import { getChildren } from '../services/financialAggregation';

/** @deprecated kept so factory-reset / clear-all still removes the old keys */
export const CONTAINER_BUY_DATE_BACKFILL_KEY = 'container_buy_date_backfill_v3';

function isBlankBuyDate(value: string | undefined | null): boolean {
  return !toLocalCalendarDateKey(value || '');
}

/**
 * Derive container Acquired from child buyDates.
 * - All parts share one date → use it.
 * - Parts differ → latest date (kit complete only when the last part arrived).
 * - When maxDate is set (sold row), never return a date after it.
 */
export function resolveContainerAcquiredDateFromChildDates(
  dates: (string | undefined | null)[],
  options?: { maxDate?: string | null }
): string {
  const keys = dates.map((d) => toLocalCalendarDateKey(d || '')).filter(Boolean);
  if (!keys.length) return '';

  const max = toLocalCalendarDateKey(options?.maxDate || '');
  const pool = max ? keys.filter((k) => k <= max) : keys;
  const working = pool.length ? pool : keys;

  const unique = [...new Set(working)];
  let resolved =
    unique.length === 1
      ? unique[0]!
      : working.reduce((a, b) => (a >= b ? a : b));

  if (max && resolved > max) return max;
  return resolved;
}

export function resolveContainerAcquiredDateFromChildren(
  children: InventoryItem[],
  options?: { maxDate?: string | null }
): string {
  return resolveContainerAcquiredDateFromChildDates(
    children.map((c) => c.buyDate),
    options
  );
}

/** Acquired date when composing a PC/bundle from parts (today only if no part has a date). */
export function containerAcquiredDateForCompose(parts: InventoryItem[]): string {
  return (
    resolveContainerAcquiredDateFromChildDates(parts.map((p) => p.buyDate)) ||
    todayLocalDateKey()
  );
}

export function resolveContainerAcquiredDate(
  container: InventoryItem,
  allItems: InventoryItem[]
): string {
  const children = getChildren(container, allItems);
  const fromParts = resolveContainerAcquiredDateFromChildren(children);
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

function isActiveContainer(item: InventoryItem): boolean {
  return (
    isInventoryContainer(item) &&
    item.status !== ItemStatus.SOLD &&
    item.status !== ItemStatus.TRADED &&
    item.status !== ItemStatus.GIFTED
  );
}

export function backfillContainerBuyDates(items: InventoryItem[]): {
  items: InventoryItem[];
  updatedCount: number;
} {
  let updatedCount = 0;
  const next = items.map((item) => {
    if (!isActiveContainer(item)) return item;

    const children = getChildren(item, items);
    const fromChildren = resolveContainerAcquiredDateFromChildren(children);
    const current = toLocalCalendarDateKey(item.buyDate || '');

    if (fromChildren) {
      if (current === fromChildren) return item;
      updatedCount += 1;
      return { ...item, buyDate: fromChildren };
    }

    if (!isBlankBuyDate(item.buyDate)) return item;

    const buyDate = resolveContainerAcquiredDate(item, items);
    if (!buyDate || current === buyDate) return item;
    updatedCount += 1;
    return { ...item, buyDate };
  });

  return { items: next, updatedCount };
}
