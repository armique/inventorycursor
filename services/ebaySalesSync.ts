/**
 * Match inventory against the Seller Hub order archive (Finanzamt fee split).
 * New orders are fetched from Hub, not the Fulfillment API.
 */

import { InventoryItem, ItemStatus } from '../types';
import { loadEbayOrderIndex, type EbayOrderRecord } from './ebayOrderIndex';
import { loadHubArchiveIndex } from './ebayHubArchiveIndex';
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

/**
 * Hub dump is the sales ledger when loaded. API cache is only a fallback
 * before the first Hub JSON import.
 */
export function loadOrdersForSalesSync(): EbayOrderRecord[] {
  const hub = loadHubArchiveIndex().orders;
  if (hub.length) return hub;
  return loadEbayOrderIndex().orders;
}

export interface EbaySalesSyncResult {
  analysis: OrderLinkAnalysisResult;
  fetch: null;
  fetchSkipped: boolean;
  fetchSkippedReason?: string;
}

/** Analyze inventory vs Hub (or API fallback) orders. Fetching new Hub sales is a separate action. */
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
    fetchSkippedReason: options?.skipFetch
      ? 'Rematch only.'
      : 'Matching Hub ledger (use Fetch new Hub orders for new sales).',
  };
}

/** Lightweight check for dashboard banner — cache only, no scrape. */
export function peekEbaySalesSync(items: InventoryItem[]): OrderLinkAnalysisResult {
  const hub = loadHubArchiveIndex();
  const apiMeta = loadEbayOrderIndex().meta;
  const forLinking = loadOrdersForSalesSync();
  const key = peekCacheKey(items, forLinking.length, `${hub.meta.updatedAt || ''}|${apiMeta?.updatedAt || ''}`);
  if (cachedPeek?.key === key) return cachedPeek.result;
  const result = buildOrderLinkAnalysis(items, forLinking);
  cachedPeek = { key, result };
  return result;
}
