/**
 * Incremental order fetch into the local/cloud cache, then analyze inventory vs orders.
 */

import { InventoryItem } from '../types';
import { backfillEbayOrders, type BackfillProgress, type BackfillResult } from './ebayOrderBackfill';
import {
  getSuggestedBackfillRange,
  loadEbayOrderIndex,
} from './ebayOrderIndex';
import { hasEbayToken } from './ebayService';
import {
  buildOrderLinkAnalysis,
  type OrderLinkAnalysisResult,
} from '../utils/ebayOrderLinkAnalysis';

const DEFAULT_HISTORY_FROM = '2025-02-01';

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
    if (range.isIncremental && range.from >= range.to) {
      fetchSkipped = true;
      fetchSkippedReason = 'Order cache already up to date for today.';
    } else {
      fetch = await backfillEbayOrders(
        range.from,
        range.to,
        options?.onFetchProgress,
        options?.cancelToken
      );
    }
  }

  const { orders } = loadEbayOrderIndex();
  const analysis = buildOrderLinkAnalysis(items, orders);

  return { analysis, fetch, fetchSkipped, fetchSkippedReason };
}

/** Lightweight check for dashboard banner — cache only, no API. */
export function peekEbaySalesSync(items: InventoryItem[]): OrderLinkAnalysisResult {
  const { orders } = loadEbayOrderIndex();
  return buildOrderLinkAnalysis(items, orders);
}
