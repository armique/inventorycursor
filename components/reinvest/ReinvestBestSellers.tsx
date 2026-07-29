import React, { useMemo } from 'react';
import { TrendingUp, RefreshCw } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';
import type { BuyHelperFees } from '../../utils/buyHelper';
import { computeReinvestPricing, defaultMarginForGroup } from '../../utils/reinvestPricing';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  /** All groups with sold history — typically variants + bundles. */
  groups: Array<ReinvestGroup | AnchorBundleGroup>;
  fees: BuyHelperFees;
  limit?: number;
};

/** Top performers by €/day — what to restock and at what KA / eBay prices. */
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
    <section className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <TrendingUp size={14} className="text-emerald-600" />
        <div>
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-700">
            What sells best
          </h2>
          <p className="text-[10px] text-slate-400 font-semibold">
            From your buys &amp; sells · restock + KA / eBay prices (eBay fees included)
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {top.map(({ group, pricing }, i) => (
          <li key={group.key} className="px-3.5 py-2.5 flex flex-wrap items-start gap-x-4 gap-y-1.5">
            <span className="text-[10px] font-black text-slate-300 w-4 shrink-0 pt-0.5">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900 truncate">{group.label}</p>
              <p className="text-[10px] text-slate-400 font-semibold">
                {group.soldCount} sold · ~{Math.round(group.avgDaysToSell)}d ·{' '}
                {formatEURPrefix(group.profitPerDay)}/day
                {group.verdict === 'restock' && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-emerald-700 font-black">
                    <RefreshCw size={9} /> restock
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-100">
                Buy ≤ {pricing.suggestedMaxBuy != null ? formatEURPrefix(pricing.suggestedMaxBuy) : '—'}
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-100">
                KA {pricing.sellKa > 0 ? formatEURPrefix(pricing.sellKa) : '—'}
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-100">
                eBay {pricing.sellEbay > 0 ? formatEURPrefix(pricing.sellEbay) : '—'}
                {pricing.sellEbay > 0 && (
                  <span className="font-semibold text-slate-400">
                    {' '}
                    (−{pricing.ebayFeePct}% → {formatEURPrefix(pricing.pocketEbay)})
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default ReinvestBestSellers;
