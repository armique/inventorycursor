/**
 * Cloud / local persistence timing for inventory sync.
 * Discrete actions (compose, sell, trade, delete) request FAST_CLOUD_FLUSH_MS;
 * chatty edits use WRITE_DEBOUNCE_MS via the normal effect.
 */

/** Default background Firestore write after ordinary edits. */
export const WRITE_DEBOUNCE_MS = 1000;

/** Compose / sell / trade / delete / bulk import — feel snappy without hammering every keystroke. */
export const FAST_CLOUD_FLUSH_MS = 400;

/** localStorage snapshot after edits. */
export const LOCAL_PERSIST_DEBOUNCE_MS = 400;

/** Public storefront catalog rebuild. */
export const STORE_CATALOG_DEBOUNCE_MS = 1500;

/** Ignore remote snapshots briefly after a successful local push. */
export const REMOTE_APPLY_SUPPRESS_MS = 1500;

/** @deprecated alias — same as FAST_CLOUD_FLUSH_MS */
export const BULK_IMPORT_SYNC_FLUSH_MS = FAST_CLOUD_FLUSH_MS;

/**
 * Pick the flush delay for the next scheduled cloud write.
 * A pending "fast" request must win over the default debounce.
 */
export function resolveCloudFlushDelay(
  preferredMs: number | null | undefined,
  defaultMs: number = WRITE_DEBOUNCE_MS
): number {
  if (preferredMs == null || Number.isNaN(Number(preferredMs))) return defaultMs;
  return Math.min(defaultMs, Math.max(0, Math.floor(preferredMs)));
}

/** True when an update should sync sooner than the default debounce. */
export function shouldFlushCloudSoon(args: {
  flushCloud?: boolean;
  deleteIds?: string[];
  createdContainers?: boolean;
  statusTransition?: boolean;
}): boolean {
  return Boolean(
    args.flushCloud ||
      (args.deleteIds && args.deleteIds.length > 0) ||
      args.createdContainers ||
      args.statusTransition
  );
}
