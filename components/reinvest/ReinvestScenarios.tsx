import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { InventoryItem } from '../../types';
import type { ReinvestData } from '../../utils/reinvestAnalysis';
import type { CategoryBudgetsResult } from '../../utils/categoryBudgets';
import { formatEURPrefix } from '../../utils/formatMoney';
import { buildReinvestTodayBrief } from '../../utils/reinvestTodayBrief';
import type { ReinvestFees } from '../../utils/reinvestFees';
import type { GamificationState } from '../../utils/gamification';
import type { AnchorBundleGroup, ReinvestGroup } from '../../utils/reinvestAnalysis';

type Props = {
  items: InventoryItem[];
  data: ReinvestData;
  budgets: CategoryBudgetsResult;
  restock: Array<ReinvestGroup | AnchorBundleGroup>;
  skipped: Array<ReinvestGroup | AnchorBundleGroup>;
  fees: ReinvestFees;
  gamification: GamificationState;
};

type ScenarioId = 'spend' | 'lot' | 'why_gpu';

const SCENARIOS: Array<{ id: ScenarioId; label: string }> = [
  { id: 'spend', label: 'Spend €?' },
  { id: 'lot', label: 'KA lot' },
  { id: 'why_gpu', label: 'GPU cash' },
];

const ReinvestScenarios: React.FC<Props> = ({
  items,
  data,
  budgets,
  restock,
  skipped,
  fees,
  gamification,
}) => {
  const [open, setOpen] = useState<ScenarioId | null>(null);

  const brief = useMemo(
    () =>
      buildReinvestTodayBrief({
        restock,
        skipped,
        suspicions: [],
        items,
        fees,
        gamification,
      }),
    [restock, skipped, items, fees, gamification],
  );

  const answer = useMemo(() => {
    if (!open) return '';
    if (open === 'spend') {
      const daily = Math.max(0, gamification.dailyBudget.amount - gamification.dailyBudget.spentVirtual);
      const top = brief.buy[0];
      if (daily <= 0 && gamification.dailyBudget.amount > 0) {
        return `Daily budget used (${formatEURPrefix(gamification.dailyBudget.amount)}).`;
      }
      if (!top) return `Bank ${formatEURPrefix(gamification.bankBalance)}. No strong buy.`;
      return `Bank ${formatEURPrefix(gamification.bankBalance)}${
        daily > 0 ? ` · today ${formatEURPrefix(daily)}` : ''
      }. Buy ${top.group.label} ≤ ${top.maxBuy != null ? formatEURPrefix(top.maxBuy) : '—'}.`;
    }
    if (open === 'lot') {
      const skipNames = skipped.slice(0, 2).map((g) => g.label).join(', ');
      return `Price each part vs max buy. Skip: ${skipNames || 'none'}. Defects need bigger cut.`;
    }
    const gpu = budgets.budgets.find((b) => b.key === 'gpu');
    if (!gpu) return 'No GPU cash yet.';
    return `GPU: bought ${formatEURPrefix(gpu.bought)} · sold ${formatEURPrefix(gpu.sold)} · net ${formatEURPrefix(gpu.budget)}.${
      budgets.unattributedPcSold > 0
        ? ` ${formatEURPrefix(budgets.unattributedPcSold)} still in Other (PC not split).`
        : ''
    }`;
  }, [open, gamification, brief, skipped, budgets]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-[var(--rx-muted)] mr-1">Ask</span>
      {SCENARIOS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setOpen((v) => (v === s.id ? null : s.id))}
          className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
            open === s.id
              ? 'bg-[var(--rx-ink)] text-white border-[var(--rx-ink)]'
              : 'bg-white text-[var(--rx-ink)] border-[var(--rx-line)] hover:border-[var(--rx-ink)]'
          }`}
        >
          {s.label}
        </button>
      ))}
      {open && (
        <div className="w-full mt-1 rounded-xl border border-[var(--rx-line)] bg-white px-3 py-2.5 relative">
          <button
            type="button"
            className="absolute top-2 right-2 p-1 text-[var(--rx-muted)]"
            onClick={() => setOpen(null)}
            aria-label="Close"
          >
            <X size={14} />
          </button>
          <p className="text-[13px] font-medium leading-snug pr-6">{answer}</p>
          <span className="hidden">{data.historyDays}{items.length}</span>
        </div>
      )}
    </div>
  );
};

export default ReinvestScenarios;
