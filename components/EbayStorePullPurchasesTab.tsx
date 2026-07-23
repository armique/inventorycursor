import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  SkipForward,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react';
import type { Expense, InventoryItem } from '../types';
import { hasEbayToken } from '../services/ebayService';
import {
  backfillEbayPurchases,
  syncNewEbayPurchases,
  type PurchaseBackfillProgress,
} from '../services/ebayPurchaseBackfill';
import {
  EBAY_PURCHASE_API_MAX_DAYS,
  getPurchaseTypeCounts,
  getSuggestedPurchaseFetchRange,
  loadEbayPurchaseIndex,
  pullPurchaseIndexFromCloud,
  setPurchaseDisposition,
  setPurchaseType,
  type EbayPurchaseDisposition,
  type EbayPurchaseRecord,
  type EbayPurchaseType,
} from '../services/ebayPurchaseIndex';
import { isCloudEnabled } from '../services/firebaseService';
import {
  addFilamentSpool,
  findSpoolByEbayLineKey,
  kgToGrams,
  loadFilamentStock,
  type FilamentStockState,
} from '../services/filamentStock';
import { buildFilamentStockExpense, expenseDescriptionForEbayPurchase } from '../services/filamentExpenseLink';
import { FILAMENT_STOCK_EXPENSE_CATEGORY } from '../utils/expenseCategories';
import {
  guessFilamentType,
  guessFilamentWeightKg,
  looksLikeFilamentPurchase,
} from '../utils/filamentTitleDetect';
import {
  PURCHASE_TYPE_LABELS,
  PURCHASE_TYPE_ORDER,
} from '../utils/purchaseTypeDetect';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import EbayToolProgressBar from './EbayToolProgressBar';
import EbayToolSearchInput from './EbayToolSearchInput';

interface Props {
  items: InventoryItem[];
  onAddExpense: (expense: Expense) => void;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

const DISPOSITION_LABELS: Record<EbayPurchaseDisposition, string> = {
  pending: 'Pending',
  expense: 'Expense',
  filament: 'Filament stock',
  inventory: 'Inventory',
  personal: 'Personal',
  skipped: 'Skipped',
};

const DISPOSITION_STYLE: Record<EbayPurchaseDisposition, string> = {
  pending: 'bg-slate-100 text-slate-700',
  expense: 'bg-amber-100 text-amber-800',
  filament: 'bg-indigo-100 text-indigo-800',
  inventory: 'bg-emerald-100 text-emerald-800',
  personal: 'bg-violet-100 text-violet-800',
  skipped: 'bg-slate-200 text-slate-500',
};

const COLORS = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Green', 'Custom'];

/** eBay Trading GetOrders CreateTime window max (~90 days). */
const EBAY_PURCHASE_MAX_DAYS = EBAY_PURCHASE_API_MAX_DAYS;

type PurchaseRangePreset = 'this_week' | 'last_week' | 'last_month' | 'last_3_months';

const RANGE_PILLS: { id: PurchaseRangePreset; label: string }[] = [
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' },
];

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Monday of the week containing `d` (Europe-style weeks). */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const offset = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - offset);
  return x;
}

function rangeForPreset(id: PurchaseRangePreset): { from: string; to: string } {
  const today = todayLocal();
  if (id === 'this_week') {
    return { from: localISO(mondayOf(today)), to: localISO(today) };
  }
  if (id === 'last_week') {
    const thisMon = mondayOf(today);
    const lastMon = new Date(thisMon);
    lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon);
    lastSun.setDate(lastSun.getDate() - 1);
    return { from: localISO(lastMon), to: localISO(lastSun) };
  }
  if (id === 'last_month') {
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastPrev = new Date(firstThisMonth);
    lastPrev.setDate(0);
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
    return { from: localISO(firstPrev), to: localISO(lastPrev) };
  }
  // Last 3 months ≈ full eBay-allowed window (inclusive ~90 days).
  const from = new Date(today);
  from.setDate(from.getDate() - (EBAY_PURCHASE_MAX_DAYS - 1));
  return { from: localISO(from), to: localISO(today) };
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

const EbayStorePullPurchasesTab: React.FC<Props> = ({ onAddExpense }) => {
  const [indexVersion, setIndexVersion] = useState(0);
  const refresh = useCallback(() => setIndexVersion((v) => v + 1), []);

  useEffect(() => {
    window.addEventListener('ebay-purchase-index-updated', refresh);
    return () => window.removeEventListener('ebay-purchase-index-updated', refresh);
  }, [refresh]);

  const { purchases, meta } = useMemo(() => {
    const idx = loadEbayPurchaseIndex();
    return { purchases: [...idx.purchases].sort((a, b) => (b.creationDate || '').localeCompare(a.creationDate || '')), meta: idx.meta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexVersion]);

  const [filter, setFilter] = useState<'all' | 'pending' | 'filament'>('pending');
  const [typeFilter, setTypeFilter] = useState<EbayPurchaseType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<PurchaseBackfillProgress | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });
  const suggested = getSuggestedPurchaseFetchRange(todayISO());
  const [fromDate, setFromDate] = useState(suggested.from);
  const [toDate, setToDate] = useState(suggested.to);
  const [rangePreset, setRangePreset] = useState<PurchaseRangePreset | null>(
    suggested.isIncremental ? null : 'last_3_months'
  );
  const [tokenReady, setTokenReady] = useState(() => hasEbayToken());
  const [cloudReady] = useState(() => isCloudEnabled());
  const [expandedFilament, setExpandedFilament] = useState<string | null>(null);
  const [filamentForms, setFilamentForms] = useState<
    Record<string, { type: string; color: string; colorCustom: string; weightKg: string }>
  >({});

  const applyRangePreset = useCallback((id: PurchaseRangePreset) => {
    const range = rangeForPreset(id);
    setFromDate(range.from);
    setToDate(range.to);
    setRangePreset(id);
  }, []);

  const rangeDays = daysBetweenInclusive(fromDate, toDate);
  const rangeTooWide = rangeDays > EBAY_PURCHASE_MAX_DAYS;

  useEffect(() => {
    const refreshToken = () => setTokenReady(hasEbayToken());
    window.addEventListener('ebay-config-updated', refreshToken);
    window.addEventListener('focus', refreshToken);
    return () => {
      window.removeEventListener('ebay-config-updated', refreshToken);
      window.removeEventListener('focus', refreshToken);
    };
  }, []);

  // Hydrate from cloud only when this browser has an empty purchase library.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isCloudEnabled()) return;
      if (loadEbayPurchaseIndex().purchases.length > 0) {
        setCloudMessage(null);
        return;
      }
      setCloudMessage('Loading purchase library from cloud…');
      const result = await pullPurchaseIndexFromCloud();
      if (cancelled) return;
      if (result.error) {
        setCloudMessage(`Cloud: ${result.error}`);
      } else if (result.skipped) {
        setCloudMessage(null);
      } else {
        setCloudMessage(
          result.pulled > 0
            ? `Cloud library synced · ${result.pulled} purchase line(s)`
            : 'Cloud library up to date'
        );
        refresh();
        const next = getSuggestedPurchaseFetchRange(todayISO());
        setFromDate(next.from);
        setToDate(next.to);
        setRangePreset(next.isIncremental ? null : 'last_3_months');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const typeCounts = useMemo(() => getPurchaseTypeCounts(purchases), [purchases]);

  const filtered = useMemo(() => {
    let rows = purchases;
    if (filter === 'pending') rows = purchases.filter((p) => p.disposition === 'pending');
    else if (filter === 'filament') rows = purchases.filter((p) => looksLikeFilamentPurchase(p.title));
    if (typeFilter !== 'all') rows = rows.filter((p) => (p.purchaseType || 'unclassified') === typeFilter);
    return rows.filter((p) =>
      matchesEbayToolSearch(search, [
        p.title,
        p.orderId,
        p.sellerUsername,
        p.transactionId,
        p.itemId,
        p.note,
        p.creationDate,
        p.purchaseType,
      ])
    );
  }, [purchases, filter, typeFilter, search]);

  const filteredBeforeSearch = useMemo(() => {
    let rows = purchases;
    if (filter === 'pending') rows = purchases.filter((p) => p.disposition === 'pending');
    else if (filter === 'filament') rows = purchases.filter((p) => looksLikeFilamentPurchase(p.title));
    if (typeFilter !== 'all') rows = rows.filter((p) => (p.purchaseType || 'unclassified') === typeFilter);
    return rows;
  }, [purchases, filter, typeFilter]);

  const pendingCount = purchases.filter((p) => p.disposition === 'pending').length;
  const filamentHints = purchases.filter((p) => p.disposition === 'pending' && looksLikeFilamentPurchase(p.title)).length;

  const runBackfill = async (mode: 'range' | 'incremental') => {
    if (!tokenReady) {
      setBackfillError('Add your eBay user token in Settings first.');
      return;
    }
    setBackfilling(true);
    setBackfillError(null);
    setBackfillMessage(null);
    cancelRef.current.cancelled = false;
    try {
      const result =
        mode === 'incremental'
          ? await syncNewEbayPurchases(setBackfillProgress, () => cancelRef.current.cancelled)
          : await (async () => {
              if (!fromDate || !toDate || fromDate > toDate) {
                return {
                  fetched: 0,
                  added: 0,
                  merged: 0,
                  cancelled: false,
                  from: fromDate,
                  to: toDate,
                  isIncremental: false,
                  error: 'Pick a valid From / To date range.',
                };
              }
              if (daysBetweenInclusive(fromDate, toDate) > EBAY_PURCHASE_MAX_DAYS) {
                return {
                  fetched: 0,
                  added: 0,
                  merged: 0,
                  cancelled: false,
                  from: fromDate,
                  to: toDate,
                  isIncremental: false,
                  error: `eBay only allows ~${EBAY_PURCHASE_MAX_DAYS} days per purchase fetch. Use a pill range or Sync new.`,
                };
              }
              return backfillEbayPurchases(fromDate, toDate, setBackfillProgress, () => cancelRef.current.cancelled, {
                isIncremental: false,
              });
            })();

      if (result.error) setBackfillError(result.error);
      else if (result.cancelled) setBackfillMessage('Fetch cancelled.');
      else {
        const kind = result.isIncremental ? 'Incremental sync' : 'Range fetch';
        setBackfillMessage(
          `${kind} ${result.from} → ${result.to}: ${result.fetched} line(s) · ${result.added} new · ${result.merged} updated · saved to library${cloudReady ? ' + cloud' : ''}.`
        );
        const next = getSuggestedPurchaseFetchRange(todayISO());
        setFromDate(next.from);
        setToDate(next.to);
        setRangePreset(null);
      }
      refresh();
    } catch (e) {
      setBackfillError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfilling(false);
      setBackfillProgress(null);
    }
  };

  const openFilamentForm = (p: EbayPurchaseRecord) => {
    setExpandedFilament(p.lineKey);
    setFilamentForms((prev) => ({
      ...prev,
      [p.lineKey]: prev[p.lineKey] || {
        type: guessFilamentType(p.title),
        color: 'Black',
        colorCustom: '',
        weightKg: String(guessFilamentWeightKg(p.title)),
      },
    }));
  };

  const addAsFilament = (p: EbayPurchaseRecord) => {
    const form = filamentForms[p.lineKey];
    if (!form) return;
    if (findSpoolByEbayLineKey(p.lineKey)) {
      alert('This eBay line is already linked to a filament spool.');
      return;
    }
    if (p.disposition === 'filament') {
      alert('This purchase was already added as filament stock.');
      return;
    }
    const color = form.color === 'Custom' ? form.colorCustom.trim() : form.color;
    const kg = parseFloat(form.weightKg.replace(',', '.'));
    const paid = p.totalPaid ?? 0;
    if (!color || !Number.isFinite(kg) || kg <= 0) {
      alert('Color and spool weight (kg) are required.');
      return;
    }
    if (paid <= 0) {
      alert('Purchase has no price — enter manually in 3D Print → Filament stock.');
      return;
    }

    const expense = buildFilamentStockExpense(
      {
        type: form.type,
        color,
        purchasedAt: p.creationDate || todayISO(),
        vendor: p.sellerUsername ? `eBay: ${p.sellerUsername}` : 'eBay',
        note: p.title,
        source: 'ebay',
      },
      paid
    );
    expense.description = expenseDescriptionForEbayPurchase(p.title, p.orderId);
    onAddExpense(expense);

    try {
      let stock: FilamentStockState = loadFilamentStock();
      stock = addFilamentSpool(stock, {
        type: form.type,
        color,
        pricePerKg: paid / kg,
        purchasedGrams: kgToGrams(kg),
        purchasedAt: p.creationDate || todayISO(),
        source: 'ebay',
        vendor: p.sellerUsername ? `eBay · ${p.sellerUsername}` : 'eBay',
        totalPaid: paid,
        note: `eBay #${p.orderId} — ${p.title}`,
        expenseId: expense.id,
        ebayOrderId: p.orderId,
        ebayLineKey: p.lineKey,
      });
      const spool = stock.spools[stock.spools.length - 1];
      setPurchaseDisposition(p.lineKey, 'filament', { expenseId: expense.id, filamentSpoolId: spool.id });
      setExpandedFilament(null);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add spool.');
    }
  };

  const addAsOperatingExpense = (p: EbayPurchaseRecord) => {
    const paid = p.totalPaid ?? 0;
    if (paid <= 0) {
      alert('No price on this line.');
      return;
    }
    const expense: Expense = {
      id: `exp-ebay-${Date.now()}`,
      description: expenseDescriptionForEbayPurchase(p.title, p.orderId),
      amount: paid,
      date: p.creationDate || todayISO(),
      category: 'Other',
    };
    onAddExpense(expense);
    setPurchaseDisposition(p.lineKey, 'expense', { expenseId: expense.id });
    refresh();
  };

  const markDisposition = (lineKey: string, disposition: EbayPurchaseDisposition) => {
    setPurchaseDisposition(lineKey, disposition);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <ShoppingCart size={20} className="text-indigo-600" />
              eBay purchases (buyer history)
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Durable purchase library: each sync saves lines locally
              {cloudReady ? ' and to your cloud account' : ''} so they remain after eBay’s ~{EBAY_PURCHASE_MAX_DAYS}-day
              API window. Prefer <strong>Sync new</strong> (incremental). Classify by type in the library below.
              Amazon still needs manual entry on{' '}
              <Link to="/panel/3d-print" className="text-indigo-600 font-bold hover:underline">
                3D Print → Filament stock
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-center">
            <div className="rounded-xl border border-slate-200 px-3 py-2 min-w-[70px]">
              <p className="text-[9px] font-black uppercase text-slate-400">Cached</p>
              <p className="text-xl font-black">{purchases.length}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 min-w-[70px]">
              <p className="text-[9px] font-black uppercase text-amber-700">Pending</p>
              <p className="text-xl font-black text-amber-900">{pendingCount}</p>
            </div>
            {filamentHints > 0 && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 min-w-[70px]">
                <p className="text-[9px] font-black uppercase text-indigo-700">Filament?</p>
                <p className="text-xl font-black text-indigo-900">{filamentHints}</p>
              </div>
            )}
          </div>
        </div>

        {!tokenReady && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>
              Connect eBay in <Link to="/panel/settings" className="font-bold underline">Settings</Link> — same user
              OAuth token as sales sync (no extra scope needed for buyer history).
            </span>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PILLS.map((pill) => {
              const active = rangePreset === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  disabled={backfilling}
                  onClick={() => applyRangePreset(pill.id)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border transition-colors disabled:opacity-50 ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <button
              type="button"
              disabled={backfilling || !tokenReady}
              onClick={() => void runBackfill('incremental')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase disabled:opacity-50 shadow-sm shadow-indigo-200"
              title="Only fetch purchases since the last successful sync (within eBay’s 90-day limit)"
            >
              {backfilling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync new purchases
            </button>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setRangePreset(null);
                }}
                disabled={backfilling}
                className="px-3 py-2 rounded-xl border text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setRangePreset(null);
                }}
                disabled={backfilling}
                className="px-3 py-2 rounded-xl border text-sm font-bold"
              />
            </label>
            <button
              type="button"
              disabled={backfilling || !tokenReady || rangeTooWide}
              onClick={() => void runBackfill('range')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-700 border border-indigo-200 text-xs font-black uppercase disabled:opacity-50"
            >
              Fetch range
            </button>
            {backfilling && (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current.cancelled = true;
                }}
                className="text-xs font-bold text-red-600"
              >
                Cancel
              </button>
            )}
          </div>

          {rangeTooWide ? (
            <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Range is {rangeDays} days — eBay caps purchase history at ~{EBAY_PURCHASE_MAX_DAYS} days. Pick a
              pill or shorten the dates.
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
              {rangeDays} day{rangeDays === 1 ? '' : 's'} selected
              {rangePreset ? ` · ${RANGE_PILLS.find((p) => p.id === rangePreset)?.label}` : ''}
            </p>
          )}
        </div>

        {backfillProgress && (
          <EbayToolProgressBar
            label={`Fetching ${backfillProgress.rangeLabel}…`}
            done={backfillProgress.chunkIndex}
            total={backfillProgress.chunkCount}
            detail={`${backfillProgress.fetchedTotal} lines so far`}
            tone="indigo"
          />
        )}
        {backfillError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{backfillError}</div>
        )}
        {backfillMessage && (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex gap-2">
            <CheckCircle2 size={16} className="shrink-0" /> {backfillMessage}
          </div>
        )}
        {cloudMessage && (
          <div className="text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            {cloudMessage}
          </div>
        )}
        {meta.apiBackfill?.lastRunAt && (
          <p className="text-[11px] text-slate-400">
            Last API run: {meta.apiBackfill.lastRunAt.split('T')[0]} ({meta.apiBackfill.fromDate} →{' '}
            {meta.apiBackfill.toDate}
            {meta.apiBackfill.completedThroughDate
              ? ` · through ${meta.apiBackfill.completedThroughDate}`
              : ''}
            )
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Library · purchase types</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
              typeFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            All types · {purchases.length}
          </button>
          {PURCHASE_TYPE_ORDER.filter((t) => (typeCounts[t] || 0) > 0).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
                typeFilter === t
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}
            >
              {PURCHASE_TYPE_LABELS[t]} · {typeCounts[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['pending', 'filament', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border ${
              filter === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {f === 'pending' ? 'Pending only' : f === 'filament' ? 'Likely filament' : 'All statuses'}
          </button>
        ))}
      </div>

      {purchases.length > 0 && (
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search title, order ID, seller…"
          matchCount={filtered.length}
          totalCount={filteredBeforeSearch.length}
        />
      )}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-12">
            {search.trim() ? 'No purchases match your search.' : 'No purchases in this view — fetch from eBay or change filter.'}
          </p>
        ) : (
          filtered.map((p) => {
            const likelyFilament = looksLikeFilamentPurchase(p.title);
            const isOpen = expandedFilament === p.lineKey;
            const form = filamentForms[p.lineKey];
            return (
              <div
                key={p.lineKey}
                className={`rounded-2xl border bg-white overflow-hidden ${
                  likelyFilament && p.disposition === 'pending' ? 'border-indigo-200 shadow-sm' : 'border-slate-200'
                }`}
              >
                <div className="p-4 flex flex-wrap gap-3 items-start justify-between">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${DISPOSITION_STYLE[p.disposition]}`}>
                        {DISPOSITION_LABELS[p.disposition]}
                      </span>
                      <label className="inline-flex items-center gap-1">
                        <span className="sr-only">Purchase type</span>
                        <select
                          value={p.purchaseType || 'unclassified'}
                          onChange={(e) => {
                            setPurchaseType(p.lineKey, e.target.value as EbayPurchaseType);
                            refresh();
                          }}
                          className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-900 max-w-[9rem]"
                          title="Library purchase type"
                        >
                          {PURCHASE_TYPE_ORDER.map((t) => (
                            <option key={t} value={t}>
                              {PURCHASE_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {likelyFilament && p.disposition === 'pending' && (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-600 text-white inline-flex items-center gap-0.5">
                          <Sparkles size={10} /> Filament?
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-bold">{p.creationDate || '—'}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 leading-snug">{p.title}</p>
                    <p className="text-[11px] text-slate-500">
                      Order {p.orderId}
                      {p.sellerUsername ? ` · seller ${p.sellerUsername}` : ''}
                      {p.quantity > 1 ? ` · qty ${p.quantity}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-slate-900">€{formatEUR(p.totalPaid ?? 0)}</p>
                    {p.filamentSpoolId && (
                      <Link to="/panel/3d-print" className="text-[10px] font-bold text-indigo-600 hover:underline">
                        View spool →
                      </Link>
                    )}
                  </div>
                </div>

                {p.disposition === 'pending' && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => (isOpen ? setExpandedFilament(null) : openFilamentForm(p))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase"
                    >
                      <Package size={12} />
                      Add as filament
                      {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => addAsOperatingExpense(p)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 text-[10px] font-black uppercase"
                    >
                      <Wallet size={12} /> Business expense
                    </button>
                    <button
                      type="button"
                      onClick={() => markDisposition(p.lineKey, 'personal')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-800 text-[10px] font-black uppercase"
                    >
                      <User size={12} /> Personal
                    </button>
                    <button
                      type="button"
                      onClick={() => markDisposition(p.lineKey, 'skipped')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-slate-500 text-[10px] font-black uppercase ml-auto"
                    >
                      <SkipForward size={12} /> Skip
                    </button>
                  </div>
                )}

                {isOpen && form && (
                  <div className="border-t border-indigo-100 bg-indigo-50/40 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <label className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-slate-500">Material</span>
                      <input
                        value={form.type}
                        onChange={(e) =>
                          setFilamentForms((prev) => ({ ...prev, [p.lineKey]: { ...form, type: e.target.value } }))
                        }
                        className="w-full px-2 py-1.5 rounded-lg border text-sm font-bold"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-slate-500">Color</span>
                      <select
                        value={form.color}
                        onChange={(e) =>
                          setFilamentForms((prev) => ({ ...prev, [p.lineKey]: { ...form, color: e.target.value } }))
                        }
                        className="w-full px-2 py-1.5 rounded-lg border text-sm font-bold"
                      >
                        {COLORS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      {form.color === 'Custom' && (
                        <input
                          value={form.colorCustom}
                          onChange={(e) =>
                            setFilamentForms((prev) => ({ ...prev, [p.lineKey]: { ...form, colorCustom: e.target.value } }))
                          }
                          placeholder="Color name"
                          className="w-full mt-1 px-2 py-1.5 rounded-lg border text-sm"
                        />
                      )}
                    </label>
                    <label className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-slate-500">Spool kg</span>
                      <input
                        value={form.weightKg}
                        onChange={(e) =>
                          setFilamentForms((prev) => ({ ...prev, [p.lineKey]: { ...form, weightKg: e.target.value } }))
                        }
                        className="w-full px-2 py-1.5 rounded-lg border text-sm font-bold"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => addAsFilament(p)}
                        className="w-full py-2 rounded-lg bg-indigo-700 text-white text-[10px] font-black uppercase"
                      >
                        Create spool + {FILAMENT_STOCK_EXPENSE_CATEGORY}
                      </button>
                    </div>
                    <p className="sm:col-span-4 text-[11px] text-indigo-800">
                      Creates a <strong>{FILAMENT_STOCK_EXPENSE_CATEGORY}</strong> expense (not Betriebsausgabe) and a
                      spool in 3D Print stock — COGS hits when you print.
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default EbayStorePullPurchasesTab;
