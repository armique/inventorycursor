import type { EbayMyListing } from '../services/ebayService';

const STORAGE_KEY = 'ebay_listings_snapshot_v1';

export interface EbayListingSnapshotEntry {
  listingId: string;
  title: string;
  sku?: string;
  price?: number;
  thumbnail?: string;
  capturedAt: string;
}

export interface EbayListingSnapshotMeta {
  capturedAt: string;
  count: number;
  sellerUsername?: string;
}

export function listingToSnapshotEntry(listing: EbayMyListing, capturedAt: string): EbayListingSnapshotEntry {
  return {
    listingId: listing.listingId,
    title: listing.title,
    sku: listing.sku,
    price: listing.price,
    thumbnail: listing.thumbnail,
    capturedAt,
  };
}

export function loadEbayListingSnapshot(): {
  entries: EbayListingSnapshotEntry[];
  meta: EbayListingSnapshotMeta;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      entries?: EbayListingSnapshotEntry[];
      meta?: EbayListingSnapshotMeta;
    };
    if (!parsed?.entries?.length) return null;
    return {
      entries: parsed.entries,
      meta: parsed.meta || { capturedAt: parsed.entries[0]?.capturedAt || '', count: parsed.entries.length },
    };
  } catch {
    return null;
  }
}

export function saveEbayListingSnapshot(listings: EbayMyListing[], sellerUsername?: string): EbayListingSnapshotMeta {
  const capturedAt = new Date().toISOString();
  const entries = listings.map((l) => listingToSnapshotEntry(l, capturedAt));
  const meta: EbayListingSnapshotMeta = {
    capturedAt,
    count: entries.length,
    sellerUsername,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, meta }));
  return meta;
}

export function compareEbayListingSnapshots(
  previous: EbayListingSnapshotEntry[],
  current: EbayMyListing[]
): {
  disappeared: EbayListingSnapshotEntry[];
  appeared: EbayMyListing[];
  stillActive: EbayMyListing[];
} {
  const currentIds = new Set(current.map((l) => l.listingId));
  const previousIds = new Set(previous.map((e) => e.listingId));

  const disappeared = previous.filter((e) => !currentIds.has(e.listingId));
  const appeared = current.filter((l) => !previousIds.has(l.listingId));
  const stillActive = current.filter((l) => previousIds.has(l.listingId));

  return { disappeared, appeared, stillActive };
}
