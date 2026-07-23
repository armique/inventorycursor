import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet, sumOrderFeeDeductions } from './ebayOrderFinancial';
import { DEFAULT_FLIP_FEES, loadFlipFees, totalEbayFeePct } from './flipCoach';

export interface LinePayout {
  gross: number | null;
  net: number | null;
  fee: number;
  /** Amount to store as sellPrice — net (payout) when known, otherwise gross (buyer item total). */
  sellPrice: number;
  netKnown: boolean;
  /**
   * True when fee came from Flip Coach % (API orders have no fee breakdown).
   * Exact fees still come from CSV/financial events when present.
   */
  feeEstimated: boolean;
}

function prorateOrderAmount(orderAmount: number | null | undefined, lineGross: number | null, order: EbayOrderRecord): number | null {
  if (orderAmount == null || !Number.isFinite(orderAmount)) return null;
  if (order.lineItems.length <= 1) return orderAmount;
  const line = lineGross ?? 0;
  const fromLines = order.lineItems.reduce((sum, li) => sum + (li.lineItemCost ?? 0), 0);
  const base = fromLines > 0 ? fromLines : order.grossTotal ?? 0;
  if (!base || base <= 0) return null;
  return (line / base) * orderAmount;
}

/** Estimate Verkaufsgebühr + ads from Flip Coach settings (default ~25%). */
export function estimateEbayMarketplaceFee(gross: number, feePctOverride?: number): number {
  if (!(gross > 0) || !Number.isFinite(gross)) return 0;
  let pct = feePctOverride;
  if (pct == null) {
    try {
      pct = totalEbayFeePct(loadFlipFees());
    } catch {
      pct = totalEbayFeePct(DEFAULT_FLIP_FEES);
    }
  }
  if (!(pct > 0)) return 0;
  return Math.round(gross * (pct / 100) * 100) / 100;
}

/**
 * Best-effort payout for one order line.
 * Net = signed sum of all CSV/API financial events on the order (Bestelleinnahmen),
 * matching eBay Seller Hub “Ihr Verkaufserlös → Bestelleinnahmen”.
 *
 * Fulfillment API alone only returns buyer/gross totals — when net/fees are missing we
 * estimate fees from Flip Coach % so Mark-as-sold profit isn't inflated.
 */
export function getLinePayout(order: EbayOrderRecord, line: EbayOrderLineItem): LinePayout {
  const gross =
    line.lineItemCost ??
    (order.lineItems.length === 1 ? order.grossTotal ?? null : null);

  const orderNet = getOrderEffectiveNet(order);
  const net = prorateOrderAmount(orderNet, gross, order);
  let fee = prorateOrderAmount(sumOrderFeeDeductions(order), gross, order) ?? sumOrderFeeDeductions(order);
  let feeEstimated = false;

  if (net == null && !(fee > 0) && gross != null && gross > 0) {
    // Fee base: prefer order total for single-line (eBay fees often include buyer shipping).
    const feeBase =
      order.lineItems.length <= 1 && order.grossTotal != null && order.grossTotal > gross
        ? order.grossTotal
        : gross;
    fee = estimateEbayMarketplaceFee(feeBase);
    feeEstimated = fee > 0;
  }

  const sellPrice = net ?? gross ?? 0;
  return {
    gross,
    net,
    fee: fee || 0,
    sellPrice,
    netKnown: net != null,
    feeEstimated,
  };
}
