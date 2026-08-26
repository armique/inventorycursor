import { InventoryItem, ItemStatus, TaxMode } from '../types';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { customerFromEbayOrder } from './ebayOrderBuyerData';
import { getLinePayout } from './ebayOrderPayout';
import { calculateSaleProfit } from './saleProfit';
import { hasPostSaleRefund, sumOrderSaleProceeds } from './ebayOrderFinancial';
import { lineItemClaimKey } from './ebayOrderLinkAnalysis';
import { saleProceedsFeeTotal, saleProceedsFromOrder } from './saleProceeds';
import { isCrucialRamListingText, patchCrucialRamInvoiceSale } from './crucialRamInvoiceSaleFix';
import { roundMoney } from '../services/financialAggregation';
import { itemAlreadyClosedSaleOrder } from './itemSaleCycle';

/** True when linking an eBay order should correct platform/payment to eBay. */
export function shouldCorrectSalePlatformToEbay(item: InventoryItem): boolean {
  if (!item.platformSold?.trim()) return true;
  if (item.platformSold === 'kleinanzeigen.de') return true;
  if (item.paymentType?.startsWith('Kleinanzeigen')) return true;
  return false;
}

/** Apply a cached eBay order match onto an inventory row (link order id, buyer, net sell price, profit). */
export function applyEbayOrderMatchToItem(
  item: InventoryItem,
  match: EbayOrderMatch,
  taxMode: TaxMode
): InventoryItem {
  if (itemAlreadyClosedSaleOrder(item, match.order.orderId)) return item;
  const { order, lineItem } = match;
  const payout = getLinePayout(order, lineItem);
  const proceeds = saleProceedsFromOrder(order, lineItem);
  const refunded = hasPostSaleRefund(order);
  const exactFees = !payout.feeEstimated && (payout.netKnown || saleProceedsFeeTotal(proceeds) >= 0.01);

  const buyerTotal =
    payout.buyerTotal ?? payout.gross ?? proceeds.buyerTotalEur ?? payout.sellPrice;
  const itemizedFees = saleProceedsFeeTotal(proceeds);
  const feeForExact =
    itemizedFees >= 0.01
      ? itemizedFees
      : payout.netKnown && payout.net != null
        ? roundMoney(Math.max(0, buyerTotal - payout.net))
        : payout.fee;

  const sellForBooks = refunded || !exactFees ? payout.sellPrice : buyerTotal;
  const feeForProfit = refunded ? 0 : exactFees ? feeForExact : payout.fee;
  const profit = calculateSaleProfit(sellForBooks, item.buyPrice, feeForProfit, taxMode);

  const customer = customerFromEbayOrder(order);
  const hadKleinanzeigenSale =
    item.platformSold === 'kleinanzeigen.de' || item.paymentType?.startsWith('Kleinanzeigen');

  const originalSellPrice =
    item.originalSellPrice ??
    (refunded
      ? sumOrderSaleProceeds(order) ?? payout.sellPrice
      : item.sellPrice != null && item.ebayOrderId === order.orderId
        ? item.sellPrice
        : exactFees
          ? buyerTotal
          : payout.sellPrice);

  const next: InventoryItem = {
    ...item,
    status:
      item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED ? ItemStatus.SOLD : item.status,
    originalSellPrice,
    sellPrice: sellForBooks,
    sellDate: item.sellDate || order.creationDate || undefined,
    platformSold: shouldCorrectSalePlatformToEbay(item) ? 'ebay.de' : item.platformSold || 'ebay.de',
    paymentType: shouldCorrectSalePlatformToEbay(item) ? 'ebay.de' : item.paymentType || 'ebay.de',
    profit: parseFloat(profit.toFixed(2)),
    customer:
      customer.name || customer.address || customer.phone || customer.email ? customer : item.customer,
    ebayUsername: order.buyer.username || item.ebayUsername,
    ebayOrderId: order.orderId,
    ebayOrderLineKey: lineItemClaimKey(order.orderId, lineItem),
    ebaySku: lineItem.sku || item.ebaySku,
    ebayListingId: lineItem.listingId || item.ebayListingId,
    hasFee: refunded ? false : Boolean(feeForProfit),
    feeAmount: refunded ? 0 : feeForProfit,
    sellerPaidShipping: exactFees && !refunded ? false : item.sellerPaidShipping,
    sellerShippingAmount: exactFees && !refunded ? undefined : item.sellerShippingAmount,
    saleProceeds: proceeds,
  };

  if (hadKleinanzeigenSale) {
    next.kleinanzeigenChatUrl = undefined;
    next.kleinanzeigenChatImage = undefined;
  }

  if (
    !refunded &&
    isCrucialRamListingText(lineItem.title) &&
    (Math.abs((payout.net ?? payout.sellPrice) - 107.73) < 0.02 ||
      Math.abs((order.grossTotal ?? 0) - 138.93) < 0.02 ||
      Math.abs((item.sellPrice ?? 0) - 107.73) < 0.02)
  ) {
    return patchCrucialRamInvoiceSale(next, taxMode);
  }

  return next;
}
