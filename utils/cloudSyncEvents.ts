/** Fired after incremental inventory rows are acknowledged by Supabase. */
export const INVENTORY_CLOUD_SYNCED_EVENT = 'inventory-cloud-synced';

export type InventoryCloudSyncedDetail = {
  itemIds: string[];
};

export function dispatchInventoryCloudSynced(itemIds: string[]): void {
  if (typeof window === 'undefined') return;
  const ids = [...new Set(itemIds.map((id) => (id || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  window.dispatchEvent(
    new CustomEvent<InventoryCloudSyncedDetail>(INVENTORY_CLOUD_SYNCED_EVENT, {
      detail: { itemIds: ids },
    })
  );
}
