/**
 * Sync listing presence flags from your eBay store + KA title snapshot.
 */

import type { InventoryItem } from '../types';
import { ensureEbayListings } from '../services/ebayListingIndex';
import { ensureKaListings } from '../services/kleinanzeigenListingIndex';
import {
  applyEbayPresenceToItems,
  applyKaPresenceToItems,
  loadKaListingTitles,
  markPresenceMeta,
  type ListingTitleHit,
} from './listingPresence';
import { computePriceChangeHint, isListingPresenceEligible, isListingWatchCandidate } from './listingWatch';

export type ListingPresenceSyncResult = {
  items: InventoryItem[];
  ebayMatched: number;
  kaMatched: number;
  ebayTitleCount: number;
  kaTitleCount: number;
  watchCount: number;
  eligibleCount: number;
  priceHints: number;
  maybeSoldCount: number;
  /** Active eBay listing IDs from this sync (for Price Drop intersection). */
  ebayListingIds: string[];
  /** Active KA listing URLs from this sync. */
  kaListingUrls: string[];
  kaError?: string;
  ebayError?: string;
};

export async function syncListingPresence(
  items: InventoryItem[],
  opts?: {
    kaTitlesOverride?: ListingTitleHit[];
    skipEbay?: boolean;
    skipKa?: boolean;
    /** Bypass eBay listing cache (Price Drop refresh). */
    forceEbay?: boolean;
    /** Re-fetch KA profile even when a local title snapshot exists. */
    forceKa?: boolean;
  }
): Promise<ListingPresenceSyncResult> {
  let next = items;
  let ebayMatched = 0;
  let kaMatched = 0;
  let ebayTitleCount = 0;
  let kaTitleCount = 0;
  let ebayListingIds: string[] = [];
  let kaListingUrls: string[] = [];
  let kaError: string | undefined;
  let ebayError: string | undefined;
  const eligibleCount = items.filter(isListingPresenceEligible).length;
  const watchCount = items.filter(isListingWatchCandidate).length;

  if (!opts?.skipEbay) {
    try {
      const { listings } = await ensureEbayListings({ force: Boolean(opts?.forceEbay) });
      ebayTitleCount = listings.length;
      ebayListingIds = listings.map((l) => l.listingId).filter(Boolean);
      next = applyEbayPresenceToItems(next, listings);
      ebayMatched = next.filter(
        (i) => isListingPresenceEligible(i) && i.listedOnEbay && !i.listedViaParent
      ).length;
      markPresenceMeta({
        ebaySyncedAt: new Date().toISOString(),
        ebayTitleCount,
      });
    } catch (e) {
      ebayError = (e as Error)?.message || 'eBay listing fetch failed';
    }
  }

  if (!opts?.skipKa) {
    let titles = opts?.kaTitlesOverride || [];
    if (!opts?.kaTitlesOverride) {
      try {
        const { listings } = await ensureKaListings({ force: Boolean(opts?.forceKa) });
        titles = listings.map((listing) => ({
          title: listing.title,
          url: listing.listingUrl || undefined,
          listingId: listing.listingId,
          price: listing.price,
        }));
      } catch (e) {
        titles = loadKaListingTitles();
        if (!titles.length) {
          kaError = (e as Error)?.message || 'Could not fetch KA profile — paste listing titles in Settings.';
        }
      }
    }
    // Fallback to cached snapshot if live fetch failed but we still have old titles
    if (!titles.length && !opts?.kaTitlesOverride) {
      titles = loadKaListingTitles();
    }
    if (titles.length) {
      kaTitleCount = titles.length;
      kaListingUrls = titles
        .map((t) => (t.url || '').trim())
        .filter(Boolean);
      next = applyKaPresenceToItems(next, titles);
      kaMatched = next.filter(
        (i) =>
          isListingPresenceEligible(i) && i.listedOnKleinanzeigen && !i.listedViaParent
      ).length;
      markPresenceMeta({
        kaSyncedAt: new Date().toISOString(),
        kaTitleCount,
      });
    }
  }

  const priceHints = next.filter((i) => computePriceChangeHint(i)).length;
  const maybeSoldCount = next.filter(
    (i) => i.maybeSoldHint && !i.maybeSoldDismissedAt
  ).length;

  return {
    items: next,
    ebayMatched,
    kaMatched,
    ebayTitleCount,
    kaTitleCount,
    ebayListingIds,
    kaListingUrls,
    watchCount: next.filter(isListingWatchCandidate).length,
    eligibleCount,
    priceHints,
    maybeSoldCount,
    kaError: kaError || undefined,
    ebayError,
  };
}
