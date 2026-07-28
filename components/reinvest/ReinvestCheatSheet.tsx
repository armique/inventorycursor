import React, { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';
import type { BuyHelperFees } from '../../utils/buyHelper';
import { computeReinvestPricing, defaultMarginForGroup } from '../../utils/reinvestPricing';
import { formatEURPrefix } from '../../utils/formatMoney';
import ReinvestCard from './ReinvestCard';

type Props = {
  variants: ReinvestGroup[];
  bundles: AnchorBundleGroup[];
  fees: BuyHelperFees;
};

type SortKey = 'profit' | 'speed' | 'category';

function whyText(group: ReinvestGroup | AnchorBundleGroup): string {
  if (group.kind === 'hypothesis') return 'AI idea — no sales of this yet.';
  if (!group.soldCount) return 'No sold comps yet.';
  return `Based on ${group.soldCount} sale${group.soldCount === 1 ? '' : 's'}, avg sell ${formatEURPrefix(
    group.overallSellMedian ?? 0,
  )}.`;
}

const CONFIDENCE_DOT: Record<string, string> = {
  low: 'bg-slate-300',
  medium: 'bg-sky-400',
  high: 'bg-emerald-500',
};

const ReinvestCheatSheet: React.FC<Props> = ({ variants, bundles, fees }) => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('profit');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'ebay' | 'kleinanzeigen'>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    let list: Array<ReinvestGroup | AnchorBundleGroup> = [...variants, ...bundles];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
    }
    if (platformFilter !== 'all') {
      list = list.filter((r) => (platformFilter === 'ebay' ? r.sellEbayCount > 0 : r.sellKaCount > 0));
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'speed') return a.avgDaysToSell - b.avgDaysToSell;
      if (sortBy === 'category') return a.category.localeCompare(b.category);
      return b.allInclAvgProfit - a.allInclAvgProfit;
    });
  }, [variants, bundles, search, platformFilter, sortBy]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-brand-400"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white"
        >
          <option value="profit">Sort: profit</option>
          <option value="speed">Sort: speed</option>
          <option value="category">Sort: category</option>
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as typeof platformFilter)}
          className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white"
        >
          <option value="all">All platforms</option>
          <option value="ebay">eBay only</option>
          <option value="kleinanzeigen">Kleinanzeigen only</option>
        </select>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span>Item</span>
          <span>Buy ≤</span>
          <span>Sell ~</span>
          <span>Days</span>
          <span>Conf.</span>
        </div>
        {!rows.length ? (
          <p className="p-4 text-xs font-semibold text-slate-400">No matches.</p>
        ) : (
          rows.map((row) => {
            const pricing = computeReinvestPricing(row, fees, defaultMarginForGroup(row));
            const isOpen = expandedKey === row.key;
            return (
              <div key={row.key} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setExpandedKey(isOpen ? null : row.key)}
                  className="w-full grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-3 items-center px-3 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="col-span-2 sm:col-span-1 min-w-0 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONFIDENCE_DOT[row.confidence]}`} />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-800 truncate">{row.label}</span>
                      <span className="block text-[10px] text-slate-400 font-semibold truncate">{row.category}</span>
                    </span>
                    <span
                      title={whyText(row)}
                      className="shrink-0 text-slate-300 hover:text-slate-500 cursor-help"
                    >
                      <HelpCircle size={12} />
                    </span>
                  </span>
                  <span className="text-xs font-black text-slate-900">
                    {pricing.suggestedMaxBuy != null ? formatEURPrefix(pricing.suggestedMaxBuy) : '—'}
                  </span>
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1 flex-wrap">
                    {row.sellKaCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-black">
                        K {formatEURPrefix(pricing.sellKa)}
                      </span>
                    )}
                    {row.sellEbayCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-black">
                        eBay {formatEURPrefix(pricing.sellEbay)}
                      </span>
                    )}
                    {!row.sellKaCount && !row.sellEbayCount && (
                      <span className="text-slate-400">{formatEURPrefix(pricing.sellKa || pricing.sellEbay)}</span>
                    )}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">{Math.round(row.avgDaysToSell)}d</span>
                  <span className="flex items-center gap-1 text-slate-400">
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    <ReinvestCard group={row} fees={fees} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ReinvestCheatSheet;
