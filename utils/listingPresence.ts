/**
 * Listing presence: match inventory names to your live KA / eBay listing titles.
 * Only updates the sale-ready / already-linked watchlist — never the whole inventory.
 */

import type { InventoryItem } from '../types';
import { scoreListingTitleMatch } from './ebayListingMatch';
import { nameSimilarity } from './inventorySoldComps';
import type { EbayMyListing } from '../services/ebayService';
import { isListingWatchCandidate } from './listingWatch';
import { roundMoney } from '../services/financialAggregation';

export const KA_PROFILE_URL_KEY = 'kleinanzeigen_seller_profile_url_v1';
export const KA_LISTING_TITLES_KEY = 'kleinanzeigen_listing_titles_v1';
export const LISTING_PRESENCE_META_KEY = 'listing_presence_sync_meta_v1';

export type ListingTitleHit = {
  title: string;
  url?: string;
  listingId?: string;
  /** Live ask price when known (€). */
  price?: number;
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

function findListingPrice(
  listings: EbayMyListing[],
  listingId?: string
): number | undefined {
  if (!listingId) return undefined;
  const hit = listings.find((l) => l.listingId === listingId);
  const p = hit?.price;
  return p != null && p > 0 ? roundMoney(p) : undefined;
}

/**
 * Apply eBay active listings → listedOnEbay / liveEbayListPrice for watchlist only.
 */
export function applyEbayPresenceToItems(
  items: InventoryItem[],
  listings: EbayMyListing[]
): InventoryItem[] {
  const titles: ListingTitleHit[] = listings.map((l) => ({
    title: l.title || '',
    url: l.listingUrl,
    listingId: l.listingId,
    price: l.price != null && l.price > 0 ? roundMoney(l.price) : undefined,
  }));
  const parentMatched = new Set<string>();
  const syncedAt = new Date().toISOString();

  const next = items.map((item) => {
    if (!isListingWatchCandidate(item)) return item;

    const m = bestTitleMatch(item.name, titles, { sku: item.ebaySku });
    if (m) {
      if (item.isPC || item.isBundle) parentMatched.add(item.id);
      const live =
        m.hit.price ?? findListingPrice(listings, m.hit.listingId || item.ebayListingId);
      return {
        ...item,
        listedOnEbay: true,
        listedViaParent: false,
        ebayListingId: m.hit.listingId || item.ebayListingId,
        liveEbayListPrice: live ?? item.liveEbayListPrice,
        liveListingPriceSyncedAt: live != null ? syncedAt : item.liveListingPriceSyncedAt,
        listingPresenceSyncedAt: syncedAt,
      };
    }

    return {
      ...item,
      listedOnEbay: false,
      listedViaParent: false,
      liveEbayListPrice: undefined,
      listingPresenceSyncedAt: syncedAt,
    };
  });

  // Children of matched kits (even if not personally on watchlist) get via-parent flags.
  return next.map((item) => {
    if (!item.parentContainerId) return item;
    if (!parentMatched.has(item.parentContainerId)) {
      if (item.listedViaParent && item.listedOnEbay) {
        return { ...item, listedViaParent: false };
      }
      return item;
    }
    if (!item.listedOnEbay || item.listedViaParent) {
      return {
        ...item,
        listedViaParent: true,
        listedOnEbay: true,
        listingPresenceSyncedAt: syncedAt,
      };
    }
    return item;
  });
}

/**
 * Apply KA title/price snapshot → listedOnKleinanzeigen / liveKleinListPrice for watchlist only.
 */
export function applyKaPresenceToItems(
  items: InventoryItem[],
  titles: ListingTitleHit[]
): InventoryItem[] {
  const parentMatched = new Set<string>();
  const syncedAt = new Date().toISOString();

  const next = items.map((item) => {
    if (!isListingWatchCandidate(item)) return item;

    const m = bestKaTitleMatch(item.name, titles);
    if (m) {
      if (item.isPC || item.isBundle) parentMatched.add(item.id);
      const live = m.hit.price != null && m.hit.price > 0 ? roundMoney(m.hit.price) : undefined;
      return {
        ...item,
        listedOnKleinanzeigen: true,
        listedViaParent: false,
        kleinanzeigenListingUrl: m.hit.url || item.kleinanzeigenListingUrl,
        liveKleinListPrice: live ?? item.liveKleinListPrice,
        liveListingPriceSyncedAt: live != null ? syncedAt : item.liveListingPriceSyncedAt,
        listingPresenceSyncedAt: syncedAt,
      };
    }

    return {
      ...item,
      listedOnKleinanzeigen: false,
      liveKleinListPrice: undefined,
      listingPresenceSyncedAt: syncedAt,
    };
  });

  return next.map((item) => {
    if (!item.parentContainerId) return item;
    if (!parentMatched.has(item.parentContainerId)) return item;
    if (!item.listedOnKleinanzeigen || item.listedViaParent) {
      return {
        ...item,
        listedViaParent: true,
        listedOnKleinanzeigen: true,
        listingPresenceSyncedAt: syncedAt,
      };
    }
    return item;
  });
}

export function markPresenceMeta(partial: ListingPresenceMeta): void {
  saveListingPresenceMeta({ ...loadListingPresenceMeta(), ...partial });
}

/**
 * Parse pasted KA lines.
 * Formats:
 *   Title
 *   Title | https://…
 *   Title | 49
 *   Title | 49 | https://…
 *   Title | €49,00 | https://…
 */
export function parseKaTitlesPaste(text: string): ListingTitleHit[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (pipe.length === 1) return { title: pipe[0] };

      let title = pipe[0];
      let url: string | undefined;
      let price: number | undefined;

      for (let i = 1; i < pipe.length; i++) {
        const part = pipe[i];
        if (/^https?:\/\//i.test(part)) {
          url = part;
          continue;
        }
        const parsed = parseEuroPrice(part);
        if (parsed != null) {
          price = parsed;
          continue;
        }
        // Unexpected segment — fold into title
        title = `${title} ${part}`.trim();
      }
      return { title, url, price };
    });
}

export function parseEuroPrice(raw: string): number | null {
  const s = String(raw || '')
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(/EUR/gi, '')
    .trim();
  if (!s) return null;
  // 1.234,56 or 1234,56 or 1234.56
  let normalized = s;
  if (/\d+\.\d{3},\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    normalized = s;
  } else {
    normalized = s.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : null;
}
