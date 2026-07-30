/**
 * Buy Helper Dealwatch history: fetch, store, and manage 30-day price history
 * for each tracked part from eBay (sold + live) and Kleinanzeigen (live).
 *
 * Stored in its own Firestore collection (users/{uid}/buyHelperPrices/{itemId}),
 * never in the syncPack — writeToCloud replaces the whole pack and would drop
 * inventory/expenses if used for a partial payload.
 */

import { type DealwatchQuoteBucket, fetchBuyHelperQuote } from './dealwatchApi';
import type { BuyHelperItem, BuyHelperCategory } from '../utils/buyHelper';
import { fetchBuyHelperPricesFromCloud, writeBuyHelperPricesToCloud } from './firebaseService';
import { shouldSkipCloudRefetch, markCloudRefetchDone } from '../utils/cloudFetchThrottle';

export type DealwatchSnapshot = {
  timestamp: string; // ISO 8601
  ebaySold: DealwatchQuoteBucket;
  ebayLive: DealwatchQuoteBucket;
  kaLive: DealwatchQuoteBucket;
};

export type BuyHelperPriceHistory = {
  itemId: string;
  query: string;
  category: BuyHelperCategory;
  /** Sorted ascending by timestamp, trimmed to the last 30 days. */
  history: DealwatchSnapshot[];
  createdAt: string;
  updatedAt: string;
};

export const PRICE_HISTORY_MAX_DAYS = 30;

/** Drop snapshots older than maxDays and keep the rest sorted oldest → newest. */
export function prunePriceHistory(
  history: DealwatchSnapshot[],
  maxDays = PRICE_HISTORY_MAX_DAYS,
): DealwatchSnapshot[] {
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return history
    .filter((s) => new Date(s.timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * The full listing arrays are only needed for the live "Check market" panel — storing
 * them for 30 days would blow past Firestore's 1 MiB per-document limit, so snapshots
 * keep the aggregates only.
 */
function stripItems(bucket: DealwatchQuoteBucket): DealwatchQuoteBucket {
  if (!bucket) return null;
  return { median: bucket.median, low: bucket.low, high: bucket.high, count: bucket.count, items: [] };
}

/** Fetch one Dealwatch snapshot for a tracked part. Returns null when the bridge has nothing. */
export async function fetchDealwatchSnapshot(item: BuyHelperItem): Promise<DealwatchSnapshot | null> {
  const quote = await fetchBuyHelperQuote(item.query);
  if (!quote) return null;
  return {
    timestamp: new Date().toISOString(),
    ebaySold: stripItems(quote.ebaySold),
    ebayLive: stripItems(quote.ebayLive),
    kaLive: stripItems(quote.kaLive),
  };
}

const PRICE_HISTORY_CACHE_KEY = 'dein_buy_helper_price_histories_cache_v1';
const PRICE_HISTORY_THROTTLE_ID = 'buyHelperPriceHistories';
const PRICE_HISTORY_THROTTLE_MS = 5 * 60 * 1000;

function readPriceHistoryCache(): Record<string, BuyHelperPriceHistory> | null {
  try {
    const raw = localStorage.getItem(PRICE_HISTORY_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BuyHelperPriceHistory>) : null;
  } catch {
    return null;
  }
}

function writePriceHistoryCache(histories: Record<string, BuyHelperPriceHistory>): void {
  try {
    localStorage.setItem(PRICE_HISTORY_CACHE_KEY, JSON.stringify(histories));
  } catch {
    /* ignore quota errors — cache is best-effort */
  }
}

/**
 * Fetch a fresh snapshot for every tracked item, append it to that item's history,
 * prune to 30 days, and persist all of them in one batched write.
 */
export async function fetchAndStoreBuyHelperDealwatch(
  items: BuyHelperItem[],
  existingHistories: Record<string, BuyHelperPriceHistory> = {},
): Promise<{ success: number; errors: string[] }> {
  const errors: string[] = [];
  const updated: BuyHelperPriceHistory[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    try {
      const snapshot = await fetchDealwatchSnapshot(item);
      if (!snapshot) {
        errors.push(`No data for "${item.query}"`);
        continue;
      }
      const existing = existingHistories[item.id];
      updated.push({
        itemId: item.id,
        query: item.query,
        category: item.category,
        history: prunePriceHistory([...(existing?.history ?? []), snapshot]),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    } catch (err) {
      errors.push(`"${item.query}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (updated.length) {
    await writeBuyHelperPricesToCloud(updated as unknown as (Record<string, unknown> & { itemId: string })[]);
    // Keep the local cache current so the next load (even within the throttle window) reflects
    // this fetch instead of serving up-to-5-minute-old data right after an explicit refresh.
    const merged = { ...(readPriceHistoryCache() ?? existingHistories) };
    for (const h of updated) merged[h.itemId] = h;
    writePriceHistoryCache(merged);
    markCloudRefetchDone(PRICE_HISTORY_THROTTLE_ID);
  }

  return { success: updated.length, errors };
}

/** Load every stored price history, keyed by Buy Helper item id. Cloud read is throttled —
 * this collection-wide fetch fires on every Buy Helper page mount, so a few minutes of
 * staleness against a local cache is the right tradeoff over re-scanning it every visit. */
export async function loadBuyHelperPriceHistories(): Promise<Record<string, BuyHelperPriceHistory>> {
  if (shouldSkipCloudRefetch(PRICE_HISTORY_THROTTLE_ID, PRICE_HISTORY_THROTTLE_MS)) {
    const cached = readPriceHistoryCache();
    if (cached) return cached;
  }
  const raw = await fetchBuyHelperPricesFromCloud();
  const result = (raw as Record<string, BuyHelperPriceHistory>) ?? {};
  markCloudRefetchDone(PRICE_HISTORY_THROTTLE_ID);
  writePriceHistoryCache(result);
  return result;
}
