import type { EbayOrderRecord, EbayOrderSource } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet } from './ebayOrderFinancial';

export type OrderSyncBucket = 'api_only' | 'csv_only' | 'both';

export interface OrderSyncEntry {
  orderId: string;
  bucket: OrderSyncBucket;
  creationDate: string | null;
  buyerLabel: string;
  grossTotal: number | null;
  netTotal: number | null;
  lineItemCount: number;
  lineItemTitles: string[];
  sources: EbayOrderSource[];
  flags: string[];
  financialEventCount: number;
  fulfillmentStatus: string | null;
  paymentStatus: string | null;
  cancelState: string | null;
}

export interface OrderSourceSyncReport {
  generatedAt: string;
  total: number;
  apiOnlyCount: number;
  csvOnlyCount: number;
  bothCount: number;
  gapCount: number;
  apiOnly: OrderSyncEntry[];
  csvOnly: OrderSyncEntry[];
  both: OrderSyncEntry[];
}

function buyerLabel(order: EbayOrderRecord): string {
  return order.buyer.fullName || order.buyer.username || '—';
}

function bucketFor(order: EbayOrderRecord): OrderSyncBucket {
  const hasApi = order.sources.includes('api');
  const hasCsv = order.sources.includes('csv');
  if (hasApi && hasCsv) return 'both';
  if (hasApi) return 'api_only';
  return 'csv_only';
}

function flagsFor(order: EbayOrderRecord, bucket: OrderSyncBucket): string[] {
  const flags: string[] = [];
  if (bucket === 'api_only') {
    flags.push('In API cache only — no matching CSV import row for this order ID.');
    if (order.cancelState) flags.push(`Cancel state: ${order.cancelState}`);
    if (order.orderPaymentStatus && order.orderPaymentStatus !== 'PAID') {
      flags.push(`Payment: ${order.orderPaymentStatus}`);
    }
    if (!order.netTotal && !order.financialEvents?.length) {
      flags.push('No net payout / financial events (expected until CSV import).');
    }
  }
  if (bucket === 'csv_only') {
    flags.push('In CSV cache only — API backfill did not return this order ID.');
    if (order.financialEvents?.length) {
      flags.push(`${order.financialEvents.length} financial event(s) from CSV.`);
    }
  }
  if (bucket === 'both') {
    const net = getOrderEffectiveNet(order);
    if (net != null) flags.push(`Net payout known: €${net.toFixed(2)}`);
    else flags.push('Merged but net payout still unknown — check CSV rows.');
  }
  return flags;
}

function toEntry(order: EbayOrderRecord): OrderSyncEntry {
  const bucket = bucketFor(order);
  return {
    orderId: order.orderId,
    bucket,
    creationDate: order.creationDate,
    buyerLabel: buyerLabel(order),
    grossTotal: order.grossTotal ?? null,
    netTotal: getOrderEffectiveNet(order),
    lineItemCount: order.lineItems.length,
    lineItemTitles: order.lineItems.map((li) => li.title).filter(Boolean).slice(0, 5),
    sources: [...order.sources],
    flags: flagsFor(order, bucket),
    financialEventCount: order.financialEvents?.length ?? 0,
    fulfillmentStatus: order.orderFulfillmentStatus ?? null,
    paymentStatus: order.orderPaymentStatus ?? null,
    cancelState: order.cancelState ?? null,
  };
}

/** Compare merged order cache by source tags (API backfill vs CSV import). */
export function analyzeEbayOrderSourceSync(orders: EbayOrderRecord[]): OrderSourceSyncReport {
  const apiOnly: OrderSyncEntry[] = [];
  const csvOnly: OrderSyncEntry[] = [];
  const both: OrderSyncEntry[] = [];

  for (const order of orders) {
    const entry = toEntry(order);
    if (entry.bucket === 'api_only') apiOnly.push(entry);
    else if (entry.bucket === 'csv_only') csvOnly.push(entry);
    else both.push(entry);
  }

  const byDate = (a: OrderSyncEntry, b: OrderSyncEntry) =>
    (b.creationDate || '').localeCompare(a.creationDate || '');

  apiOnly.sort(byDate);
  csvOnly.sort(byDate);
  both.sort(byDate);

  return {
    generatedAt: new Date().toISOString(),
    total: orders.length,
    apiOnlyCount: apiOnly.length,
    csvOnlyCount: csvOnly.length,
    bothCount: both.length,
    gapCount: apiOnly.length + csvOnly.length,
    apiOnly,
    csvOnly,
    both,
  };
}
