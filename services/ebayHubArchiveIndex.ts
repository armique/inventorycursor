/**
 * Separate local store for the Seller Hub fee dump (ads / eBay fee / shipping / net).
 * This is the Finanzamt-grade order database — not the Fulfillment API cache.
 */

import type { EbayOrderLineItem, EbayOrderRecord } from './ebayOrderIndex';
import { loadEbayOrderIndex } from './ebayOrderIndex';
import { mergeFinancialEvents, sumFinancialEventNet, hubRefundDisplay } from '../utils/ebayOrderFinancial';

const STORAGE_KEY = 'ebay_hub_archive_v1';
const META_STORAGE_KEY = 'ebay_hub_archive_meta_v1';
const IDB_NAME = 'inventory-pro-hub-archive';
const IDB_STORE = 'archive';
const IDB_KEY = 'v1';

export interface EbayHubArchiveMeta {
  updatedAt: string;
  count: number;
  fromDate?: string;
  toDate?: string;
  fileName?: string;
  lastIncrementalAt?: string;
}

export type HubArchivePersistVia = 'idb' | 'localStorage' | 'memory';

export interface HubArchivePersistResult {
  ok: boolean;
  via: HubArchivePersistVia;
  error?: string;
}

export interface HubArchiveHydrateResult {
  source: 'memory' | 'idb' | 'localStorage' | 'empty';
  count: number;
}

export interface EbayHubArchiveStats {
  count: number;
  oldestDate: string | null;
  newestDate: string | null;
  withFeesCount: number;
  withAddressCount: number;
  refundedCount: number;
  cancelledCount: number;
}

function hasFeeBreakdown(order: EbayOrderRecord): boolean {
  if ((order.financialEvents || []).some((e) => e.kind === 'fee' && e.amount < -0.001)) return true;
  if (order.netTotal != null && order.grossTotal != null && order.netTotal < order.grossTotal - 0.01) return true;
  return false;
}

let memOrders: EbayOrderRecord[] | null = null;
let memMeta: EbayHubArchiveMeta | null = null;
let memOrdersByNormId: Map<string, EbayOrderRecord> | null = null;
let hydrated = false;
let hydratePromise: Promise<HubArchiveHydrateResult> | null = null;
let persistChain: Promise<void> = Promise.resolve();
let lastPersist: HubArchivePersistResult = { ok: true, via: 'memory' };

function orderIdLookupKeys(orderId: string): string[] {
  const raw = orderId.trim().toLowerCase();
  if (!raw) return [];
  const compact = raw.replace(/[\s_]/g, '');
  return compact === raw ? [raw] : [raw, compact];
}

function indexMemOrders(orders: EbayOrderRecord[]): void {
  const map = new Map<string, EbayOrderRecord>();
  for (const order of orders) {
    for (const key of orderIdLookupKeys(order.orderId)) {
      if (!map.has(key)) map.set(key, order);
    }
  }
  memOrdersByNormId = map;
}

function adoptMemArchive(orders: EbayOrderRecord[], meta: EbayHubArchiveMeta): void {
  memOrders = orders;
  memMeta = meta;
  hydrated = true;
  indexMemOrders(orders);
}

function emptyMeta(): EbayHubArchiveMeta {
  return { updatedAt: '', count: 0 };
}

function persistErrorMessage(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'Browser storage quota exceeded. The dump is too large for localStorage.';
  }
  return (e as Error)?.message || 'Failed to persist Hub archive.';
}

function snapshotFromUnknown(raw: unknown): { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as { orders?: EbayOrderRecord[]; meta?: EbayHubArchiveMeta };
  if (!Array.isArray(parsed.orders)) return null;
  return { orders: parsed.orders, meta: parsed.meta || emptyMeta() };
}

function readLocalStorageDump(): { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return snapshotFromUnknown(JSON.parse(raw));
  } catch {
    return null;
  }
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openHubIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbGetDump(): Promise<{ orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } | null> {
  if (!idbAvailable()) return null;
  const db = await openHubIdb();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
    return snapshotFromUnknown(raw);
  } finally {
    db.close();
  }
}

async function idbPutDump(orders: EbayOrderRecord[], meta: EbayHubArchiveMeta): Promise<void> {
  const db = await openHubIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ orders, meta }, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

async function idbClearDump(): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openHubIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
    });
  } finally {
    db.close();
  }
}

function writeMetaHint(meta: EbayHubArchiveMeta, via: HubArchivePersistVia): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify({ ...meta, persistVia: via }));
  } catch {
    /* meta hint is optional */
  }
}

async function writePersist(orders: EbayOrderRecord[], meta: EbayHubArchiveMeta): Promise<void> {
  if (idbAvailable()) {
    try {
      await idbPutDump(orders, meta);
      lastPersist = { ok: true, via: 'idb' };
      writeMetaHint(meta, 'idb');
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* leftover localStorage dump is harmless */
      }
      return;
    } catch (e) {
      console.warn('Hub archive IndexedDB write failed, trying localStorage:', e);
    }
  }
  try {
    if (typeof localStorage === 'undefined') {
      lastPersist = { ok: false, via: 'memory', error: 'No browser storage available.' };
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders, meta }));
    lastPersist = { ok: true, via: 'localStorage' };
    writeMetaHint(meta, 'localStorage');
  } catch (e) {
    lastPersist = { ok: false, via: 'memory', error: persistErrorMessage(e) };
    console.warn('Failed to persist Hub archive:', e);
  }
}

let archiveNotifyFrame = 0;

/** Coalesce burst Hub writes into one listener tick per frame (avoids update-depth cascades). */
function notifyArchiveUpdated(): void {
  if (typeof window === 'undefined') return;
  if (archiveNotifyFrame) return;
  archiveNotifyFrame = window.requestAnimationFrame(() => {
    archiveNotifyFrame = 0;
    window.dispatchEvent(new Event('ebay-hub-archive-updated'));
    window.dispatchEvent(new Event('ebay-order-index-updated'));
  });
}

function applySnapshot(
  orders: EbayOrderRecord[],
  meta: EbayHubArchiveMeta,
  source: HubArchiveHydrateResult['source']
): HubArchiveHydrateResult {
  adoptMemArchive(orders, meta);
  return { source, count: orders.length };
}

function pickRicherDump(
  a: { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta },
  b: { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta }
): { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta; sourceWinner: 'a' | 'b' } {
  if (b.orders.length !== a.orders.length) {
    return b.orders.length > a.orders.length
      ? { ...b, sourceWinner: 'b' }
      : { ...a, sourceWinner: 'a' };
  }
  const aAt = a.meta.updatedAt || '';
  const bAt = b.meta.updatedAt || '';
  return bAt > aAt ? { ...b, sourceWinner: 'b' } : { ...a, sourceWinner: 'a' };
}

function loadRaw(): { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } {
  if (memOrders && memMeta) return { orders: memOrders, meta: memMeta };
  const fromLs = readLocalStorageDump();
  if (fromLs) {
    adoptMemArchive(fromLs.orders, fromLs.meta);
    return { orders: memOrders!, meta: memMeta! };
  }
  // Do not cache an empty snapshot until IndexedDB hydrate finishes — otherwise a
  // later IDB restore cannot replace the in-memory "empty" ledger.
  if (!hydrated) return { orders: [], meta: emptyMeta() };
  adoptMemArchive([], emptyMeta());
  return { orders: memOrders!, meta: memMeta! };
}

function saveRaw(orders: EbayOrderRecord[], meta: EbayHubArchiveMeta): void {
  adoptMemArchive(orders, meta);
  persistChain = persistChain.then(() => writePersist(orders, meta));
  notifyArchiveUpdated();
}

export async function hydrateHubArchiveIndex(): Promise<HubArchiveHydrateResult> {
  if (memOrders && memOrders.length > 0) {
    hydrated = true;
    return { source: 'memory', count: memOrders.length };
  }
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (memOrders && memOrders.length > 0) {
      hydrated = true;
      return { source: 'memory' as const, count: memOrders.length };
    }
    const fromLs = readLocalStorageDump();
    let fromIdb: { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } | null = null;
    try {
      fromIdb = await idbGetDump();
    } catch (e) {
      console.warn('Hub archive IndexedDB read failed:', e);
    }
    const adopt = (
      orders: EbayOrderRecord[],
      meta: EbayHubArchiveMeta,
      source: HubArchiveHydrateResult['source']
    ): HubArchiveHydrateResult => {
      if (memOrders && memOrders.length > 0) {
        hydrated = true;
        return { source: 'memory', count: memOrders.length };
      }
      const result = applySnapshot(orders, meta, source);
      if (result.count) notifyArchiveUpdated();
      return result;
    };
    if (fromLs && fromIdb) {
      const picked = pickRicherDump(fromLs, fromIdb);
      return adopt(
        picked.orders,
        picked.meta,
        picked.sourceWinner === 'b' ? 'idb' : 'localStorage'
      );
    }
    if (fromIdb?.orders.length) return adopt(fromIdb.orders, fromIdb.meta, 'idb');
    if (fromLs) {
      const result = adopt(fromLs.orders, fromLs.meta, 'localStorage');
      if (result.source === 'localStorage' && result.count && idbAvailable()) {
        persistChain = persistChain.then(() => writePersist(fromLs.orders, fromLs.meta));
      }
      return result;
    }
    return adopt([], emptyMeta(), 'empty');
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export async function flushHubArchivePersist(): Promise<HubArchivePersistResult> {
  await persistChain;
  if (lastPersist.ok) return lastPersist;
  const count = memOrders?.length ?? 0;
  if (!count) return { ok: true, via: 'memory' };
  return lastPersist;
}

export function loadHubArchiveIndex(): { orders: EbayOrderRecord[]; meta: EbayHubArchiveMeta } {
  return loadRaw();
}

export function replaceHubArchiveOrders(
  orders: EbayOrderRecord[],
  meta?: Partial<EbayHubArchiveMeta>
): { count: number } {
  const prev = loadRaw().meta;
  const nextMeta: EbayHubArchiveMeta = {
    updatedAt: new Date().toISOString(),
    count: orders.length,
    fromDate: meta?.fromDate ?? prev.fromDate,
    toDate: meta?.toDate ?? prev.toDate,
    fileName: meta?.fileName ?? prev.fileName,
    lastIncrementalAt: meta?.lastIncrementalAt ?? prev.lastIncrementalAt,
  };
  saveRaw(orders, nextMeta);
  return { count: orders.length };
}

/** Merge incoming Hub rows by order ID. Richer existing fee events are kept unless incoming adds/replaces them. */
export function hubOrderHasListingTitle(order: EbayOrderRecord | null | undefined): boolean {
  return (order?.lineItems || []).some((li) => Boolean(String(li.title || '').trim()));
}

function mergeHubLineItems(
  existing: EbayOrderLineItem[] | undefined,
  incoming: EbayOrderLineItem[] | undefined
): EbayOrderLineItem[] {
  const ex = existing || [];
  const inc = incoming || [];
  const incomingHasTitle = inc.some((li) => Boolean(li.title?.trim()));
  const existingHasTitle = ex.some((li) => Boolean(li.title?.trim()));
  if (incomingHasTitle && existingHasTitle) {
    return inc.map((li, i) => ({
      sku: li.sku || ex[i]?.sku || null,
      title: li.title?.trim() || ex[i]?.title || '',
      lineItemCost: li.lineItemCost ?? ex[i]?.lineItemCost ?? null,
      listingId: li.listingId || ex[i]?.listingId || null,
      quantity: li.quantity ?? ex[i]?.quantity ?? null,
    }));
  }
  if (incomingHasTitle) return inc;
  return ex.length ? ex : inc;
}

const HUB_TITLE_REFILL_LIMIT = 25;

/** Skip re-scraping titled rows; leave a small untitled batch out so Fetch new can fill names. */
export function getHubKnownOrderIdsForIncremental(): string[] {
  const { orders } = loadRaw();
  const refill = new Set(
    orders
      .filter((o) => !hubOrderHasListingTitle(o))
      .sort((a, b) => (b.creationDate || '').localeCompare(a.creationDate || ''))
      .slice(0, HUB_TITLE_REFILL_LIMIT)
      .map((o) => o.orderId)
  );
  return orders.map((o) => o.orderId).filter((id) => !refill.has(id));
}

/** Copy Fulfillment API listing titles onto Hub rows that were scraped without line items. */
export function backfillHubTitlesFromOrderIndex(): { filled: number } {
  const { orders } = loadRaw();
  if (!orders.length) return { filled: 0 };
  let apiOrders: EbayOrderRecord[] = [];
  try {
    apiOrders = loadEbayOrderIndex().orders;
  } catch {
    return { filled: 0 };
  }
  if (!apiOrders.length) return { filled: 0 };
  const byId = new Map(apiOrders.map((o) => [o.orderId, o]));
  const incoming: EbayOrderRecord[] = [];
  for (const o of orders) {
    if (hubOrderHasListingTitle(o)) continue;
    const src = byId.get(o.orderId);
    if (!src || !hubOrderHasListingTitle(src)) continue;
    incoming.push({
      ...o,
      lineItems: src.lineItems
        .filter((li) => li.title?.trim())
        .map((li) => ({
          sku: li.sku,
          title: li.title,
          lineItemCost: li.lineItemCost ?? o.grossTotal ?? null,
          listingId: li.listingId ?? null,
          quantity: li.quantity ?? null,
        })),
    });
  }
  if (!incoming.length) return { filled: 0 };
  upsertHubArchiveOrders(incoming);
  return { filled: incoming.length };
}

export function mergeHubOrderRecords(existing: EbayOrderRecord, incoming: EbayOrderRecord): EbayOrderRecord {
  const financialEvents = mergeFinancialEvents(existing.financialEvents, incoming.financialEvents || []);
  const eventNet = sumFinancialEventNet(financialEvents);
  const existingFees = (existing.financialEvents || []).filter((e) => e.kind === 'fee').length;
  const incomingFees = (incoming.financialEvents || []).filter((e) => e.kind === 'fee').length;
  const grossTotal =
    incoming.grossTotal != null &&
    (incoming.grossTotal > (existing.grossTotal ?? 0) + 0.01 || incomingFees >= existingFees)
      ? incoming.grossTotal
      : existing.grossTotal ?? incoming.grossTotal;
  const netTotal =
    incoming.netTotal != null &&
    (incomingFees >= existingFees || existing.netTotal == null)
      ? incoming.netTotal
      : existing.netTotal ?? eventNet ?? incoming.netTotal;
  return {
    orderId: existing.orderId,
    creationDate: incoming.creationDate || existing.creationDate,
    buyer: {
      username: incoming.buyer.username || existing.buyer.username,
      fullName: incoming.buyer.fullName || existing.buyer.fullName,
      address: incoming.buyer.address || existing.buyer.address,
      email: incoming.buyer.email || existing.buyer.email,
      phone: incoming.buyer.phone || existing.buyer.phone,
    },
    lineItems: mergeHubLineItems(existing.lineItems, incoming.lineItems),
    grossTotal,
    netTotal,
    feeTotal: incoming.feeTotal ?? existing.feeTotal,
    shippingCost: incoming.shippingCost ?? existing.shippingCost,
    taxTotal: incoming.taxTotal ?? existing.taxTotal,
    financialEvents: financialEvents.length ? financialEvents : existing.financialEvents,
    orderFulfillmentStatus: incoming.orderFulfillmentStatus || existing.orderFulfillmentStatus,
    orderPaymentStatus: incoming.orderPaymentStatus || existing.orderPaymentStatus,
    cancelState: incoming.cancelState || existing.cancelState,
    lastModifiedDate: incoming.lastModifiedDate || existing.lastModifiedDate,
    sources: Array.from(new Set([...(existing.sources || []), ...(incoming.sources || []), 'hub'])),
    importedAt:
      incoming.importedAt && existing.importedAt && incoming.importedAt > existing.importedAt
        ? incoming.importedAt
        : existing.importedAt || incoming.importedAt,
  };
}

export function mergeHubOrderLists(
  existing: EbayOrderRecord[],
  incoming: EbayOrderRecord[]
): { orders: EbayOrderRecord[]; added: number; merged: number; changed: EbayOrderRecord[] } {
  const byId = new Map(existing.map((o) => [o.orderId, o]));
  let added = 0;
  let merged = 0;
  const changed: EbayOrderRecord[] = [];
  for (const row of incoming) {
    const id = row.orderId?.trim();
    if (!id) continue;
    const tagged: EbayOrderRecord = {
      ...row,
      orderId: id,
      sources: row.sources?.includes('hub') ? row.sources : [...(row.sources || []), 'hub'],
    };
    const prev = byId.get(id);
    if (prev) {
      const next = mergeHubOrderRecords(prev, tagged);
      byId.set(id, next);
      changed.push(next);
      merged += 1;
    } else {
      byId.set(id, tagged);
      changed.push(tagged);
      added += 1;
    }
  }
  return { orders: Array.from(byId.values()), added, merged, changed };
}

export function upsertHubArchiveOrders(
  incoming: EbayOrderRecord[],
  meta?: Partial<EbayHubArchiveMeta>
): { added: number; merged: number; total: number; changed: EbayOrderRecord[] } {
  const { orders, meta: prev } = loadRaw();
  const next = mergeHubOrderLists(orders, incoming);
  const newest = next.orders.reduce((acc, o) => {
    const d = o.creationDate || '';
    return d && d > acc ? d : acc;
  }, prev.toDate || '');
  saveRaw(next.orders, {
    ...prev,
    updatedAt: new Date().toISOString(),
    count: next.orders.length,
    fromDate: meta?.fromDate ?? prev.fromDate,
    toDate: meta?.toDate ?? (newest || prev.toDate),
    fileName: meta?.fileName ?? prev.fileName,
    lastIncrementalAt: meta?.lastIncrementalAt ?? new Date().toISOString(),
  });
  return { added: next.added, merged: next.merged, total: next.orders.length, changed: next.changed };
}

export function clearHubArchiveIndex(): void {
  adoptMemArchive([], emptyMeta());
  lastPersist = { ok: true, via: 'memory' };
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  persistChain = persistChain.then(() => idbClearDump());
  notifyArchiveUpdated();
}

export function findHubArchiveOrderById(orderId: string): EbayOrderRecord | null {
  const key = orderId.trim().toLowerCase();
  if (!key) return null;
  loadRaw();
  const map = memOrdersByNormId;
  if (!map) return null;
  return map.get(key) ?? map.get(key.replace(/[\s_]/g, '')) ?? null;
}

export function getHubArchiveStats(): EbayHubArchiveStats {
  const { orders } = loadRaw();
  let oldest: string | null = null;
  let newest: string | null = null;
  let withFeesCount = 0;
  let withAddressCount = 0;
  let refundedCount = 0;
  let cancelledCount = 0;
  for (const o of orders) {
    if (o.creationDate) {
      if (!oldest || o.creationDate < oldest) oldest = o.creationDate;
      if (!newest || o.creationDate > newest) newest = o.creationDate;
    }
    if (hasFeeBreakdown(o)) withFeesCount += 1;
    if (o.buyer.address?.trim()) withAddressCount += 1;
    if (hubRefundDisplay(o).kind !== 'none') refundedCount += 1;
    if (/cancel|storn/i.test(`${o.cancelState || ''} ${o.orderFulfillmentStatus || ''}`)) cancelledCount += 1;
  }
  return {
    count: orders.length,
    oldestDate: oldest,
    newestDate: newest,
    withFeesCount,
    withAddressCount,
    refundedCount,
    cancelledCount,
  };
}

/** Hub dump wins on the same order ID so Sales sync uses fee-accurate payouts. */
export function mergeHubOverApiOrders(apiOrders: EbayOrderRecord[]): EbayOrderRecord[] {
  const hub = loadRaw().orders;
  if (!hub.length) return apiOrders;
  const byId = new Map(apiOrders.map((o) => [o.orderId, o]));
  for (const row of hub) {
    const prev = byId.get(row.orderId);
    byId.set(row.orderId, prev ? mergeHubOrderRecords(prev, row) : row);
  }
  return Array.from(byId.values());
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Overlap one day before the newest Hub sale so late labels/refunds are re-read. */
export function getHubIncrementalFromDate(): string {
  const { newestDate } = getHubArchiveStats();
  const today = todayISO();
  if (!newestDate) return today;
  const overlap = addDaysIso(newestDate, -1);
  return overlap > today ? today : overlap;
}
