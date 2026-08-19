/** Client for Dealwatch APIs (mounted at /api/dealwatch). */

const API = '/api/dealwatch';

export type DealwatchMarketplace = 'ebay' | 'kleinanzeigen';

export type DealwatchSearch = {
  id: string;
  name: string;
  search: string;
  searchVariants?: string[];
  minPrice?: number;
  maxPrice?: number;
  minFeedback?: number;
  condition?: string;
  marketplace?: DealwatchMarketplace | string;
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
  constructor?: { categoryId: string; facetIds: string[] };
};

export type DealwatchListing = {
  id: string;
  title: string;
  price?: number;
  total?: number;
  shipping?: number;
  shippingKnown?: boolean;
  shippingPossible?: boolean;
  pickupOnly?: boolean;
  rejected?: boolean;
  rejectReason?: string;
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

export type DealwatchWatchItem = DealwatchListing & {
  addedAt?: string;
  searchId?: string;
  searchName?: string;
};

export type DealwatchKaRecord = {
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

export type DealwatchStore = {
  activeId?: string;
  alerts?: boolean;
  searches: DealwatchSearch[];
  trash?: DealwatchSearch[];
  watchlist?: DealwatchWatchItem[];
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
  kaPurchases?: DealwatchKaRecord[];
  kaSales?: DealwatchKaRecord[];
  offersSent?: string[];
  monitorIntervalMinutes?: number;
  telegramConfigured?: boolean;
};

export type ListingsResult = {
  items: DealwatchListing[];
  rejectedItems?: DealwatchListing[];
  matched?: number;
  rejected?: number;
  best?: number;
  error?: string;
  checkedAt?: string;
  activeSearch?: DealwatchSearch;
  watchlistIds?: string[];
  store?: DealwatchStore;
};

async function dealwatchFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fetchDealwatchStore() {
  return dealwatchFetch<DealwatchStore>('/store');
}

export function setActiveSearch(id: string) {
  return dealwatchFetch<DealwatchStore>('/searches/active', {
    method: 'PUT',
    body: JSON.stringify({ id }),
  });
}

export function updateSearch(id: string, payload: Partial<DealwatchSearch> & Record<string, unknown>) {
  return dealwatchFetch<{ search: DealwatchSearch } & DealwatchStore>(`/searches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function createSearch(payload: Partial<DealwatchSearch> & { search: string }) {
  return dealwatchFetch<{ search: DealwatchSearch } & DealwatchStore>('/searches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteSearch(id: string) {
  return dealwatchFetch<DealwatchStore>(`/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function restoreSearch(id: string) {
  return dealwatchFetch<{ search: DealwatchSearch } & DealwatchStore>(`/searches/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: '{}',
  });
}

export function setAlerts(alerts: boolean) {
  return dealwatchFetch<DealwatchStore>('/alerts', {
    method: 'PUT',
    body: JSON.stringify({ alerts }),
  });
}

export function addToWatchlist(item: DealwatchListing, meta?: { searchId?: string; searchName?: string }) {
  return dealwatchFetch<{ watchlist: DealwatchWatchItem[] } & DealwatchStore>('/watchlist', {
    method: 'POST',
    body: JSON.stringify({ ...item, ...meta }),
  });
}

export function removeFromWatchlist(id: string) {
  return dealwatchFetch<{ watchlist: DealwatchWatchItem[] } & DealwatchStore>(`/watchlist/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchListings(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  return dealwatchFetch<ListingsResult>(`/listings?${qs.toString()}`);
}

export function fetchKaPurchases() {
  return dealwatchFetch<{ purchases: DealwatchKaRecord[]; count: number } & DealwatchStore>('/ka/purchases');
}

export function fetchKaSales() {
  return dealwatchFetch<{ sales: DealwatchKaRecord[]; count: number } & DealwatchStore>('/ka/sales');
}

export function listingParamsFromSearch(search: DealwatchSearch, alerts = true): Record<string, string | number | boolean> {
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
    ...(search.searchVariants?.length ? { searchVariants: search.searchVariants.join('|') } : {}),
    ...(search.categoryId ? { categoryId: search.categoryId } : {}),
  };
}
