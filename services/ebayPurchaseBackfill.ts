/**
 * Backfill / incremental sync of eBay buyer purchases into local + cloud library.
 */

import { listEbayPurchases, type EbayPurchaseSummary } from './ebayService';
import {
  getSuggestedPurchaseFetchRange,
  pushPurchaseIndexToCloud,
  setPurchaseBackfillMeta,
  upsertEbayPurchases,
  type EbayPurchaseRecord,
} from './ebayPurchaseIndex';

const CHUNK_DAYS = 90;
const DELAY_BETWEEN_CHUNKS_MS = 400;

export interface PurchaseBackfillProgress {
  chunkIndex: number;
  chunkCount: number;
  rangeLabel: string;
  fetchedThisChunk: number;
  fetchedTotal: number;
}

export interface PurchaseBackfillResult {
  fetched: number;
  added: number;
  merged: number;
  cancelled: boolean;
  from: string;
  to: string;
  isIncremental: boolean;
  error?: string;
}

function toDateOnly(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildChunks(fromDate: string, toDate: string): { from: string; to: string }[] {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T23:59:59Z`);
  const chunks: { from: string; to: string }[] = [];
  let cursor = new Date(from);
  while (cursor.getTime() < to.getTime()) {
    const chunkEndMs = Math.min(cursor.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000, to.getTime());
    const chunkEnd = new Date(chunkEndMs);
    chunks.push({ from: toDateOnly(cursor), to: toDateOnly(chunkEnd) });
    cursor = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return chunks;
}

function summaryToRecord(
  p: EbayPurchaseSummary
): Omit<EbayPurchaseRecord, 'importedAt' | 'disposition' | 'sources' | 'purchaseType' | 'purchaseTypeLocked'> {
  return {
    lineKey: p.lineKey,
    orderId: p.orderId,
    transactionId: p.transactionId ?? null,
    itemId: p.itemId ?? null,
    title: p.title,
    sellerUsername: p.sellerUsername,
    creationDate: p.creationDate,
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    totalPaid: p.totalPaid,
  };
}

export async function backfillEbayPurchases(
  fromDate: string,
  toDate: string,
  onProgress?: (p: PurchaseBackfillProgress) => void,
  shouldCancel?: () => boolean,
  options?: { isIncremental?: boolean }
): Promise<PurchaseBackfillResult> {
  const chunks = buildChunks(fromDate, toDate);
  let fetchedTotal = 0;
  let addedTotal = 0;
  let mergedTotal = 0;
  const isIncremental = Boolean(options?.isIncremental);

  for (let i = 0; i < chunks.length; i++) {
    if (shouldCancel?.()) {
      return {
        fetched: fetchedTotal,
        added: addedTotal,
        merged: mergedTotal,
        cancelled: true,
        from: fromDate,
        to: toDate,
        isIncremental,
      };
    }
    const chunk = chunks[i];
    onProgress?.({
      chunkIndex: i + 1,
      chunkCount: chunks.length,
      rangeLabel: `${chunk.from} → ${chunk.to}`,
      fetchedThisChunk: 0,
      fetchedTotal,
    });

    try {
      const batch = await listEbayPurchases(chunk.from, chunk.to);
      fetchedTotal += batch.length;
      const { added, merged, changed } = upsertEbayPurchases(batch.map(summaryToRecord), 'api');
      addedTotal += added;
      mergedTotal += merged;
      setPurchaseBackfillMeta({
        fromDate,
        toDate,
        completedThroughDate: chunk.to,
        lastRunAt: new Date().toISOString(),
        fetched: fetchedTotal,
      });
      if (changed.length) {
        await pushPurchaseIndexToCloud(changed);
      }
      onProgress?.({
        chunkIndex: i + 1,
        chunkCount: chunks.length,
        rangeLabel: `${chunk.from} → ${chunk.to}`,
        fetchedThisChunk: batch.length,
        fetchedTotal,
      });
    } catch (e) {
      return {
        fetched: fetchedTotal,
        added: addedTotal,
        merged: mergedTotal,
        cancelled: false,
        from: fromDate,
        to: toDate,
        isIncremental,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS));
    }
  }

  setPurchaseBackfillMeta({
    fromDate,
    toDate,
    completedThroughDate: toDate,
    lastRunAt: new Date().toISOString(),
    fetched: fetchedTotal,
  });

  return {
    fetched: fetchedTotal,
    added: addedTotal,
    merged: mergedTotal,
    cancelled: false,
    from: fromDate,
    to: toDate,
    isIncremental,
  };
}

/** Fetch only new purchases since last successful sync (clamped to eBay’s 90-day window). */
export async function syncNewEbayPurchases(
  onProgress?: (p: PurchaseBackfillProgress) => void,
  shouldCancel?: () => boolean
): Promise<PurchaseBackfillResult> {
  const today = toDateOnly(new Date());
  const range = getSuggestedPurchaseFetchRange(today);
  return backfillEbayPurchases(range.from, range.to, onProgress, shouldCancel, {
    isIncremental: range.isIncremental,
  });
}
