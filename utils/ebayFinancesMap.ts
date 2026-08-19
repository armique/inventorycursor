/**
 * Map eBay Sell Finances API transactions onto the in-app order cache.
 * Fulfillment API has buyer/address/line items but no fee split; Finances
 * fills ads / eBay fee / shipping-label / net for Finanzamt-grade payouts.
 */

import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import { financialEventId } from './ebayOrderFinancial';
import { roundMoney } from '../services/financialAggregation';

export type EbayFinanceMoney = number | string | { value?: string | number } | null | undefined;

export interface EbayFinanceMarketplaceFee {
  feeType?: string;
  feeMemo?: string;
  amount?: EbayFinanceMoney;
}

export interface EbayFinanceTransaction {
  transactionId?: string;
  orderId?: string;
  salesRecordReference?: string;
  transactionDate?: string;
  transactionType?: string;
  bookingEntry?: string;
  amount?: EbayFinanceMoney;
  totalFeeAmount?: EbayFinanceMoney;
  totalFeeBasisAmount?: EbayFinanceMoney;
  feeType?: string;
  transactionMemo?: string;
  buyer?: { username?: string };
  orderLineItems?: Array<{
    lineItemId?: string;
    marketplaceFees?: EbayFinanceMarketplaceFee[];
  }>;
  references?: Array<{ referenceType?: string; referenceId?: string }>;
}

export function moneyOf(raw: EbayFinanceMoney): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? roundMoney(raw) : null;
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? roundMoney(n) : null;
  }
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return moneyOf(raw.value);
  }
  return null;
}

export function financeOrderId(tx: EbayFinanceTransaction): string | null {
  const direct = String(tx.orderId || '').trim();
  if (direct) return direct;
  for (const ref of tx.references || []) {
    if (String(ref.referenceType || '').toUpperCase() === 'ORDER_ID' && ref.referenceId) {
      return String(ref.referenceId).trim();
    }
  }
  return null;
}

export function financeFeeBucketLabel(feeType?: string, memo?: string): string {
  const t = `${feeType || ''} ${memo || ''}`;
  if (/SHIPPING_LABEL|versandetikett|shipping\s*label|versandlabel/i.test(t)) return 'Versandetikett';
  if (/AD_FEE|PROMOTED|MARKETING|ANZEIGE|ADS|WERBUNG/i.test(t)) return 'Anzeigengebühr Basis';
  if (/FINAL_VALUE|PAYMENT_PROCESSING|REGULATORY|TRANSAKTION|PROVISION|VERKAUFSGEB/i.test(t)) {
    return 'Transaktionsgebühren';
  }
  return (memo || '').trim() || feeType || 'Weitere Gebühren';
}

function dateOnly(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function isDebit(tx: EbayFinanceTransaction): boolean {
  return String(tx.bookingEntry || '').toUpperCase() === 'DEBIT';
}

function signedAbs(tx: EbayFinanceTransaction): number | null {
  const abs = moneyOf(tx.amount);
  if (abs == null) return null;
  const mag = Math.abs(abs);
  if (mag < 0.001) return 0;
  return isDebit(tx) ? -mag : mag;
}

function event(
  orderId: string,
  date: string | null,
  kind: EbayOrderFinancialEvent['kind'],
  amount: number,
  transactionType: string,
  description: string,
  importedAt: string
): EbayOrderFinancialEvent {
  return {
    id: financialEventId({ orderId, date, amount, kind, description: `${transactionType}:${description}` }),
    date,
    kind,
    amount,
    transactionType,
    description,
    source: 'api',
    importedAt,
  };
}

function txKind(rawType: string): EbayOrderFinancialEvent['kind'] {
  const t = rawType.toUpperCase();
  if (t.includes('REFUND') || t.includes('RETURN') || t.includes('DISPUTE')) return 'refund';
  if (t.includes('CANCEL')) return 'cancellation';
  if (t === 'SALE' || t === 'CREDIT') return 'sale';
  if (
    t.includes('SHIPPING_LABEL') ||
    t.includes('NON_SALE_CHARGE') ||
    t.includes('FEE') ||
    t.includes('ADJUSTMENT')
  ) {
    return 'fee';
  }
  return 'unknown';
}

function skipType(rawType: string): boolean {
  const t = rawType.toUpperCase();
  return (
    t === 'TRANSFER' ||
    t === 'WITHDRAWAL' ||
    t === 'PAYOUT' ||
    t === 'LOAN_REPAYMENT' ||
    t === 'PURCHASE'
  );
}

/**
 * Collapse Finances API rows into one cache record per eBay order ID.
 * Sale rows become positive Bestellung events; marketplace / label / ad charges
 * become negative fee events so the signed sum is Bestelleinnahmen.
 */
export function financeTransactionsToOrderRecords(
  transactions: EbayFinanceTransaction[],
  importedAt = new Date().toISOString()
): EbayOrderRecord[] {
  const byId = new Map<
    string,
    {
      dates: string[];
      username?: string;
      events: EbayOrderFinancialEvent[];
      gross: number | null;
    }
  >();

  const ensure = (orderId: string) => {
    let row = byId.get(orderId);
    if (!row) {
      row = { dates: [], username: undefined, events: [], gross: null };
      byId.set(orderId, row);
    }
    return row;
  };

  for (const tx of transactions) {
    const orderId = financeOrderId(tx);
    if (!orderId) continue;
    const type = String(tx.transactionType || '').trim();
    if (skipType(type)) continue;

    const row = ensure(orderId);
    const date = dateOnly(tx.transactionDate);
    if (date) row.dates.push(date);
    if (!row.username && tx.buyer?.username) row.username = tx.buyer.username;

    const kind = txKind(type);
    const marketplaceFees = (tx.orderLineItems || []).flatMap((li) => li.marketplaceFees || []);

    if (kind === 'sale' && !isDebit(tx)) {
      const basis = moneyOf(tx.totalFeeBasisAmount);
      const totalFee = moneyOf(tx.totalFeeAmount);
      const netAmt = moneyOf(tx.amount);
      const gross =
        basis != null && basis > 0
          ? basis
          : netAmt != null && totalFee != null
            ? roundMoney(Math.abs(netAmt) + Math.abs(totalFee))
            : netAmt != null
              ? Math.abs(netAmt)
              : null;
      if (gross != null && gross > 0) {
        row.gross = row.gross == null ? gross : Math.max(row.gross, gross);
        row.events.push(
          event(orderId, date, 'sale', roundMoney(gross), 'Bestellung', 'eBay Finances SALE', importedAt)
        );
      }
      if (marketplaceFees.length) {
        for (const fee of marketplaceFees) {
          const amt = moneyOf(fee.amount);
          if (amt == null || Math.abs(amt) < 0.01) continue;
          const label = financeFeeBucketLabel(fee.feeType, fee.feeMemo);
          row.events.push(
            event(orderId, date, 'fee', -Math.abs(amt), label, fee.feeMemo || fee.feeType || label, importedAt)
          );
        }
      } else if (totalFee != null && Math.abs(totalFee) >= 0.01) {
        row.events.push(
          event(
            orderId,
            date,
            'fee',
            -Math.abs(totalFee),
            'Transaktionsgebühren',
            'eBay Finances totalFeeAmount',
            importedAt
          )
        );
      }
      continue;
    }

    const signed = signedAbs(tx);
    if (signed == null || Math.abs(signed) < 0.01) continue;

    if (kind === 'refund' || kind === 'cancellation') {
      const amt = signed > 0 ? -Math.abs(signed) : signed;
      row.events.push(
        event(orderId, date, kind, amt, type || 'REFUND', tx.transactionMemo || type || 'eBay refund', importedAt)
      );
      continue;
    }

    const label = financeFeeBucketLabel(tx.feeType || type, tx.transactionMemo);
    const feeAmt = signed > 0 ? -Math.abs(signed) : signed;
    row.events.push(
      event(orderId, date, 'fee', feeAmt, label, tx.transactionMemo || tx.feeType || type || label, importedAt)
    );
  }

  const out: EbayOrderRecord[] = [];
  for (const [orderId, row] of byId) {
    if (!row.events.length && row.gross == null) continue;
    const feeTotal = roundMoney(
      row.events.filter((e) => e.kind === 'fee' && e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0)
    );
    const net = roundMoney(row.events.reduce((s, e) => s + e.amount, 0));
    const dates = [...row.dates].sort();
    out.push({
      orderId,
      creationDate: dates[0] || null,
      buyer: { username: row.username },
      lineItems: [],
      grossTotal: row.gross,
      netTotal: net,
      feeTotal: feeTotal > 0 ? feeTotal : null,
      financialEvents: row.events,
      sources: ['api'],
      importedAt,
    });
  }
  return out;
}
