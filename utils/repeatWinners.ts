import { ItemStatus, type InventoryItem } from '../types';
import { roundMoney } from '../services/financialAggregation';

export type RepeatWinner = {
  key: string;
  label: string;
  soldCount: number;
  avgDays: number;
  avgMarginPct: number;
  avgProfit: number;
  inStock: number;
};

function groupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function daysBetween(buyDate?: string, sellDate?: string): number | null {
  if (!buyDate || !sellDate) return null;
  const a = new Date(buyDate).getTime();
  const b = new Date(sellDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Sold with >30% pocket margin in under 14 days — buy these again. */
export function computeRepeatWinners(items: InventoryItem[], limit = 8): RepeatWinner[] {
  const buckets = new Map<
    string,
    { label: string; days: number[]; margins: number[]; profits: number[] }
  >();
  const stock = new Map<string, number>();

  for (const item of items) {
    if (item.isPC || item.isBundle || item.isDraft) continue;
    const key = groupKey(item.name || '');
    if (key.length < 3) continue;
    if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) {
      stock.set(key, (stock.get(key) || 0) + 1);
      continue;
    }
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const days = daysBetween(item.buyDate, item.sellDate);
    const buy = Number(item.buyPrice) || 0;
    const sell = Number(item.sellPrice) || 0;
    const fee = Number(item.feeAmount) || 0;
    if (days == null || days > 14 || !(sell > 0) || !(buy > 0)) continue;
    const profit = sell - fee - buy;
    const margin = profit / sell;
    if (margin < 0.3) continue;
    const b = buckets.get(key) || { label: item.name, days: [], margins: [], profits: [] };
    if (item.name.length < b.label.length) b.label = item.name;
    b.days.push(days);
    b.margins.push(margin);
    b.profits.push(profit);
    buckets.set(key, b);
  }

  return Array.from(buckets.entries())
    .map(([key, b]) => ({
      key,
      label: b.label,
      soldCount: b.profits.length,
      avgDays: Math.round(b.days.reduce((s, n) => s + n, 0) / b.days.length),
      avgMarginPct: Math.round((b.margins.reduce((s, n) => s + n, 0) / b.margins.length) * 100),
      avgProfit: roundMoney(b.profits.reduce((s, n) => s + n, 0) / b.profits.length),
      inStock: stock.get(key) || 0,
    }))
    .filter((r) => r.soldCount >= 1)
    .sort((a, b) => b.soldCount - a.soldCount || b.avgProfit - a.avgProfit)
    .slice(0, limit);
}
