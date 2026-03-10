/**
 * Track recently edited or viewed items in the admin panel.
 * Used for quick access dropdown in inventory.
 */
const STORAGE_KEY = 'inventory_recent_items';
const MAX_RECENT = 12;

export function getRecentItemIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentItemId(id: string): void {
  const current = getRecentItemIds();
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}
