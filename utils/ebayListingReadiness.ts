/**
 * eBay Sell Inventory API — publish readiness, category/condition mapping, shipping cost.
 *
 * eBay's listing model is 3 objects (inventory_item → offer → publish), each requiring
 * specific fields that don't otherwise exist on InventoryItem. This module is the single
 * place that decides "is this item allowed to go live" and "what exactly do we send".
 */
import type { InventoryItem } from '../types';
import { getListingPrepChecklist } from './listingPrepChecklist';
import { getItemUserPhotoUrls } from './imageImport';

// ---------------------------------------------------------------------------
// Category mapping — subCategory → eBay.de categoryId + required item aspects.
//
// Verified 2026-08-27 against the real account via /api/ebay?route=taxonomy_suggest
// (commerce/taxonomy/v1 get_category_suggestions). 8/9 were already correct; Cooling was
// wrong (92379 didn't correspond to anything real) and has been fixed to 131486. If you add
// a new subCategory here, verify it the same way before relying on it — a wrong id fails
// the publish call loudly (400 error) rather than listing wrong, but a *plausible-looking*
// wrong id (like 92379 was) won't be obviously wrong until eBay rejects it.
// ---------------------------------------------------------------------------

export type EbayAspectBuilder = (item: InventoryItem) => Record<string, string[]>;

export type EbayCategoryMapping = {
  subCategory: string;
  categoryId: string;
  /** Human label for error messages / the mapping table UI. */
  label: string;
  /** Build the aspects eBay requires for this category from the item's specs. */
  buildAspects: EbayAspectBuilder;
};

function specString(item: InventoryItem, ...keys: string[]): string | undefined {
  const specs = item.specs || {};
  for (const key of keys) {
    const v = specs[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function brandFromName(item: InventoryItem): string {
  return specString(item, 'Brand', 'Marke', 'Hersteller') || item.vendor || 'Unbranded';
}

const EBAY_CATEGORY_MAP: EbayCategoryMapping[] = [
  {
    subCategory: 'Graphics Cards',
    categoryId: '27386',
    label: 'Grafikkarten',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Chipset', 'GPU') ? { Chipset: [specString(item, 'Chipset', 'GPU')!] } : {}),
      ...(specString(item, 'Memory Size', 'VRAM')
        ? { 'Memory Size': [specString(item, 'Memory Size', 'VRAM')!] }
        : {}),
    }),
  },
  {
    subCategory: 'Processors',
    categoryId: '164',
    label: 'Prozessoren/CPUs',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Model', 'Modell') ? { 'Processor Model': [specString(item, 'Model', 'Modell')!] } : {}),
      ...(specString(item, 'Socket Type', 'Socket') ? { 'Socket Type': [specString(item, 'Socket Type', 'Socket')!] } : {}),
    }),
  },
  {
    subCategory: 'Motherboards',
    categoryId: '1244',
    label: 'Mainboards',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Socket Type', 'Socket') ? { 'CPU Socket Type': [specString(item, 'Socket Type', 'Socket')!] } : {}),
      ...(specString(item, 'Form Factor') ? { 'Form Factor': [specString(item, 'Form Factor')!] } : {}),
    }),
  },
  {
    subCategory: 'RAM',
    categoryId: '170083',
    label: 'Speicher (RAM)',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Capacity', 'Kapazität') ? { Capacity: [specString(item, 'Capacity', 'Kapazität')!] } : {}),
      ...(specString(item, 'Type', 'Typ') ? { Type: [specString(item, 'Type', 'Typ')!] } : {}),
    }),
  },
  {
    subCategory: 'Storage (SSD/HDD)',
    categoryId: '175669',
    label: 'Interne Festplatten & SSDs',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Capacity', 'Kapazität') ? { Capacity: [specString(item, 'Capacity', 'Kapazität')!] } : {}),
      ...(specString(item, 'Type', 'Typ') ? { Type: [specString(item, 'Type', 'Typ')!] } : {}),
    }),
  },
  {
    subCategory: 'Power Supplies',
    categoryId: '42017',
    label: 'Netzteile',
    buildAspects: (item) => ({
      Brand: [brandFromName(item)],
      ...(specString(item, 'Wattage', 'Watt') ? { Wattage: [specString(item, 'Wattage', 'Watt')!] } : {}),
    }),
  },
  {
    subCategory: 'Cases',
    categoryId: '42014',
    label: 'Gehäuse',
    buildAspects: (item) => ({ Brand: [brandFromName(item)] }),
  },
  {
    subCategory: 'Cooling',
    categoryId: '131486',
    label: 'CPU-Lüfter & Kühlkörper',
    buildAspects: (item) => ({ Brand: [brandFromName(item)] }),
  },
  {
    subCategory: 'Custom Built PC',
    categoryId: '179',
    label: 'PCs/Desktops',
    buildAspects: (item) => ({ Brand: [brandFromName(item)] }),
  },
];

export function findEbayCategoryMapping(item: InventoryItem): EbayCategoryMapping | null {
  if (!item.subCategory) return null;
  return EBAY_CATEGORY_MAP.find((m) => m.subCategory === item.subCategory) || null;
}

// ---------------------------------------------------------------------------
// Condition — eBay's numeric conditionId enum.
// ---------------------------------------------------------------------------

export const EBAY_CONDITION_ID: Record<NonNullable<InventoryItem['ebayCondition']>, string> = {
  new: '1000',
  newOther: '1500',
  used: '3000',
  forParts: '7000',
};

export const EBAY_CONDITION_LABEL: Record<NonNullable<InventoryItem['ebayCondition']>, string> = {
  new: 'New',
  newOther: 'New other (box opened)',
  used: 'Used',
  forParts: 'For parts or not working',
};

/**
 * Best-effort default so the field isn't blank — always reviewable/overridable before
 * publish. Deliberately never defaults to 'new' (that's a buyer promise this app has no
 * reliable signal for) — hasOVP only suggests "box present", not "unopened".
 */
export function suggestEbayCondition(item: InventoryItem): NonNullable<InventoryItem['ebayCondition']> {
  if (item.isDefective) return 'forParts';
  if (item.hasOVP === true) return 'newOther';
  return 'used';
}

// ---------------------------------------------------------------------------
// Shipping cost — DHL Germany rate tiers.
//
// PLACEHOLDER PUBLIC RATES — you told me to start with these rather than your negotiated
// business-account prices; edit EBAY_SHIPPING_RATES below once you know your real costs
// (DHL/Post business accounts are usually cheaper than these public list prices).
// ---------------------------------------------------------------------------

export type EbayShippingTier = {
  id: string;
  label: string;
  maxKg: number;
  costEur: number;
  /** eBay shippingServiceCode for the fulfillment policy override, DE domestic. */
  serviceCode: string;
  tracked: boolean;
};

export const EBAY_SHIPPING_RATES: EbayShippingTier[] = [
  { id: 'warensendung', label: 'DHL Warensendung (untracked)', maxKg: 1, costEur: 2.9, serviceCode: 'DE_DeutschePost_Sonstiges', tracked: false },
  { id: 'paeckchen_s', label: 'DHL Päckchen (bis 2kg)', maxKg: 2, costEur: 4.29, serviceCode: 'DE_DHLPaeckchen', tracked: true },
  { id: 'paket_m', label: 'DHL Paket (bis 5kg)', maxKg: 5, costEur: 7.79, serviceCode: 'DE_DHLPaket', tracked: true },
  { id: 'paket_l', label: 'DHL Paket (bis 10kg)', maxKg: 10, costEur: 10.49, serviceCode: 'DE_DHLPaket', tracked: true },
  { id: 'paket_xl', label: 'DHL Paket (bis 31.5kg)', maxKg: 31.5, costEur: 16.49, serviceCode: 'DE_DHLPaket', tracked: true },
];

/**
 * Resolves the shipping tier for an item's weight. `warensendung` is opt-in only
 * (item.ebayShippingMethod === 'warensendung') and only applies under the tier's own
 * 1kg cap — never auto-selected, per your instruction.
 */
export function resolveEbayShippingTier(item: InventoryItem): EbayShippingTier {
  const weight = item.shippingWeightKg;
  const wantsWarensendung = item.ebayShippingMethod === 'warensendung';
  const warensendungTier = EBAY_SHIPPING_RATES[0];
  if (wantsWarensendung && (weight == null || weight <= warensendungTier.maxKg)) {
    return warensendungTier;
  }
  const trackedTiers = EBAY_SHIPPING_RATES.filter((t) => t.tracked);
  const w = weight ?? trackedTiers[0].maxKg;
  return trackedTiers.find((t) => w <= t.maxKg) || trackedTiers[trackedTiers.length - 1];
}

// ---------------------------------------------------------------------------
// Publish readiness gate — every reason an item can't go live yet.
// ---------------------------------------------------------------------------

export type EbayPublishBlocker =
  | 'checklist' // title/description/photos incomplete (existing listingPrepChecklist gate)
  | 'price' // no suggestedEbayListPrice / storePrice / sellPrice to publish at
  | 'category' // subCategory has no eBay category mapping
  | 'weight' // shippingWeightKg not set
  | 'condition_note' // ebayCondition === 'forParts' but aiDescriptionNote is empty
  | 'photos_not_hosted'; // photos are local-only (data:/blob:), eBay can't fetch them

export type EbayPublishReadiness = {
  ok: boolean;
  blockers: EbayPublishBlocker[];
  price: number | null;
  category: EbayCategoryMapping | null;
  condition: NonNullable<InventoryItem['ebayCondition']>;
  shippingTier: EbayShippingTier;
  photoUrls: string[];
};

export function isPubliclyFetchableImageUrl(url: string): boolean {
  const t = url.trim();
  return t.startsWith('https://') && !t.startsWith('data:') && !t.startsWith('blob:');
}

export function resolveEbayListingPrice(item: InventoryItem): number | null {
  const candidate = item.suggestedEbayListPrice ?? item.storePrice ?? item.sellPrice;
  return candidate != null && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
}

export function getEbayPublishReadiness(item: InventoryItem): EbayPublishReadiness {
  const blockers: EbayPublishBlocker[] = [];

  const checklist = getListingPrepChecklist(item);
  if (!checklist.complete) blockers.push('checklist');

  const price = resolveEbayListingPrice(item);
  if (price == null) blockers.push('price');

  const category = findEbayCategoryMapping(item);
  if (!category && !item.ebayCategoryIdOverride) blockers.push('category');

  if (item.shippingWeightKg == null || item.shippingWeightKg <= 0) blockers.push('weight');

  const condition = item.ebayCondition || suggestEbayCondition(item);
  if (condition === 'forParts' && !item.aiDescriptionNote?.trim()) blockers.push('condition_note');

  const photoUrls = getItemUserPhotoUrls(item);
  if (photoUrls.length && !photoUrls.every(isPubliclyFetchableImageUrl)) {
    blockers.push('photos_not_hosted');
  }

  return {
    ok: blockers.length === 0,
    blockers,
    price,
    category,
    condition,
    shippingTier: resolveEbayShippingTier(item),
    photoUrls,
  };
}

export const EBAY_PUBLISH_BLOCKER_LABEL: Record<EbayPublishBlocker, string> = {
  checklist: 'Title / description / photos incomplete',
  price: 'No listing price set (suggested, store, or sell price)',
  category: 'No eBay category mapped for this subCategory',
  weight: 'Shipping weight not set',
  condition_note: '"For parts" condition needs a fault note (aiDescriptionNote)',
  photos_not_hosted: 'Photos still local-only — sync to cloud before publishing',
};
