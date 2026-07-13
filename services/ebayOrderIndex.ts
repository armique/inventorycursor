/**
 * Cache of eBay orders, built from two possible sources:
 *  - eBay Fulfillment API backfill (services/ebayOrderBackfill.ts)
 *  - Seller Hub / Payments CSV import (services/ebayOrderCsvImport.ts)
 *
 * Orders are deduplicated and merged by orderId so both sources can fill in
 * gaps in each other (API gives buyer/address reliably; CSV can carry net
 * amounts after fees that the Fulfillment API does not expose).
 *
 * Two storage layers:
 *  - localStorage: instant reads for the Flags-column lookup, no network round trip.
 *  - Firestore (if signed in / cloud enabled): durable mirror so the cache survives a
 *    cleared browser or a brand-new PC — pullOrderIndexFromCloud() re-hydrates localStorage
 *    from it, pushOrderIndexToCloud() uploads only what actually changed on this device.
 */

import {
  fetchEbayOrdersFromCloud,
  isCloudEnabled,
  writeEbayOrdersToCloud,
  clearEbayOrdersCloud,
  type EbayOrderCloudMeta,
} from './firebaseService';
import {
  mergeFinancialEvents,
  sumFinancialEventNet,
} from '../utils/ebayOrderFinancial';

const STORAGE_KEY = 'ebay_order_index_v1';

export type EbayOrderSource = 'api' | 'csv';

export type EbayOrderFinancialEventKind =
  | 'sale'
  | 'refund'
  | 'return'
  | 'cancellation'
  | 'fee'
  | 'adjustment'
  | 'unknown';

export interface EbayOrderFinancialEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string | null;
  kind: EbayOrderFinancialEventKind;
  /** Signed net EUR impact on seller payout. */
  amount: number;
  grossAmount?: number | null;
  feeAmount?: number | null;
  description?: string;
  transactionType?: string;
  source: EbayOrderSource;
  importedAt: string;
}

export interface EbayOrderLineItem {
  sku: string | null;
  title: string;
  /** Gross price for this line item, before fees. */
  lineItemCost: number | null;
  listingId?: string | null;
  quantity?: number | null;
}

export interface EbayOrderBuyer {
  username?: string;
  fullName?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface EbayOrderRecord {
  orderId: string;
  /** YYYY-MM-DD */
  creationDate: string | null;
  buyer: EbayOrderBuyer;
  lineItems: EbayOrderLineItem[];
  /** Gross order total, before eBay fees. */
  grossTotal?: number | null;
  /** Net amount actually paid out to the seller (after fees), if known — usually only from CSV. */
  netTotal?: number | null;
  feeTotal?: number | null;
  shippingCost?: number | null;
  taxTotal?: number | null;
  /** Per-transaction events (refunds, returns, fee rows) — usually from Payments CSV. */
  financialEvents?: EbayOrderFinancialEvent[];
  orderFulfillmentStatus?: string | null;
  orderPaymentStatus?: string | null;
  cancelState?: string | null;
  lastModifiedDate?: string | null;
  sources: EbayOrderSource[];
  importedAt: string;
}

export interface EbayOrderIndexMeta {
  updatedAt: string;
  count: number;
  apiBackfill?: {
    fromDate: string;
    toDate: string;
    completedThroughDate?: string;
    lastRunAt: string;
    isComplete?: boolean;
  };
  csvImports?: { fileName: string; rowCount: number; orderCount: number; importedAt: string }[];
}

function emptyMeta(): EbayOrderIndexMeta {
  return { updatedAt: '', count: 0 };
}

function loadRaw(): { orders: EbayOrderRecord[]; meta: EbayOrderIndexMeta } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { orders: [], meta: emptyMeta() };
    const parsed = JSON.parse(raw) as { orders?: EbayOrderRecord[]; meta?: EbayOrderIndexMeta };
    return {
      orders: Array.isArray(parsed?.orders) ? parsed.orders : [],
      meta: parsed?.meta || emptyMeta(),
    };
  } catch {
    return { orders: [], meta: emptyMeta() };
  }
}

function saveRaw(orders: EbayOrderRecord[], meta: EbayOrderIndexMeta): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders, meta }));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-order-index-updated'));
  }
}

export function loadEbayOrderIndex(): { orders: EbayOrderRecord[]; meta: EbayOrderIndexMeta } {
  return loadRaw();
}

function mergeLineItems(a: EbayOrderLineItem[], b: EbayOrderLineItem[]): EbayOrderLineItem[] {
  const out = [...a];
  for (const li of b) {
    const key = (li.sku || li.title || '').trim().toLowerCase();
    const existingIdx = out.findIndex((x) => (x.sku || x.title || '').trim().toLowerCase() === key);
    if (existingIdx === -1) {
      out.push(li);
    } else {
      const existing = out[existingIdx];
      out[existingIdx] = {
        sku: existing.sku || li.sku,
        title: existing.title || li.title,
        lineItemCost: existing.lineItemCost ?? li.lineItemCost,
        listingId: existing.listingId || li.listingId,
        quantity: existing.quantity ?? li.quantity,
      };
    }
  }
  return out;
}

function mergeOrderRecords(existing: EbayOrderRecord, incoming: EbayOrderRecord): EbayOrderRecord {
  const financialEvents = mergeFinancialEvents(existing.financialEvents, incoming.financialEvents || []);
  const eventNet = sumFinancialEventNet(financialEvents);

  const mergedNet =
    eventNet != null
      ? eventNet
      : incoming.netTotal != null && existing.netTotal != null
        ? incoming.importedAt >= existing.importedAt
          ? incoming.netTotal
          : existing.netTotal
        : existing.netTotal ?? incoming.netTotal;

  const mergedFee =
    incoming.feeTotal != null && existing.feeTotal != null
      ? incoming.importedAt >= existing.importedAt
        ? incoming.feeTotal
        : existing.feeTotal
      : existing.feeTotal ?? incoming.feeTotal;

  return {
    orderId: existing.orderId,
    creationDate: existing.creationDate || incoming.creationDate,
    buyer: {
      username: existing.buyer.username || incoming.buyer.username,
      fullName: existing.buyer.fullName || incoming.buyer.fullName,
      address: existing.buyer.address || incoming.buyer.address,
      email: existing.buyer.email || incoming.buyer.email,
      phone: existing.buyer.phone || incoming.buyer.phone,
    },
    lineItems: mergeLineItems(existing.lineItems, incoming.lineItems),
    grossTotal: existing.grossTotal ?? incoming.grossTotal,
    netTotal: mergedNet,
    feeTotal: mergedFee,
    shippingCost: existing.shippingCost ?? incoming.shippingCost,
    taxTotal: existing.taxTotal ?? incoming.taxTotal,
    financialEvents: financialEvents.length ? financialEvents : undefined,
    orderFulfillmentStatus: incoming.orderFulfillmentStatus || existing.orderFulfillmentStatus,
    orderPaymentStatus: incoming.orderPaymentStatus || existing.orderPaymentStatus,
    cancelState: incoming.cancelState || existing.cancelState,
    lastModifiedDate: incoming.lastModifiedDate || existing.lastModifiedDate,
    sources: Array.from(new Set([...existing.sources, ...incoming.sources])),
    importedAt: incoming.importedAt > existing.importedAt ? incoming.importedAt : existing.importedAt,
  };
}

export interface UpsertEbayOrdersResult {
  added: number;
  merged: number;
  total: number;
  /** The final (post-merge) records for every order touched by this call — hand these to pushOrderIndexToCloud(). */
  changed: EbayOrderRecord[];
}

/** Merge new order records into the local cache, deduped/merged by orderId. Local-only — does not touch Firestore. */
export function upsertEbayOrders(newOrders: EbayOrderRecord[]): UpsertEbayOrdersResult {
  const { orders, meta } = loadRaw();
  const byId = new Map(orders.map((o) => [o.orderId, o]));
  let added = 0;
  let merged = 0;
  const changed: EbayOrderRecord[] = [];
  for (const inc of newOrders) {
    const existing = byId.get(inc.orderId);
    if (existing) {
      const mergedRecord = mergeOrderRecords(existing, inc);
      byId.set(inc.orderId, mergedRecord);
      changed.push(mergedRecord);
      merged++;
    } else {
      byId.set(inc.orderId, inc);
      changed.push(inc);
      added++;
    }
  }
  const nextOrders = Array.from(byId.values());
  saveRaw(nextOrders, { ...meta, updatedAt: new Date().toISOString(), count: nextOrders.length });
  return { added, merged, total: nextOrders.length, changed };
}

export function setApiBackfillMeta(patch: NonNullable<EbayOrderIndexMeta['apiBackfill']>): void {
  const { orders, meta } = loadRaw();
  saveRaw(orders, { ...meta, apiBackfill: patch, updatedAt: new Date().toISOString() });
}

export function addCsvImportMeta(entry: { fileName: string; rowCount: number; orderCount: number }): void {
  const { orders, meta } = loadRaw();
  const csvImports = [...(meta.csvImports || []), { ...entry, importedAt: new Date().toISOString() }].slice(-20);
  saveRaw(orders, { ...meta, csvImports, updatedAt: new Date().toISOString() });
}

export function clearEbayOrderIndex(): void {
  localStorage.removeItem(STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-order-index-updated'));
  }
}

export interface SuggestedBackfillRange {
  from: string;
  to: string;
  /** True if this resumes an existing backfill (only fetches new days); false if this is the first-ever run. */
  isIncremental: boolean;
}

/**
 * Suggest the smallest range that still covers everything: resumes from the last
 * completed day (with a 1-day overlap for safety) instead of re-fetching from
 * the very start every time. Falls back to the full default range on first run.
 */
export function getSuggestedBackfillRange(defaultFromDate: string, todayDate: string): SuggestedBackfillRange {
  const { meta } = loadRaw();
  const completedThrough = meta.apiBackfill?.completedThroughDate;
  if (completedThrough) {
    const resumeFrom = new Date(`${completedThrough}T00:00:00Z`);
    resumeFrom.setUTCDate(resumeFrom.getUTCDate() - 1);
    const from = resumeFrom.toISOString().split('T')[0];
    return { from, to: todayDate, isIncremental: true };
  }
  return { from: defaultFromDate, to: todayDate, isIncremental: false };
}

export interface EbayOrderIndexStats {
  count: number;
  oldestDate: string | null;
  newestDate: string | null;
  apiOnlyCount: number;
  csvOnlyCount: number;
  bothCount: number;
}

export interface CloudPullResult {
  pulled: number;
  skipped: boolean;
  error?: string;
}

/**
 * Pull every order cached in Firestore down into the local cache (merged, not replaced).
 * Safe to call repeatedly — orders are deduped by orderId. No-op if signed out / cloud disabled.
 */
export async function pullOrderIndexFromCloud(): Promise<CloudPullResult> {
  if (!isCloudEnabled()) return { pulled: 0, skipped: true };
  try {
    const cloud = await fetchEbayOrdersFromCloud();
    if (!cloud) return { pulled: 0, skipped: true };

    const cloudOrders = cloud.orders.filter((o) =>
      Boolean(o && typeof o === 'object' && (o as { orderId?: unknown }).orderId)
    ) as unknown as EbayOrderRecord[];
    const result = cloudOrders.length ? upsertEbayOrders(cloudOrders) : { added: 0, merged: 0 };

    if (cloud.meta?.apiBackfill) {
      const { meta } = loadRaw();
      const local = meta.apiBackfill;
      const remote = cloud.meta.apiBackfill;
      const remoteIsNewer = !local || (remote.lastRunAt || '') > (local.lastRunAt || '');
      const earliestFromDate = local?.fromDate && remote.fromDate && local.fromDate < remote.fromDate
        ? local.fromDate
        : remote.fromDate || local?.fromDate;
      const latestThrough = local?.completedThroughDate && remote.completedThroughDate
        ? (local.completedThroughDate > remote.completedThroughDate ? local.completedThroughDate : remote.completedThroughDate)
        : remote.completedThroughDate || local?.completedThroughDate;
      setApiBackfillMeta({
        fromDate: earliestFromDate || remote.fromDate,
        toDate: remoteIsNewer ? remote.toDate : local?.toDate || remote.toDate,
        completedThroughDate: latestThrough,
        lastRunAt: remoteIsNewer ? remote.lastRunAt : local?.lastRunAt || remote.lastRunAt,
        isComplete: remoteIsNewer ? remote.isComplete : local?.isComplete,
      });
    }

    return { pulled: result.added + result.merged, skipped: false };
  } catch (e: unknown) {
    return { pulled: 0, skipped: false, error: (e as Error)?.message || 'Cloud pull failed.' };
  }
}

/** Upload the given (already locally-merged) order records to Firestore, plus the current meta. Fire-and-forget friendly — swallows errors. */
export async function pushOrderIndexToCloud(records: EbayOrderRecord[]): Promise<void> {
  if (!isCloudEnabled() || !records.length) return;
  try {
    const { meta } = loadRaw();
    await writeEbayOrdersToCloud(records as unknown as (Record<string, unknown> & { orderId: string })[], meta as EbayOrderCloudMeta);
  } catch (e) {
    console.warn('Failed to push eBay orders to cloud cache:', e);
  }
}

/** Clear both the local cache and the Firestore mirror. */
export async function clearEbayOrderIndexEverywhere(): Promise<void> {
  clearEbayOrderIndex();
  if (!isCloudEnabled()) return;
  try {
    await clearEbayOrdersCloud();
  } catch (e) {
    console.warn('Failed to clear cloud eBay order cache:', e);
  }
}

export function findEbayOrderById(orderId: string): EbayOrderRecord | null {
  const key = orderId.trim().toLowerCase();
  if (!key) return null;
  const { orders } = loadRaw();
  return orders.find((o) => o.orderId.trim().toLowerCase() === key) ?? null;
}

export function getOrderIndexStats(): EbayOrderIndexStats {
  const { orders } = loadRaw();
  let oldest: string | null = null;
  let newest: string | null = null;
  let apiOnlyCount = 0;
  let csvOnlyCount = 0;
  let bothCount = 0;
  for (const o of orders) {
    if (o.creationDate) {
      if (!oldest || o.creationDate < oldest) oldest = o.creationDate;
      if (!newest || o.creationDate > newest) newest = o.creationDate;
    }
    const hasApi = o.sources.includes('api');
    const hasCsv = o.sources.includes('csv');
    if (hasApi && hasCsv) bothCount++;
    else if (hasApi) apiOnlyCount++;
    else if (hasCsv) csvOnlyCount++;
  }
  return { count: orders.length, oldestDate: oldest, newestDate: newest, apiOnlyCount, csvOnlyCount, bothCount };
}
