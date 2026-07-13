/**
 * Isolated snapshots for API vs CSV compare tab — does not touch the main order index.
 */

import type { EbayOrderRecord } from './ebayOrderIndex';
import { listEbayOrders } from './ebayService';
import { ebaySummaryToRecord } from './ebayOrderBackfill';

const API_KEY = 'ebay_compare_api_v1';
const CSV_KEY = 'ebay_compare_csv_v1';

export interface CompareSnapshotMeta {
  importedAt: string;
  orderCount: number;
  fromDate?: string;
  toDate?: string;
  fileName?: string;
}

interface SnapshotStore {
  orders: EbayOrderRecord[];
  meta: CompareSnapshotMeta;
}

function loadSnapshot(key: string): SnapshotStore | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotStore;
    if (!Array.isArray(parsed?.orders)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSnapshot(key: string, orders: EbayOrderRecord[], meta: Omit<CompareSnapshotMeta, 'importedAt' | 'orderCount'>): void {
  const store: SnapshotStore = {
    orders,
    meta: {
      ...meta,
      importedAt: new Date().toISOString(),
      orderCount: orders.length,
    },
  };
  localStorage.setItem(key, JSON.stringify(store));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-compare-snapshots-updated'));
  }
}

export function loadApiCompareSnapshot(): SnapshotStore | null {
  return loadSnapshot(API_KEY);
}

export function loadCsvCompareSnapshot(): SnapshotStore | null {
  return loadSnapshot(CSV_KEY);
}

export function clearCompareSnapshots(): void {
  localStorage.removeItem(API_KEY);
  localStorage.removeItem(CSV_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ebay-compare-snapshots-updated'));
  }
}

const CHUNK_DAYS = 45;
const DELAY_MS = 300;

function buildChunks(fromDate: string, toDate: string): { from: string; to: string }[] {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T23:59:59Z`);
  const chunks: { from: string; to: string }[] = [];
  let cursor = new Date(from);
  while (cursor.getTime() < to.getTime()) {
    const chunkEndMs = Math.min(cursor.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000, to.getTime());
    const chunkEnd = new Date(chunkEndMs);
    chunks.push({
      from: cursor.toISOString().split('T')[0],
      to: chunkEnd.toISOString().split('T')[0],
    });
    cursor = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return chunks;
}

export interface FetchApiCompareProgress {
  chunkIndex: number;
  chunkCount: number;
  rangeLabel: string;
  ordersFetchedTotal: number;
}

/** Fetch Fulfillment API orders into the isolated compare snapshot (not main cache). */
export async function fetchApiCompareSnapshot(
  fromDate: string,
  toDate: string,
  onProgress?: (p: FetchApiCompareProgress) => void,
  cancelToken?: { cancelled: boolean }
): Promise<{ orderCount: number; error?: string; cancelled?: boolean }> {
  const chunks = buildChunks(fromDate, toDate);
  const byId = new Map<string, EbayOrderRecord>();
  let ordersFetched = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (cancelToken?.cancelled) {
      return { orderCount: byId.size, cancelled: true };
    }
    const chunk = chunks[i];
    const rangeLabel = `${chunk.from} → ${chunk.to}`;
    onProgress?.({
      chunkIndex: i,
      chunkCount: chunks.length,
      rangeLabel,
      ordersFetchedTotal: ordersFetched,
    });
    try {
      const orders = await listEbayOrders(chunk.from, chunk.to);
      ordersFetched += orders.length;
      for (const o of orders) {
        byId.set(o.orderId, ebaySummaryToRecord(o));
      }
      onProgress?.({
        chunkIndex: i,
        chunkCount: chunks.length,
        rangeLabel,
        ordersFetchedTotal: ordersFetched,
      });
    } catch (e: unknown) {
      return {
        orderCount: byId.size,
        error: `Failed on ${rangeLabel}: ${(e as Error)?.message || 'Unknown error'}`,
      };
    }
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const records = Array.from(byId.values());
  saveSnapshot(API_KEY, records, { fromDate, toDate });
  return { orderCount: records.length };
}

export function saveCsvCompareSnapshot(orders: EbayOrderRecord[], fileName: string): void {
  saveSnapshot(CSV_KEY, orders, { fileName });
}

/** Copy current main order index into compare snapshots (optional shortcut). */
export function importFromMainOrderIndex(
  apiOrders: EbayOrderRecord[],
  csvOrders: EbayOrderRecord[]
): { apiCount: number; csvCount: number } {
  if (apiOrders.length) {
    saveSnapshot(API_KEY, apiOrders, { fromDate: undefined, toDate: undefined });
  }
  if (csvOrders.length) {
    saveSnapshot(CSV_KEY, csvOrders, { fileName: 'from main cache' });
  }
  return { apiCount: apiOrders.length, csvCount: csvOrders.length };
}
