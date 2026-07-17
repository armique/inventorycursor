import { InventoryItem, ItemStatus } from '../types';

export interface SoldPriceBand {
  count: number;
  low: number;
  high: number;
  median: number;
  average: number;
  samples: Array<{ id: string; name: string; sellPrice: number; sellDate?: string }>;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Token overlap score 0–1 between query name and an inventory item. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function medianOf(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Price band from your own sold inventory — similar names (and optional same subcategory).
 * Prefer this over AI when you already have comps in stock history.
 */
export function getInventorySoldPriceBand(
  items: InventoryItem[],
  name: string,
  opts?: { category?: string; subCategory?: string; minSimilarity?: number; limit?: number }
): SoldPriceBand | null {
  const q = name.trim();
  if (q.length < 3) return null;
  const minSim = opts?.minSimilarity ?? 0.35;
  const limit = opts?.limit ?? 12;

  const scored = items
    .filter(
      (i) =>
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
        typeof i.sellPrice === 'number' &&
        i.sellPrice > 0 &&
        !i.isPC &&
        !i.isBundle
    )
    .map((i) => {
      let sim = nameSimilarity(q, i.name);
      if (opts?.subCategory && i.subCategory === opts.subCategory) sim += 0.15;
      else if (opts?.category && i.category === opts.category) sim += 0.08;
      return { item: i, sim: Math.min(1, sim) };
    })
    .filter((x) => x.sim >= minSim)
    .sort((a, b) => b.sim - a.sim || (b.item.sellPrice || 0) - (a.item.sellPrice || 0))
    .slice(0, limit);

  if (!scored.length) return null;

  const prices = scored.map((x) => x.item.sellPrice as number);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const average = prices.reduce((s, p) => s + p, 0) / prices.length;
  const median = medianOf(prices);

  return {
    count: prices.length,
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    median: Math.round(median * 100) / 100,
    average: Math.round(average * 100) / 100,
    samples: scored.map((x) => ({
      id: x.item.id,
      name: x.item.name,
      sellPrice: x.item.sellPrice as number,
      sellDate: x.item.sellDate,
    })),
  };
}
