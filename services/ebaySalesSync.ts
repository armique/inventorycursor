/**
 * Incremental order fetch into the local/cloud cache, then analyze inventory vs orders.
 */

import { InventoryItem, ItemStatus } from '../types';
import { hasEbayToken } from './ebayService';
import { backfillEbayOrders, type BackfillProgress, type BackfillResult } from './ebayOrderBackfill';
import { getSuggestedBackfillRange, loadEbayOrderIndex } from './ebayOrderIndex';
import { buildOrderLinkAnalysis, type OrderLinkAnalysisResult } from '../utils/ebayOrderLinkAnalysis';

const DEFAULT_HISTORY_FROM = '2025-02-01';

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

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export interface EbaySalesSyncResult {
  analysis: OrderLinkAnalysisResult;
  fetch: BackfillResult | null;
  fetchSkipped: boolean;
  fetchSkippedReason?: string;
}

/** Pull new eBay orders into the cache (incremental when history exists), then match inventory. */
export async function runEbaySalesSync(
  items: InventoryItem[],
  options?: {
    onFetchProgress?: (p: BackfillProgress) => void;
    cancelToken?: { cancelled: boolean };
    skipFetch?: boolean;
  }
): Promise<EbaySalesSyncResult> {
  let fetch: BackfillResult | null = null;
  let fetchSkipped = false;
  let fetchSkippedReason: string | undefined;

  if (options?.skipFetch) {
    fetchSkipped = true;
    fetchSkippedReason = 'Fetch skipped.';
  } else if (!hasEbayToken()) {
    fetchSkipped = true;
    fetchSkippedReason = 'No eBay token — using cached orders only.';
  } else {
    const range = getSuggestedBackfillRange(DEFAULT_HISTORY_FROM, todayISO());
    // Skip only when resume window is empty (from after today). Same-day still fetches.
    if (range.isIncremental && range.from > range.to) {
      fetchSkipped = true;
      fetchSkippedReason = 'Order cache already up to date for today.';
    } else {
      fetch = await backfillEbayOrders(
        range.from,
        range.to,
        options?.onFetchProgress,
        options?.cancelToken
      );
      if (fetch) {
        fetch.from = range.from;
        fetch.to = range.to;
        fetch.isIncremental = range.isIncremental;
      }
    }
  }

  const { orders } = loadEbayOrderIndex();
  invalidateEbaySalesSyncPeekCache();
  const analysis = buildOrderLinkAnalysis(items, orders);

  return { analysis, fetch, fetchSkipped, fetchSkippedReason };
}

/** Lightweight check for dashboard banner — cache only, no API. */
export function peekEbaySalesSync(items: InventoryItem[]): OrderLinkAnalysisResult {
  const { orders, meta } = loadEbayOrderIndex();
  const key = peekCacheKey(items, orders.length, meta?.updatedAt || '');
  if (cachedPeek?.key === key) return cachedPeek.result;
  const result = buildOrderLinkAnalysis(items, orders);
  cachedPeek = { key, result };
  return result;
}
