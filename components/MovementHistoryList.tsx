import React, { useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { InventoryItem } from '../types';
import { MOVEMENT_EVENT_LABEL } from '../utils/itemMovementHistory';

function formatHistDate(iso: string | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Chip + expandable list of standalone ↔ bundle/PC membership changes, with dates. */
const MovementHistoryList: React.FC<{ item: InventoryItem; compact?: boolean }> = ({ item, compact }) => {
  const events = item.movementHistory || [];
  const [open, setOpen] = useState(false);

  if (!events.length) return null;

  return (
    <span className={compact ? 'inline-flex flex-col items-start max-w-full' : 'block mt-2'}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap text-[9px] font-black uppercase tracking-wide rounded-lg px-2 py-1 border text-slate-700 bg-slate-50 border-slate-200 hover:bg-slate-100"
        title="Bundle/PC membership history"
      >
        <GitBranch size={10} className="shrink-0" />
        Movement · {events.length}
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1.5 pl-0.5">
          {[...events].reverse().map((event) => (
            <li
              key={event.id}
              className="text-[10px] leading-snug text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
            >
              <p className="font-black text-slate-900">{formatHistDate(event.date)}</p>
              <p className={event.type === 'added_to_bundle' ? 'text-indigo-800 font-semibold' : 'text-slate-600 font-semibold'}>
                {MOVEMENT_EVENT_LABEL[event.type]}
                {event.bundleName ? ` — ${event.bundleName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </span>
  );
};

export default MovementHistoryList;
