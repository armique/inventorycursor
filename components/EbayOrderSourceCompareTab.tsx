import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Copy,
  Database,
  FileSpreadsheet,
  GitCompare,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { hasEbayToken } from '../services/ebayService';
import { parseEbayOrderCsv } from '../services/ebayOrderCsvImport';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import {
  clearCompareSnapshots,
  fetchApiCompareSnapshot,
  importFromMainOrderIndex,
  loadApiCompareSnapshot,
  loadCsvCompareSnapshot,
  saveCsvCompareSnapshot,
  type FetchApiCompareProgress,
} from '../services/ebayCompareSnapshots';
import { formatEUR } from '../utils/formatMoney';
import {
  compareApiCsvSnapshots,
  type SnapshotCompareRow,
  type SnapshotSyncStatus,
} from '../utils/ebaySnapshotCompare';
import EbayToolProgressBar from './EbayToolProgressBar';

const DEFAULT_FROM = '2025-02-01';

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

type TableFilter = 'api_only' | 'csv_only' | 'gaps' | 'both_diff' | 'all';

const STATUS_LABEL: Record<SnapshotSyncStatus, string> = {
  api_only: 'API only',
  csv_only: 'CSV only',
  both: 'OK',
  both_diff: 'Both · diff',
};

function rowHighlight(status: SnapshotSyncStatus): string {
  if (status === 'api_only') return 'bg-blue-50 hover:bg-blue-100/80 border-l-4 border-l-blue-500';
  if (status === 'csv_only') return 'bg-emerald-50/80 hover:bg-emerald-100/60 border-l-4 border-l-emerald-500';
  if (status === 'both_diff') return 'bg-amber-50/80 hover:bg-amber-100/60 border-l-4 border-l-amber-400';
  return 'hover:bg-slate-50 border-l-4 border-l-transparent';
}

const EbayOrderSourceCompareTab: React.FC = () => {
  const navigate = useNavigate();
  const [snapVersion, setSnapVersion] = useState(0);
  const [tokenReady, setTokenReady] = useState(() => hasEbayToken());
  const [fromDate, setFromDate] = useState(DEFAULT_FROM);
  const [toDate, setToDate] = useState(todayISO);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchApiCompareProgress | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const [csvParsing, setCsvParsing] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<TableFilter>('api_only');
  const [search, setSearch] = useState('');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setSnapVersion((v) => v + 1);
    window.addEventListener('ebay-compare-snapshots-updated', bump);
    return () => window.removeEventListener('ebay-compare-snapshots-updated', bump);
  }, []);

  useEffect(() => {
    const refresh = () => setTokenReady(hasEbayToken());
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('ebay-config-updated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ebay-config-updated', refresh);
    };
  }, []);

  const apiSnap = useMemo(() => {
    void snapVersion;
    return loadApiCompareSnapshot();
  }, [snapVersion]);

  const csvSnap = useMemo(() => {
    void snapVersion;
    return loadCsvCompareSnapshot();
  }, [snapVersion]);

  const report = useMemo(() => {
    return compareApiCsvSnapshots(apiSnap?.orders ?? [], csvSnap?.orders ?? []);
  }, [apiSnap, csvSnap]);

  const tableRows = useMemo(() => {
    let rows: SnapshotCompareRow[] = report.rows;
    if (filter === 'api_only') rows = report.apiOnly;
    else if (filter === 'csv_only') rows = report.csvOnly;
    else if (filter === 'gaps') rows = [...report.apiOnly, ...report.csvOnly];
    else if (filter === 'both_diff') rows = report.rows.filter((r) => r.status === 'both_diff');
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.orderId.toLowerCase().includes(q) ||
        r.buyerApi.toLowerCase().includes(q) ||
        r.buyerCsv.toLowerCase().includes(q) ||
        r.itemsApi.toLowerCase().includes(q) ||
        r.itemsCsv.toLowerCase().includes(q)
    );
  }, [report, filter, search]);

  const runApiFetch = useCallback(async () => {
    if (!tokenReady) {
      setFetchError('Add eBay OAuth token in Settings → eBay API.');
      return;
    }
    setFetching(true);
    setFetchError(null);
    setFetchMessage(null);
    cancelRef.current = { cancelled: false };
    try {
      const result = await fetchApiCompareSnapshot(fromDate, toDate, (p) => setFetchProgress(p), cancelRef.current);
      if (result.error) setFetchError(result.error);
      else if (result.cancelled) setFetchMessage(`Stopped — ${result.orderCount} order(s) saved to API snapshot.`);
      else setFetchMessage(`API snapshot: ${result.orderCount} order(s) (${fromDate} → ${toDate}).`);
    } catch (e: unknown) {
      setFetchError((e as Error)?.message || 'API fetch failed.');
    } finally {
      setFetching(false);
      setTimeout(() => setFetchProgress(null), 1200);
    }
  }, [fromDate, toDate, tokenReady]);

  const handleCsvFile = async (file: File) => {
    setCsvFileName(file.name);
    setCsvError(null);
    setCsvMessage(null);
    setCsvParsing(true);
    try {
      const text = await file.text();
      const parsed = parseEbayOrderCsv(text);
      if (!parsed.orders.length) {
        setCsvError('No orders parsed — check CSV headers (Bestellnummer / Order Number).');
        return;
      }
      saveCsvCompareSnapshot(parsed.orders, file.name);
      setCsvMessage(`CSV snapshot: ${parsed.orders.length} orders from "${file.name}" (${parsed.rowCount} rows read).`);
    } catch (e: unknown) {
      setCsvError((e as Error)?.message || 'Failed to read CSV.');
    } finally {
      setCsvParsing(false);
    }
  };

  const loadFromMainCache = () => {
    const { orders } = loadEbayOrderIndex();
    const apiOrders = orders.filter((o) => o.sources.includes('api'));
    const csvOrders = orders.filter((o) => o.sources.includes('csv'));
    if (!apiOrders.length && !csvOrders.length) {
      setFetchError('Main order cache is empty — run Sales sync backfill or import CSV there first.');
      return;
    }
    const { apiCount, csvCount } = importFromMainOrderIndex(apiOrders, csvOrders);
    setFetchMessage(`Loaded from main cache: ${apiCount} API-tagged, ${csvCount} CSV-tagged orders.`);
  };

  const copyApiOnlyIds = async () => {
    const text = report.apiOnly.map((r) => r.orderId).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`Copied ${report.apiOnly.length} API-only order IDs.`);
      window.setTimeout(() => setCopyMsg(null), 2500);
    } catch {
      setCopyMsg('Copy failed.');
    }
  };

  const ready = Boolean(apiSnap?.orders.length || csvSnap?.orders.length);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 space-y-2">
        <div className="flex items-center gap-2">
          <GitCompare size={18} className="text-violet-700" />
          <h2 className="text-sm font-black text-slate-900">API vs CSV compare (isolated)</h2>
          <span className="text-[9px] font-black uppercase text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">Beta</span>
        </div>
        <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
          Separate debug tool — does <strong>not</strong> change Sales sync or inventory. Load orders via API and CSV into
          two isolated snapshots, then compare in the table below. Rows highlighted in <strong className="text-blue-700">blue</strong> are
          in API but missing from your CSV export.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-blue-600" />
            <h3 className="text-sm font-black text-slate-900">1 — API snapshot</h3>
          </div>
          {!tokenReady && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Needs OAuth token —{' '}
              <button type="button" onClick={() => navigate('/panel/settings?tab=ebay')} className="font-bold underline">
                Settings → eBay API
              </button>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-slate-400">From</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={fetching} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-slate-400">To</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={fetching} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold" />
            </label>
            <button
              type="button"
              onClick={() => void runApiFetch()}
              disabled={fetching || !tokenReady}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase hover:bg-blue-700 disabled:opacity-50"
            >
              {fetching ? <Loader2 size={14} className="animate-spin" /> : <CalendarRange size={14} />}
              Fetch API
            </button>
          </div>
          {fetchProgress && (
            <EbayToolProgressBar
              label={`API chunk ${fetchProgress.chunkIndex + 1}/${fetchProgress.chunkCount}`}
              done={fetchProgress.chunkIndex + 1}
              total={fetchProgress.chunkCount}
              detail={`${fetchProgress.rangeLabel} · ${fetchProgress.ordersFetchedTotal} orders`}
              tone="blue"
            />
          )}
          {apiSnap && (
            <p className="text-[11px] font-bold text-slate-600">
              Loaded: <strong>{apiSnap.meta.orderCount}</strong> orders
              {apiSnap.meta.fromDate ? ` · ${apiSnap.meta.fromDate} → ${apiSnap.meta.toDate}` : ''}
            </p>
          )}
          {fetchError && <p className="text-xs text-red-700 font-bold">{fetchError}</p>}
          {fetchMessage && <p className="text-xs text-emerald-700 font-bold">{fetchMessage}</p>}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-emerald-600" />
            <h3 className="text-sm font-black text-slate-900">2 — CSV snapshot</h3>
          </div>
          <p className="text-[11px] text-slate-500">Seller Hub → Payments → Transaktionsbericht (or Orders export).</p>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" id="compare-csv-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCsvFile(f); }} />
          <label htmlFor="compare-csv-input" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase cursor-pointer hover:bg-emerald-700">
            {csvParsing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {csvParsing ? 'Parsing…' : 'Upload CSV'}
          </label>
          {csvFileName && <span className="text-xs font-bold text-slate-600 ml-2">{csvFileName}</span>}
          {csvSnap && (
            <p className="text-[11px] font-bold text-slate-600">
              Loaded: <strong>{csvSnap.meta.orderCount}</strong> orders
              {csvSnap.meta.fileName ? ` · ${csvSnap.meta.fileName}` : ''}
            </p>
          )}
          {csvError && <p className="text-xs text-red-700 font-bold">{csvError}</p>}
          {csvMessage && <p className="text-xs text-emerald-700 font-bold">{csvMessage}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={loadFromMainCache} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50">
          <RefreshCw size={12} /> Load from Sales sync cache
        </button>
        <button type="button" onClick={() => { clearCompareSnapshots(); setFetchMessage(null); setCsvMessage(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-[10px] font-black uppercase text-red-700 hover:bg-red-100">
          <Trash2 size={12} /> Clear snapshots
        </button>
      </div>

      {ready && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { id: 'api_only' as const, label: 'In API, not CSV', value: report.apiOnlyCount, ring: 'ring-blue-400', bg: 'bg-blue-50 border-blue-200' },
              { id: 'csv_only' as const, label: 'In CSV, not API', value: report.csvOnlyCount, ring: 'ring-emerald-400', bg: 'bg-emerald-50 border-emerald-200' },
              { id: 'gaps' as const, label: 'All gaps', value: report.apiOnlyCount + report.csvOnlyCount, ring: 'ring-amber-400', bg: 'bg-amber-50 border-amber-200' },
              { id: 'both_diff' as const, label: 'Both · differ', value: report.bothDiffCount, ring: 'ring-amber-300', bg: 'bg-white border-slate-200' },
              { id: 'all' as const, label: 'All rows', value: report.rows.length, ring: 'ring-slate-300', bg: 'bg-white border-slate-200' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilter(s.id)}
                className={`rounded-xl border p-3 text-left ${s.bg} ${filter === s.id ? `ring-2 ${s.ring}` : ''}`}
              >
                <p className="text-[9px] font-black uppercase text-slate-500 leading-tight">{s.label}</p>
                <p className="text-2xl font-black text-slate-900">{s.value}</p>
              </button>
            ))}
          </div>

          {report.apiOnlyCount > 0 && filter === 'api_only' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <AlertTriangle size={16} className="text-blue-600 shrink-0" />
              <p className="text-xs text-blue-950 flex-1">
                <strong>{report.apiOnlyCount}</strong> orders are in the API snapshot but not in your CSV — highlighted below.
                Common causes: CSV date range shorter, cancelled/unpaid orders, or missing Bestellnummer in Transaktionsbericht.
              </p>
              <button type="button" onClick={() => void copyApiOnlyIds()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-[10px] font-black uppercase">
                <Copy size={12} /> Copy IDs
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[14rem]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search order ID, buyer, item…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold" />
            </div>
            {copyMsg && <span className="text-[10px] font-bold text-emerald-700">{copyMsg}</span>}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[min(65vh,560px)] overflow-y-auto">
              <table className="w-full text-left text-xs min-w-[960px]">
                <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
                  <tr className="text-[10px] font-black uppercase text-slate-500 tracking-wide">
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Order ID</th>
                    <th className="px-3 py-2.5">Date (API / CSV)</th>
                    <th className="px-3 py-2.5">Buyer (API)</th>
                    <th className="px-3 py-2.5">Buyer (CSV)</th>
                    <th className="px-3 py-2.5">Gross API</th>
                    <th className="px-3 py-2.5">Gross CSV</th>
                    <th className="px-3 py-2.5">Net CSV</th>
                    <th className="px-3 py-2.5">Item (API)</th>
                    <th className="px-3 py-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                        No rows for this filter{search ? ' — clear search' : ''}.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row) => (
                      <tr key={row.orderId} className={rowHighlight(row.status)}>
                        <td className="px-3 py-2 font-black whitespace-nowrap">
                          <span className={row.status === 'api_only' ? 'text-blue-700' : row.status === 'csv_only' ? 'text-emerald-700' : 'text-slate-600'}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">{row.orderId}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {row.dateApi || '—'} / {row.dateCsv || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-700 max-w-[8rem] truncate" title={row.buyerApi}>{row.buyerApi}</td>
                        <td className="px-3 py-2 text-slate-700 max-w-[8rem] truncate" title={row.buyerCsv}>{row.buyerCsv}</td>
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">{row.grossApi != null ? `€${formatEUR(row.grossApi)}` : '—'}</td>
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">{row.grossCsv != null ? `€${formatEUR(row.grossCsv)}` : '—'}</td>
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">{row.netCsv != null ? `€${formatEUR(row.netCsv)}` : '—'}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[10rem] truncate" title={row.itemsApi}>{row.itemsApi}</td>
                        <td className="px-3 py-2 text-[10px] text-slate-600 max-w-[12rem]">
                          {[...row.flags, ...row.diffs].slice(0, 2).join(' · ') || '—'}
                          {row.paymentApi && row.status === 'api_only' ? ` · ${row.paymentApi}` : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {!apiSnap?.orders.length || !csvSnap?.orders.length ? (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertCircle size={14} />
              Load <strong>both</strong> snapshots for a full comparison. Showing partial data from one side only.
            </p>
          ) : report.apiOnlyCount === 0 ? (
            <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckCircle2 size={14} />
              Every API order ID appears in the CSV snapshot.
            </p>
          ) : null}
        </>
      )}

      {!ready && (
        <div className="py-16 text-center text-slate-400 text-sm">
          Fetch API orders and upload a CSV to see the comparison table.
        </div>
      )}
    </div>
  );
};

export default EbayOrderSourceCompareTab;
