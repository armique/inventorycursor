/**
 * Pending transactions that are not eBay purchase orders: Kleinanzeigen buys and sells,
 * plus anything entered by hand or by the assistant from a chat.
 *
 * eBay buyer orders keep living in `ebayPurchaseIndex` untouched — the inbox merges both
 * stores at the view layer (see utils/inboxEntries.ts), so the existing parse / confirm /
 * ignore flow keeps working with no data migration.
 *
 * Local store `pending_transactions_v1` with a Supabase mirror at
 * users/{uid}/pendingTransactions, same pattern as the eBay caches.
 */

import type { AiAttribution, AiReviewStatus, PaymentType, Platform, ProofAttachment, RecordActor, SourceLinks } from '../types';
import {
  deletePendingTransactionsFromCloud,
  fetchPendingTransactionsFromCloud,
  isCloudEnabled,
  writePendingTransactionsToCloud,
} from './supabaseService';

const STORAGE_KEY = 'pending_transactions_v1';

export const PENDING_TX_EVENT = 'pending-transactions-updated';

/** Buying from someone, or selling to someone. */
export type TransactionDirection = 'buy' | 'sell';

/**
 * Where a deal sits on its way to being final.
 *
 * - `pending` — agreed but not paid / not shipped yet.
 * - `awaiting_confirmation` — money moved, but the deal is *not* final: Kleinanzeigen
 *   "Direkt Kaufen" holds the payout until the buyer confirms receipt.
 * - `likely_complete` — cash / PayPal / wire deals, which are effectively done on payment.
 *   Kept out of the final bucket only so the user can tick "item in hand"; never blocking.
 * - `finalized` — resolved into Active inventory (buy) or Sold (sell).
 * - `cancelled` — dropped; kept for the record.
 */
export type TransactionStage =
  | 'pending'
  | 'awaiting_confirmation'
  | 'likely_complete'
  | 'finalized'
  | 'cancelled';

/** Payment methods that settle immediately — no platform-held payout to wait for. */
const IMMEDIATE_PAYMENTS: PaymentType[] = [
  'Cash',
  'Kleinanzeigen (Cash)',
  'Kleinanzeigen (Paypal)',
  'Kleinanzeigen (Wire Transfer)',
  'Paypal',
  'Bank Transfer',
];

/** Payment methods where the platform holds the money until receipt is confirmed. */
const ESCROW_PAYMENTS: PaymentType[] = ['Kleinanzeigen (Direkt Kaufen)'];

export function isEscrowPayment(payment?: PaymentType): boolean {
  return Boolean(payment && ESCROW_PAYMENTS.includes(payment));
}

export function isImmediatePayment(payment?: PaymentType): boolean {
  return Boolean(payment && IMMEDIATE_PAYMENTS.includes(payment));
}

/**
 * Stage a freshly recorded deal should start in.
 * Direkt Kaufen waits for the receipt/payout confirmation; everything else is treated as
 * probably done, with a soft "item in hand" toggle the user can tick whenever.
 */
export function initialStageFor(payment?: PaymentType, paid = true): TransactionStage {
  if (!paid) return 'pending';
  if (isEscrowPayment(payment)) return 'awaiting_confirmation';
  if (isImmediatePayment(payment)) return 'likely_complete';
  return 'pending';
}

/** Attribution and proof carry the same semantics here as on InventoryItem. */
export interface PendingTransaction extends SourceLinks, AiAttribution {
  id: string;
  platform: Platform;
  direction: TransactionDirection;
  stage: TransactionStage;
  /** What is being bought/sold — free text until it becomes an inventory item. */
  title: string;
  /**
   * Other party (seller when buying, buyer when selling).
   *
   * On Kleinanzeigen Direkt Kaufen the buyer's real name only appears in the chat once the
   * shipping label is bought, so this may legitimately hold a nickname or a placeholder for
   * days. Never a reason to block creating the record — see `counterpartyNameConfirmed`.
   */
  counterparty?: string;
  /** False while `counterparty` is still a nickname/placeholder rather than the real name. */
  counterpartyNameConfirmed?: boolean;
  amount?: number;
  paymentType?: PaymentType;
  /** YYYY-MM-DD — when the deal was struck. */
  date: string;
  /** true when the seller covered shipping (affects profit, carried into the item). */
  sellerPaidShipping?: boolean;
  shippingAmount?: number;
  /**
   * Legacy link fields kept so existing rows keep working; new writes should use the
   * `SourceLinks` fields, and `resolveTransactionSourceLinks` reads both.
   */
  chatUrl?: string;
  listingUrl?: string;
  note?: string;

  /** Inventory item this resolves into (buy) or refers to (sell). */
  linkedItemId?: string;
  /** Category hints used when creating the inventory item on finalize. */
  category?: string;
  subCategory?: string;

  createdAt: string;
  updatedAt: string;
  /** Set when the user ticked the soft "item is physically here" confirmation. */
  itemInHandAt?: string;
  finalizedAt?: string;

  /** Where the assistant read this deal from — mirrors the AI action's sourceContext. */
  sourceContext?: string;
}

let memTransactions: PendingTransaction[] | null = null;

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PENDING_TX_EVENT));
}

function normalize(raw: unknown): PendingTransaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<PendingTransaction>;
  if (!t.id || !t.title) return null;
  const now = new Date().toISOString();
  return {
    id: String(t.id),
    platform: (t.platform as Platform) || 'kleinanzeigen.de',
    direction: t.direction === 'sell' ? 'sell' : 'buy',
    stage: (t.stage as TransactionStage) || 'pending',
    title: String(t.title),
    counterparty: t.counterparty,
    counterpartyNameConfirmed: t.counterpartyNameConfirmed,
    amount: typeof t.amount === 'number' ? t.amount : undefined,
    paymentType: t.paymentType,
    date: t.date || now.slice(0, 10),
    sellerPaidShipping: t.sellerPaidShipping,
    shippingAmount: typeof t.shippingAmount === 'number' ? t.shippingAmount : undefined,
    chatUrl: t.chatUrl,
    listingUrl: t.listingUrl,
    sourceChatUrl: t.sourceChatUrl,
    sourceOrderUrl: t.sourceOrderUrl,
    counterpartyProfileUrl: t.counterpartyProfileUrl,
    externalOrderId: t.externalOrderId,
    note: t.note,
    linkedItemId: t.linkedItemId,
    category: t.category,
    subCategory: t.subCategory,
    createdAt: t.createdAt || now,
    updatedAt: t.updatedAt || t.createdAt || now,
    itemInHandAt: t.itemInHandAt,
    finalizedAt: t.finalizedAt,
    source: t.source,
    lastModifiedBy: t.lastModifiedBy,
    aiReviewStatus: t.aiReviewStatus,
    proofAttachments: Array.isArray(t.proofAttachments)
      ? (t.proofAttachments as ProofAttachment[])
      : undefined,
    sourceContext: t.sourceContext,
  };
}

export function loadPendingTransactions(): PendingTransaction[] {
  if (memTransactions) return memTransactions;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    memTransactions = Array.isArray(parsed)
      ? parsed.map(normalize).filter((t): t is PendingTransaction => Boolean(t))
      : [];
  } catch {
    memTransactions = [];
  }
  return memTransactions;
}

function save(list: PendingTransaction[], touched: PendingTransaction[]): PendingTransaction[] {
  memTransactions = list;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignore quota errors */
  }
  emitChange();
  if (touched.length) void pushPendingTransactionsToCloud(touched).catch(() => undefined);
  return list;
}

export type NewPendingTransaction = Omit<
  PendingTransaction,
  'id' | 'createdAt' | 'updatedAt' | 'stage'
> & { id?: string; stage?: TransactionStage };

/** Create a transaction. Stage defaults from the payment method when not given. */
export function createPendingTransaction(input: NewPendingTransaction): PendingTransaction {
  const now = new Date().toISOString();
  const created: PendingTransaction = {
    ...input,
    id: input.id || `ptx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stage: input.stage || initialStageFor(input.paymentType),
    createdAt: now,
    updatedAt: now,
  };
  save([...loadPendingTransactions(), created], [created]);
  return created;
}

export function updatePendingTransaction(
  id: string,
  patch: Partial<Omit<PendingTransaction, 'id' | 'createdAt'>>
): PendingTransaction | null {
  let touched: PendingTransaction | null = null;
  const next = loadPendingTransactions().map((t) => {
    if (t.id !== id) return t;
    touched = { ...t, ...patch, updatedAt: new Date().toISOString() };
    return touched;
  });
  if (!touched) return null;
  save(next, [touched]);
  return touched;
}

export function deletePendingTransaction(id: string): void {
  const existing = loadPendingTransactions();
  if (!existing.some((t) => t.id === id)) return;
  save(
    existing.filter((t) => t.id !== id),
    []
  );
  void deletePendingTransactionsFromCloud([id]).catch(() => undefined);
}

/** Soft reminder threshold — how long a likely-complete deal may sit unconfirmed. */
export const SOFT_REMINDER_DAYS = 3;

/** Days since the deal date; used for the (non-blocking) "still not confirmed" nudge. */
export function daysSince(dateIso: string, now = Date.now()): number {
  const d = Date.parse(dateIso.length <= 10 ? `${dateIso}T12:00:00Z` : dateIso);
  if (!Number.isFinite(d)) return 0;
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

/**
 * True when a likely-complete deal has been sitting unconfirmed long enough to nudge.
 * Deliberately advisory only — nothing in the UI blocks on it.
 */
export function needsSoftReminder(tx: PendingTransaction, now = Date.now()): boolean {
  if (tx.stage !== 'likely_complete') return false;
  if (tx.itemInHandAt) return false;
  return daysSince(tx.date, now) >= SOFT_REMINDER_DAYS;
}

/** Whether this stage still counts as open work in the inbox. */
export function isOpenStage(stage: TransactionStage): boolean {
  return stage === 'pending' || stage === 'awaiting_confirmation' || stage === 'likely_complete';
}

export async function pushPendingTransactionsToCloud(rows: PendingTransaction[]): Promise<void> {
  if (!isCloudEnabled() || !rows.length) return;
  try {
    await writePendingTransactionsToCloud(
      rows as unknown as (Record<string, unknown> & { id: string })[]
    );
  } catch (e) {
    console.warn('Failed to push pending transactions to cloud:', e);
  }
}

export interface PendingTxPullResult {
  pulled: number;
  skipped: boolean;
  error?: string;
}

/** Merge the Supabase copy into the local store (newest `updatedAt` wins). */
export async function pullPendingTransactionsFromCloud(): Promise<PendingTxPullResult> {
  if (!isCloudEnabled()) return { pulled: 0, skipped: true };
  try {
    const remote = await fetchPendingTransactionsFromCloud();
    if (!remote) return { pulled: 0, skipped: true };
    const rows = remote.map(normalize).filter((t): t is PendingTransaction => Boolean(t));
    const byId = new Map(loadPendingTransactions().map((t) => [t.id, t]));
    let pulled = 0;
    for (const r of rows) {
      const local = byId.get(r.id);
      if (!local || r.updatedAt > local.updatedAt) {
        byId.set(r.id, r);
        pulled++;
      }
    }
    save(Array.from(byId.values()), []);
    return { pulled, skipped: false };
  } catch (e) {
    return { pulled: 0, skipped: false, error: (e as Error)?.message || 'Cloud pull failed.' };
  }
}
