import React, { useMemo } from 'react';
import { TrendingUp, Target } from 'lucide-react';
import type { InventoryItem } from '../types';
import { computeCategoryRoi, suggestSimilarToMyStock } from '../services/sourcingAnalytics';
import { formatEUR } from '../utils/formatMoney';

interface Props {
  items: InventoryItem[];
  onRunSearch?: (query: string, maxPrice?: number) => void;
  /** Tighter layout for Deal Hunter insights tab. */
  compact?: boolean;
}

const DealHunterInsights: React.FC<Props> = ({ items, onRunSearch, compact = false }) => {
  const roi = useMemo(() => computeCategoryRoi(items).slice(0, 6), [items]);
  const gaps = useMemo(() => suggestSimilarToMyStock(items), [items]);

  if (roi.length === 0 && gaps.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Mark items as sold to unlock sourcing ROI and “similar to my stock” suggestions.
      </p>
    );
  }

  return (
    <div className={compact ? 'grid gap-4 lg:grid-cols-2 max-w-5xl' : 'grid gap-6 md:grid-cols-2'}>
      {roi.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <TrendingUp size={14} className="text-emerald-500" /> Sourcing ROI (sold history)
          </h3>
          <div className="space-y-2">
            {roi.map((row) => (
              <div key={row.category} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-sm font-bold text-slate-900">{row.category}</p>
                  <p className="text-[10px] text-slate-500">{row.soldCount} sold · ~{Math.round(row.avgDaysToSell)}d to sell</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-emerald-700">€{formatEUR(row.avgProfit)}</p>
                  <p className="text-[10px] text-slate-400">{row.avgMarginPct.toFixed(0)}% margin</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Target size={14} className="text-indigo-500" /> Similar to my stock
          </h3>
          <div className="space-y-2">
            {gaps.map((g) => (
              <div key={g.category} className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{g.category}</p>
                  <p className="text-[10px] text-slate-600 truncate">{g.reason}</p>
                </div>
                {onRunSearch && (
                  <button
                    type="button"
                    onClick={() => onRunSearch(g.query)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase"
                  >
                    Hunt
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DealHunterInsights;
