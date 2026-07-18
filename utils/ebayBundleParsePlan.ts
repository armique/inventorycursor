import { InventoryItem, ItemStatus } from '../types';
import type { EbayMyListing } from '../services/ebayService';
import {
  extractModelTokens,
  normalizeListingText,
  scoreListingTitleMatch,
  titleContainsModel,
} from './ebayListingMatch';
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

const MIN_PART_SCORE = 55;
const MIN_CORE_SCORE = 70;
const MIN_PAD_OTHER_SCORE = 90;
const MIN_PARTS = 2;

const WEAK_TOKENS = new Set([
  'intel',
  'amd',
  'asus',
  'msi',
  'gigabyte',
  'asrock',
  'corsair',
  'kingston',
  'samsung',
  'crucial',
  'pc',
  'bundle',
  'kit',
  'neu',
  'new',
  'gb',
  'tb',
  'mhz',
  'ssd',
  'hdd',
  'ram',
  'ddr',
  'ddr3',
  'ddr4',
  'ddr5',
  'nvme',
  'sata',
  'dimm',
]);

function specStr(item: InventoryItem, ...keys: string[]): string {
  const specs = item.specs || {};
  for (const key of keys) {
    const v = specs[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // Case-insensitive key fallback
  const lowerMap = new Map(
    Object.entries(specs).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase());
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

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

export function roleForBundleItem(item: InventoryItem): EbayBundlePartRole {
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

function listingHasGpuSignal(title: string): boolean {
  return /\b(rtx|gtx|radeon|rx\s?\d{3,5}|grafikkarte|graphics\s*card|gpu)\b/i.test(title);
}

function listingHasStorageSignal(title: string): boolean {
  return /\b(ssd|hdd|nvme|m\.2|m2|\d+\s*(?:gb|tb)\s*(?:ssd|hdd|nvme)?)\b/i.test(title);
}

function extractDdrGen(text: string): number | null {
  const m = text.match(/\bddr\s*([2345])\b/i);
  if (m) return parseInt(m[1]!, 10);
  return null;
}

function extractSocket(text: string): string | null {
  const m = text.match(
    /\b(am[45]|am5|lga\s?\d{3,4}|socket\s?\d{3,4}|fm2\+?|tr4|strx4|sTRX4)\b/i
  );
  if (!m) return null;
  return m[1]!.toLowerCase().replace(/\s+/g, '').replace('socket', 'lga');
}

function normalizeSocket(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/^socket/, '');
}

/** Infer DDR generation from common chipset codes when specs missing. */
function ddrFromChipset(text: string): number | null {
  const t = text.toLowerCase();
  if (/\b(b650|x670|b760|z790|h770|b860|z890)\b/.test(t)) return 5;
  if (/\b(b450|b550|x570|a520|b460|b560|h510|z590|b660|h610|z690|h81|b85|z97|h110|b150|b250|b360|h310|z370|b365)\b/.test(t)) {
    return 4;
  }
  if (/\b(h61|b75|z77|h81|b85|a88|a78|fm2)\b/.test(t) && /\bddr3\b/.test(t)) return 3;
  return null;
}

function itemIdentityText(item: InventoryItem): string {
  return [
    item.name,
    specStr(item, 'Model', 'Series', 'Chipset', 'GPU Series', 'Memory Type', 'Drive Type', 'Capacity'),
  ]
    .filter(Boolean)
    .join(' ');
}

function hasStrongModelHit(item: InventoryItem, title: string): boolean {
  const titleNorm = normalizeListingText(title);
  const identity = itemIdentityText(item);
  const models = extractModelTokens(identity);
  // Prefer non-capacity tokens for "strong" (capacity alone is weak for CPU/mobo)
  const strong = models.filter((m) => !/^\d+(gb|tb)$/i.test(m));
  for (const model of strong) {
    if (titleContainsModel(titleNorm, model)) return true;
  }
  // Spec chipset/model exact-ish
  for (const key of ['Model', 'Chipset', 'Series', 'GPU Series'] as const) {
    const v = specStr(item, key);
    if (v.length >= 3 && titleContainsModel(titleNorm, v)) return true;
  }
  return false;
}

/**
 * Role-aware score for matching a free inventory part to a bundle listing.
 * Uses name + specs; penalizes weak brand/generic-only overlap.
 */
export function scoreBundlePartForListing(
  item: InventoryItem,
  listing: EbayMyListing,
  role: EbayBundlePartRole
): number {
  const title = listing.title || '';
  const titleNorm = normalizeListingText(title);
  if (!titleNorm) return 0;

  // Exact SKU still wins, but only if item is a leaf part SKU (rare for bundles)
  const base = scoreListingTitleMatch(item.name, title, listing.sku, item.ebaySku);
  if (base >= 1000) return base;

  const identity = itemIdentityText(item);
  const models = extractModelTokens(identity);
  let modelHits = 0;
  for (const model of models) {
    if (titleContainsModel(titleNorm, model)) modelHits++;
  }

  const nameTokens = normalizeListingText(item.name)
    .split(' ')
    .filter((t) => t.length > 1 && !WEAK_TOKENS.has(t));
  let meaningfulHits = 0;
  for (const t of nameTokens) {
    if (titleNorm.includes(t) || titleContainsModel(titleNorm, t)) meaningfulHits++;
  }

  let score = 0;
  if (modelHits > 0) score += 320 + Math.min(modelHits * 40, 120);
  if (meaningfulHits > 0) score += Math.min(meaningfulHits * 28, 100);
  // Mild base from generic scorer, capped so weak overlap can't dominate
  score += Math.min(base, 120);

  if (role === 'cpu' || role === 'mobo') {
    if (!hasStrongModelHit(item, title)) {
      // Brand-only / DDR noise is not enough
      return score >= MIN_CORE_SCORE && modelHits + meaningfulHits >= 2 ? Math.min(score, 54) : 0;
    }
    score += 40;
  }

  if (role === 'ram') {
    const titleDdr = extractDdrGen(title);
    const itemDdr =
      extractDdrGen(identity) ||
      extractDdrGen(specStr(item, 'Memory Type', 'Type'));
    if (titleDdr && itemDdr && titleDdr !== itemDdr) return 0;
    if (titleDdr && itemDdr && titleDdr === itemDdr) score += 50;
    // Require DDR gen or capacity+speed signal — not just "16gb"
    const hasDdr = itemDdr != null || /\bddr[2345]\b/i.test(identity);
    const capacityInTitle = /\b\d+\s*gb\b/i.test(title);
    if (!hasDdr && !hasStrongModelHit(item, title)) return 0;
    if (capacityInTitle && /\b\d+\s*gb\b/i.test(identity)) score += 25;
    const speed = specStr(item, 'Speed', 'Frequency');
    if (speed && titleNorm.includes(normalizeListingText(speed).replace(/\s/g, ''))) score += 30;
  }

  if (role === 'storage') {
    if (!listingHasStorageSignal(title)) return 0;
    const cap = specStr(item, 'Capacity') || (identity.match(/\b\d+\s*(?:gb|tb)\b/i)?.[0] ?? '');
    const iface = specStr(item, 'Interface', 'Drive Type') || identity;
    let storageHit = false;
    if (cap) {
      const capCompact = cap.toLowerCase().replace(/\s+/g, '');
      if (titleNorm.replace(/\s/g, '').includes(capCompact) || titleContainsModel(titleNorm, cap)) {
        storageHit = true;
        score += 60;
      }
    }
    if (/\b(nvme|m\.?2|sata)\b/i.test(iface) && /\b(nvme|m\.?2|sata)\b/i.test(title)) {
      storageHit = true;
      score += 35;
    }
    if (!storageHit && !hasStrongModelHit(item, title)) return 0;
  }

  if (role === 'gpu') {
    if (!listingHasGpuSignal(title)) return 0;
    if (!hasStrongModelHit(item, title)) return 0;
    score += 40;
  }

  if (role === 'other') {
    if (!hasStrongModelHit(item, title) && meaningfulHits < 2) return 0;
  }

  return Math.round(score);
}

function applyCompatibilityVetoes(
  picked: EbayBundlePartMatch[],
  listingTitle: string
): { parts: EbayBundlePartMatch[]; warnings: string[] } {
  const warnings: string[] = [];
  let parts = [...picked];

  const mobo = parts.find((p) => p.role === 'mobo');
  const cpu = parts.find((p) => p.role === 'cpu');

  if (mobo && cpu) {
    const moboSock =
      extractSocket(specStr(mobo.item, 'Socket')) ||
      extractSocket(mobo.item.name || '');
    const cpuSock =
      extractSocket(specStr(cpu.item, 'Socket')) ||
      extractSocket(cpu.item.name || '');
    if (moboSock && cpuSock && normalizeSocket(moboSock) !== normalizeSocket(cpuSock)) {
      warnings.push(`Socket mismatch (${cpuSock} vs ${moboSock}) — dropped weaker match`);
      if (cpu.score >= mobo.score) {
        parts = parts.filter((p) => p.item.id !== mobo.item.id);
      } else {
        parts = parts.filter((p) => p.item.id !== cpu.item.id);
      }
    }
  }

  const moboLeft = parts.find((p) => p.role === 'mobo');
  if (moboLeft) {
    const chipText = [
      moboLeft.item.name,
      specStr(moboLeft.item, 'Chipset', 'Model'),
      listingTitle,
    ].join(' ');
    const expectedDdr =
      extractDdrGen(specStr(moboLeft.item, 'Memory Type')) ||
      ddrFromChipset(chipText);
    if (expectedDdr) {
      const before = parts.length;
      parts = parts.filter((p) => {
        if (p.role !== 'ram') return true;
        const ramDdr =
          extractDdrGen(specStr(p.item, 'Memory Type', 'Type')) ||
          extractDdrGen(p.item.name || '');
        if (ramDdr && ramDdr !== expectedDdr) return false;
        return true;
      });
      if (parts.length < before) {
        warnings.push(`Dropped RAM incompatible with DDR${expectedDdr}`);
      }
    }
  }

  return { parts, warnings };
}

/**
 * Match free inventory parts into an eBay bundle-like listing.
 * Role-aware scoring + optional GPU/storage only when title signals them.
 */
export function matchPartsForBundleListing(
  listing: EbayMyListing,
  freeParts: InventoryItem[],
  usedIds: Set<string>
): EbayBundlePartMatch[] {
  const scored = freeParts
    .filter((p) => !usedIds.has(p.id))
    .map((item) => {
      const role = roleForBundleItem(item);
      return {
        item,
        role,
        score: scoreBundlePartForListing(item, listing, role),
      };
    })
    .filter((x) => x.score >= MIN_PART_SCORE)
    .sort((a, b) => b.score - a.score);

  const picked: EbayBundlePartMatch[] = [];
  const takeBest = (role: EbayBundlePartRole, minScore = MIN_PART_SCORE) => {
    const hit = scored.find(
      (s) =>
        s.role === role &&
        s.score >= minScore &&
        !picked.some((p) => p.item.id === s.item.id)
    );
    if (hit) picked.push(hit);
  };

  takeBest('mobo', MIN_CORE_SCORE);
  // Fallback slightly softer if no strong mobo
  if (!picked.some((p) => p.role === 'mobo')) takeBest('mobo', MIN_PART_SCORE);

  takeBest('cpu', MIN_CORE_SCORE);
  if (!picked.some((p) => p.role === 'cpu')) takeBest('cpu', MIN_PART_SCORE);

  if (listingHasGpuSignal(listing.title)) takeBest('gpu', MIN_PART_SCORE);
  if (listingHasStorageSignal(listing.title)) takeBest('storage', MIN_PART_SCORE);

  const ramNeed = estimateRamStickCount(listing.title);
  const ramCandidates = scored.filter(
    (s) => s.role === 'ram' && !picked.some((p) => p.item.id === s.item.id)
  );
  for (const ram of ramCandidates.slice(0, ramNeed)) {
    picked.push(ram);
  }

  if (picked.length < MIN_PARTS) {
    for (const s of scored) {
      if (picked.some((p) => p.item.id === s.item.id)) continue;
      if (s.role === 'other' && s.score < MIN_PAD_OTHER_SCORE) continue;
      if (s.role !== 'other' && s.score < MIN_PART_SCORE) continue;
      picked.push(s);
      if (picked.length >= MIN_PARTS) break;
    }
  }

  const { parts } = applyCompatibilityVetoes(picked, listing.title);
  return parts;
}

/** Rank free parts for a role — used by the manual part picker. */
export function rankFreePartsForListingRole(
  listing: EbayMyListing,
  freeParts: InventoryItem[],
  role: EbayBundlePartRole | 'any',
  excludeIds: Set<string> = new Set(),
  searchQuery = '',
  limit = 40
): EbayBundlePartMatch[] {
  const q = searchQuery.trim().toLowerCase();
  const scored = freeParts
    .filter((p) => !excludeIds.has(p.id))
    .map((item) => {
      const itemRole = roleForBundleItem(item);
      const score =
        role === 'any'
          ? Math.max(
              scoreBundlePartForListing(item, listing, itemRole),
              scoreListingTitleMatch(item.name, listing.title, listing.sku, item.ebaySku) * 0.5
            )
          : scoreBundlePartForListing(item, listing, role);
      return { item, role: itemRole, score: Math.round(score) };
    })
    .filter((x) => (role === 'any' ? true : x.role === role));

  const filtered = q
    ? scored.filter((x) => {
        const hay = [
          x.item.name,
          x.item.category,
          x.item.subCategory,
          x.item.vendor,
          x.item.ebaySku,
          x.item.specs ? Object.values(x.item.specs).join(' ') : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
    : scored;

  return filtered
    .sort((a, b) => {
      // Prefer scored matches, then alphabetical
      if (b.score !== a.score) return b.score - a.score;
      return (a.item.name || '').localeCompare(b.item.name || '');
    })
    .slice(0, limit);
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
    let parts = matchPartsForBundleListing(row.listing, freeParts, usedIds);
    const { parts: compatible, warnings: compatWarnings } = applyCompatibilityVetoes(
      parts,
      row.listing.title
    );
    parts = compatible;

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
    const modelBonus = parts.filter((p) => hasStrongModelHit(p.item, row.listing.title)).length * 6;
    const confidence = Math.min(99, Math.round(avg / 12 + parts.length * 7 + modelBonus));

    const warnings: string[] = [...compatWarnings];
    if (!parts.some((p) => p.role === 'mobo')) warnings.push('No motherboard matched in inventory');
    if (!parts.some((p) => p.role === 'cpu')) warnings.push('No CPU matched in inventory');
    if (!parts.some((p) => p.role === 'ram')) warnings.push('No RAM matched in inventory');
    if (parts.some((p) => p.score < 80)) warnings.push('Some parts matched weakly — review or swap before confirm');

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
