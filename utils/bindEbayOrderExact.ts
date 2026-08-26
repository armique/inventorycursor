import type { InventoryItem, TaxMode } from '../types';
import { fetchEbayOrder } from '../services/ebayService';
import { fetchEbaySellerHubPayout, type SellerHubFetchCandidate } from '../services/ebaySellerHubFetch';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { linkInventoryItemToEbayOrder } from './linkInventoryItemToEbayOrder';
import { getLinePayout } from './ebayOrderPayout';
import { persistHubPayoutOnCachedOrder } from './ebaySellerHubOrderCache';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { saleProceedsFeeTotal, saleProceedsFromOrder } from './saleProceeds';

export type BindEbayOrderExactResult =
  | { ok: true; item: InventoryItem; source: 'cache' | 'seller_hub' }
  | {
      ok: false;
      code: string;
      hint: string;
      openUrl?: string;
      candidates?: SellerHubFetchCandidate[];
    };

function alreadyHasExactPayout(match: EbayOrderMatch): boolean {
  const payout = getLinePayout(match.order, match.lineItem);
  if (payout.feeEstimated) return false;
  const fees = saleProceedsFeeTotal(saleProceedsFromOrder(match.order, match.lineItem));
  return payout.netKnown && fees >= 0.01;
}

function alreadyHasBuyer(match: EbayOrderMatch): boolean {
  const buyer = match.order.buyer;
  return Boolean(buyer.username && (buyer.address || buyer.fullName));
}

async function enrichBuyerFromApi(order: EbayOrderRecord): Promise<EbayOrderRecord> {
  if (order.buyer.username && order.buyer.address) return order;
  try {
    const live = await fetchEbayOrder(order.orderId);
    return {
      ...order,
      buyer: {
        username: order.buyer.username || live.ebayUsername || undefined,
        fullName: order.buyer.fullName || live.customer?.name || undefined,
        address: order.buyer.address || live.customer?.address || undefined,
        email: order.buyer.email || live.customer?.email,
        phone: order.buyer.phone || live.customer?.phone,
      },
    };
  } catch {
    return order;
  }
}

function setupHint(code: string, fallback: string): string {
  if (code === 'local_only' || code === 'cdp_unavailable') {
    return 'Start once with npm run dev:ebay (or Start-eBay-dev.cmd), log into eBay.de in that Chrome window, then click Bind again.';
  }
  if (code === 'not_logged_in') {
    return 'Sign into eBay.de in the debug Chrome window, then click Bind again.';
  }
  return fallback;
}

function fetchHub(match: EbayOrderMatch, item: InventoryItem) {
  return fetchEbaySellerHubPayout({
    orderId: match.order.orderId,
    title: match.lineItem.title || item.name,
    sku: match.lineItem.sku || item.ebaySku || undefined,
    listingId: match.lineItem.listingId || item.ebayListingId || undefined,
    query: match.lineItem.title || item.name,
  });
}

/**
 * One-click bind: Hub payout + API username/address. Never asks the user to copy/paste.
 */
export async function bindEbayOrderExact(
  item: InventoryItem,
  match: EbayOrderMatch,
  taxMode: TaxMode
): Promise<BindEbayOrderExactResult> {
  if (alreadyHasExactPayout(match) && alreadyHasBuyer(match)) {
    return { ok: true, item: linkInventoryItemToEbayOrder(item, match, taxMode), source: 'cache' };
  }

  const buyerPromise = enrichBuyerFromApi(match.order);

  if (alreadyHasExactPayout(match)) {
    const order = await buyerPromise;
    return {
      ok: true,
      item: linkInventoryItemToEbayOrder(item, { ...match, order }, taxMode),
      source: 'cache',
    };
  }

  const [firstHub, orderWithBuyer] = await Promise.all([fetchHub(match, item), buyerPromise]);
  let hub = firstHub;
  if (!hub.ok) {
    const skipRetry =
      hub.code === 'cdp_unavailable' || hub.code === 'local_only' || hub.code === 'not_logged_in';
    if (!skipRetry) hub = await fetchHub(match, item);
  }

  if (!hub.ok) {
    return {
      ok: false,
      code: hub.code,
      hint: setupHint(
        hub.code,
        hub.hint ||
          hub.error ||
          'Could not read Seller Hub. Keep the eBay Chrome window logged in and click Bind again.'
      ),
      openUrl: hub.openUrl,
      candidates: hub.candidates,
    };
  }

  const order = persistHubPayoutOnCachedOrder(orderWithBuyer, hub.payout);
  return {
    ok: true,
    item: linkInventoryItemToEbayOrder(item, { ...match, order }, taxMode),
    source: 'seller_hub',
  };
}
