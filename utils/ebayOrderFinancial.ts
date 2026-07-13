import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';

const REFUND_RE = /refund|rückerstattung|rueckerstattung|return|retoure|chargeback|reversal/i;
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

/** True when signed net is zero or negative after a return/refund on the order. */
export function isOrderFullyRefunded(order: EbayOrderRecord): boolean {
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

/** Best effective net for an order — events win over static netTotal. */
export function getOrderEffectiveNet(order: EbayOrderRecord): number | null {
  const fromEvents = sumFinancialEventNet(order.financialEvents);
  if (fromEvents != null) return fromEvents;
  if (order.netTotal != null && Number.isFinite(order.netTotal)) return order.netTotal;
  return null;
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
