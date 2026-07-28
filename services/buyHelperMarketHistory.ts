/**
 * Buy Helper market history: fetch, store, and manage 30-day price history
 * for each tracked part from eBay (sold + live) and Kleinanzeigen (live).
 *
 * Stored in its own Firestore collection (users/{uid}/buyHelperPrices/{itemId}),
 * never in the syncPack — writeToCloud replaces the whole pack and would drop
 * inventory/expenses if used for a partial payload.
 */

import { type MarketQuoteBucket, fetchBuyHelperQuote } from './marketApi';
import type { BuyHelperItem, BuyHelperCategory } from '../utils/buyHelper';
import { fetchBuyHelperPricesFromCloud, writeBuyHelperPricesToCloud } from './firebaseService';

export type MarketSnapshot = {
  timestamp: string; // ISO 8601
  ebaySold: MarketQuoteBucket;
  ebayLive: MarketQuoteBucket;
  kaLive: MarketQuoteBucket;
};

export type BuyHelperPriceHistory = {
  itemId: string;
  query: string;
  category: BuyHelperCategory;
  /** Sorted ascending by timestamp, trimmed to the last 30 days. */
  history: MarketSnapshot[];
  createdAt: string;
  updatedAt: string;
};

export const PRICE_HISTORY_MAX_DAYS = 30;

/** Drop snapshots older than maxDays and keep the rest sorted oldest → newest. */
export function prunePriceHistory(
  history: MarketSnapshot[],
  maxDays = PRICE_HISTORY_MAX_DAYS,
): MarketSnapshot[] {
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
function stripItems(bucket: MarketQuoteBucket): MarketQuoteBucket {
  if (!bucket) return null;
  return { median: bucket.median, low: bucket.low, high: bucket.high, count: bucket.count, items: [] };
}

/** Fetch one market snapshot for a tracked part. Returns null when the bridge has nothing. */
export async function fetchMarketSnapshot(item: BuyHelperItem): Promise<MarketSnapshot | null> {
  const quote = await fetchBuyHelperQuote(item.query);
  if (!quote) return null;
  return {
    timestamp: new Date().toISOString(),
    ebaySold: stripItems(quote.ebaySold),
    ebayLive: stripItems(quote.ebayLive),
    kaLive: stripItems(quote.kaLive),
  };
}

/**
 * Fetch a fresh snapshot for every tracked item, append it to that item's history,
 * prune to 30 days, and persist all of them in one batched write.
 */
export async function fetchAndStoreBuyHelperMarkets(
  items: BuyHelperItem[],
  existingHistories: Record<string, BuyHelperPriceHistory> = {},
): Promise<{ success: number; errors: string[] }> {
  const errors: string[] = [];
  const updated: BuyHelperPriceHistory[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    try {
      const snapshot = await fetchMarketSnapshot(item);
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
  }

  return { success: updated.length, errors };
}

/** Load every stored price history, keyed by Buy Helper item id. */
export async function loadBuyHelperPriceHistories(): Promise<Record<string, BuyHelperPriceHistory>> {
  const raw = await fetchBuyHelperPricesFromCloud();
  return (raw as Record<string, BuyHelperPriceHistory>) ?? {};
}
