import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  TrendingDown,
} from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import {
  buildOrderLinkAnalysis,
  type OrderLinkSuggestion,
  type OrderLinkSuggestionKind,
} from '../utils/ebayOrderLinkAnalysis';
import { formatEUR } from '../utils/formatMoney';
import ItemLink from './ItemLink';

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
}

type FilterKind = 'all' | OrderLinkSuggestionKind;

function matchKindLabel(kind: OrderLinkSuggestion['match']['matchKind']): string {
  if (kind === 'listingId') return 'Listing';
  if (kind === 'sku') return 'SKU';
  return 'Title';
}

const EbayOrderLinkAnalysisPanel: React.FC<Props> = ({ items, taxMode, onUpdate }) => {
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestions, setSuggestions] = useState<OrderLinkSuggestion[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof buildOrderLinkAnalysis>['stats'] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<FilterKind>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(() => {
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const { orders } = loadEbayOrderIndex();
      if (!orders.length) {
        setSuggestions([]);
        setStats(null);
        setError('No cached orders yet — run API backfill or import a CSV first.');
        return;
      }
      const result = buildOrderLinkAnalysis(items, orders);
      setSuggestions(result.suggestions);
      setStats(result.stats);
      const nextSelected: Record<string, boolean> = {};
      for (const s of result.suggestions) nextSelected[s.id] = true;
      setSelected(nextSelected);
      setDismissed(new Set());
      setMessage(
        result.suggestions.length
          ? `Found ${result.suggestions.length} suggestion(s) — review and apply.`
          : 'No new matches found. Items may already be linked or need a Payments CSV for net payout data.'
      );
    } finally {
      setRunning(false);
    }
  }, [items]);

  const visible = useMemo(() => {
    return suggestions.filter((s) => {
      if (dismissed.has(s.id)) return false;
      if (filter === 'all') return true;
      return s.kind === filter;
    });
  }, [suggestions, dismissed, filter]);

  const selectedVisible = visible.filter((s) => selected[s.id]);

  const applySuggestions = async (rows: OrderLinkSuggestion[]) => {
    if (!rows.length) return;
    setApplying(true);
    setError(null);
    try {
      const byId = new Map(items.map((i) => [i.id, i]));
      const updated = new Map<string, InventoryItem>();
      for (const row of rows) {
        const current = byId.get(row.item.id) ?? updated.get(row.item.id) ?? row.item;
        updated.set(row.item.id, applyEbayOrderMatchToItem(current, row.match, taxMode));
      }
      onUpdate([...updated.values()]);
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const row of rows) next.add(row.id);
        return next;
      });
      setMessage(`Applied ${rows.length} order link(s) — sell price set to payout (net when available).`);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Apply failed.');
    } finally {
      setApplying(false);
    }
  };

  const linkCount = suggestions.filter((s) => s.kind === 'link' && !dismissed.has(s.id)).length;
  const repriceCount = suggestions.filter((s) => s.kind === 'reprice' && !dismissed.has(s.id)).length;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-5 space-y-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-700 shrink-0">
          <Link2 size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-slate-900">Match sold inventory to cached orders</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Scans your <span className="font-bold text-slate-700">sold eBay items</span> against the order cache.
            Skips rows that already have an order ID linked (unless the stored sell price differs from the payout).
            On apply, sell price is set to the <span className="font-bold">net payout</span> when Payments CSV data
            exists — otherwise gross from the API. Import a Payments CSV to fix ad-fee / tax deductions.
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Cached orders', value: stats.cachedOrders },
            { label: 'Sold eBay items', value: stats.soldEbayItems },
            { label: 'Missing order ID', value: stats.unlinkedSold },
            { label: 'Orders with net data', value: stats.netDataOrders },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
              <p className="text-[9px] font-black uppercase text-slate-400">{s.label}</p>
              <p className="text-lg font-black text-slate-900">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running || applying}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {running ? 'Analyzing…' : 'Run order match analysis'}
        </button>
        {suggestions.length > 0 && (
          <>
            {(['all', 'link', 'reprice'] as const).map((kind) => (
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
                {kind === 'all' ? `All (${linkCount + repriceCount})` : kind === 'link' ? `Link (${linkCount})` : `Reprice (${repriceCount})`}
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

      {stats && stats.netDataOrders === 0 && stats.cachedOrders > 0 && (
        <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No net payout data in cache yet — API orders only have gross amounts. Import{' '}
          <span className="font-black">Seller Hub → Payments → All transactions</span> CSV (Path B) to get the
          real bottom-line payout after ad fees and taxes.
        </p>
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
        <div className="space-y-2 max-h-[min(520px,55vh)] overflow-y-auto pr-1">
          {visible.map((row) => {
            const { item, match, kind } = row;
            const { order, lineItem, matchKind } = match;
            return (
              <div
                key={row.id}
                className={`rounded-xl border p-3 space-y-2 ${
                  selected[row.id] ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.id])}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                    className="mt-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                          kind === 'link'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {kind === 'link' ? 'Link order' : 'Update payout'}
                      </span>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {matchKindLabel(matchKind)} · {row.totalScore}
                      </span>
                    </div>
                    <ItemLink
                      item={item}
                      itemName={item.name}
                      className="text-sm font-black text-slate-900 hover:text-indigo-600 hover:underline truncate block"
                    />
                    <p className="text-[11px] text-slate-500 line-clamp-2">{lineItem.title}</p>
                    <p className="text-[11px] text-slate-500">
                      Order <span className="font-bold text-slate-700">{order.orderId}</span>
                      {order.creationDate ? ` · ${order.creationDate}` : ''}
                      {item.sellDate ? ` · sold ${item.sellDate}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-[9px] font-black uppercase text-slate-400">Sell price</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {row.currentSellPrice != null ? `€${formatEUR(row.currentSellPrice)}` : '—'}
                    </p>
                    <p className="text-sm font-black text-emerald-700 tabular-nums flex items-center justify-end gap-1">
                      <ArrowRight size={12} className="text-slate-400" />
                      €{formatEUR(row.suggestedSellPrice)}
                    </p>
                    {!row.netKnown && (
                      <p className="text-[9px] font-bold text-amber-700">Gross (no net in cache)</p>
                    )}
                    {row.priceDelta != null && Math.abs(row.priceDelta) >= 0.02 && (
                      <p className={`text-[10px] font-bold tabular-nums ${row.priceDelta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {row.priceDelta > 0 ? '+' : ''}€{formatEUR(row.priceDelta)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => void applySuggestions([row])}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissed((prev) => new Set(prev).add(row.id))}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                  {row.netAmount != null && row.grossAmount != null && row.grossAmount > row.netAmount && (
                    <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                      <TrendingDown size={11} />
                      Fees €{formatEUR(row.grossAmount - row.netAmount)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {suggestions.length > 0 && visible.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-6">All suggestions dismissed. Run analysis again anytime.</p>
      )}

      <button
        type="button"
        onClick={runAnalysis}
        disabled={running}
        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 hover:text-slate-600"
      >
        <RefreshCw size={12} />
        Re-run after applying or importing Payments CSV
      </button>
    </div>
  );
};

export default EbayOrderLinkAnalysisPanel;
