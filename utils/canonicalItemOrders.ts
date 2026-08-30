/**
 * Canonical eBay order indexing and item pipeline.
 * Guarantees zero flapping between page loads, cache snapshots, and remote updates.
 */
import { InventoryItem, TaxMode } from '../types';
import { applyCrucialRamInvoiceSaleFix } from './crucialRamInvoiceSaleFix';
import { applyAsusGtx1080RogStrixHubSaleFix } from './asusGtx1080RogStrixHubSaleFix';
import { applyRx6500XtHubSellSync } from './rx6500XtHubSellSync';
import { applySamsungEvo840RefundResale } from './applySamsungEvo840RefundResale';
import { backfillContainerBuyDates } from './backfillContainerBuyDates';
import { healActiveContainerPartMembership } from './healActiveContainerPartMembership';
import { restoreIntegralRamKit } from './restoreIntegralRamKit';
import { restoreAsusA320mPcSale } from './restoreAsusA320mPcSale';

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

/**
 * Synchronous, deterministic data pipeline that transforms raw or cached inventory items
 * into their canonical state. Guarantees profit and pricing calculations are 100% identical
 * on initial render, cache hydration, and Supabase snapshot sync.
 */
export function canonicalizeInventoryItems(
  items: InventoryItem[],
  taxMode: TaxMode = 'SmallBusiness'
): { items: InventoryItem[]; changed: boolean } {
  let changedOverall = false;

  const { items: filledInv, updatedCount: filledCount } = backfillContainerBuyDates(items);
  if (filledCount > 0) changedOverall = true;

  const ramFix = applyCrucialRamInvoiceSaleFix(filledInv, taxMode);
  if (ramFix.changed) changedOverall = true;

  const asusFix = applyAsusGtx1080RogStrixHubSaleFix(ramFix.items, taxMode);
  if (asusFix.changed) changedOverall = true;

  const rxFix = applyRx6500XtHubSellSync(asusFix.items, taxMode);
  if (rxFix.changed) changedOverall = true;

  const evoFix = applySamsungEvo840RefundResale(rxFix.items, taxMode);
  if (evoFix.changed) changedOverall = true;

  const healed = healActiveContainerPartMembership(evoFix.items);
  if (healed.changed) changedOverall = true;

  return {
    items: healed.items,
    changed: changedOverall,
  };
}
