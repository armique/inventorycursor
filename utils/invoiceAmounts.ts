import type { InventoryItem } from '../types';
import { roundMoney } from '../services/financialAggregation';

/** Seller-paid label / buyer Versand stored on the sale row. */
export function getInvoiceShippingAmount(item: InventoryItem): number {
  if (!item.sellerPaidShipping) return 0;
  const amount = roundMoney(item.sellerShippingAmount);
  return amount > 0 ? amount : 0;
}

/**
 * Buyer-facing document amounts.
 * sellPrice is the gross the buyer paid (item + Versand when shipping is recorded).
 * Invoice splits Versand out so Gesamtbetrag still equals that gross.
 */
export function getInvoiceItemAmounts(item: InventoryItem): {
  itemGross: number;
  shippingGross: number;
  totalGross: number;
} {
  const sell = roundMoney(item.sellPrice);
  const shippingGross = getInvoiceShippingAmount(item);
  if (shippingGross > 0 && sell > shippingGross) {
    return {
      itemGross: roundMoney(sell - shippingGross),
      shippingGross,
      totalGross: sell,
    };
  }
  return {
    itemGross: sell,
    shippingGross,
    totalGross: roundMoney(sell + shippingGross),
  };
}

export function getInvoiceDocumentTotals(items: InventoryItem[]): {
  itemGross: number;
  shippingGross: number;
  totalGross: number;
} {
  return items.reduce(
    (acc, item) => {
      const row = getInvoiceItemAmounts(item);
      return {
        itemGross: roundMoney(acc.itemGross + row.itemGross),
        shippingGross: roundMoney(acc.shippingGross + row.shippingGross),
        totalGross: roundMoney(acc.totalGross + row.totalGross),
      };
    },
    { itemGross: 0, shippingGross: 0, totalGross: 0 }
  );
}
