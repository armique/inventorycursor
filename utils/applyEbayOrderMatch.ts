import { InventoryItem, ItemStatus, TaxMode } from '../types';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { customerFromEbayOrder } from './ebayOrderBuyerData';
import { getLinePayout } from './ebayOrderPayout';
import { calculateSaleProfit } from './saleProfit';
import { hasPostSaleRefund, sumOrderSaleProceeds } from './ebayOrderFinancial';

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
  const { order, lineItem } = match;
  const payout = getLinePayout(order, lineItem);
  const feeForProfit = payout.netKnown ? 0 : payout.fee;
  const profit = calculateSaleProfit(payout.sellPrice, item.buyPrice, feeForProfit, taxMode);

  const customer = customerFromEbayOrder(order);
  const hadKleinanzeigenSale =
    item.platformSold === 'kleinanzeigen.de' || item.paymentType?.startsWith('Kleinanzeigen');

  const originalSellPrice =
    item.originalSellPrice ??
    (hasPostSaleRefund(order)
      ? sumOrderSaleProceeds(order) ?? payout.sellPrice
      : item.sellPrice != null && item.ebayOrderId === order.orderId
        ? item.sellPrice
        : payout.sellPrice);

  const next: InventoryItem = {
    ...item,
    status:
      item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED ? ItemStatus.SOLD : item.status,
    originalSellPrice,
    sellPrice: payout.sellPrice,
    sellDate: order.creationDate || item.sellDate || new Date().toISOString().split('T')[0],
    platformSold: shouldCorrectSalePlatformToEbay(item) ? 'ebay.de' : item.platformSold || 'ebay.de',
    paymentType: shouldCorrectSalePlatformToEbay(item) ? 'ebay.de' : item.paymentType || 'ebay.de',
    profit: parseFloat(profit.toFixed(2)),
    customer:
      customer.name || customer.address || customer.phone || customer.email ? customer : item.customer,
    ebayUsername: order.buyer.username || item.ebayUsername,
    ebayOrderId: order.orderId,
    ebaySku: lineItem.sku || item.ebaySku,
    ebayListingId: lineItem.listingId || item.ebayListingId,
    hasFee: !payout.netKnown && Boolean(payout.fee),
    feeAmount: payout.netKnown ? 0 : payout.fee,
  };

  if (hadKleinanzeigenSale) {
    next.kleinanzeigenChatUrl = undefined;
    next.kleinanzeigenChatImage = undefined;
  }

  return next;
}
