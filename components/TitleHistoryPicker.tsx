import React, { useMemo } from 'react';
import { History } from 'lucide-react';
import type { TitleHistoryEntry } from '../types';

type Props = {
  entries: TitleHistoryEntry[];
  field?: TitleHistoryEntry['field'];
  current: string;
  onRestore: (title: string) => void;
  disabled?: boolean;
};

/** Dropdown to view and restore prior inventory / listing titles. */
const TitleHistoryPicker: React.FC<Props> = ({
  entries,
  field,
  current,
  onRestore,
  disabled,
}) => {
  const rows = useMemo(() => {
    const list = field ? entries.filter((e) => e.field === field) : entries;
    return list
      .filter((e) => e.title.trim() && e.title.trim() !== current.trim())
      .slice()
      .reverse();
  }, [entries, field, current]);

  if (!rows.length) return null;

  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
      <History size={12} className="shrink-0" />
      <span className="uppercase tracking-wide">Title history</span>
      <select
        disabled={disabled}
        className="max-w-[12rem] truncate rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onRestore(v);
          e.target.value = '';
        }}
      >
        <option value="">Restore…</option>
        {rows.map((row) => (
          <option key={`${row.date}-${row.title}`} value={row.title}>
            {row.title.slice(0, 48)}
          </option>
        ))}
      </select>
    </label>
  );
};

export default TitleHistoryPicker;
