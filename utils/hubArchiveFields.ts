/**
 * Field map for `inventory-pro-ebay-order-archive` JSON
 * (Desktop: ebay-order-archive.json).
 *
 * Two Hub sections, one money story:
 *   Vom Käufer bezahlt.Gesamtbetrag  →  grossTotal / sale event "Bestellung"
 *   Ihr Verkaufserlös.Bestelleinnahmen →  netTotal
 * The Gesamtbetrag under Verkaufserlös is the same number — never add it twice.
 * shippingCost is Versandetikett (label you paid), not buyer Versand.
 */
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { roundMoney } from '../services/financialAggregation';

export const HUB_ARCHIVE_FIELD_GLOSSARY = {
  orderId: 'eBay order number (03-xxxxx-xxxxx)',
  creationDate: 'Sold date YYYY-MM-DD',
  'buyer.username': 'eBay member id',
  'buyer.fullName': 'Recipient name when Hub had it',
  'buyer.address': 'Lieferadresse',
  lineItems: 'Listing lines — often empty in the Hub scrape export',
  grossTotal: 'Gesamtbetrag the buyer paid (item + shipping − buyer-section refund)',
  netTotal: 'Bestelleinnahmen — wallet net after Verkaufskosten',
  feeTotal: 'grossTotal − netTotal (tx + ads + label + other)',
  shippingCost: 'Versandetikett amount, not buyer Versand',
  'financialEvents.sale / Bestellung': '+Gesamtbetrag (one sale row only)',
  'financialEvents.fee / Transaktionsgebühren': 'eBay fee',
  'financialEvents.fee / Anzeigengebühr Basis': 'Ad fee',
  'financialEvents.fee / Versandetikett': 'Shipping label',
  'financialEvents.refund / Rückerstattung': 'Buyer-section refund already inside Gesamtbetrag',
  'financialEvents.refund / Erstattet': 'Later goodwill refund — subtract from net if Gesamtbetrag is still pre-refund',
} as const;

export type HubArchiveEventBucket = 'sale' | 'tx' | 'ads' | 'label' | 'other' | 'refund';

export function hubArchiveEventBucket(transactionType?: string, kind?: string): HubArchiveEventBucket {
  if (kind === 'refund' || kind === 'return' || kind === 'cancellation') return 'refund';
  if (kind === 'sale') return 'sale';
  const t = `${transactionType || ''}`;
  if (/versandetikett|shipping\s*label/i.test(t)) return 'label';
  if (/anzeigengebühr|promoted|ad\s*fee/i.test(t)) return 'ads';
  if (/transaktionsgebühren|verkaufsgebühr|final\s*value/i.test(t)) return 'tx';
  if (kind === 'fee') return 'other';
  return 'other';
}

/** Read an archive order the same way a Seller Hub receipt is read. */
export function hubArchivePayoutFromOrder(order: EbayOrderRecord): {
  buyerTotalEur: number;
  netPayoutEur: number;
  transactionFeeEur: number;
  adFeeEur: number;
  shippingLabelEur: number;
  otherFeeEur: number;
  refundEur: number;
  feeTotalEur: number;
} {
  let sale = 0;
  let tx = 0;
  let ads = 0;
  let label = 0;
  let other = 0;
  let refund = 0;
  for (const event of order.financialEvents || []) {
    const abs = roundMoney(Math.abs(Number(event.amount) || 0));
    const bucket = hubArchiveEventBucket(event.transactionType, event.kind);
    if (bucket === 'sale') sale = roundMoney(sale + abs);
    else if (bucket === 'tx') tx = roundMoney(tx + abs);
    else if (bucket === 'ads') ads = roundMoney(ads + abs);
    else if (bucket === 'label') label = roundMoney(label + abs);
    else if (bucket === 'refund') refund = roundMoney(refund + abs);
    else if (event.kind === 'fee') other = roundMoney(other + abs);
  }
  const buyerTotalEur = roundMoney(order.grossTotal ?? sale);
  const parsedFees = roundMoney(tx + ads + label + other);
  const netPayoutEur = roundMoney(
    order.netTotal ?? (buyerTotalEur - parsedFees)
  );
  const shippingLabelEur =
    label >= 0.01 ? label : typeof order.shippingCost === 'number' ? roundMoney(order.shippingCost) : 0;
  return {
    buyerTotalEur,
    netPayoutEur,
    transactionFeeEur: tx,
    adFeeEur: ads,
    shippingLabelEur,
    otherFeeEur: other,
    refundEur: refund,
    feeTotalEur: parsedFees >= 0.01 ? parsedFees : roundMoney(order.feeTotal ?? Math.max(0, buyerTotalEur - netPayoutEur)),
  };
}

/** Archive rows must satisfy: Bestellung − fees ≈ Bestelleinnahmen (refund already in Gesamtbetrag). */
export function hubArchivePayoutReconciles(order: EbayOrderRecord, slack = 0.06): boolean {
  const p = hubArchivePayoutFromOrder(order);
  const fromGross = roundMoney(p.buyerTotalEur - p.feeTotalEur);
  return Math.abs(fromGross - p.netPayoutEur) < slack;
}
