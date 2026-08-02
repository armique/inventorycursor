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

/**
 * Parts already inside a living PC/bundle — real ownership only.
 * Stale componentIds alone must NOT hide sold equal-split candidates.
 */
export function buildClaimedContainerPartIds(items: InventoryItem[]): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const claimed = new Set<string>();
  for (const row of items) {
    if (row.isBundle || row.isPC) continue;
    if (row.status === ItemStatus.IN_COMPOSITION) {
      claimed.add(row.id);
      continue;
    }
    const pid = row.parentContainerId;
    if (!pid) continue;
    const parent = byId.get(pid);
    if (parent && (parent.isPC || parent.isBundle)) claimed.add(row.id);
  }
  return claimed;
}

function isStandaloneSoldCandidate(item: InventoryItem, claimedPartIds: Set<string>): boolean {
  if (!isRealizedDisposal(item)) return false;
  if (item.isBundle || item.isPC) return false;
  if (item.parentContainerId) return false;
  if (item.status === ItemStatus.IN_COMPOSITION) return false;
  if (claimedPartIds.has(item.id)) return false;
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
 * True when a sold PC/bundle already owns most of this equal-split group
 * (children parentContainerId → container), so do not offer compose again.
 */
export function groupAlreadyComposedAsContainer(
  groupItemIds: string[],
  sellDate: string,
  items: InventoryItem[]
): boolean {
  if (groupItemIds.length < 2) return false;
  const day = toLocalCalendarDateKey(sellDate) || sellDate.slice(0, 10);
  const groupSet = new Set(groupItemIds);

  for (const row of items) {
    if (!row.isPC && !row.isBundle) continue;
    if (!isRealizedDisposal(row)) continue;
    const rowDay = toLocalCalendarDateKey(row.sellDate || '') || String(row.sellDate || '').slice(0, 10);
    if (rowDay && day && rowDay !== day) continue;

    const ownedIds = items
      .filter((i) => i.parentContainerId === row.id)
      .map((i) => i.id);
    // Only real ownership suppresses suggestions — stale componentIds alone do not.
    if (ownedIds.length < 2) continue;

    let overlap = 0;
    for (const id of ownedIds) {
      if (groupSet.has(id)) overlap += 1;
    }
    if (overlap >= 2 && overlap / groupItemIds.length >= 0.5) return true;
    if (overlap >= 2 && overlap / ownedIds.length >= 0.5) return true;
  }
  return false;
}

/**
 * Find historical sold rows that look like even-split PC/bundle sales:
 * same calendar sell date + identical sell price, 2+ standalone items.
 * Skips parts already inside a PC/bundle and groups already composed.
 * Groups marked "not a bundle" (ignored) are omitted unless includeIgnored is set.
 */
export function suggestEqualSplitSoldGroups(
  items: InventoryItem[],
  options?: { includeIgnored?: boolean }
): EqualSplitSoldGroup[] {
  const ignored = options?.includeIgnored ? new Set<string>() : loadIgnoredEqualSplitGroupIds();
  const claimedPartIds = buildClaimedContainerPartIds(items);
  const buckets = new Map<string, InventoryItem[]>();

  for (const item of items) {
    if (!isStandaloneSoldCandidate(item, claimedPartIds)) continue;
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
    const itemIds = sorted.map((m) => m.id);
    if (groupAlreadyComposedAsContainer(itemIds, day!, items)) continue;
    groups.push({
      id,
      sellDate: day!,
      equalSellPrice,
      totalSell: round2(equalSellPrice * sorted.length),
      itemIds,
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
