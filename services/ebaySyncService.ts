/**
 * eBay order sync on app load.
 * Fetches orders since last sync, matches by ebaySku, marks items sold, persists processed IDs.
 */

import { listEbayOrders } from './ebayService';
import type { EbayOrderSummary } from './ebayService';

export type { EbayOrderSummary };
import { InventoryItem, ItemStatus, CustomerInfo } from '../types';

const STORAGE_KEY_LAST_SYNC = 'ebay_sync_last_run';
const STORAGE_KEY_PROCESSED = 'ebay_sync_processed_order_ids';

export function getLastSyncTime(): number | null {
  const s = localStorage.getItem(STORAGE_KEY_LAST_SYNC);
  if (!s) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

export function setLastSyncTime(ts: number): void {
  localStorage.setItem(STORAGE_KEY_LAST_SYNC, String(ts));
}

export function getProcessedOrderIds(): Set<string> {
  const s = localStorage.getItem(STORAGE_KEY_PROCESSED);
  if (!s) return new Set();
  try {
    const arr = JSON.parse(s) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function addProcessedOrderId(id: string): void {
  const set = getProcessedOrderIds();
  set.add(id);
  localStorage.setItem(STORAGE_KEY_PROCESSED, JSON.stringify([...set]));
}

export interface MatchedResult {
  item: InventoryItem;
  order: EbayOrderSummary;
  lineItem: { sku: string | null; title: string; lineItemCost: number | null };
}

export interface SyncResult {
  matched: MatchedResult[];
  unmatched: EbayOrderSummary[];
  error?: string;
}

/**
 * Run eBay sync: fetch orders, match by SKU, return matched and unmatched.
 * Does NOT update inventory; caller applies updates via onUpdate.
 */
export async function runEbaySync(
  items: InventoryItem[]
): Promise<SyncResult> {
  const lastSync = getLastSyncTime();
  const processed = getProcessedOrderIds();

  const now = new Date();
  const toDate = now.toISOString().split('T')[0];
  const fromDate = lastSync
    ? new Date(lastSync - 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 1 day before last sync to avoid gaps
    : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 7 days ago

  const inStockBySku = new Map<string, InventoryItem>();
  items
    .filter((i) => i.status === ItemStatus.IN_STOCK && !i.isPC && !i.isBundle)
    .forEach((i) => {
      if (i.ebaySku) inStockBySku.set(i.ebaySku, i);
    });

  const matched: MatchedResult[] = [];
  const unmatched: EbayOrderSummary[] = [];

  try {
    const orders = await listEbayOrders(fromDate, toDate);

    for (const order of orders) {
      if (processed.has(order.orderId)) continue;

      let foundMatch = false;
      for (const line of order.lineItems) {
        const sku = line.sku?.trim();
        if (!sku) continue;
        const item = inStockBySku.get(sku);
        if (item) {
          matched.push({ item, order, lineItem: line });
          inStockBySku.delete(sku); // Avoid double-match if same SKU in multiple line items
          foundMatch = true;
        }
      }

      if (!foundMatch) {
        unmatched.push(order);
      }
    }

    return { matched, unmatched };
  } catch (e: any) {
    return { matched: [], unmatched: [], error: e?.message || 'Sync failed' };
  }
}

/**
 * Build the updated item for marking as sold (caller applies via onUpdate).
 */
export function buildSoldItem(
  item: InventoryItem,
  order: EbayOrderSummary,
  lineItem: { lineItemCost: number | null }
): InventoryItem {
  const sellPrice = lineItem.lineItemCost ?? 0;
  const fee = 0;
  const profit = sellPrice - item.buyPrice - fee;

  const customer: CustomerInfo = {
    name: order.buyer.fullName || order.buyer.username || '',
    address: order.buyer.address || '',
    ...(order.buyer.phone && { phone: order.buyer.phone }),
    ...(order.buyer.email && { email: order.buyer.email }),
  };

  return {
    ...item,
    status: ItemStatus.SOLD,
    sellPrice,
    sellDate: order.creationDate || new Date().toISOString().split('T')[0],
    platformSold: 'ebay.de',
    paymentType: 'ebay.de',
    profit: parseFloat(profit.toFixed(2)),
    customer,
    ebayUsername: order.buyer.username,
    ebayOrderId: order.orderId,
    hasFee: false,
    feeAmount: 0,
  };
}
