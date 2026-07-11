import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import { History, RotateCcw, Trash2 } from 'lucide-react';

interface Props {
  entries: ActionHistoryEntry[];
  items: InventoryItem[];
  onClear: () => void;
  onRevertTrade?: (entry: ActionHistoryEntry) => void;
  onRevertSale?: (entry: ActionHistoryEntry) => void;
}

type ActionTone = {
  badge: string;
  dot: string;
};

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
  if (a.includes('revert') || a.includes('undo')) {
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
    date: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

const GRID_COLS =
  'grid grid-cols-[minmax(148px,168px)_minmax(168px,220px)_minmax(160px,1.1fr)_minmax(220px,2fr)_minmax(112px,128px)] gap-x-5';

const ActionHistoryPage: React.FC<Props> = ({ entries, items, onClear, onRevertTrade, onRevertSale }) => {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [entries]
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
  });

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 md:px-8 pb-16 animate-in fade-in duration-300">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-slate-900 text-white shrink-0 shadow-lg shadow-slate-900/15">
            <History size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Action History</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Full audit log of inventory changes, sales, trades, and expenses
            </p>
            {sorted.length > 0 && (
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-2">
                {sorted.length} recorded action{sorted.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
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
      </header>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-20 px-6 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-slate-50 text-slate-300 mb-4">
              <History size={32} />
            </div>
            <p className="font-black text-slate-700 text-lg">No actions recorded yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Edits, sales, trades, and other important changes will appear here with date, item, and details.
            </p>
          </div>
        ) : (
          <>
            <div className={`${GRID_COLS} px-5 py-3.5 border-b border-slate-200 bg-slate-50/90 text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0 z-10`}>
              <span>When</span>
              <span>Action</span>
              <span>Item</span>
              <span>Details</span>
              <span className="text-right">Options</span>
            </div>

            <div ref={parentRef} className="max-h-[calc(100vh-240px)] min-h-[420px] overflow-y-auto overflow-x-auto">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', minWidth: 920 }}>
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const e = sorted[vRow.index];
                  const when = formatWhen(e.timestamp);
                  const tone = getActionTone(e.action);
                  const isTradeCompleted = e.action === 'Trade completed' && Boolean(e.itemId) && Boolean(onRevertTrade);
                  const isSale = e.action.includes('Sold') && Boolean(e.itemId) && Boolean(onRevertSale);
                  const outgoing = isTradeCompleted || isSale ? items.find((i) => i.id === e.itemId) : undefined;
                  const canRevertTrade = outgoing?.status === ItemStatus.TRADED;
                  const canRevertSale = outgoing?.status === ItemStatus.SOLD;
                  const zebra = vRow.index % 2 === 1;

                  return (
                    <div
                      key={e.id}
                      className={`absolute left-0 right-0 px-5 py-3.5 border-b border-slate-100 ${zebra ? 'bg-slate-50/40' : 'bg-white'} hover:bg-indigo-50/30 transition-colors`}
                      style={{ transform: `translateY(${vRow.start}px)`, height: vRow.size }}
                    >
                      <div className={`${GRID_COLS} items-start h-full`}>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-xs font-bold text-slate-800 leading-tight">{when.date}</p>
                          <p className="text-[11px] font-semibold text-slate-400 tabular-nums mt-0.5">{when.time}</p>
                        </div>

                        <div className="min-w-0 pt-0.5">
                          <span
                            className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-lg border text-[11px] font-black uppercase tracking-wide ${tone.badge}`}
                            title={e.action}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
                            <span className="truncate">{e.action}</span>
                          </span>
                        </div>

                        <div className="min-w-0 pt-1">
                          {e.itemName ? (
                            <p className="text-sm font-bold text-slate-900 leading-snug line-clamp-2" title={e.itemName}>
                              {e.itemName}
                            </p>
                          ) : (
                            <span className="text-sm text-slate-300 font-medium">—</span>
                          )}
                        </div>

                        <div className="min-w-0 pt-1">
                          {e.details ? (
                            <p className="text-sm text-slate-600 leading-snug break-words line-clamp-3" title={e.details}>
                              {e.details}
                            </p>
                          ) : (
                            <span className="text-sm text-slate-300 font-medium">—</span>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1.5 pt-0.5">
                          {isTradeCompleted && onRevertTrade && (
                            <button
                              type="button"
                              disabled={!canRevertTrade}
                              title={canRevertTrade ? 'Undo this trade' : 'Item is no longer in Traded status'}
                              onClick={() => onRevertTrade(e)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 disabled:opacity-40 whitespace-nowrap"
                            >
                              <RotateCcw size={13} />
                              Revert
                            </button>
                          )}
                          {isSale && onRevertSale && (
                            <button
                              type="button"
                              disabled={!canRevertSale}
                              title={canRevertSale ? 'Undo this sale' : 'Item is no longer in Sold status'}
                              onClick={() => onRevertSale(e)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40 whitespace-nowrap"
                            >
                              <RotateCcw size={13} />
                              Revert
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ActionHistoryPage;
