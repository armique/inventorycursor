import React, { useMemo, useState } from 'react';
import { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import {
  History,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  Boxes,
  ShoppingBag,
  Layers,
  Filter,
} from 'lucide-react';
import ItemLink from './ItemLink';
import { canUndo } from '../services/actionHistoryOps';

interface Props {
  entries: ActionHistoryEntry[];
  items: InventoryItem[];
  onClear: () => void;
  onRevertTrade?: (entry: ActionHistoryEntry) => void;
  onRevertSale?: (entry: ActionHistoryEntry) => void;
}

type ActionCategory = 'all' | 'prices' | 'bundles' | 'ebay' | 'status' | 'trash';

type ActionTone = { badge: string; dot: string };

function getActionTone(action: string): ActionTone {
  const a = action.toLowerCase();
  if (a.includes('buy price') || a.includes('ek') || a.includes('sell price') || a.includes('vk')) {
    return { badge: 'bg-blue-50 text-blue-900 border-blue-200', dot: 'bg-blue-500' };
  }
  if (a.includes('sold') || a.includes('sale')) {
    return { badge: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-500' };
  }
  if (a.includes('trade')) {
    return { badge: 'bg-purple-50 text-purple-900 border-purple-200', dot: 'bg-purple-500' };
  }
  if (a.includes('bundle') || a.includes('split') || a.includes('pc')) {
    return { badge: 'bg-purple-50 text-purple-900 border-purple-200', dot: 'bg-purple-500' };
  }
  if (a.includes('ebay') || a.includes('abrechnung') || a.includes('linked')) {
    return { badge: 'bg-sky-50 text-sky-900 border-sky-200', dot: 'bg-sky-500' };
  }
  if (a.includes('created') || a.includes('added')) {
    return { badge: 'bg-emerald-50 text-emerald-900 border-emerald-200', dot: 'bg-emerald-500' };
  }
  if (a.includes('trash') || a.includes('deleted')) {
    return { badge: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-500' };
  }
  if (a.includes('revert') || a.includes('undo') || a.includes('redo')) {
    return { badge: 'bg-teal-50 text-teal-900 border-teal-200', dot: 'bg-teal-500' };
  }
  if (a.includes('updated') || a.includes('changed')) {
    return { badge: 'bg-indigo-50 text-indigo-900 border-indigo-200', dot: 'bg-indigo-500' };
  }
  return { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' };
}

function formatWhen(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: iso.slice(0, 10), time: '' };
    return {
      date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  } catch {
    return { date: iso.slice(0, 10), time: '' };
  }
}

function matchesCategory(entry: ActionHistoryEntry, cat: ActionCategory): boolean {
  if (cat === 'all') return true;
  const a = (entry.action || '').toLowerCase();
  const d = (entry.details || '').toLowerCase();
  const combined = `${a} ${d}`;

  if (cat === 'prices') {
    return combined.includes('price') || combined.includes('ek') || combined.includes('vk') || combined.includes('€');
  }
  if (cat === 'bundles') {
    return combined.includes('bundle') || combined.includes('split') || combined.includes('pc') || combined.includes('part');
  }
  if (cat === 'ebay') {
    return combined.includes('ebay') || combined.includes('abrechnung') || combined.includes('order') || combined.includes('linked');
  }
  if (cat === 'status') {
    return combined.includes('status') || combined.includes('sold') || combined.includes('trade') || combined.includes('gift');
  }
  if (cat === 'trash') {
    return combined.includes('trash') || combined.includes('deleted') || combined.includes('restored');
  }
  return true;
}

function matchesFilter(entry: ActionHistoryEntry, query: string, cat: ActionCategory): boolean {
  if (!matchesCategory(entry, cat)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.action, entry.itemName, entry.details, entry.timestamp]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

const ActionHistoryPage: React.FC<Props> = ({ entries, items, onClear, onRevertTrade, onRevertSale }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ActionCategory>('all');

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [entries]
  );

  const filtered = useMemo(
    () => sorted.filter((e) => matchesFilter(e, query, category)),
    [sorted, query, category]
  );

  const counts = useMemo(() => {
    return {
      all: sorted.length,
      prices: sorted.filter((e) => matchesCategory(e, 'prices')).length,
      bundles: sorted.filter((e) => matchesCategory(e, 'bundles')).length,
      ebay: sorted.filter((e) => matchesCategory(e, 'ebay')).length,
      status: sorted.filter((e) => matchesCategory(e, 'status')).length,
      trash: sorted.filter((e) => matchesCategory(e, 'trash')).length,
    };
  }, [sorted]);

  return (
    <div className="w-full min-w-0 -mx-2 sm:-mx-4 md:-mx-6 lg:-mx-8 px-2 sm:px-4 md:px-6 lg:px-8 pb-10 animate-in fade-in duration-300">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-slate-900 text-white shrink-0 shadow-lg shadow-slate-900/15">
            <History size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Action History</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Detailed audit log — buying & selling prices, bundle/split events, eBay links, and status changes
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-wide">
            {filtered.length} / {sorted.length} rows
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Clear all action history? This cannot be undone.')) onClear();
            }}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-red-700 border border-red-200 hover:bg-red-50 font-bold text-sm shadow-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 size={16} />
            Clear history
          </button>
        </div>
      </header>

      {/* Quick Filter Categories & Search Bar */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setCategory('prices')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'prices'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
            }`}
          >
            <TrendingUp size={13} />
            Price Changes ({counts.prices})
          </button>
          <button
            type="button"
            onClick={() => setCategory('bundles')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'bundles'
                ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
            }`}
          >
            <Boxes size={13} />
            Bundles & Splits ({counts.bundles})
          </button>
          <button
            type="button"
            onClick={() => setCategory('ebay')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'ebay'
                ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                : 'bg-white text-sky-700 border-sky-200 hover:bg-sky-50'
            }`}
          >
            <ShoppingBag size={13} />
            eBay Links ({counts.ebay})
          </button>
          <button
            type="button"
            onClick={() => setCategory('status')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'status'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
            }`}
          >
            <Layers size={13} />
            Status & Sales ({counts.status})
          </button>
          <button
            type="button"
            onClick={() => setCategory('trash')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
              category === 'trash'
                ? 'bg-red-600 text-white border-red-600 shadow-sm'
                : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
            }`}
          >
            <Trash2 size={13} />
            Trash & Restores ({counts.trash})
          </button>
        </div>

        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by action, item name, price delta, or order ID…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-20 px-6 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-slate-50 text-slate-300 mb-4">
              <History size={32} />
            </div>
            <p className="font-black text-slate-700 text-lg">No actions recorded yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Price adjustments, bundle conversions, eBay links, and sales will automatically generate detailed audit records here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3.5 w-[150px] whitespace-nowrap">Date & time</th>
                  <th className="px-4 py-3.5 w-[240px]">Action</th>
                  <th className="px-4 py-3.5 min-w-[200px]">Item</th>
                  <th className="px-4 py-3.5 min-w-[300px]">Details & Diffs</th>
                  <th className="px-4 py-3.5 w-[130px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center text-sm font-bold text-slate-400">
                      No rows match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, index) => {
                    const when = formatWhen(e.timestamp);
                    const tone = getActionTone(e.action);
                    const isTradeCompleted =
                      e.action === 'Trade completed' && Boolean(e.itemId) && Boolean(onRevertTrade);
                    const isSale = e.action.includes('Sold') && Boolean(e.itemId) && Boolean(onRevertSale);
                    const outgoing =
                      isTradeCompleted || isSale ? items.find((i) => i.id === e.itemId) : undefined;
                    const canRevertTrade = outgoing?.status === ItemStatus.TRADED;
                    const canRevertSale = outgoing?.status === ItemStatus.SOLD;
                    const undoGuard = canUndo(e, sorted, items);

                    return (
                      <tr
                        key={e.id}
                        className={`border-b border-slate-100 align-top transition-colors hover:bg-indigo-50/40 ${
                          index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                        }`}
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <p className="text-xs font-bold text-slate-800 tabular-nums">{when.date}</p>
                          <p className="text-[11px] font-semibold text-slate-400 tabular-nums mt-0.5">{when.time}</p>
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide leading-tight ${tone.badge}`}
                            title={e.action}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
                            <span className="break-words">{e.action}</span>
                          </span>
                        </td>

                        <td className="px-4 py-3.5">
                          {e.itemName ? (
                            e.itemId ? (
                              <ItemLink
                                itemId={e.itemId}
                                itemName={e.itemName}
                                items={items}
                                className="text-sm font-bold text-slate-900 hover:text-indigo-600 hover:underline leading-snug block truncate"
                              />
                            ) : (
                              <p className="text-sm font-bold text-slate-900 leading-snug" title={e.itemName}>
                                {e.itemName}
                              </p>
                            )
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          {e.details || e.notes ? (
                            <p className="text-sm font-medium text-slate-700 leading-relaxed break-words" title={e.notes || e.details}>
                              {e.notes || e.details}
                            </p>
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                          {e.operationLabel ? (
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1">
                              Op: {e.operationLabel}
                            </p>
                          ) : null}
                          {!undoGuard.ok ? (
                            <p className="text-[11px] font-semibold text-amber-700 mt-1.5 leading-snug">
                              {undoGuard.reason}
                            </p>
                          ) : null}
                        </td>

                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {isTradeCompleted && onRevertTrade && (
                            <button
                              type="button"
                              disabled={!canRevertTrade || !undoGuard.ok}
                              title={
                                !undoGuard.ok
                                  ? undoGuard.reason
                                  : canRevertTrade
                                    ? 'Undo this trade'
                                    : 'Item is no longer in Traded status'
                              }
                              onClick={() => onRevertTrade(e)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 disabled:opacity-40"
                            >
                              <RotateCcw size={13} />
                              Revert trade
                            </button>
                          )}
                          {isSale && onRevertSale && (
                            <button
                              type="button"
                              disabled={!canRevertSale || !undoGuard.ok}
                              title={
                                !undoGuard.ok
                                  ? undoGuard.reason
                                  : canRevertSale
                                    ? 'Undo this sale'
                                    : 'Item is no longer in Sold status'
                              }
                              onClick={() => onRevertSale(e)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                            >
                              <RotateCcw size={13} />
                              Revert sale
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionHistoryPage;
