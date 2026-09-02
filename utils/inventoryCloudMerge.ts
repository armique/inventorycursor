import { InventoryItem, ItemStatus } from '../types';

const DISPOSED = new Set<ItemStatus>([ItemStatus.SOLD, ItemStatus.TRADED, ItemStatus.GIFTED]);

function isDisposed(status: ItemStatus | undefined): boolean {
  return !!status && DISPOSED.has(status);
}

export function lastInventoryHistoryDate(item: InventoryItem): string {
  const hist = item.priceHistory || [];
  return hist.length ? String(hist[hist.length - 1]?.date || '') : '';
}

function remoteShowsRestocked(item: InventoryItem): boolean {
  if (isDisposed(item.status)) return false;
  if (/\[Returned /i.test(String(item.comment2 || ''))) return true;
  if ((item.ebaySaleCycles?.length || 0) > 0 && !(item.ebayOrderId || '').trim()) return true;
  return false;
}

/** Sold row that already carries restock markers — stale IndexedDB after a cloud unsold. */
export function localSoldLooksLikeStaleRestock(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD) return false;
  if (/\[Returned /i.test(String(item.comment2 || ''))) return true;
  if ((item.ebaySaleCycles || []).some((c) => c.reason === 'manual_unsold')) return true;
  return false;
}

/** Boot-time heal: flip impossible Sold+Returned rows back to Active before cloud reconcile. */
export function healStaleRestockedSoldRows(items: InventoryItem[]): {
  items: InventoryItem[];
  healedIds: string[];
} {
  const healedIds: string[] = [];
  const next = items.map((item) => {
    if (!localSoldLooksLikeStaleRestock(item)) return item;
    healedIds.push(item.id);
    return {
      ...item,
      status: ItemStatus.IN_STOCK,
      sellPrice: undefined,
      sellDate: undefined,
      profit: undefined,
      ebayOrderId: undefined,
      feeAmount: undefined,
      originalSellPrice: undefined,
      customer: undefined,
      ebayUsername: undefined,
    };
  });
  return { items: next, healedIds };
}

export type SoldActiveConflictOptions = {
  hasUnsavedLocal?: boolean;
  remoteUpdatedAt?: string;
  localUpdatedAt?: string;
};

/**
 * Local Sold vs remote Active (or the reverse): pick the side with the newer audit trail.
 * Never blindly keep stale local Sold when Supabase already restocked the row.
 */
export function pickNewerSoldActiveSide(
  local: InventoryItem,
  remote: InventoryItem,
  options?: SoldActiveConflictOptions
): 'local' | 'remote' {
  const localDisposed = isDisposed(local.status);
  const remoteDisposed = isDisposed(remote.status);
  if (localDisposed === remoteDisposed) return 'remote';

  const localIsSold = localDisposed;
  const soldSide = localIsSold ? local : remote;
  const activeSide = localIsSold ? remote : local;

  if (/\[Sale restored /i.test(String(remote.comment2 || '')) && remoteDisposed) {
    return 'remote';
  }

  if (localIsSold && localSoldLooksLikeStaleRestock(soldSide) && !options?.hasUnsavedLocal) {
    return 'remote';
  }

  const localTs = lastInventoryHistoryDate(local);
  const remoteTs = lastInventoryHistoryDate(remote);
  const remoteAt = options?.remoteUpdatedAt ? Date.parse(options.remoteUpdatedAt) : NaN;
  const localAt = options?.localUpdatedAt ? Date.parse(options.localUpdatedAt) : NaN;
  const remoteManifestNewer =
    Number.isFinite(remoteAt) && Number.isFinite(localAt) && remoteAt > localAt + 500;

  if (!options?.hasUnsavedLocal && remoteShowsRestocked(activeSide)) {
    if (remoteManifestNewer || !localTs || (remoteTs && remoteTs >= localTs)) {
      return 'remote';
    }
  }

  if (options?.hasUnsavedLocal) {
    if (localTs && (!remoteTs || localTs >= remoteTs)) return 'local';
    return 'remote';
  }

  if (remoteTs && (!localTs || remoteTs > localTs)) return 'remote';
  if (localTs && (!remoteTs || localTs > remoteTs)) return 'local';

  if (remoteManifestNewer) return 'remote';
  if (localIsSold && remoteShowsRestocked(activeSide)) return 'remote';
  return localIsSold ? 'local' : 'remote';
}

/** Skip a remote row when our manifest proves the server copy is older than what we already have. */
export function isRemoteInventoryRowStale(
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | undefined
): boolean {
  if (!localUpdatedAt || !remoteUpdatedAt) return false;
  return remoteUpdatedAt < localUpdatedAt;
}

export type InventoryPairMergeOptions = {
  remoteUpdatedAt?: string;
  localUpdatedAt?: string;
  /** When true, never drop a remote row purely for being older — local edits may not be pushed yet. */
  hasUnsavedLocal?: boolean;
};

/**
 * Merge one remote inventory row into local state.
 * Sale/restock safety rules override updated_at; otherwise newest updated_at wins.
 * Returns null when the remote row should be ignored (stale echo).
 */
export function mergeIncomingInventoryRow(
  local: InventoryItem | undefined,
  remote: InventoryItem,
  mergePair: (remoteList: InventoryItem[], localList: InventoryItem[]) => InventoryItem[],
  options?: InventoryPairMergeOptions
): InventoryItem | null {
  if (!local) return remote;

  const localDisposed = isDisposed(local.status);
  const remoteDisposed = isDisposed(remote.status);

  if (localDisposed !== remoteDisposed) {
    const winner = pickNewerSoldActiveSide(local, remote, {
      hasUnsavedLocal: options?.hasUnsavedLocal,
      remoteUpdatedAt: options?.remoteUpdatedAt,
      localUpdatedAt: options?.localUpdatedAt,
    });
    if (winner === 'local') {
      return mergePair([remote], [local])[0] ?? local;
    }
    return mergePair([remote], [local])[0] ?? remote;
  }

  if (
    !options?.hasUnsavedLocal &&
    isRemoteInventoryRowStale(options?.localUpdatedAt, options?.remoteUpdatedAt)
  ) {
    return null;
  }

  return mergePair([remote], [local])[0] ?? remote;
}

/** Apply an incremental inventory delta onto a flat local item list. */
export function applyInventoryDelta(
  localItems: InventoryItem[],
  changed: InventoryItem[],
  deletedIds: string[],
  mergePair: (remoteList: InventoryItem[], localList: InventoryItem[]) => InventoryItem[],
  options?: {
    localUpdatedAtById?: ReadonlyMap<string, string>;
    remoteUpdatedAtById?: ReadonlyMap<string, string>;
    hasUnsavedLocal?: boolean;
    /** Locally deleted ids — ignore remote upserts until server confirms deletion. */
    excludeIds?: ReadonlySet<string>;
  }
): InventoryItem[] {
  const deleted = new Set(deletedIds);
  const exclude = options?.excludeIds;
  const changedById = new Map(changed.map((row) => [row.id, row]));
  const out: InventoryItem[] = [];

  for (const local of localItems) {
    if (deleted.has(local.id)) continue;
    if (exclude?.has(local.id)) continue;
    const remote = changedById.get(local.id);
    if (!remote) {
      out.push(local);
      continue;
    }
    const merged = mergeIncomingInventoryRow(local, remote, mergePair, {
      localUpdatedAt: options?.localUpdatedAtById?.get(local.id),
      remoteUpdatedAt: options?.remoteUpdatedAtById?.get(local.id),
      hasUnsavedLocal: options?.hasUnsavedLocal,
    });
    if (merged) out.push(merged);
    else out.push(local);
    changedById.delete(local.id);
  }

  for (const remote of changedById.values()) {
    if (exclude?.has(remote.id)) continue;
    out.push(remote);
  }

  return out;
}
