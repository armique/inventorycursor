/**
 * Persistent cache of the seller’s **active** eBay listings.
 * Tools (sync / import / bundles / photo pickers) read from here so they don’t
 * re-hit the listings API on every open. Refresh replaces the full active set
 * (Browse/Inventory APIs are current-state, not date-incremental like orders).
 */

import type { EbayMyListing } from './ebayService';
import {
  clearEbayActiveListingsCloud,
  fetchEbayActiveListingsFromCloud,
  isCloudEnabled,
  writeEbayActiveListingsToCloud,
  type EbayActiveListingsCloudMeta,
} from './firebaseService';

const STORAGE_KEY = 'ebay_active_listings_v1';

export interface EbayListingIndexMeta {
  updatedAt: string;
  count: number;
  lastFetchedAt: string | null;
  sellerUsername?: string;
}

export interface EbayListingIndex {
  listings: EbayMyListing[];
  meta: EbayListingIndexMeta;
}

function emptyIndex(): EbayListingIndex {
  return {
    listings: [],
    meta: { updatedAt: new Date().toISOString(), count: 0, lastFetchedAt: null },
  };
}

let memListings: EbayMyListing[] | null = null;
let memMeta: EbayListingIndexMeta | null = null;

function normalizeListing(raw: Partial<EbayMyListing> & { listingId?: string }): EbayMyListing | null {
  if (!raw?.listingId || typeof raw.listingId !== 'string') return null;
  return {
    listingId: raw.listingId,
    title: String(raw.title || ''),
    sku: raw.sku,
    offerId: raw.offerId,
    thumbnail: raw.thumbnail,
    imageUrls: Array.isArray(raw.imageUrls) ? raw.imageUrls.filter((u): u is string => typeof u === 'string') : [],
    listingUrl: raw.listingUrl,
    price: typeof raw.price === 'number' ? raw.price : undefined,
    currency: raw.currency,
    source: raw.source === 'inventory' || raw.source === 'trading' || raw.source === 'seller_store'
      ? raw.source
      : 'seller_store',
  };
}

function saveRaw(listings: EbayMyListing[], meta: EbayListingIndexMeta): void {
  memListings = listings;
  memMeta = meta;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ listings, meta }));
  } catch (e) {
    console.warn('Failed to persist eBay listing cache:', e);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-listing-index-updated'));
  }
}

function loadRaw(): EbayListingIndex {
  if (memListings && memMeta) return { listings: memListings, meta: memMeta };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const empty = emptyIndex();
      memListings = empty.listings;
      memMeta = empty.meta;
      return empty;
    }
    const parsed = JSON.parse(raw) as { listings?: unknown[]; meta?: EbayListingIndexMeta };
    const listings = (parsed.listings || [])
      .map((row) => normalizeListing(row as Partial<EbayMyListing>))
      .filter((row): row is EbayMyListing => Boolean(row));
    const meta: EbayListingIndexMeta = {
      updatedAt: parsed.meta?.updatedAt || new Date().toISOString(),
      count: listings.length,
      lastFetchedAt: parsed.meta?.lastFetchedAt || null,
      sellerUsername: parsed.meta?.sellerUsername,
    };
    memListings = listings;
    memMeta = meta;
    return { listings, meta };
  } catch {
    const empty = emptyIndex();
    memListings = empty.listings;
    memMeta = empty.meta;
    return empty;
  }
}

export function loadEbayListingIndex(): EbayListingIndex {
  return loadRaw();
}

export function getCachedEbayListings(): EbayMyListing[] {
  return loadRaw().listings;
}

export function replaceEbayListingIndex(
  listings: EbayMyListing[],
  options?: { sellerUsername?: string; fetchedAt?: string }
): EbayListingIndex {
  const fetchedAt = options?.fetchedAt || new Date().toISOString();
  const meta: EbayListingIndexMeta = {
    updatedAt: fetchedAt,
    count: listings.length,
    lastFetchedAt: fetchedAt,
    sellerUsername: options?.sellerUsername,
  };
  saveRaw(listings, meta);
  return { listings, meta };
}

export function clearEbayListingIndex(): void {
  memListings = null;
  memMeta = null;
  localStorage.removeItem(STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-listing-index-updated'));
  }
}

export interface EnsureEbayListingsResult {
  listings: EbayMyListing[];
  fromCache: boolean;
  fetchedAt: string | null;
}

/**
 * Return cached active listings when available; otherwise fetch from eBay and persist.
 * Pass `{ force: true }` to re-pull the live store and replace the cache.
 */
export async function ensureEbayListings(options?: {
  force?: boolean;
  sellerUsername?: string;
}): Promise<EnsureEbayListingsResult> {
  const existing = loadRaw();
  if (!options?.force && existing.listings.length > 0) {
    return {
      listings: existing.listings,
      fromCache: true,
      fetchedAt: existing.meta.lastFetchedAt,
    };
  }

  const { fetchMyEbayListings } = await import('./ebayService');
  const listings = await fetchMyEbayListings();
  const index = replaceEbayListingIndex(listings, { sellerUsername: options?.sellerUsername });
  void pushListingIndexToCloud(listings).catch((e) =>
    console.warn('Failed to push eBay listings to cloud:', e)
  );
  return {
    listings: index.listings,
    fromCache: false,
    fetchedAt: index.meta.lastFetchedAt,
  };
}

export async function pullListingIndexFromCloud(options?: { force?: boolean }): Promise<{
  pulled: number;
  skipped: boolean;
  error?: string;
}> {
  if (!isCloudEnabled()) return { pulled: 0, skipped: true };
  try {
    const localCount = loadRaw().listings.length;
    if (!options?.force && localCount > 0) return { pulled: 0, skipped: true };

    const cloud = await fetchEbayActiveListingsFromCloud();
    if (!cloud) return { pulled: 0, skipped: true };

    const listings = cloud.listings
      .map((row) => normalizeListing(row as Partial<EbayMyListing>))
      .filter((row): row is EbayMyListing => Boolean(row));

    if (!listings.length && !cloud.meta) return { pulled: 0, skipped: true };

    replaceEbayListingIndex(listings, {
      sellerUsername: cloud.meta?.sellerUsername,
      fetchedAt: cloud.meta?.lastFetchedAt || cloud.meta?.updatedAt || new Date().toISOString(),
    });
    return { pulled: listings.length, skipped: false };
  } catch (e: unknown) {
    return { pulled: 0, skipped: false, error: (e as Error)?.message || 'Cloud pull failed.' };
  }
}

export async function pushListingIndexToCloud(listings: EbayMyListing[]): Promise<void> {
  if (!isCloudEnabled()) return;
  try {
    const { meta } = loadRaw();
    const metaPatch: EbayActiveListingsCloudMeta = {
      count: listings.length,
      lastFetchedAt: meta.lastFetchedAt || undefined,
      sellerUsername: meta.sellerUsername,
    };
    await writeEbayActiveListingsToCloud(
      listings as unknown as (Record<string, unknown> & { listingId: string })[],
      metaPatch
    );
  } catch (e) {
    console.warn('Failed to push eBay active listings to cloud:', e);
  }
}

export async function clearEbayListingIndexEverywhere(): Promise<void> {
  clearEbayListingIndex();
  if (!isCloudEnabled()) return;
  try {
    await clearEbayActiveListingsCloud();
  } catch (e) {
    console.warn('Failed to clear cloud eBay listing cache:', e);
  }
}
