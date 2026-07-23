/**
 * Turn an eBay buyer-purchase line into an InventoryItem (confirm received).
 * Reuses category + optional AI specs parsing from the listing import pipeline.
 * Prefer a pre-saved `purchase.inventoryDraft` from “Parse specs” when present.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import {
  setPurchaseInventoryDraft,
  type EbayPurchaseInventoryDraft,
  type EbayPurchaseRecord,
} from '../services/ebayPurchaseIndex';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';
import { filterSpecsToEssentialKeys, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { detectItemCategory } from './itemCategoryDetect';
import { cleanEbayListingTitle } from './ebayBulkSyncPlan';
import { applyStorageKindToParsedItem } from './ensureStorageKindInName';
import { formatEUR } from './formatMoney';
import { formatPlatformBoughtLabel } from './purchaseSource';

export interface PurchaseInventoryDraft {
  name: string;
  category: string;
  subCategory: string;
  categorySource: string;
  specs: Record<string, string | number>;
  specsAiSuggested?: Record<string, string | number>;
  vendor?: string;
  enrichError?: string;
}

/** Human-readable buy summary for comments / purchase UI. */
export function formatPurchaseBuySummary(purchase: EbayPurchaseRecord): string {
  const buyPrice =
    purchase.totalPaid != null && Number.isFinite(purchase.totalPaid)
      ? purchase.totalPaid
      : purchase.unitPrice != null && Number.isFinite(purchase.unitPrice)
        ? purchase.unitPrice * Math.max(1, purchase.quantity || 1)
        : null;
  const parts = [
    `Bought on ${formatPlatformBoughtLabel('ebay.de') || 'eBay'}`,
    purchase.sellerUsername ? `seller ${purchase.sellerUsername}` : null,
    buyPrice != null ? `€${formatEUR(buyPrice)}` : null,
    purchase.creationDate ? `date ${purchase.creationDate}` : null,
    purchase.orderId ? `order ${purchase.orderId}` : null,
    purchase.quantity > 1 ? `qty ${purchase.quantity}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function formatPurchaseBuyDetailLines(purchase: EbayPurchaseRecord): Array<{ label: string; value: string }> {
  const buyPrice =
    purchase.totalPaid != null && Number.isFinite(purchase.totalPaid)
      ? purchase.totalPaid
      : purchase.unitPrice != null && Number.isFinite(purchase.unitPrice)
        ? purchase.unitPrice * Math.max(1, purchase.quantity || 1)
        : null;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Platform', value: formatPlatformBoughtLabel('ebay.de') || 'eBay' },
    { label: 'Payment', value: 'eBay' },
  ];
  if (purchase.sellerUsername) rows.push({ label: 'Seller', value: purchase.sellerUsername });
  if (buyPrice != null) rows.push({ label: 'Price paid', value: `€${formatEUR(buyPrice)}` });
  if (purchase.unitPrice != null && purchase.quantity > 1) {
    rows.push({ label: 'Unit price', value: `€${formatEUR(purchase.unitPrice)}` });
  }
  if (purchase.creationDate) rows.push({ label: 'Buy date', value: purchase.creationDate });
  if (purchase.orderId) rows.push({ label: 'Order ID', value: purchase.orderId });
  if (purchase.itemId) rows.push({ label: 'Listing / item ID', value: purchase.itemId });
  if (purchase.transactionId) rows.push({ label: 'Transaction', value: purchase.transactionId });
  if (purchase.quantity > 1) rows.push({ label: 'Quantity', value: String(purchase.quantity) });
  return rows;
}

function draftFromStored(stored: EbayPurchaseInventoryDraft): PurchaseInventoryDraft {
  return {
    name: stored.name,
    category: stored.category,
    subCategory: stored.subCategory,
    categorySource: stored.categorySource || 'cached',
    specs: stored.specs || {},
    specsAiSuggested: stored.specsAiSuggested,
    vendor: stored.vendor,
    enrichError: stored.enrichError,
  };
}

export function purchaseHasParsedSpecs(purchase: EbayPurchaseRecord): boolean {
  const d = purchase.inventoryDraft;
  if (!d?.name || !d.category) return false;
  return Object.keys(d.specs || {}).length > 0 || Boolean(d.parsedAt);
}

/** Enrich purchase title → name, category, optional specs (same AI path as listing import). */
export async function enrichPurchaseForInventory(
  purchase: EbayPurchaseRecord,
  categories: Record<string, string[]>,
  categoryFields: Record<string, string[]>,
  options?: { parseSpecs?: boolean }
): Promise<PurchaseInventoryDraft> {
  const parseSpecs = options?.parseSpecs !== false;
  const cleaned = cleanEbayListingTitle(purchase.title);
  let name = cleaned || purchase.title.trim();
  let category = 'Misc';
  let subCategory = 'Spare Parts';
  let categorySource = 'heuristic';
  let specs: Record<string, string | number> = {};
  let specsAiSuggested: Record<string, string | number> | undefined;
  let vendor: string | undefined;
  let enrichError: string | undefined;

  try {
    const catResult = await detectItemCategory(name, categories);
    category = catResult.category;
    subCategory = catResult.subCategory;
    categorySource = catResult.source;
    if (catResult.standardizedName) {
      name = cleanEbayListingTitle(catResult.standardizedName) || catResult.standardizedName;
    }
  } catch (e) {
    enrichError = (e as Error)?.message || 'Category detection failed.';
  }

  if (parseSpecs && getSpecsAIProvider()) {
    try {
      const categoryContext = `${category}${subCategory ? ` / ${subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(category, subCategory, categoryFields);
      const result = await generateItemSpecs(name, categoryContext, knownKeys);
      if (result.standardizedName?.trim()) {
        name =
          cleanEbayListingTitle(result.standardizedName.trim()) || result.standardizedName.trim();
      }
      if (result.vendor) vendor = result.vendor;
      if (result.specs && Object.keys(result.specs).length > 0) {
        specs = filterSpecsToEssentialKeys(result.specs, knownKeys);
        specsAiSuggested = { ...specs };
      }
    } catch (e) {
      const msg = (e as Error)?.message || 'AI spec parse failed.';
      enrichError = enrichError ? `${enrichError} ${msg}` : msg;
    }
  } else if (parseSpecs && !getSpecsAIProvider()) {
    enrichError = enrichError || 'No AI provider configured — name and category only.';
  }

  // Final pass: never keep marketplace fluff in the inventory name.
  name = cleanEbayListingTitle(name) || name;

  // SSDs: keep NVMe vs normal SSD (or HDD) visible in the name.
  const storageFixed = applyStorageKindToParsedItem({
    name,
    category,
    subCategory,
    specs,
    sourceText: purchase.title,
  });
  name = storageFixed.name;
  specs = storageFixed.specs;
  if (specsAiSuggested && Object.keys(specs).length > 0) {
    specsAiSuggested = { ...specsAiSuggested, ...specs };
  }

  return {
    name,
    category,
    subCategory,
    categorySource,
    specs,
    specsAiSuggested,
    vendor,
    enrichError,
  };
}

/**
 * Parse specs now and persist on the purchase row so Confirm received can reuse them.
 */
export async function parseAndSavePurchaseSpecs(
  purchase: EbayPurchaseRecord,
  categories: Record<string, string[]>,
  categoryFields: Record<string, string[]>
): Promise<{ draft: PurchaseInventoryDraft; stored: EbayPurchaseInventoryDraft }> {
  const draft = await enrichPurchaseForInventory(purchase, categories, categoryFields, {
    parseSpecs: true,
  });
  const stored: EbayPurchaseInventoryDraft = {
    name: draft.name,
    category: draft.category,
    subCategory: draft.subCategory,
    categorySource: draft.categorySource,
    specs: draft.specs,
    specsAiSuggested: draft.specsAiSuggested,
    vendor: draft.vendor,
    enrichError: draft.enrichError,
    parsedAt: new Date().toISOString(),
  };
  setPurchaseInventoryDraft(purchase.lineKey, stored);
  return { draft, stored };
}

/** Lightweight InventoryItem for rendering purchases in the same UI as stock rows. */
export function purchaseToPreviewItem(purchase: EbayPurchaseRecord): InventoryItem {
  let draft: PurchaseInventoryDraft = purchase.inventoryDraft
    ? {
        name: purchase.inventoryDraft.name,
        category: purchase.inventoryDraft.category,
        subCategory: purchase.inventoryDraft.subCategory,
        categorySource: purchase.inventoryDraft.categorySource || 'cached',
        specs: purchase.inventoryDraft.specs || {},
        specsAiSuggested: purchase.inventoryDraft.specsAiSuggested,
        vendor: purchase.inventoryDraft.vendor,
        enrichError: purchase.inventoryDraft.enrichError,
      }
    : {
        name: cleanEbayListingTitle(purchase.title) || purchase.title,
        category: 'Misc',
        subCategory: 'Spare Parts',
        categorySource: 'preview',
        specs: {},
      };
  const storageFixed = applyStorageKindToParsedItem({
    name: draft.name,
    category: draft.category,
    subCategory: draft.subCategory,
    specs: draft.specs,
    sourceText: purchase.title,
  });
  draft = { ...draft, name: storageFixed.name, specs: storageFixed.specs };
  return buildInventoryItemFromPurchase(purchase, draft, {
    itemId: `purchase-preview-${purchase.lineKey}`,
  });
}

export function buildInventoryItemFromPurchase(
  purchase: EbayPurchaseRecord,
  draft: PurchaseInventoryDraft,
  options?: { itemId?: string; receiveDate?: string }
): InventoryItem {
  const id = options?.itemId || `item-${Date.now()}-ebay-buy`;
  const today = options?.receiveDate || new Date().toISOString().split('T')[0];
  const buyPrice =
    purchase.totalPaid != null && Number.isFinite(purchase.totalPaid)
      ? purchase.totalPaid
      : purchase.unitPrice != null && Number.isFinite(purchase.unitPrice)
        ? purchase.unitPrice * Math.max(1, purchase.quantity || 1)
        : 0;
  const buyDate = purchase.creationDate || today;
  // Vendor = where/who you bought from (seller), not the AI product brand.
  const sellerVendor = purchase.sellerUsername
    ? `eBay: ${purchase.sellerUsername}`
    : 'eBay';
  const brandNote =
    draft.vendor && draft.vendor.trim() && draft.vendor.trim().toLowerCase() !== purchase.sellerUsername?.toLowerCase()
      ? `Brand: ${draft.vendor.trim()}`
      : null;
  const fallbackImage =
    CATEGORY_IMAGES[draft.subCategory || draft.category] ||
    CATEGORY_IMAGES[draft.category] ||
    CATEGORY_IMAGES.Components ||
    Object.values(CATEGORY_IMAGES)[0];
  const comment1 = [formatPurchaseBuySummary(purchase), brandNote].filter(Boolean).join(' · ');
  const comment2 = [
    purchase.orderId ? `Order ${purchase.orderId}` : null,
    purchase.transactionId ? `txn ${purchase.transactionId}` : null,
    purchase.itemId ? `listing ${purchase.itemId}` : null,
    purchase.quantity > 1 ? `qty ${purchase.quantity}` : null,
    `line ${purchase.lineKey}`,
    `received ${today}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id,
    name: draft.name.trim() || purchase.title.trim() || 'eBay purchase',
    category: draft.category,
    subCategory: draft.subCategory,
    buyPrice,
    buyDate,
    status: ItemStatus.IN_STOCK,
    vendor: sellerVendor,
    platformBought: 'ebay.de',
    buyPaymentType: 'ebay.de',
    ebayOrderId: purchase.orderId || undefined,
    ebaySku: purchase.itemId || undefined,
    quantity: purchase.quantity > 1 ? purchase.quantity : undefined,
    specs: draft.specs,
    specsAiSuggested: draft.specsAiSuggested,
    imageUrl: fallbackImage,
    imageUrls: fallbackImage ? [fallbackImage] : [],
    comment1,
    comment2,
  };
}

/**
 * Full pipeline: use cached inventoryDraft when present (unless forceReparse),
 * otherwise enrich, then build InventoryItem.
 */
export async function createInventoryFromPurchase(
  purchase: EbayPurchaseRecord,
  categories: Record<string, string[]>,
  categoryFields: Record<string, string[]>,
  options?: { parseSpecs?: boolean; forceReparse?: boolean; itemId?: string; receiveDate?: string }
): Promise<{ item: InventoryItem; draft: PurchaseInventoryDraft }> {
  let draft: PurchaseInventoryDraft;
  if (!options?.forceReparse && purchase.inventoryDraft?.name && purchase.inventoryDraft.category) {
    draft = draftFromStored(purchase.inventoryDraft);
  } else {
    draft = await enrichPurchaseForInventory(purchase, categories, categoryFields, {
      parseSpecs: options?.parseSpecs,
    });
  }
  const item = buildInventoryItemFromPurchase(purchase, draft, {
    itemId: options?.itemId,
    receiveDate: options?.receiveDate,
  });
  return { item, draft };
}
