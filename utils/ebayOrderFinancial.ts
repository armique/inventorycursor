import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import { roundMoney } from '../services/financialAggregation';

const REFUND_RE = /refund|rückerstattung|rueckerstattung|erstattet|return|retoure|chargeback|reversal/i;
const CREDIT_RE = /credit|gutschrift|storno/i;
const CANCEL_RE = /cancel|cancellation|storniert|annull/i;
const FEE_RE = /fee|gebühr|gebuehr|advert|werbung|promotion|insertion|anzeige/i;
const SHIPPING_LABEL_RE = /versandetikett|shipping\s*label|shippinglabel|versandlabel/i;

export function classifyTransactionType(
  raw: string | undefined,
  amount: number | null,
  description?: string
): EbayOrderFinancialEvent['kind'] {
  const t = (raw || '').trim();
  const d = (description || '').trim();

  if (t) {
    if (CANCEL_RE.test(t)) return 'cancellation';
    if (SHIPPING_LABEL_RE.test(t)) return 'fee';
    if (REFUND_RE.test(t) || REFUND_RE.test(d)) return amount != null && amount < 0 ? 'return' : 'refund';
    if (CREDIT_RE.test(t) || CREDIT_RE.test(d)) return amount != null && amount < 0 ? 'return' : 'refund';
    if (FEE_RE.test(t) || FEE_RE.test(d)) return 'fee';
    if (/order|sale|verkauf|bestellung|payment|zahlung/i.test(t)) return 'sale';
  }
  if (/versandetikett|sendungsnr\./i.test(d)) return 'fee';
  if (amount != null && amount < -0.001) return 'fee';
  if (amount != null && amount > 0.001) return 'sale';
  return 'unknown';
}

export function financialEventId(parts: {
  orderId: string;
  date: string | null;
  amount: number;
  kind: string;
  description?: string;
}): string {
  const desc = (parts.description || '').slice(0, 40).toLowerCase();
  return `${parts.orderId}::${parts.date || 'na'}::${parts.amount.toFixed(2)}::${parts.kind}::${desc}`;
}

export function mergeFinancialEvents(
  existing: EbayOrderFinancialEvent[] | undefined,
  incoming: EbayOrderFinancialEvent[]
): EbayOrderFinancialEvent[] {
  const byId = new Map<string, EbayOrderFinancialEvent>();
  for (const e of existing || []) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return da.localeCompare(db);
  });
}

/** Net payout implied by cached financial events (signed sum). */
export function sumFinancialEventNet(events: EbayOrderFinancialEvent[] | undefined): number | null {
  if (!events?.length) return null;
  const total = events.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0);
  return Math.round(total * 100) / 100;
}

/** Sale-row proceeds only (positive Bestellung events), before returns/fees on other rows. */
export function sumOrderSaleProceeds(order: EbayOrderRecord): number | null {
  const sales = (order.financialEvents || []).filter((e) => e.kind === 'sale' && e.amount > 0.001);
  if (!sales.length) return null;
  return Math.round(sales.reduce((s, e) => s + e.amount, 0) * 100) / 100;
}

export function hasPostSaleRefund(order: EbayOrderRecord): boolean {
  return (order.financialEvents || []).some(
    (e) => (e.kind === 'return' || e.kind === 'refund' || e.kind === 'cancellation') && e.amount < -0.01
  );
}

/** Buyer-section Rückerstattung is already inside Gesamtbetrag — not a second deduction from Bestelleinnahmen. */
export function hubRefundAlreadyInBuyerTotal(order: EbayOrderRecord): boolean {
  return (order.financialEvents || []).some(
    (e) =>
      (e.kind === 'refund' || e.kind === 'return') &&
      /Rückerstattung/i.test(`${e.transactionType || ''} ${e.description || ''}`)
  );
}

/** Positive EUR returned to the buyer (refund / return events). */
export function sumOrderRefundEur(order: EbayOrderRecord): number {
  const sum = (order.financialEvents || [])
    .filter((e) => e.kind === 'refund' || e.kind === 'return')
    .reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0);
  return Math.round(sum * 100) / 100;
}

export type HubRefundKind = 'none' | 'partial' | 'full' | 'flagged';

export interface HubRefundDisplay {
  kind: HubRefundKind;
  /** Hub badge: "Erstattet" or "Teilweise erstattet". */
  label: string | null;
  refundEur: number;
}

function hubRefundHaystack(order: EbayOrderRecord): string {
  const events = (order.financialEvents || [])
    .filter((e) => e.kind === 'refund' || e.kind === 'return' || e.kind === 'cancellation')
    .map((e) => `${e.transactionType || ''} ${e.description || ''}`)
    .join('\n');
  return `${events}\n${order.orderPaymentStatus || ''}\n${order.cancelState || ''}`;
}

/**
 * Seller Hub has two refund stamps: "Teilweise erstattet" (partial) and "Erstattet" (full).
 * Prefer those event labels over orderPaymentStatus (Hub often stamps FULLY_REFUNDED on goodwill refunds).
 */
export function hubRefundStatusFromLabels(order: EbayOrderRecord): 'full' | 'partial' | null {
  const hay = hubRefundHaystack(order);
  if (/teilweise\s+erstattet|partial(?:ly)?\s+refund|PARTIALLY_REFUNDED/i.test(hay)) return 'partial';
  if (/\berstattet\b|vollständig\s+erstattet|full(?:ly)?\s+refund/i.test(hay)) return 'full';
  return null;
}

/**
 * Hub list text often says "Erstattet" even for a €5 goodwill refund.
 * Prefer labeled Hub events; otherwise use refund amount vs buyer total / leftover net.
 */
export function hubRefundDisplay(order: EbayOrderRecord): HubRefundDisplay {
  const refundEur = sumOrderRefundEur(order);
  const labeled = hubRefundStatusFromLabels(order);
  const gross = order.grossTotal ?? sumOrderSaleProceeds(order);
  const net = getOrderEffectiveNet(order);
  const goodwillPartial =
    refundEur >= 0.01 &&
    gross != null &&
    refundEur + 0.05 < Math.abs(gross) &&
    (net == null || net > 0.01);

  if (labeled === 'partial' || (labeled === 'full' && goodwillPartial)) {
    return { kind: 'partial', label: 'Teilweise erstattet', refundEur };
  }
  if (labeled === 'full') return { kind: 'full', label: 'Erstattet', refundEur };

  const payment = (order.orderPaymentStatus || '').replace(/_/g, ' ');
  const flagged = /refund/i.test(payment);
  const partialByStatus = /partial/i.test(payment);

  if (refundEur >= 0.01) {
    const coveredGross = gross != null && refundEur + 0.05 >= Math.abs(gross);
    if (coveredGross || isOrderFullyRefunded(order)) {
      return { kind: 'full', label: 'Erstattet', refundEur };
    }
    return { kind: 'partial', label: 'Teilweise erstattet', refundEur };
  }

  if (partialByStatus) return { kind: 'partial', label: 'Teilweise erstattet', refundEur: 0 };
  if (isOrderFullyRefunded(order)) return { kind: 'full', label: 'Erstattet', refundEur: 0 };
  if (flagged) return { kind: 'flagged', label: 'refund noted', refundEur: 0 };
  return { kind: 'none', label: null, refundEur: 0 };
}

/** True when Hub stamped a full refund, or signed net is zero/negative after a return. */
export function isOrderFullyRefunded(order: EbayOrderRecord): boolean {
  const labeled = hubRefundStatusFromLabels(order);
  if (labeled === 'full') {
    const refundEur = sumOrderRefundEur(order);
    const gross = order.grossTotal ?? sumOrderSaleProceeds(order);
    const net = getOrderEffectiveNet(order);
    if (
      refundEur >= 0.01 &&
      gross != null &&
      refundEur + 0.05 < Math.abs(gross) &&
      (net == null || net > 0.01)
    ) {
      return false;
    }
    return true;
  }
  if (labeled === 'partial') return false;
  if (!hasPostSaleRefund(order)) return false;
  const net = getOrderEffectiveNet(order);
  if (net == null) return false;
  return net <= 0.01;
}

/** Sum of fee/shipping-label deductions (positive EUR amount). */
export function sumOrderFeeDeductions(order: EbayOrderRecord): number {
  const fromEvents = (order.financialEvents || [])
    .filter((e) => e.kind === 'fee' && e.amount < -0.001)
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  if (fromEvents > 0) return Math.round(fromEvents * 100) / 100;
  if (order.feeTotal != null && order.feeTotal > 0) return order.feeTotal;
  return 0;
}

function hubLineItemSum(order: EbayOrderRecord): number {
  return roundMoney(
    (order.lineItems || []).reduce((sum, li) => sum + (Number(li.lineItemCost) || 0), 0)
  );
}

/**
 * Hub archives sometimes store netTotal as the signed event sum while the lone positive
 * Bestellung row is already Bestelleinnahmen — fees must not be subtracted again.
 */
export function recoverHubBestelleinnahmen(order: EbayOrderRecord): number | null {
  if (!order.sources?.includes('hub')) return null;
  const sales = (order.financialEvents || []).filter((e) => e.kind === 'sale' && e.amount > 0.001);
  if (sales.length !== 1) return null;

  const saleAmt = roundMoney(sales[0].amount);
  const eventNet = sumFinancialEventNet(order.financialEvents);
  const fees = sumOrderFeeDeductions(order);
  const storedNet =
    order.netTotal != null && Number.isFinite(order.netTotal) ? roundMoney(order.netTotal) : null;
  const gross = order.grossTotal ?? saleAmt;
  const lineSum = hubLineItemSum(order);

  // Gesamtbetrag checkout with a broken fee ledger: event net was fee-double-counted
  // while Bestelleinnahmen equals the item subtotal (not every checkout — GPU net < lineSum).
  if (
    lineSum > 0.01 &&
    gross > lineSum + 0.05 &&
    eventNet != null &&
    storedNet != null &&
    Math.abs(storedNet - eventNet) < 0.02 &&
    storedNet < lineSum * 0.75
  ) {
    const singleLine = (order.lineItems?.length ?? 0) <= 1;
    const feeLedgerNet =
      fees >= 0.01 && Math.abs(saleAmt - fees - eventNet) < 0.06;
    // Single-line sale=gross checkout: trust the fee ledger net (e.g. promoted GPU with ads).
    if (singleLine && feeLedgerNet && Math.abs(saleAmt - gross) < 0.02) {
      return null;
    }
    return lineSum;
  }

  if (eventNet == null || fees < 0.01) return null;
  if (Math.abs(saleAmt - fees - eventNet) >= 0.05) return null;
  // storedNet is sometimes Bestellung "Betrag abzügl. Kosten" (FVF only).
  // Ads + Versandetikett sit on other Hub rows — keep going so eventNet wins.

  // Full buyer checkout: sale row is Gesamtbetrag and event net is the real Bestelleinnahmen.
  if (saleAmt > lineSum + 0.05 && lineSum > 0.01) return null;
  if (Math.abs(saleAmt - gross) < 0.02 && gross > saleAmt + 0.05) return null;

  // Multi-line bundle: sale row is item-subtotal Bestelleinnahmen but fees were subtracted again.
  if (
    (order.lineItems?.length ?? 0) > 1 &&
    lineSum > 0.01 &&
    Math.abs(saleAmt - lineSum) < 0.05 &&
    Math.abs(gross - lineSum) < 0.05 &&
    storedNet != null &&
    storedNet < saleAmt * 0.75 &&
    eventNet != null &&
    fees >= 0.01 &&
    Math.abs(storedNet - eventNet) < 0.02 &&
    Math.abs(saleAmt - fees - eventNet) < 0.05
  ) {
    return saleAmt;
  }

  // Single-line Gesamtbetrag checkout: sale row equals line sum but fee ledger net is lower.
  if (
    (order.lineItems?.length ?? 0) <= 1 &&
    fees >= 0.01 &&
    eventNet != null &&
    Math.abs(saleAmt - fees - eventNet) < 0.05 &&
    eventNet < saleAmt - 0.05
  ) {
    if (storedNet != null && Math.abs(storedNet - eventNet) < 0.02) return storedNet;
    return eventNet;
  }

  // Single-line only: lone sale row equals item subtotal → already Bestelleinnahmen.
  if ((order.lineItems?.length ?? 0) <= 1 && lineSum > 0.01 && Math.abs(saleAmt - lineSum) < 0.05) {
    return saleAmt;
  }
  if ((order.lineItems?.length ?? 0) <= 1 && Math.abs(saleAmt - gross) < 0.02) return saleAmt;
  return null;
}

/** Seller Hub Bestelleinnahmen — bottom line of the eBay order payout breakdown. */
export function getHubBestelleinnahmen(order: EbayOrderRecord): number | null {
  const recovered = recoverHubBestelleinnahmen(order);
  if (recovered != null) return recovered;

  const gross = order.grossTotal ?? sumOrderSaleProceeds(order);
  const storedNet =
    order.netTotal != null && Number.isFinite(order.netTotal) ? roundMoney(order.netTotal) : null;
  const fromEvents = sumFinancialEventNet(order.financialEvents);
  const refundEur = sumOrderRefundEur(order);

  if (storedNet != null) {
    const fees = sumOrderFeeDeductions(order);
    const saleProceeds = sumOrderSaleProceeds(order);
    const lineSum = hubLineItemSum(order);
    if (
      fromEvents != null &&
      fees >= 0.01 &&
      gross != null &&
      Math.abs(storedNet - gross) < 0.02 &&
      fromEvents < storedNet - 0.05 &&
      saleProceeds != null &&
      (saleProceeds > gross + 0.05 || (lineSum > 0.01 && saleProceeds > lineSum + 0.05))
    ) {
      // netTotal was stamped equal to gross while the sale row still has Gesamtbetrag.
      return fromEvents;
    }
    if (
      refundEur >= 0.01 &&
      fromEvents != null &&
      Math.abs(storedNet - fromEvents) >= 0.02
    ) {
      if (hubRefundAlreadyInBuyerTotal(order)) return storedNet;
      return fromEvents;
    }
    if (
      fromEvents != null &&
      fees >= 0.01 &&
      saleProceeds != null &&
      storedNet > fromEvents + 0.02 &&
      Math.abs(saleProceeds - fees - fromEvents) < 0.05 &&
      !(lineSum > 0.01 && Math.abs(storedNet - lineSum) < 0.05)
    ) {
      // storedNet is FVF-only leftover; event sum is real Bestelleinnahmen.
      // Skip when storedNet already equals the item subtotal (double-counted fee ledger).
      return fromEvents;
    }
    if (fromEvents == null || Math.abs(storedNet - fromEvents) >= 0.02) return storedNet;
    return storedNet;
  }

  if (gross != null && fromEvents != null && Math.abs(gross - fromEvents) < 0.02) return fromEvents;
  if (fromEvents != null) return fromEvents;
  return gross;
}

/** Best effective net for an order — Hub Bestelleinnahmen wins over a reconstructed fee ledger. */
export function getOrderEffectiveNet(order: EbayOrderRecord): number | null {
  if (order.sources?.includes('hub')) return getHubBestelleinnahmen(order);

  const gross = order.grossTotal ?? sumOrderSaleProceeds(order);
  const storedNet =
    order.netTotal != null && Number.isFinite(order.netTotal) ? roundMoney(order.netTotal) : null;
  const fromEvents = sumFinancialEventNet(order.financialEvents);

  if (gross != null && storedNet != null && Math.abs(gross - storedNet) < 0.02) {
    return storedNet;
  }
  if (gross != null && fromEvents != null && Math.abs(gross - fromEvents) < 0.02) {
    return fromEvents;
  }

  if (fromEvents != null) return fromEvents;
  return storedNet;
}

function rebuildZeroFeeHubOrder(order: EbayOrderRecord, gross: number): EbayOrderRecord {
  const saleEvent = (order.financialEvents || []).find((e) => e.kind === 'sale' && e.amount > 0.001);
  const events = saleEvent
    ? [saleEvent]
    : [
        {
          id: financialEventId({
            orderId: order.orderId,
            date: order.creationDate,
            amount: gross,
            kind: 'sale',
            description: 'Bestellung',
          }),
          date: order.creationDate,
          kind: 'sale' as const,
          amount: gross,
          transactionType: 'Bestellung',
          description: 'Seller Hub archive',
          source: 'hub' as const,
          importedAt: order.importedAt || new Date().toISOString(),
        },
      ];
  return {
    ...order,
    grossTotal: gross,
    netTotal: gross,
    feeTotal: null,
    financialEvents: events,
  };
}

/** Rebuild hub order ledger when Bestelleinnahmen equals gross (zero-fee checkout). */
export function normalizeHubOrderForProceeds(order: EbayOrderRecord): EbayOrderRecord {
  if (!order.sources?.includes('hub')) return order;

  const bestelleinnahmen = getHubBestelleinnahmen(order);
  let next =
    bestelleinnahmen != null &&
    (order.netTotal == null || Math.abs(roundMoney(order.netTotal) - bestelleinnahmen) >= 0.02)
      ? { ...order, netTotal: bestelleinnahmen }
      : order;

  let gross = next.grossTotal ?? sumOrderSaleProceeds(next);
  if (gross == null || gross <= 0) return next;

  const storedNet =
    next.netTotal != null && Number.isFinite(next.netTotal) ? roundMoney(next.netTotal) : null;
  const saleProceeds = sumOrderSaleProceeds(next);
  const feeDeductions = sumOrderFeeDeductions(next);

  // Hub archive sometimes stores Bestelleinnahmen in grossTotal while the sale row keeps Gesamtbetrag.
  if (saleProceeds != null && saleProceeds > gross + 0.05) {
    next = { ...next, grossTotal: saleProceeds };
    gross = saleProceeds;
  }

  const eventNet = sumFinancialEventNet(next.financialEvents);

  // Spurious fee rows while Bestelleinnahmen already equals Gesamtbetrag (not a normal fee checkout).
  const zeroFee =
    (storedNet != null && Math.abs(storedNet - gross) < 0.02) ||
    (eventNet != null && Math.abs(eventNet - gross) < 0.02);

  if (!zeroFee) return next;
  if (feeDeductions < 0.01) return next;

  // Real fee checkout mis-stamped as zero-fee: sale total and fee ledger agree on net pocket.
  if (
    saleProceeds != null &&
    storedNet != null &&
    saleProceeds > storedNet + 0.05 &&
    Math.abs(saleProceeds - storedNet - feeDeductions) < 0.06
  ) {
    return { ...next, grossTotal: saleProceeds, netTotal: storedNet };
  }

  return rebuildZeroFeeHubOrder(next, gross);
}

export function isOrderCancelled(order: EbayOrderRecord): boolean {
  const cancel = (order.cancelState || '').toLowerCase();
  if (cancel.includes('cancel') || cancel.includes('storn')) return true;
  return (order.financialEvents || []).some((e) => e.kind === 'cancellation');
}

export function describeFinancialEvent(event: EbayOrderFinancialEvent): string {
  if (event.transactionType && SHIPPING_LABEL_RE.test(event.transactionType)) {
    return event.description?.trim() || 'Versandetikett';
  }
  if (event.description?.trim()) return event.description.trim();
  if (event.transactionType?.trim()) return event.transactionType.trim();
  if (event.kind === 'return') return 'eBay return / refund';
  if (event.kind === 'refund') return 'eBay refund';
  if (event.kind === 'cancellation') return 'eBay order cancelled';
  if (event.kind === 'fee') return 'eBay fee';
  if (event.kind === 'sale') return 'eBay order proceeds';
  return 'eBay payout adjustment';
}

export function unappliedOrderEvents(
  order: EbayOrderRecord,
  appliedEventIds: Set<string>
): EbayOrderFinancialEvent[] {
  return (order.financialEvents || []).filter((e) => {
    if (e.kind === 'sale') return false;
    if (appliedEventIds.has(e.id)) return false;
    return Math.abs(e.amount) >= 0.01;
  });
}
