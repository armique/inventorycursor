/**
 * Kleinanzeigen profile URL + fuzzy title matching for photo import.
 */

import { normalizeListingText, scoreListingTitleMatch } from './ebayListingMatch';
import { nameSimilarity, productModelKeys, soldCompsModelCompatible } from './inventorySoldComps';

export const KA_PROFILE_URL_KEY = 'kleinanzeigen_seller_profile_url_v1';
export const KA_LISTING_TITLES_KEY = 'kleinanzeigen_listing_titles_v1';

export type ListingTitleHit = {
  title: string;
  url?: string;
  listingId?: string;
  /** Live ask price when known (€). */
  price?: number;
};

const MIN_KA_SIM = 0.36;

const KA_FLUFF =
  /\b(komplett[\s-]?pc|komplettsystem|gaming[\s-]?pc|office[\s-]?pc|bundel|bundle|set|ovp|neu|wie\s*neu|vb|verhandelbar|euro|eur|inkl\.?|versand|sammelkauf|privat)\b/gi;

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

function stripKaFluff(s: string): string {
  return String(s || '')
    .replace(KA_FLUFF, ' ')
    .replace(/[·•|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKaCompareKey(s: string): string {
  return normalizeListingText(stripKaFluff(s)).replace(/\s+/g, '');
}

function significantTokens(name: string): string[] {
  const stop = new Set([
    'pc',
    'bundle',
    'set',
    'mit',
    'und',
    'fur',
    'fuer',
    'the',
    'and',
    'for',
    'ddr',
    'ddr4',
    'ddr5',
    'gb',
    'tb',
  ]);
  return normalizeListingText(stripKaFluff(name))
    .split(' ')
    .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
}

/**
 * Combined fuzzy score 0–1 for inventory name ↔ KA listing title.
 */
export function scoreKaTitleMatch(itemName: string, listingTitle: string): number {
  const a = stripKaFluff(itemName);
  const b = stripKaFluff(listingTitle);
  if (a.length < 3 || b.length < 3) return 0;

  const qModels = productModelKeys(a);
  const cModels = productModelKeys(b);
  if (qModels.length && cModels.length && !soldCompsModelCompatible(a, b)) {
    const soft = qModels.some((q) =>
      cModels.some((c) => c.includes(q) || q.includes(c))
    );
    if (!soft) return 0;
  }

  const sim = nameSimilarity(a, b);
  const ebayScore = scoreListingTitleMatch(itemName, listingTitle);
  const ebayNorm = Math.min(1, ebayScore / 180);

  const meat = significantTokens(a);
  const listNorm = normalizeListingText(b);
  const listCompact = listNorm.replace(/\s+/g, '');
  let meatHits = 0;
  for (const t of meat) {
    if (listNorm.includes(t) || listCompact.includes(t.replace(/\s+/g, ''))) meatHits += 1;
  }
  const recall = meat.length ? meatHits / meat.length : 0;

  const keyA = normalizeKaCompareKey(a);
  const keyB = normalizeKaCompareKey(b);
  if (keyA && keyB && (keyA.includes(keyB) || keyB.includes(keyA)) && Math.min(keyA.length, keyB.length) >= 12) {
    return Math.max(0.82, sim, ebayNorm, recall);
  }

  let score = Math.max(sim * 0.95, ebayNorm * 0.9, recall * 0.92);
  if (recall >= 0.65 && sim >= 0.3) score = Math.max(score, 0.5);
  if (recall >= 0.8) score = Math.max(score, 0.55);
  if (ebayScore >= 120) score = Math.max(score, 0.48);
  if (ebayScore >= 220) score = Math.max(score, 0.62);
  if (qModels.length) {
    const modelHits = qModels.filter((m) => listCompact.includes(m) || listNorm.includes(m)).length;
    if (modelHits >= Math.min(2, qModels.length)) score = Math.max(score, 0.52);
  }
  return Math.min(1, score);
}

/** Match inventory name to cached Kleinanzeigen listings for photo import. */
export function matchKaListingsForItem<T extends { title: string }>(
  itemName: string,
  listings: T[],
  minSim = MIN_KA_SIM
): Array<T & { matchScore: number }> {
  const name = (itemName || '').trim();
  if (name.length < 3 || !listings.length) return [];
  return listings
    .map((listing) => ({
      ...listing,
      matchScore: Math.round(scoreKaTitleMatch(name, listing.title) * 1000),
    }))
    .filter((listing) => listing.matchScore >= Math.round(minSim * 1000))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 8);
}
