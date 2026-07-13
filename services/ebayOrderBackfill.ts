/**
 * Chunked backfill of eBay Fulfillment API orders across a long date range
 * (e.g. since Feb 2025), written incrementally into the local order index
 * so progress survives if a chunk fails or the run is cancelled.
 */

import { listEbayOrders, type EbayOrderSummary } from './ebayService';
import {
  upsertEbayOrders,
  setApiBackfillMeta,
  loadEbayOrderIndex,
  pushOrderIndexToCloud,
  type EbayOrderRecord,
} from './ebayOrderIndex';

/** eBay's order search endpoint can time out on very wide ranges — fetch in chunks. */
const CHUNK_DAYS = 45;
const DELAY_BETWEEN_CHUNKS_MS = 300;

export interface BackfillProgress {
  chunkIndex: number;
  chunkCount: number;
  rangeLabel: string;
  ordersFetchedThisChunk: number;
  ordersFetchedTotal: number;
}

export interface BackfillResult {
  ordersFetched: number;
  added: number;
  merged: number;
  cancelled: boolean;
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

export function ebaySummaryToRecord(o: EbayOrderSummary): EbayOrderRecord {
  const lineTotal = o.lineItems.reduce((sum, li) => sum + (li.lineItemCost || 0), 0);
  return {
    orderId: o.orderId,
    creationDate: o.creationDate,
    buyer: { ...o.buyer },
    lineItems: o.lineItems.map((li) => ({
      sku: li.sku,
      title: li.title,
      lineItemCost: li.lineItemCost,
      listingId: li.listingId ?? null,
      quantity: null,
    })),
    grossTotal: o.orderTotal ?? (lineTotal || null),
    orderFulfillmentStatus: o.orderFulfillmentStatus ?? null,
    orderPaymentStatus: o.orderPaymentStatus ?? null,
    cancelState: o.cancelState ?? null,
    lastModifiedDate: o.lastModifiedDate ?? null,
    sources: ['api'],
    importedAt: new Date().toISOString(),
  };
}

/**
 * Fetch every order between fromDate/toDate (YYYY-MM-DD) in chunks, caching
 * results into the order index as each chunk completes.
 */
export async function backfillEbayOrders(
  fromDate: string,
  toDate: string,
  onProgress?: (p: BackfillProgress) => void,
  cancelToken?: { cancelled: boolean }
): Promise<BackfillResult> {
  const chunks = buildChunks(fromDate, toDate);
  let ordersFetched = 0;
  let added = 0;
  let merged = 0;

  // Keep the earliest-ever "fromDate" in meta so resuming with a later start date
  // (incremental sync) doesn't erase the record of how far back history actually goes.
  const existingFromDate = loadEbayOrderIndex().meta.apiBackfill?.fromDate;
  const earliestFromDate = existingFromDate && existingFromDate < fromDate ? existingFromDate : fromDate;

  for (let i = 0; i < chunks.length; i++) {
    if (cancelToken?.cancelled) {
      return { ordersFetched, added, merged, cancelled: true };
    }
    const chunk = chunks[i];
    const rangeLabel = `${chunk.from} → ${chunk.to}`;
    onProgress?.({
      chunkIndex: i,
      chunkCount: chunks.length,
      rangeLabel,
      ordersFetchedThisChunk: 0,
      ordersFetchedTotal: ordersFetched,
    });

    try {
      const orders = await listEbayOrders(chunk.from, chunk.to);
      ordersFetched += orders.length;
      const records = orders.map(ebaySummaryToRecord);
      const result = upsertEbayOrders(records);
      added += result.added;
      merged += result.merged;
      setApiBackfillMeta({
        fromDate: earliestFromDate,
        toDate,
        completedThroughDate: chunk.to,
        lastRunAt: new Date().toISOString(),
        isComplete: i === chunks.length - 1,
      });
      // Mirror this chunk's changes to Firestore right away so progress survives even if a later chunk fails.
      await pushOrderIndexToCloud(result.changed);
      onProgress?.({
        chunkIndex: i,
        chunkCount: chunks.length,
        rangeLabel,
        ordersFetchedThisChunk: orders.length,
        ordersFetchedTotal: ordersFetched,
      });
    } catch (e: unknown) {
      return {
        ordersFetched,
        added,
        merged,
        cancelled: false,
        error: `Failed on range ${rangeLabel}: ${(e as Error)?.message || 'Unknown error'}`,
      };
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS));
    }
  }

  return { ordersFetched, added, merged, cancelled: false };
}
