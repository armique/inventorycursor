import React, { useMemo, useState } from 'react';
import { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import { History, RotateCcw, Search, Trash2 } from 'lucide-react';
import ItemLink from './ItemLink';

interface Props {
  entries: ActionHistoryEntry[];
  items: InventoryItem[];
  onClear: () => void;
  onRevertTrade?: (entry: ActionHistoryEntry) => void;
  onRevertSale?: (entry: ActionHistoryEntry) => void;
}

type ActionTone = { badge: string; dot: string };

function getActionTone(action: string): ActionTone {
  const a = action.toLowerCase();
  if (a.includes('sold') || a.includes('sale')) {
    return { badge: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-500' };
  }
  if (a.includes('trade')) {
    return { badge: 'bg-purple-50 text-purple-900 border-purple-200', dot: 'bg-purple-500' };
  }
  if (a.includes('created') || a.includes('added')) {
    return { badge: 'bg-emerald-50 text-emerald-900 border-emerald-200', dot: 'bg-emerald-500' };
  }
  if (a.includes('trash') || a.includes('deleted')) {
    return { badge: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-500' };
  }
  if (a.includes('revert') || a.includes('undo') || a.includes('redo')) {
    return { badge: 'bg-sky-50 text-sky-900 border-sky-200', dot: 'bg-sky-500' };
  }
  if (a.includes('updated') || a.includes('changed')) {
    return { badge: 'bg-blue-50 text-blue-900 border-blue-200', dot: 'bg-blue-500' };
  }
  return { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' };
}

function formatWhen(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function matchesFilter(entry: ActionHistoryEntry, query: string): boolean {
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

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [entries]
  );

  const filtered = useMemo(() => sorted.filter((e) => matchesFilter(e, query)), [sorted, query]);

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
              Audit log — every inventory change with timestamp, item, and details
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

      <div className="mb-4 relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by action, item, or details…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-20 px-6 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-slate-50 text-slate-300 mb-4">
              <History size={32} />
            </div>
            <p className="font-black text-slate-700 text-lg">No actions recorded yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Edits, sales, trades, and other important changes will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3.5 w-[150px] whitespace-nowrap">Date & time</th>
                  <th className="px-4 py-3.5 w-[220px]">Action</th>
                  <th className="px-4 py-3.5 min-w-[180px]">Item</th>
                  <th className="px-4 py-3.5 min-w-[280px]">Details</th>
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
                          {e.details ? (
                            <p className="text-sm text-slate-600 leading-relaxed break-words" title={e.details}>
                              {e.details}
                            </p>
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {isTradeCompleted && onRevertTrade && (
                            <button
                              type="button"
                              disabled={!canRevertTrade}
                              title={canRevertTrade ? 'Undo this trade' : 'Item is no longer in Traded status'}
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
                              disabled={!canRevertSale}
                              title={canRevertSale ? 'Undo this sale' : 'Item is no longer in Sold status'}
                              onClick={() => onRevertSale(e)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                            >
                              <RotateCcw size={13} />
                              Revert sale
                            </button>
                          )}
                          {!isTradeCompleted && !isSale && (
                            <span className="text-xs text-slate-300">—</span>
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
