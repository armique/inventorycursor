/**
 * Repair rows where Acquired (buyDate) is after Sold (sellDate) — impossible timeline.
 * Common after container buyDate sync used latest child date on already-sold bundles.
 */
import type { InventoryItem } from '../types';
import { getChildren } from '../services/financialAggregation';
import { isInventoryContainer } from './containerMembership';
import { toLocalCalendarDateKey } from './calendarDate';
import { resolveContainerAcquiredDateFromChildDates } from './backfillContainerBuyDates';

export type BuyDateRepairSample = {
  id: string;
  name: string;
  sellDate: string;
  buyDateBefore: string;
  buyDateAfter: string;
};

export function buyDateAfterSellDate(
  item: Pick<InventoryItem, 'buyDate' | 'sellDate'>
): boolean {
  const sell = toLocalCalendarDateKey(item.sellDate || '');
  const buy = toLocalCalendarDateKey(item.buyDate || '');
  return Boolean(sell && buy && buy > sell);
}

/** Pick a buyDate on or before sellDate for one row. */
export function repairBuyDateBeforeSellDate(
  item: InventoryItem,
  children: InventoryItem[] = []
): string {
  const sell = toLocalCalendarDateKey(item.sellDate || '');
  if (!sell) return toLocalCalendarDateKey(item.buyDate || '');

  if (children.length > 0) {
    const capped = resolveContainerAcquiredDateFromChildDates(
      children.map((c) => c.buyDate),
      { maxDate: sell }
    );
    if (capped && capped <= sell) return capped;
  }

  const buy = toLocalCalendarDateKey(item.buyDate || '');
  if (buy && buy <= sell) return buy;
  return sell;
}

export function countBuyDateAfterSellDate(items: InventoryItem[]): number {
  return items.filter((i) => buyDateAfterSellDate(i)).length;
}

export function repairImpossibleBuyDates(items: InventoryItem[]): {
  items: InventoryItem[];
  repairedCount: number;
  samples: BuyDateRepairSample[];
} {
  let repairedCount = 0;
  const samples: BuyDateRepairSample[] = [];

  const next = items.map((item) => {
    if (!buyDateAfterSellDate(item)) return item;

    const children =
      isInventoryContainer(item) || item.isPC || item.isBundle
        ? getChildren(item, items)
        : [];
    const buyDateAfter = repairBuyDateBeforeSellDate(item, children);
    const buyDateBefore = toLocalCalendarDateKey(item.buyDate || '');

    if (buyDateAfter === buyDateBefore) return item;

    repairedCount += 1;
    if (samples.length < 25) {
      samples.push({
        id: item.id,
        name: item.name,
        sellDate: toLocalCalendarDateKey(item.sellDate || ''),
        buyDateBefore,
        buyDateAfter,
      });
    }
    return { ...item, buyDate: buyDateAfter };
  });

  return { items: next, repairedCount, samples };
}
