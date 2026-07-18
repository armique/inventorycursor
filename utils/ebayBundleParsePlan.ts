import { InventoryItem, ItemStatus } from '../types';
import type { EbayMyListing } from '../services/ebayService';
import { scoreListingTitleMatch } from './ebayListingMatch';
import {
  isGraphicsCardItem,
  isMotherboardItem,
  isProcessorItem,
} from './builderSlotMatch';
import { buildContainerTitle, type BuildTitleKind } from './buildTitle';

export type EbayBundlePartRole = 'mobo' | 'cpu' | 'ram' | 'gpu' | 'storage' | 'other';

export interface EbayBundlePartMatch {
  item: InventoryItem;
  role: EbayBundlePartRole;
  score: number;
}

export interface EbayBundleSuggestion {
  id: string;
  listing: EbayMyListing;
  parts: EbayBundlePartMatch[];
  /** Auto title from matched parts */
  suggestedName: string;
  kind: 'bundle' | 'mixed';
  preferAufrustkit: boolean;
  confidence: number;
  warnings: string[];
}

export interface EbayBundleParsePlan {
  suggestions: EbayBundleSuggestion[];
  skippedBundleListings: EbayMyListing[];
  /** Bundle-like listings already linked to an inventory container */
  alreadyBundled: EbayMyListing[];
  activeListingCount: number;
  freePartCount: number;
}

const MIN_PART_SCORE = 48;
const MIN_PARTS = 2;

function isRamItem(item: InventoryItem): boolean {
  return (
    item.subCategory === 'RAM' ||
    item.category === 'RAM' ||
    /\b(ddr[2345]|dimm|\d+\s*gb.*mhz)\b/i.test(item.name || '')
  );
}

function isStorageItem(item: InventoryItem): boolean {
  return (
    item.subCategory === 'Storage (SSD/HDD)' ||
    /\b(ssd|hdd|nvme|m\.2)\b/i.test(item.name || '')
  );
}

function roleForItem(item: InventoryItem): EbayBundlePartRole {
  if (isMotherboardItem(item)) return 'mobo';
  if (isProcessorItem(item)) return 'cpu';
  if (isRamItem(item)) return 'ram';
  if (isGraphicsCardItem(item)) return 'gpu';
  if (isStorageItem(item)) return 'storage';
  return 'other';
}

/** Listing looks like a PC Bundle / Aufrustkit / assembled kit (not a single leaf part). */
export function isBundleLikeEbayListing(listing: EbayMyListing): boolean {
  const t = listing.title || '';
  const lower = t.toLowerCase();
  if (/\bpc\s*bundle\b|\baufrustkit\b|\baufrüstkit\b|\bmixed\s*bundle\b|\baufrüst[\s-]?kit\b/.test(lower)) {
    return true;
  }
  const hasMobo =
    /\b(mainboard|motherboard|mobo)\b/i.test(t) ||
    /\b(?:a|b|h|x|z)\d{2,3}[a-z]?(?:-[a-z0-9]+)?\b/i.test(t);
  const hasCpu = /\bi[3579][\s-]?\d{3,5}k?\b|\bryzen\s*[3579]\s*\d{3,4}|\br[3579]\s*\d{3,4}/i.test(t);
  const hasRam = /\b\d+\s*gb\b/i.test(t) && /\bddrr?[2345]\b/i.test(t);
  return (hasMobo && hasCpu) || (hasMobo && hasRam && hasCpu);
}

export function isFreeBundlePart(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if (item.isPC || item.isBundle || item.parentContainerId) return false;
  if (item.isDefective) return false;
  return Boolean(item.name?.trim());
}

function listingAlreadyBundled(listing: EbayMyListing, items: InventoryItem[]): boolean {
  return items.some(
    (i) =>
      (i.isBundle || i.isPC) &&
      i.ebayListingId &&
      i.ebayListingId === listing.listingId
  );
}

function preferAufrustkitFromTitle(title: string): boolean {
  return /aufrustkit|aufrüstkit|aufrüst[\s-]?kit/i.test(title);
}

function kindFromTitle(title: string): 'bundle' | 'mixed' {
  if (/mixed\s*bundle/i.test(title)) return 'mixed';
  return 'bundle';
}

function estimateRamStickCount(title: string): number {
  const m = title.match(/(\d+)\s*[x×]\s*\d+\s*gb/i);
  if (m) return Math.min(4, Math.max(1, parseInt(m[1]!, 10)));
  if (/\b2\s*x\b|\b2x\b/i.test(title)) return 2;
  if (/\b4\s*x\b|\b4x\b/i.test(title)) return 4;
  return 1;
}

/**
 * Match free inventory parts into an eBay bundle-like listing.
 * Picks best mobo/cpu/gpu/storage + up to N RAM sticks; greedy by score.
 */
export function matchPartsForBundleListing(
  listing: EbayMyListing,
  freeParts: InventoryItem[],
  usedIds: Set<string>
): EbayBundlePartMatch[] {
  const scored = freeParts
    .filter((p) => !usedIds.has(p.id))
    .map((item) => ({
      item,
      role: roleForItem(item),
      score: scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku),
    }))
    .filter((x) => x.score >= MIN_PART_SCORE)
    .sort((a, b) => b.score - a.score);

  const picked: EbayBundlePartMatch[] = [];
  const takeBest = (role: EbayBundlePartRole) => {
    const hit = scored.find(
      (s) => s.role === role && !picked.some((p) => p.item.id === s.item.id)
    );
    if (hit) picked.push(hit);
  };

  takeBest('mobo');
  takeBest('cpu');
  takeBest('gpu');
  takeBest('storage');

  const ramNeed = estimateRamStickCount(listing.title);
  const ramCandidates = scored.filter(
    (s) => s.role === 'ram' && !picked.some((p) => p.item.id === s.item.id)
  );
  for (const ram of ramCandidates.slice(0, ramNeed)) {
    picked.push(ram);
  }

  // If still thin, add high-scoring "other" only when we already have a core part
  if (picked.length < MIN_PARTS) {
    for (const s of scored) {
      if (picked.some((p) => p.item.id === s.item.id)) continue;
      if (s.role === 'other' && s.score < 70) continue;
      picked.push(s);
      if (picked.length >= MIN_PARTS) break;
    }
  }

  return picked;
}

export function buildEbayBundleParsePlan(
  items: InventoryItem[],
  listings: EbayMyListing[]
): EbayBundleParsePlan {
  const freeParts = items.filter(isFreeBundlePart);
  const bundleListings = listings.filter(isBundleLikeEbayListing);

  const alreadyBundled: EbayMyListing[] = [];
  const candidates: EbayMyListing[] = [];
  for (const listing of bundleListings) {
    if (listingAlreadyBundled(listing, items)) alreadyBundled.push(listing);
    else candidates.push(listing);
  }

  // Rank listings by how many strong part matches exist (raw, before greedy)
  const ranked = candidates
    .map((listing) => {
      const preview = matchPartsForBundleListing(listing, freeParts, new Set());
      const scoreSum = preview.reduce((s, p) => s + p.score, 0);
      return { listing, preview, scoreSum };
    })
    .filter((x) => x.preview.length >= MIN_PARTS)
    .sort((a, b) => b.scoreSum - a.scoreSum);

  const usedIds = new Set<string>();
  const suggestions: EbayBundleSuggestion[] = [];
  const skippedBundleListings: EbayMyListing[] = [];

  for (const row of ranked) {
    const parts = matchPartsForBundleListing(row.listing, freeParts, usedIds);
    const hasCore = parts.some((p) => p.role === 'mobo' || p.role === 'cpu');
    if (parts.length < MIN_PARTS || !hasCore) {
      skippedBundleListings.push(row.listing);
      continue;
    }

    for (const p of parts) usedIds.add(p.item.id);

    const preferAufrustkit = preferAufrustkitFromTitle(row.listing.title);
    const kind = kindFromTitle(row.listing.title);
    const titleKind: BuildTitleKind = kind === 'mixed' ? 'mixed' : 'bundle';
    const partItems = parts.map((p) => p.item);
    const suggestedName = buildContainerTitle(titleKind, partItems, { preferAufrustkit });
    const avg = parts.reduce((s, p) => s + p.score, 0) / parts.length;
    const confidence = Math.min(99, Math.round(avg / 10 + parts.length * 8));

    const warnings: string[] = [];
    if (!parts.some((p) => p.role === 'mobo')) warnings.push('No motherboard matched in inventory');
    if (!parts.some((p) => p.role === 'cpu')) warnings.push('No CPU matched in inventory');
    if (!parts.some((p) => p.role === 'ram')) warnings.push('No RAM matched in inventory');
    if (parts.some((p) => p.score < 60)) warnings.push('Some parts matched weakly — review before confirm');

    suggestions.push({
      id: `ebay-bundle-${row.listing.listingId}`,
      listing: row.listing,
      parts,
      suggestedName,
      kind,
      preferAufrustkit,
      confidence,
      warnings,
    });
  }

  // Bundle-like listings with no usable inventory match
  for (const listing of candidates) {
    if (suggestions.some((s) => s.listing.listingId === listing.listingId)) continue;
    if (skippedBundleListings.some((l) => l.listingId === listing.listingId)) continue;
    skippedBundleListings.push(listing);
  }

  return {
    suggestions,
    skippedBundleListings,
    alreadyBundled,
    activeListingCount: listings.length,
    freePartCount: freeParts.length,
  };
}
