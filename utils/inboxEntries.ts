/**
 * Adapter that presents both inbox sources as one list.
 *
 * Source A: `ebayPurchaseIndex` — eBay buyer orders, untouched by this refactor so the
 *           existing Parse · Confirm · Ignore flow keeps working exactly as before.
 * Source B: `pendingTransactions` — Kleinanzeigen buys/sells and hand/AI-entered deals.
 *
 * Nothing here writes: it only maps both record shapes onto a common view model.
 */

import type { PaymentType, Platform } from '../types';
import { resolveSourceLinks, resolveTransactionSourceLinks, type ResolvedSourceLinks } from './sourceLinks';
import type { EbayPurchaseRecord } from '../services/ebayPurchaseIndex';
import {
  isEscrowPayment,
  needsSoftReminder,
  type PendingTransaction,
  type TransactionDirection,
  type TransactionStage,
} from '../services/pendingTransactions';

export type InboxSourceKind = 'ebay' | 'transaction';

/** Buckets shown as tabs in the inbox. */
export type InboxBucket = 'pending' | 'awaiting' | 'finalized' | 'ignored' | 'all';

export interface InboxEntry {
  /** Unique across both stores: `ebay:<lineKey>` or `tx:<id>`. */
  key: string;
  kind: InboxSourceKind;
  /** Original record, for handlers that need the source-specific fields. */
  ebay?: EbayPurchaseRecord;
  transaction?: PendingTransaction;

  title: string;
  platform: Platform;
  direction: TransactionDirection;
  stage: TransactionStage;
  counterparty?: string;
  amount?: number;
  paymentType?: PaymentType;
  /** YYYY-MM-DD */
  date: string;
  linkedItemId?: string;

  /** Short human status shown on the card. */
  statusLabel: string;
  /** Label for the primary action button at this stage ('' when there is none). */
  actionLabel: string;
  /** The deal is held by the platform until receipt is confirmed (Direkt Kaufen). */
  escrowHeld: boolean;
  /** Non-blocking nudge: settled days ago but never confirmed as in hand. */
  softReminder: boolean;
  /** Chat / order / profile links back to where the deal happened. */
  sourceLinks: ResolvedSourceLinks;
  /** Counterparty is still a nickname — real name not revealed yet (Direkt Kaufen). */
  nameUnconfirmed: boolean;

  // Attribution, mirrored from whichever record this came from.
  source?: 'manual' | 'ai';
  aiReviewStatus?: 'unreviewed' | 'approved' | 'reverted';
  sourceContext?: string;
}

/** eBay dispositions mapped onto the shared stage vocabulary. */
function stageFromDisposition(record: EbayPurchaseRecord): TransactionStage {
  switch (record.disposition) {
    case 'pending':
      return 'pending';
    case 'skipped':
      return 'cancelled';
    // inventory / expense / filament / personal are all resolved outcomes.
    default:
      return 'finalized';
  }
}

function ebayStatusLabel(record: EbayPurchaseRecord): string {
  switch (record.disposition) {
    case 'pending':
      return 'Ordered · awaiting receipt';
    case 'inventory':
      return 'Received → Active';
    case 'skipped':
      return 'Ignored';
    case 'expense':
      return 'Booked as expense';
    case 'filament':
      return 'Booked as filament';
    case 'personal':
      return 'Personal purchase';
    default:
      return record.disposition;
  }
}

export function toInboxEntryFromEbay(record: EbayPurchaseRecord): InboxEntry {
  const stage = stageFromDisposition(record);
  return {
    key: `ebay:${record.lineKey}`,
    kind: 'ebay',
    ebay: record,
    title: record.inventoryDraft?.name || record.title,
    platform: 'ebay.de',
    direction: 'buy',
    stage,
    counterparty: record.sellerUsername,
    amount: record.totalPaid ?? record.unitPrice ?? undefined,
    paymentType: 'ebay.de',
    date: record.creationDate || record.importedAt.slice(0, 10),
    linkedItemId: record.inventoryItemId,
    statusLabel: ebayStatusLabel(record),
    actionLabel: stage === 'pending' ? 'Confirm received' : '',
    escrowHeld: false,
    softReminder: false,
    // eBay gives ids, not URLs — the order/profile links are derived from them.
    sourceLinks: resolveSourceLinks({
      externalOrderId: record.orderId,
      ebayUsername: record.sellerUsername,
    }),
    // eBay always exposes the seller username up front.
    nameUnconfirmed: false,
  };
}

function transactionStatusLabel(tx: PendingTransaction): string {
  const side = tx.direction === 'buy' ? 'Purchase' : 'Sale';
  switch (tx.stage) {
    case 'pending':
      return `${side} · agreed, not settled`;
    case 'awaiting_confirmation':
      return tx.direction === 'sell'
        ? 'Shipped · awaiting buyer confirmation & payout'
        : 'Paid · awaiting receipt confirmation';
    case 'likely_complete':
      return tx.itemInHandAt
        ? `${side} · confirmed`
        : `${side} · likely complete`;
    case 'finalized':
      return tx.direction === 'buy' ? 'Received → Active' : 'Sold (final)';
    case 'cancelled':
      return 'Cancelled';
    default:
      return tx.stage;
  }
}

function transactionActionLabel(tx: PendingTransaction): string {
  switch (tx.stage) {
    case 'pending':
      return tx.direction === 'buy' ? 'Mark paid' : 'Mark shipped';
    case 'awaiting_confirmation':
      return tx.direction === 'buy' ? 'Confirm receipt' : 'Buyer confirmed · payout';
    case 'likely_complete':
      return tx.itemInHandAt
        ? tx.direction === 'buy'
          ? 'Add to inventory'
          : 'Mark sold'
        : tx.direction === 'buy'
          ? 'Item in stock'
          : 'Item handed over';
    default:
      return '';
  }
}

export function toInboxEntryFromTransaction(tx: PendingTransaction, now = Date.now()): InboxEntry {
  return {
    key: `tx:${tx.id}`,
    kind: 'transaction',
    transaction: tx,
    title: tx.title,
    platform: tx.platform,
    direction: tx.direction,
    stage: tx.stage,
    counterparty: tx.counterparty,
    amount: tx.amount,
    paymentType: tx.paymentType,
    date: tx.date,
    linkedItemId: tx.linkedItemId,
    statusLabel: transactionStatusLabel(tx),
    actionLabel: transactionActionLabel(tx),
    escrowHeld: isEscrowPayment(tx.paymentType) && tx.stage === 'awaiting_confirmation',
    softReminder: needsSoftReminder(tx, now),
    sourceLinks: resolveTransactionSourceLinks(tx),
    nameUnconfirmed: tx.counterpartyNameConfirmed === false,
    source: tx.source,
    aiReviewStatus: tx.aiReviewStatus,
    sourceContext: tx.sourceContext,
  };
}

/** Merge both stores into one newest-first list. */
export function buildInboxEntries(
  purchases: EbayPurchaseRecord[],
  transactions: PendingTransaction[],
  now = Date.now()
): InboxEntry[] {
  return [
    ...purchases.map(toInboxEntryFromEbay),
    ...transactions.map((t) => toInboxEntryFromTransaction(t, now)),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** Which tab an entry belongs to. */
export function bucketOf(entry: InboxEntry): Exclude<InboxBucket, 'all'> {
  if (entry.stage === 'cancelled') return 'ignored';
  if (entry.stage === 'finalized') return 'finalized';
  if (entry.stage === 'awaiting_confirmation' || entry.stage === 'likely_complete') {
    return 'awaiting';
  }
  return 'pending';
}

export function filterInboxEntries(entries: InboxEntry[], bucket: InboxBucket): InboxEntry[] {
  // "All" hides ignored rows — they are noise once dismissed.
  if (bucket === 'all') return entries.filter((e) => e.stage !== 'cancelled');
  return entries.filter((e) => bucketOf(e) === bucket);
}

export function countInboxBuckets(entries: InboxEntry[]): Record<InboxBucket, number> {
  const counts: Record<InboxBucket, number> = {
    pending: 0,
    awaiting: 0,
    finalized: 0,
    ignored: 0,
    all: 0,
  };
  for (const e of entries) {
    counts[bucketOf(e)]++;
    if (e.stage !== 'cancelled') counts.all++;
  }
  return counts;
}

const DIRECTION_LABELS: Record<TransactionDirection, string> = { buy: 'Buy', sell: 'Sell' };

export function formatDirection(direction: TransactionDirection): string {
  return DIRECTION_LABELS[direction];
}

export function formatPlatformShort(platform: Platform): string {
  if (platform === 'kleinanzeigen.de') return 'Kleinanzeigen';
  if (platform === 'ebay.de') return 'eBay';
  return platform;
}
