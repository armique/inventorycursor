import React from 'react';
import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb } from 'lucide-react';
import type { WeeklyDigestSummary } from '../../utils/gamification';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  digest: WeeklyDigestSummary;
  onClose: () => void;
};

/** Compact 3-5 point weekly summary — section 3.2. Deliberately terse, not a full report. */
const WeeklyDigestCard: React.FC<Props> = ({ digest, onClose }) => {
  const TrendIcon =
    digest.profitChangePct == null ? Minus : digest.profitChangePct >= 0 ? TrendingUp : TrendingDown;
  const trendColor =
    digest.profitChangePct == null
      ? 'text-slate-400'
      : digest.profitChangePct >= 0
        ? 'text-emerald-600'
        : 'text-rose-600';

  return (
    <div className="fixed inset-0 z-[400] bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-black text-slate-900">This week's digest</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{digest.weekLabel}</p>

        <ul className="space-y-2 text-xs font-semibold text-slate-700">
          <li className="flex items-center gap-2">
            <TrendIcon size={14} className={trendColor} />
            Earned {formatEURPrefix(digest.profitThisWeek)} this week
            {digest.profitChangePct != null && (
              <span className={trendColor}>
                ({digest.profitChangePct >= 0 ? '+' : ''}
                {digest.profitChangePct}% vs last week)
              </span>
            )}
          </li>
          {digest.bestCategory && (
            <li>
              🏆 Best category: <strong>{digest.bestCategory.label}</strong> ({formatEURPrefix(digest.bestCategory.profit)})
            </li>
          )}
          {digest.worstCategory && (
            <li>
              📉 Weakest: <strong>{digest.worstCategory.label}</strong> ({formatEURPrefix(digest.worstCategory.profit)})
            </li>
          )}
          {digest.stuckCount > 0 && (
            <li className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              {digest.stuckCount} listing{digest.stuckCount === 1 ? '' : 's'} sitting longer than usual
            </li>
          )}
          <li className="flex items-center gap-2">
            <Lightbulb size={14} className="text-sky-500" />
            {digest.tip}
          </li>
        </ul>
      </div>
    </div>
  );
};

export default WeeklyDigestCard;
