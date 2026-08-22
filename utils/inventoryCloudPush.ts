/**
 * Detect when this device's inventory (especially sold/traded rows) is ahead of
 * the last Firestore snapshot so we schedule an upload instead of only merging locally.
 */
import { InventoryItem, ItemStatus } from '../types';

const DISPOSED = new Set<ItemStatus>([
  ItemStatus.SOLD,
  ItemStatus.TRADED,
  ItemStatus.GIFTED,
]);

function isDisposed(status: ItemStatus | undefined): boolean {
  return !!status && DISPOSED.has(status);
}

function saleSignature(item: InventoryItem): string {
  return [
    item.id,
    item.status,
    item.sellDate || '',
    String(item.sellPrice ?? ''),
    String(item.profit ?? ''),
  ].join(':');
}

/** True when local has sold/traded/gifted rows cloud still treats as active or missing. */
export function localInventoryAheadOfRemote(
  remoteList: InventoryItem[],
  localList: InventoryItem[]
): boolean {
  const remoteById = new Map<string, InventoryItem>();
  for (const row of remoteList) {
    if (row?.id) remoteById.set(row.id, row);
  }

  for (const local of localList) {
    if (!local?.id || !isDisposed(local.status)) continue;
    const remote = remoteById.get(local.id);
    if (!remote) return true;
    if (!isDisposed(remote.status)) return true;
    if (saleSignature(local) !== saleSignature(remote)) return true;
  }

  return false;
}
