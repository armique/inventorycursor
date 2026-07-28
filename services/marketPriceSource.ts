/**
 * Priority resolution over market/'s Buy Helper quote bridge.
 * Per-channel priority (agreed): eBay sold median > eBay live > (caller falls back
 * to inventory comps when this returns null). Kleinanzeigen never has sold data,
 * so live is its only signal.
 */
import { fetchBuyHelperQuote, type MarketBuyHelperQuote, type MarketQuoteBucket } from './marketApi';

export type MarketPriceSource = 'ebay-sold' | 'ebay-live' | 'ka-live';

export type MarketPriceSignal = {
  source: MarketPriceSource;
  median: number;
  low: number | null;
  high: number | null;
  count: number;
};

export type ResolvedMarketPrices = {
  ebay: MarketPriceSignal | null;
  ka: MarketPriceSignal | null;
};

function toSignal(bucket: MarketQuoteBucket, source: MarketPriceSource): MarketPriceSignal | null {
  if (!bucket || bucket.median == null || bucket.count <= 0) return null;
  return { source, median: bucket.median, low: bucket.low, high: bucket.high, count: bucket.count };
}

/** Pure — no I/O. Applies the agreed per-channel priority to an already-fetched quote. */
export function resolveMarketPrices(quote: MarketBuyHelperQuote | null): ResolvedMarketPrices {
  if (!quote) return { ebay: null, ka: null };
  const ebay = toSignal(quote.ebaySold, 'ebay-sold') || toSignal(quote.ebayLive, 'ebay-live');
  const ka = toSignal(quote.kaLive, 'ka-live');
  return { ebay, ka };
}

/**
 * Fetches + resolves in one call. Never throws — a failed/unreachable market bridge
 * resolves to { ebay: null, ka: null } so callers fall back to inventory comps automatically.
 */
export async function fetchResolvedMarketPrices(
  query: string,
  opts?: {
    maxPrice?: number;
    minPrice?: number;
    enabledSmartFilters?: string[];
    includeCapacities?: string[];
    categoryId?: string;
    kaCategory?: string;
  },
): Promise<ResolvedMarketPrices> {
  try {
    const quote = await fetchBuyHelperQuote(query, opts);
    return resolveMarketPrices(quote);
  } catch {
    return { ebay: null, ka: null };
  }
}
