/**
 * Priority resolution over dealwatch-runtime/'s Buy Helper quote bridge.
 * Per-channel priority (agreed): eBay sold median > eBay live > (caller falls back
 * to inventory comps when this returns null). Kleinanzeigen never has sold data,
 * so live is its only signal.
 */
import { fetchBuyHelperQuote, type DealwatchBuyHelperQuote, type DealwatchQuoteBucket } from './dealwatchApi';

export type DealwatchPriceSource = 'ebay-sold' | 'ebay-live' | 'ka-live';

export type DealwatchPriceSignal = {
  source: DealwatchPriceSource;
  median: number;
  low: number | null;
  high: number | null;
  count: number;
};

export type ResolvedDealwatchPrices = {
  ebay: DealwatchPriceSignal | null;
  ka: DealwatchPriceSignal | null;
};

function toSignal(bucket: DealwatchQuoteBucket, source: DealwatchPriceSource): DealwatchPriceSignal | null {
  if (!bucket || bucket.median == null || bucket.count <= 0) return null;
  return { source, median: bucket.median, low: bucket.low, high: bucket.high, count: bucket.count };
}

/** Pure — no I/O. Applies the agreed per-channel priority to an already-fetched quote. */
export function resolveDealwatchPrices(quote: DealwatchBuyHelperQuote | null): ResolvedDealwatchPrices {
  if (!quote) return { ebay: null, ka: null };
  const ebay = toSignal(quote.ebaySold, 'ebay-sold') || toSignal(quote.ebayLive, 'ebay-live');
  const ka = toSignal(quote.kaLive, 'ka-live');
  return { ebay, ka };
}

/**
 * Fetches + resolves in one call. Never throws — a failed/unreachable Dealwatch bridge
 * resolves to { ebay: null, ka: null } so callers fall back to inventory comps automatically.
 */
export async function fetchResolvedDealwatchPrices(
  query: string,
  opts?: {
    maxPrice?: number;
    minPrice?: number;
    enabledSmartFilters?: string[];
    includeCapacities?: string[];
    categoryId?: string;
    kaCategory?: string;
  },
): Promise<ResolvedDealwatchPrices> {
  try {
    const quote = await fetchBuyHelperQuote(query, opts);
    return resolveDealwatchPrices(quote);
  } catch {
    return { ebay: null, ka: null };
  }
}
