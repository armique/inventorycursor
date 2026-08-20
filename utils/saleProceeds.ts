import type { InventoryItem, SaleProceedsBreakdown } from '../types';
import { ItemStatus } from '../types';
import { hasEbaySaleSignals, resolveSalePlatform } from './salePlatform';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { roundMoney } from '../services/financialAggregation';
import { getLinePayout } from './ebayOrderPayout';
import { sumOrderRefundEur } from './ebayOrderFinancial';
import type { EbayScreenshotSaleFields } from './ebayScreenshotSaleFields';
import type { EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';

const LABEL_RE = /versandetikett|shipping\s*label|shippinglabel|versandlabel/i;
const ADS_RE = /anzeige|promot|ads|werbung|insertion|ad_fee/i;
const TX_RE = /transaktion|verkaufsgebühr|verkaufsgebuehr|final.value|final_value|provision/i;

function n(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundMoney(value);
}

function sumKnown(...values: Array<number | null | undefined>): number | null {
  const parts = values.filter((v): v is number => v != null && Number.isFinite(v) && v !== 0);
  if (parts.length === 0) return null;
  return roundMoney(parts.reduce((s, v) => s + v, 0));
}

/** Hub, screenshot, or bound eBay order with real fee buckets — not Flip Coach estimates. */
export function isTrustedEbayProceeds(p: InventoryItem['saleProceeds'] | null | undefined): boolean {
  if (!p || p.feesEstimated) return false;
  return p.source === 'ebay_seller_hub' || p.source === 'ebay_screenshot' || p.source === 'ebay_order';
}

function absEur(value: number | null | undefined): number {
  return Math.abs(Number(value) || 0);
}

/**
 * Sell cell shows ads / eBay fee lines. Hub + screenshot are trusted; older eBay sales
 * often still have the split (or a lump feeAmount) with source "inferred".
 */
export function shouldShowSellCellMarketplaceFees(
  item: Pick<
    InventoryItem,
    | 'saleProceeds'
    | 'platformSold'
    | 'paymentType'
    | 'ebayOrderId'
    | 'ebayUsername'
    | 'ebayOrderScreenshotUrl'
    | 'feeAmount'
    | 'hasFee'
  >,
  showPriceBreakdown = false
): boolean {
  if (showPriceBreakdown) return true;
  if (isTrustedEbayProceeds(item.saleProceeds)) return true;
  const p = item.saleProceeds;
  if (p && !p.feesEstimated) {
    if (absEur(p.adFeeEur) >= 0.01 || absEur(p.transactionFeeEur) >= 0.01 || absEur(p.otherFeeEur) >= 0.01) {
      return true;
    }
  }
  const ebaySale =
    resolveSalePlatform(item) === 'ebay.de' || Boolean(String(item.ebayOrderScreenshotUrl || '').trim());
  if (!ebaySale) return false;
  return absEur(item.feeAmount) >= 0.01 || Boolean(item.hasFee) || saleProceedsHasDetail(p);
}

/** Kleinanzeigen / in-person / other — shipping is typed in by you, not Seller Hub. */
export function canEditManualSellerShipping(
  item: Pick<
    InventoryItem,
    'status' | 'platformSold' | 'paymentType' | 'ebayOrderId' | 'ebayUsername' | 'saleProceeds'
  >
): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  if (resolveSalePlatform(item) === 'ebay.de' || hasEbaySaleSignals(item)) return false;
  if (isTrustedEbayProceeds(item.saleProceeds)) return false;
  return true;
}

/** Stamp the shipping you paid on a non-eBay sale (deducted from pocket margin). */
export function applyManualSellerShipping(item: InventoryItem, amount: number): InventoryItem {
  const shipping = roundMoney(Math.max(0, Number.isFinite(amount) ? amount : 0));
  const paid = shipping >= 0.01;
  const next: InventoryItem = {
    ...item,
    sellerPaidShipping: paid,
    sellerShippingAmount: paid ? shipping : undefined,
  };
  if (isTrustedEbayProceeds(item.saleProceeds)) return next;
  const inferred = saleProceedsFromItemFields(next);
  return {
    ...next,
    saleProceeds: {
      ...inferred,
      source: item.saleProceeds?.source === 'inferred' || !item.saleProceeds ? 'inferred' : item.saleProceeds.source,
      shippingLabelEur: paid ? shipping : null,
    },
  };
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
    p.buyerTotalEur,
    p.refundEur,
  ].some((v) => v != null && Number.isFinite(v) && Math.abs(v) >= 0.01);
}

/** Sum of marketplace fee buckets (tx + ads + label + other). */
export function saleProceedsFeeTotal(p: SaleProceedsBreakdown | null | undefined): number {
  if (!p) return 0;
  return roundMoney(
    Math.abs(p.transactionFeeEur ?? 0) +
      Math.abs(p.adFeeEur ?? 0) +
      Math.abs(p.shippingLabelEur ?? 0) +
      Math.abs(p.otherFeeEur ?? 0)
  );
}

/** Hub/list net: subtract a goodwill refund when stored net is still the pre-refund payout. */
export function netPayoutAfterRefund(
  total: number | null | undefined,
  feeTotal: number,
  knownNet: number | null | undefined,
  refundEur: number
): number | null {
  const refund = refundEur >= 0.01 ? roundMoney(refundEur) : 0;
  const fees = roundMoney(Math.abs(feeTotal) || 0);
  const preRefund =
    knownNet != null && Number.isFinite(knownNet)
      ? roundMoney(knownNet)
      : total != null && Number.isFinite(total)
        ? roundMoney(total - fees)
        : null;
  if (preRefund == null) return null;
  if (refund < 0.01) return preRefund;
  const impliedPreRefund = total != null && Number.isFinite(total) ? roundMoney(total - fees) : null;
  if (impliedPreRefund != null && Math.abs(preRefund - impliedPreRefund) < 0.05) {
    return roundMoney(preRefund - refund);
  }
  return preRefund;
}

export function saleProceedsSourceLabel(p: SaleProceedsBreakdown | null | undefined): string {
  if (!p) return '';
  if (p.feesEstimated) return 'geschätzt — nicht EÜR-maßgeblich';
  if (p.source === 'ebay_seller_hub') return 'Seller Hub';
  if (p.source === 'ebay_screenshot') return 'Screenshot';
  if (p.source === 'ebay_order') return 'eBay-Abrechnung';
  return 'aus App-Feldern';
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
  const useEstimatedFee = payout.feeEstimated;
  const transactionFeeEur =
    n(tx) ?? (!useEstimatedFee && feeTotal <= 0 && payout.fee > 0 && label <= 0 ? n(payout.fee) : null);
  return {
    capturedAt: new Date().toISOString(),
    source: order.sources?.includes('hub') ? 'ebay_seller_hub' : 'ebay_order',
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur: useEstimatedFee ? null : transactionFeeEur,
    adFeeEur: useEstimatedFee ? null : n(ads),
    shippingLabelEur: n(label),
    otherFeeEur: useEstimatedFee ? null : n(other),
    refundEur: n(sumOrderRefundEur(order)) || null,
    netPayoutEur: payout.netKnown ? n(payout.net) : null,
    feesEstimated: useEstimatedFee,
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
  const refundEur = n(stored?.refundEur);
  const netPayoutEur =
    n(stored?.netPayoutEur) != null
      ? netPayoutAfterRefund(
          buyerTotalEur,
          Math.abs(n(stored?.transactionFeeEur) ?? fee ?? 0) +
            Math.abs(n(stored?.adFeeEur) ?? 0) +
            Math.abs(n(stored?.shippingLabelEur) ?? shippingLabelEur ?? 0) +
            Math.abs(n(stored?.otherFeeEur) ?? 0),
          n(stored?.netPayoutEur),
          refundEur ?? 0
        )
      : itemGrossEur != null
        ? roundMoney(itemGrossEur - (fee ?? 0) - (shippingLabelEur ?? 0) - (refundEur ?? 0))
        : null;
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
    refundEur: n(stored?.refundEur),
    netPayoutEur,
    feesEstimated: stored?.feesEstimated,
  };
}

export function resolveSaleProceeds(item: InventoryItem): SaleProceedsBreakdown | null {
  const merged = saleProceedsFromItemFields(item);
  return saleProceedsHasDetail(merged) || merged.itemGrossEur != null ? merged : null;
}

export type SaleColumnSplit = {
  totalEur: number;
  buyerShippingEur: number;
  adFeeEur: number;
  ebayFeeEur: number;
  otherFeeEur: number;
  shippingEur: number;
  refundEur: number;
  netEur: number | null;
};

/** List-column split: buyer total, orange marketplace fees, shipping label, refund, net. */
export function saleColumnSplit(
  item: InventoryItem,
  extras?: { displaySellEur?: number | null; shippingFallbackEur?: number; refundFallbackEur?: number }
): SaleColumnSplit | null {
  const display = extras?.displaySellEur ?? item.sellPrice;
  if (display == null || !Number.isFinite(display)) return null;
  const p = resolveSaleProceeds(item);
  const total = n(p?.buyerTotalEur) ?? roundMoney(display);
  let adFeeEur = Math.abs(n(p?.adFeeEur) ?? 0);
  let ebayFeeEur = Math.abs(n(p?.transactionFeeEur) ?? 0);
  let otherFeeEur = Math.abs(n(p?.otherFeeEur) ?? 0);
  let shippingEur = Math.abs(n(p?.shippingLabelEur) ?? 0);
  if (shippingEur < 0.005) shippingEur = Math.abs(extras?.shippingFallbackEur ?? 0);
  const itemizedFees = adFeeEur >= 0.005 || ebayFeeEur >= 0.005 || otherFeeEur >= 0.005;
  const lumped = Math.abs(Number(item.feeAmount) || 0);
  if (!itemizedFees) {
    const labelInFees = !item.sellerPaidShipping && (p?.shippingLabelEur != null || shippingEur >= 0.005);
    ebayFeeEur = Math.max(0, roundMoney(lumped - (labelInFees ? shippingEur : 0)));
  } else if (shippingEur < 0.005 && lumped >= 0.01) {
    const extra = roundMoney(lumped - adFeeEur - ebayFeeEur - otherFeeEur);
    if (extra >= 0.01) shippingEur = extra;
  }
  const refundEur = Math.max(Math.abs(n(p?.refundEur) ?? 0), Math.abs(extras?.refundFallbackEur ?? 0));
  if (shippingEur < 0.005) {
    const storedNet = n(p?.netPayoutEur);
    if (storedNet != null) {
      const implied = roundMoney(total - adFeeEur - ebayFeeEur - otherFeeEur - refundEur - storedNet);
      if (implied >= 0.01 && implied < total - 0.005) {
        if (!itemizedFees && ebayFeeEur + 0.001 >= implied) {
          ebayFeeEur = roundMoney(Math.max(0, ebayFeeEur - implied));
        }
        shippingEur = implied;
      }
    }
  }
  const feeTotal = adFeeEur + ebayFeeEur + otherFeeEur + shippingEur;
  const netEur = netPayoutAfterRefund(total, feeTotal, n(p?.netPayoutEur), refundEur);
  return {
    totalEur: total,
    buyerShippingEur: Math.abs(n(p?.buyerShippingEur) ?? 0),
    adFeeEur,
    ebayFeeEur,
    otherFeeEur,
    shippingEur,
    refundEur,
    netEur,
  };
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
  if (p.refundEur != null && Math.abs(p.refundEur) >= 0.01) {
    rows.push({ id: 'refund', label: 'Erstattet', amount: -Math.abs(p.refundEur), tone: 'out' });
  }
  if (p.netPayoutEur != null) {
    rows.push({ id: 'net', label: 'Bestelleinnahmen', amount: p.netPayoutEur, tone: 'net' });
  }
  return rows;
}
