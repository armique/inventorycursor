/** Manual "needs review" flag on order-matcher rows — same localStorage pattern as
 *  orderMatcherIgnored.ts, keyed the same way (order-line key). Purely a user-set flag:
 *  nothing auto-flags itself. */
const STORAGE_KEY = 'order_matcher_needs_review_v1';

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string' && k.length > 0));
  } catch {
    return new Set();
  }
}

function writeSet(keys: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
}

export function getOrderMatcherNeedsReviewKeys(): Set<string> {
  return readSet();
}

export function isOrderMatcherNeedsReview(key: string): boolean {
  return readSet().has(key);
}

export function flagOrderMatcherNeedsReview(key: string): void {
  const next = readSet();
  next.add(key);
  writeSet(next);
}

export function unflagOrderMatcherNeedsReview(key: string): void {
  const next = readSet();
  next.delete(key);
  writeSet(next);
}

export function toggleOrderMatcherNeedsReview(key: string): boolean {
  const next = readSet();
  const nowFlagged = !next.has(key);
  if (nowFlagged) next.add(key);
  else next.delete(key);
  writeSet(next);
  return nowFlagged;
}

export function clearOrderMatcherNeedsReview(): void {
  localStorage.removeItem(STORAGE_KEY);
}
