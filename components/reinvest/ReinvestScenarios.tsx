import React, { useMemo, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import type { InventoryItem } from '../../types';
import type { ReinvestData } from '../../utils/reinvestAnalysis';
import type { CategoryBudgetsResult } from '../../utils/categoryBudgets';
import { formatEURPrefix } from '../../utils/formatMoney';
import { buildReinvestTodayBrief } from '../../utils/reinvestTodayBrief';
import type { BuyHelperFees } from '../../utils/buyHelper';
import type { GamificationState } from '../../utils/gamification';
import type { AnchorBundleGroup, ReinvestGroup } from '../../utils/reinvestAnalysis';

type Props = {
  items: InventoryItem[];
  data: ReinvestData;
  budgets: CategoryBudgetsResult;
  restock: Array<ReinvestGroup | AnchorBundleGroup>;
  skipped: Array<ReinvestGroup | AnchorBundleGroup>;
  fees: BuyHelperFees;
  gamification: GamificationState;
};

type ScenarioId = 'spend' | 'lot' | 'why_gpu';

const SCENARIOS: Array<{ id: ScenarioId; label: string; prompt: string }> = [
  { id: 'spend', label: 'I want to spend €X', prompt: 'How much cash should I deploy today?' },
  { id: 'lot', label: 'I found a lot on KA', prompt: 'What should I check before buying a lot?' },
  { id: 'why_gpu', label: 'Why is GPU cash negative?', prompt: 'Explain the GPU category cash box.' },
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
        return `Your daily buy budget is already used (€${gamification.dailyBudget.amount}). Wait until tomorrow or raise the daily amount in Progress.`;
      }
      if (!top) {
        return `Bank ${formatEURPrefix(gamification.bankBalance)}. No strong restock pick right now — sell aging stock first or wait for clearer signals.`;
      }
      return `Bank ${formatEURPrefix(gamification.bankBalance)}${
        daily > 0 ? ` · ~€${daily} left today` : ''
      }. Best next buy: ${top.group.label} up to ${
        top.maxBuy != null ? formatEURPrefix(top.maxBuy) : 'your margin target'
      }. ${top.why}`;
    }
    if (open === 'lot') {
      const skipNames = skipped.slice(0, 3).map((g) => g.label).join(', ');
      return [
        'Before buying a mixed lot:',
        '1) Price each named part against Reinvest max-buy (not the lot average).',
        '2) Skip anything on the Don’t-buy list' + (skipNames ? ` (${skipNames})` : '') + '.',
        '3) Defective / no-photo parts need a steeper discount.',
        '4) If the lot is “for a PC”, check kit patterns under Kits in Today.',
      ].join('\n');
    }
    const gpu = budgets.budgets.find((b) => b.key === 'gpu');
    if (!gpu) {
      return 'No GPU cash-box activity since the season start yet.';
    }
    return [
      `GPU cash box: bought ${formatEURPrefix(gpu.bought)}, sold ${formatEURPrefix(gpu.sold)}, net ${formatEURPrefix(gpu.budget)}.`,
      budgets.unattributedPcSold > 0
        ? `${formatEURPrefix(budgets.unattributedPcSold)} from sold PCs sits in Other because those PCs have no per-part sell prices — split them to credit GPU.`
        : 'Attributed part sells already feed GPU when you resplit PC prices.',
      'This number is cash flow for the category, not the margin on each GPU row in Sold.',
    ].join(' ');
  }, [open, gamification, brief, skipped, budgets]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <MessageCircle size={14} className="text-slate-400" />
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Ask Reinvest</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpen(s.id)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
          >
            {s.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 relative">
          <button
            type="button"
            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-700"
            onClick={() => setOpen(null)}
            aria-label="Close"
          >
            <X size={14} />
          </button>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
            {SCENARIOS.find((s) => s.id === open)?.prompt}
          </p>
          <p className="text-xs font-semibold text-slate-700 whitespace-pre-line leading-relaxed pr-6">{answer}</p>
          <p className="text-[10px] text-slate-400 mt-2">Based on your inventory numbers — not a guess.</p>
        </div>
      )}
      {/* keep data referenced for future scenario expansion */}
      <span className="hidden">{data.historyDays}{items.length}</span>
    </div>
  );
};

export default ReinvestScenarios;
