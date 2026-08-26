/**
 * Build a review table of suggested inventory links for every Bestellung in a CSV report.
 * High-confidence rows can be applied in bulk; weaker ones stay for manual Match.
 */
import type { InventoryItem } from '../types';
import {
  findEbayTxInventoryMatches,
  type EbayTxItemCandidate,
} from './ebayTxInventoryMatch';
import {
  ebayTxOrderSellDate,
  type EbayTxOrderLedger,
  type EbayTxRow,
} from './ebayTransactionReport';
import { ebayTxBuyerTotalEur } from './linkInventoryItemToEbayTx';

export type EbayTxBulkMatchSuggestion = {
  orderId: string;
  csvSellDate: string;
  title: string;
  buyer: string;
  buyerTotalEur: number;
  alreadyLinkedItemId?: string;
  alreadyLinkedName?: string;
  /** Best inventory suggestion (null if none above threshold). */
  suggestedItemId?: string;
  suggestedName?: string;
  suggestedSellDate?: string;
  suggestedSellPrice?: number;
  score: number;
  kind: string;
  confidence: 'high' | 'medium' | 'low' | 'linked' | 'none';
  reason: string;
};

const HIGH_SCORE = 900; // listingId / sku / order
const MEDIUM_SCORE = 400; // strong title + date/price

function confidenceFor(
  linked: boolean,
  top: EbayTxItemCandidate | undefined
): EbayTxBulkMatchSuggestion['confidence'] {
  if (linked) return 'linked';
  if (!top) return 'none';
  if (top.kind === 'order' || top.kind === 'listingId' || top.kind === 'sku' || top.score >= HIGH_SCORE) {
    return 'high';
  }
  if (top.score >= MEDIUM_SCORE && (top.dateScore >= 280 || top.priceScore >= 280)) return 'medium';
  if (top.score >= 120) return 'low';
  return 'none';
}

function reasonFor(linked: boolean, top: EbayTxItemCandidate | undefined): string {
  if (linked) return 'Already linked to this order';
  if (!top) return 'No inventory match found';
  const bits: string[] = [top.kind];
  if (top.dateScore >= 450) bits.push('same/near sell date');
  if (top.priceScore >= 450) bits.push('price match');
  if (top.titleScore >= 80) bits.push('title');
  return bits.join(' · ');
}

function sortEbayTxBulkMatchSuggestions(out: EbayTxBulkMatchSuggestion[]): EbayTxBulkMatchSuggestion[] {
  const rank: Record<EbayTxBulkMatchSuggestion['confidence'], number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    linked: 4,
  };
  return [...out].sort((a, b) => {
    if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence];
    return b.score - a.score;
  });
}

function suggestionForOrderRow(
  items: InventoryItem[],
  row: EbayTxRow,
  ledgers: Map<string, EbayTxOrderLedger>
): EbayTxBulkMatchSuggestion {
  const orderId = row.orderId.trim();
  const ledger = ledgers.get(orderId) || null;
  const matches = findEbayTxInventoryMatches(items, row, ledger, '', 5);
  const linked = matches.find((m) => m.alreadyLinked);
  const top = linked || matches[0];
  const conf = confidenceFor(Boolean(linked), top && !linked ? top : linked || top);

  return {
    orderId,
    csvSellDate: ebayTxOrderSellDate(row),
    title: (row.title || row.description || '').trim(),
    buyer: (row.buyerUsername || row.buyerName || '').trim(),
    buyerTotalEur: ebayTxBuyerTotalEur(row, ledger),
    alreadyLinkedItemId: linked?.item.id,
    alreadyLinkedName: linked?.item.name,
    suggestedItemId: linked ? undefined : top?.item.id,
    suggestedName: linked ? undefined : top?.item.name,
    suggestedSellDate: linked ? undefined : top?.item.sellDate || top?.item.containerSoldDate,
    suggestedSellPrice: linked
      ? undefined
      : Number(top?.item.saleProceeds?.buyerTotalEur ?? top?.item.sellPrice) || undefined,
    score: top?.score || 0,
    kind: top?.kind || '',
    confidence: conf === 'linked' ? 'linked' : linked ? 'linked' : conf,
    reason: reasonFor(Boolean(linked), top),
  };
}

export function summarizeEbayTxBulkMatchSuggestions(rows: EbayTxBulkMatchSuggestion[]) {
  return {
    total: rows.length,
    high: rows.filter((r) => r.confidence === 'high').length,
    medium: rows.filter((r) => r.confidence === 'medium').length,
    low: rows.filter((r) => r.confidence === 'low').length,
    linked: rows.filter((r) => r.confidence === 'linked').length,
    none: rows.filter((r) => r.confidence === 'none').length,
  };
}

export function buildEbayTxBulkMatchSuggestions(
  items: InventoryItem[],
  rows: EbayTxRow[],
  ledgers: Map<string, EbayTxOrderLedger>
): EbayTxBulkMatchSuggestion[] {
  const orderRows = rows.filter((row) => row.kind === 'order' && (row.orderId || '').trim());
  const seen = new Set<string>();
  const out: EbayTxBulkMatchSuggestion[] = [];

  for (const row of orderRows) {
    const orderId = row.orderId.trim();
    if (seen.has(orderId)) continue;
    seen.add(orderId);
    out.push(suggestionForOrderRow(items, row, ledgers));
  }

  return sortEbayTxBulkMatchSuggestions(out);
}

/** Chunked matcher build — yields between batches so the UI thread stays responsive. */
export async function buildEbayTxBulkMatchSuggestionsAsync(
  items: InventoryItem[],
  rows: EbayTxRow[],
  ledgers: Map<string, EbayTxOrderLedger>,
  options?: {
    batchSize?: number;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  }
): Promise<EbayTxBulkMatchSuggestion[]> {
  const batchSize = options?.batchSize ?? 32;
  const orderRows = rows.filter((row) => row.kind === 'order' && (row.orderId || '').trim());
  const seen = new Set<string>();
  const uniqueRows: EbayTxRow[] = [];
  for (const row of orderRows) {
    const orderId = row.orderId.trim();
    if (seen.has(orderId)) continue;
    seen.add(orderId);
    uniqueRows.push(row);
  }

  const total = uniqueRows.length;
  const out: EbayTxBulkMatchSuggestion[] = [];
  for (let i = 0; i < uniqueRows.length; i += batchSize) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const batch = uniqueRows.slice(i, i + batchSize);
    for (const row of batch) {
      out.push(suggestionForOrderRow(items, row, ledgers));
    }
    options?.onProgress?.(Math.min(i + batch.length, total), total);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return sortEbayTxBulkMatchSuggestions(out);
}

export function ebayTxBulkMatchSuggestionsToCsv(rows: EbayTxBulkMatchSuggestion[]): string {
  const header = [
    'confidence',
    'orderId',
    'csvSellDate',
    'title',
    'buyer',
    'buyerTotalEur',
    'suggestedItemId',
    'suggestedName',
    'suggestedSellDate',
    'suggestedSellPrice',
    'alreadyLinkedItemId',
    'alreadyLinkedName',
    'score',
    'kind',
    'reason',
  ];
  const esc = (v: string | number | undefined) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.confidence,
        row.orderId,
        row.csvSellDate,
        row.title,
        row.buyer,
        row.buyerTotalEur.toFixed(2),
        row.suggestedItemId || '',
        row.suggestedName || '',
        row.suggestedSellDate || '',
        row.suggestedSellPrice != null ? row.suggestedSellPrice.toFixed(2) : '',
        row.alreadyLinkedItemId || '',
        row.alreadyLinkedName || '',
        row.score,
        row.kind,
        row.reason,
      ]
        .map(esc)
        .join(',')
    );
  }
  return lines.join('\n');
}
