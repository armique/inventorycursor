import type { EbayMyListing } from '../services/ebayService';

const STORAGE_KEY = 'ebay_listings_snapshot_v1';
const HISTORY_KEY = 'ebay_listings_snapshot_history_v1';
const MAX_HISTORY_ENTRIES = 120;

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

export interface EbayListingSnapshotCheckRecord {
  checkId: string;
  checkedAt: string;
  sellerUsername?: string;
  previousCapturedAt: string | null;
  previousCount: number;
  currentCount: number;
  disappearedCount: number;
  appearedCount: number;
  stillActiveCount: number;
  disappeared: EbayListingSnapshotEntry[];
  appeared: EbayListingSnapshotEntry[];
  /** Full listing rows before this check (for replay / baseline restore). */
  previousEntries?: EbayListingSnapshotEntry[];
  /** Full listing rows after this check (usually current active store). */
  currentEntries?: EbayListingSnapshotEntry[];
  checkKind?: 'auto' | 'manual' | 'reconcile';
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

export function loadEbayListingSnapshotHistory(): EbayListingSnapshotCheckRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EbayListingSnapshotCheckRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendEbayListingSnapshotHistory(record: EbayListingSnapshotCheckRecord): void {
  const history = loadEbayListingSnapshotHistory();
  history.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ENTRIES)));
}

export function saveEbayListingSnapshot(listings: EbayMyListing[], sellerUsername?: string): EbayListingSnapshotMeta {
  const capturedAt = new Date().toISOString();
  const entries = listings.map((l) => listingToSnapshotEntry(l, capturedAt));
  return saveEbayListingSnapshotEntries(entries, sellerUsername);
}

export function saveEbayListingSnapshotEntries(
  entries: EbayListingSnapshotEntry[],
  sellerUsername?: string,
  capturedAt?: string
): EbayListingSnapshotMeta {
  const at = capturedAt || new Date().toISOString();
  const meta: EbayListingSnapshotMeta = {
    capturedAt: at,
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

/** Compare, append history, and optionally update the baseline snapshot. */
export function recordEbayListingCheck(
  listings: EbayMyListing[],
  sellerUsername?: string,
  options?: { commitBaseline?: boolean }
): {
  previous: { entries: EbayListingSnapshotEntry[]; meta: EbayListingSnapshotMeta } | null;
  disappeared: EbayListingSnapshotEntry[];
  appeared: EbayMyListing[];
  stillActive: EbayMyListing[];
  checkRecord: EbayListingSnapshotCheckRecord | null;
  meta: EbayListingSnapshotMeta;
  currentEntries: EbayListingSnapshotEntry[];
  baselineCommitted: boolean;
} {
  const previous = loadEbayListingSnapshot();
  const checkedAt = new Date().toISOString();
  const checkId = `check-${Date.now()}`;
  const currentEntries = listings.map((l) => listingToSnapshotEntry(l, checkedAt));

  if (!previous) {
    const meta = saveEbayListingSnapshot(listings, sellerUsername);
    return {
      previous: null,
      disappeared: [],
      appeared: listings,
      stillActive: [],
      checkRecord: null,
      meta,
      currentEntries,
      baselineCommitted: true,
    };
  }

  const { disappeared, appeared, stillActive } = compareEbayListingSnapshots(previous.entries, listings);
  const hasChanges = disappeared.length > 0 || appeared.length > 0;
  const shouldCommit = options?.commitBaseline ?? !hasChanges;

  let meta: EbayListingSnapshotMeta;
  if (shouldCommit) {
    meta = saveEbayListingSnapshot(listings, sellerUsername);
  } else {
    meta = previous.meta;
  }

  const checkRecord: EbayListingSnapshotCheckRecord = {
    checkId,
    checkedAt,
    sellerUsername,
    previousCapturedAt: previous.meta.capturedAt,
    previousCount: previous.meta.count,
    currentCount: listings.length,
    disappearedCount: disappeared.length,
    appearedCount: appeared.length,
    stillActiveCount: stillActive.length,
    disappeared,
    appeared: appeared.map((l) => listingToSnapshotEntry(l, checkedAt)),
    previousEntries: previous.entries,
    currentEntries,
    checkKind: 'manual',
  };

  appendEbayListingSnapshotHistory(checkRecord);

  return {
    previous,
    disappeared,
    appeared,
    stillActive,
    checkRecord,
    meta,
    currentEntries,
    baselineCommitted: shouldCommit,
  };
}

/** Accept the latest live fetch as the new comparison baseline (after review or no changes). */
export function commitEbayListingBaselineFromEntries(
  entries: EbayListingSnapshotEntry[],
  sellerUsername?: string,
  capturedAt?: string
): EbayListingSnapshotMeta {
  return saveEbayListingSnapshotEntries(entries, sellerUsername, capturedAt);
}

/** Restore a prior snapshot from history as the comparison baseline (e.g. 42 listings). */
export function restoreBaselineFromHistory(checkId: string): boolean {
  const record = loadEbayListingSnapshotHistory().find((r) => r.checkId === checkId);
  const entries = record?.previousEntries;
  if (!entries?.length) return false;
  saveEbayListingSnapshotEntries(entries, record.sellerUsername, record.previousCapturedAt || record.checkedAt);
  return true;
}

/** Compare a stored entry set to a fresh live fetch without saving. */
export function diffSnapshotEntriesToLive(
  previousEntries: EbayListingSnapshotEntry[],
  currentListings: EbayMyListing[]
): ReturnType<typeof compareEbayListingSnapshots> {
  return compareEbayListingSnapshots(previousEntries, currentListings);
}
