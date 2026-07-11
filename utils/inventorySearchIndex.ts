import type { InventoryItem } from '../types';

export type SearchHit = { item: InventoryItem; score: number };

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function haystack(item: InventoryItem): string {
  const specs = item.specs ? Object.entries(item.specs).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  return [
    item.name,
    item.category,
    item.subCategory,
    item.comment1,
    item.comment2,
    item.vendor,
    item.ebaySku,
    item.ebayOrderId,
    item.invoiceNumber,
    item.customer?.name,
    item.customer?.email,
    specs,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** True when every query token appears in the item name/specs haystack (AND match). */
export function matchesInventorySearch(item: InventoryItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return true;
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const text = haystack(item);
  return tokens.every((t) => text.includes(t));
}

/** Lightweight in-memory search index (#11). */
export function searchInventory(items: InventoryItem[], query: string, limit = 80): SearchHit[] {
  const tokens = tokenize(query.trim());
  if (tokens.length === 0) return items.slice(0, limit).map((item) => ({ item, score: 0 }));

  const hits: SearchHit[] = [];
  for (const item of items) {
    if (!matchesInventorySearch(item, query)) continue;
    const text = haystack(item);
    let score = 0;
    for (const t of tokens) {
      if (item.name.toLowerCase().includes(t)) score += 4;
      if (text.includes(t)) score += 1;
    }
    hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
