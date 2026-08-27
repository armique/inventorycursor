/**
 * Match inventory against the eBay order index (API sync + CSV import, Finanzamt fee split).
 */

import { InventoryItem, ItemStatus } from '../types';
import { loadEbayOrderIndex, type EbayOrderRecord } from './ebayOrderIndex';
import { buildOrderLinkAnalysis, type OrderLinkAnalysisResult } from '../utils/ebayOrderLinkAnalysis';

let cachedPeek: { key: string; result: OrderLinkAnalysisResult } | null = null;

function peekCacheKey(items: InventoryItem[], orderCount: number, ordersUpdatedAt: string): string {
  let inStock = 0;
  let unlinkedSold = 0;
  let linkedSold = 0;
  for (const item of items) {
    if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) inStock += 1;
    if (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) {
      if (item.ebayOrderId?.trim()) linkedSold += 1;
      else unlinkedSold += 1;
    }
  }
  return `${items.length}:${inStock}:${unlinkedSold}:${linkedSold}:${orderCount}:${ordersUpdatedAt}`;
}

export function invalidateEbaySalesSyncPeekCache(): void {
  cachedPeek = null;
}

export function loadOrdersForSalesSync(): EbayOrderRecord[] {
  return loadEbayOrderIndex().orders;
}

export interface EbaySalesSyncResult {
  analysis: OrderLinkAnalysisResult;
  fetch: null;
  fetchSkipped: boolean;
  fetchSkippedReason?: string;
}

/** Analyze inventory vs synced eBay orders. Fetching new orders is a separate action. */
export async function runEbaySalesSync(
  items: InventoryItem[],
  options?: {
    skipFetch?: boolean;
  }
): Promise<EbaySalesSyncResult> {
  const forLinking = loadOrdersForSalesSync();
  invalidateEbaySalesSyncPeekCache();
  const analysis = buildOrderLinkAnalysis(items, forLinking);
  return {
    analysis,
    fetch: null,
    fetchSkipped: true,
    fetchSkippedReason: options?.skipFetch ? 'Rematch only.' : 'Matching synced eBay orders.',
  };
}

/** Lightweight check for dashboard banner — cache only, no fetch. */
export function peekEbaySalesSync(items: InventoryItem[]): OrderLinkAnalysisResult {
  const apiMeta = loadEbayOrderIndex().meta;
  const forLinking = loadOrdersForSalesSync();
  const key = peekCacheKey(items, forLinking.length, apiMeta?.updatedAt || '');
  if (cachedPeek?.key === key) return cachedPeek.result;
  const result = buildOrderLinkAnalysis(items, forLinking);
  cachedPeek = { key, result };
  return result;
}
