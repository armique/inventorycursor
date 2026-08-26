/**
 * Single-click "Publish to eBay" — orchestrates the readiness gate, category/condition/
 * shipping resolution, and the actual inventory_item → offer → publish call.
 */
import type { InventoryItem } from '../types';
import { ensureFreshEbayToken } from './ebayService';
import {
  EBAY_CONDITION_ID,
  findEbayCategoryMapping,
  getEbayPublishReadiness,
  resolveEbayListingPrice,
  resolveEbayShippingTier,
  suggestEbayCondition,
} from '../utils/ebayListingReadiness';
import { resolveListingTitle } from '../utils/listingPrepChecklist';

export type EbayPublishOutcome = {
  ok: boolean;
  error?: string;
  sku?: string;
  offerId?: string;
  listingId?: string;
};

function ebaySkuForItem(item: InventoryItem): string {
  return item.ebaySku || item.id;
}

/**
 * Publishes (or re-publishes) an item to eBay. Throws readiness blockers as a single
 * Error rather than calling the network — check getEbayPublishReadiness(item) in the UI
 * first to show blockers inline; this is the "go" action once they're all clear.
 */
export async function publishItemToEbay(item: InventoryItem): Promise<EbayPublishOutcome> {
  const readiness = getEbayPublishReadiness(item);
  if (!readiness.ok) {
    return { ok: false, error: `Not ready to publish: ${readiness.blockers.join(', ')}` };
  }

  const token = await ensureFreshEbayToken();
  if (!token) {
    return { ok: false, error: 'eBay not connected. Click "Connect eBay" in Settings first.' };
  }

  const category = readiness.category || findEbayCategoryMapping(item);
  const categoryId = item.ebayCategoryIdOverride || category?.categoryId;
  if (!categoryId) {
    return { ok: false, error: `No eBay category mapped for subCategory "${item.subCategory || ''}".` };
  }

  const price = readiness.price ?? resolveEbayListingPrice(item);
  if (price == null) return { ok: false, error: 'No listing price resolved.' };

  const condition = item.ebayCondition || suggestEbayCondition(item);
  const shippingTier = resolveEbayShippingTier(item);
  const title = (resolveListingTitle(item) || item.name).slice(0, 80);
  const description = item.marketDescription?.trim() || '';
  const aspects = category ? category.buildAspects(item) : {};

  const res = await fetch('/api/ebay?route=publish_item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      sku: ebaySkuForItem(item),
      title,
      description,
      imageUrls: readiness.photoUrls,
      price,
      quantity: item.quantity ?? 1,
      conditionId: EBAY_CONDITION_ID[condition],
      categoryId,
      aspects,
      weightKg: item.shippingWeightKg,
      shippingCostEur: shippingTier.costEur,
      existingOfferId: item.ebayOfferId || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `Publish failed (${res.status})` };
  }
  return { ok: true, sku: data.sku, offerId: data.offerId, listingId: data.listingId };
}
