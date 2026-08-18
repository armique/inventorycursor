/**
 * Persistent cache of the seller’s public Kleinanzeigen listings (titles + photos).
 * Tools (sync / photo pickers) read from here so they don’t re-hit the profile on every open.
 */

import {
  loadKaListingTitles,
  loadKaProfileUrl,
  saveKaListingTitles,
  type ListingTitleHit,
} from '../utils/listingPresence';
import {
  extractKaListingId,
  fetchKaListingsFromProfile,
  type KaMyListing,
} from './kleinanzeigenListingService';

const STORAGE_KEY = 'ka_active_listings_v1';

export interface KaListingIndexMeta {
  updatedAt: string;
  count: number;
  lastFetchedAt: string | null;
  profileUrl?: string;
}

export interface KaListingIndex {
  listings: KaMyListing[];
  meta: KaListingIndexMeta;
}

function emptyIndex(): KaListingIndex {
  return {
    listings: [],
    meta: { updatedAt: new Date().toISOString(), count: 0, lastFetchedAt: null },
  };
}

let memListings: KaMyListing[] | null = null;
let memMeta: KaListingIndexMeta | null = null;

function normalizeListing(raw: Partial<KaMyListing> & { url?: string }): KaMyListing | null {
  const listingUrl = String(raw.listingUrl || raw.url || '').trim();
  const listingId = String(raw.listingId || extractKaListingId(listingUrl) || '').trim();
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
  if (!listingId || !title) return null;
  return {
    listingId,
    title,
    listingUrl: listingUrl || `https://www.kleinanzeigen.de/s-anzeige/${listingId}`,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    imageUrls: Array.isArray(raw.imageUrls)
      ? raw.imageUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : [],
    price: typeof raw.price === 'number' ? raw.price : undefined,
  };
}

function toTitleHits(listings: KaMyListing[]): ListingTitleHit[] {
  return listings.map((l) => ({
    title: l.title,
    url: l.listingUrl || undefined,
    listingId: l.listingId,
    price: l.price,
  }));
}

function listingsFromTitleHits(hits: ListingTitleHit[]): KaMyListing[] {
  return hits
    .map((hit) =>
      normalizeListing({
        listingId: hit.listingId,
        title: hit.title,
        listingUrl: hit.url,
        price: hit.price,
        imageUrls: [],
      })
    )
    .filter((row): row is KaMyListing => Boolean(row));
}

function saveRaw(listings: KaMyListing[], meta: KaListingIndexMeta): void {
  memListings = listings;
  memMeta = meta;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ listings, meta }));
  } catch (e) {
    console.warn('Failed to persist Kleinanzeigen listing cache:', e);
  }
  try {
    saveKaListingTitles(toTitleHits(listings));
  } catch (e) {
    console.warn('Failed to persist Kleinanzeigen title snapshot:', e);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ka-listing-index-updated'));
  }
}

function loadRaw(): KaListingIndex {
  if (memListings && memMeta) return { listings: memListings, meta: memMeta };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = listingsFromTitleHits(loadKaListingTitles());
      const empty = emptyIndex();
      if (!seeded.length) {
        memListings = empty.listings;
        memMeta = empty.meta;
        return empty;
      }
      const meta: KaListingIndexMeta = {
        updatedAt: new Date().toISOString(),
        count: seeded.length,
        lastFetchedAt: null,
        profileUrl: loadKaProfileUrl() || undefined,
      };
      memListings = seeded;
      memMeta = meta;
      return { listings: seeded, meta };
    }
    const parsed = JSON.parse(raw) as { listings?: unknown[]; meta?: KaListingIndexMeta };
    const listings = (parsed.listings || [])
      .map((row) => normalizeListing(row as Partial<KaMyListing>))
      .filter((row): row is KaMyListing => Boolean(row));
    const meta: KaListingIndexMeta = {
      updatedAt: parsed.meta?.updatedAt || new Date().toISOString(),
      count: listings.length,
      lastFetchedAt: parsed.meta?.lastFetchedAt || null,
      profileUrl: parsed.meta?.profileUrl,
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

export function loadKaListingIndex(): KaListingIndex {
  return loadRaw();
}

export function getCachedKaListings(): KaMyListing[] {
  return loadRaw().listings;
}

export function replaceKaListingIndex(
  listings: KaMyListing[],
  options?: { profileUrl?: string; fetchedAt?: string }
): KaListingIndex {
  const fetchedAt = options?.fetchedAt || new Date().toISOString();
  const meta: KaListingIndexMeta = {
    updatedAt: fetchedAt,
    count: listings.length,
    lastFetchedAt: fetchedAt,
    profileUrl: options?.profileUrl,
  };
  saveRaw(listings, meta);
  return { listings, meta };
}

export function upsertKaListings(listings: KaMyListing[]): KaListingIndex {
  const existing = loadRaw();
  const byId = new Map(existing.listings.map((row) => [row.listingId, row]));
  for (const listing of listings) {
    const prev = byId.get(listing.listingId);
    if (!prev) {
      byId.set(listing.listingId, listing);
      continue;
    }
    const imageUrls = [...new Set([...(prev.imageUrls || []), ...(listing.imageUrls || [])])];
    byId.set(listing.listingId, {
      ...prev,
      ...listing,
      title: listing.title || prev.title,
      listingUrl: listing.listingUrl || prev.listingUrl,
      thumbnail: listing.thumbnail || prev.thumbnail,
      imageUrls,
      price: listing.price ?? prev.price,
    });
  }
  const next = [...byId.values()];
  saveRaw(next, {
    ...existing.meta,
    updatedAt: new Date().toISOString(),
    count: next.length,
  });
  return { listings: next, meta: { ...existing.meta, count: next.length, updatedAt: new Date().toISOString() } };
}

export function clearKaListingIndex(): void {
  memListings = null;
  memMeta = null;
  localStorage.removeItem(STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ka-listing-index-updated'));
  }
}

export interface EnsureKaListingsResult {
  listings: KaMyListing[];
  fromCache: boolean;
  fetchedAt: string | null;
}

/**
 * Return cached KA listings when available; otherwise fetch the public seller profile.
 * Pass `{ force: true }` to re-pull the live profile and replace the cache.
 */
export async function ensureKaListings(options?: { force?: boolean }): Promise<EnsureKaListingsResult> {
  const existing = loadRaw();
  if (!options?.force && existing.listings.length > 0) {
    return {
      listings: existing.listings,
      fromCache: true,
      fetchedAt: existing.meta.lastFetchedAt,
    };
  }

  const profileUrl = loadKaProfileUrl();
  if (!profileUrl) {
    return {
      listings: existing.listings,
      fromCache: true,
      fetchedAt: existing.meta.lastFetchedAt,
    };
  }

  const listings = await fetchKaListingsFromProfile(profileUrl);
  if (!listings.length && existing.listings.length) {
    return {
      listings: existing.listings,
      fromCache: true,
      fetchedAt: existing.meta.lastFetchedAt,
    };
  }
  const index = replaceKaListingIndex(listings, { profileUrl });
  return {
    listings: index.listings,
    fromCache: false,
    fetchedAt: index.meta.lastFetchedAt,
  };
}
