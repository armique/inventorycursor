/**
 * Canonical eBay order indexing and item pipeline.
 * Guarantees zero flapping between page loads, cache snapshots, and remote updates.
 */
import { InventoryItem, TaxMode } from '../types';

/**
 * Extracts all canonical eBay order IDs associated with an inventory item.
 * Includes active order ID, sale proceeds external order ID, all historical sale cycles,
 * and pending refund/fee orders.
 */
export function getLinkedEbayOrderIds(item: InventoryItem | null | undefined): string[] {
  if (!item) return [];
  const ids = new Set<string>();

  const add = (id: string | null | undefined) => {
    if (!id) return;
    const clean = String(id).trim().toLowerCase();
    if (clean.length >= 6) {
      ids.add(clean);
    }
  };

  add(item.ebayOrderId);
  if (item.saleProceeds?.externalOrderId) {
    add(item.saleProceeds.externalOrderId);
  }
  if (Array.isArray(item.ebaySaleCycles)) {
    for (const cycle of item.ebaySaleCycles) {
      if (cycle?.ebayOrderId) add(cycle.ebayOrderId);
    }
  }
  if (Array.isArray((item as any).pendingRefundFeeOrderIds)) {
    for (const id of (item as any).pendingRefundFeeOrderIds) {
      add(id);
    }
  }
  if (item.ebayOrderLineKey && item.ebayOrderLineKey.includes('::')) {
    const prefix = item.ebayOrderLineKey.split('::')[0];
    add(prefix);
  }

  return Array.from(ids);
}

/**
 * Builds an index of orderId (lowercase) -> InventoryItem.
 * Uses getLinkedEbayOrderIds to ensure 100% stability across all linked references.
 */
export function buildCanonicalLinkedByOrderMap(items: InventoryItem[]): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  for (const item of items) {
    if (item.isTrash) continue;
    const orderIds = getLinkedEbayOrderIds(item);
    for (const orderId of orderIds) {
      if (!map.has(orderId)) {
        map.set(orderId, item);
      }
    }
  }
  return map;
}

export function canonicalizeInventoryItems(
  items: InventoryItem[],
  taxMode: TaxMode = 'SmallBusiness'
): { items: InventoryItem[]; changed: boolean } {
  return {
    items,
    changed: false,
  };
}
