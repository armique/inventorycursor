import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Link2,
  Loader2,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  X,
} from 'lucide-react';
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import {
  clearPendingReminder,
  dismissPendingReminder,
  hydrateSoldDetectionFromPending,
  loadPendingReminder,
  savePendingReminder,
  soldDetectionPlanToPending,
} from '../services/ebayListingReminder';
import { fetchMyEbayListings, getEbayUsername } from '../services/ebayService';
import {
  diffSnapshotEntriesToLive,
  loadEbayListingSnapshot,
  loadEbayListingSnapshotHistory,
  recordEbayListingCheck,
  recordInventoryReconciliationCheck,
  restoreBaselineFromHistory,
  saveEbayListingSnapshot,
  type EbayListingSnapshotCheckRecord,
  type EbayListingSnapshotEntry,
} from '../services/ebayListingSnapshot';
import {
  buildEbaySoldDetectionPlan,
  defaultSellPriceForDetection,
  type EbaySoldDetectionMatch,
} from '../utils/ebaySoldDetectionPlan';
import { buildInventoryEbayReconciliation } from '../utils/ebayInventoryReconciliation';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import type { ParsedEbayOrderScreenshot } from '../services/ebayOrderScreenshotAI';
import EbayOrderScreenshotInline from './EbayOrderScreenshotInline';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';

interface SoldRowState {
  selected: boolean;
  confirmed: boolean;
  sellPrice: string;
  sellDate: string;
  ebayOrderId: string;
  ebayUsername: string;
  buyerName: string;
}

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => void | Promise<void>;
}

function defaultSoldRowState(match: EbaySoldDetectionMatch): SoldRowState {
  return {
    selected: true,
    confirmed: false,
    sellPrice: defaultSellPriceForDetection(match.item, match.lastKnownListing),
    sellDate: new Date().toISOString().split('T')[0],
    ebayOrderId: '',
    ebayUsername: '',
    buyerName: '',
  };
}

function matchKindLabel(kind: EbaySoldDetectionMatch['matchKind']): string {
  if (kind === 'listing_id') return 'Linked listing';
  if (kind === 'sku') return 'SKU match';
  return 'Title match';
}

function applyPendingDetectionToState(
  items: InventoryItem[],
  setMatches: React.Dispatch<React.SetStateAction<EbaySoldDetectionMatch[]>>,
  setUnmatched: React.Dispatch<React.SetStateAction<EbayListingSnapshotEntry[]>>,
  setSnapshotMeta: React.Dispatch<
    React.SetStateAction<{ previousAt: string; disappeared: number } | null>
  >,
  setRowState: React.Dispatch<React.SetStateAction<Record<string, SoldRowState>>>,
  rowKey: (match: EbaySoldDetectionMatch) => string
): boolean {
  const pending = loadPendingReminder();
  if (!pending || pending.dismissed || pending.disappearedCount <= 0) return false;

  const { matches: hydrated, unmatched } = hydrateSoldDetectionFromPending(items, pending);
  setMatches(hydrated);
  setUnmatched(unmatched);
  setSnapshotMeta({
    previousAt: pending.previousSnapshotAt || pending.detectedAt,
    disappeared: pending.disappearedCount,
  });

  const initial: Record<string, SoldRowState> = {};
  for (const match of hydrated) {
    initial[rowKey(match)] = defaultSoldRowState(match);
  }
  setRowState(initial);
  return true;
}

const EbayStorePullSoldTab: React.FC<Props> = ({ items, taxMode, onUpdate, onPublishCatalog }) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<EbaySoldDetectionMatch[]>([]);
  const [unmatched, setUnmatched] = useState<EbayListingSnapshotEntry[]>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<{ previousAt: string; disappeared: number } | null>(null);
  const [rowState, setRowState] = useState<Record<string, SoldRowState>>({});
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checkHistory, setCheckHistory] = useState<EbayListingSnapshotCheckRecord[]>(() =>
    loadEbayListingSnapshotHistory()
  );

  const rowKey = (match: EbaySoldDetectionMatch) => match.item.id;

  const previousSnapshot = loadEbayListingSnapshot();

  const refreshHistory = useCallback(() => {
    setCheckHistory(loadEbayListingSnapshotHistory());
  }, []);

  const applyDetectionResults = useCallback(
    (
      plan: ReturnType<typeof buildEbaySoldDetectionPlan>,
      disappeared: EbayListingSnapshotEntry[],
      previousAt: string,
      checkId: string
    ) => {
      const pending = soldDetectionPlanToPending(plan, disappeared, previousAt, checkId);
      savePendingReminder(pending);
      setMatches(plan.matches);
      setUnmatched(plan.unmatchedDisappeared);
      setSnapshotMeta({
        previousAt,
        disappeared: disappeared.length,
      });
      const initial: Record<string, SoldRowState> = {};
      for (const match of plan.matches) {
        initial[rowKey(match)] = defaultSoldRowState(match);
      }
      setRowState(initial);
    },
    []
  );

  useEffect(() => {
    const restored = applyPendingDetectionToState(
      items,
      setMatches,
      setUnmatched,
      setSnapshotMeta,
      setRowState,
      rowKey
    );
    if (restored) {
      setInfo('Restored the last detected eBay listing changes — review matches below.');
    }
  }, [items]);

  const checkForSold = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setApplyMessage(null);
    setMatches([]);
    setUnmatched([]);
    setSnapshotMeta(null);
    setRowState({});
    setProgress({ label: 'Fetching active eBay listings…', done: 0, total: 4 });

    try {
      const listings = await fetchMyEbayListings();
      setProgress({
        label: 'Fetching active eBay listings…',
        done: 1,
        total: 4,
        detail: `${listings.length} listing${listings.length === 1 ? '' : 's'}`,
      });

      if (!loadEbayListingSnapshot()) {
        setProgress({ label: 'Saving baseline snapshot…', done: 3, total: 4 });
        recordEbayListingCheck(listings, getEbayUsername());
        refreshHistory();
        setProgress({ label: 'Baseline saved', done: 4, total: 4 });
        setInfo(
          `Saved baseline snapshot of ${listings.length} active listing${listings.length === 1 ? '' : 's'}. Run this check again after listings disappear to detect likely sales.`
        );
        return;
      }

      setProgress({ label: 'Comparing to last snapshot…', done: 2, total: 4 });
      const check = recordEbayListingCheck(listings, getEbayUsername());
      refreshHistory();

      if (!check.disappeared.length) {
        clearPendingReminder();
        setProgress({ label: 'No listing changes', done: 4, total: 4 });
        setInfo(
          `No listings disappeared since ${new Date(check.previous!.meta.capturedAt).toLocaleString()}. Snapshot updated (${listings.length} active).`
        );
        return;
      }

      setProgress({
        label: 'Matching ended listings to inventory…',
        done: 3,
        total: 4,
        detail: `${check.disappeared.length} ended`,
      });
      const plan = buildEbaySoldDetectionPlan(items, check.disappeared);
      setProgress({
        label: 'Check complete',
        done: 4,
        total: 4,
        detail: `${plan.matches.length} likely sale${plan.matches.length === 1 ? '' : 's'}`,
      });

      const pending = soldDetectionPlanToPending(
        plan,
        check.disappeared,
        check.previous!.meta.capturedAt,
        check.checkRecord!.checkId
      );
      savePendingReminder(pending);

      applyDetectionResults(
        plan,
        check.disappeared,
        check.previous!.meta.capturedAt,
        check.checkRecord!.checkId
      );
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to check eBay listings.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 900);
    }
  }, [items, refreshHistory, applyDetectionResults]);

  const reconcileWithInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setApplyMessage(null);
    setMatches([]);
    setUnmatched([]);
    setSnapshotMeta(null);
    setRowState({});
    setProgress({ label: 'Fetching live eBay listings…', done: 0, total: 3 });

    try {
      const listings = await fetchMyEbayListings();
      setProgress({
        label: 'Fetching live eBay listings…',
        done: 1,
        total: 3,
        detail: `${listings.length} active`,
      });

      setProgress({ label: 'Matching inventory to live store…', done: 2, total: 3 });
      const recon = buildInventoryEbayReconciliation(items, listings);

      const checkRecord = recordInventoryReconciliationCheck(
        {
          previousEntries: recon.previousEntries,
          currentEntries: recon.currentEntries,
          disappeared: recon.disappeared,
          previousCount: recon.previousCount,
          currentCount: recon.currentCount,
          planMatches: recon.plan.matches.length,
        },
        getEbayUsername()
      );
      refreshHistory();

      setProgress({
        label: 'Reconciliation complete',
        done: 3,
        total: 3,
        detail:
          recon.disappeared.length > 0
            ? `${recon.previousCount} → ${recon.currentCount}`
            : 'no gaps',
      });

      if (!recon.disappeared.length) {
        setInfo(
          `Live store has ${listings.length} listings. Every inventory item with an eBay link still appears active. If you expected sales, link items in Sync first (ebayListingId / storefront price).`
        );
        return;
      }

      applyDetectionResults(recon.plan, recon.disappeared, checkRecord.checkedAt, checkRecord.checkId);
      setInfo(
        `Reconstructed store change ${recon.previousCount} → ${recon.currentCount}: ${recon.disappeared.length} listing${recon.disappeared.length === 1 ? '' : 's'} ended and matched to inventory. History log saved.`
      );
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to reconcile with inventory.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 900);
    }
  }, [items, refreshHistory, applyDetectionResults]);

  const replayHistoryComparison = useCallback(
    async (record: EbayListingSnapshotCheckRecord) => {
      if (!record.previousEntries?.length) {
        setError('This history entry has no saved baseline to compare.');
        return;
      }

      setLoading(true);
      setError(null);
      setInfo(null);
      setApplyMessage(null);
      setProgress({ label: 'Fetching live eBay listings…', done: 0, total: 3 });

      try {
        const listings = await fetchMyEbayListings();
        setProgress({ label: 'Comparing to history baseline…', done: 2, total: 3 });
        const { disappeared } = diffSnapshotEntriesToLive(record.previousEntries, listings);
        const plan = buildEbaySoldDetectionPlan(items, disappeared);

        applyDetectionResults(
          plan,
          disappeared,
          record.previousCapturedAt || record.checkedAt,
          record.checkId
        );

        setProgress({ label: 'Comparison complete', done: 3, total: 3 });
        setInfo(
          `Compared history baseline (${record.previousCount} listings) to ${listings.length} live — ${disappeared.length} ended.`
        );
      } catch (e: unknown) {
        setError((e as Error)?.message || 'Failed to replay history comparison.');
      } finally {
        setLoading(false);
        setTimeout(() => setProgress(null), 900);
      }
    },
    [items, applyDetectionResults]
  );

  const handleRestoreBaseline = (checkId: string) => {
    const ok = restoreBaselineFromHistory(checkId);
    if (ok) {
      setInfo('Baseline restored from history. Run “Check for sold listings” to compare against live eBay.');
      setError(null);
    } else {
      setError('Could not restore baseline — this history entry has no full snapshot saved.');
    }
  };

  const updateRow = (key: string, patch: Partial<SoldRowState>) => {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const applyParsedOrder = (key: string, data: ParsedEbayOrderScreenshot) => {
    setRowState((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const next: SoldRowState = { ...row };
      if (data.ebayOrderId) next.ebayOrderId = data.ebayOrderId;
      if (data.ebayUsername) next.ebayUsername = data.ebayUsername;
      if (data.buyerFullName) next.buyerName = data.buyerFullName;
      if (data.amountReceivedNetEur != null && Number.isFinite(data.amountReceivedNetEur)) {
        next.sellPrice = formatEUR(data.amountReceivedNetEur);
      }
      if (data.saleDate) next.sellDate = data.saleDate;
      return { ...prev, [key]: next };
    });
  };

  const readyToApply = useMemo(() => {
    return matches.filter((m) => {
      const row = rowState[rowKey(m)];
      return row?.selected && row.confirmed;
    });
  }, [matches, rowState]);

  const dismissDetection = () => {
    dismissPendingReminder();
    setMatches([]);
    setUnmatched([]);
    setSnapshotMeta(null);
    setRowState({});
    setInfo('Detection dismissed. Snapshot history is still available below.');
  };

  const applyConfirmed = async () => {
    if (!readyToApply.length) return;
    setApplying(true);
    setError(null);
    const total = readyToApply.length;
    setProgress({ label: 'Marking items as sold…', done: 0, total });
    try {
      const updates: InventoryItem[] = [];

      for (let i = 0; i < readyToApply.length; i++) {
        const match = readyToApply[i];
        const key = rowKey(match);
        const row = rowState[key];
        if (!row) continue;

        setProgress({
          label: 'Marking items as sold…',
          done: i,
          total,
          detail: match.item.name,
        });

        const sellParsed = parseLocaleNumber(row.sellPrice);
        const sellPrice =
          row.sellPrice.trim() === '' || !Number.isFinite(sellParsed) ? undefined : sellParsed;

        const draft: InventoryItem = {
          ...match.item,
          status: ItemStatus.SOLD,
          sellPrice,
          sellDate: row.sellDate || new Date().toISOString().split('T')[0],
          platformSold: 'ebay.de',
          paymentType: 'ebay.de',
          listedOnEbay: true,
          storeVisible: false,
          ebayOrderId: row.ebayOrderId.trim() || match.item.ebayOrderId,
          ebayUsername: row.ebayUsername.trim() || match.item.ebayUsername,
          customer: row.buyerName.trim()
            ? { ...(match.item.customer || { name: '', address: '' }), name: row.buyerName.trim() }
            : match.item.customer,
          comment2: [
            match.item.comment2,
            `Marked sold via eBay Store Pull — listing ${match.lastKnownListing.listingId} ended.`,
          ]
            .filter(Boolean)
            .join('\n'),
        };

        draft.profit =
          sellPrice != null
            ? computeItemProfitBeforeOverhead(
                { ...draft, sellPrice, feeAmount: draft.feeAmount || 0 },
                taxMode
              )
            : undefined;

        updates.push(draft);
        setProgress({
          label: 'Marking items as sold…',
          done: i + 1,
          total,
          detail: match.item.name,
        });
      }

      if (updates.length) {
        onUpdate(updates);
        void onPublishCatalog?.();
        clearPendingReminder();
        setApplyMessage(`Marked ${updates.length} item${updates.length === 1 ? '' : 's'} as sold.`);
        setMatches([]);
        setUnmatched([]);
        setRowState({});
        setSnapshotMeta(null);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to mark items as sold.');
    } finally {
      setApplying(false);
      setTimeout(() => setProgress(null), 900);
    }
  };

  const resetBaseline = () => {
    void (async () => {
      setLoading(true);
      setError(null);
      setProgress({ label: 'Fetching active eBay listings…', done: 0, total: 2 });
      try {
        const listings = await fetchMyEbayListings();
        setProgress({
          label: 'Saving baseline snapshot…',
          done: 1,
          total: 2,
          detail: `${listings.length} listing${listings.length === 1 ? '' : 's'}`,
        });
        saveEbayListingSnapshot(listings, getEbayUsername());
        clearPendingReminder();
        setProgress({ label: 'Baseline reset', done: 2, total: 2 });
        setInfo(`Baseline reset — ${listings.length} active listings saved.`);
        setMatches([]);
        setUnmatched([]);
        setSnapshotMeta(null);
        setRowState({});
      } catch (e: unknown) {
        setError((e as Error)?.message || 'Could not reset baseline.');
      } finally {
        setLoading(false);
        setTimeout(() => setProgress(null), 900);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-black text-slate-900">Detect likely sales (ended listings)</h2>
        <p className="text-xs text-slate-600">
          Compares your current active eBay listings to the last saved snapshot. Listings that
          disappeared are matched to in-stock inventory and suggested as sold — with the same sell-price
          and order-screenshot parsing as the inventory sale dialog. Every check is saved to snapshot
          history so you can review past diffs even after the baseline updates.
        </p>
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
          <strong className="text-slate-700">Missing an old 42→40 diff?</strong> Use{' '}
          <span className="font-bold text-violet-700">Reconcile with inventory</span> — it fetches your{' '}
          {previousSnapshot ? `${previousSnapshot.meta.count} saved / ` : ''}
          live listings, rebuilds what left the store from inventory links (e.g. RAM bundle + laptop), and
          logs the change in history.
        </p>
        {previousSnapshot && (
          <p className="text-[11px] text-slate-500">
            Last snapshot: {new Date(previousSnapshot.meta.capturedAt).toLocaleString()} ·{' '}
            {previousSnapshot.meta.count} listings
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void checkForSold()}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase tracking-widest hover:bg-rose-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <TrendingDown size={16} />}
            {loading ? 'Checking…' : 'Check for sold listings'}
          </button>
          <button
            type="button"
            onClick={() => void reconcileWithInventory()}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
            Reconcile with inventory
          </button>
          <button
            type="button"
            onClick={resetBaseline}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Reset baseline
          </button>
        </div>
        {progress && <EbayToolProgressBar {...progress} tone="rose" />}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {info && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <ShoppingBag size={18} className="shrink-0 mt-0.5" />
          {info}
        </div>
      )}

      {applyMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          {applyMessage}
        </div>
      )}

      {snapshotMeta && snapshotMeta.disappeared > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3 flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold text-rose-900 flex-1 min-w-[200px]">
            {snapshotMeta.disappeared} listing{snapshotMeta.disappeared === 1 ? '' : 's'} ended since{' '}
            {new Date(snapshotMeta.previousAt).toLocaleString()}
            {matches.length > 0
              ? ` · ${matches.length} likely sale${matches.length === 1 ? '' : 's'}`
              : ' · no automatic inventory matches'}
          </p>
          {matches.length > 0 && (
            <button
              type="button"
              disabled={applying || readyToApply.length === 0}
              onClick={() => void applyConfirmed()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Mark {readyToApply.length} confirmed as sold
            </button>
          )}
          <button
            type="button"
            onClick={dismissDetection}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-white text-[10px] font-black uppercase text-rose-700 hover:bg-rose-50"
          >
            <X size={12} />
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        {matches.map((match) => {
          const key = rowKey(match);
          const row = rowState[key] ?? defaultSoldRowState(match);
          const listing = match.lastKnownListing;

          return (
            <div
              key={key}
              className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition-all ${
                row.confirmed ? 'border-rose-200' : row.selected ? 'border-slate-300' : 'border-slate-200 opacity-70'
              }`}
            >
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-start">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateRow(key, { selected: e.target.checked })}
                    className="mt-1 rounded border-slate-300"
                  />
                  {listing.thumbnail ? (
                    <img
                      src={listing.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover border border-slate-100 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-100 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase text-slate-400">Inventory item</p>
                    <p className="text-sm font-bold text-slate-900">{match.item.name}</p>
                    {(match.item.isBundle || match.item.isPC) && (
                      <span className="inline-block mt-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100">
                        {match.item.isPC ? 'PC build' : 'Bundle'}
                      </span>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                      Ended listing: {listing.title}
                      {listing.price != null ? ` · was €${formatEUR(listing.price)}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                        {matchKindLabel(match.matchKind)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRow(key, { confirmed: !row.confirmed })}
                    className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide border ${
                      row.confirmed
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                    }`}
                  >
                    {row.confirmed ? 'Confirmed sold' : 'Mark as sold'}
                  </button>
                </div>

                {match.warning && (
                  <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {match.warning}
                  </p>
                )}

                {row.confirmed && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 border-t border-slate-100">
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                      Sell €
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.sellPrice}
                        onChange={(e) => updateRow(key, { sellPrice: e.target.value })}
                        placeholder={defaultSellPriceForDetection(match.item, listing) || '0,00'}
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                      Date
                      <input
                        type="date"
                        value={row.sellDate}
                        onChange={(e) => updateRow(key, { sellDate: e.target.value })}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold outline-none focus:border-emerald-400"
                      />
                    </label>
                    <EbayOrderScreenshotInline
                      onParsed={(data) => applyParsedOrder(key, data)}
                      className="flex-1 min-w-[280px]"
                    />
                    {(row.ebayOrderId || row.ebayUsername || row.buyerName) && (
                      <div className="w-full flex flex-wrap gap-2 text-[10px] text-slate-600">
                        {row.ebayOrderId && (
                          <span className="font-bold">
                            Order #{row.ebayOrderId}
                          </span>
                        )}
                        {row.ebayUsername && <span>@{row.ebayUsername}</span>}
                        {row.buyerName && <span>{row.buyerName}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unmatched.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <p className="text-xs font-black uppercase text-amber-800">
            {unmatched.length} ended listing{unmatched.length === 1 ? '' : 's'} with no inventory match
          </p>
          <p className="text-[11px] text-amber-900/80">
            These listings left your eBay store but were not linked to an in-stock item automatically.
            Mark the matching inventory item sold manually, or link it via eBay Store Pull → Sync first.
          </p>
          <ul className="text-xs text-amber-900 space-y-2 max-h-48 overflow-y-auto">
            {unmatched.map((l) => (
              <li key={l.listingId} className="rounded-lg bg-white/70 border border-amber-100 px-3 py-2">
                <p className="font-bold line-clamp-2">{l.title}</p>
                {l.price != null && (
                  <p className="text-[10px] text-amber-800/80 mt-0.5">Was €{formatEUR(l.price)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
        >
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-slate-700">
            <History size={14} />
            Snapshot check history ({checkHistory.length})
          </span>
          {historyOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {historyOpen && (
          <div className="border-t border-slate-100 max-h-80 overflow-y-auto divide-y divide-slate-50">
            {checkHistory.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-500 text-center">
                No checks recorded yet. Run a sold check to start building history.
              </p>
            ) : (
              checkHistory.map((record) => (
                <div key={record.checkId} className="px-4 py-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-bold text-slate-900">
                      {new Date(record.checkedAt).toLocaleString()}
                    </span>
                    <span className="text-slate-500">
                      {record.previousCount} → {record.currentCount} listings
                    </span>
                    {record.checkKind === 'reconcile' && (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                        Reconcile
                      </span>
                    )}
                    {record.disappearedCount > 0 && (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                        −{record.disappearedCount} ended
                      </span>
                    )}
                    {record.appearedCount > 0 && (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                        +{record.appearedCount} new
                      </span>
                    )}
                  </div>
                  {record.disappeared.length > 0 && (
                    <ul className="text-[10px] text-slate-600 space-y-0.5 pl-1">
                      {record.disappeared.map((l) => (
                        <li key={l.listingId} className="line-clamp-1">
                          Ended: {l.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {record.previousEntries && record.previousEntries.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => void replayHistoryComparison(record)}
                          disabled={loading || applying}
                          className="text-[9px] font-black uppercase px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Compare again
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRestoreBaseline(record.checkId)}
                          disabled={loading || applying}
                          className="text-[9px] font-black uppercase px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Restore {record.previousCount}-item baseline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EbayStorePullSoldTab;
