import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { hasEbayToken } from '../services/ebayService';
import { isCloudEnabled } from '../services/firebaseService';
import { backfillEbayOrders, type BackfillProgress } from '../services/ebayOrderBackfill';
import { parseEbayOrderCsv, type EbayOrderCsvParseResult } from '../services/ebayOrderCsvImport';
import {
  addCsvImportMeta,
  clearEbayOrderIndexEverywhere,
  getOrderIndexStats,
  getSuggestedBackfillRange,
  loadEbayOrderIndex,
  pullOrderIndexFromCloud,
  pushOrderIndexToCloud,
  upsertEbayOrders,
} from '../services/ebayOrderIndex';
import EbayToolProgressBar from './EbayToolProgressBar';
import EbaySalesSyncPanel from './EbaySalesSyncPanel';

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
}

const DEFAULT_FROM = '2025-02-01';

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

const EbayStorePullOrdersTab: React.FC<Props> = ({ items, taxMode, onUpdate }) => {
  const navigate = useNavigate();
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedFrom, setAdvancedFrom] = useState(DEFAULT_FROM);
  const [advancedTo, setAdvancedTo] = useState(todayISO());

  const [csvParsing, setCsvParsing] = useState(false);
  const [csvResult, setCsvResult] = useState<EbayOrderCsvParseResult | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvImportMessage, setCsvImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showCacheSetup, setShowCacheSetup] = useState(() => getOrderIndexStats().count === 0);
  const [statsVersion, setStatsVersion] = useState(0);

  const refreshStats = () => setStatsVersion((v) => v + 1);
  const { stats, meta } = React.useMemo(() => {
    return { stats: getOrderIndexStats(), meta: loadEbayOrderIndex().meta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsVersion]);

  const cloudReady = isCloudEnabled();
  const [cloudPulling, setCloudPulling] = useState(false);
  const [cloudPullMessage, setCloudPullMessage] = useState<string | null>(null);
  const cloudPulledOnceRef = useRef(false);

  // On first open, re-hydrate the local cache from the cloud mirror — covers a cleared
  // browser or a brand-new PC where localStorage never had this data to begin with.
  useEffect(() => {
    if (!cloudReady || cloudPulledOnceRef.current) return;
    cloudPulledOnceRef.current = true;
    setCloudPulling(true);
    void pullOrderIndexFromCloud().then((result) => {
      setCloudPulling(false);
      if (result.error) {
        setCloudPullMessage(`Cloud pull failed: ${result.error}`);
      } else if (!result.skipped && result.pulled > 0) {
        setCloudPullMessage(`Restored ${result.pulled} order(s) from your account's saved history.`);
        setStatsVersion((v) => v + 1);
      }
    });
  }, [cloudReady]);

  const suggested = useMemo(
    () => getSuggestedBackfillRange(DEFAULT_FROM, todayISO()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statsVersion]
  );
  const alreadyUpToDate = suggested.isIncremental && suggested.from >= suggested.to;

  const [tokenReady, setTokenReady] = useState(() => hasEbayToken());

  useEffect(() => {
    const refresh = () => setTokenReady(hasEbayToken());
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('ebay-config-updated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ebay-config-updated', refresh);
    };
  }, []);

  const soldOnEbayMissingLink = items.filter(
    (i) =>
      (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
      (i.platformSold === 'ebay.de' || Boolean(i.ebaySku)) &&
      !i.ebayOrderId
  ).length;

  const runBackfill = useCallback(
    async (fromDate: string, toDate: string) => {
      if (!tokenReady) {
        setBackfillError('Path A needs an eBay OAuth token in Settings (eBay API tab). Path B CSV import below works without a token.');
        return;
      }
      if (!fromDate || !toDate) {
        setBackfillError('Pick a from/to date.');
        return;
      }
      setBackfilling(true);
      setBackfillError(null);
      setBackfillMessage(null);
      cancelRef.current = { cancelled: false };
      try {
        const result = await backfillEbayOrders(
          fromDate,
          toDate,
          (p) => setBackfillProgress(p),
          cancelRef.current
        );
        if (result.error) {
          setBackfillError(result.error);
        } else if (result.cancelled) {
          setBackfillMessage(`Cancelled — fetched ${result.ordersFetched} order(s) before stopping.`);
        } else {
          setBackfillMessage(
            `Fetched ${result.ordersFetched} order(s) from eBay · ${result.added} new, ${result.merged} updated in cache.`
          );
        }
      } catch (e: unknown) {
        setBackfillError((e as Error)?.message || 'Backfill failed.');
      } finally {
        setBackfilling(false);
        setStatsVersion((v) => v + 1);
        setTimeout(() => setBackfillProgress(null), 1200);
      }
    },
    [tokenReady]
  );

  const cancelBackfill = () => {
    cancelRef.current.cancelled = true;
  };

  const handleCsvFile = async (file: File) => {
    setCsvFileName(file.name);
    setCsvError(null);
    setCsvImportMessage(null);
    setCsvParsing(true);
    try {
      const text = await file.text();
      const result = parseEbayOrderCsv(text);
      setCsvResult(result);
      if (!result.orders.length) {
        setCsvError('No orders could be parsed from this file. Check the column headers below.');
      }
    } catch (e: unknown) {
      setCsvError((e as Error)?.message || 'Failed to read file.');
      setCsvResult(null);
    } finally {
      setCsvParsing(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleCsvFile(file);
  };

  const importCsvOrders = () => {
    if (!csvResult?.orders.length || !csvFileName) return;
    const result = upsertEbayOrders(csvResult.orders);
    addCsvImportMeta({ fileName: csvFileName, rowCount: csvResult.rowCount, orderCount: csvResult.orders.length });
    void pushOrderIndexToCloud(result.changed);
    setCsvImportMessage(
      `Imported ${csvResult.orders.length} order(s) from "${csvFileName}" · ${result.added} new, ${result.merged} updated in cache.`
    );
    setCsvResult(null);
    setCsvFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setStatsVersion((v) => v + 1);
  };

  const handleClearIndex = () => {
    const scope = cloudReady ? 'this browser AND your saved cloud history' : 'this browser';
    if (!confirm(`Clear the entire cached order index (${scope})? This does not affect any inventory items — only the cache used for order lookups.`)) {
      return;
    }
    void clearEbayOrderIndexEverywhere().then(() => setStatsVersion((v) => v + 1));
  };

  return (
    <div className="space-y-6">
      <EbaySalesSyncPanel
        items={items}
        taxMode={taxMode}
        onUpdate={onUpdate}
        onCacheUpdated={refreshStats}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCacheSetup((v) => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50/80 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-slate-100 text-slate-600 shrink-0">
              <Database size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900">Order cache setup</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {stats.count
                  ? `${stats.count} cached order(s) · ${stats.oldestDate || '?'} → ${stats.newestDate || '?'}`
                  : 'Backfill via API or import CSV — required once for sales sync'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cloudReady ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                {cloudPulling ? <Loader2 size={10} className="animate-spin" /> : <Cloud size={10} />}
                Cloud
              </span>
            ) : null}
            {showCacheSetup ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </div>
        </button>

        {showCacheSetup && (
          <div className="border-t border-slate-100 p-5 space-y-6">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 max-w-2xl">
                Sales sync matches your inventory against this order cache (buyer, order ID, payout). Run the
                eBay API backfill once, optionally import a Payments CSV for net-after-fees amounts, or both —
                orders dedupe by ID.
                {cloudReady
                  ? ' Signed in — cache mirrors to your account across devices.'
                  : ' Sign in (Settings → Cloud sync) to save history to your account.'}
              </p>
              {cloudPullMessage && (
                <p className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 inline-block">
                  {cloudPullMessage}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Cached orders', value: stats.count },
                { label: 'API only', value: stats.apiOnlyCount },
                { label: 'CSV only', value: stats.csvOnlyCount },
                { label: 'Both sources', value: stats.bothCount },
                { label: 'Sold, unlinked', value: soldOnEbayMissingLink },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                  <p className="text-[10px] font-black uppercase text-slate-400">{s.label}</p>
                  <p className="text-xl font-black text-slate-900 mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            {meta.apiBackfill?.completedThroughDate && (
              <p className="text-[11px] text-slate-500">
                API backfill last completed through{' '}
                <span className="font-bold text-slate-700">{meta.apiBackfill.completedThroughDate}</span>
              </p>
            )}

      {/* Path A: eBay API backfill */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-blue-600" />
          <h3 className="text-sm font-black text-slate-900">Path A — eBay Fulfillment API backfill</h3>
        </div>
        <p className="text-xs text-slate-500">
          Uses the same token as your order sync (Settings). The first run fetches everything since{' '}
          <span className="font-bold">{DEFAULT_FROM}</span> once; every run after that only fetches orders since
          the last sync, so it stays fast and doesn't re-download history you already have. Gross price only —
          the Fulfillment API does not expose fees, so net-after-fees comes from Path B (CSV) when available.
        </p>
        {!tokenReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2 text-[11px] text-amber-950">
            <p className="font-bold">
              Path A needs an eBay OAuth token — stored in this browser only (not synced with cloud login).
            </p>
            <p className="text-amber-900/90">
              Settings → <span className="font-bold">eBay API</span> → paste your User Token with scope{' '}
              <code className="bg-amber-100/80 px-1 rounded">sell.fulfillment.readonly</code>, then Save.
              Or skip the API and use <span className="font-bold">Path B — CSV import</span> below (no token required).
            </p>
            <button
              type="button"
              onClick={() => navigate('/panel/settings?tab=ebay')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 text-white text-[10px] font-black uppercase tracking-wide hover:bg-amber-950"
            >
              Open eBay API settings
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {alreadyUpToDate ? (
            <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Up to date — cache already covers through {meta.apiBackfill?.completedThroughDate}.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void runBackfill(suggested.from, suggested.to)}
              disabled={backfilling || !tokenReady}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
            >
              {backfilling ? (
                <Loader2 size={14} className="animate-spin" />
              ) : suggested.isIncremental ? (
                <RefreshCw size={14} />
              ) : (
                <CalendarRange size={14} />
              )}
              {backfilling
                ? 'Fetching…'
                : suggested.isIncremental
                  ? `Sync new orders since ${suggested.from}`
                  : `Start full backfill since ${suggested.from}`}
            </button>
          )}
          {backfilling && (
            <button
              type="button"
              onClick={cancelBackfill}
              className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black uppercase hover:bg-slate-200"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 ml-auto"
          >
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Advanced: custom range
          </button>
        </div>

        {showAdvanced && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-slate-400">From</span>
              <input
                type="date"
                value={advancedFrom}
                onChange={(e) => setAdvancedFrom(e.target.value)}
                disabled={backfilling}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-slate-400">To</span>
              <input
                type="date"
                value={advancedTo}
                onChange={(e) => setAdvancedTo(e.target.value)}
                disabled={backfilling}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700"
              />
            </label>
            <button
              type="button"
              onClick={() => void runBackfill(advancedFrom, advancedTo)}
              disabled={backfilling || !tokenReady}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
            >
              {backfilling ? <Loader2 size={14} className="animate-spin" /> : <CalendarRange size={14} />}
              Fetch custom range
            </button>
            <p className="text-[10px] text-slate-400 basis-full">
              Use this to re-fetch a range (e.g. if something looks wrong) or go further back than{' '}
              {DEFAULT_FROM}. It's safe to re-run any range — orders are deduplicated by order ID.
            </p>
          </div>
        )}

        {backfillProgress && (
          <EbayToolProgressBar
            label={`Fetching orders (chunk ${backfillProgress.chunkIndex + 1}/${backfillProgress.chunkCount})`}
            done={backfillProgress.chunkIndex + 1}
            total={backfillProgress.chunkCount}
            detail={`${backfillProgress.rangeLabel} · ${backfillProgress.ordersFetchedTotal} order(s) fetched so far`}
            tone="blue"
          />
        )}
        {backfillError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {backfillError}
          </div>
        )}
        {backfillMessage && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            {backfillMessage}
          </div>
        )}
      </div>

      {/* Path B: CSV import */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-emerald-600" />
          <h3 className="text-sm font-black text-slate-900">Path B — Seller Hub CSV import (no API)</h3>
        </div>
        <p className="text-xs text-slate-500">
          Export a report from eBay Seller Hub → <span className="font-bold">Orders</span> (buyer/address/order
          ID) or Seller Hub → <span className="font-bold">Payments → All transactions</span> (adds net amount
          after fees) and upload it here. Column headers are auto-detected — German and English exports both
          work.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFileInputChange}
          className="hidden"
          id="ebay-order-csv-input"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="ebay-order-csv-input"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 cursor-pointer"
          >
            {csvParsing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {csvParsing ? 'Parsing…' : 'Choose CSV file'}
          </label>
          {csvFileName && <span className="text-xs font-bold text-slate-600">{csvFileName}</span>}
        </div>

        {csvError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {csvError}
          </div>
        )}

        {csvResult && csvResult.orders.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Rows read', value: csvResult.rowCount },
                { label: 'Orders parsed', value: csvResult.orders.length },
                { label: 'Rows skipped', value: csvResult.skippedRowCount },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[9px] font-black uppercase text-slate-400">{s.label}</p>
                  <p className="text-lg font-black text-slate-900">{s.value}</p>
                </div>
              ))}
            </div>
            {csvResult.detectedColumns.length > 0 && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-bold text-slate-600">
                  {csvResult.detectedColumns.length} column(s) recognized
                </summary>
                <ul className="mt-2 space-y-0.5 pl-3">
                  {csvResult.detectedColumns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
            {csvResult.warnings.map((w) => (
              <p key={w} className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {w}
              </p>
            ))}
            <button
              type="button"
              onClick={importCsvOrders}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700"
            >
              <CheckCircle2 size={14} />
              Import {csvResult.orders.length} order(s) into cache
            </button>
          </div>
        )}

        {csvImportMessage && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            {csvImportMessage}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <History size={14} />
          {cloudReady
            ? 'Cached orders are stored locally and mirrored to your account.'
            : 'Cached orders are stored locally in this browser only (not signed in).'}
        </div>
        <button
          type="button"
          onClick={handleClearIndex}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-red-600 hover:bg-red-50"
        >
          <Trash2 size={12} />
          Clear cache
        </button>
      </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EbayStorePullOrdersTab;
