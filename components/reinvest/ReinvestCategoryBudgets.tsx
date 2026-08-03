import React, { useMemo } from 'react';
import type { InventoryItem } from '../../types';
import { computeCategoryBudgetsDetailed } from '../../utils/categoryBudgets';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = { items: InventoryItem[]; onResplitHint?: () => void };

/** Slim cash rail — numbers only, one line of context when PCs aren't split. */
const ReinvestCategoryBudgets: React.FC<Props> = ({ items, onResplitHint }) => {
  const { budgets, unattributedPcSold, unattributedPcCount } = useMemo(
    () => computeCategoryBudgetsDetailed(items),
    [items],
  );
  if (!budgets.length) return null;
  const bestKey = budgets[0].budget > 0 ? budgets[0].key : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className="text-[13px] font-semibold tracking-tight">Cash</h2>
        <span className="text-[11px] text-[var(--rx-muted)]">sold − bought · since Jun 1</span>
      </div>

      {unattributedPcCount > 0 && (
        <button
          type="button"
          onClick={onResplitHint}
          className="w-full text-left rounded-xl px-3 py-2 bg-[var(--rx-warn-soft)] text-[12px] font-medium text-[var(--rx-warn)]"
        >
          {formatEURPrefix(unattributedPcSold)} in Other · {unattributedPcCount} PC not split → tap to note
        </button>
      )}

      <div className="rx-cash-rail">
        {budgets.map((b) => (
          <div key={b.key} className="rx-cash-tile" data-best={b.key === bestKey ? 'true' : 'false'}>
            <p className="text-[11px] font-medium text-[var(--rx-muted)]">{b.label}</p>
            <p
              className={`rx-num text-[20px] font-semibold tracking-tight mt-1 ${
                b.budget > 0
                  ? 'text-[var(--rx-ok)]'
                  : b.budget < 0
                    ? 'text-[var(--rx-bad)]'
                    : 'text-[var(--rx-muted)]'
              }`}
            >
              {formatEURPrefix(b.budget)}
            </p>
            <p className="rx-num text-[10px] text-[var(--rx-muted)] mt-1">
              {formatEURPrefix(b.bought)} → {formatEURPrefix(b.sold)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReinvestCategoryBudgets;
