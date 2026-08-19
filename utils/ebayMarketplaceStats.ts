import type { InventoryItem } from '../types';
import { roundMoney } from '../services/financialAggregation';
import { resolveSalePlatform } from './salePlatform';
import { resolveSaleProceeds } from './saleProceeds';

export type EbayMarketplaceCosts = {
  saleCount: number;
  salesWithTakeRate: number;
  grossEur: number;
  ebayFeeEur: number;
  adFeeEur: number;
  shippingLabelEur: number;
  netEur: number;
  takeEur: number;
  /** Weighted (gross − net) / gross · 100. Example: €150 sale, €120 kept → 20. */
  avgTakePct: number | null;
};

function money(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return roundMoney(Math.abs(v));
}

function lineCosts(item: InventoryItem) {
  const p = resolveSaleProceeds(item);
  const gross = money(p?.buyerTotalEur ?? item.sellPrice);
  const ads = money(p?.adFeeEur);
  let ebayFee = money(p?.transactionFeeEur);
  const label = money(p?.shippingLabelEur);
  const other = money(p?.otherFeeEur);
  if (ebayFee < 0.005 && ads < 0.005) {
    const lumped = money(item.feeAmount);
    const labelInFees = !item.sellerPaidShipping && label >= 0.005;
    ebayFee = Math.max(0, roundMoney(lumped - ads - (labelInFees ? label : 0)));
  }
  const deducted = roundMoney(ebayFee + ads + other + label);
  let net = p?.netPayoutEur != null && Number.isFinite(p.netPayoutEur) ? roundMoney(p.netPayoutEur) : null;
  if (net == null && gross >= 0.01 && deducted >= 0.01) {
    net = roundMoney(gross - deducted);
  }
  return { gross, ebayFee, ads, label, other, net, deducted };
}

/** eBay tx fees, promoted-listing ads, and average % of buyer total that never reaches you. */
export function summarizeEbayMarketplaceCosts(soldItems: InventoryItem[]): EbayMarketplaceCosts {
  const empty: EbayMarketplaceCosts = {
    saleCount: 0,
    salesWithTakeRate: 0,
    grossEur: 0,
    ebayFeeEur: 0,
    adFeeEur: 0,
    shippingLabelEur: 0,
    netEur: 0,
    takeEur: 0,
    avgTakePct: null,
  };
  let saleCount = 0;
  let salesWithTakeRate = 0;
  let grossEur = 0;
  let ebayFeeEur = 0;
  let adFeeEur = 0;
  let shippingLabelEur = 0;
  let netEur = 0;
  let takeWeightGross = 0;
  let takeWeightLost = 0;

  for (const item of soldItems) {
    if (resolveSalePlatform(item) !== 'ebay.de') continue;
    const line = lineCosts(item);
    if (line.gross < 0.01 && line.ebayFee < 0.01 && line.ads < 0.01) continue;
    saleCount += 1;
    grossEur = roundMoney(grossEur + line.gross);
    ebayFeeEur = roundMoney(ebayFeeEur + line.ebayFee);
    adFeeEur = roundMoney(adFeeEur + line.ads);
    shippingLabelEur = roundMoney(shippingLabelEur + line.label);
    if (line.net != null) netEur = roundMoney(netEur + line.net);
    if (line.gross >= 0.01 && line.net != null) {
      salesWithTakeRate += 1;
      takeWeightGross = roundMoney(takeWeightGross + line.gross);
      takeWeightLost = roundMoney(takeWeightLost + Math.max(0, line.gross - line.net));
    }
  }

  if (saleCount === 0) return empty;

  const takeEur = takeWeightGross >= 0.01 ? takeWeightLost : roundMoney(ebayFeeEur + adFeeEur + shippingLabelEur);
  const avgTakePct =
    takeWeightGross >= 0.01 ? roundMoney((takeWeightLost / takeWeightGross) * 100) : null;

  return {
    saleCount,
    salesWithTakeRate,
    grossEur,
    ebayFeeEur,
    adFeeEur,
    shippingLabelEur,
    netEur,
    takeEur,
    avgTakePct,
  };
}
