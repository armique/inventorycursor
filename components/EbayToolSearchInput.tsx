import React from 'react';
import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown when search is active, e.g. 3 / 12 */
  matchCount?: number;
  totalCount?: number;
  className?: string;
}

const EbayToolSearchInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'Search…',
  matchCount,
  totalCount,
  className = '',
}) => {
  const active = value.trim().length > 0;
  const showCount =
    active && matchCount != null && totalCount != null && totalCount > 0;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="relative flex-1 min-w-[12rem] max-w-xl">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {active && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {showCount && (
        <span className="text-[10px] font-bold text-slate-500 tabular-nums whitespace-nowrap">
          {matchCount} of {totalCount}
        </span>
      )}
    </div>
  );
};

export default EbayToolSearchInput;
