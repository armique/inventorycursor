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
    if (catResult.standardizedName) name = catResult.standardizedName;
  } catch (e) {
    enrichError = (e as Error)?.message || 'Category detection failed.';
  }

  if (parseSpecs && getSpecsAIProvider()) {
    try {
      const categoryContext = `${category}${subCategory ? ` / ${subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(category, subCategory, categoryFields);
      const result = await generateItemSpecs(name, categoryContext, knownKeys);
      if (result.standardizedName?.trim()) name = result.standardizedName.trim();
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
  const sellerVendor = purchase.sellerUsername ? `eBay: ${purchase.sellerUsername}` : 'eBay';
  const fallbackImage =
    CATEGORY_IMAGES[draft.subCategory || draft.category] ||
    CATEGORY_IMAGES[draft.category] ||
    CATEGORY_IMAGES.Components ||
    Object.values(CATEGORY_IMAGES)[0];
  const orderBits = [
    `eBay purchase #${purchase.orderId}`,
    purchase.itemId ? `item ${purchase.itemId}` : null,
    purchase.quantity > 1 ? `qty ${purchase.quantity}` : null,
    `line ${purchase.lineKey}`,
  ].filter(Boolean);

  return {
    id,
    name: draft.name.trim() || purchase.title.trim() || 'eBay purchase',
    category: draft.category,
    subCategory: draft.subCategory,
    buyPrice,
    buyDate,
    status: ItemStatus.IN_STOCK,
    vendor: draft.vendor || sellerVendor,
    platformBought: 'ebay.de',
    buyPaymentType: 'ebay.de',
    ebayOrderId: purchase.orderId,
    ebaySku: purchase.itemId || undefined,
    specs: draft.specs,
    specsAiSuggested: draft.specsAiSuggested,
    imageUrl: fallbackImage,
    imageUrls: fallbackImage ? [fallbackImage] : [],
    comment1: '',
    comment2: orderBits.join(' · '),
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
