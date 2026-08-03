import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';

type Props = {
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
};

const ReinvestSkipList: React.FC<Props> = ({ groups }) => {
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
          Skip <span className="text-[var(--rx-muted)] font-medium">· {groups.length}</span>
        </span>
        <ChevronDown
          size={15}
          className={`text-[var(--rx-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--rx-line)] divide-y divide-[var(--rx-line)]">
          {groups.map((g) => (
            <div key={g.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-[12px] font-semibold truncate">{g.label}</span>
              <span className="text-[11px] text-[var(--rx-muted)] font-medium text-right shrink-0 max-w-[45%] truncate">
                {g.skipReason}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReinvestSkipList;
