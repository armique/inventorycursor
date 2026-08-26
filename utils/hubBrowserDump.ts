import {
  applyBusinessTxFeePolicy,
  extractHubListingTitle,
  extractHubOrderLifecycle,
  looksLikeJunkPerson,
  parseEbaySellerHubPayoutText,
  parseGermanHubDate,
} from '../lib/ebaySellerHubPayout.js';
import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import { roundMoney } from '../services/financialAggregation';

export const HUB_BROWSER_DUMP_KIND = 'inventory-pro-ebay-hub-browser-dump';

export type HubBrowserDumpPage = {
  orderId: string;
  text: string;
  snippet?: string;
};

export type HubBrowserDump = {
  kind: typeof HUB_BROWSER_DUMP_KIND;
  version: 1;
  fetchedAt: string;
  pages: HubBrowserDumpPage[];
};

function round2(n: number): number {
  return roundMoney(n);
}

function pushEvent(
  events: EbayOrderFinancialEvent[],
  orderId: string,
  date: string | null,
  kind: EbayOrderFinancialEvent['kind'],
  amount: number | null | undefined,
  transactionType: string,
  importedAt: string
): void {
  if (amount == null || Math.abs(amount) < 0.01) return;
  const amt = round2(amount);
  events.push({
    id: `${orderId}::${date || 'na'}::${amt.toFixed(2)}::${kind}::${transactionType}`,
    date,
    kind,
    amount: amt,
    transactionType,
    description: 'Seller Hub archive',
    source: 'hub',
    importedAt,
  });
}

/** Same mapping as the Hub scrape script — Finanzamt-grade fee lines from page text. */
export function hubOrderRecordFromDetailText(
  orderId: string,
  text: string,
  snippet = ''
): EbayOrderRecord {
  const hay = `${text}\n${snippet}`;
  const life = extractHubOrderLifecycle(hay);
  const creationDate = life.creationDate || parseGermanHubDate(hay);
  const payout = applyBusinessTxFeePolicy(parseEbaySellerHubPayoutText(hay), creationDate);
  const title = extractHubListingTitle(hay, { snippet, orderId });
  const importedAt = new Date().toISOString();
  const feeTotal = round2(
    (payout.transactionFeeEur || 0) +
      (payout.adFeeEur || 0) +
      (payout.shippingLabelEur || 0) +
      (payout.otherFeeEur || 0)
  );
  const events: EbayOrderFinancialEvent[] = [];
  if (payout.buyerTotalEur != null) {
    pushEvent(events, orderId, creationDate, 'sale', Math.abs(payout.buyerTotalEur), 'Bestellung', importedAt);
  }
  if (payout.transactionFeeEur != null) {
    pushEvent(events, orderId, creationDate, 'fee', -Math.abs(payout.transactionFeeEur), 'Transaktionsgebühren', importedAt);
  }
  if (payout.adFeeEur != null) {
    pushEvent(events, orderId, creationDate, 'fee', -Math.abs(payout.adFeeEur), 'Anzeigengebühr Basis', importedAt);
  }
  if (payout.shippingLabelEur != null) {
    pushEvent(events, orderId, creationDate, 'fee', -Math.abs(payout.shippingLabelEur), 'Versandetikett', importedAt);
  }
  if (payout.otherFeeEur != null) {
    pushEvent(events, orderId, creationDate, 'fee', -Math.abs(payout.otherFeeEur), 'Weitere Gebühren', importedAt);
  }
  const refundEur = payout.refundEur ?? life.refundEur;
  if (refundEur != null && refundEur >= 0.01) {
    const kind = life.status === 'cancelled' ? 'cancellation' : 'refund';
    const fromBuyerSection = payout.refundEur != null && payout.refundEur >= 0.01;
    const label = fromBuyerSection
      ? 'Rückerstattung'
      : life.status === 'refunded_partial'
        ? 'Teilweise erstattet'
        : 'Erstattet';
    pushEvent(events, orderId, creationDate, kind, -Math.abs(refundEur), label, importedAt);
  }

  const fullName = looksLikeJunkPerson(payout.fullName) ? undefined : payout.fullName || undefined;
  const username = looksLikeJunkPerson(payout.username) ? undefined : payout.username || undefined;

  return {
    orderId: payout.orderId || orderId,
    creationDate,
    buyer: {
      username,
      fullName,
      address: looksLikeJunkPerson(payout.address) ? undefined : payout.address || undefined,
    },
    lineItems: title ? [{ sku: null, title, lineItemCost: payout.itemGrossEur ?? null }] : [],
    grossTotal: payout.buyerTotalEur ?? payout.itemGrossEur ?? null,
    netTotal: payout.netPayoutEur ?? null,
    feeTotal: feeTotal > 0 ? feeTotal : null,
    shippingCost: payout.shippingLabelEur ?? payout.buyerShippingEur ?? null,
    financialEvents: events.length ? events : undefined,
    orderFulfillmentStatus: life.orderFulfillmentStatus || undefined,
    orderPaymentStatus: life.orderPaymentStatus || undefined,
    cancelState: life.cancelState || undefined,
    sources: ['hub'],
    importedAt,
  };
}

export function isHubBrowserDump(value: unknown): value is HubBrowserDump {
  if (!value || typeof value !== 'object') return false;
  const doc = value as { kind?: unknown; pages?: unknown };
  if (doc.kind !== HUB_BROWSER_DUMP_KIND) return false;
  return Array.isArray(doc.pages);
}

export function parseHubBrowserDump(text: string): HubBrowserDump | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    return isHubBrowserDump(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hubOrdersFromBrowserDump(dump: HubBrowserDump): EbayOrderRecord[] {
  const out: EbayOrderRecord[] = [];
  const seen = new Set<string>();
  for (const page of dump.pages || []) {
    const id = String(page.orderId || '').trim();
    if (!id || seen.has(id)) continue;
    const text = String(page.text || '').trim();
    if (text.length < 40) continue;
    seen.add(id);
    out.push(hubOrderRecordFromDetailText(id, text, page.snippet || ''));
  }
  return out;
}
