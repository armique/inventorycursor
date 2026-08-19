/**
 * Seller Hub archive JSON produced by scripts/ebay-hub-archive-export.mjs.
 * Importable into the order cache the same way as a Payments CSV.
 */

import type { EbayOrderFinancialEvent, EbayOrderRecord, EbayOrderSource } from '../services/ebayOrderIndex';
import type { EbayOrderCsvParseResult } from '../services/ebayOrderCsvImport';

export const HUB_ARCHIVE_KIND = 'inventory-pro-ebay-order-archive';

export function isHubArchiveJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed)) return parsed.some(isOrderLike);
    if (parsed && typeof parsed === 'object') {
      const doc = parsed as { kind?: string; orders?: unknown };
      if (doc.kind === HUB_ARCHIVE_KIND && Array.isArray(doc.orders)) return true;
      if (Array.isArray(doc.orders) && doc.orders.some(isOrderLike)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isOrderLike(value: unknown): value is { orderId: string } {
  if (!value || typeof value !== 'object') return false;
  const id = (value as { orderId?: unknown }).orderId;
  return typeof id === 'string' && id.trim().length > 0;
}

function asRecord(raw: { orderId: string } & Record<string, unknown>): EbayOrderRecord {
  const buyer = (raw.buyer && typeof raw.buyer === 'object' ? raw.buyer : {}) as Record<string, unknown>;
  const lineItems = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const allowed = new Set<EbayOrderSource>(['api', 'csv', 'hub']);
  const sources = (
    Array.isArray(raw.sources) ? raw.sources.map(String) : ['hub']
  ).filter((s): s is EbayOrderSource => allowed.has(s as EbayOrderSource));
  if (!sources.includes('hub')) sources.push('hub');
  const events = Array.isArray(raw.financialEvents)
    ? (raw.financialEvents as EbayOrderFinancialEvent[])
    : undefined;
  return {
    orderId: String(raw.orderId).trim(),
    creationDate: typeof raw.creationDate === 'string' ? raw.creationDate : null,
    buyer: {
      username: typeof buyer.username === 'string' ? buyer.username : undefined,
      fullName: typeof buyer.fullName === 'string' ? buyer.fullName : undefined,
      address: typeof buyer.address === 'string' ? buyer.address : undefined,
      email: typeof buyer.email === 'string' ? buyer.email : undefined,
      phone: typeof buyer.phone === 'string' ? buyer.phone : undefined,
    },
    lineItems: lineItems
      .filter((li) => li && typeof li === 'object')
      .map((li) => {
        const row = li as Record<string, unknown>;
        return {
          sku: typeof row.sku === 'string' ? row.sku : null,
          title: typeof row.title === 'string' ? row.title : '',
          lineItemCost: typeof row.lineItemCost === 'number' ? row.lineItemCost : null,
          listingId: typeof row.listingId === 'string' ? row.listingId : null,
          quantity: typeof row.quantity === 'number' ? row.quantity : null,
        };
      }),
    grossTotal: typeof raw.grossTotal === 'number' ? raw.grossTotal : null,
    netTotal: typeof raw.netTotal === 'number' ? raw.netTotal : null,
    feeTotal: typeof raw.feeTotal === 'number' ? raw.feeTotal : null,
    shippingCost: typeof raw.shippingCost === 'number' ? raw.shippingCost : null,
    taxTotal: typeof raw.taxTotal === 'number' ? raw.taxTotal : null,
    financialEvents: events,
    orderFulfillmentStatus: typeof raw.orderFulfillmentStatus === 'string' ? raw.orderFulfillmentStatus : null,
    orderPaymentStatus: typeof raw.orderPaymentStatus === 'string' ? raw.orderPaymentStatus : null,
    cancelState: typeof raw.cancelState === 'string' ? raw.cancelState : null,
    sources,
    importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : new Date().toISOString(),
  };
}

export function parseHubArchiveJson(text: string): EbayOrderCsvParseResult {
  const parsed = JSON.parse(text) as unknown;
  const rawOrders = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { orders?: unknown }).orders)
      ? (parsed as { orders: unknown[] }).orders
      : [];
  const orders = rawOrders.filter(isOrderLike).map((row) => asRecord(row as { orderId: string } & Record<string, unknown>));
  return {
    orders,
    rowCount: rawOrders.length,
    matchedRowCount: orders.length,
    skippedRowCount: Math.max(0, rawOrders.length - orders.length),
    detectedColumns: ['orderId', 'buyer', 'grossTotal', 'netTotal', 'financialEvents'],
    warnings: orders.length
      ? []
      : ['JSON did not contain any eBay orders (need orderId on each row).'],
  };
}
