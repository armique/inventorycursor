/** Client for market/ Dealwatch APIs (mounted at /api/est). */

const API = '/api/est';

export type MarketMarketplace = 'ebay' | 'kleinanzeigen';

export type MarketSearch = {
  id: string;
  name: string;
  search: string;
  searchVariants?: string[];
  minPrice?: number;
  maxPrice?: number;
  minFeedback?: number;
  condition?: string;
  marketplace?: MarketMarketplace | string;
  enabledSmartFilters?: string[];
  disabledSmartFilters?: string[];
  includeCapacities?: string[];
  categoryId?: string;
  categoryName?: string;
  categoryPath?: string[];
  kaCategory?: string;
  locationId?: string;
  locationLabel?: string;
  radiusKm?: number;
  shippingOnly?: boolean;
  monitor?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MarketListing = {
  id: string;
  title: string;
  price?: number;
  total?: number;
  shipping?: number;
  shippingKnown?: boolean;
  shippingPossible?: boolean;
  pickupOnly?: boolean;
  url: string;
  image?: string;
  condition?: string;
  seller?: string;
  feedbackPct?: number;
  feedbackScore?: number;
  endDate?: string;
  originDate?: string;
  listedLabel?: string;
  isAuction?: boolean;
  isNew?: boolean;
  offerSent?: boolean;
  marketplace?: string;
  location?: string;
  lotType?: 'component' | 'whole_pc' | 'donor_bundle' | 'accessory_only';
};

export type MarketWatchItem = MarketListing & {
  addedAt?: string;
  searchId?: string;
  searchName?: string;
};

export type MarketKaRecord = {
  id: string;
  title?: string;
  displayName?: string;
  price?: number;
  url?: string;
  image?: string;
  importedAt?: string;
  period?: string;
  confirmed?: boolean;
};

export type MarketStore = {
  activeId?: string;
  alerts?: boolean;
  searches: MarketSearch[];
  trash?: MarketSearch[];
  watchlist?: MarketWatchItem[];
  notifications?: Array<{
    id: string;
    searchId?: string;
    searchName?: string;
    itemId?: string;
    title?: string;
    price?: number;
    url?: string;
    read?: boolean;
    createdAt?: string;
  }>;
  kaPurchases?: MarketKaRecord[];
  kaSales?: MarketKaRecord[];
  offersSent?: string[];
  monitorIntervalMinutes?: number;
  telegramConfigured?: boolean;
};

export type ListingsResult = {
  items: MarketListing[];
  matched?: number;
  rejected?: number;
  best?: number;
  error?: string;
  checkedAt?: string;
  activeSearch?: MarketSearch;
  watchlistIds?: string[];
  store?: MarketStore;
};

export type MarketQuoteBucket = {
  median: number | null;
  low: number | null;
  high: number | null;
  count: number;
  items: MarketListing[];
} | null;

export type MarketBuyHelperQuote = {
  query: string;
  ebaySold: MarketQuoteBucket;
  ebayLive: MarketQuoteBucket;
  kaLive: MarketQuoteBucket;
  errors?: Record<string, string>;
  checkedAt: string;
};

async function marketFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fetchMarketStore() {
  return marketFetch<MarketStore>('/store');
}

export function setActiveSearch(id: string) {
  return marketFetch<MarketStore>('/searches/active', {
    method: 'PUT',
    body: JSON.stringify({ id }),
  });
}

export function updateSearch(id: string, payload: Partial<MarketSearch> & Record<string, unknown>) {
  return marketFetch<{ search: MarketSearch } & MarketStore>(`/searches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function createSearch(payload: Partial<MarketSearch> & { search: string }) {
  return marketFetch<{ search: MarketSearch } & MarketStore>('/searches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteSearch(id: string) {
  return marketFetch<MarketStore>(`/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function restoreSearch(id: string) {
  return marketFetch<{ search: MarketSearch } & MarketStore>(`/searches/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: '{}',
  });
}

export function setAlerts(alerts: boolean) {
  return marketFetch<MarketStore>('/alerts', {
    method: 'PUT',
    body: JSON.stringify({ alerts }),
  });
}

export function addToWatchlist(item: MarketListing, meta?: { searchId?: string; searchName?: string }) {
  return marketFetch<{ watchlist: MarketWatchItem[] } & MarketStore>('/watchlist', {
    method: 'POST',
    body: JSON.stringify({ ...item, ...meta }),
  });
}

export function removeFromWatchlist(id: string) {
  return marketFetch<{ watchlist: MarketWatchItem[] } & MarketStore>(`/watchlist/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchListings(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  return marketFetch<ListingsResult>(`/listings?${qs.toString()}`);
}

/**
 * Read-only Buy Helper bridge: eBay sold + eBay live + Kleinanzeigen live for one query,
 * in a single call. Does not touch any saved search or its seenBySearch/freshness state —
 * see the comment on the /api/buy-helper/quote route in market/server.js.
 */
export function fetchBuyHelperQuote(
  query: string,
  opts?: {
    maxPrice?: number;
    minPrice?: number;
    enabledSmartFilters?: string[];
    includeCapacities?: string[];
    categoryId?: string;
    kaCategory?: string;
  },
) {
  const qs = new URLSearchParams({ query });
  if (opts?.minPrice != null) qs.set('minPrice', String(opts.minPrice));
  if (opts?.maxPrice != null) qs.set('maxPrice', String(opts.maxPrice));
  if (opts?.enabledSmartFilters?.length) qs.set('enabledSmartFilters', opts.enabledSmartFilters.join(','));
  if (opts?.includeCapacities?.length) qs.set('includeCapacities', opts.includeCapacities.join(','));
  if (opts?.categoryId) qs.set('categoryId', opts.categoryId);
  if (opts?.kaCategory) qs.set('kaCategory', opts.kaCategory);
  return marketFetch<MarketBuyHelperQuote>(`/buy-helper/quote?${qs.toString()}`);
}

export function fetchKaPurchases() {
  return marketFetch<{ purchases: MarketKaRecord[]; count: number } & MarketStore>('/ka/purchases');
}

export function fetchKaSales() {
  return marketFetch<{ sales: MarketKaRecord[]; count: number } & MarketStore>('/ka/sales');
}

export function listingParamsFromSearch(search: MarketSearch, alerts = true): Record<string, string | number | boolean> {
  return {
    query: search.search || '',
    minPrice: search.minPrice ?? 1,
    maxPrice: search.maxPrice ?? 80,
    minFeedback: search.minFeedback ?? 0,
    condition: search.condition || 'any',
    alerts: alerts ? '1' : '0',
    enabledSmartFilters: (search.enabledSmartFilters || []).join(','),
    includeCapacities: (search.includeCapacities || []).join(','),
    marketplace: search.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay',
    kaCategory: search.kaCategory || 'all',
    locationId: search.locationId || '',
    locationLabel: search.locationLabel || '',
    radiusKm: search.radiusKm || 0,
    shippingOnly: search.shippingOnly ? '1' : '0',
    ...(search.categoryId ? { categoryId: search.categoryId } : {}),
  };
}
