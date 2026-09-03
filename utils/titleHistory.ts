import type { InventoryItem, TitleHistoryEntry } from '../types';

function norm(s: string | undefined | null): string {
  return (s || '').trim();
}

export function appendTitleHistoryIfChanged(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem
): InventoryItem {
  if (!oldItem || oldItem.id !== newItem.id) return newItem;

  const entries: TitleHistoryEntry[] = [...(newItem.titleHistory || [])];
  const now = new Date().toISOString();
  let changed = false;

  const pairs: Array<{ field: TitleHistoryEntry['field']; prev: string; next: string }> = [
    { field: 'name', prev: norm(oldItem.name), next: norm(newItem.name) },
    {
      field: 'marketTitle',
      prev: norm(oldItem.marketTitle),
      next: norm(newItem.marketTitle),
    },
  ];

  for (const { field, prev, next } of pairs) {
    if (!next || prev === next) continue;
    entries.push({
      date: now,
      field,
      title: next,
      previousTitle: prev || undefined,
    });
    changed = true;
  }

  if (!changed) return newItem;
  return { ...newItem, titleHistory: entries.slice(-40) };
}

export function listTitleHistory(
  item: InventoryItem,
  field?: TitleHistoryEntry['field']
): TitleHistoryEntry[] {
  const rows = item.titleHistory || [];
  return field ? rows.filter((r) => r.field === field) : rows;
}
