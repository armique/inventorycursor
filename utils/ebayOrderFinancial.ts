import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';

const REFUND_RE = /refund|rückerstattung|rueckerstattung|return|retoure|credit|gutschrift|chargeback|reversal|storno/i;
const CANCEL_RE = /cancel|cancellation|storniert|annull/i;
const FEE_RE = /fee|gebühr|gebuehr|advert|werbung|promotion|insertion/i;

export function classifyTransactionType(raw: string | undefined, amount: number | null): EbayOrderFinancialEvent['kind'] {
  const t = (raw || '').trim();
  if (t) {
    if (CANCEL_RE.test(t)) return 'cancellation';
    if (REFUND_RE.test(t)) return amount != null && amount < 0 ? 'return' : 'refund';
    if (FEE_RE.test(t)) return 'fee';
    if (/order|sale|verkauf|bestellung|payment|zahlung/i.test(t)) return 'sale';
  }
  if (amount != null && amount < -0.001) return 'refund';
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
  if (event.description?.trim()) return event.description.trim();
  if (event.transactionType?.trim()) return event.transactionType.trim();
  if (event.kind === 'return') return 'eBay return / refund';
  if (event.kind === 'refund') return 'eBay refund';
  if (event.kind === 'cancellation') return 'eBay order cancelled';
  if (event.kind === 'fee') return 'eBay fee adjustment';
  if (event.kind === 'sale') return 'eBay sale payout';
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
