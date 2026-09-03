/**
 * Detect when this device's inventory (especially sold/traded rows) is ahead of
 * the last Firestore snapshot so we schedule an upload instead of only merging locally.
 */
import { InventoryItem, ItemStatus, type Expense } from '../types';

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

/** Local rows that differ from the last cloud snapshot and should be upserted. */
export function inventoryItemsNeedingCloudPush(
  localList: InventoryItem[],
  remoteList: InventoryItem[]
): InventoryItem[] {
  const remoteById = new Map<string, InventoryItem>();
  for (const row of remoteList) {
    if (row?.id) remoteById.set(row.id, row);
  }
  const out: InventoryItem[] = [];
  for (const local of localList) {
    if (!local?.id) continue;
    const remote = remoteById.get(local.id);
    if (!remote || !itemContentUnchanged(local, remote)) out.push(local);
  }
  return out;
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

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Field-by-field compare used both for the whole-array gate below and for per-item merging. */
function itemContentUnchanged(a: InventoryItem, b: InventoryItem): boolean {
  if (a === b) return true;
  if (!a || !b || a.id !== b.id) return false;
  if (a.status !== b.status) return false;
  if (a.name !== b.name) return false;
  if (a.sellDate !== b.sellDate) return false;
  if (a.buyDate !== b.buyDate) return false;
  if (a.ebayOrderId !== b.ebayOrderId) return false;
  if (a.parentContainerId !== b.parentContainerId) return false;
  const aComps = [...(a.componentIds || [])].sort().join(',');
  const bComps = [...(b.componentIds || [])].sort().join(',');
  if (aComps !== bComps) return false;
  if ((a.imageUrl || '') !== (b.imageUrl || '')) return false;
  if (numOrNull(a.sellPrice) !== numOrNull(b.sellPrice)) return false;
  if (numOrNull(a.buyPrice) !== numOrNull(b.buyPrice)) return false;
  if (numOrNull(a.profit) !== numOrNull(b.profit)) return false;
  const ap = a.saleProceeds;
  const bp = b.saleProceeds;
  if ((ap?.source || '') !== (bp?.source || '')) return false;
  if (numOrNull(ap?.netPayoutEur) !== numOrNull(bp?.netPayoutEur)) return false;
  if (numOrNull(ap?.buyerTotalEur) !== numOrNull(bp?.buyerTotalEur)) return false;
  if (numOrNull(ap?.transactionFeeEur) !== numOrNull(bp?.transactionFeeEur)) return false;
  if (numOrNull(ap?.adFeeEur) !== numOrNull(bp?.adFeeEur)) return false;
  if (numOrNull(ap?.shippingLabelEur) !== numOrNull(bp?.shippingLabelEur)) return false;
  return true;
}

/** Rows that changed during handleUpdate and should be upserted to Supabase. */
export function collectItemsForIncrementalCloudPush(
  before: InventoryItem[],
  after: InventoryItem[],
  _explicitTouchedIds?: Iterable<string>
): InventoryItem[] {
  const beforeById = new Map(before.map((i) => [i.id, i]));
  const out: InventoryItem[] = [];
  for (const item of after) {
    const prev = beforeById.get(item.id);
    if (!prev) {
      out.push(item);
      continue;
    }
    // New object reference from handleUpdate means this row was touched (directly or by cascade).
    if (prev !== item || !itemContentUnchanged(item, prev)) {
      out.push(item);
    }
  }
  return out;
}

/** Item ids present before an edit but removed afterward (explicit deletes only). */
export function collectDeletedInventoryIds(before: InventoryItem[], after: InventoryItem[]): string[] {
  const afterIds = new Set(after.map((i) => i.id));
  return before.filter((i) => i.id && !afterIds.has(i.id)).map((i) => i.id);
}

/**
 * Cheap O(N) compare so a Firestore pull of data already on this device
 * does not rebuild the inventory list or stringify 1.5MiB on the main thread.
 */
export function inventoryLooksUnchanged(
  localList: InventoryItem[],
  remoteList: InventoryItem[]
): boolean {
  if (localList === remoteList) return true;
  if (localList.length !== remoteList.length) return false;
  for (let i = 0; i < localList.length; i++) {
    if (!itemContentUnchanged(localList[i], remoteList[i])) return false;
  }
  return true;
}

/**
 * Re-hydrating from IndexedDB (cross-tab sync, boot) always produces brand-new object
 * references for every item, even ones nothing touched. Replacing the whole array with
 * that wholesale breaks every useMemo/React.memo keyed on item identity and empties the
 * search haystack WeakMap cache (utils/inventorySearchIndex.ts) for all ~2000 items at
 * once — on a tab you're actively viewing, that shows up as a multi-second freeze.
 *
 * Keep the *existing* object reference for any item whose relevant fields didn't change,
 * so only the genuinely-edited rows (typically one) invalidate their memoized work.
 */
export function mergeItemsPreservingReferences(
  current: InventoryItem[],
  incoming: InventoryItem[]
): InventoryItem[] {
  const currentById = new Map<string, InventoryItem>();
  for (const item of current) {
    if (item?.id) currentById.set(item.id, item);
  }
  return incoming.map((next) => {
    const prev = currentById.get(next.id);
    return prev && itemContentUnchanged(prev, next) ? prev : next;
  });
}

/** Cheap compare so a matching cloud pull does not re-render expense lists. */
export function expenseListLooksUnchanged(localList: Expense[], remoteList: Expense[]): boolean {
  if (localList === remoteList) return true;
  if (localList.length !== remoteList.length) return false;
  for (let i = 0; i < localList.length; i++) {
    const a = localList[i];
    const b = remoteList[i];
    if (a === b) continue;
    if (!a || !b || a.id !== b.id) return false;
    if (a.amount !== b.amount || a.date !== b.date || a.category !== b.category) return false;
    if ((a.description || '') !== (b.description || '')) return false;
  }
  return true;
}
