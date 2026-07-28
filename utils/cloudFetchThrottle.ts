/**
 * Throttle for background cloud "refresh a count/badge" reads that otherwise re-fetch a whole
 * collection on every page visit. Not for data the user explicitly asked to refresh (modals,
 * dedicated gallery/list pages) — only for passive background reads like inventory badges.
 */

function key(id: string): string {
  return `cloud_fetch_throttle_${id}`;
}

/** True when this id was marked done within the last `minIntervalMs` — caller should skip its cloud read. */
export function shouldSkipCloudRefetch(id: string, minIntervalMs: number): boolean {
  try {
    const last = Number(localStorage.getItem(key(id))) || 0;
    return Date.now() - last < minIntervalMs;
  } catch {
    return false;
  }
}

export function markCloudRefetchDone(id: string): void {
  try {
    localStorage.setItem(key(id), String(Date.now()));
  } catch {
    /* ignore */
  }
}
