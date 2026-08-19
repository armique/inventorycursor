/**
 * Chunked pull of eBay Sell Finances transactions into the order cache.
 * Merges by orderId with Fulfillment/CSV rows (fees fill in; buyer/address stay).
 */

import { listEbayFinanceTransactions } from './ebayService';
import {
  loadEbayOrderIndex,
  pushOrderIndexToCloud,
  setFinancesBackfillMeta,
  upsertEbayOrders,
} from './ebayOrderIndex';
import { financeTransactionsToOrderRecords } from '../utils/ebayFinancesMap';

const CHUNK_DAYS = 14;
const DELAY_BETWEEN_CHUNKS_MS = 350;

export interface FinancesBackfillProgress {
  chunkIndex: number;
  chunkCount: number;
  rangeLabel: string;
  transactionsThisChunk: number;
  transactionsTotal: number;
  ordersTouched: number;
}

export interface FinancesBackfillResult {
  transactionsFetched: number;
  ordersTouched: number;
  added: number;
  merged: number;
  cancelled: boolean;
  error?: string;
  code?: string;
  from?: string;
  to?: string;
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

export async function backfillEbayFinances(
  fromDate: string,
  toDate: string,
  onProgress?: (p: FinancesBackfillProgress) => void,
  cancelToken?: { cancelled: boolean }
): Promise<FinancesBackfillResult> {
  const chunks = buildChunks(fromDate, toDate);
  let transactionsFetched = 0;
  let ordersTouched = 0;
  let added = 0;
  let merged = 0;

  const existingFrom = loadEbayOrderIndex().meta.financesBackfill?.fromDate;
  const earliestFrom = existingFrom && existingFrom < fromDate ? existingFrom : fromDate;

  for (let i = 0; i < chunks.length; i++) {
    if (cancelToken?.cancelled) {
      return { transactionsFetched, ordersTouched, added, merged, cancelled: true, from: fromDate, to: toDate };
    }
    const chunk = chunks[i];
    const rangeLabel = `${chunk.from} → ${chunk.to}`;
    onProgress?.({
      chunkIndex: i,
      chunkCount: chunks.length,
      rangeLabel,
      transactionsThisChunk: 0,
      transactionsTotal: transactionsFetched,
      ordersTouched,
    });

    try {
      const transactions = await listEbayFinanceTransactions(chunk.from, chunk.to);
      transactionsFetched += transactions.length;
      const records = financeTransactionsToOrderRecords(transactions);
      const result = records.length
        ? upsertEbayOrders(records)
        : { added: 0, merged: 0, total: 0, changed: [] };
      added += result.added;
      merged += result.merged;
      ordersTouched += result.changed.length;
      setFinancesBackfillMeta({
        fromDate: earliestFrom,
        toDate,
        completedThroughDate: chunk.to,
        lastRunAt: new Date().toISOString(),
        isComplete: i === chunks.length - 1,
        transactionCount: transactionsFetched,
      });
      if (result.changed.length) await pushOrderIndexToCloud(result.changed);
      else await pushOrderIndexToCloud([]);
      onProgress?.({
        chunkIndex: i,
        chunkCount: chunks.length,
        rangeLabel,
        transactionsThisChunk: transactions.length,
        transactionsTotal: transactionsFetched,
        ordersTouched,
      });
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      return {
        transactionsFetched,
        ordersTouched,
        added,
        merged,
        cancelled: false,
        error: `Fees failed on ${rangeLabel}: ${err?.message || 'Unknown error'}`,
        code: err?.code,
        from: fromDate,
        to: toDate,
      };
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS));
    }
  }

  return { transactionsFetched, ordersTouched, added, merged, cancelled: false, from: fromDate, to: toDate };
}
