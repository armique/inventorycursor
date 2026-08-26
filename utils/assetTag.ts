/**
 * Short sequential asset tags (AT-0001, AT-0002, ...) — one per item, embedded at the end
 * of the eBay listing title so a buyer/return references the exact physical unit when you
 * have 2+ similar or identical items in stock. See types.ts InventoryItem.assetTag.
 */
import type { InventoryItem } from '../types';

const ASSET_TAG_RE = /^AT-(\d+)$/;

export function formatAssetTag(n: number): string {
  return `AT-${String(n).padStart(4, '0')}`;
}

/** Highest tag number in use across active items + trash (never reuse a number). */
export function maxAssetTagNumber(items: InventoryItem[], trash?: InventoryItem[]): number {
  let max = 0;
  for (const item of [...items, ...(trash || [])]) {
    const m = item.assetTag && ASSET_TAG_RE.exec(item.assetTag);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** Next unused tag, scanning both active items and trash. For single-item assigns; when
 *  assigning many at once in a loop, call maxAssetTagNumber() once and increment locally. */
export function nextAssetTag(items: InventoryItem[], trash?: InventoryItem[]): string {
  return formatAssetTag(maxAssetTagNumber(items, trash) + 1);
}

/** Appends " [AT-0421]" to a title, trimming the title first if it would exceed maxLen. */
export function appendAssetTagToTitle(title: string, assetTag: string | undefined, maxLen = 80): string {
  const t = title.trim();
  if (!assetTag) return t;
  const suffix = ` [${assetTag}]`;
  if (t.includes(suffix.trim())) return t;
  const budget = maxLen - suffix.length;
  const base = budget > 0 && t.length > budget ? t.slice(0, budget).trimEnd() : t;
  return `${base}${suffix}`;
}
