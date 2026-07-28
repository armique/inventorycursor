import React, { useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';

type Props = {
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
};

/** Collapsed by default — good performers that don't need buying right now shouldn't compete
 * for attention with the restock cards above them. */
const ReinvestStockedStrip: React.FC<Props> = ({ groups }) => {
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
          <CheckCircle2 size={14} className="text-emerald-600" />
          {groups.length} doing well, already stocked
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-slate-100">
          {groups.map((g) => (
            <span key={g.key} className="px-2.5 py-1.5 rounded-lg bg-slate-50 text-[11px] font-bold text-slate-600">
              {g.label} · {g.currentStock}/{g.targetStock}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReinvestStockedStrip;
