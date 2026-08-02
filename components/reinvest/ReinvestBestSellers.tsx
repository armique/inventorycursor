import React, { useMemo } from 'react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';
import type { BuyHelperFees } from '../../utils/buyHelper';
import { computeReinvestPricing, defaultMarginForGroup } from '../../utils/reinvestPricing';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
  fees: BuyHelperFees;
  limit?: number;
};

const ReinvestBestSellers: React.FC<Props> = ({ groups, fees, limit = 5 }) => {
  const top = useMemo(() => {
    return [...groups]
      .filter((g) => g.soldCount > 0 && g.profitPerDay > 0 && g.verdict !== 'skip')
      .sort((a, b) => b.profitPerDay - a.profitPerDay || b.soldCount - a.soldCount)
      .slice(0, limit)
      .map((g) => ({
        group: g,
        pricing: computeReinvestPricing(g, fees, defaultMarginForGroup(g)),
      }));
  }, [groups, fees, limit]);

  if (!top.length) return null;

  return (
    <section className="rx-panel overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--rx-line)]">
        <h2 className="text-[13px] font-semibold tracking-tight">Top sellers</h2>
      </div>
      <ul className="divide-y divide-[var(--rx-line)]">
        {top.map(({ group, pricing }, i) => (
          <li key={group.key} className="px-4 py-2.5 flex items-center gap-3">
            <span className="rx-num text-[11px] font-semibold text-[var(--rx-muted)] w-4 shrink-0">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold truncate">{group.label}</p>
              <p className="rx-num text-[11px] text-[var(--rx-muted)]">
                {group.soldCount} · ~{Math.round(group.avgDaysToSell)}d · {formatEURPrefix(group.profitPerDay)}/d
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="rx-num text-[13px] font-semibold">
                {pricing.suggestedMaxBuy != null ? formatEURPrefix(pricing.suggestedMaxBuy) : '—'}
              </p>
              <p className="text-[10px] text-[var(--rx-muted)] font-medium">max buy</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default ReinvestBestSellers;
