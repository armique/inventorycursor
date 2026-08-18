import type { InventoryItem, SaleProceedsBreakdown } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { roundMoney } from '../services/financialAggregation';
import { getLinePayout } from './ebayOrderPayout';
import type { EbayScreenshotSaleFields } from './ebayScreenshotSaleFields';
import type { EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';

const LABEL_RE = /versandetikett|shipping\s*label|shippinglabel|versandlabel/i;
const ADS_RE = /anzeige|promot|ads|werbung|insertion/i;
const TX_RE = /transaktion|verkaufsgebühr|verkaufsgebuehr|final value|provision/i;

function n(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundMoney(value);
}

function sumKnown(...values: Array<number | null | undefined>): number | null {
  const parts = values.filter((v): v is number => v != null && Number.isFinite(v) && v !== 0);
  if (parts.length === 0) return null;
  return roundMoney(parts.reduce((s, v) => s + v, 0));
}

export function saleProceedsHasDetail(p: SaleProceedsBreakdown | null | undefined): boolean {
  if (!p) return false;
  return [
    p.buyerShippingEur,
    p.transactionFeeEur,
    p.adFeeEur,
    p.shippingLabelEur,
    p.otherFeeEur,
    p.netPayoutEur,
  ].some((v) => v != null && Number.isFinite(v) && Math.abs(v) >= 0.01);
}

export function saleProceedsFromScreenshot(
  money: EbayScreenshotSaleFields,
  shippingLabelEur?: number | null
): SaleProceedsBreakdown {
  const itemGrossEur = n(money.soldPriceExShippingEur);
  const buyerShippingEur = n(money.buyerShippingEur);
  const transactionFeeEur = n(money.ebayFeeEur);
  const adFeeEur = n(money.adFeeEur);
  const label = n(shippingLabelEur);
  const buyerTotalEur =
    itemGrossEur != null || buyerShippingEur != null
      ? roundMoney((itemGrossEur ?? 0) + (buyerShippingEur ?? 0))
      : null;
  const netPayoutEur =
    n(money.amountReceivedNetEur) ??
    (buyerTotalEur != null
      ? roundMoney(
          buyerTotalEur -
            (transactionFeeEur ?? 0) -
            (adFeeEur ?? 0) -
            (label ?? 0)
        )
      : null);
  return {
    capturedAt: new Date().toISOString(),
    source: 'ebay_screenshot',
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur: label,
    otherFeeEur: null,
    netPayoutEur,
  };
}

export function saleProceedsFromHubPayout(payout: EbaySellerHubPayout): SaleProceedsBreakdown {
  const itemGrossEur = n(payout.itemGrossEur);
  const buyerShippingEur = n(payout.buyerShippingEur);
  const transactionFeeEur = n(payout.transactionFeeEur);
  const adFeeEur = n(payout.adFeeEur);
  const label = n(payout.shippingLabelEur);
  const otherFeeEur = n(payout.otherFeeEur);
  const buyerTotalEur =
    n(payout.buyerTotalEur) ??
    (itemGrossEur != null || buyerShippingEur != null
      ? roundMoney((itemGrossEur ?? 0) + (buyerShippingEur ?? 0))
      : null);
  const netPayoutEur =
    n(payout.netPayoutEur) ??
    (buyerTotalEur != null
      ? roundMoney(
          buyerTotalEur -
            (transactionFeeEur ?? 0) -
            (adFeeEur ?? 0) -
            (label ?? 0) -
            (otherFeeEur ?? 0)
        )
      : null);
  return {
    capturedAt: new Date().toISOString(),
    source: 'ebay_seller_hub',
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur: label,
    otherFeeEur,
    netPayoutEur,
  };
}

function feeBucket(transactionType?: string, description?: string): 'label' | 'ads' | 'tx' | 'other' {
  const t = `${transactionType || ''} ${description || ''}`;
  if (LABEL_RE.test(t)) return 'label';
  if (ADS_RE.test(t)) return 'ads';
  if (TX_RE.test(t)) return 'tx';
  return 'other';
}

export function saleProceedsFromOrder(
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): SaleProceedsBreakdown {
  const payout = getLinePayout(order, line);
  let tx = 0;
  let ads = 0;
  let label = 0;
  let other = 0;
  for (const event of order.financialEvents || []) {
    if (event.kind !== 'fee' || !(event.amount < -0.001)) continue;
    const abs = Math.abs(event.amount);
    const bucket = feeBucket(event.transactionType, event.description);
    if (bucket === 'label') label += abs;
    else if (bucket === 'ads') ads += abs;
    else if (bucket === 'tx') tx += abs;
    else other += abs;
  }
  const itemGrossEur = n(line.lineItemCost ?? payout.gross);
  const buyerTotalEur = n(order.grossTotal ?? payout.gross ?? itemGrossEur);
  const buyerShippingEur =
    buyerTotalEur != null && itemGrossEur != null && buyerTotalEur > itemGrossEur
      ? roundMoney(buyerTotalEur - itemGrossEur)
      : n(order.shippingCost);
  const feeTotal = tx + ads + other;
  const transactionFeeEur = n(tx) ?? (feeTotal <= 0 && payout.fee > 0 && label <= 0 ? n(payout.fee) : null);
  return {
    capturedAt: new Date().toISOString(),
    source: 'ebay_order',
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur,
    adFeeEur: n(ads),
    shippingLabelEur: n(label),
    otherFeeEur: n(other),
    netPayoutEur: n(payout.net) ?? n(payout.sellPrice),
  };
}

export function saleProceedsFromItemFields(item: InventoryItem): SaleProceedsBreakdown {
  const itemGrossEur = n(item.sellPrice);
  const shippingLabelEur = item.sellerPaidShipping ? n(item.sellerShippingAmount) : null;
  const fee = n(item.feeAmount);
  const stored = item.saleProceeds;
  const buyerShippingEur = n(stored?.buyerShippingEur);
  const buyerTotalEur =
    stored?.buyerTotalEur != null
      ? n(stored.buyerTotalEur)
      : itemGrossEur != null && shippingLabelEur != null && stored?.source === 'ebay_screenshot'
        ? roundMoney(itemGrossEur + (buyerShippingEur ?? 0))
        : itemGrossEur;
  const netPayoutEur =
    n(stored?.netPayoutEur) ??
    (itemGrossEur != null
      ? roundMoney(itemGrossEur - (fee ?? 0) - (shippingLabelEur ?? 0))
      : null);
  return {
    capturedAt: stored?.capturedAt || new Date().toISOString(),
    source: stored?.source || 'inferred',
    itemGrossEur: n(stored?.itemGrossEur) ?? itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur: n(stored?.transactionFeeEur) ?? (stored?.adFeeEur == null ? fee : null),
    adFeeEur: n(stored?.adFeeEur),
    shippingLabelEur: n(stored?.shippingLabelEur) ?? shippingLabelEur,
    otherFeeEur: n(stored?.otherFeeEur),
    netPayoutEur,
  };
}

export function resolveSaleProceeds(item: InventoryItem): SaleProceedsBreakdown | null {
  const merged = saleProceedsFromItemFields(item);
  return saleProceedsHasDetail(merged) || merged.itemGrossEur != null ? merged : null;
}

export type SaleProceedsRow = {
  id: string;
  label: string;
  amount: number;
  tone: 'in' | 'out' | 'total' | 'net';
};

export function saleProceedsRows(p: SaleProceedsBreakdown): SaleProceedsRow[] {
  const rows: SaleProceedsRow[] = [];
  const item = p.itemGrossEur;
  const ship = p.buyerShippingEur;
  if (item != null) rows.push({ id: 'item', label: 'Artikel (Käufer)', amount: item, tone: 'in' });
  if (ship != null && Math.abs(ship) >= 0.01) {
    rows.push({ id: 'buyer-ship', label: 'Versand (Käufer)', amount: ship, tone: 'in' });
  }
  const buyerTotal = p.buyerTotalEur ?? sumKnown(item, ship);
  if (buyerTotal != null && (ship != null || p.buyerTotalEur != null)) {
    rows.push({ id: 'buyer-total', label: 'Vom Käufer bezahlt', amount: buyerTotal, tone: 'total' });
  }
  if (p.transactionFeeEur != null && Math.abs(p.transactionFeeEur) >= 0.01) {
    rows.push({ id: 'tx', label: 'Transaktionsgebühren', amount: -Math.abs(p.transactionFeeEur), tone: 'out' });
  }
  if (p.adFeeEur != null && Math.abs(p.adFeeEur) >= 0.01) {
    rows.push({ id: 'ads', label: 'Anzeigengebühr', amount: -Math.abs(p.adFeeEur), tone: 'out' });
  }
  if (p.otherFeeEur != null && Math.abs(p.otherFeeEur) >= 0.01) {
    rows.push({ id: 'other', label: 'Weitere Gebühren', amount: -Math.abs(p.otherFeeEur), tone: 'out' });
  }
  if (p.shippingLabelEur != null && Math.abs(p.shippingLabelEur) >= 0.01) {
    rows.push({ id: 'label', label: 'Versandetikett', amount: -Math.abs(p.shippingLabelEur), tone: 'out' });
  }
  if (p.netPayoutEur != null) {
    rows.push({ id: 'net', label: 'Bestelleinnahmen', amount: p.netPayoutEur, tone: 'net' });
  }
  return rows;
}
