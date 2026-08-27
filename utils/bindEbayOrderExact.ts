import type { InventoryItem, TaxMode } from '../types';
import { fetchEbayOrder } from '../services/ebayService';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { linkInventoryItemToEbayOrder } from './linkInventoryItemToEbayOrder';
import { getLinePayout } from './ebayOrderPayout';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { saleProceedsFeeTotal, saleProceedsFromOrder } from './saleProceeds';

export type BindEbayOrderExactResult =
  | { ok: true; item: InventoryItem; source: 'cache' }
  | { ok: false; code: string; hint: string };

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

/**
 * One-click bind using whatever fee/buyer data the eBay API sync already cached for this
 * order. If the cache doesn't have an exact fee breakdown yet, this returns ok:false so the
 * caller can fall back to entering sale details manually.
 */
export async function bindEbayOrderExact(
  item: InventoryItem,
  match: EbayOrderMatch,
  taxMode: TaxMode
): Promise<BindEbayOrderExactResult> {
  if (alreadyHasExactPayout(match) && alreadyHasBuyer(match)) {
    return { ok: true, item: linkInventoryItemToEbayOrder(item, match, taxMode), source: 'cache' };
  }

  if (alreadyHasExactPayout(match)) {
    const order = await enrichBuyerFromApi(match.order);
    return {
      ok: true,
      item: linkInventoryItemToEbayOrder(item, { ...match, order }, taxMode),
      source: 'cache',
    };
  }

  return {
    ok: false,
    code: 'no_fee_breakdown',
    hint: 'No fee breakdown synced for this order yet — enter sale details manually, or run Sync eBay orders first.',
  };
}
