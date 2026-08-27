/** Manual "needs review" flag on order-matcher rows — same localStorage pattern as
 *  orderMatcherIgnored.ts, keyed the same way (order-line key). Purely a user-set flag:
 *  nothing auto-flags itself. Timestamped per key (not just a flat set) so it can be
 *  merged cloud-side with last-write-wins, the same way label overrides are — see
 *  services/ebayTransactionReportSync.ts. Unflagging keeps a `flagged: false` tombstone
 *  entry instead of deleting the key, otherwise a stale "flagged: true" from another
 *  device would win the next merge and silently re-flag it. */
export type NeedsReviewEntry = { flagged: boolean; updatedAt: string };

const STORAGE_KEY = 'order_matcher_needs_review_v2';

/** Fired whenever the flag map changes (local toggle or a cloud merge) — lets the order
 *  list re-read and show the flag icon without needing a shared React state tree between
 *  the picker and the list. */
export const NEEDS_REVIEW_CHANGED_EVENT = 'order-matcher-needs-review-changed';

function notifyChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NEEDS_REVIEW_CHANGED_EVENT));
}

function readMap(): Record<string, NeedsReviewEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, NeedsReviewEntry>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, NeedsReviewEntry>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getOrderMatcherNeedsReviewMap(): Record<string, NeedsReviewEntry> {
  return readMap();
}

export function getOrderMatcherNeedsReviewKeys(): Set<string> {
  const map = readMap();
  return new Set(Object.keys(map).filter((k) => map[k]?.flagged));
}

export function isOrderMatcherNeedsReview(key: string): boolean {
  return Boolean(readMap()[key]?.flagged);
}

export function flagOrderMatcherNeedsReview(key: string): void {
  const map = readMap();
  map[key] = { flagged: true, updatedAt: new Date().toISOString() };
  writeMap(map);
  notifyChanged();
}

export function unflagOrderMatcherNeedsReview(key: string): void {
  const map = readMap();
  map[key] = { flagged: false, updatedAt: new Date().toISOString() };
  writeMap(map);
  notifyChanged();
}

export function toggleOrderMatcherNeedsReview(key: string): boolean {
  const nowFlagged = !isOrderMatcherNeedsReview(key);
  if (nowFlagged) flagOrderMatcherNeedsReview(key);
  else unflagOrderMatcherNeedsReview(key);
  return nowFlagged;
}

export function clearOrderMatcherNeedsReview(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Merge a remote (cloud) needs-review map into the local one, newest `updatedAt` wins per key. */
export function mergeOrderMatcherNeedsReviewMap(remote: Record<string, NeedsReviewEntry>): void {
  if (!remote || typeof remote !== 'object') return;
  const local = readMap();
  const merged = { ...local };
  for (const [key, entry] of Object.entries(remote)) {
    if (!entry || typeof entry !== 'object') continue;
    const cur = merged[key];
    if (!cur || (entry.updatedAt || '') >= (cur.updatedAt || '')) merged[key] = entry;
  }
  writeMap(merged);
  notifyChanged();
}
