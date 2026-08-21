import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
} from 'lucide-react';
import { InventoryItem, ItemUpdateOptions, TaxMode } from '../types';
import { loadOrdersForSalesSync, runEbaySalesSync, peekEbaySalesSync, invalidateEbaySalesSyncPeekCache } from '../services/ebaySalesSync';
import { hydrateHubArchiveIndex } from '../services/ebayHubArchiveIndex';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { applyEbaySaleAdjustmentToItem, isRestockAfterRefundAdjustment, getAdjustmentSuggestionLabel, getAdjustmentSuggestionBadgeClass, summarizeAdjustmentSuggestions, isRefundLikeAdjustmentKind } from '../utils/ebaySaleAdjustments';
import {
  buildOrderLinkAnalysis,
  type OrderLinkSuggestion,
  type OrderLinkSuggestionKind,
} from '../utils/ebayOrderLinkAnalysis';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import EbayToolSearchInput from './EbayToolSearchInput';
import EbaySalesMatchReviewModal from './EbaySalesMatchReviewModal';

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
  onCacheUpdated?: () => void;
  /** Bump when order cache changes (CSV import, API backfill, clear) to re-run matching. */
  cacheVersion?: number;
  onRematchComplete?: (info: { orderCount: number; suggestionCount: number }) => void;
}

type FilterKind = 'all' | OrderLinkSuggestionKind;

function matchKindLabel(kind: OrderLinkSuggestion['match']['matchKind']): string {
  if (kind === 'listingId') return 'Listing';
  if (kind === 'sku') return 'SKU';
  return 'Title';
}

function isRestockRow(row: OrderLinkSuggestion): boolean {
  return Boolean(row.adjustment && isRestockAfterRefundAdjustment(row.adjustment));
}

function kindLabel(kind: OrderLinkSuggestionKind, row?: OrderLinkSuggestion): string {
  if (kind === 'mark_sold') return 'Mark sold';
  if (kind === 'link') return 'Link order';
  if (kind === 'adjustment' && row?.adjustment) return getAdjustmentSuggestionLabel(row.adjustment);
  if (kind === 'adjustment') return 'Adjustment';
  return 'Fix payout';
}

function kindBadgeClass(kind: OrderLinkSuggestionKind, row?: OrderLinkSuggestion): string {
  if (kind === 'mark_sold') return 'bg-emerald-100 text-emerald-800';
  if (kind === 'link') return 'bg-blue-100 text-blue-800';
  if (kind === 'adjustment' && row?.adjustment) return getAdjustmentSuggestionBadgeClass(row.adjustment);
  if (kind === 'adjustment') return 'bg-rose-100 text-rose-900';
  return 'bg-amber-100 text-amber-900';
}

function suggestionSearchHaystack(row: OrderLinkSuggestion): Array<string | number | null | undefined> {
  const { item, match, adjustmentReason } = row;
  const { order, lineItem } = match;
  return [
    item.name,
    item.ebaySku,
    item.ebayOrderId,
    item.ebayListingId,
    item.sellDate,
    order.orderId,
    order.buyer.username,
    order.buyer.fullName,
    lineItem.title,
    lineItem.sku,
    lineItem.listingId,
    adjustmentReason,
    row.adjustment?.reason,
  ];
}

const EbaySalesSyncPanel: React.FC<Props> = ({
  items,
  taxMode,
  onUpdate,
  onCacheUpdated,
  cacheVersion = 0,
  onRematchComplete,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestions, setSuggestions] = useState<OrderLinkSuggestion[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof peekEbaySalesSync>['stats'] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<FilterKind>('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewRow, setReviewRow] = useState<OrderLinkSuggestion | null>(null);
  const autoRanRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const applyAnalysis = useCallback(
    (result: ReturnType<typeof peekEbaySalesSync>, info?: string) => {
      setSuggestions(result.suggestions);
      setStats(result.stats);
      const nextSelected: Record<string, boolean> = {};
      for (const s of result.suggestions) nextSelected[s.id] = true;
      setSelected(nextSelected);
      setDismissed(new Set());
      setReviewRow(null);
      const adj = summarizeAdjustmentSuggestions(result.suggestions);
      const parts: string[] = [];
      if (result.stats.markSoldCandidates) parts.push(`${result.stats.markSoldCandidates} to mark sold`);
      if (result.stats.linkCandidates) parts.push(`${result.stats.linkCandidates} to link`);
      if (result.stats.repriceCandidates) parts.push(`${result.stats.repriceCandidates} to reprice`);
      if (adj.refundLike) parts.push(`${adj.refundLike} return/refund`);
      if (adj.restock) parts.push(`${adj.restock} restock after refund`);
      if (adj.payoutFix) parts.push(`${adj.payoutFix} payout fix`);
      if (adj.fee) parts.push(`${adj.fee} fee note`);
      setMessage(
        info ||
          (result.suggestions.length
            ? `Found ${result.suggestions.length} suggestion(s)${parts.length ? ` — ${parts.join(', ')}` : ''}.`
            : 'All caught up — no inventory rows need updating against Hub orders.')
      );
    },
    []
  );

  const runSync = useCallback(
    async (skipFetch = false) => {
      setSyncing(true);
      setError(null);
      setMessage(null);
      try {
        const before = loadOrdersForSalesSync();
        if (!before.length) {
          setError(
            'No Seller Hub orders yet — load ebay-order-archive.json below, or fetch new Hub orders (needs debug Chrome).'
          );
          return;
        }

        const result = await runEbaySalesSync(items, { skipFetch: true });
        applyAnalysis(
          result.analysis,
          `Matched ${before.length} Hub order(s) · ${result.analysis.suggestions.length} suggestion(s).`
        );
        if (!skipFetch) onCacheUpdated?.();
      } catch (e: unknown) {
        setError((e as Error)?.message || 'Sales sync failed.');
      } finally {
        setSyncing(false);
      }
    },
    [items, applyAnalysis, onCacheUpdated]
  );

  const rematchFromCache = useCallback(
    (infoPrefix?: string) => {
      invalidateEbaySalesSyncPeekCache();
      const orders = loadOrdersForSalesSync();
      if (!orders.length) {
        applyAnalysis(
          buildOrderLinkAnalysis(itemsRef.current, []),
          infoPrefix || 'Hub ledger is empty — load the dump or fetch new Hub orders below.'
        );
        onRematchComplete?.({ orderCount: 0, suggestionCount: 0 });
        return;
      }
      const result = peekEbaySalesSync(itemsRef.current);
      const parts: string[] = [];
      if (result.stats.markSoldCandidates) parts.push(`${result.stats.markSoldCandidates} to mark sold`);
      if (result.stats.linkCandidates) parts.push(`${result.stats.linkCandidates} to link`);
      if (result.stats.repriceCandidates) parts.push(`${result.stats.repriceCandidates} to reprice`);
      const adj = summarizeAdjustmentSuggestions(result.suggestions);
      if (adj.refundLike) parts.push(`${adj.refundLike} return/refund`);
      if (adj.restock) parts.push(`${adj.restock} restock after refund`);
      if (adj.payoutFix) parts.push(`${adj.payoutFix} payout fix`);
      if (adj.fee) parts.push(`${adj.fee} fee note`);
      const detail =
        result.suggestions.length && parts.length ? ` — ${parts.join(', ')}` : '';
      applyAnalysis(
        result,
        infoPrefix ||
          (result.suggestions.length
            ? `Matched ${orders.length} Hub order(s) · ${result.suggestions.length} suggestion(s) to review${detail}.`
            : `Matched ${orders.length} Hub order(s) — no inventory rows need updating.`)
      );
      onRematchComplete?.({ orderCount: orders.length, suggestionCount: result.suggestions.length });
    },
    [applyAnalysis, onRematchComplete]
  );

  // On open: analyze cache once when idle — skip auto-run for very large caches (user clicks Re-match).
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled || autoRanRef.current) return;
      autoRanRef.current = true;
      const orders = loadOrdersForSalesSync();
      if (!orders.length) return;
      if (orders.length > 400) {
        setMessage(
          `Large Hub ledger (${orders.length}) — click “Match inventory” when you want suggestions (avoids freezing on open).`
        );
        return;
      }
      rematchFromCache();
    };
    void hydrateHubArchiveIndex().then(() => {
      if (cancelled) return;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 4000 });
        return;
      }
      window.setTimeout(run, 600);
    });
    return () => {
      cancelled = true;
    };
  }, [rematchFromCache]);

  // Explicit rematch when parent bumps cache (CSV import, API backfill, clear).
  const lastCacheVersionRef = useRef(cacheVersion);
  useEffect(() => {
    if (cacheVersion === 0 || cacheVersion === lastCacheVersionRef.current) return;
    lastCacheVersionRef.current = cacheVersion;
    rematchFromCache();
  }, [cacheVersion, rematchFromCache]);

  // Debounced rematch when order cache changes elsewhere (avoids storm during cloud hydrate).
  useEffect(() => {
    let timer: number | null = null;
    const refreshFromCache = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => rematchFromCache(), 750);
    };
    window.addEventListener('ebay-order-index-updated', refreshFromCache);
    window.addEventListener('ebay-hub-archive-updated', refreshFromCache);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener('ebay-order-index-updated', refreshFromCache);
      window.removeEventListener('ebay-hub-archive-updated', refreshFromCache);
    };
  }, [rematchFromCache]);

  const visible = useMemo(() => {
    return suggestions.filter((s) => {
      if (dismissed.has(s.id)) return false;
      if (filter !== 'all' && s.kind !== filter) return false;
      return matchesEbayToolSearch(search, suggestionSearchHaystack(s));
    });
  }, [suggestions, dismissed, filter, search]);

  const activeBeforeSearch = useMemo(() => {
    return suggestions.filter((s) => {
      if (dismissed.has(s.id)) return false;
      if (filter === 'all') return true;
      return s.kind === filter;
    });
  }, [suggestions, dismissed, filter]);

  const selectedVisible = visible.filter((s) => selected[s.id]);


  const counts = useMemo(() => {
    const active = suggestions.filter((s) => !dismissed.has(s.id));
    const summary = summarizeAdjustmentSuggestions(active);
    return {
      all: active.length,
      mark_sold: active.filter((s) => s.kind === 'mark_sold').length,
      link: active.filter((s) => s.kind === 'link').length,
      adjustment: active.filter((s) => s.kind === 'adjustment').length,
      refund: summary.refundLike + summary.restock,
      reprice: active.filter((s) => s.kind === 'reprice').length,
    };
  }, [suggestions, dismissed]);

  const applySuggestions = async (rows: OrderLinkSuggestion[]) => {
    if (!rows.length) return;
    setApplying(true);
    setError(null);
    try {
      const byId = new Map(items.map((i) => [i.id, i]));
      const updated = new Map<string, InventoryItem>();
      const detailsByItemId: Record<string, string> = {};
      for (const row of rows) {
        const current = byId.get(row.item.id) ?? updated.get(row.item.id) ?? row.item;
        if (row.kind === 'adjustment' && row.adjustment) {
          const next = applyEbaySaleAdjustmentToItem(current, row.adjustment, taxMode);
          updated.set(row.item.id, next);
          const fee = row.adjustment.buyPriceDelta;
          const label = getAdjustmentSuggestionLabel(row.adjustment);
          const oid = row.adjustment.orderId || row.match.order?.orderId || '—';
          detailsByItemId[row.item.id] =
            fee != null && fee > 0
              ? `${label} · +€${formatEUR(fee)} EK · #${oid}`
              : `${label} · #${oid}`;
        } else {
          updated.set(row.item.id, applyEbayOrderMatchToItem(current, row.match, taxMode));
          detailsByItemId[row.item.id] = `${kindLabel(row.kind, row)} · #${row.match.order?.orderId || '—'}`;
        }
      }
      const restocked = rows.some((r) => isRestockRow(r));
      onUpdate([...updated.values()], undefined, {
        flushCloud: true,
        skipFieldPreserve: restocked,
        actionNote: {
          action: restocked
            ? 'eBay cancellation / restock applied'
            : 'eBay Hub match applied',
          detailsByItemId,
        },
      });
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const row of rows) next.add(row.id);
        return next;
      });
      const marked = rows.filter((r) => r.kind === 'mark_sold').length;
      const restockCount = rows.filter((r) => isRestockRow(r)).length;
      const adjusted = rows.filter((r) => r.kind === 'adjustment' && !isRestockRow(r)).length;
      setMessage(
        `Applied ${rows.length} row(s)${marked ? ` — ${marked} marked sold` : ''}${restockCount ? ` — ${restockCount} restocked after refund` : ''}${adjusted ? ` — ${adjusted} adjustment(s) documented` : ''}.`
      );
      setReviewRow(null);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Apply failed.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      id="ebay-sales-sync-panel"
      className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50/80 to-white p-4 xl:p-5 flex flex-col min-h-[min(720px,calc(100vh-10rem))] gap-4 shadow-sm"
    >
      <div className="shrink-0 flex flex-wrap items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0">
          <ShoppingBag size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-slate-900">eBay sales sync</h3>
          <p className="text-xs text-slate-600 mt-1">
            Matches inventory to the <span className="font-bold">Seller Hub ledger</span> — buyer total, shipping,
            ads, eBay fee, label, and net. Catches items you{' '}
            <span className="font-bold">forgot to mark sold</span>, links missing order IDs, and documents{' '}
            <span className="font-bold">returns and refunds</span>. Nothing applies until you confirm. New Hub
            sales come from the bookmarklet in the ledger below — not the eBay API.
          </p>
        </div>
      </div>

      {stats && (
        <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'Hub orders', value: stats.cachedOrders },
            { label: 'In stock', value: stats.inStockItems },
            { label: 'Mark sold', value: counts.mark_sold, highlight: counts.mark_sold > 0 },
            { label: 'Link order', value: counts.link, highlight: counts.link > 0 },
            { label: 'Refunds', value: counts.refund, highlight: counts.refund > 0 },
            { label: 'Fix payout', value: counts.reprice, highlight: counts.reprice > 0 },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-lg border p-2.5 ${
                s.highlight ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
              }`}
            >
              <p className="text-[9px] font-black uppercase text-slate-400">{s.label}</p>
              <p className={`text-lg font-black ${s.highlight ? 'text-emerald-700' : 'text-slate-900'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runSync(true)}
          disabled={syncing || applying}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {syncing ? 'Matching…' : 'Match inventory'}
        </button>
        {suggestions.length > 0 && (
          <>
            {(['all', 'mark_sold', 'link', 'adjustment', 'reprice'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setFilter(kind)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border ${
                  filter === kind
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {kind === 'all'
                  ? `All (${counts.all})`
                  : kind === 'mark_sold'
                    ? `Mark sold (${counts.mark_sold})`
                    : kind === 'link'
                      ? `Link (${counts.link})`
                      : kind === 'adjustment'
                        ? `Adjustments (${counts.adjustment})`
                      : `Payout (${counts.reprice})`}
              </button>
            ))}
            <button
              type="button"
              disabled={applying || selectedVisible.length === 0}
              onClick={() => void applySuggestions(selectedVisible)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 ml-auto"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Apply selected ({selectedVisible.length})
            </button>
          </>
        )}
      </div>

      {suggestions.length > 0 && (
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search item, order ID, buyer, SKU, listing…"
          matchCount={visible.length}
          totalCount={activeBeforeSearch.length}
        />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {message && !error && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          {message}
        </div>
      )}

      {visible.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <p className="shrink-0 text-[11px] text-slate-500 px-1">
            Click an item name, order ID, or <span className="font-bold text-indigo-700">Review match</span> to compare inventory vs eBay order before applying.
          </p>
          <div className="flex-1 min-h-[280px] overflow-y-auto pr-1 space-y-2">
          {visible.map((row) => {
            const { item, match, kind } = row;
            const { order, lineItem, matchKind } = match;
            return (
              <div
                key={row.id}
                className={`rounded-xl border p-3 space-y-2 xl:space-y-0 xl:grid xl:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,17rem)] xl:gap-4 xl:items-center ${
                  selected[row.id] ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3 xl:contents">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.id])}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                    className="mt-1 shrink-0 xl:mt-2"
                  />
                  <div className="flex-1 min-w-0 space-y-1 xl:col-span-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${kindBadgeClass(kind, row)}`}>
                        {kindLabel(kind, row)}
                      </span>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {matchKindLabel(matchKind)} · {row.totalScore}
                      </span>
                      {kind === 'mark_sold' && (
                        <span className="text-[9px] font-bold uppercase text-emerald-700">In stock → sold</span>
                      )}
                      {isRestockRow(row) && (
                        <span className="text-[9px] font-bold uppercase text-indigo-700">Sold → in stock · EK + fee</span>
                      )}
                      {kind === 'adjustment' && row.adjustment && isRefundLikeAdjustmentKind(row.adjustment.kind) && (
                        <span className="text-[9px] font-bold uppercase text-rose-700">Document refund</span>
                      )}
                      {kind === 'adjustment' && row.adjustment?.kind === 'payout_correction' && (
                        <span className="text-[9px] font-bold uppercase text-amber-700">Match CSV net</span>
                      )}
                    </div>
                    {row.adjustmentReason && (
                      <p
                        className={`text-[11px] font-bold rounded-lg px-2 py-1 border ${
                          row.adjustment && isRefundLikeAdjustmentKind(row.adjustment.kind)
                            ? 'text-rose-800 bg-rose-50 border-rose-100'
                            : 'text-amber-900 bg-amber-50 border-amber-100'
                        }`}
                      >
                        {row.adjustmentReason}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setReviewRow(row)}
                      className="text-sm font-black text-slate-900 hover:text-indigo-600 text-left truncate block max-w-full"
                    >
                      {item.name}
                    </button>
                    <p className="text-[11px] text-slate-500 line-clamp-2 xl:line-clamp-3">{lineItem.title}</p>
                    <p className="text-[11px] text-slate-500">
                      Order{' '}
                      <button
                        type="button"
                        onClick={() => setReviewRow(row)}
                        className="font-bold text-indigo-700 hover:underline"
                      >
                        {order.orderId}
                      </button>
                      {order.creationDate ? ` · ${order.creationDate}` : ''}
                      {item.sellDate ? ` · sold ${item.sellDate}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5 xl:col-span-1 xl:self-center">
                    {isRestockRow(row) ? (
                      <>
                        <p className="text-[9px] font-black uppercase text-slate-400">Buy price (EK)</p>
                        <p className="text-xs text-slate-500 tabular-nums">€{formatEUR(item.buyPrice)}</p>
                        <p className="text-sm font-black text-indigo-700 tabular-nums flex items-center justify-end gap-1">
                          <ArrowRight size={12} className="text-slate-400" />
                          €{formatEUR(row.suggestedBuyPrice ?? item.buyPrice)}
                        </p>
                        {row.adjustment?.buyPriceDelta != null && row.adjustment.buyPriceDelta > 0 && (
                          <p className="text-[10px] font-bold text-rose-600 tabular-nums">
                            +€{formatEUR(row.adjustment.buyPriceDelta)} fee
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-[9px] font-black uppercase text-slate-400">Payout</p>
                        {kind !== 'mark_sold' && (
                          <p className="text-xs text-slate-500 tabular-nums">
                            {row.currentSellPrice != null ? `€${formatEUR(row.currentSellPrice)}` : '—'}
                          </p>
                        )}
                        <p className="text-sm font-black text-emerald-700 tabular-nums flex items-center justify-end gap-1">
                          {kind !== 'mark_sold' && row.currentSellPrice != null && (
                            <ArrowRight size={12} className="text-slate-400" />
                          )}
                          €{formatEUR(row.suggestedSellPrice)}
                        </p>
                        {!row.netKnown && (
                          <p className="text-[9px] font-bold text-amber-700">Gross (import Payments CSV)</p>
                        )}
                        {row.priceDelta != null && Math.abs(row.priceDelta) >= 0.02 && kind !== 'mark_sold' && (
                          <p
                            className={`text-[10px] font-bold tabular-nums ${
                              row.priceDelta < 0 ? 'text-red-600' : 'text-emerald-600'
                            }`}
                          >
                            {row.priceDelta > 0 ? '+' : ''}€{formatEUR(row.priceDelta)}
                          </p>
                        )}
                        {row.grossAmount != null &&
                          row.netAmount != null &&
                          row.grossAmount > row.netAmount && (
                            <p className="text-[10px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1">
                              <TrendingDown size={11} className="shrink-0" />
                              Fees €{formatEUR(row.grossAmount - row.netAmount)}
                            </p>
                          )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-nowrap items-center gap-2 pl-7 xl:pl-0 xl:col-span-1 xl:justify-end xl:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => setReviewRow(row)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase hover:bg-indigo-700"
                  >
                    Review match
                  </button>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => void applySuggestions([row])}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isRestockRow(row)
                      ? 'Restock & apply fee'
                      : kind === 'adjustment'
                        ? 'Apply adjustment'
                        : kind === 'mark_sold'
                          ? 'Mark sold & apply'
                          : 'Apply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissed((prev) => new Set(prev).add(row.id))}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {suggestions.length > 0 && visible.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-6">
          {search.trim() ? 'No suggestions match your search — try order ID, buyer name, or item title.' : 'All suggestions dismissed. Run sync again anytime.'}
        </p>
      )}

      {suggestions.length === 0 && (stats?.cachedOrders ?? 0) === 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-5 text-center space-y-2">
          <p className="text-sm font-bold text-indigo-950">No Seller Hub orders yet</p>
          <p className="text-xs text-indigo-900/80 max-w-lg mx-auto">
            Load <span className="font-mono">ebay-order-archive.json</span> below, or fetch new Hub sales (debug Chrome
            logged into eBay.de). That ledger is the Finanzamt record — not the API.
          </p>
        </div>
      )}

      {suggestions.length === 0 && (stats?.cachedOrders ?? 0) > 0 && (
        <p className="text-sm text-slate-500 text-center py-6">
          All caught up — no inventory rows need updating against Hub orders.
        </p>
      )}

      {reviewRow && (
        <EbaySalesMatchReviewModal
          row={reviewRow}
          applying={applying}
          onClose={() => setReviewRow(null)}
          onApply={(r) => void applySuggestions([r])}
          onDismiss={(r) => setDismissed((prev) => new Set(prev).add(r.id))}
        />
      )}
    </div>
  );
};

export default EbaySalesSyncPanel;
