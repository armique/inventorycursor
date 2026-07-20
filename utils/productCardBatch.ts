/**
 * Plan AI product-card batch jobs from an item's gallery photos.
 *
 * Count rules:
 * - 0 photos → 1 card (name/specs only)
 * - 1–2 photos → that many cards (never more than photos)
 * - 3+ photos → exactly {@link MAX_PRODUCT_CARD_BATCH} cards (first 3 photos)
 *
 * Each job also carries a content variant so cards don't repeat the same
 * specs / perks / accessory badges.
 */

import type { InventoryItem } from '../types';
import {
  DEFAULT_USPS,
  detectProductCardFamily,
  getProductCardSpecs,
  type ProductCardSpecLine,
} from './productCardContent';
import type { ProductCardAccessoryHints } from './itemAccessories';

export const MAX_PRODUCT_CARD_BATCH = 3;
/** @deprecated use MAX_PRODUCT_CARD_BATCH */
export const MIN_PRODUCT_CARD_BATCH = MAX_PRODUCT_CARD_BATCH;

export type ProductCardBatchJob = {
  index: number;
  /** Source photo(s) for this card — usually one for distinct compositions. */
  photos: string[];
  editFromPhoto: boolean;
  styleId: string;
  /** Spec lines unique-ish to this card variant. */
  specs: ProductCardSpecLine[];
  /** Marketing perks / USPs for this card only. */
  perks: string[];
  /** How this card should differ from siblings. */
  variantFocus: string;
  hasOVP: boolean;
  hasIOShield: boolean;
  cardCount: number;
};

const VARIANT_FOCUSES = [
  'Focus this card on technical specs and performance numbers. Prefer spec callouts over soft marketing fluff.',
  'Focus this card on buyer-confidence perks (condition, shipping, availability). Use different perk text than sibling cards.',
  'Focus this card on Lieferumfang / extras (box, shield, included accessories). Emphasize value extras, not the same specs as card 1.',
];

/**
 * How many cards to generate for a given gallery photo count.
 * Never generates more cards than photos when 1–2 photos exist.
 */
export function resolveProductCardBatchCount(photoCount: number): number {
  const n = Math.max(0, Math.floor(Number(photoCount) || 0));
  if (n <= 0) return 1;
  return Math.min(MAX_PRODUCT_CARD_BATCH, n);
}

/** Round-robin / chunk partition so sibling cards get different items. */
export function partitionForCard<T>(
  items: T[],
  index: number,
  count: number,
  maxTake = 5
): T[] {
  if (!items.length) return [];
  if (count <= 1) return items.slice(0, maxTake);

  const owned = items.filter((_, i) => i % count === index);
  if (owned.length > 0) return owned.slice(0, maxTake);

  const start = (index * Math.max(1, Math.floor(items.length / count))) % items.length;
  const out: T[] = [];
  for (let k = 0; k < Math.min(maxTake, items.length); k++) {
    out.push(items[(start + k) % items.length]);
  }
  return out;
}

export function buildProductCardVariantContent(
  item: InventoryItem,
  opts: {
    index: number;
    cardCount: number;
    categoryFields?: string[];
    accessories: ProductCardAccessoryHints;
  }
): Pick<
  ProductCardBatchJob,
  'specs' | 'perks' | 'variantFocus' | 'hasOVP' | 'hasIOShield'
> {
  const { index, cardCount, categoryFields, accessories } = opts;
  const allSpecs = getProductCardSpecs(item, categoryFields, 16);
  const family = detectProductCardFamily(item);
  const allPerks = [...(DEFAULT_USPS[family] || DEFAULT_USPS.generic)];

  // Soft extras from notes — only as perk candidates, not invented hardware
  if (item.isDefective) allPerks.push('Für Bastler / Ersatzteile');
  if (item.vendor?.trim()) allPerks.push(`Vendor: ${item.vendor.trim()}`);

  const specs = partitionForCard(allSpecs, index, cardCount, 5);
  const perks = partitionForCard(allPerks, index, cardCount, 2);

  // Split accessory badges across cards so they don't all look identical
  let hasOVP = false;
  let hasIOShield = false;
  if (cardCount <= 1) {
    hasOVP = accessories.hasOVP;
    hasIOShield = accessories.hasIOShield;
  } else if (accessories.hasOVP && accessories.hasIOShield) {
    hasOVP = index === 0;
    hasIOShield = index === 1;
  } else if (accessories.hasOVP) {
    hasOVP = index === 0;
  } else if (accessories.hasIOShield) {
    hasIOShield = index === 0;
  }

  return {
    specs,
    perks,
    variantFocus: VARIANT_FOCUSES[index % VARIANT_FOCUSES.length],
    hasOVP,
    hasIOShield,
  };
}

/**
 * Build generation jobs for a product-card batch.
 */
export function buildProductCardBatchJobs(
  sourcePhotos: string[],
  opts: {
    styleId: string;
    styleIds?: string[];
    item: InventoryItem;
    categoryFields?: string[];
    accessories: ProductCardAccessoryHints;
    count?: number;
  }
): ProductCardBatchJob[] {
  const photos = (sourcePhotos || []).filter((u) => typeof u === 'string' && u.trim());
  const count =
    opts.count != null
      ? Math.max(1, Math.min(MAX_PRODUCT_CARD_BATCH, Math.floor(opts.count)))
      : resolveProductCardBatchCount(photos.length);

  const jobs: ProductCardBatchJob[] = [];
  for (let i = 0; i < count; i++) {
    const photo = photos[i]; // 1:1 with photo when photos exist; undefined if no-photo single card
    const variant = buildProductCardVariantContent(opts.item, {
      index: i,
      cardCount: count,
      categoryFields: opts.categoryFields,
      accessories: opts.accessories,
    });

    jobs.push({
      index: i,
      photos: photo ? [photo] : [],
      editFromPhoto: Boolean(photo),
      styleId: opts.styleId,
      cardCount: count,
      ...variant,
    });
  }
  return jobs;
}
