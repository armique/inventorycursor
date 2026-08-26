import type { InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { loadEbayOrderIndex, orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { findHubArchiveOrderById, upsertHubArchiveOrders } from '../services/ebayHubArchiveIndex';
import { fetchEbaySellerHubPayout, type SellerHubFetchResult } from '../services/ebaySellerHubFetch';
import { persistHubPayoutOnCachedOrder } from './ebaySellerHubOrderCache';
import { hubOrderIdFromItem } from './replaceItemSaleProceedsFromHub';

function orderIdKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

/** Minimal order shell when only the inventory row knows the order id. */
export function stubEbayOrderFromItem(item: InventoryItem, orderId: string): EbayOrderRecord {
  return {
    orderId: orderId.trim(),
    creationDate: item.sellDate || null,
    buyer: {
      username: item.ebayUsername,
      fullName: item.customer?.name,
      address: item.customer?.address,
      email: item.customer?.email,
      phone: item.customer?.phone,
    },
    lineItems: [
      {
        sku: item.ebaySku || null,
        title: item.name,
        lineItemCost: item.saleProceeds?.buyerTotalEur ?? item.sellPrice ?? null,
        listingId: item.ebayListingId,
        quantity: 1,
      },
    ],
    grossTotal: item.saleProceeds?.buyerTotalEur ?? item.sellPrice ?? null,
    netTotal: item.saleProceeds?.netPayoutEur ?? null,
    sources: ['api'],
    importedAt: new Date().toISOString(),
  };
}

/** Hub archive first, then API cache, then inventory stub. */
export function resolveEbayOrderRecordForItem(item: InventoryItem): EbayOrderRecord | null {
  const orderId = hubOrderIdFromItem(item);
  if (!orderId) return null;
  const key = orderIdKey(orderId);
  const hub = findHubArchiveOrderById(orderId);
  if (hub) return hub;
  const cached = loadEbayOrderIndex().orders.find((o) => orderIdKey(o.orderId) === key);
  if (cached) return cached;
  return stubEbayOrderFromItem(item, orderId);
}

export type LoadEbayOrderBreakdownResult =
  | { ok: true; order: EbayOrderRecord; fetchedLive: boolean }
  | { ok: false; code: string; hint?: string; order?: EbayOrderRecord | null };

/** Load order breakdown — fetches Seller Hub when archive lacks fee lines. */
export async function loadEbayOrderBreakdownForItem(
  item: InventoryItem,
  options?: { forceFetch?: boolean }
): Promise<LoadEbayOrderBreakdownResult> {
  const orderId = hubOrderIdFromItem(item);
  if (!orderId) {
    return { ok: false, code: 'no_order_id', hint: 'This item has no eBay order ID.' };
  }

  let order = resolveEbayOrderRecordForItem(item);
  if (!order) {
    order = stubEbayOrderFromItem(item, orderId);
  }

  const needsFetch = options?.forceFetch || !orderHasFeeBreakdown(order);
  if (!needsFetch) {
    return { ok: true, order, fetchedLive: false };
  }

  const hub = await fetchEbaySellerHubPayout({
    orderId,
    title: item.name,
    sku: item.ebaySku || undefined,
    listingId: item.ebayListingId || undefined,
    query: item.name,
  });

  if (hub.ok) {
    const enriched = persistHubPayoutOnCachedOrder(order, hub.payout);
    upsertHubArchiveOrders([enriched]);
    return { ok: true, order: enriched, fetchedLive: true };
  }

  if (orderHasFeeBreakdown(order)) {
    return { ok: true, order, fetchedLive: false };
  }

  // tsconfig has strictNullChecks off, which breaks discriminant narrowing here.
  const fail = hub as Extract<SellerHubFetchResult, { ok: false }>;
  return {
    ok: false,
    code: fail.code,
    hint:
      fail.hint ||
      fail.error ||
      'Could not read Seller Hub. Start npm run dev:ebay, sign into eBay.de in that Chrome window, then retry.',
    order,
  };
}
