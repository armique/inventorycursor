/**
 * Unified pending inbox — logic + UI pieces embedded in the InventoryList shells.
 *
 * Tracks deals from both platforms and both directions until they are logically done,
 * then routes them into Active inventory (purchases) or Sold (sales).
 *
 * Two stores feed it, merged by utils/inboxEntries:
 *  - eBay buyer orders (ebayPurchaseIndex) — the original Parse · Confirm · Ignore flow,
 *    unchanged, so existing pending orders keep working with no migration.
 *  - pendingTransactions — Kleinanzeigen buys/sells and anything entered by hand or by
 *    the assistant.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  EyeOff,
  Inbox,
  Loader2,
  Lock,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Sparkles,
  Undo2,
  UserX,
} from 'lucide-react';
import { ItemStatus, type InventoryItem } from '../types';
import { hasEbayToken } from '../services/ebayService';
import {
  getSuggestedPurchaseFetchRange,
  loadEbayPurchaseIndex,
  pullPurchaseIndexFromCloud,
  setPurchaseDisposition,
  type EbayPurchaseRecord,
} from '../services/ebayPurchaseIndex';
import { syncNewEbayPurchases } from '../services/ebayPurchaseBackfill';
import {
  loadPendingTransactions,
  PENDING_TX_EVENT,
  pullPendingTransactionsFromCloud,
  updatePendingTransaction,
  type PendingTransaction,
} from '../services/pendingTransactions';
import {
  bucketOf,
  buildInboxEntries,
  countInboxBuckets,
  filterInboxEntries,
  formatDirection,
  formatPlatformShort,
  type InboxBucket,
  type InboxEntry,
} from '../utils/inboxEntries';
import {
  applySaleTransactionToItem,
  buildItemFromPurchaseTransaction,
  findItemForSaleTransaction,
} from '../utils/inboxFinalize';
import {
  createInventoryFromPurchase,
  parseAndSavePurchaseSpecs,
  purchaseHasParsedSpecs,
  purchaseToPreviewItem,
} from '../utils/ebayPurchaseToInventory';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import ItemThumbnail from './ItemThumbnail';
import MobileStockCard from './MobileStockCard';
import { findStaleDeals, formatStaleKind } from '../utils/staleDeals';
import SourceLinkIcons, { PrimarySourceLinkButton } from './SourceLinkIcons';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';

/** Kept for callers that still speak the old vocabulary. */
export type PurchaseViewFilter = InboxBucket;

export type UseInventoryPurchasesArgs = {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onOpenItem?: (id: string) => void;
  /** Open purchase as editable inventory-style draft (same Edit modal). */
  onOpenPurchaseDraft?: (item: InventoryItem) => void;
  searchTerm?: string;
};

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

const BUCKET_LABELS: Record<InboxBucket, string> = {
  pending: 'Pending',
  awaiting: 'To confirm',
  finalized: 'Finalized',
  ignored: 'Ignored',
  all: 'All',
};

export function useInventoryPurchases({
  items,
  categories,
  categoryFields,
  onUpdate,
  onOpenItem,
  onOpenPurchaseDraft,
  searchTerm = '',
}: UseInventoryPurchasesArgs) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const purchases = useMemo(() => loadEbayPurchaseIndex().purchases, [version]);
  const transactions = useMemo(() => loadPendingTransactions(), [version]);
  const [filter, setFilter] = useState<InboxBucket>('pending');
  /** Narrow to deals whose counterparty is still a nickname (Direkt Kaufen name reveal). */
  const [onlyUnconfirmedNames, setOnlyUnconfirmedNames] = useState(false);
  const [receivingKey, setReceivingKey] = useState<string | null>(null);
  const [parsingKey, setParsingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<EbayToolProgress | null>(null);
  const [tokenReady] = useState(() => hasEbayToken());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needsEbay = loadEbayPurchaseIndex().purchases.length === 0;
      const needsTx = loadPendingTransactions().length === 0;
      if (needsEbay) await pullPurchaseIndexFromCloud();
      if (needsTx) await pullPendingTransactionsFromCloud();
      if (!cancelled && (needsEbay || needsTx)) refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Transactions can also be written by the assistant while this view is open.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener(PENDING_TX_EVENT, refresh);
    return () => window.removeEventListener(PENDING_TX_EVENT, refresh);
  }, [refresh]);

  const allEntries = useMemo(
    () => buildInboxEntries(purchases, transactions),
    [purchases, transactions]
  );
  const counts = useMemo(() => countInboxBuckets(allEntries), [allEntries]);

  // Land on the first bucket that actually has work, so the inbox never opens empty
  // while deals are waiting. Runs once, and only while the user is still on the default.
  const autoBucketPickedRef = React.useRef(false);
  useEffect(() => {
    if (autoBucketPickedRef.current || allEntries.length === 0) return;
    autoBucketPickedRef.current = true;
    if (counts.pending === 0 && counts.awaiting > 0) setFilter('awaiting');
  }, [allEntries.length, counts.pending, counts.awaiting]);

  const unconfirmedNameCount = useMemo(
    () => allEntries.filter((e) => e.nameUnconfirmed && e.stage !== 'cancelled').length,
    [allEntries]
  );

  const rows = useMemo(() => {
    let list = filterInboxEntries(allEntries, filter);
    if (onlyUnconfirmedNames) list = list.filter((e) => e.nameUnconfirmed);
    const q = searchTerm.trim();
    if (q) {
      list = list.filter((e) =>
        matchesEbayToolSearch(q, [
          e.title,
          e.counterparty,
          e.paymentType,
          e.statusLabel,
          e.ebay?.orderId,
          e.ebay?.itemId,
          e.ebay?.inventoryDraft?.category,
          e.ebay?.inventoryDraft?.subCategory,
          e.transaction?.note,
          e.transaction?.chatUrl,
        ])
      );
    }
    return list;
  }, [allEntries, filter, onlyUnconfirmedNames, searchTerm]);

  const syncNew = async () => {
    if (!tokenReady) {
      setError('Add an eBay OAuth token in Settings to sync purchases.');
      return;
    }
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncNewEbayPurchases(
        (p) =>
          setSyncProgress({
            label: 'Syncing new purchases…',
            done: p.chunkIndex + 1,
            total: p.chunkCount,
            detail: `${p.rangeLabel} · ${p.fetchedTotal} lines`,
          }),
        () => false
      );
      if (result.error) setError(result.error);
      else {
        setMessage(
          `Synced ${result.from} → ${result.to}: ${result.added} new · ${result.merged} updated`
        );
      }
      refresh();
    } catch (e) {
      setError((e as Error)?.message || 'Purchase sync failed.');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncProgress(null), 800);
    }
  };

  // --- eBay flow (unchanged behaviour) ---

  const parseSpecs = async (p: EbayPurchaseRecord) => {
    if (p.disposition !== 'pending') return;
    setParsingKey(p.lineKey);
    setError(null);
    setMessage(null);
    try {
      const { draft } = await parseAndSavePurchaseSpecs(p, categories, categoryFields);
      refresh();
      const specCount = Object.keys(draft.specs || {}).length;
      setMessage(
        `Parsed “${draft.name}” · ${draft.category}${
          draft.subCategory ? ` / ${draft.subCategory}` : ''
        } · ${specCount} spec${specCount === 1 ? '' : 's'}${
          draft.enrichError ? ` · ${draft.enrichError}` : ''
        }`
      );
    } catch (e) {
      setError((e as Error)?.message || 'Failed to parse specs.');
    } finally {
      setParsingKey(null);
    }
  };

  const confirmReceived = async (p: EbayPurchaseRecord) => {
    if (p.disposition === 'inventory' && p.inventoryItemId) {
      setError('Already added to inventory.');
      return;
    }
    if (p.disposition !== 'pending') {
      setError('Only pending purchases can be confirmed as received.');
      return;
    }
    setReceivingKey(p.lineKey);
    setError(null);
    setMessage(null);
    try {
      const fresh = loadEbayPurchaseIndex().purchases.find((x) => x.lineKey === p.lineKey) || p;
      const { item, draft } = await createInventoryFromPurchase(fresh, categories, categoryFields, {
        parseSpecs: !purchaseHasParsedSpecs(fresh),
        itemId: `item-${Date.now()}-ebay-buy`,
        receiveDate: todayISO(),
      });
      onUpdate([item]);
      setPurchaseDisposition(p.lineKey, 'inventory', {
        inventoryItemId: item.id,
        note: draft.enrichError || undefined,
      });
      refresh();
      const specCount = Object.keys(item.specs || {}).length;
      setMessage(
        `Received → Active: ${item.name} · €${formatEUR(item.buyPrice)} · ${specCount} spec${
          specCount === 1 ? '' : 's'
        }`
      );
      onOpenItem?.(item.id);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to add purchase to inventory.');
    } finally {
      setReceivingKey(null);
    }
  };

  const ignorePurchase = (p: EbayPurchaseRecord) => {
    if (p.disposition !== 'pending') return;
    setPurchaseDisposition(p.lineKey, 'skipped', {
      note: 'Ignored — not business inventory',
    });
    refresh();
    setError(null);
    setMessage(`Ignored “${p.inventoryDraft?.name || p.title}” — open Ignored to undo`);
  };

  const undoIgnore = (p: EbayPurchaseRecord) => {
    if (p.disposition !== 'skipped') return;
    setPurchaseDisposition(p.lineKey, 'pending');
    refresh();
    setError(null);
    setMessage(`Restored to Pending: ${p.inventoryDraft?.name || p.title}`);
  };

  // --- Kleinanzeigen / manual transactions ---

  /** Advance a transaction one stage, finalizing into Active or Sold at the end. */
  const advanceTransaction = (tx: PendingTransaction) => {
    setError(null);
    setMessage(null);

    if (tx.stage === 'pending') {
      // Money moved: Direkt Kaufen now waits for the platform confirmation, the rest
      // are effectively done but keep the soft in-hand toggle.
      const next = updatePendingTransaction(tx.id, {
        stage: tx.paymentType === 'Kleinanzeigen (Direkt Kaufen)' ? 'awaiting_confirmation' : 'likely_complete',
        lastModifiedBy: 'manual',
      });
      refresh();
      setMessage(
        next?.stage === 'awaiting_confirmation'
          ? `Waiting for the Direkt Kaufen confirmation on “${tx.title}”`
          : `“${tx.title}” marked as settled — confirm when the item is in hand`
      );
      return;
    }

    if (tx.stage === 'awaiting_confirmation') {
      updatePendingTransaction(tx.id, {
        stage: 'likely_complete',
        itemInHandAt: new Date().toISOString(),
        lastModifiedBy: 'manual',
      });
      refresh();
      setMessage(
        tx.direction === 'buy'
          ? `Receipt confirmed for “${tx.title}” — add it to inventory next`
          : `Buyer confirmed “${tx.title}” — payout released, mark it sold next`
      );
      return;
    }

    if (tx.stage === 'likely_complete') {
      if (!tx.itemInHandAt) {
        updatePendingTransaction(tx.id, {
          itemInHandAt: new Date().toISOString(),
          lastModifiedBy: 'manual',
        });
        refresh();
        setMessage(
          tx.direction === 'buy'
            ? `Marked “${tx.title}” as physically in stock`
            : `Marked “${tx.title}” as handed over`
        );
        return;
      }
      finalizeTransaction(tx);
    }
  };

  /** Resolve into Active inventory (buy) or Sold (sell). */
  const finalizeTransaction = (tx: PendingTransaction) => {
    if (tx.direction === 'buy') {
      const item = buildItemFromPurchaseTransaction(tx, {
        itemId: `item-${Date.now()}-ka-buy`,
        receiveDate: todayISO(),
      });
      onUpdate([item]);
      updatePendingTransaction(tx.id, {
        stage: 'finalized',
        linkedItemId: item.id,
        finalizedAt: new Date().toISOString(),
        lastModifiedBy: 'manual',
      });
      refresh();
      setMessage(`Received → Active: ${item.name} · €${formatEUR(item.buyPrice)}`);
      onOpenItem?.(item.id);
      return;
    }

    const linked = findItemForSaleTransaction(tx, items);
    if (!linked) {
      setError(
        `No inventory item matches “${tx.title}”. Open the item and mark it sold, or link it first.`
      );
      return;
    }
    if (linked.status === ItemStatus.SOLD) {
      updatePendingTransaction(tx.id, {
        stage: 'finalized',
        linkedItemId: linked.id,
        finalizedAt: new Date().toISOString(),
      });
      refresh();
      setMessage(`“${linked.name}” was already sold — inbox entry closed.`);
      return;
    }
    onUpdate([applySaleTransactionToItem(linked, tx, todayISO())]);
    updatePendingTransaction(tx.id, {
      stage: 'finalized',
      linkedItemId: linked.id,
      finalizedAt: new Date().toISOString(),
      lastModifiedBy: 'manual',
    });
    refresh();
    setMessage(`Sold (final): ${linked.name} · €${formatEUR(tx.amount || 0)}`);
    onOpenItem?.(linked.id);
  };

  const cancelTransaction = (tx: PendingTransaction) => {
    updatePendingTransaction(tx.id, { stage: 'cancelled', lastModifiedBy: 'manual' });
    refresh();
    setError(null);
    setMessage(`Cancelled “${tx.title}” — open Ignored to restore`);
  };

  const restoreTransaction = (tx: PendingTransaction) => {
    updatePendingTransaction(tx.id, { stage: 'pending', lastModifiedBy: 'manual' });
    refresh();
    setError(null);
    setMessage(`Restored to Pending: ${tx.title}`);
  };

  const linkedItem = (entry: InboxEntry) =>
    entry.linkedItemId ? items.find((i) => i.id === entry.linkedItemId) : undefined;

  const suggested = getSuggestedPurchaseFetchRange(todayISO());
  const busy = receivingKey !== null || parsingKey !== null;

  const actionButtons = (entry: InboxEntry) => {
    if (entry.kind === 'ebay') {
      const p = entry.ebay!;
      if (p.disposition === 'skipped') {
        return (
          <button
            type="button"
            onClick={() => undoIgnore(p)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase"
          >
            <Undo2 size={12} /> Undo ignore
          </button>
        );
      }
      if (p.disposition !== 'pending') {
        const linked = linkedItem(entry);
        if (linked) {
          return (
            <button
              type="button"
              onClick={() => onOpenItem?.(linked.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-black uppercase"
            >
              Open in Active
            </button>
          );
        }
        return (
          <span className="text-[10px] font-black uppercase text-slate-400 px-2">{p.disposition}</span>
        );
      }
      const parsing = parsingKey === p.lineKey;
      const receiving = receivingKey === p.lineKey;
      const hasSpecs = purchaseHasParsedSpecs(p);
      return (
        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          <button
            type="button"
            onClick={() => void parseSpecs(p)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            {parsing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {parsing ? 'Parsing…' : hasSpecs ? 'Re-parse' : 'Parse specs'}
          </button>
          <button
            type="button"
            onClick={() => void confirmReceived(p)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            {receiving ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
            {receiving ? 'Adding…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => ignorePurchase(p)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 text-[10px] font-black uppercase disabled:opacity-50 hover:border-slate-300 hover:text-slate-700"
            title="Not for this business — hide from the inbox"
          >
            <EyeOff size={12} /> Ignore
          </button>
        </div>
      );
    }

    const tx = entry.transaction!;
    if (tx.stage === 'cancelled') {
      return (
        <button
          type="button"
          onClick={() => restoreTransaction(tx)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase"
        >
          <Undo2 size={12} /> Restore
        </button>
      );
    }
    if (tx.stage === 'finalized') {
      const linked = linkedItem(entry);
      return linked ? (
        <button
          type="button"
          onClick={() => onOpenItem?.(linked.id)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-black uppercase"
        >
          Open item
        </button>
      ) : (
        <span className="text-[10px] font-black uppercase text-slate-400 px-2">Finalized</span>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => advanceTransaction(tx)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase"
        >
          <PackageCheck size={12} /> {entry.actionLabel}
        </button>
        <button
          type="button"
          onClick={() => cancelTransaction(tx)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 text-[10px] font-black uppercase hover:border-slate-300 hover:text-slate-700"
          title="Deal fell through — move to Ignored"
        >
          <Ban size={12} /> Cancel
        </button>
      </div>
    );
  };

  /**
   * Nudges for deals that have been unresolved for 3+ days. Advisory only — they sit above
   * the list and never block an action.
   */
  const staleDeals = useMemo(() => findStaleDeals(transactions, purchases), [transactions, purchases]);
  const [staleDismissed, setStaleDismissed] = useState(false);

  const staleSection =
    staleDeals.length === 0 || staleDismissed ? null : (
      <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200/70">
          <AlertTriangle size={14} className="text-amber-700 shrink-0" />
          <p className="text-xs font-black uppercase tracking-wide text-amber-900 flex-1">
            {staleDeals.length} deal{staleDeals.length === 1 ? '' : 's'} need attention
          </p>
          <button
            type="button"
            onClick={() => setStaleDismissed(true)}
            className="text-[10px] font-black uppercase text-amber-700 hover:text-amber-900"
          >
            Hide
          </button>
        </div>
        <ul className="divide-y divide-amber-200/60 max-h-40 overflow-y-auto">
          {staleDeals.map((d) => (
            <li key={`${d.key}-${d.kind}`} className="flex items-center gap-2 px-3 py-1.5">
              <span className="shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-white text-amber-800 border-amber-300">
                {formatStaleKind(d.kind)}
              </span>
              <p className="text-[11px] font-semibold text-amber-950 flex-1 truncate" title={d.message}>
                {d.message}
              </p>
              {d.chatUrl && (
                <a
                  href={d.chatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-[10px] font-black uppercase hover:bg-amber-100"
                >
                  <MessageSquare size={10} /> Open
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    );

  const chrome = (
    <div className="space-y-1">
      {staleSection}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 min-h-[28px] items-center">
        {(['pending', 'awaiting', 'finalized', 'ignored', 'all'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              filter === id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {BUCKET_LABELS[id]} · {counts[id]}
          </button>
        ))}
        {unconfirmedNameCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyUnconfirmedNames((v) => !v)}
            title="Kleinanzeigen reveals the buyer's real name only after the shipping label is bought"
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              onlyUnconfirmedNames
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-amber-800 border-amber-300'
            }`}
          >
            <UserX size={11} /> Name pending · {unconfirmedNameCount}
          </button>
        )}
        <button
          type="button"
          onClick={() => void syncNew()}
          disabled={syncing || !tokenReady}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold disabled:opacity-50 ml-auto"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Sync eBay
        </button>
      </div>
      {syncProgress && <EbayToolProgressBar {...syncProgress} tone="indigo" />}
      {(error || message) && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
            error
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {error ? (
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          )}
          {error || message}
        </div>
      )}
      <p className="text-[10px] text-slate-400 truncate">
        eBay orders · Kleinanzeigen deals · buys and sells, until each one is final · eBay synced
        since <span className="font-bold text-slate-500">{suggested.from}</span>
      </p>
    </div>
  );

  const empty = (
    <div className="py-16 text-center opacity-40">
      <Inbox size={40} className="mx-auto mb-3 text-slate-300" />
      <p className="font-bold text-slate-400 text-sm">
        {allEntries.length === 0
          ? 'Inbox is empty — tap Sync eBay or add a Kleinanzeigen deal.'
          : searchTerm.trim()
            ? 'No matches found'
            : 'Nothing in this view.'}
      </p>
      <p className="text-xs text-slate-400 mt-1">Try clearing search or filters</p>
    </div>
  );

  /** eBay rows reuse the purchase preview; transactions get a lightweight stand-in. */
  const previewFor = (entry: InboxEntry): InventoryItem => {
    if (entry.kind === 'ebay') return purchaseToPreviewItem(entry.ebay!);
    const tx = entry.transaction!;
    return {
      id: `preview-${tx.id}`,
      name: tx.title,
      buyPrice: tx.direction === 'buy' ? tx.amount ?? 0 : 0,
      sellPrice: tx.direction === 'sell' ? tx.amount : undefined,
      buyDate: tx.date,
      category: tx.category || 'Misc',
      subCategory: tx.subCategory || '',
      status: ItemStatus.ORDERED,
      comment1: '',
      comment2: '',
      vendor: tx.counterparty,
      platformBought: tx.platform,
      buyPaymentType: tx.paymentType,
      source: tx.source,
      aiReviewStatus: tx.aiReviewStatus,
    };
  };

  const stageChip = (entry: InboxEntry) => (
    <span
      className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${
        entry.stage === 'pending'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : entry.stage === 'awaiting_confirmation'
            ? 'bg-sky-50 text-sky-900 border-sky-200'
            : entry.stage === 'likely_complete'
              ? 'bg-lime-50 text-lime-900 border-lime-200'
              : entry.stage === 'finalized'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-50 text-slate-500 border-slate-200'
      }`}
      title={entry.statusLabel}
    >
      {entry.statusLabel}
    </span>
  );

  const mobileList =
    rows.length === 0
      ? empty
      : rows.map((entry) => {
          if (entry.kind === 'transaction') {
            const tx = entry.transaction!;
            return (
              <article
                key={entry.key}
                className={`rounded-xl border bg-white px-2.5 py-2 space-y-1.5 ${
                  entry.aiReviewStatus === 'unreviewed'
                    ? 'border-violet-300 shadow-[inset_4px_0_0_0_#7c3aed]'
                    : 'border-slate-100'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 mt-0.5 p-1 rounded-lg ${
                      entry.direction === 'buy'
                        ? 'bg-sky-50 text-sky-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {entry.direction === 'buy' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-900 leading-tight line-clamp-1">
                      {entry.title}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500 truncate">
                      {formatPlatformShort(entry.platform)} · {formatDirection(entry.direction)}
                      {entry.counterparty ? ` · ${entry.counterparty}` : ''}
                      {entry.paymentType ? ` · ${entry.paymentType}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-slate-900 tabular-nums">
                    €{formatEUR(entry.amount || 0)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {stageChip(entry)}
                  {entry.escrowHeld && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-800 border-indigo-200">
                      <Lock size={9} /> Payout held
                    </span>
                  )}
                  {entry.softReminder && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                      <Clock size={9} /> Confirm?
                    </span>
                  )}
                  {entry.nameUnconfirmed && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-orange-50 text-orange-800 border-orange-200">
                      <UserX size={9} /> Name pending
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <SourceLinkIcons links={entry.sourceLinks} />
                  {actionButtons(entry)}
                </div>
                {tx.note && <p className="text-[10px] text-slate-400 truncate">{tx.note}</p>}
              </article>
            );
          }

          const p = entry.ebay!;
          const preview = previewFor(entry);
          const hasSpecs = purchaseHasParsedSpecs(p);
          const linked = linkedItem(entry);
          const received = p.disposition === 'inventory' && Boolean(linked || p.inventoryItemId);
          const isIgnored = p.disposition === 'skipped';
          return (
            <MobileStockCard
              key={entry.key}
              item={preview}
              actions={{
                onEdit: (it) => {
                  if (isIgnored) return;
                  if (received && linked) onOpenItem?.(linked.id);
                  else onOpenPurchaseDraft?.(it);
                },
                onSell: () => undefined,
                onPhotos: () => {
                  setMessage('Confirm received first — then add photos on Active.');
                },
              }}
              purchaseActions={{
                onParseSpecs: () => void parseSpecs(p),
                onConfirmReceived: () => void confirmReceived(p),
                onIgnore: () => ignorePurchase(p),
                onUndoIgnore: () => undoIgnore(p),
                parsing: parsingKey === p.lineKey,
                confirming: receivingKey === p.lineKey,
                hasParsedSpecs: hasSpecs,
                received,
                ignored: isIgnored,
                onOpenActive: () => {
                  if (linked) onOpenItem?.(linked.id);
                },
              }}
            />
          );
        });

  const desktopList = (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="overflow-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[860px]">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5 font-black">Item</th>
                  <th className="px-3 py-2.5 font-black">Platform · Side</th>
                  <th className="px-3 py-2.5 font-black">Counterparty</th>
                  <th className="px-3 py-2.5 font-black">Payment</th>
                  <th className="px-3 py-2.5 font-black">Status</th>
                  <th className="px-3 py-2.5 font-black text-right">Amount</th>
                  <th className="px-3 py-2.5 font-black">Date</th>
                  <th className="px-3 py-2.5 font-black text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const preview = previewFor(entry);
                  const linked = linkedItem(entry);
                  const hasSpecs = entry.kind === 'ebay' && purchaseHasParsedSpecs(entry.ebay!);
                  return (
                    <tr
                      key={entry.key}
                      className={`border-b border-slate-100 hover:bg-slate-50/80 align-middle cursor-pointer ${
                        entry.aiReviewStatus === 'unreviewed'
                          ? 'bg-violet-50/30 shadow-[inset_4px_0_0_0_#7c3aed]'
                          : ''
                      }`}
                      onClick={() => {
                        if (linked) onOpenItem?.(linked.id);
                        else if (entry.kind === 'ebay') onOpenPurchaseDraft?.(preview);
                      }}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ItemThumbnail
                            item={preview}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-100 shrink-0"
                            size={36}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate flex items-center gap-1.5">
                              <span className="truncate">{entry.title}</span>
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {entry.kind === 'ebay'
                                ? `${preview.subCategory || preview.category || 'eBay'}${
                                    entry.ebay?.orderId ? ` · order ${entry.ebay.orderId}` : ''
                                  }${hasSpecs ? ' · specs parsed' : ''}`
                                : entry.transaction?.note || entry.sourceContext || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                          {entry.direction === 'buy' ? (
                            <ArrowDownLeft size={12} className="text-sky-600" />
                          ) : (
                            <ArrowUpRight size={12} className="text-amber-600" />
                          )}
                          {formatPlatformShort(entry.platform)} · {formatDirection(entry.direction)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 truncate max-w-[10rem]">
                        {entry.counterparty || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {entry.paymentType || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {stageChip(entry)}
                          {entry.escrowHeld && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-800 border-indigo-200"
                              title="Kleinanzeigen holds the payout until receipt is confirmed"
                            >
                              <Lock size={9} /> Payout held
                            </span>
                          )}
                          {entry.softReminder && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200"
                              title="Settled a few days ago and still not confirmed — just a nudge"
                            >
                              <Clock size={9} /> Confirm?
                            </span>
                          )}
                          {entry.nameUnconfirmed && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-orange-50 text-orange-800 border-orange-200"
                              title="Real name appears in the chat only after the shipping label is bought — open the chat to check"
                            >
                              <UserX size={9} /> Name pending
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm font-black text-slate-900 text-right tabular-nums whitespace-nowrap">
                        €{formatEUR(entry.amount || 0)}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {entry.date || '—'}
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <PrimarySourceLinkButton links={entry.sourceLinks} />
                          {actionButtons(entry)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-slate-100 text-[11px] font-semibold text-slate-400">
            {rows.length} {rows.length === 1 ? 'deal' : 'deals'} · {BUCKET_LABELS[filter]}
          </div>
        </>
      )}
    </div>
  );

  return {
    rowCount: rows.length,
    /** Open work across both sources — used for the tab badge. */
    openCount: counts.pending + counts.awaiting,
    /** Deals unresolved for 3+ days — surfaced as a warning badge. */
    staleCount: staleDeals.length,
    chrome,
    mobileList,
    desktopList,
    refresh,
  };
}

/** Standalone wrapper (eBay tools etc.) — full panel with own shells. */
const InventoryPurchasesPanel: React.FC<UseInventoryPurchasesArgs> = (props) => {
  const { chrome, mobileList, desktopList } = useInventoryPurchases(props);
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-2">
      <div className="shrink-0 px-1.5 lg:px-0">{chrome}</div>
      <div
        className="lg:hidden flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y custom-scrollbar px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {mobileList}
      </div>
      <div className="hidden lg:flex flex-1 min-h-0 flex-col">{desktopList}</div>
    </div>
  );
};

export default InventoryPurchasesPanel;
