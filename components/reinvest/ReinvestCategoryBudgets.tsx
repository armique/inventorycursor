import React, { useMemo } from 'react';
import { Cpu, Gamepad2, Layers, Database, CircuitBoard, Zap, Box, Wind, Package, type LucideIcon } from 'lucide-react';
import type { InventoryItem } from '../../types';
import { computeCategoryBudgets } from '../../utils/categoryBudgets';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = { items: InventoryItem[] };

const CATEGORY_ICON: Record<string, { Icon: LucideIcon; bg: string; fg: string }> = {
  gpu: { Icon: Gamepad2, bg: 'bg-violet-100', fg: 'text-violet-700' },
  cpu: { Icon: Cpu, bg: 'bg-blue-100', fg: 'text-blue-700' },
  ram: { Icon: Layers, bg: 'bg-violet-100', fg: 'text-violet-700' },
  storage: { Icon: Database, bg: 'bg-emerald-100', fg: 'text-emerald-700' },
  motherboard: { Icon: CircuitBoard, bg: 'bg-blue-100', fg: 'text-blue-700' },
  psu: { Icon: Zap, bg: 'bg-amber-100', fg: 'text-amber-700' },
  case: { Icon: Box, bg: 'bg-slate-100', fg: 'text-slate-600' },
  cooler: { Icon: Wind, bg: 'bg-sky-100', fg: 'text-sky-700' },
};
const DEFAULT_ICON = { Icon: Package, bg: 'bg-slate-100', fg: 'text-slate-600' };

/** Horizontal strip of per-category cash flow since the season baseline — sold minus bought,
 * i.e. how much of that category's own money is free to reinvest into buying more of it. */
const ReinvestCategoryBudgets: React.FC<Props> = ({ items }) => {
  const budgets = useMemo(() => computeCategoryBudgets(items), [items]);
  if (!budgets.length) return null;
  const bestKey = budgets[0].budget > 0 ? budgets[0].key : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Category budgets</h2>
        <span className="text-[10px] font-bold text-slate-300">since Jun 1 · updates live</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {budgets.map((b) => {
          const { Icon, bg, fg } = CATEGORY_ICON[b.key] || DEFAULT_ICON;
          const isBest = b.key === bestKey;
          return (
            <div
              key={b.key}
              className={`shrink-0 w-40 rounded-2xl bg-white p-3 ${
                isBest ? 'border-2 border-slate-900' : 'border border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${bg} ${fg}`}>
                  <Icon size={14} strokeWidth={2.25} />
                </span>
                {isBest && (
                  <span className="text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-900 text-white">
                    Best
                  </span>
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-500">{b.label}</p>
              <p
                className={`text-lg font-black leading-tight ${
                  b.budget > 0 ? 'text-emerald-600' : b.budget < 0 ? 'text-red-500' : 'text-slate-400'
                }`}
              >
                {formatEURPrefix(b.budget)}
              </p>
              <p className="text-[10px] font-semibold text-slate-400">
                Bought {formatEURPrefix(b.bought)} · Sold {formatEURPrefix(b.sold)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReinvestCategoryBudgets;
