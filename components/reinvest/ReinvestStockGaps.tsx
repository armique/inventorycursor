import React, { useMemo } from 'react';
import { PackageSearch } from 'lucide-react';
import type { InventoryItem } from '../../types';
import {
  computeReinvestStockGaps,
  computeReinvestStockTargets,
  DEFAULT_STOCK_TARGET,
} from '../../utils/reinvestStockTargets';

type Props = {
  items: InventoryItem[];
  /** When true, only under-target boxes. Default true. */
  gapsOnly?: boolean;
  target?: number;
};

/**
 * Hot-seller shelf gaps under bank/budget — target 3 of each, live from IN_STOCK.
 */
const ReinvestStockGaps: React.FC<Props> = ({
  items,
  gapsOnly = true,
  target = DEFAULT_STOCK_TARGET,
}) => {
  const rows = useMemo(
    () => (gapsOnly ? computeReinvestStockGaps(items, target) : computeReinvestStockTargets(items, target)),
    [items, gapsOnly, target],
  );

  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 shadow-card p-4">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-1.5">
          <PackageSearch size={14} /> Hot sellers — shelf full
        </h2>
        <p className="text-xs text-emerald-800/80 font-semibold mt-1">
          All watchlist SKUs are at {target}/each (SSD tiers, 4790K kits, AM4, 1080 / 2080 / 3070).
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 space-y-3">
      <div>
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
          <PackageSearch size={14} /> Don’t have · sells well
        </h2>
        <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
          Target {target} each · live from current stock
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {rows.map((row) => {
          const filled = row.current >= row.target;
          return (
            <div
              key={row.id}
              className={`rounded-xl border px-3 py-2.5 space-y-1 ${
                filled
                  ? 'border-emerald-200 bg-emerald-50/80'
                  : row.current === 0
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <p className="text-xs font-black text-slate-900 leading-tight">{row.label}</p>
              <p className="text-[10px] text-slate-400 font-semibold leading-tight">{row.hint}</p>
              <div className="flex items-baseline justify-between gap-2 pt-0.5">
                <span
                  className={`text-sm font-black tabular-nums ${
                    filled ? 'text-emerald-700' : row.current === 0 ? 'text-amber-800' : 'text-slate-800'
                  }`}
                >
                  {row.current}/{row.target}
                </span>
                {!filled && (
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                    need {row.need}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ReinvestStockGaps;
