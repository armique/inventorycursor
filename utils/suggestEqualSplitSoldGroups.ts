import { ItemStatus, type InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { toLocalCalendarDateKey } from './calendarDate';
import type { RetroComposeKind } from './retroSoldCompose';

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
 */
export function suggestEqualSplitSoldGroups(items: InventoryItem[]): EqualSplitSoldGroup[] {
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
    const sorted = [...members].sort(
      (a, b) => Number(b.buyPrice || 0) - Number(a.buyPrice || 0) || a.name.localeCompare(b.name)
    );
    groups.push({
      id: `eqsplit-${day}-${priceStr}`,
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
