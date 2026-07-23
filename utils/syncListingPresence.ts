/**
 * Sync listing presence flags from your eBay store + KA title snapshot.
 */

import type { InventoryItem } from '../types';
import { fetchMyEbayListings } from '../services/ebayService';
import {
  applyEbayPresenceToItems,
  applyKaPresenceToItems,
  loadKaListingTitles,
  loadKaProfileUrl,
  markPresenceMeta,
  saveKaListingTitles,
  type ListingTitleHit,
} from './listingPresence';
import { computePriceChangeHint, isListingWatchCandidate } from './listingWatch';

export type ListingPresenceSyncResult = {
  items: InventoryItem[];
  ebayMatched: number;
  kaMatched: number;
  ebayTitleCount: number;
  kaTitleCount: number;
  watchCount: number;
  priceHints: number;
  maybeSoldCount: number;
  kaError?: string;
  ebayError?: string;
};

export async function syncListingPresence(
  items: InventoryItem[],
  opts?: { kaTitlesOverride?: ListingTitleHit[]; skipEbay?: boolean; skipKa?: boolean }
): Promise<ListingPresenceSyncResult> {
  let next = items;
  let ebayMatched = 0;
  let kaMatched = 0;
  let ebayTitleCount = 0;
  let kaTitleCount = 0;
  let kaError: string | undefined;
  let ebayError: string | undefined;
  const watchCount = items.filter(isListingWatchCandidate).length;

  if (!opts?.skipEbay) {
    try {
      const listings = await fetchMyEbayListings();
      ebayTitleCount = listings.length;
      next = applyEbayPresenceToItems(next, listings);
      ebayMatched = next.filter(
        (i) => isListingWatchCandidate(i) && i.listedOnEbay && !i.listedViaParent
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
    let titles = opts?.kaTitlesOverride || loadKaListingTitles();
    const profileUrl = loadKaProfileUrl();
    if ((!titles.length || opts?.kaTitlesOverride == null) && profileUrl) {
      try {
        const res = await fetch(
          `/api/kleinanzeigen-listings?url=${encodeURIComponent(profileUrl)}`
        );
        const data = await res.json();
        if (res.ok && Array.isArray(data.titles) && data.titles.length) {
          titles = data.titles as ListingTitleHit[];
          saveKaListingTitles(titles);
        } else if (!titles.length) {
          kaError = data.error || 'Could not fetch KA profile — paste listing titles instead.';
        }
      } catch {
        if (!titles.length) {
          kaError = 'KA profile fetch failed — paste listing titles in Settings.';
        }
      }
    }
    if (titles.length) {
      kaTitleCount = titles.length;
      next = applyKaPresenceToItems(next, titles);
      kaMatched = next.filter(
        (i) => isListingWatchCandidate(i) && i.listedOnKleinanzeigen && !i.listedViaParent
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
    watchCount,
    priceHints,
    maybeSoldCount,
    kaError: kaError || undefined,
    ebayError,
  };
}
