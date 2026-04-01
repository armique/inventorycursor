import React from 'react';
import { ActionHistoryEntry } from '../types';
import { History, Trash2 } from 'lucide-react';

interface Props {
  entries: ActionHistoryEntry[];
  onClear: () => void;
}

const ActionHistoryPage: React.FC<Props> = ({ entries, onClear }) => {
  const sorted = [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Action History</h1>
          <p className="text-sm text-slate-500 font-bold">All important actions with date and time</p>
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
            {sorted.map((e) => (
              <div key={e.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{e.action}</p>
                  {(e.itemName || e.details) && (
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {[e.itemName, e.details].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>
                <span className="text-xs font-semibold text-slate-500 shrink-0">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionHistoryPage;
