import { InventoryItem, ItemStatus } from '../types';
import type { EbayListingSnapshotEntry } from '../services/ebayListingSnapshot';
import { scoreListingTitleMatch } from './ebayListingMatch';

export type EbaySoldMatchKind = 'listing_id' | 'sku' | 'title';

export interface EbaySoldDetectionMatch {
  item: InventoryItem;
  lastKnownListing: EbayListingSnapshotEntry;
  matchKind: EbaySoldMatchKind;
  matchScore: number;
  warning?: string;
}

export interface EbaySoldDetectionPlan {
  matches: EbaySoldDetectionMatch[];
  unmatchedDisappeared: EbayListingSnapshotEntry[];
}

const MIN_SCORE = 40;

export function getActiveInventoryForSoldDetection(items: InventoryItem[]): InventoryItem[] {
  return items.filter(
    (i) =>
      i.status === ItemStatus.IN_STOCK &&
      !i.parentContainerId &&
      Boolean(i.name?.trim())
  );
}

export function matchDisappearedListingToItem(
  listing: EbayListingSnapshotEntry,
  activeItems: InventoryItem[]
): EbaySoldDetectionMatch | null {
  const byListingId = activeItems.find((i) => i.ebayListingId === listing.listingId);
  if (byListingId) {
    return {
      item: byListingId,
      lastKnownListing: listing,
      matchKind: 'listing_id',
      matchScore: 2000,
    };
  }

  if (listing.sku) {
    const skuNorm = listing.sku.trim().toLowerCase();
    const bySku = activeItems.find((i) => i.ebaySku?.trim().toLowerCase() === skuNorm);
    if (bySku) {
      return {
        item: bySku,
        lastKnownListing: listing,
        matchKind: 'sku',
        matchScore: 1000,
      };
    }
  }

  let best: { item: InventoryItem; score: number } | null = null;
  const titleNorm = listing.title.trim().toLowerCase();
  for (const item of activeItems) {
    const score = scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku);
    const itemNorm = item.name.trim().toLowerCase();
    const reverseScore =
      titleNorm.length >= 8 && itemNorm.includes(titleNorm.slice(0, Math.min(titleNorm.length, 40)))
        ? 90
        : 0;
    const finalScore = Math.max(score, reverseScore);
    if (finalScore >= MIN_SCORE && (!best || finalScore > best.score)) {
      best = { item, score: finalScore };
    }
  }

  if (!best) return null;

  let warning: string | undefined;
  if (best.score < 120) {
    warning = 'Low confidence title match — confirm this listing matches the inventory item.';
  }

  return {
    item: best.item,
    lastKnownListing: listing,
    matchKind: 'title',
    matchScore: best.score,
    warning,
  };
}

export function buildEbaySoldDetectionPlan(
  items: InventoryItem[],
  disappeared: EbayListingSnapshotEntry[]
): EbaySoldDetectionPlan {
  const activeItems = getActiveInventoryForSoldDetection(items);
  const usedItemIds = new Set<string>();
  const matches: EbaySoldDetectionMatch[] = [];
  const unmatchedDisappeared: EbayListingSnapshotEntry[] = [];

  const sorted = [...disappeared].sort((a, b) => a.title.localeCompare(b.title));

  for (const listing of sorted) {
    const match = matchDisappearedListingToItem(listing, activeItems.filter((i) => !usedItemIds.has(i.id)));
    if (!match) {
      unmatchedDisappeared.push(listing);
      continue;
    }
    if (usedItemIds.has(match.item.id)) {
      unmatchedDisappeared.push(listing);
      continue;
    }
    usedItemIds.add(match.item.id);
    matches.push(match);
  }

  return { matches, unmatchedDisappeared };
}

export function defaultSellPriceForDetection(item: InventoryItem, listing: EbayListingSnapshotEntry): string {
  const price = item.storePrice ?? item.sellPrice ?? listing.price;
  if (price == null || !Number.isFinite(price)) return '';
  return String(price);
}
