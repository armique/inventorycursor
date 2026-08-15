import { ItemStatus, type InventoryItem } from '../types';
import { cheapSuggestLists } from './listingWatch';
import { itemAgeDays, itemPhotosReady } from './sellToday';

export type WeeklyLane = 'photos' | 'list' | 'drop';

export type StuckReason = 'no_photos' | 'not_listed' | 'price_high' | 'hold' | 'old';

export type StuckRow = {
  item: InventoryItem;
  ageDays: number;
  reason: StuckReason;
  label: string;
};

export function todaysWeeklyLane(now = new Date()): WeeklyLane | null {
  const dow = now.getDay();
  if (dow === 1) return 'photos';
  if (dow === 3) return 'list';
  if (dow === 6) return 'drop';
  return null;
}

export function weeklyLaneItems(items: InventoryItem[]): Record<WeeklyLane, InventoryItem[]> {
  const photos: InventoryItem[] = [];
  const list: InventoryItem[] = [];
  const drop: InventoryItem[] = [];
  for (const item of items) {
    if (item.status !== ItemStatus.IN_STOCK) continue;
    if (item.isDraft || item.isDefective || item.parentContainerId) continue;
    if (item.reserved) continue;
    const age = itemAgeDays(item);
    const photosOn = itemPhotosReady(item);
    const listed = Boolean(item.listedOnEbay || item.listedOnKleinanzeigen);
    if (!photosOn) photos.push(item);
    else if (!listed) list.push(item);
    else if (age >= 21) drop.push(item);
  }
  const byAge = (a: InventoryItem, b: InventoryItem) => itemAgeDays(b) - itemAgeDays(a);
  return {
    photos: photos.sort(byAge).slice(0, 8),
    list: list.sort(byAge).slice(0, 8),
    drop: drop.sort(byAge).slice(0, 8),
  };
}

export function stuckReason(item: InventoryItem, allItems: InventoryItem[]): StuckRow | null {
  if (item.status !== ItemStatus.IN_STOCK) return null;
  if (item.isDraft || item.isDefective || item.parentContainerId) return null;
  const age = itemAgeDays(item);
  if (item.reserved) {
    return { item, ageDays: age, reason: 'hold', label: 'On hold' };
  }
  if (!itemPhotosReady(item)) {
    return { item, ageDays: age, reason: 'no_photos', label: 'No photos' };
  }
  if (!item.listedOnEbay && !item.listedOnKleinanzeigen) {
    return { item, ageDays: age, reason: 'not_listed', label: 'Not on eBay / KA' };
  }
  const suggest = cheapSuggestLists(item, allItems);
  const live = item.liveEbayListPrice || item.liveKleinListPrice || item.sellPrice || 0;
  if (suggest && live > 0 && live > suggest.klein * 1.12) {
    return { item, ageDays: age, reason: 'price_high', label: `Ask above sold · drop to €${Math.round(suggest.klein)}` };
  }
  if (age >= 21) {
    return { item, ageDays: age, reason: 'old', label: `${age}d sitting` };
  }
  return null;
}

export function buildWhyNotSelling(items: InventoryItem[], limit = 10): StuckRow[] {
  const rows: StuckRow[] = [];
  for (const item of items) {
    const row = stuckReason(item, items);
    if (!row) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => b.ageDays - a.ageDays || a.reason.localeCompare(b.reason)).slice(0, limit);
}
