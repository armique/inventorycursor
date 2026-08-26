/**
 * ASUS GTX 1080 ROG Strix · eBay 26-14839-00163 (7 Jul 2026).
 *
 * Hub Transaktionsbericht (authoritative):
 *   Bestellung Gesamtbetrag     €126,08  (Artikel €119,89 + Käufer-Versand €6,19)
 *   Transaktionsgebühren        −€8,04
 *   Anzeigengebühr Basis        −€15,01
 *   Versandetikett              −€6,19
 *   Bestelleinnahmen            €96,84
 *
 * The sold row was stamped from Bestellung “Betrag abzügl. Kosten” (€118,04) —
 * that Hub line is only after FVF. Ads + label sit on separate rows. The Hub
 * archive for this order also has empty lineItems, so item/shipping were dropped
 * and auto-heal never reached the July row (cap 12).
 */
import { ItemStatus, type InventoryItem, type TaxMode } from '../types';
import { computeSoldTabMargin, roundMoney } from '../services/financialAggregation';

export const ASUS_GTX1080_ROG_ORDER_ID = '26-14839-00163';
export const ASUS_GTX1080_ROG_BUYER = 'Dominik Kardos';
export const ASUS_GTX1080_ROG_USERNAME = 'dom_65339';
export const ASUS_GTX1080_ROG_SELL_DATE = '2026-07-07';
export const ASUS_GTX1080_ROG_ITEM = 119.89;
export const ASUS_GTX1080_ROG_BUYER_SHIP = 6.19;
export const ASUS_GTX1080_ROG_BUYER_TOTAL = 126.08;
export const ASUS_GTX1080_ROG_TX = 8.04;
export const ASUS_GTX1080_ROG_ADS = 15.01;
export const ASUS_GTX1080_ROG_LABEL = 6.19;
export const ASUS_GTX1080_ROG_NET = 96.84;
export const ASUS_GTX1080_ROG_FEES = roundMoney(
  ASUS_GTX1080_ROG_TX + ASUS_GTX1080_ROG_ADS + ASUS_GTX1080_ROG_LABEL
);

function moneyEq(value: unknown, expected: number): boolean {
  return roundMoney(Number(value)) === expected;
}

function orderKey(id: string | undefined): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, '');
}

function normalizeName(name: string | undefined): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function isAsusGtx1080RogStrixName(name: string | undefined): boolean {
  const n = normalizeName(name);
  if (!n.includes('1080') || n.includes('1080 TI') || n.includes('1080TI')) return false;
  if (!n.includes('ASUS')) return false;
  return n.includes('ROG') || n.includes('STRIX');
}

function alreadyPatched(item: InventoryItem): boolean {
  return (
    moneyEq(item.sellPrice, ASUS_GTX1080_ROG_BUYER_TOTAL) &&
    moneyEq(item.saleProceeds?.buyerTotalEur, ASUS_GTX1080_ROG_BUYER_TOTAL) &&
    moneyEq(item.saleProceeds?.itemGrossEur, ASUS_GTX1080_ROG_ITEM) &&
    moneyEq(item.saleProceeds?.buyerShippingEur, ASUS_GTX1080_ROG_BUYER_SHIP) &&
    moneyEq(item.saleProceeds?.transactionFeeEur, ASUS_GTX1080_ROG_TX) &&
    moneyEq(item.saleProceeds?.adFeeEur, ASUS_GTX1080_ROG_ADS) &&
    moneyEq(item.saleProceeds?.shippingLabelEur, ASUS_GTX1080_ROG_LABEL) &&
    moneyEq(item.saleProceeds?.netPayoutEur, ASUS_GTX1080_ROG_NET) &&
    item.saleProceeds?.source === 'ebay_seller_hub' &&
    item.saleProceeds?.feesEstimated !== true
  );
}

export function matchesAsusGtx1080RogStrixHubSale(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  if (orderKey(item.ebayOrderId) === orderKey(ASUS_GTX1080_ROG_ORDER_ID)) return true;
  if (!isAsusGtx1080RogStrixName(item.name)) return false;
  const buyer = String(item.customer?.name || '');
  const user = String(item.ebayUsername || '').toLowerCase();
  return buyer.includes('Dominik') || user === ASUS_GTX1080_ROG_USERNAME;
}

export function patchAsusGtx1080RogStrixHubSale(
  item: InventoryItem,
  _taxMode?: TaxMode
): InventoryItem {
  const next: InventoryItem = {
    ...item,
    originalSellPrice: item.originalSellPrice ?? item.sellPrice,
    status: item.status === ItemStatus.TRADED ? ItemStatus.TRADED : ItemStatus.SOLD,
    sellPrice: ASUS_GTX1080_ROG_BUYER_TOTAL,
    sellDate: item.sellDate || ASUS_GTX1080_ROG_SELL_DATE,
    ebayOrderId: item.ebayOrderId || ASUS_GTX1080_ROG_ORDER_ID,
    ebayUsername: item.ebayUsername || ASUS_GTX1080_ROG_USERNAME,
    platformSold: item.platformSold || 'ebay.de',
    paymentType: item.paymentType || 'ebay.de',
    hasFee: true,
    feeAmount: ASUS_GTX1080_ROG_FEES,
    sellerPaidShipping: false,
    sellerShippingAmount: undefined,
    customer: item.customer?.name
      ? item.customer
      : { name: ASUS_GTX1080_ROG_BUYER, address: item.customer?.address || '' },
    saleProceeds: {
      capturedAt: new Date().toISOString(),
      source: 'ebay_seller_hub',
      feesEstimated: false,
      itemGrossEur: ASUS_GTX1080_ROG_ITEM,
      buyerShippingEur: ASUS_GTX1080_ROG_BUYER_SHIP,
      buyerTotalEur: ASUS_GTX1080_ROG_BUYER_TOTAL,
      transactionFeeEur: ASUS_GTX1080_ROG_TX,
      adFeeEur: ASUS_GTX1080_ROG_ADS,
      shippingLabelEur: ASUS_GTX1080_ROG_LABEL,
      otherFeeEur: null,
      refundEur: null,
      netPayoutEur: ASUS_GTX1080_ROG_NET,
    },
  };
  return { ...next, profit: parseFloat(computeSoldTabMargin(next).toFixed(2)) };
}

export function applyAsusGtx1080RogStrixHubSaleFix(
  items: InventoryItem[],
  taxMode?: TaxMode
): { items: InventoryItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (!matchesAsusGtx1080RogStrixHubSale(item) || alreadyPatched(item)) return item;
    changed = true;
    return patchAsusGtx1080RogStrixHubSale(item, taxMode);
  });
  return { items: changed ? next : items, changed };
}
