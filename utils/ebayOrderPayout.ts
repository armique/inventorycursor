import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet } from './ebayOrderFinancial';

export interface LinePayout {
  gross: number | null;
  net: number | null;
  fee: number;
  /** Amount to store as sellPrice — net (payout) when known, otherwise gross. */
  sellPrice: number;
  netKnown: boolean;
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

function getSaleEventNetForLine(order: EbayOrderRecord, line: EbayOrderLineItem): number | null {
  const sales = (order.financialEvents || []).filter((e) => e.kind === 'sale');
  if (!sales.length) return null;
  if (sales.length === 1 && order.lineItems.length <= 1) return sales[0].amount;
  const lineGross = line.lineItemCost;
  if (lineGross != null) {
    const match = sales.find(
      (e) =>
        (e.grossAmount != null && Math.abs(e.grossAmount - lineGross) < 0.05) ||
        (e.description && line.title && e.description.includes(line.title.slice(0, 24)))
    );
    if (match) return match.amount;
  }
  return sales.length === 1 ? sales[0].amount : null;
}

/** Best-effort payout for one order line — prefers net (after fees/taxes) when the cache has it (usually from CSV). */
export function getLinePayout(order: EbayOrderRecord, line: EbayOrderLineItem): LinePayout {
  const gross =
    line.lineItemCost ??
    (order.lineItems.length === 1 ? order.grossTotal ?? null : null);

  const saleLineNet = getSaleEventNetForLine(order, line);
  const orderNet = saleLineNet ?? getOrderEffectiveNet(order);
  const net = prorateOrderAmount(orderNet, gross, order);
  const feeRaw = prorateOrderAmount(order.feeTotal, gross, order);
  const fee =
    feeRaw ??
    (net != null && order.grossTotal != null && orderNet == null
      ? Math.max(0, order.grossTotal - (order.netTotal ?? 0))
      : 0);

  const sellPrice = net ?? gross ?? 0;
  return {
    gross,
    net,
    fee: fee || 0,
    sellPrice,
    netKnown: net != null,
  };
}
