import type { EbayMyListing } from '../services/ebayService';
import type { EbayListingSnapshotEntry } from '../services/ebayListingSnapshot';
import { buildEbayOrphanListingsPlan } from './ebayBulkSyncPlan';

export function snapshotEntryToMyListing(entry: EbayListingSnapshotEntry): EbayMyListing {
  return {
    listingId: entry.listingId,
    title: entry.title,
    sku: entry.sku,
    price: entry.price,
    thumbnail: entry.thumbnail,
    imageUrls: entry.thumbnail ? [entry.thumbnail] : [],
    source: 'seller_store',
  };
}

/** New eBay listings (from snapshot diff) that are not yet represented in inventory. */
export function filterAppearedListingsNotInInventory(
  items: import('../types').InventoryItem[],
  appeared: EbayListingSnapshotEntry[]
): EbayMyListing[] {
  if (!appeared.length) return [];
  const asListings = appeared.map(snapshotEntryToMyListing);
  return buildEbayOrphanListingsPlan(items, asListings).orphans;
}
