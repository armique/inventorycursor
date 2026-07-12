import { InventoryItem, ItemStatus } from '../types';
import type { EbayMyListing } from '../services/ebayService';
import type { EbayListingSnapshotEntry } from '../services/ebayListingSnapshot';
import { scoreListingTitleMatch } from './ebayListingMatch';
import type { EbaySoldDetectionMatch, EbaySoldDetectionPlan } from './ebaySoldDetectionPlan';

const MIN_ACTIVE_MATCH_SCORE = 40;

/** In-stock items that may have been listed on eBay (includes bundles/PCs). */
export function getInventoryItemsForEbayReconciliation(items: InventoryItem[]): InventoryItem[] {
  return items.filter(
    (i) => i.status === ItemStatus.IN_STOCK && !i.parentContainerId && Boolean(i.name?.trim())
  );
}

function itemLooksEbayListed(item: InventoryItem): boolean {
  return Boolean(
    item.ebayListingId ||
      item.listedOnEbay ||
      (item.storePrice != null && item.storePrice > 0)
  );
}

function bestActiveListingScore(item: InventoryItem, currentListings: EbayMyListing[]): number {
  let best = 0;
  for (const listing of currentListings) {
    const score = scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku);
    if (score > best) best = score;
  }
  return best;
}

export function snapshotEntryFromInventoryItem(item: InventoryItem, capturedAt: string): EbayListingSnapshotEntry {
  return {
    listingId: item.ebayListingId || `inv-ended-${item.id}`,
    title: item.name,
    sku: item.ebaySku,
    price: item.storePrice ?? undefined,
    thumbnail: item.imageUrl,
    capturedAt,
  };
}

/**
 * Find in-stock inventory whose eBay listing is no longer in the active seller store.
 * Reconstructs "disappeared" listings from inventory when the old snapshot was lost.
 */
export function findInventoryWithEndedEbayListings(
  items: InventoryItem[],
  currentListings: EbayMyListing[]
): { endedItems: InventoryItem[]; disappeared: EbayListingSnapshotEntry[] } {
  const activeIds = new Set(currentListings.map((l) => l.listingId));
  const endedItems: InventoryItem[] = [];
  const seenItemIds = new Set<string>();
  const capturedAt = new Date().toISOString();

  for (const item of getInventoryItemsForEbayReconciliation(items)) {
    if (seenItemIds.has(item.id)) continue;

    if (item.ebayListingId && !activeIds.has(item.ebayListingId)) {
      endedItems.push(item);
      seenItemIds.add(item.id);
      continue;
    }

    if (!itemLooksEbayListed(item) || item.ebayListingId) continue;

    if (bestActiveListingScore(item, currentListings) < MIN_ACTIVE_MATCH_SCORE) {
      endedItems.push(item);
      seenItemIds.add(item.id);
    }
  }

  return {
    endedItems,
    disappeared: endedItems.map((item) => snapshotEntryFromInventoryItem(item, capturedAt)),
  };
}

export function buildReconciliationSoldPlan(
  endedItems: InventoryItem[],
  disappeared: EbayListingSnapshotEntry[]
): EbaySoldDetectionPlan {
  const matches: EbaySoldDetectionMatch[] = endedItems.map((item, index) => {
    const listing = disappeared[index]!;
    return {
      item,
      lastKnownListing: listing,
      matchKind: item.ebayListingId ? 'listing_id' : 'title',
      matchScore: item.ebayListingId ? 2000 : 500,
      warning: item.ebayListingId
        ? undefined
        : 'Inferred from inventory — no matching live eBay listing was found.',
    };
  });

  return { matches, unmatchedDisappeared: [] };
}

export interface EbayInventoryReconciliationResult {
  endedItems: InventoryItem[];
  disappeared: EbayListingSnapshotEntry[];
  plan: EbaySoldDetectionPlan;
  /** Reconstructed prior baseline count (active + ended). */
  previousCount: number;
  currentCount: number;
  /** Entries that represent the prior store state (current live + ended from inventory). */
  previousEntries: EbayListingSnapshotEntry[];
  currentEntries: EbayListingSnapshotEntry[];
}

export function buildInventoryEbayReconciliation(
  items: InventoryItem[],
  currentListings: EbayMyListing[]
): EbayInventoryReconciliationResult {
  const capturedAt = new Date().toISOString();
  const currentEntries = currentListings.map((l) => ({
    listingId: l.listingId,
    title: l.title,
    sku: l.sku,
    price: l.price,
    thumbnail: l.thumbnail,
    capturedAt,
  }));

  const currentIds = new Set(currentListings.map((l) => l.listingId));
  const { endedItems, disappeared } = findInventoryWithEndedEbayListings(items, currentListings);
  const endedNotInCurrent = disappeared.filter((d) => !currentIds.has(d.listingId));
  const previousEntries = [...currentEntries, ...endedNotInCurrent];
  const plan = buildReconciliationSoldPlan(endedItems, disappeared);

  return {
    endedItems,
    disappeared,
    plan,
    previousCount: previousEntries.length,
    currentCount: currentListings.length,
    previousEntries,
    currentEntries,
  };
}
