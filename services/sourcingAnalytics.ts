import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';

export type CategoryRoiRow = {
  category: string;
  soldCount: number;
  avgMarginPct: number;
  avgProfit: number;
  avgDaysToSell: number;
};

export type StockGapSuggestion = {
  query: string;
  category: string;
  reason: string;
  avgSoldProfit: number;
};

/** Sourcing ROI from sold history (#39). */
export function computeCategoryRoi(items: InventoryItem[]): CategoryRoiRow[] {
  const map = new Map<string, { profits: number[]; margins: number[]; days: number[] }>();

  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    if (item.isPC || item.isBundle) continue;
    const buy = item.buyPrice || 0;
    const sell = item.sellPrice || 0;
    if (sell <= 0) continue;
    const profit = item.profit ?? sell - buy - (item.feeAmount || 0);
    const margin = buy > 0 ? ((sell - buy) / buy) * 100 : 0;
    const cat = item.subCategory || item.category || 'Other';
    const bucket = map.get(cat) || { profits: [], margins: [], days: [] };
    bucket.profits.push(profit);
    bucket.margins.push(margin);
    if (item.buyDate && item.sellDate) {
      const days = Math.max(
        0,
        Math.round((new Date(item.sellDate).getTime() - new Date(item.buyDate).getTime()) / 86400000)
      );
      bucket.days.push(days);
    }
    map.set(cat, bucket);
  }

  return Array.from(map.entries())
    .map(([category, b]) => ({
      category,
      soldCount: b.profits.length,
      avgProfit: b.profits.reduce((a, v) => a + v, 0) / b.profits.length,
      avgMarginPct: b.margins.reduce((a, v) => a + v, 0) / b.margins.length,
      avgDaysToSell: b.days.length ? b.days.reduce((a, v) => a + v, 0) / b.days.length : 0,
    }))
    .filter((r) => r.soldCount >= 2)
    .sort((a, b) => b.avgProfit - a.avgProfit);
}

/** Find categories you sell well but have low in-stock count (#41). */
export function suggestSimilarToMyStock(items: InventoryItem[], limit = 8): StockGapSuggestion[] {
  const roi = computeCategoryRoi(items);
  const inStockByCat = new Map<string, number>();
  for (const item of items) {
    if (item.status !== ItemStatus.IN_STOCK) continue;
    if (item.isPC || item.isBundle) continue;
    const cat = item.subCategory || item.category || 'Other';
    inStockByCat.set(cat, (inStockByCat.get(cat) || 0) + 1);
  }

  return roi
    .filter((r) => (inStockByCat.get(r.category) || 0) < 3)
    .slice(0, limit)
    .map((r) => ({
      category: r.category,
      query: r.category,
      avgSoldProfit: r.avgProfit,
      reason: `Strong seller (avg €${r.avgProfit.toFixed(0)} profit) — only ${inStockByCat.get(r.category) || 0} in stock`,
    }));
}
