import type { InventoryItem } from '../types';

export type SearchHit = { item: InventoryItem; score: number };

/** Split query into AND-tokens; URL punctuation so pasted profile links match by userId. */
function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;/?&=]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== 'https:' && t !== 'http:');
}

/** Kleinanzeigen seller list URLs look like …/s-bestandsliste.html?userId=12345678 */
export function extractKleinanzeigenUserId(url: string): string | null {
  const m = (url || '').match(/[?&]userId=(\d+)/i);
  return m?.[1] ?? null;
}

function profileHaystackParts(item: InventoryItem): string[] {
  const url = (item.kleinanzeigenSellerProfileUrl || '').trim();
  if (!url) return [];
  const parts = [url];
  const userId = extractKleinanzeigenUserId(url);
  if (userId) {
    parts.push(userId, `userid=${userId}`);
  }
  return parts;
}

/**
 * QW6: haystacks are pure functions of the item object, and item edits always replace the
 * object (React immutable updates), so cache per object identity instead of rebuilding the
 * string for every item on every keystroke.
 */
const haystackCache = new WeakMap<InventoryItem, string>();

function haystack(item: InventoryItem): string {
  const cached = haystackCache.get(item);
  if (cached !== undefined) return cached;
  const specs = item.specs ? Object.entries(item.specs).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  const text = [
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
    ...profileHaystackParts(item),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  haystackCache.set(item, text);
  return text;
}

/**
 * QW6: tokenize the query once per filter pass instead of once per item.
 * Same semantics as matchesInventorySearch(item, rawQuery) for every item.
 */
export function buildInventorySearchMatcher(rawQuery: string): (item: InventoryItem) => boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return () => true;
  const tokens = tokenize(query);
  if (tokens.length === 0) return () => true;
  return (item) => {
    const text = haystack(item);
    return tokens.every((t) => text.includes(t));
  };
}

/** True when every query token appears in the item name/specs/profile haystack (AND match). */
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
    const profileUrl = (item.kleinanzeigenSellerProfileUrl || '').toLowerCase();
    const profileUserId = extractKleinanzeigenUserId(item.kleinanzeigenSellerProfileUrl || '');
    let score = 0;
    for (const t of tokens) {
      if (item.name.toLowerCase().includes(t)) score += 4;
      if (profileUserId && t === profileUserId) score += 6;
      else if (profileUrl && profileUrl.includes(t)) score += 3;
      if (text.includes(t)) score += 1;
    }
    hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
