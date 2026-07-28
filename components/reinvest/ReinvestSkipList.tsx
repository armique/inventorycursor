import React, { useState } from 'react';
import { MinusCircle, ChevronDown } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';

type Props = {
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
};

/** Collapsed by default — the argument for "don't buy more of this" is one line per category,
 * reference material rather than something to scan every visit. */
const ReinvestSkipList: React.FC<Props> = ({ groups }) => {
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-xs font-bold text-slate-600 flex items-center gap-2">
          <MinusCircle size={14} className="text-slate-400" />
          {groups.length} not worth buying more of
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {groups.map((g) => (
            <div key={g.key} className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-slate-50">
              <span className="text-xs font-bold text-slate-700 truncate">{g.label}</span>
              <span className="text-[11px] text-slate-400 font-semibold text-right shrink-0">{g.skipReason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReinvestSkipList;
