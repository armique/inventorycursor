import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  PlusCircle,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  X,
} from 'lucide-react';
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import {
  cancelPendingReminder,
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
  listingToSnapshotEntry,
  loadEbayListingSnapshot,
  loadEbayListingSnapshotHistory,
  recordEbayListingCheck,
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
import { filterAppearedListingsNotInInventory } from '../utils/ebayListingChangePlan';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import { ebayScreenshotSaleFields } from '../utils/ebayScreenshotSaleFields';
import { computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import type { ParsedEbayOrderScreenshot } from '../services/ebayOrderScreenshotAI';
import EbayOrderScreenshotInline from './EbayOrderScreenshotInline';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';
import EbayToolSearchInput from './EbayToolSearchInput';

interface SoldRowState {
  selected: boolean;
  confirmed: boolean;
  sellPrice: string;
  sellDate: string;
  ebayOrderId: string;
  ebayUsername: string;
  buyerName: string;
  feeAmount: number;
  ebayFeeEur: number | null;
  adFeeEur: number | null;
  amountReceivedNetEur: number | null;
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
    feeAmount: Number(match.item.feeAmount) || 0,
    ebayFeeEur: null,
    adFeeEur: null,
    amountReceivedNetEur: null,
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
  setAppeared: React.Dispatch<React.SetStateAction<EbayListingSnapshotEntry[]>>,
  setSnapshotMeta: React.Dispatch<
    React.SetStateAction<{ previousAt: string; disappeared: number; appeared: number } | null>
  >,
  setRowState: React.Dispatch<React.SetStateAction<Record<string, SoldRowState>>>,
  rowKey: (match: EbaySoldDetectionMatch) => string
): boolean {
  const pending = loadPendingReminder();
  if (!pending || pending.dismissed) return false;
  const appearedCount = pending.appearedCount ?? pending.appeared?.length ?? 0;
  if (pending.disappearedCount <= 0 && appearedCount <= 0) return false;

  const { matches: hydrated, unmatched, appeared } = hydrateSoldDetectionFromPending(items, pending);
  setMatches(hydrated);
  setUnmatched(unmatched);
  setAppeared(appeared);
  setSnapshotMeta({
    previousAt: pending.previousSnapshotAt || pending.detectedAt,
    disappeared: pending.disappearedCount,
    appeared: appearedCount,
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
  const [appearedListings, setAppearedListings] = useState<EbayListingSnapshotEntry[]>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<{
    previousAt: string;
    disappeared: number;
    appeared: number;
  } | null>(null);
  const [rowState, setRowState] = useState<Record<string, SoldRowState>>({});
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checkHistory, setCheckHistory] = useState<EbayListingSnapshotCheckRecord[]>(() =>
    loadEbayListingSnapshotHistory()
  );
  const [search, setSearch] = useState('');

  const rowKey = (match: EbaySoldDetectionMatch) => match.item.id;

  const previousSnapshot = loadEbayListingSnapshot();

  const refreshHistory = useCallback(() => {
    setCheckHistory(loadEbayListingSnapshotHistory());
  }, []);

  const applyDetectionResults = useCallback(
    (
      plan: ReturnType<typeof buildEbaySoldDetectionPlan>,
      disappeared: EbayListingSnapshotEntry[],
      appeared: EbayListingSnapshotEntry[],
      pendingCurrentEntries: EbayListingSnapshotEntry[],
      previousAt: string,
      checkId: string
    ) => {
      const pending = soldDetectionPlanToPending(
        plan,
        disappeared,
        appeared,
        pendingCurrentEntries,
        previousAt,
        checkId
      );
      savePendingReminder(pending);
      setMatches(plan.matches);
      setUnmatched(plan.unmatchedDisappeared);
      setAppearedListings(appeared);
      setSnapshotMeta({
        previousAt,
        disappeared: disappeared.length,
        appeared: appeared.length,
      });
      const initial: Record<string, SoldRowState> = {};
      for (const match of plan.matches) {
        initial[rowKey(match)] = defaultSoldRowState(match);
      }
      setRowState(initial);
    },
    []
  );

  const newOnEbayNotInInventory = useMemo(
    () => filterAppearedListingsNotInInventory(items, appearedListings),
    [items, appearedListings]
  );

  const visibleMatches = useMemo(
    () =>
      matches.filter((m) =>
        matchesEbayToolSearch(search, [
          m.item.name,
          m.item.ebaySku,
          m.item.ebayOrderId,
          m.lastKnownListing.title,
          m.lastKnownListing.sku,
          m.lastKnownListing.listingId,
          m.matchKind,
          m.warning,
        ])
      ),
    [matches, search]
  );

  const visibleUnmatched = useMemo(
    () =>
      unmatched.filter((l) =>
        matchesEbayToolSearch(search, [l.title, l.sku, l.listingId])
      ),
    [unmatched, search]
  );

  const visibleNewOnEbay = useMemo(
    () =>
      newOnEbayNotInInventory.filter((l) =>
        matchesEbayToolSearch(search, [l.title, l.sku, l.listingId])
      ),
    [newOnEbayNotInInventory, search]
  );

  const visibleCheckHistory = useMemo(
    () =>
      checkHistory.filter((record) =>
        matchesEbayToolSearch(search, [
          record.checkId,
          record.disappeared.map((l) => l.title).join(' '),
          record.appeared.map((l) => l.title).join(' '),
        ])
      ),
    [checkHistory, search]
  );

  const soldSearchTotal =
    matches.length + unmatched.length + newOnEbayNotInInventory.length + checkHistory.length;
  const soldSearchMatch =
    visibleMatches.length + visibleUnmatched.length + visibleNewOnEbay.length + visibleCheckHistory.length;

  useEffect(() => {
    const restored = applyPendingDetectionToState(
      items,
      setMatches,
      setUnmatched,
      setAppearedListings,
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
    setAppearedListings([]);
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
        recordEbayListingCheck(listings, getEbayUsername(), { commitBaseline: true });
        refreshHistory();
        setProgress({ label: 'Baseline saved', done: 4, total: 4 });
        setInfo(
          `Saved ${listings.length} eBay listing titles & IDs as today's baseline. Daily checks will compare against this snapshot.`
        );
        return;
      }

      setProgress({ label: 'Comparing to last snapshot…', done: 2, total: 4 });
      const check = recordEbayListingCheck(listings, getEbayUsername());
      refreshHistory();

      if (!check.disappeared.length && !check.appeared.length) {
        clearPendingReminder();
        setProgress({ label: 'No listing changes', done: 4, total: 4 });
        setInfo(
          `No changes since ${new Date(check.previous!.meta.capturedAt).toLocaleString()} (${listings.length} listings, same as last snapshot).`
        );
        return;
      }

      setProgress({
        label: 'Matching ended listings to inventory…',
        done: 3,
        total: 4,
        detail: `${check.disappeared.length} ended · ${check.appeared.length} new`,
      });
      const plan = buildEbaySoldDetectionPlan(items, check.disappeared);
      setProgress({
        label: 'Check complete',
        done: 4,
        total: 4,
        detail: `${plan.matches.length} likely sale${plan.matches.length === 1 ? '' : 's'}`,
      });

      applyDetectionResults(
        plan,
        check.disappeared,
        check.checkRecord!.appeared,
        check.currentEntries,
        check.previous!.meta.capturedAt,
        check.checkRecord!.checkId
      );

      if (!check.baselineCommitted) {
        setInfo(
          `Found changes vs saved eBay snapshot (${check.previous!.meta.count} → ${listings.length}). Review below — baseline updates when you dismiss or mark sold.`
        );
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to check eBay listings.');
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
        const { disappeared, appeared } = diffSnapshotEntriesToLive(record.previousEntries, listings);
        const plan = buildEbaySoldDetectionPlan(items, disappeared);
        const checkedAt = new Date().toISOString();
        const currentEntries = listings.map((l) => listingToSnapshotEntry(l, checkedAt));
        const appearedEntries = appeared.map((l) => listingToSnapshotEntry(l, checkedAt));

        applyDetectionResults(
          plan,
          disappeared,
          appearedEntries,
          currentEntries,
          record.previousCapturedAt || record.checkedAt,
          record.checkId
        );

        setProgress({ label: 'Comparison complete', done: 3, total: 3 });
        setInfo(
          `Compared history baseline (${record.previousCount} listings) to ${listings.length} live — ${disappeared.length} ended, ${appeared.length} new.`
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
      const money = ebayScreenshotSaleFields(data);
      const next: SoldRowState = { ...row };
      if (data.ebayOrderId) next.ebayOrderId = data.ebayOrderId;
      if (data.ebayUsername) next.ebayUsername = data.ebayUsername;
      if (data.buyerFullName) next.buyerName = data.buyerFullName;
      if (money.soldPriceExShippingEur != null) {
        next.sellPrice = formatEUR(money.soldPriceExShippingEur);
      }
      next.feeAmount = money.totalFeesEur;
      next.ebayFeeEur = money.ebayFeeEur;
      next.adFeeEur = money.adFeeEur;
      next.amountReceivedNetEur = money.amountReceivedNetEur;
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
    setAppearedListings([]);
    setSnapshotMeta(null);
    setRowState({});
    setInfo('Changes accepted — eBay snapshot baseline updated to the latest live store.');
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
          hasFee: row.feeAmount > 0,
          feeAmount: row.feeAmount > 0 ? row.feeAmount : 0,
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
        setAppearedListings([]);
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
        cancelPendingReminder();
        setProgress({ label: 'Baseline reset', done: 2, total: 2 });
        setInfo(`Baseline reset — ${listings.length} active eBay listings saved (titles & IDs).`);
        setMatches([]);
        setUnmatched([]);
        setAppearedListings([]);
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
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-indigo-800">Prefer Sales sync</p>
          <p className="text-[11px] text-indigo-900/90 mt-0.5 max-w-xl">
            Order-based matching on the <strong>Sales sync</strong> tab is more reliable than listing snapshots —
            it uses your actual eBay orders (buyer, payout, order ID) and catches sales even when titles change.
          </p>
        </div>
        <Link
          to="/panel/ebay?tab=sales"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wide hover:bg-indigo-800"
        >
          Open sales sync
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-black text-slate-900">Daily eBay listing change detection</h2>
        <p className="text-xs text-slate-600">
          The first check saves every active eBay listing <strong>title, ID, SKU, and price</strong> as
          your baseline. Each later check compares the live store to that saved snapshot only — never
          guesses from random inventory items.
        </p>
        <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-4">
          <li>
            <strong className="text-slate-700">Removed from eBay</strong> → match the saved listing title
            to inventory and suggest marking sold
          </li>
          <li>
            <strong className="text-slate-700">New on eBay</strong> → suggest adding to inventory via
            Import missing
          </li>
          <li>Baseline updates after you dismiss or mark sold (pending changes stay visible until then)</li>
        </ul>
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
            {loading ? 'Checking…' : 'Check for changes'}
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

      {snapshotMeta && (snapshotMeta.disappeared > 0 || snapshotMeta.appeared > 0) && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3 flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold text-rose-900 flex-1 min-w-[200px]">
            Changes since {new Date(snapshotMeta.previousAt).toLocaleString()}
            {snapshotMeta.disappeared > 0 &&
              ` · ${snapshotMeta.disappeared} removed from eBay`}
            {snapshotMeta.appeared > 0 && ` · ${snapshotMeta.appeared} new on eBay`}
            {snapshotMeta.disappeared > 0 &&
              (matches.length > 0
                ? ` · ${matches.length} inventory match${matches.length === 1 ? '' : 'es'}`
                : ' · no automatic inventory matches for removed listings')}
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

      {soldSearchTotal > 0 && (
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search item, listing title, SKU, order ID…"
          matchCount={soldSearchMatch}
          totalCount={soldSearchTotal}
        />
      )}

      <div className="space-y-3">
        {visibleMatches.length === 0 && search.trim() && matches.length > 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No sold-detection matches for your search.</p>
        ) : null}
        {visibleMatches.map((match) => {
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
                      Sold €
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.sellPrice}
                        onChange={(e) => updateRow(key, { sellPrice: e.target.value })}
                        placeholder={defaultSellPriceForDetection(match.item, listing) || '0,00'}
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400"
                        title="Item sold price excluding buyer shipping"
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
                    {(row.feeAmount > 0 ||
                      row.amountReceivedNetEur != null ||
                      row.ebayFeeEur != null ||
                      row.adFeeEur != null) && (
                      <div className="w-full flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-slate-500">
                        {row.ebayFeeEur != null && <span>Gebühr €{formatEUR(row.ebayFeeEur)}</span>}
                        {row.adFeeEur != null && <span>Ads €{formatEUR(row.adFeeEur)}</span>}
                        {row.feeAmount > 0 && <span>Fees €{formatEUR(row.feeAmount)}</span>}
                        {row.amountReceivedNetEur != null && (
                          <span className="text-emerald-700">
                            Auszahlung €{formatEUR(row.amountReceivedNetEur)}
                          </span>
                        )}
                      </div>
                    )}
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

      {visibleNewOnEbay.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
          <p className="text-xs font-black uppercase text-emerald-800">
            {visibleNewOnEbay.length} new on eBay — not in inventory yet
            {search.trim() ? ' (filtered)' : ''}
          </p>
          <p className="text-[11px] text-emerald-900/80">
            These listings appeared in your eBay store since the last saved snapshot and do not match any
            in-stock inventory item. Add them via Import missing.
          </p>
          <ul className="text-xs text-emerald-900 space-y-2 max-h-48 overflow-y-auto">
            {visibleNewOnEbay.map((l) => (
              <li key={l.listingId} className="rounded-lg bg-white/70 border border-emerald-100 px-3 py-2">
                <p className="font-bold line-clamp-2">{l.title}</p>
                {l.price != null && (
                  <p className="text-[10px] text-emerald-800/80 mt-0.5">€{formatEUR(l.price)}</p>
                )}
              </li>
            ))}
          </ul>
          <Link
            to="/panel/ebay-store-pull?tab=import"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700"
          >
            <PlusCircle size={14} />
            Open Import missing
          </Link>
        </div>
      )}

      {visibleUnmatched.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <p className="text-xs font-black uppercase text-amber-800">
            {visibleUnmatched.length} removed eBay listing{visibleUnmatched.length === 1 ? '' : 's'} — no inventory match
            {search.trim() ? ' (filtered)' : ''}
          </p>
          <p className="text-[11px] text-amber-900/80">
            These titles were saved in your eBay snapshot and left the store, but no in-stock inventory
            item matched automatically. Mark the correct item sold manually, or link it first in Sync.
          </p>
          <ul className="text-xs text-amber-900 space-y-2 max-h-48 overflow-y-auto">
            {visibleUnmatched.map((l) => (
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
              visibleCheckHistory.map((record) => (
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
