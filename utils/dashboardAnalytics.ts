import type { InventoryItem, Expense } from '../types';
import { ItemStatus } from '../types';
import { computeItemProfitBeforeOverhead, shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';

export type DateRange = { start: Date; end: Date };

export function filterByDateRange(iso: string | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

export function profitByPlatform(items: InventoryItem[], range: DateRange) {
  const map = new Map<string, { revenue: number; profit: number; count: number }>();
  for (const i of items) {
    if (i.status !== ItemStatus.SOLD || shouldSkipForAggregatedSaleLine(i, items)) continue;
    if (!filterByDateRange(i.sellDate, range)) continue;
    const key = i.platformSold || 'Unknown';
    const cur = map.get(key) || { revenue: 0, profit: 0, count: 0 };
    cur.revenue += Number(i.sellPrice || 0);
    cur.profit += computeItemProfitBeforeOverhead(i, items);
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.entries()].map(([platform, v]) => ({ platform, ...v }));
}

export function profitByCategoryTrend(items: InventoryItem[], range: DateRange) {
  const map = new Map<string, number>();
  for (const i of items) {
    if (i.status !== ItemStatus.SOLD || shouldSkipForAggregatedSaleLine(i, items)) continue;
    if (!filterByDateRange(i.sellDate, range)) continue;
    const cat = i.category || 'Other';
    map.set(cat, (map.get(cat) || 0) + computeItemProfitBeforeOverhead(i, items));
  }
  return [...map.entries()]
    .map(([category, profit]) => ({ category, profit }))
    .sort((a, b) => b.profit - a.profit);
}

export function daysInStockHistogram(items: InventoryItem[]) {
  const buckets = [
    { label: '0–14d', min: 0, max: 14, count: 0 },
    { label: '15–30d', min: 15, max: 30, count: 0 },
    { label: '31–60d', min: 31, max: 60, count: 0 },
    { label: '61–90d', min: 61, max: 90, count: 0 },
    { label: '90+d', min: 91, max: Infinity, count: 0 },
  ];
  const now = Date.now();
  for (const i of items) {
    if (i.status !== ItemStatus.IN_STOCK && i.status !== ItemStatus.IN_COMPOSITION) continue;
    const buy = new Date(i.buyDate).getTime();
    if (!Number.isFinite(buy)) continue;
    const days = Math.floor((now - buy) / 86400000);
    const b = buckets.find((x) => days >= x.min && days <= x.max);
    if (b) b.count += 1;
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}

export function sellThroughRate(items: InventoryItem[], range: DateRange) {
  const bought = items.filter((i) => filterByDateRange(i.buyDate, range)).length;
  const sold = items.filter(
    (i) => i.status === ItemStatus.SOLD && filterByDateRange(i.sellDate, range) && !shouldSkipForAggregatedSaleLine(i, items)
  ).length;
  return { bought, sold, rate: bought > 0 ? Math.round((sold / bought) * 100) : 0 };
}

export function inventoryValuation(items: InventoryItem[]) {
  let buyTotal = 0;
  let estSellTotal = 0;
  let count = 0;
  for (const i of items) {
    if (i.status !== ItemStatus.IN_STOCK) continue;
    buyTotal += Number(i.buyPrice || 0);
    estSellTotal += Number(i.sellPrice || i.buyPrice * 1.25 || 0);
    count += 1;
  }
  return { count, buyTotal, estSellTotal, potentialProfit: estSellTotal - buyTotal };
}

export function profitGoalProgress(items: InventoryItem[], expenses: Expense[], range: DateRange, goalProfit: number) {
  let profit = 0;
  for (const i of items) {
    if (i.status !== ItemStatus.SOLD || shouldSkipForAggregatedSaleLine(i, items)) continue;
    if (!filterByDateRange(i.sellDate, range)) continue;
    profit += computeItemProfitBeforeOverhead(i, items);
  }
  for (const e of expenses) {
    if (!filterByDateRange(e.date, range)) continue;
    profit -= Number(e.amount || 0);
  }
  return { profit, goal: goalProfit, pct: goalProfit > 0 ? Math.min(100, Math.round((profit / goalProfit) * 100)) : 0 };
}
