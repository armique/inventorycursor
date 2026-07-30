import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEURPrefix } from '../utils/formatMoney';
import { buildEbaySoldUrl } from '../utils/ebaySoldPulse';
import {
  analyzeBuyHelperItem,
  inventoryCompsForQuery,
  loadBuyHelperFees,
  loadBuyHelperItems,
  removeBuyHelperItem,
  saveBuyHelperVatPct,
  seedBuyHelperIfEmpty,
  sortBuyHelperItems,
  suggestBuyHelperTargets,
  suggestBuyHelperTargetsFromDealwatch,
  summarizeInventoryComps,
  upsertBuyHelperItem,
  type BuyHelperCategory,
  type BuyHelperFees,
  type BuyHelperItem,
  DEFAULT_DESIRED_MARGIN_PCT,
} from '../utils/buyHelper';
import { saveFlipFees, totalEbayFeePct } from '../utils/flipCoach';
import { canUseBuyHelperAi, generateBuyHelperWithAi } from '../services/buyHelperAI';
import { fetchBuyHelperQuote, type DealwatchBuyHelperQuote, type DealwatchQuoteBucket } from '../services/dealwatchApi';
import { resolveDealwatchPrices, type ResolvedDealwatchPrices } from '../services/dealwatchPriceSource';
import {
  fetchAndStoreBuyHelperDealwatch,
  loadBuyHelperPriceHistories,
  type BuyHelperPriceHistory,
} from '../services/buyHelperDealwatchHistory';
import { analyzePriceHistory } from '../services/buyHelperDealwatchAnalysis';

interface Props {
  items: InventoryItem[];
}

type BuyHelperEditorTab = 'overview' | 'dealwatch' | 'analysis' | 'history';

const CATEGORIES: BuyHelperCategory[] = [
  'GPU',
  'CPU',
  'RAM',
  'SSD',
  'Motherboard',
  'PSU',
  'Cooler',
  'Case',
  'Other',
];

function parseEuro(raw: string): number | undefined {
  const n = Number(String(raw).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

const DealwatchBucketCard: React.FC<{ label: string; bucket: DealwatchQuoteBucket; used: boolean }> = ({ label, bucket, used }) => (
  <div className={`rounded-xl border px-3 py-2 text-xs ${used ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 bg-white'}`}>
    <p className="font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
      {label}
      {used && <span className="text-emerald-700">used</span>}
    </p>
    {bucket && bucket.count > 0 && bucket.median != null ? (
      <>
        <p className="font-bold text-slate-900 mt-1">{formatEURPrefix(bucket.median)} median</p>
        <p className="text-slate-500">
          {bucket.low != null ? formatEURPrefix(bucket.low) : '—'}–{bucket.high != null ? formatEURPrefix(bucket.high) : '—'} · n={bucket.count}
        </p>
      </>
    ) : (
      <p className="text-slate-400 mt-1">no data</p>
    )}
  </div>
);

/**
 * Buy Helper (Sold Pulse rewrite): track parts to buy with editable
 * buy / KA / eBay / margin, using sold inventory comps (incl. bundles).
 */
const SoldPulsePage: React.FC<Props> = ({ items }) => {
  const [fees, setFees] = useState<BuyHelperFees>(() => loadBuyHelperFees());
  const [list, setList] = useState<BuyHelperItem[]>(() => []);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newQuery, setNewQuery] = useState('');
  const [newCategory, setNewCategory] = useState<BuyHelperCategory>('GPU');
  const [filter, setFilter] = useState<'ALL' | 'BUY' | BuyHelperCategory>('ALL');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live Dealwatch check (Buy Helper bridge)
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [dealwatchQuote, setDealwatchQuote] = useState<DealwatchBuyHelperQuote | null>(null);
  const [dealwatchResolved, setDealwatchResolved] = useState<ResolvedDealwatchPrices | null>(null);

  // Dealwatch history (30-day snapshots per tracked part)
  const [priceHistories, setPriceHistories] = useState<Record<string, BuyHelperPriceHistory>>({});
  const [historyBusy, setHistoryBusy] = useState(false);

  // UI tabs
  const [buyHelperTab, setBuyHelperTab] = useState<BuyHelperEditorTab>('overview');

  // Draft editors for active item
  const [draftQuery, setDraftQuery] = useState('');
  const [draftCategory, setDraftCategory] = useState<BuyHelperCategory>('GPU');
  const [draftBuy, setDraftBuy] = useState('');
  const [draftKa, setDraftKa] = useState('');
  const [draftEbay, setDraftEbay] = useState('');
  const [draftMargin, setDraftMargin] = useState(String(DEFAULT_DESIRED_MARGIN_PCT));
  const [draftNote, setDraftNote] = useState('');

  useEffect(() => {
    const seeded = seedBuyHelperIfEmpty(items);
    setList(seeded.length ? seeded : loadBuyHelperItems());
    setReady(true);
    // Seed once on mount; tracked list lives in localStorage afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadBuyHelperPriceHistories()
      .then(setPriceHistories)
      .catch(() => setPriceHistories({}));
  }, [ready]);

  const ranked = useMemo(() => sortBuyHelperItems(list, fees), [list, fees]);

  const visible = useMemo(() => {
    if (filter === 'ALL') return ranked;
    if (filter === 'BUY') return ranked.filter((x) => x.analysis.verdict === 'BUY');
    return ranked.filter((x) => x.category === filter);
  }, [ranked, filter]);

  const active = list.find((x) => x.id === activeId) || null;

  const draftAsItem: BuyHelperItem | null = active
    ? {
        ...active,
        query: draftQuery.trim() || active.query,
        category: draftCategory,
        buyPrice: parseEuro(draftBuy),
        sellKa: parseEuro(draftKa),
        sellEbay: parseEuro(draftEbay),
        desiredMarginPct: Number(draftMargin) || DEFAULT_DESIRED_MARGIN_PCT,
        note: draftNote.trim() || undefined,
      }
    : null;

  const activeAnalysis = draftAsItem ? analyzeBuyHelperItem(draftAsItem, fees) : null;

  const invHits = useMemo(
    () => (active ? inventoryCompsForQuery(items, active.query, { category: active.category }) : []),
    [items, active],
  );
  const invSummary = useMemo(() => summarizeInventoryComps(invHits), [invHits]);

  const activeHistory = active ? priceHistories[active.id] ?? null : null;
  const marketAnalysis = useMemo(() => analyzePriceHistory(activeHistory), [activeHistory]);

  const openItem = (item: BuyHelperItem) => {
    setActiveId(item.id);
    setDraftQuery(item.query);
    setDraftCategory(item.category);
    setDraftBuy(item.buyPrice != null ? String(item.buyPrice) : '');
    setDraftKa(item.sellKa != null ? String(item.sellKa) : '');
    setDraftEbay(item.sellEbay != null ? String(item.sellEbay) : '');
    setDraftMargin(String(item.desiredMarginPct ?? DEFAULT_DESIRED_MARGIN_PCT));
    setDraftNote(item.note || '');
    setPaste('');
    setMessage(null);
    setError(null);
    setDealwatchQuote(null);
    setDealwatchResolved(null);
    setMarketError(null);
    setBuyHelperTab('overview');
  };

  useEffect(() => {
    if (!ready || activeId) return;
    const first = ranked[0];
    if (first) openItem(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, list.length]);

  const persistFees = (next: BuyHelperFees) => {
    setFees(next);
    saveFlipFees({ ebayFeePct: next.ebayFeePct, ebayAdsPct: next.ebayAdsPct });
    saveBuyHelperVatPct(next.vatOnProfitPct);
  };

  const saveActive = (patch?: Partial<BuyHelperItem>) => {
    if (!active) return;
    const nextItem: BuyHelperItem = {
      ...active,
      query: draftQuery.trim() || active.query,
      category: draftCategory,
      buyPrice: parseEuro(draftBuy),
      sellKa: parseEuro(draftKa),
      sellEbay: parseEuro(draftEbay),
      desiredMarginPct: Number(draftMargin) || DEFAULT_DESIRED_MARGIN_PCT,
      note: draftNote.trim() || undefined,
      ...patch,
    };
    const next = upsertBuyHelperItem(list, nextItem);
    setList(next);
    setMessage('Saved.');
    setError(null);
  };

  const addItem = () => {
    const q = newQuery.trim();
    if (!q) return;
    const suggested = suggestBuyHelperTargets(items, q, fees, {
      category: newCategory,
      desiredMarginPct: DEFAULT_DESIRED_MARGIN_PCT,
    });
    const next = upsertBuyHelperItem(list, {
      query: q,
      category: newCategory,
      desiredMarginPct: DEFAULT_DESIRED_MARGIN_PCT,
      ...suggested,
    });
    setList(next);
    setNewQuery('');
    const created = next.find((x) => x.query.toLowerCase() === q.toLowerCase());
    if (created) openItem(created);
  };

  const removeActive = () => {
    if (!active) return;
    const next = removeBuyHelperItem(list, active.id);
    setList(next);
    setActiveId(next[0]?.id ?? null);
    if (next[0]) openItem(next[0]);
    else {
      setDraftQuery('');
      setDraftBuy('');
      setDraftKa('');
      setDraftEbay('');
    }
  };

  const fillFromInventory = () => {
    if (!active) return;
    const suggested = suggestBuyHelperTargets(items, draftQuery.trim() || active.query, fees, {
      category: draftCategory,
      desiredMarginPct: Number(draftMargin) || DEFAULT_DESIRED_MARGIN_PCT,
    });
    if (suggested.buyPrice != null) setDraftBuy(String(suggested.buyPrice));
    if (suggested.sellKa != null) setDraftKa(String(suggested.sellKa));
    if (suggested.sellEbay != null) setDraftEbay(String(suggested.sellEbay));
    if (suggested.desiredMarginPct != null) setDraftMargin(String(suggested.desiredMarginPct));
    if (suggested.note) setDraftNote(suggested.note);
    const next = upsertBuyHelperItem(list, {
      ...active,
      query: draftQuery.trim() || active.query,
      category: draftCategory,
      ...suggested,
    });
    setList(next);
    setMessage(suggested.inventoryCompCount ? `Filled from ${suggested.inventoryCompCount} inventory comps.` : 'No comps — check note.');
  };

  const checkMarket = async () => {
    if (!active) return;
    const q = draftQuery.trim() || active.query;
    setMarketBusy(true);
    setMarketError(null);
    setMessage(null);
    setError(null);
    try {
      const quote = await fetchBuyHelperQuote(q);
      const resolved = resolveDealwatchPrices(quote);
      setDealwatchQuote(quote);
      setDealwatchResolved(resolved);
      const suggested = suggestBuyHelperTargetsFromDealwatch(resolved, items, q, fees, {
        category: draftCategory,
        desiredMarginPct: Number(draftMargin) || DEFAULT_DESIRED_MARGIN_PCT,
      });
      if (suggested.buyPrice != null) setDraftBuy(String(suggested.buyPrice));
      if (suggested.sellKa != null) setDraftKa(String(suggested.sellKa));
      if (suggested.sellEbay != null) setDraftEbay(String(suggested.sellEbay));
      if (suggested.desiredMarginPct != null) setDraftMargin(String(suggested.desiredMarginPct));
      if (suggested.note) setDraftNote(suggested.note);
      const next = upsertBuyHelperItem(list, {
        ...active,
        query: q,
        category: draftCategory,
        ...suggested,
      });
      setList(next);
      setMessage(
        resolved.ebay || resolved.ka
          ? 'Filled from live Dealwatch data — see breakdown below.'
          : 'No live/sold Dealwatch data found — filled from inventory instead.',
      );
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : String(err));
    } finally {
      setMarketBusy(false);
    }
  };

  const refreshMarketHistory = async () => {
    if (list.length === 0) {
      setMessage('No tracked items to refresh.');
      return;
    }
    setHistoryBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await fetchAndStoreBuyHelperDealwatch(list, priceHistories);
      setPriceHistories(await loadBuyHelperPriceHistories());
      setMessage(
        `Updated ${result.success} of ${list.length} parts.` +
          (result.errors.length ? ` ${result.errors.length} without data.` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryBusy(false);
    }
  };

  const runAiGenerate = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await generateBuyHelperWithAi({
        query: draftQuery.trim() || active.query,
        fees,
        inventoryPocketMedian: invSummary?.pocketMedian,
        inventoryCompCount: invSummary?.count,
        inventoryLow: invSummary?.low,
        inventoryHigh: invSummary?.high,
        pastedText: paste,
        current: {
          desiredMarginPct: Number(draftMargin) || DEFAULT_DESIRED_MARGIN_PCT,
        },
      });
      setDraftBuy(String(result.buyPrice));
      setDraftKa(String(result.sellKa));
      setDraftEbay(String(result.sellEbay));
      setDraftMargin(String(result.desiredMarginPct));
      setDraftNote(result.advice);
      const next = upsertBuyHelperItem(list, {
        ...active,
        query: draftQuery.trim() || active.query,
        category: draftCategory,
        buyPrice: result.buyPrice,
        sellKa: result.sellKa,
        sellEbay: result.sellEbay,
        desiredMarginPct: result.desiredMarginPct,
        marketLow: result.marketLow,
        marketMedian: result.marketMedian,
        marketHigh: result.marketHigh,
        inventoryCompCount: invSummary?.count,
        note: result.advice,
        lastCheckedAt: new Date().toISOString(),
      });
      setList(next);
      setMessage(result.usedAi ? 'AI filled buy/sell/margin (grounded in your comps).' : 'Filled from inventory/paste math.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const feeTotal = totalEbayFeePct(fees);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[240px] text-slate-400 gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span className="text-sm font-bold">Loading buy helper…</span>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6.5rem)] min-h-[560px] max-w-[1600px] mx-auto flex flex-col animate-in fade-in">
      <header className="shrink-0 flex flex-wrap items-start justify-between gap-3 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
            <ShoppingCart size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-slate-900 tracking-tight truncate">Buy Helper</h1>
            <p className="text-xs text-slate-500 truncate">
              Track parts · editable buy / KA / eBay / margin · inventory comps (incl. sold bundles)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
          <label className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
            eBay fee %
            <input
              type="number"
              step="0.1"
              className="w-14 border-0 bg-transparent text-right outline-none"
              value={fees.ebayFeePct}
              onChange={(e) => persistFees({ ...fees, ebayFeePct: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
            Ads %
            <input
              type="number"
              step="0.1"
              className="w-14 border-0 bg-transparent text-right outline-none"
              value={fees.ebayAdsPct}
              onChange={(e) => persistFees({ ...fees, ebayAdsPct: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
            VAT on profit %
            <input
              type="number"
              step="0.1"
              className="w-14 border-0 bg-transparent text-right outline-none"
              value={fees.vatOnProfitPct}
              onChange={(e) => persistFees({ ...fees, vatOnProfitPct: Number(e.target.value) || 0 })}
            />
          </label>
          <span className="px-2 py-1.5 rounded-lg bg-slate-900 text-white">
            eBay cut {feeTotal}% + VAT {fees.vatOnProfitPct}%
          </span>
          <button
            type="button"
            disabled={historyBusy}
            onClick={() => void refreshMarketHistory()}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-900 disabled:opacity-50"
            title="Fetch eBay sold + live and Kleinanzeigen for every tracked part and append to 30-day history"
          >
            {historyBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh all
          </button>
          <Link to="/panel/flip-coach" className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Flip Coach
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-3">
        {/* Tracked list */}
        <aside className="min-h-0 flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-100 space-y-2">
            <div className="flex gap-2">
              <input
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="Add part e.g. RTX 3060 12GB"
                className="flex-1 min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as BuyHelperCategory)}
                className="rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addItem}
                className="px-3 py-2 rounded-xl bg-slate-900 text-white"
                title="Add tracked item"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(['ALL', 'BUY', ...CATEGORIES] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                    filter === f ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 border border-slate-200'
                  }`}
                >
                  {f === 'BUY' ? 'Buy now' : f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {visible.map((item) => {
              const isActive = item.id === activeId;
              const v = item.analysis.verdict;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors ${
                    isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold truncate">{item.query}</span>
                    <span
                      className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        v === 'BUY'
                          ? 'bg-emerald-500 text-white'
                          : v === 'SKIP'
                            ? 'bg-rose-500 text-white'
                            : isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {v}
                    </span>
                  </div>
                  <p className={`text-[10px] font-semibold mt-0.5 ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                    Buy {item.buyPrice != null ? formatEURPrefix(item.buyPrice) : '—'}
                    {' · '}KA {item.sellKa != null ? formatEURPrefix(item.sellKa) : '—'}
                    {' · '}eBay {item.sellEbay != null ? formatEURPrefix(item.sellEbay) : '—'}
                  </p>
                </button>
              );
            })}
            {!visible.length && (
              <p className="text-sm text-slate-500 text-center py-8 font-semibold">No tracked items yet.</p>
            )}
          </div>
        </aside>

        {/* Editor */}
        <section className="min-h-0 flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm font-bold">
              Select or add a tracked item
            </div>
          ) : (
            <>
              <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                <Activity size={16} className="text-slate-400" />
                <input
                  value={draftQuery}
                  onChange={(e) => setDraftQuery(e.target.value)}
                  className="flex-1 min-w-[10rem] bg-transparent text-lg font-black text-slate-900 outline-none"
                />
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as BuyHelperCategory)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <a
                  href={buildEbaySoldUrl(draftQuery || active.query, 'used_bin')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wider text-slate-600"
                >
                  eBay sold <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  onClick={removeActive}
                  className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                  title="Remove tracked item"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
                {(
                  [
                    ['overview', 'Overview'],
                    ['dealwatch', 'Dealwatch'],
                    ['analysis', 'Analysis'],
                    ['history', 'History'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBuyHelperTab(id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors ${
                      buyHelperTab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-4 ${buyHelperTab === 'overview' ? '' : 'hidden'}`}>
                {activeAnalysis && (
                  <div
                    className={`rounded-2xl border px-4 py-3 ${
                      activeAnalysis.verdict === 'BUY'
                        ? 'border-emerald-200 bg-emerald-50'
                        : activeAnalysis.verdict === 'SKIP'
                          ? 'border-rose-200 bg-rose-50'
                          : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-widest">{activeAnalysis.verdict}</span>
                      {activeAnalysis.suggestedMaxBuy != null && (
                        <span className="text-sm font-black text-slate-900">
                          Max buy ~{formatEURPrefix(activeAnalysis.suggestedMaxBuy)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-1 font-semibold">{activeAnalysis.verdictReason}</p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeAnalysis.ka && (
                        <div className="rounded-xl bg-white/80 border border-black/5 px-3 py-2 text-xs">
                          <p className="font-black uppercase tracking-wider text-slate-400">Kleinanzeigen</p>
                          <p className="font-bold text-slate-900 mt-1">
                            List {formatEURPrefix(activeAnalysis.ka.list)} → net {formatEURPrefix(activeAnalysis.ka.netProfit)} ({activeAnalysis.ka.marginPct}%)
                          </p>
                          <p className="text-slate-500">
                            After VAT {formatEURPrefix(activeAnalysis.ka.vat)} on profit · no platform fees
                          </p>
                        </div>
                      )}
                      {activeAnalysis.ebay && (
                        <div className="rounded-xl bg-white/80 border border-black/5 px-3 py-2 text-xs">
                          <p className="font-black uppercase tracking-wider text-slate-400">eBay.de</p>
                          <p className="font-bold text-slate-900 mt-1">
                            List {formatEURPrefix(activeAnalysis.ebay.list)} → pocket {formatEURPrefix(activeAnalysis.ebay.pocket)} → net {formatEURPrefix(activeAnalysis.ebay.netProfit)} ({activeAnalysis.ebay.marginPct}%)
                          </p>
                          <p className="text-slate-500">
                            −{feeTotal}% fees/ads, then −{fees.vatOnProfitPct}% VAT on profit
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Buy max €</span>
                    <input
                      value={draftBuy}
                      onChange={(e) => setDraftBuy(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sell KA €</span>
                    <input
                      value={draftKa}
                      onChange={(e) => setDraftKa(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sell eBay €</span>
                    <input
                      value={draftEbay}
                      onChange={(e) => setDraftEbay(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Desired net margin %</span>
                    <input
                      value={draftMargin}
                      onChange={(e) => setDraftMargin(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Note</span>
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold resize-y"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => saveActive()}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={marketBusy || busy}
                    onClick={fillFromInventory}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wider text-slate-700 disabled:opacity-50"
                  >
                    <RefreshCw size={14} /> From inventory
                  </button>
                  <button
                    type="button"
                    disabled={marketBusy || busy}
                    onClick={() => void checkMarket()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 text-xs font-black uppercase tracking-wider disabled:opacity-50"
                  >
                    {marketBusy ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                    Check Dealwatch
                  </button>
                  <button
                    type="button"
                    disabled={busy || marketBusy}
                    onClick={() => void runAiGenerate()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-900 text-xs font-black uppercase tracking-wider disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {canUseBuyHelperAi() ? 'AI generate' : 'Generate'}
                  </button>
                </div>

                {(message || error || marketError) && (
                  <p className={`text-xs font-bold ${error || marketError ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {error || marketError || message}
                  </p>
                )}

                {dealwatchQuote && (
                  <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Live Dealwatch check for "{dealwatchQuote.query}"
                      </p>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        {new Date(dealwatchQuote.checkedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {!dealwatchResolved?.ebay && !dealwatchResolved?.ka ? (
                      <p className="p-4 text-sm font-semibold text-amber-800 bg-amber-50">
                        No live or sold Dealwatch data found for this query — buy/sell targets above were filled from
                        your inventory comps instead (see note).
                      </p>
                    ) : (
                      <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <DealwatchBucketCard label="eBay sold" bucket={dealwatchQuote.ebaySold} used={dealwatchResolved?.ebay?.source === 'ebay-sold'} />
                        <DealwatchBucketCard label="eBay live" bucket={dealwatchQuote.ebayLive} used={dealwatchResolved?.ebay?.source === 'ebay-live'} />
                        <DealwatchBucketCard label="Kleinanzeigen live" bucket={dealwatchQuote.kaLive} used={dealwatchResolved?.ka?.source === 'ka-live'} />
                      </div>
                    )}
                    {dealwatchQuote.errors && Object.keys(dealwatchQuote.errors).length > 0 && (
                      <p className="px-4 pb-3 text-[10px] text-slate-400 font-semibold">
                        {Object.entries(dealwatchQuote.errors).map(([src, msg]) => `${src}: ${msg}`).join(' · ')}
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Your sold comps {invSummary ? `(${invSummary.count})` : ''}
                    </p>
                    {invSummary && invSummary.bundleAttributed > 0 && (
                      <span className="text-[10px] font-bold text-emerald-700">
                        {invSummary.bundleAttributed} from sold bundles
                      </span>
                    )}
                  </div>
                  {!invSummary ? (
                    <p className="p-4 text-sm text-slate-500 font-semibold">
                      No matching sold parts yet. Bundle sales are split by buy-weight so individual GPUs/CPUs still count.
                    </p>
                  ) : (
                    <div className="p-3 space-y-2">
                      <p className="text-xs font-bold text-slate-600 px-1">
                        Pocket band {formatEURPrefix(invSummary.low)} – {formatEURPrefix(invSummary.high)}
                        {' · '}median {formatEURPrefix(invSummary.median)}
                      </p>
                      {invSummary.samples.map((s, i) => (
                        <div key={`${s.name}-${s.soldAt}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{s.name}</p>
                            <p className="text-[10px] text-slate-500 font-semibold">
                              {s.platform} · {s.source === 'bundle_attribution' ? 'from bundle' : s.source}
                              {s.soldAt ? ` · ${s.soldAt.slice(0, 10)}` : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0 text-xs font-bold">
                            <p className="text-slate-900">{formatEURPrefix(s.pocket)} pocket</p>
                            <p className="text-slate-400">buy {formatEURPrefix(s.buyPrice)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Optional: paste eBay sold rows to refine Dealwatch
                  </p>
                  <textarea
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={4}
                    placeholder="Paste titles + € prices from eBay sold search…"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold resize-y"
                  />
                </div>
              </div>

              {/* Dealwatch tab — latest snapshot per channel */}
              <div className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-3 ${buyHelperTab === 'dealwatch' ? '' : 'hidden'}`}>
                {(() => {
                  const hist = activeHistory;
                  const latest = hist?.history[hist.history.length - 1];
                  if (!hist || !latest) {
                    return (
                      <p className="text-sm font-semibold text-slate-500">
                        No stored Dealwatch snapshots yet. Press "Refresh all" in the header to fetch eBay sold + live and
                        Kleinanzeigen for every tracked part.
                      </p>
                    );
                  }
                  return (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Latest snapshot · {new Date(latest.timestamp).toLocaleString()}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <DealwatchBucketCard label="eBay sold" bucket={latest.ebaySold} used={false} />
                        <DealwatchBucketCard label="eBay live" bucket={latest.ebayLive} used={false} />
                        <DealwatchBucketCard label="Kleinanzeigen live" bucket={latest.kaLive} used={false} />
                      </div>
                      <p className="text-[10px] font-semibold text-slate-400">
                        {hist.history.length} snapshot{hist.history.length === 1 ? '' : 's'} stored (last 30 days).
                      </p>
                    </>
                  );
                })()}
              </div>

              {/* Analysis tab — percentiles, trend, volatility, velocity */}
              <div className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-3 ${buyHelperTab === 'analysis' ? '' : 'hidden'}`}>
                {!marketAnalysis || (!marketAnalysis.ebaySold && !marketAnalysis.ebayLive && !marketAnalysis.kaLive) ? (
                  <p className="text-sm font-semibold text-slate-500">
                    No history to analyse yet. Refresh a few times over several days to build a trend.
                  </p>
                ) : (
                  ([
                    ['eBay sold', marketAnalysis.ebaySold],
                    ['eBay live', marketAnalysis.ebayLive],
                    ['Kleinanzeigen live', marketAnalysis.kaLive],
                  ] as const).map(([label, signal]) =>
                    !signal ? null : (
                      <div key={label} className="rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
                          <span className="text-[10px] font-black">
                            {signal.trend === 'up' ? '↑ rising' : signal.trend === 'down' ? '↓ falling' : '→ flat'}
                          </span>
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <p className="font-black uppercase tracking-wider text-slate-400">Median</p>
                            <p className="font-bold text-slate-900">{formatEURPrefix(signal.median)}</p>
                          </div>
                          <div>
                            <p className="font-black uppercase tracking-wider text-slate-400">Band</p>
                            <p className="font-bold text-slate-900">
                              {formatEURPrefix(signal.low)}–{formatEURPrefix(signal.high)}
                            </p>
                          </div>
                          <div>
                            <p className="font-black uppercase tracking-wider text-slate-400">Volatility</p>
                            <p className="font-bold text-slate-900">{signal.volatility}%</p>
                          </div>
                          <div>
                            <p className="font-black uppercase tracking-wider text-slate-400">Listings 30d</p>
                            <p className="font-bold text-slate-900">{signal.count30d}</p>
                          </div>
                        </div>
                        <div className="px-3 pb-3 flex flex-wrap gap-3 text-[10px] font-bold text-slate-500">
                          <span>P10 {formatEURPrefix(signal.p10)}</span>
                          <span>P25 {formatEURPrefix(signal.p25)}</span>
                          <span>P75 {formatEURPrefix(signal.p75)}</span>
                          <span>P90 {formatEURPrefix(signal.p90)}</span>
                          <span>σ {signal.stdDev}</span>
                          {signal.source === 'ebay-sold' && signal.velocity > 0 && (
                            <span title="Sold listings per snapshot in the last 7 days vs the 30-day average. 100% = same pace.">
                              pace {signal.velocity}% of 30d avg
                            </span>
                          )}
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>

              {/* History tab — snapshot log */}
              <div className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-2 ${buyHelperTab === 'history' ? '' : 'hidden'}`}>
                {(() => {
                  if (!activeHistory?.history.length) {
                    return <p className="text-sm font-semibold text-slate-500">No snapshots stored yet.</p>;
                  }
                  return [...activeHistory.history].reverse().map((snap) => (
                    <div
                      key={snap.timestamp}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2 text-xs"
                    >
                      <span className="font-bold text-slate-600 shrink-0">
                        {new Date(snap.timestamp).toLocaleDateString()}
                      </span>
                      <span className="font-semibold text-slate-500 text-right">
                        sold {snap.ebaySold?.median != null ? formatEURPrefix(snap.ebaySold.median) : '—'}
                        {' · '}live {snap.ebayLive?.median != null ? formatEURPrefix(snap.ebayLive.median) : '—'}
                        {' · '}KA {snap.kaLive?.median != null ? formatEURPrefix(snap.kaLive.median) : '—'}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default SoldPulsePage;
