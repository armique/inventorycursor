import { InventoryItem, ItemStatus } from '../types';
import type { EbayMyListing } from '../services/ebayService';
import { scoreListingTitleMatch } from './ebayListingMatch';
import { roundPriceCentsTo99 } from './ebayPrice';

export type EbaySyncMatchKind = 'sku' | 'title' | 'relinked';

export interface EbayStorePullMatch {
  item: InventoryItem;
  listing: EbayMyListing;
  matchScore: number;
  matchKind: EbaySyncMatchKind;
  warning?: string;
}

export interface EbayStorePullPlan {
  matches: EbayStorePullMatch[];
  unmatchedItems: InventoryItem[];
  unusedListings: EbayMyListing[];
  /** Listings already linked to items that have a storefront price set. */
  claimedListingCount: number;
  candidateCount: number;
  activeListingCount: number;
}

const MIN_SCORE = 40;
const EXISTING_LINK_BOOST = 2000;

/** In-stock leaf items with no storefront price — not yet pulled from eBay. */
export function isEbayStorePullCandidate(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if (item.isPC || item.isBundle || item.parentContainerId) return false;
  if (item.storePrice != null) return false;
  return Boolean(item.name?.trim());
}

function matchKindFor(item: InventoryItem, listing: EbayMyListing): EbaySyncMatchKind {
  if (item.ebayListingId && item.ebayListingId === listing.listingId) return 'relinked';
  if (
    item.ebaySku &&
    listing.sku &&
    item.ebaySku.trim().toLowerCase() === listing.sku.trim().toLowerCase()
  ) {
    return 'sku';
  }
  return 'title';
}

/**
 * Pair inventory candidates to active eBay listings (one-to-one, highest confidence first).
 * Listings already linked to synced items (storePrice set) are excluded from the pool.
 */
export function buildEbayStorePullPlan(
  items: InventoryItem[],
  listings: EbayMyListing[]
): EbayStorePullPlan {
  const candidates = items.filter(isEbayStorePullCandidate);

  const claimedListingIds = new Set(
    items
      .filter((i) => i.ebayListingId && i.storePrice != null)
      .map((i) => i.ebayListingId as string)
  );

  const availableListings = listings.filter((l) => !claimedListingIds.has(l.listingId));

  type Pair = {
    item: InventoryItem;
    listing: EbayMyListing;
    score: number;
    kind: EbaySyncMatchKind;
  };

  const pairs: Pair[] = [];

  for (const item of candidates) {
    for (const listing of availableListings) {
      const kind = matchKindFor(item, listing);
      let score = scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku);
      if (kind === 'relinked') score += EXISTING_LINK_BOOST;
      if (kind === 'sku' && score < MIN_SCORE) score = 1000;
      if (score >= MIN_SCORE) {
        pairs.push({ item, listing, score, kind });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  const usedItems = new Set<string>();
  const usedListings = new Set<string>();
  const matches: EbayStorePullMatch[] = [];

  for (const pair of pairs) {
    if (usedItems.has(pair.item.id) || usedListings.has(pair.listing.listingId)) continue;

    let warning: string | undefined;
    if (pair.kind === 'title' && pair.score < 120) {
      warning = 'Low confidence title match — confirm this is the right listing.';
    }
    const duplicateNameCount = candidates.filter(
      (c) => c.name.trim().toLowerCase() === pair.item.name.trim().toLowerCase()
    ).length;
    if (duplicateNameCount > 1 && pair.kind !== 'sku') {
      warning = warning
        ? `${warning} Multiple in-stock items share this name.`
        : 'Multiple in-stock items share this name — SKU match is safest.';
    }

    matches.push({
      item: pair.item,
      listing: pair.listing,
      matchScore: pair.score,
      matchKind: pair.kind,
      warning,
    });
    usedItems.add(pair.item.id);
    usedListings.add(pair.listing.listingId);
  }

  return {
    matches,
    unmatchedItems: candidates.filter((i) => !usedItems.has(i.id)),
    unusedListings: availableListings.filter((l) => !usedListings.has(l.listingId)),
    claimedListingCount: claimedListingIds.size,
    candidateCount: candidates.length,
    activeListingCount: listings.length,
  };
}

export function getStorePullRoundedPrice(listing: EbayMyListing): number | undefined {
  if (listing.price == null || listing.price <= 0) return undefined;
  return roundPriceCentsTo99(listing.price);
}

/** Active leaf inventory rows used when checking whether an eBay listing already exists in stock. */
export function getActiveInventoryForEbayMatch(items: InventoryItem[]): InventoryItem[] {
  return items.filter(
    (i) =>
      i.status === ItemStatus.IN_STOCK &&
      !i.isPC &&
      !i.isBundle &&
      !i.parentContainerId &&
      Boolean(i.name?.trim())
  );
}

/** Marketplace fluff / condition words stripped from eBay titles before AI / inventory names. */
const EBAY_TITLE_NOISE_PHRASES = [
  'voll funktionsfähig',
  'voll funktionsfaehig',
  'voll funktionsfahig',
  '100% funktionsfähig',
  '100% funktionsfaehig',
  '100% funktionsfahig',
  'normale gebrauchsspuren',
  'leichte gebrauchsspuren',
  'starke gebrauchsspuren',
  'top zustand',
  'sehr guter zustand',
  'guter zustand',
  'einwandfreier zustand',
  'wie neu',
  'fast neu',
  'zustand',
  'inkl mwst',
  'inkl. mwst',
  'inkl ust',
  'inkl. ust',
  'zzgl versand',
  'inkl versand',
  'versandkostenfrei',
  'kostenloser versand',
  'free shipping',
  'fast dispatch',
  'read description',
  'siehe beschreibung',
  'bitte lesen',
  'bitte beachten',
  'ausgebaut aus',
  'aus pc ausgebaut',
  'aus notebook ausgebaut',
  'nur abholung',
  'privatverkauf',
  'gewerblich',
  'originalverpackung',
  'original verpackt',
  'neu und ovp',
];

const EBAY_TITLE_NOISE_WORDS = [
  'funktionsfähig',
  'funktionsfaehig',
  'funktionsfahig',
  'gebraucht',
  'gebrauchte',
  'gebrauchter',
  'gebrauchtes',
  'neuwertig',
  'neuwertige',
  'defekt',
  'defekte',
  'defekter',
  'defektes',
  'ungetestet',
  'ungetestete',
  'getestet',
  'getestete',
  'geprüft',
  'geprueft',
  'ovp',
  'ovp.',
  'neu',
  'new',
  'refurbished',
  'generalüberholt',
  'generalueberholt',
  'versand',
  'versandfertig',
  'schnellversand',
  'expressversand',
  'sofortversand',
  'sofort',
  'sofortkauf',
  'auktion',
  'snappy',
  'hammerpreis',
  'schnäppchen',
  'schnaeppchen',
  'günstig',
  'guenstig',
  'top',
  'super',
  'mega',
  'krasse',
  'krasser',
  'abholung',
  'abholer',
  'mwst',
  'ust',
  'rechnung',
  'garantie',
  'gewährleistung',
  'gewaehrleistung',
  'sammeln',
  'restposten',
  'b-ware',
  'bware',
  'c-ware',
  '1a',
  '1-a',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip common eBay title noise before AI / category detection.
 * Keeps brand, model, size/capacity — drops condition/shipping fluff
 * (e.g. funktionsfähig, gebraucht, OVP, Versand…).
 */
export function cleanEbayListingTitle(title: string): string {
  let t = String(title || '');
  t = t
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[|/\\•·]+/g, ' ')
    .replace(/[,:;]+/g, ' ');

  for (const phrase of EBAY_TITLE_NOISE_PHRASES) {
    t = t.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi'), ' ');
  }
  for (const word of EBAY_TITLE_NOISE_WORDS) {
    t = t.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi'), ' ');
  }

  // Lone condition emoji / stars / percent fluff
  t = t
    .replace(/[★☆✅❌🔥💥⚡]+/g, ' ')
    .replace(/\b\d{1,3}\s*%\b/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

export function listingMatchesAnyActiveItem(
  listing: EbayMyListing,
  activeItems: InventoryItem[]
): InventoryItem | null {
  for (const item of activeItems) {
    if (item.ebayListingId && item.ebayListingId === listing.listingId) return item;
    if (
      item.ebaySku &&
      listing.sku &&
      item.ebaySku.trim().toLowerCase() === listing.sku.trim().toLowerCase()
    ) {
      return item;
    }
  }

  let best: { item: InventoryItem; score: number } | null = null;
  for (const item of activeItems) {
    const score = scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku);
    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

export interface EbayOrphanListingsPlan {
  orphans: EbayMyListing[];
  activeInventoryCount: number;
  activeListingCount: number;
}

/** eBay listings with no matching in-stock inventory item (candidates to add as new items). */
export function buildEbayOrphanListingsPlan(
  items: InventoryItem[],
  listings: EbayMyListing[]
): EbayOrphanListingsPlan {
  const activeItems = getActiveInventoryForEbayMatch(items);
  const linkedIds = new Set(items.filter((i) => i.ebayListingId).map((i) => i.ebayListingId as string));

  const orphans = listings.filter((listing) => {
    if (linkedIds.has(listing.listingId)) return false;
    return !listingMatchesAnyActiveItem(listing, activeItems);
  });

  return {
    orphans,
    activeInventoryCount: activeItems.length,
    activeListingCount: listings.length,
  };
}
