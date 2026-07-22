import type { ParsedEbayOrderScreenshot } from '../services/ebayOrderScreenshotAI';

/** Flattened sale fields derived from an eBay order screenshot parse. */
export type EbayScreenshotSaleFields = {
  /** Item sold price excluding buyer shipping — store as InventoryItem.sellPrice. */
  soldPriceExShippingEur: number | null;
  buyerShippingEur: number | null;
  ebayFeeEur: number | null;
  adFeeEur: number | null;
  /** Seller Auszahlung after fees — display only. */
  amountReceivedNetEur: number | null;
  /** ebayFee + adFee (0 if neither known). */
  totalFeesEur: number;
  hasFee: boolean;
};

export function ebayScreenshotSaleFields(
  data: ParsedEbayOrderScreenshot
): EbayScreenshotSaleFields {
  const ebayFeeEur =
    data.ebayFeeEur != null && Number.isFinite(data.ebayFeeEur) ? Math.max(0, data.ebayFeeEur) : null;
  const adFeeEur =
    data.adFeeEur != null && Number.isFinite(data.adFeeEur) ? Math.max(0, data.adFeeEur) : null;
  const totalFeesEur = (ebayFeeEur ?? 0) + (adFeeEur ?? 0);
  return {
    soldPriceExShippingEur:
      data.soldPriceExShippingEur != null && Number.isFinite(data.soldPriceExShippingEur)
        ? data.soldPriceExShippingEur
        : null,
    buyerShippingEur:
      data.buyerShippingEur != null && Number.isFinite(data.buyerShippingEur)
        ? data.buyerShippingEur
        : null,
    ebayFeeEur,
    adFeeEur,
    amountReceivedNetEur:
      data.amountReceivedNetEur != null && Number.isFinite(data.amountReceivedNetEur)
        ? data.amountReceivedNetEur
        : null,
    totalFeesEur,
    hasFee: totalFeesEur > 0,
  };
}
