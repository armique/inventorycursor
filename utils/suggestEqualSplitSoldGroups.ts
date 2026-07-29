import { ItemStatus, type InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { toLocalCalendarDateKey } from './calendarDate';
import type { RetroComposeKind } from './retroSoldCompose';

const IGNORED_EQUAL_SPLIT_KEY = 'inventory_ignored_equal_split_groups_v1';

export type EqualSplitSoldGroup = {
  id: string;
  sellDate: string;
  /** Per-component sell price that was split evenly (same on every member). */
  equalSellPrice: number;
  /** Sum of member sell prices = equalSellPrice × count (historical even split total). */
  totalSell: number;
  itemIds: string[];
  /** Suggested container kind from parts mix. */
  suggestedKind: RetroComposeKind;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Stable id for a date+price bucket (also used as ignore key). */
export function equalSplitGroupId(sellDate: string, equalSellPrice: number): string {
  return `eqsplit-${sellDate}-${round2(equalSellPrice).toFixed(2)}`;
}

export function loadIgnoredEqualSplitGroupIds(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_EQUAL_SPLIT_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function persistIgnoredEqualSplitGroupIds(ids: Set<string>): void {
  localStorage.setItem(IGNORED_EQUAL_SPLIT_KEY, JSON.stringify([...ids]));
}

/** Permanently hide a suggested equal-split group ("not a bundle"). */
export function ignoreEqualSplitGroupId(groupId: string): void {
  const next = loadIgnoredEqualSplitGroupIds();
  next.add(groupId);
  persistIgnoredEqualSplitGroupIds(next);
}

export function unignoreEqualSplitGroupId(groupId: string): void {
  const next = loadIgnoredEqualSplitGroupIds();
  if (!next.delete(groupId)) return;
  persistIgnoredEqualSplitGroupIds(next);
}

function isStandaloneSoldCandidate(item: InventoryItem): boolean {
  if (!isRealizedDisposal(item)) return false;
  if (item.isBundle || item.isPC) return false;
  if (item.parentContainerId) return false;
  if (item.status === ItemStatus.IN_COMPOSITION) return false;
  const sell = Number(item.sellPrice);
  if (!Number.isFinite(sell) || sell <= 0) return false;
  if (!item.sellDate) return false;
  return true;
}

function suggestKindFromParts(parts: InventoryItem[]): RetroComposeKind {
  const has = (sub: string, cat?: string) =>
    parts.some(
      (p) =>
        p.subCategory === sub ||
        p.category === sub ||
        (cat != null && p.category === cat)
    );
  const cpu = has('Processors') || parts.some((p) => /\b(i[3579]|ryzen|cpu)\b/i.test(p.name));
  const gpu =
    has('Graphics Cards') || parts.some((p) => /\b(rtx|gtx|rx\s*\d{3,4}|radeon|geforce)\b/i.test(p.name));
  const casePart = has('Cases') || parts.some((p) => /\b(case|gehäuse|chassis)\b/i.test(p.name));
  const mobo = has('Motherboards') || parts.some((p) => /\b(motherboard|mainboard|mobo)\b/i.test(p.name));

  if (casePart && cpu && gpu) return 'pc';
  if (cpu && (mobo || gpu)) return 'bundle';
  if (parts.length >= 4 && (cpu || gpu || mobo)) return 'pc';
  return 'bundle';
}

/**
 * Find historical sold rows that look like even-split PC/bundle sales:
 * same calendar sell date + identical sell price, 2+ standalone items.
 * Groups marked "not a bundle" (ignored) are omitted unless includeIgnored is set.
 */
export function suggestEqualSplitSoldGroups(
  items: InventoryItem[],
  options?: { includeIgnored?: boolean }
): EqualSplitSoldGroup[] {
  const ignored = options?.includeIgnored ? new Set<string>() : loadIgnoredEqualSplitGroupIds();
  const buckets = new Map<string, InventoryItem[]>();

  for (const item of items) {
    if (!isStandaloneSoldCandidate(item)) continue;
    const day = toLocalCalendarDateKey(item.sellDate!) || String(item.sellDate).slice(0, 10);
    if (!day) continue;
    const price = round2(Number(item.sellPrice));
    const key = `${day}|${price.toFixed(2)}`;
    const list = buckets.get(key) || [];
    list.push(item);
    buckets.set(key, list);
  }

  const groups: EqualSplitSoldGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const [day, priceStr] = key.split('|');
    const equalSellPrice = Number(priceStr);
    const id = equalSplitGroupId(day!, equalSellPrice);
    if (ignored.has(id)) continue;
    const sorted = [...members].sort(
      (a, b) => Number(b.buyPrice || 0) - Number(a.buyPrice || 0) || a.name.localeCompare(b.name)
    );
    groups.push({
      id,
      sellDate: day!,
      equalSellPrice,
      totalSell: round2(equalSellPrice * sorted.length),
      itemIds: sorted.map((m) => m.id),
      suggestedKind: suggestKindFromParts(sorted),
    });
  }

  return groups.sort((a, b) => {
    if (a.sellDate !== b.sellDate) return a.sellDate < b.sellDate ? 1 : -1;
    return b.itemIds.length - a.itemIds.length;
  });
}

export function countEqualSplitSoldGroupCandidates(items: InventoryItem[]): number {
  return suggestEqualSplitSoldGroups(items).length;
}
