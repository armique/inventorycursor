/**
 * localStorage helpers for storefront: wishlist and recently viewed.
 */

const WISHLIST_KEY = 'armiktech_wishlist';
const RECENTLY_VIEWED_KEY = 'armiktech_recently_viewed';
const MAX_RECENT = 6;

export function getWishlistIds(): string[] {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setWishlistIds(ids: string[]): void {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
  } catch {}
}

export function toggleWishlistId(id: string): boolean {
  const current = getWishlistIds();
  const has = current.includes(id);
  const next = has ? current.filter((x) => x !== id) : [...current, id];
  setWishlistIds(next);
  return !has;
}

export function getRecentlyViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewedId(id: string): void {
  const current = getRecentlyViewedIds();
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {}
}
