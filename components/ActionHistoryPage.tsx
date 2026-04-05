import React from 'react';
import { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import { History, Trash2, RotateCcw } from 'lucide-react';

interface Props {
  entries: ActionHistoryEntry[];
  items: InventoryItem[];
  onClear: () => void;
  /** Undo a completed trade from its history row (restores outgoing, removes received). */
  onRevertTrade?: (entry: ActionHistoryEntry) => void;
}

const ActionHistoryPage: React.FC<Props> = ({ entries, items, onClear, onRevertTrade }) => {
  const sorted = [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in">
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Action History</h1>
          <p className="text-sm text-slate-500 font-bold">Important actions with date and time</p>
          <p className="text-xs text-slate-400 font-medium mt-1 max-w-xl">
            If a deal fell through after you logged a trade, use <span className="font-bold text-slate-600">Revert trade</span> on that
            row. For other edits, use Undo in Inventory when available.
          </p>
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
          <div className="divide-y divide-slate-100">
            {sorted.map((e) => {
              const isTradeCompleted = e.action === 'Trade completed' && Boolean(e.itemId) && Boolean(onRevertTrade);
              const outgoing = isTradeCompleted ? items.find((i) => i.id === e.itemId) : undefined;
              const canRevertTrade = outgoing?.status === ItemStatus.TRADED;
              const revertTitle = !isTradeCompleted
                ? undefined
                : !outgoing
                  ? 'Outgoing item is not in inventory anymore.'
                  : !canRevertTrade
                    ? 'This trade was already reverted or the item was changed.'
                    : 'Undo this trade: restore your item to In Stock and remove what you received.';

              return (
                <div key={e.id} className="p-4 flex items-start justify-between gap-4">
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
                        title={revertTitle}
                        disabled={!canRevertTrade}
                        onClick={() => onRevertTrade(e)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 disabled:hover:bg-purple-50"
                      >
                        <RotateCcw size={14} />
                        Revert trade
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionHistoryPage;
