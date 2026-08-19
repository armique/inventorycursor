import type { EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';
import { roundMoney } from '../services/financialAggregation';
import { saleProceedsFromHubPayout } from './saleProceeds';
import type { SaleProceedsBreakdown } from '../types';

export type SellerHubSaleFields = {
  sellPrice: number | null;
  feeAmount: number;
  hasFee: boolean;
  sellerPaidShipping: boolean;
  sellerShippingAmount: number;
  saleProceeds: SaleProceedsBreakdown;
  ebayOrderId?: string;
};

/** Map Seller Hub payout onto sale form fields: buyer gross, fees, label, net. */
export function saleFieldsFromHubPayout(payout: EbaySellerHubPayout): SellerHubSaleFields {
  const sellPrice =
    payout.buyerTotalEur != null && Number.isFinite(payout.buyerTotalEur)
      ? roundMoney(payout.buyerTotalEur)
      : payout.itemGrossEur != null && payout.buyerShippingEur != null
        ? roundMoney(payout.itemGrossEur + payout.buyerShippingEur)
        : payout.itemGrossEur != null
          ? roundMoney(payout.itemGrossEur)
          : null;
  const feeAmount = roundMoney(
    (payout.transactionFeeEur ?? 0) +
      (payout.adFeeEur ?? 0) +
      (payout.otherFeeEur ?? 0) +
      (payout.shippingLabelEur ?? 0)
  );
  return {
    sellPrice,
    feeAmount,
    hasFee: feeAmount >= 0.01,
    sellerPaidShipping: false,
    sellerShippingAmount: 0,
    saleProceeds: saleProceedsFromHubPayout(payout),
    ebayOrderId: payout.orderId || undefined,
  };
}

export {
  EBAY_SELLER_HUB_ORDERS_URL,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
} from '../lib/ebaySellerHubPayout.js';
