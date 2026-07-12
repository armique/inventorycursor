import { CustomerInfo, InventoryItem, ItemStatus, TaxMode } from '../types';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { getLinePayout } from './ebayOrderPayout';
import { calculateSaleProfit } from './saleProfit';

/** Apply a cached eBay order match onto an inventory row (link order id, buyer, net sell price, profit). */
export function applyEbayOrderMatchToItem(
  item: InventoryItem,
  match: EbayOrderMatch,
  taxMode: TaxMode
): InventoryItem {
  const { order, lineItem } = match;
  const payout = getLinePayout(order, lineItem);
  const profit = calculateSaleProfit(payout.sellPrice, item.buyPrice, payout.fee, taxMode);

  const customer: CustomerInfo = {
    name: order.buyer.fullName || order.buyer.username || '',
    address: order.buyer.address || '',
    ...(order.buyer.phone ? { phone: order.buyer.phone } : {}),
    ...(order.buyer.email ? { email: order.buyer.email } : {}),
  };

  const originalSellPrice =
    item.originalSellPrice ??
    (item.sellPrice != null && item.ebayOrderId === order.orderId ? item.sellPrice : payout.sellPrice);

  return {
    ...item,
    status:
      item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED ? ItemStatus.SOLD : item.status,
    originalSellPrice,
    sellPrice: payout.sellPrice,
    sellDate: order.creationDate || item.sellDate || new Date().toISOString().split('T')[0],
    platformSold: item.platformSold || 'ebay.de',
    paymentType: item.paymentType || 'ebay.de',
    profit: parseFloat(profit.toFixed(2)),
    customer: customer.name || customer.address ? customer : item.customer,
    ebayUsername: order.buyer.username || item.ebayUsername,
    ebayOrderId: order.orderId,
    hasFee: Boolean(payout.fee),
    feeAmount: payout.fee,
  };
}
