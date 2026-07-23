/**
 * Cache of eBay **buyer** purchases (Trading API GetOrders OrderRole=Buyer).
 * Local library + Firestore mirror so history survives eBay’s ~90-day API window.
 */

import {
  clearEbayPurchasesCloud,
  fetchEbayPurchasesFromCloud,
  isCloudEnabled,
  writeEbayPurchasesToCloud,
  type EbayPurchaseCloudMeta,
} from './firebaseService';
import { guessPurchaseType, type EbayPurchaseType } from '../utils/purchaseTypeDetect';

const STORAGE_KEY = 'ebay_purchase_index_v1';

/** eBay Trading CreateTime window for buyer orders. */
export const EBAY_PURCHASE_API_MAX_DAYS = 90;

export type EbayPurchaseDisposition =
  | 'pending'
  | 'expense'
  | 'filament'
  | 'inventory'
  | 'personal'
  | 'skipped';

export type { EbayPurchaseType };

export interface EbayPurchaseRecord {
  /** Stable dedupe key: orderId-transactionId or orderId-itemId */
  lineKey: string;
  orderId: string;
  transactionId?: string | null;
  itemId?: string | null;
  title: string;
  sellerUsername?: string;
  /** YYYY-MM-DD */
  creationDate: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPaid: number | null;
  sources: ('api' | 'manual' | 'cloud')[];
  importedAt: string;
  disposition: EbayPurchaseDisposition;
  /** Library category for browsing (auto-guessed, user-overridable). */
  purchaseType: EbayPurchaseType;
  /** True once the user manually picked purchaseType. */
  purchaseTypeLocked?: boolean;
  /** Linked app records */
  expenseId?: string;
  filamentSpoolId?: string;
  inventoryItemId?: string;
  note?: string;
}

export interface EbayPurchaseIndexMeta {
  updatedAt: string;
  count: number;
  apiBackfill?: {
    lastRunAt: string;
    fromDate: string;
    toDate: string;
    /** Furthest day covered by successful API sync — used for incremental fetches. */
    completedThroughDate?: string;
    fetched: number;
  };
}

export interface EbayPurchaseIndex {
  purchases: EbayPurchaseRecord[];
  meta: EbayPurchaseIndexMeta;
}

function emptyIndex(): EbayPurchaseIndex {
  return {
    purchases: [],
    meta: { updatedAt: new Date().toISOString(), count: 0 },
  };
}

let memPurchases: EbayPurchaseRecord[] | null = null;
let memPurchaseMeta: EbayPurchaseIndexMeta | null = null;

function normalizeRecord(raw: Partial<EbayPurchaseRecord> & { lineKey?: string }): EbayPurchaseRecord | null {
  if (!raw?.lineKey || typeof raw.lineKey !== 'string') return null;
  const title = String(raw.title || '');
  const locked = Boolean(raw.purchaseTypeLocked);
  const purchaseType =
    locked && raw.purchaseType
      ? raw.purchaseType
      : raw.purchaseType && raw.purchaseType !== 'unclassified'
        ? raw.purchaseType
        : guessPurchaseType(title);
  return {
    lineKey: raw.lineKey,
    orderId: String(raw.orderId || ''),
    transactionId: raw.transactionId ?? null,
    itemId: raw.itemId ?? null,
    title,
    sellerUsername: raw.sellerUsername,
    creationDate: raw.creationDate ?? null,
    quantity: Number(raw.quantity) || 1,
    unitPrice: raw.unitPrice ?? null,
    totalPaid: raw.totalPaid ?? null,
    sources: Array.isArray(raw.sources) && raw.sources.length ? [...raw.sources] : ['api'],
    importedAt: raw.importedAt || new Date().toISOString(),
    disposition: (raw.disposition as EbayPurchaseDisposition) || 'pending',
    purchaseType,
    purchaseTypeLocked: locked || undefined,
    expenseId: raw.expenseId,
    filamentSpoolId: raw.filamentSpoolId,
    inventoryItemId: raw.inventoryItemId,
    note: raw.note,
  };
}

export function loadEbayPurchaseIndex(): EbayPurchaseIndex {
  if (memPurchases && memPurchaseMeta) {
    return { purchases: memPurchases, meta: memPurchaseMeta };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const empty = emptyIndex();
      memPurchases = empty.purchases;
      memPurchaseMeta = empty.meta;
      return empty;
    }
    const parsed = JSON.parse(raw) as EbayPurchaseIndex;
    if (!Array.isArray(parsed?.purchases)) {
      const empty = emptyIndex();
      memPurchases = empty.purchases;
      memPurchaseMeta = empty.meta;
      return empty;
    }
    const purchases = parsed.purchases
      .map((p) => normalizeRecord(p))
      .filter((p): p is EbayPurchaseRecord => Boolean(p));
    const meta = parsed.meta || { updatedAt: new Date().toISOString(), count: purchases.length };
    memPurchases = purchases;
    memPurchaseMeta = meta;
    return { purchases, meta };
  } catch {
    const empty = emptyIndex();
    memPurchases = empty.purchases;
    memPurchaseMeta = empty.meta;
    return empty;
  }
}

function saveIndex(index: EbayPurchaseIndex): void {
  const next: EbayPurchaseIndex = {
    purchases: index.purchases,
    meta: {
      ...index.meta,
      updatedAt: new Date().toISOString(),
      count: index.purchases.length,
    },
  };
  memPurchases = next.purchases;
  memPurchaseMeta = next.meta;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('ebay-purchase-index-updated'));
      }
    }
  } catch {
    /* ignore */
  }
}

export interface UpsertEbayPurchasesResult {
  added: number;
  merged: number;
  /** Final merged records touched by this call — hand to pushPurchaseIndexToCloud(). */
  changed: EbayPurchaseRecord[];
}

export function upsertEbayPurchases(
  incoming: Omit<EbayPurchaseRecord, 'importedAt' | 'disposition' | 'sources' | 'purchaseType' | 'purchaseTypeLocked'>[],
  source: 'api' | 'manual' | 'cloud' = 'api'
): UpsertEbayPurchasesResult {
  const index = loadEbayPurchaseIndex();
  const byKey = new Map(index.purchases.map((p) => [p.lineKey, p]));
  let added = 0;
  let merged = 0;
  const changed: EbayPurchaseRecord[] = [];

  for (const row of incoming) {
    const existing = byKey.get(row.lineKey);
    if (existing) {
      const next: EbayPurchaseRecord = {
        ...existing,
        title: row.title || existing.title,
        sellerUsername: row.sellerUsername || existing.sellerUsername,
        creationDate: row.creationDate || existing.creationDate,
        quantity: row.quantity ?? existing.quantity,
        unitPrice: row.unitPrice ?? existing.unitPrice,
        totalPaid: row.totalPaid ?? existing.totalPaid,
        orderId: row.orderId || existing.orderId,
        transactionId: row.transactionId ?? existing.transactionId,
        itemId: row.itemId ?? existing.itemId,
        sources: existing.sources.includes(source) ? existing.sources : [...existing.sources, source],
        importedAt: new Date().toISOString(),
        purchaseType: existing.purchaseTypeLocked
          ? existing.purchaseType
          : existing.purchaseType !== 'unclassified'
            ? existing.purchaseType
            : guessPurchaseType(row.title || existing.title),
      };
      byKey.set(row.lineKey, next);
      changed.push(next);
      merged++;
    } else {
      const created: EbayPurchaseRecord = {
        ...row,
        sources: [source],
        disposition: 'pending',
        purchaseType: guessPurchaseType(row.title),
        importedAt: new Date().toISOString(),
      };
      byKey.set(row.lineKey, created);
      changed.push(created);
      added++;
    }
  }

  saveIndex({ purchases: Array.from(byKey.values()), meta: index.meta });
  return { added, merged, changed };
}

export function setPurchaseDisposition(
  lineKey: string,
  disposition: EbayPurchaseDisposition,
  links?: Partial<Pick<EbayPurchaseRecord, 'expenseId' | 'filamentSpoolId' | 'inventoryItemId' | 'note'>>
): EbayPurchaseIndex {
  const index = loadEbayPurchaseIndex();
  let touched: EbayPurchaseRecord | null = null;
  const purchases = index.purchases.map((p) => {
    if (p.lineKey !== lineKey) return p;
    touched = {
      ...p,
      disposition,
      ...links,
      // Align library type with disposition when user marks personal/filament.
      purchaseType:
        disposition === 'personal'
          ? 'personal'
          : disposition === 'filament'
            ? 'filament'
            : p.purchaseType,
      purchaseTypeLocked:
        disposition === 'personal' || disposition === 'filament' ? true : p.purchaseTypeLocked,
    };
    return touched;
  });
  const next = { purchases, meta: index.meta };
  saveIndex(next);
  if (touched) {
    void pushPurchaseIndexToCloud([touched]).catch(() => undefined);
  }
  return next;
}

export function setPurchaseType(lineKey: string, purchaseType: EbayPurchaseType): EbayPurchaseIndex {
  const index = loadEbayPurchaseIndex();
  let touched: EbayPurchaseRecord | null = null;
  const purchases = index.purchases.map((p) => {
    if (p.lineKey !== lineKey) return p;
    touched = { ...p, purchaseType, purchaseTypeLocked: true };
    return touched;
  });
  const next = { purchases, meta: index.meta };
  saveIndex(next);
  if (touched) {
    void pushPurchaseIndexToCloud([touched]).catch(() => undefined);
  }
  return next;
}

export function setPurchaseBackfillMeta(
  patch: NonNullable<EbayPurchaseIndexMeta['apiBackfill']>
): void {
  const index = loadEbayPurchaseIndex();
  saveIndex({
    ...index,
    meta: {
      ...index.meta,
      apiBackfill: patch,
    },
  });
}

function localISOFromUtcDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export interface SuggestedPurchaseFetchRange {
  from: string;
  to: string;
  isIncremental: boolean;
}

/**
 * Incremental fetch window: resume from last completed day (1-day overlap),
 * always clamped to eBay’s ~90-day CreateTime limit.
 */
export function getSuggestedPurchaseFetchRange(todayDate: string): SuggestedPurchaseFetchRange {
  const today = new Date(`${todayDate}T12:00:00Z`);
  const earliest = new Date(today);
  earliest.setUTCDate(earliest.getUTCDate() - (EBAY_PURCHASE_API_MAX_DAYS - 1));
  const earliestIso = localISOFromUtcDate(earliest);

  const { meta } = loadEbayPurchaseIndex();
  const completedThrough = meta.apiBackfill?.completedThroughDate || meta.apiBackfill?.toDate;
  if (completedThrough) {
    const resume = new Date(`${completedThrough}T12:00:00Z`);
    resume.setUTCDate(resume.getUTCDate() - 1);
    let fromIso = localISOFromUtcDate(resume);
    if (fromIso < earliestIso) fromIso = earliestIso;
    if (fromIso > todayDate) fromIso = earliestIso;
    return { from: fromIso, to: todayDate, isIncremental: true };
  }
  return { from: earliestIso, to: todayDate, isIncremental: false };
}

export interface CloudPullResult {
  pulled: number;
  skipped: boolean;
  error?: string;
}

/** Merge Firestore purchase archive into local library. */
export async function pullPurchaseIndexFromCloud(options?: { force?: boolean }): Promise<CloudPullResult> {
  if (!isCloudEnabled()) return { pulled: 0, skipped: true };
  try {
    const localCount = loadEbayPurchaseIndex().purchases.length;
    if (!options?.force && localCount > 0) {
      return { pulled: 0, skipped: true };
    }
    const cloud = await fetchEbayPurchasesFromCloud();
    if (!cloud) return { pulled: 0, skipped: true };

    const rows = cloud.purchases
      .map((p) => normalizeRecord(p as Partial<EbayPurchaseRecord>))
      .filter((p): p is EbayPurchaseRecord => Boolean(p));

    const index = loadEbayPurchaseIndex();
    const byKey = new Map(index.purchases.map((p) => [p.lineKey, p]));
    let pulled = 0;

    for (const remote of rows) {
      const local = byKey.get(remote.lineKey);
      if (!local) {
        byKey.set(remote.lineKey, {
          ...remote,
          sources: Array.from(new Set([...(remote.sources || []), 'cloud' as const])),
        });
        pulled++;
        continue;
      }
      byKey.set(remote.lineKey, {
        ...local,
        title: remote.title || local.title,
        sellerUsername: remote.sellerUsername || local.sellerUsername,
        creationDate: remote.creationDate || local.creationDate,
        quantity: remote.quantity ?? local.quantity,
        unitPrice: remote.unitPrice ?? local.unitPrice,
        totalPaid: remote.totalPaid ?? local.totalPaid,
        orderId: remote.orderId || local.orderId,
        transactionId: remote.transactionId ?? local.transactionId,
        itemId: remote.itemId ?? local.itemId,
        disposition: local.disposition !== 'pending' ? local.disposition : remote.disposition,
        purchaseType: local.purchaseTypeLocked
          ? local.purchaseType
          : remote.purchaseTypeLocked
            ? remote.purchaseType
            : local.purchaseType !== 'unclassified'
              ? local.purchaseType
              : remote.purchaseType,
        purchaseTypeLocked: local.purchaseTypeLocked || remote.purchaseTypeLocked,
        expenseId: local.expenseId || remote.expenseId,
        filamentSpoolId: local.filamentSpoolId || remote.filamentSpoolId,
        inventoryItemId: local.inventoryItemId || remote.inventoryItemId,
        note: local.note || remote.note,
        sources: Array.from(new Set([...local.sources, ...remote.sources, 'cloud' as const])),
        importedAt: remote.importedAt > local.importedAt ? remote.importedAt : local.importedAt,
      });
      pulled++;
    }

    let meta = index.meta;
    if (cloud.meta?.apiBackfill) {
      const localBf = meta.apiBackfill;
      const remote = cloud.meta.apiBackfill;
      const remoteIsNewer = !localBf || (remote.lastRunAt || '') > (localBf.lastRunAt || '');
      const earliestFrom =
        localBf?.fromDate && remote.fromDate && localBf.fromDate < remote.fromDate
          ? localBf.fromDate
          : remote.fromDate || localBf?.fromDate;
      const latestThrough =
        localBf?.completedThroughDate && remote.completedThroughDate
          ? localBf.completedThroughDate > remote.completedThroughDate
            ? localBf.completedThroughDate
            : remote.completedThroughDate
          : remote.completedThroughDate || localBf?.completedThroughDate;
      meta = {
        ...meta,
        apiBackfill: {
          fromDate: earliestFrom || remote.fromDate,
          toDate: remoteIsNewer ? remote.toDate : localBf?.toDate || remote.toDate,
          completedThroughDate: latestThrough,
          lastRunAt: remoteIsNewer ? remote.lastRunAt : localBf?.lastRunAt || remote.lastRunAt,
          fetched: remoteIsNewer
            ? remote.fetched ?? localBf?.fetched ?? 0
            : localBf?.fetched ?? remote.fetched ?? 0,
        },
      };
    }

    saveIndex({ purchases: Array.from(byKey.values()), meta });
    return { pulled, skipped: false };
  } catch (e: unknown) {
    return { pulled: 0, skipped: false, error: (e as Error)?.message || 'Cloud pull failed.' };
  }
}

/** Upload touched purchase records + current meta to Firestore. */
export async function pushPurchaseIndexToCloud(records: EbayPurchaseRecord[]): Promise<void> {
  if (!isCloudEnabled() || !records.length) return;
  try {
    const { meta } = loadEbayPurchaseIndex();
    await writeEbayPurchasesToCloud(
      records as unknown as (Record<string, unknown> & { lineKey: string })[],
      meta as EbayPurchaseCloudMeta
    );
  } catch (e) {
    console.warn('Failed to push eBay purchases to cloud cache:', e);
  }
}

export async function clearEbayPurchaseIndexEverywhere(): Promise<void> {
  memPurchases = null;
  memPurchaseMeta = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ebay-purchase-index-updated'));
    }
  } catch {
    /* ignore */
  }
  if (!isCloudEnabled()) return;
  try {
    await clearEbayPurchasesCloud();
  } catch (e) {
    console.warn('Failed to clear cloud eBay purchase cache:', e);
  }
}

export function getPurchaseTypeCounts(
  purchases: EbayPurchaseRecord[]
): Partial<Record<EbayPurchaseType, number>> {
  const counts: Partial<Record<EbayPurchaseType, number>> = {};
  for (const p of purchases) {
    const t = p.purchaseType || 'unclassified';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
