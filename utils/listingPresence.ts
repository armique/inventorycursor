/**
 * Listing presence: match inventory names to your live KA / eBay listing titles.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { scoreListingTitleMatch } from './ebayListingMatch';
import { nameSimilarity } from './inventorySoldComps';
import type { EbayMyListing } from '../services/ebayService';

export const KA_PROFILE_URL_KEY = 'kleinanzeigen_seller_profile_url_v1';
export const KA_LISTING_TITLES_KEY = 'kleinanzeigen_listing_titles_v1';
export const LISTING_PRESENCE_META_KEY = 'listing_presence_sync_meta_v1';

export type ListingTitleHit = {
  title: string;
  url?: string;
  listingId?: string;
};

export type ListingPresenceMeta = {
  ebaySyncedAt?: string;
  kaSyncedAt?: string;
  ebayTitleCount?: number;
  kaTitleCount?: number;
};

const MIN_EBAY_SCORE = 40;
const MIN_KA_SIM = 0.42;

export function loadKaProfileUrl(): string {
  try {
    return (localStorage.getItem(KA_PROFILE_URL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveKaProfileUrl(url: string): void {
  localStorage.setItem(KA_PROFILE_URL_KEY, url.trim());
}

export function loadKaListingTitles(): ListingTitleHit[] {
  try {
    const raw = localStorage.getItem(KA_LISTING_TITLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ListingTitleHit[];
    return Array.isArray(parsed) ? parsed.filter((t) => t?.title?.trim()) : [];
  } catch {
    return [];
  }
}

export function saveKaListingTitles(titles: ListingTitleHit[]): void {
  localStorage.setItem(KA_LISTING_TITLES_KEY, JSON.stringify(titles));
}

export function loadListingPresenceMeta(): ListingPresenceMeta {
  try {
    const raw = localStorage.getItem(LISTING_PRESENCE_META_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ListingPresenceMeta;
  } catch {
    return {};
  }
}

function saveListingPresenceMeta(meta: ListingPresenceMeta): void {
  localStorage.setItem(LISTING_PRESENCE_META_KEY, JSON.stringify(meta));
}

function isActiveStock(item: InventoryItem): boolean {
  return (
    item.status === ItemStatus.IN_STOCK ||
    item.status === ItemStatus.ORDERED ||
    item.status === ItemStatus.IN_COMPOSITION
  );
}

/** Best title match for an inventory name against a list of listing titles. */
export function bestTitleMatch(
  itemName: string,
  titles: ListingTitleHit[],
  opts?: { sku?: string }
): { hit: ListingTitleHit; score: number } | null {
  const name = (itemName || '').trim();
  if (name.length < 3 || !titles.length) return null;
  let best: { hit: ListingTitleHit; score: number } | null = null;
  for (const hit of titles) {
    const score = scoreListingTitleMatch(name, hit.title, undefined, opts?.sku);
    const simBoost = nameSimilarity(name, hit.title) * 80;
    const combined = Math.max(score, simBoost);
    if (!best || combined > best.score) best = { hit, score: combined };
  }
  return best && best.score >= MIN_EBAY_SCORE ? best : null;
}

export function bestKaTitleMatch(
  itemName: string,
  titles: ListingTitleHit[]
): { hit: ListingTitleHit; sim: number } | null {
  const name = (itemName || '').trim();
  if (name.length < 3 || !titles.length) return null;
  let best: { hit: ListingTitleHit; sim: number } | null = null;
  for (const hit of titles) {
    const sim = nameSimilarity(name, hit.title);
    if (!best || sim > best.sim) best = { hit, sim };
  }
  return best && best.sim >= MIN_KA_SIM ? best : null;
}

/**
 * Apply eBay active listings → listedOnEbay / ebayListingId / listedViaParent.
 */
export function applyEbayPresenceToItems(
  items: InventoryItem[],
  listings: EbayMyListing[]
): InventoryItem[] {
  const titles: ListingTitleHit[] = listings.map((l) => ({
    title: l.title || '',
    url: l.listingUrl,
    listingId: l.listingId,
  }));
  const matchedListingIds = new Set<string>();
  const parentMatched = new Set<string>();

  const next = items.map((item) => {
    if (!isActiveStock(item)) return item;
    if (item.isPC || item.isBundle) {
      const m = bestTitleMatch(item.name, titles, { sku: item.ebaySku });
      if (m) {
        parentMatched.add(item.id);
        if (m.hit.listingId) matchedListingIds.add(m.hit.listingId);
        return {
          ...item,
          listedOnEbay: true,
          listedViaParent: false,
          ebayListingId: m.hit.listingId || item.ebayListingId,
          listingPresenceSyncedAt: new Date().toISOString(),
        };
      }
      return {
        ...item,
        listedOnEbay: false,
        listedViaParent: false,
        listingPresenceSyncedAt: new Date().toISOString(),
      };
    }
    // Leaves: direct match first
    const m = bestTitleMatch(item.name, titles, { sku: item.ebaySku });
    if (m) {
      if (m.hit.listingId) matchedListingIds.add(m.hit.listingId);
      return {
        ...item,
        listedOnEbay: true,
        listedViaParent: false,
        ebayListingId: m.hit.listingId || item.ebayListingId,
        listingPresenceSyncedAt: new Date().toISOString(),
      };
    }
    return {
      ...item,
      listedOnEbay: false,
      listingPresenceSyncedAt: new Date().toISOString(),
    };
  });

  // Children of matched kits → listedViaParent
  return next.map((item) => {
    if (!item.parentContainerId) return item;
    if (parentMatched.has(item.parentContainerId) && !item.listedOnEbay) {
      return { ...item, listedViaParent: true, listedOnEbay: true };
    }
    if (!parentMatched.has(item.parentContainerId || '')) {
      return { ...item, listedViaParent: false };
    }
    return item;
  });
}

/**
 * Apply KA title snapshot → listedOnKleinanzeigen / listedViaParent.
 */
export function applyKaPresenceToItems(
  items: InventoryItem[],
  titles: ListingTitleHit[]
): InventoryItem[] {
  const parentMatched = new Set<string>();

  const next = items.map((item) => {
    if (!isActiveStock(item)) return item;
    if (item.isPC || item.isBundle) {
      const m = bestKaTitleMatch(item.name, titles);
      if (m) {
        parentMatched.add(item.id);
        return {
          ...item,
          listedOnKleinanzeigen: true,
          listedViaParent: item.listedViaParent,
          kleinanzeigenListingUrl: m.hit.url || item.kleinanzeigenListingUrl,
          listingPresenceSyncedAt: new Date().toISOString(),
        };
      }
      return {
        ...item,
        listedOnKleinanzeigen: false,
        listingPresenceSyncedAt: new Date().toISOString(),
      };
    }
    const m = bestKaTitleMatch(item.name, titles);
    if (m) {
      return {
        ...item,
        listedOnKleinanzeigen: true,
        listedViaParent: false,
        kleinanzeigenListingUrl: m.hit.url || item.kleinanzeigenListingUrl,
        listingPresenceSyncedAt: new Date().toISOString(),
      };
    }
    return {
      ...item,
      listedOnKleinanzeigen: false,
      listingPresenceSyncedAt: new Date().toISOString(),
    };
  });

  return next.map((item) => {
    if (!item.parentContainerId) return item;
    if (parentMatched.has(item.parentContainerId) && !item.listedOnKleinanzeigen) {
      return {
        ...item,
        listedViaParent: true,
        listedOnKleinanzeigen: true,
      };
    }
    return item;
  });
}

export function markPresenceMeta(partial: ListingPresenceMeta): void {
  saveListingPresenceMeta({ ...loadListingPresenceMeta(), ...partial });
}

/** Parse pasted KA titles (one per line, optional "title | url"). */
export function parseKaTitlesPaste(text: string): ListingTitleHit[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.split('|').map((s) => s.trim());
      if (pipe.length >= 2 && pipe[1].startsWith('http')) {
        return { title: pipe[0], url: pipe[1] };
      }
      return { title: line };
    });
}
