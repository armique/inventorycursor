/**
 * Listing presence: match inventory names to your live KA / eBay listing titles.
 * Fuzzy title scoring + learned aliases (manual KA links teach future syncs).
 */

import type { InventoryItem } from '../types';
import { normalizeListingText, scoreListingTitleMatch } from './ebayListingMatch';
import { nameSimilarity, productModelKeys, soldCompsModelCompatible } from './inventorySoldComps';
import type { EbayMyListing } from '../services/ebayService';
import { isListingPresenceEligible, isListingWatchCandidate } from './listingWatch';
import { roundMoney } from '../services/financialAggregation';

export const KA_PROFILE_URL_KEY = 'kleinanzeigen_seller_profile_url_v1';
export const KA_LISTING_TITLES_KEY = 'kleinanzeigen_listing_titles_v1';
export const LISTING_PRESENCE_META_KEY = 'listing_presence_sync_meta_v1';
export const KA_TITLE_ALIASES_KEY = 'kleinanzeigen_title_aliases_v1';

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

/** Manual / auto links that teach future KA title recognition. */
export type KaTitleAlias = {
  itemId: string;
  itemName: string;
  listingTitle: string;
  url?: string;
  learnedAt: string;
};

const MIN_EBAY_SCORE = 40;
/** Auto-link threshold for combined fuzzy score (0–1). */
const MIN_KA_SIM = 0.36;
/** Slightly looser when the user manually marks KA listed (teaching). */
const MIN_KA_LEARN = 0.28;
/** Strong enough to treat a learned alias as a forced match. */
const MIN_KA_ALIAS = 0.72;

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

export function loadKaTitleAliases(): KaTitleAlias[] {
  try {
    const raw = localStorage.getItem(KA_TITLE_ALIASES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KaTitleAlias[];
    return Array.isArray(parsed)
      ? parsed.filter((a) => a?.itemId && a?.listingTitle?.trim())
      : [];
  } catch {
    return [];
  }
}

function saveKaTitleAliases(aliases: KaTitleAlias[]): void {
  localStorage.setItem(KA_TITLE_ALIASES_KEY, JSON.stringify(aliases.slice(-400)));
}

/** Remember that this inventory row belongs to a KA listing title. */
export function learnKaTitleAlias(
  itemId: string,
  itemName: string,
  listingTitle: string,
  url?: string
): void {
  const title = (listingTitle || '').trim();
  if (!itemId || title.length < 5) return;
  const normTitle = normalizeKaCompareKey(title);
  const prev = loadKaTitleAliases().filter(
    (a) => !(a.itemId === itemId && normalizeKaCompareKey(a.listingTitle) === normTitle)
  );
  prev.push({
    itemId,
    itemName: (itemName || '').trim() || title,
    listingTitle: title,
    url,
    learnedAt: new Date().toISOString(),
  });
  saveKaTitleAliases(prev);
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
 * Tolerates marketing suffixes, punctuation, and partial reorderings.
 */
export function scoreKaTitleMatch(itemName: string, listingTitle: string): number {
  const a = stripKaFluff(itemName);
  const b = stripKaFluff(listingTitle);
  if (a.length < 3 || b.length < 3) return 0;

  const qModels = productModelKeys(a);
  const cModels = productModelKeys(b);
  if (qModels.length && cModels.length && !soldCompsModelCompatible(a, b)) {
    // Soften: allow if any model key is a substring of the other (B450 vs B450M)
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
  titles: ListingTitleHit[],
  opts?: { minScore?: number; itemId?: string }
): { hit: ListingTitleHit; sim: number } | null {
  const name = (itemName || '').trim();
  if (name.length < 3 || !titles.length) return null;
  const minScore = opts?.minScore ?? MIN_KA_SIM;
  const aliases = opts?.itemId
    ? loadKaTitleAliases().filter((a) => a.itemId === opts.itemId)
    : [];

  let best: { hit: ListingTitleHit; sim: number } | null = null;
  for (const hit of titles) {
    let sim = scoreKaTitleMatch(name, hit.title);
    for (const alias of aliases) {
      const aliasHit = scoreKaTitleMatch(alias.listingTitle, hit.title);
      const aliasName = scoreKaTitleMatch(alias.itemName, hit.title);
      if (aliasHit >= MIN_KA_ALIAS || normalizeKaCompareKey(alias.listingTitle) === normalizeKaCompareKey(hit.title)) {
        sim = Math.max(sim, 0.95);
      } else {
        sim = Math.max(sim, aliasHit * 0.98, aliasName);
      }
    }
    if (!best || sim > best.sim) best = { hit, sim };
  }
  return best && best.sim >= minScore ? best : null;
}

/**
 * When the user manually marks KA listed, pick the closest scraped title
 * (looser threshold) and remember the pairing for next sync.
 */
export function teachKaListingFromManualLink(
  item: Pick<InventoryItem, 'id' | 'name'>,
  titles?: ListingTitleHit[]
): ListingTitleHit | null {
  const pool = titles?.length ? titles : loadKaListingTitles();
  const m = bestKaTitleMatch(item.name, pool, {
    itemId: item.id,
    minScore: MIN_KA_LEARN,
  });
  if (!m) return null;
  learnKaTitleAlias(item.id, item.name, m.hit.title, m.hit.url);
  return m.hit;
}

/**
 * Greedy 1:1 assignment — each KA title links to at most one inventory item.
 * Prefers learned aliases, then highest fuzzy score.
 */
export function assignKaTitlesToItems(
  items: InventoryItem[],
  titles: ListingTitleHit[]
): Map<string, { hit: ListingTitleHit; sim: number }> {
  const eligible = items.filter(isListingPresenceEligible);
  const aliases = loadKaTitleAliases();
  const aliasByItem = new Map<string, KaTitleAlias[]>();
  for (const a of aliases) {
    const list = aliasByItem.get(a.itemId) || [];
    list.push(a);
    aliasByItem.set(a.itemId, list);
  }

  type Pair = { itemId: string; titleIdx: number; sim: number; hit: ListingTitleHit };
  const pairs: Pair[] = [];

  for (const item of eligible) {
    const itemAliases = aliasByItem.get(item.id) || [];
    titles.forEach((hit, titleIdx) => {
      let sim = scoreKaTitleMatch(item.name, hit.title);
      for (const alias of itemAliases) {
        if (normalizeKaCompareKey(alias.listingTitle) === normalizeKaCompareKey(hit.title)) {
          sim = Math.max(sim, 0.99);
        } else {
          sim = Math.max(sim, scoreKaTitleMatch(alias.listingTitle, hit.title) * 0.98);
        }
      }
      // Cross-learn: same listing title taught under a renamed item name
      for (const alias of aliases) {
        if (alias.itemId === item.id) continue;
        if (normalizeKaCompareKey(alias.listingTitle) !== normalizeKaCompareKey(hit.title)) continue;
        if (scoreKaTitleMatch(item.name, alias.itemName) >= 0.7) {
          sim = Math.max(sim, 0.9);
        }
      }
      if (sim >= MIN_KA_SIM) pairs.push({ itemId: item.id, titleIdx, sim, hit });
    });
  }

  pairs.sort((a, b) => b.sim - a.sim);
  const usedItems = new Set<string>();
  const usedTitles = new Set<number>();
  const out = new Map<string, { hit: ListingTitleHit; sim: number }>();
  for (const p of pairs) {
    if (usedItems.has(p.itemId) || usedTitles.has(p.titleIdx)) continue;
    usedItems.add(p.itemId);
    usedTitles.add(p.titleIdx);
    out.set(p.itemId, { hit: p.hit, sim: p.sim });
  }
  return out;
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

function mergeMaybeSold(
  prev: InventoryItem['maybeSoldHint'],
  channel: 'ebay' | 'kleinanzeigen'
): InventoryItem['maybeSoldHint'] {
  if (!prev) return channel;
  if (prev === 'both') return 'both';
  if (prev === channel) return channel;
  return 'both';
}

function clearMaybeSoldChannel(
  prev: InventoryItem['maybeSoldHint'],
  channel: 'ebay' | 'kleinanzeigen'
): InventoryItem['maybeSoldHint'] | undefined {
  if (!prev) return undefined;
  if (prev === channel) return undefined;
  if (prev === 'both') return channel === 'ebay' ? 'kleinanzeigen' : 'ebay';
  return prev;
}

/**
 * Match eBay active listings against all eligible in-stock items.
 * Auto-marks matches as saleReady. Only clears / maybe-sold for items that were
 * previously listed or already on the Ready watchlist (never mass-unlists stock).
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
    if (!isListingPresenceEligible(item)) return item;

    const m = bestTitleMatch(item.name, titles, { sku: item.ebaySku });
    if (m) {
      if (item.isPC || item.isBundle) parentMatched.add(item.id);
      const live =
        m.hit.price ?? findListingPrice(listings, m.hit.listingId || item.ebayListingId);
      const cleared = clearMaybeSoldChannel(item.maybeSoldHint, 'ebay');
      return {
        ...item,
        saleReady: true,
        listedOnEbay: true,
        listedViaParent: false,
        ebayListingId: m.hit.listingId || item.ebayListingId,
        liveEbayListPrice: live ?? item.liveEbayListPrice,
        liveListingPriceSyncedAt: live != null ? syncedAt : item.liveListingPriceSyncedAt,
        listingPresenceSyncedAt: syncedAt,
        maybeSoldHint: cleared,
        listingDisappearedAt: cleared ? item.listingDisappearedAt : undefined,
        maybeSoldDismissedAt: cleared ? item.maybeSoldDismissedAt : undefined,
      };
    }

    // Don't touch non-watch items that never matched — avoid wiping whole inventory.
    if (!isListingWatchCandidate(item)) return item;

    const wasListed =
      item.listedOnEbay === true ||
      Boolean(item.ebayListingId) ||
      item.liveEbayListPrice != null;
    if (wasListed && !item.maybeSoldDismissedAt) {
      return {
        ...item,
        listedOnEbay: false,
        listedViaParent: false,
        liveEbayListPrice: undefined,
        listingPresenceSyncedAt: syncedAt,
        maybeSoldHint: mergeMaybeSold(item.maybeSoldHint, 'ebay'),
        listingDisappearedAt: item.listingDisappearedAt || syncedAt,
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

  // Children of matched kits get via-parent flags.
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
        maybeSoldHint: clearMaybeSoldChannel(item.maybeSoldHint, 'ebay'),
      };
    }
    return item;
  });
}

/**
 * Match KA title/price snapshot against all eligible in-stock items.
 * Uses fuzzy scoring + learned aliases, unique 1:1 title assignment.
 * Auto-marks matches as saleReady. Only clears / maybe-sold for watchlist items.
 */
export function applyKaPresenceToItems(
  items: InventoryItem[],
  titles: ListingTitleHit[]
): InventoryItem[] {
  const parentMatched = new Set<string>();
  const syncedAt = new Date().toISOString();
  const assigned = assignKaTitlesToItems(items, titles);

  const next = items.map((item) => {
    if (!isListingPresenceEligible(item)) return item;

    const m = assigned.get(item.id);
    if (m) {
      if (item.isPC || item.isBundle) parentMatched.add(item.id);
      learnKaTitleAlias(item.id, item.name, m.hit.title, m.hit.url);
      const live = m.hit.price != null && m.hit.price > 0 ? roundMoney(m.hit.price) : undefined;
      const cleared = clearMaybeSoldChannel(item.maybeSoldHint, 'kleinanzeigen');
      return {
        ...item,
        saleReady: true,
        listedOnKleinanzeigen: true,
        listedViaParent: false,
        kleinanzeigenListingUrl: m.hit.url || item.kleinanzeigenListingUrl,
        liveKleinListPrice: live ?? item.liveKleinListPrice,
        liveListingPriceSyncedAt: live != null ? syncedAt : item.liveListingPriceSyncedAt,
        listingPresenceSyncedAt: syncedAt,
        maybeSoldHint: cleared,
        listingDisappearedAt: cleared ? item.listingDisappearedAt : undefined,
        maybeSoldDismissedAt: cleared ? item.maybeSoldDismissedAt : undefined,
      };
    }

    if (!isListingWatchCandidate(item)) return item;

    const wasListed =
      item.listedOnKleinanzeigen === true ||
      Boolean(item.kleinanzeigenListingUrl) ||
      item.liveKleinListPrice != null;
    if (wasListed && !item.maybeSoldDismissedAt) {
      return {
        ...item,
        listedOnKleinanzeigen: false,
        liveKleinListPrice: undefined,
        listingPresenceSyncedAt: syncedAt,
        maybeSoldHint: mergeMaybeSold(item.maybeSoldHint, 'kleinanzeigen'),
        listingDisappearedAt: item.listingDisappearedAt || syncedAt,
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
        maybeSoldHint: clearMaybeSoldChannel(item.maybeSoldHint, 'kleinanzeigen'),
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
