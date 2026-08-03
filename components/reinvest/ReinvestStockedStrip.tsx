import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';

type Props = {
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
};

const ReinvestStockedStrip: React.FC<Props> = ({ groups }) => {
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;

  return (
    <div className="rx-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[13px] font-semibold">
          Stocked <span className="text-[var(--rx-muted)] font-medium">· {groups.length}</span>
        </span>
        <ChevronDown
          size={15}
          className={`text-[var(--rx-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5 border-t border-[var(--rx-line)] pt-3">
          {groups.map((g) => (
            <span key={g.key} className="rx-pill rx-pill-ok rx-num">
              {g.label} · {g.currentStock}/{g.targetStock}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReinvestStockedStrip;
