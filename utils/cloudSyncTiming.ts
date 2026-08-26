/**
 * Cloud / local persistence timing for inventory sync.
 * Discrete actions (compose, sell, trade, delete) request FAST_CLOUD_FLUSH_MS;
 * chatty edits use WRITE_DEBOUNCE_MS via the normal effect.
 */

/** Default background Firestore write after ordinary edits. */
export const WRITE_DEBOUNCE_MS = 200;

/** Compose / sell / trade / delete / bulk import — push immediately (0 = next tick). */
export const FAST_CLOUD_FLUSH_MS = 0;

/** localStorage snapshot after edits. */
export const LOCAL_PERSIST_DEBOUNCE_MS = 400;

/** Public storefront catalog rebuild. */
export const STORE_CATALOG_DEBOUNCE_MS = 1500;

/** Ignore remote snapshots briefly after a successful local push (echo suppression). */
export const REMOTE_APPLY_SUPPRESS_MS = 2000;

/** Longer debounce for large inventories so cloud I/O does not block the UI. */
export function inventoryCloudDebounceMs(itemCount: number): number {
  if (itemCount > 1500) return 2500;
  if (itemCount > 500) return 1200;
  if (itemCount > 100) return 600;
  return WRITE_DEBOUNCE_MS;
}

/**
 * If remote meta.updatedAt is newer than lastLocalPushAt by more than this,
 * treat it as another device/session and apply even when local has unsaved edits.
 */
export const REMOTE_ECHO_TOLERANCE_MS = 500;

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

/** Decide whether an incoming Firestore snapshot should replace local state. */
export function shouldAcceptRemoteSnapshot(args: {
  data: { updatedAt?: string } | null;
  remoteSnapshotSeen: boolean;
  lastLocalPushAt: number;
  suppressRemoteApplyUntil: number;
  cloudSyncInFlight: boolean;
  hasUnsavedChanges: boolean;
  now?: number;
}): boolean {
  const { data, remoteSnapshotSeen, lastLocalPushAt, suppressRemoteApplyUntil, cloudSyncInFlight, hasUnsavedChanges } =
    args;
  const now = args.now ?? Date.now();
  if (!data) return false;
  if (!remoteSnapshotSeen) return true;

  const remoteTs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
  const hasRemoteTs = Number.isFinite(remoteTs) && remoteTs > 0;

  // Another device or tab wrote after our last push — pull immediately.
  if (hasRemoteTs && remoteTs > lastLocalPushAt + REMOTE_ECHO_TOLERANCE_MS) {
    return !cloudSyncInFlight;
  }

  // Likely echo of our own write or concurrent local edits on this session.
  if (now < suppressRemoteApplyUntil) return false;
  if (cloudSyncInFlight) return false;
  if (hasUnsavedChanges) return false;
  return true;
}
