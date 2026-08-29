import React, { useState } from 'react';
import {
  History,
  TrendingUp,
  Tag,
  Boxes,
  Split,
  ShoppingBag,
  User,
  ShieldCheck,
  Edit3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { InventoryItem, ItemHistoryEntry } from '../types';

interface Props {
  item: InventoryItem;
  compact?: boolean;
}

function formatTimelineDate(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: iso.slice(0, 10), time: '' };
    return {
      date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    };
  } catch {
    return { date: iso.slice(0, 10), time: '' };
  }
}

function getActionMeta(action: ItemHistoryEntry['action']) {
  switch (action) {
    case 'created':
      return {
        icon: <History size={14} className="text-emerald-600" />,
        badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        dot: 'bg-emerald-500',
      };
    case 'buy_price_changed':
      return {
        icon: <TrendingUp size={14} className="text-blue-600" />,
        badge: 'bg-blue-50 text-blue-800 border-blue-200',
        dot: 'bg-blue-500',
      };
    case 'sell_price_changed':
      return {
        icon: <Tag size={14} className="text-indigo-600" />,
        badge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
        dot: 'bg-indigo-500',
      };
    case 'status_changed':
      return {
        icon: <ShoppingBag size={14} className="text-amber-600" />,
        badge: 'bg-amber-50 text-amber-800 border-amber-200',
        dot: 'bg-amber-500',
      };
    case 'bundle_created':
    case 'added_to_bundle':
      return {
        icon: <Boxes size={14} className="text-purple-600" />,
        badge: 'bg-purple-50 text-purple-800 border-purple-200',
        dot: 'bg-purple-500',
      };
    case 'bundle_split':
    case 'removed_from_bundle':
      return {
        icon: <Split size={14} className="text-orange-600" />,
        badge: 'bg-orange-50 text-orange-800 border-orange-200',
        dot: 'bg-orange-500',
      };
    case 'ebay_linked':
    case 'ebay_unlinked':
      return {
        icon: <ShoppingBag size={14} className="text-sky-600" />,
        badge: 'bg-sky-50 text-sky-800 border-sky-200',
        dot: 'bg-sky-500',
      };
    case 'customer_set':
      return {
        icon: <User size={14} className="text-teal-600" />,
        badge: 'bg-teal-50 text-teal-800 border-teal-200',
        dot: 'bg-teal-500',
      };
    case 'condition_changed':
      return {
        icon: <ShieldCheck size={14} className="text-cyan-600" />,
        badge: 'bg-cyan-50 text-cyan-800 border-cyan-200',
        dot: 'bg-cyan-500',
      };
    default:
      return {
        icon: <Edit3 size={14} className="text-slate-600" />,
        badge: 'bg-slate-50 text-slate-700 border-slate-200',
        dot: 'bg-slate-400',
      };
  }
}

export const ItemHistoryTimeline: React.FC<Props> = ({ item, compact = false }) => {
  const history = Array.isArray(item.history) ? item.history : [];
  const [open, setOpen] = useState(!compact);

  if (!history.length) {
    return (
      <div className="py-4 text-center text-xs font-semibold text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
        No modifications recorded yet. Future edits, splits, and price changes will appear here.
      </div>
    );
  }

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <History size={16} className="text-slate-700" />
          <h4 className="text-sm font-black text-slate-900 tracking-tight">Audit Timeline</h4>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {history.length} event{history.length === 1 ? '' : 's'}
          </span>
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {open ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 relative pl-4 border-l-2 border-slate-100 space-y-4 max-h-96 overflow-y-auto pr-1">
          {history.map((entry) => {
            const meta = getActionMeta(entry.action);
            const { date, time } = formatTimelineDate(entry.timestamp);

            return (
              <div key={entry.id} className="relative group">
                <span
                  className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-white ${meta.dot}`}
                />
                <div className="bg-slate-50 hover:bg-slate-100/80 transition-colors border border-slate-200/70 rounded-xl p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wide ${meta.badge}`}
                    >
                      {meta.icon}
                      {entry.title}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                      {date} {time && `· ${time}`}
                    </span>
                  </div>

                  {entry.details && (
                    <p className="text-xs font-medium text-slate-700 mt-1.5 leading-relaxed">
                      {entry.details}
                    </p>
                  )}

                  {entry.diffs && entry.diffs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t border-slate-200/50">
                      {entry.diffs.map((d, i) => (
                        <span
                          key={i}
                          className="inline-block text-[11px] font-bold px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-800"
                        >
                          {d.label || `${d.field}: ${String(d.from)} → ${String(d.to)}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ItemHistoryTimeline;
