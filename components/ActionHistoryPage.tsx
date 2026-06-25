import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import { History, Trash2, RotateCcw } from 'lucide-react';

interface Props {
  entries: ActionHistoryEntry[];
  items: InventoryItem[];
  onClear: () => void;
  onRevertTrade?: (entry: ActionHistoryEntry) => void;
  onRevertSale?: (entry: ActionHistoryEntry) => void;
}

const ActionHistoryPage: React.FC<Props> = ({ entries, items, onClear, onRevertTrade, onRevertSale }) => {
  const sorted = [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in">
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Action History</h1>
          <p className="text-sm text-slate-500 font-bold">Important actions with date and time</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Clear action history?')) onClear();
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-bold text-sm"
        >
          <Trash2 size={16} />
          Clear
        </button>
      </header>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <History size={28} className="mx-auto mb-3" />
            <p className="font-bold">No actions yet.</p>
          </div>
        ) : (
          <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const e = sorted[vRow.index];
                const isTradeCompleted = e.action === 'Trade completed' && Boolean(e.itemId) && Boolean(onRevertTrade);
                const isSale = e.action.includes('Sold') && Boolean(e.itemId) && Boolean(onRevertSale);
                const outgoing = isTradeCompleted || isSale ? items.find((i) => i.id === e.itemId) : undefined;
                const canRevertTrade = outgoing?.status === ItemStatus.TRADED;
                const canRevertSale = outgoing?.status === ItemStatus.SOLD;

                return (
                  <div
                    key={e.id}
                    className="absolute left-0 right-0 px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-4"
                    style={{ transform: `translateY(${vRow.start}px)` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900">{e.action}</p>
                      {(e.itemName || e.details) && (
                        <p className="text-xs text-slate-600 mt-0.5 break-words">
                          {[e.itemName, e.details].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-xs font-semibold text-slate-500">{new Date(e.timestamp).toLocaleString()}</span>
                      {isTradeCompleted && onRevertTrade && (
                        <button
                          type="button"
                          disabled={!canRevertTrade}
                          onClick={() => onRevertTrade(e)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-purple-200 bg-purple-50 text-purple-800 disabled:opacity-40"
                        >
                          <RotateCcw size={14} />
                          Revert trade
                        </button>
                      )}
                      {isSale && onRevertSale && (
                        <button
                          type="button"
                          disabled={!canRevertSale}
                          onClick={() => onRevertSale(e)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-200 bg-amber-50 text-amber-800 disabled:opacity-40"
                        >
                          <RotateCcw size={14} />
                          Revert sale
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionHistoryPage;
