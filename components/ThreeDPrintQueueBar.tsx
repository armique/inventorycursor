import React from 'react';
import { Printer } from 'lucide-react';
import type { InventoryItem, PrintStage } from '../types';
import {
  PRINT_STAGES,
  PRINT_STAGE_LABEL,
  applyPrintStage,
  groupPrintQueue,
  nextPrintStage,
  resolvePrintStage,
} from '../utils/printQueue';

type Props = {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
};

const STAGE_TONE: Record<PrintStage, string> = {
  queued: 'border-white/10 bg-[#151d2e] text-slate-200',
  printing: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  sold: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
};

const ThreeDPrintQueueBar: React.FC<Props> = ({ items, onUpdate }) => {
  const groups = groupPrintQueue(items);
  const activeCount = groups.queued.length + groups.printing.length + groups.ready.length;
  if (activeCount === 0 && groups.sold.length === 0) return null;

  const advance = (item: InventoryItem) => {
    const next = nextPrintStage(resolvePrintStage(item));
    if (!next) return;
    onUpdate([applyPrintStage(item, next)]);
  };

  return (
    <div className="shrink-0 mx-2 mt-2 rounded-2xl border border-white/10 bg-[#151d2e] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Printer size={14} className="text-brand-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Print queue</p>
        <span className="text-[10px] font-bold text-slate-500 tabular-nums">{activeCount} open</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {PRINT_STAGES.map((stage) => (
          <div key={stage} className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              {PRINT_STAGE_LABEL[stage]} · {groups[stage].length}
            </p>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
              {groups[stage].slice(0, 8).map((item) => {
                const nxt = nextPrintStage(stage);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!nxt}
                    onClick={() => advance(item)}
                    title={nxt ? `Move to ${PRINT_STAGE_LABEL[nxt]}` : 'Sold'}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] font-semibold truncate disabled:opacity-70 ${STAGE_TONE[stage]}`}
                  >
                    {item.name}
                  </button>
                );
              })}
              {groups[stage].length === 0 && (
                <p className="text-[10px] text-slate-600 px-1">Empty</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ThreeDPrintQueueBar;
