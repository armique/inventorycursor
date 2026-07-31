import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Cpu,
  Gamepad2,
  Layers,
  Database,
  CircuitBoard,
  Zap,
  Box,
  Wind,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { ItemStatus, type InventoryItem } from '../../types';
import type { ReinvestGroup, AnchorBundleGroup } from '../../utils/reinvestAnalysis';
import type { BuyHelperFees } from '../../utils/buyHelper';
import { computeReinvestPricing, defaultMarginForGroup } from '../../utils/reinvestPricing';
import { formatEURPrefix } from '../../utils/formatMoney';
import { saveReinvestMarginOverride } from '../../utils/reinvestSettings';
import ReinvestListingResults from './ReinvestListingResults';

type Props = {
  group: ReinvestGroup | AnchorBundleGroup;
  fees: BuyHelperFees;
  initialMarginPct?: number;
  onPurchaseConfirmed?: (buyPrice: number) => void;
  onOpenHypothesisSearch?: (groupKey: string) => void;
};

const CONFIDENCE_DOT: Record<string, string> = {
  low: 'bg-slate-300',
  medium: 'bg-sky-400',
  high: 'bg-emerald-500',
};

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

function iconForGroup(group: ReinvestGroup | AnchorBundleGroup) {
  const prefix = group.kind === 'bundle' ? group.siblingCategory : group.key.split(':')[0];
  return CATEGORY_ICON[prefix] || DEFAULT_ICON;
}

function buildNarrative(group: ReinvestGroup | AnchorBundleGroup): string | null {
  if (!group.soldCount) return null;
  const parts = [`Sold ${group.soldCount} time${group.soldCount === 1 ? '' : 's'}`];
  parts.push(group.lossCount === 0 ? 'always at a profit' : `${group.lossCount} at a loss`);
  let sentence = `${parts.join(', ')}.`;
  if (group.sellEbayCount > 0 && group.sellEbayCount !== group.sellKaCount) {
    const faster = group.sellEbayCount > group.sellKaCount ? 'eBay' : 'Kleinanzeigen';
    sentence += ` Moves fastest on ${faster}.`;
  }
  if (group.currentStock < group.targetStock) {
    sentence += ` You're at ${group.currentStock} of your usual ${group.targetStock} in stock.`;
  }
  return sentence;
}

const StatTile: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg bg-slate-50 px-2.5 py-2">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
    <p className="text-sm font-black text-slate-900 flex items-center gap-1">{value}</p>
  </div>
);

const ReinvestCard: React.FC<Props> = ({
  group,
  fees,
  initialMarginPct,
  onPurchaseConfirmed,
  onOpenHypothesisSearch,
}) => {
  const navigate = useNavigate();
  const [marginPct, setMarginPct] = useState<number>(initialMarginPct ?? defaultMarginForGroup(group));
  const [expanded, setExpanded] = useState(false);
  const [activeMarket, setActiveMarket] = useState<'ebay' | 'kleinanzeigen'>(
    group.sellEbayCount >= group.sellKaCount ? 'ebay' : 'kleinanzeigen',
  );

  const calc = useMemo(() => computeReinvestPricing(group, fees, marginPct), [group, fees, marginPct]);
  const narrative = useMemo(() => buildNarrative(group), [group]);
  const { Icon, bg, fg } = iconForGroup(group);

  const handleMarginChange = (value: number) => {
    setMarginPct(value);
    saveReinvestMarginOverride(group.key, value);
  };

  const handleConfirmPurchase = () => {
    const prefill: Partial<InventoryItem> = {
      category: group.sampleCategory,
      subCategory: group.sampleSubCategory,
      buyPrice: calc.suggestedMaxBuy ?? undefined,
      buyDate: new Date().toISOString().split('T')[0],
      status: ItemStatus.IN_STOCK,
    };
    onPurchaseConfirmed?.(calc.suggestedMaxBuy ?? 0);
    navigate('/panel/add/item', { state: { reinvestPrefill: prefill } });
  };

  const notifyHypothesisOpen = () => {
    if (group.kind === 'hypothesis') onOpenHypothesisSearch?.(group.key);
  };

  const handleFindLots = () => {
    setExpanded(true);
    notifyHypothesisOpen();
  };

  const handleSwitchMarket = (m: 'ebay' | 'kleinanzeigen') => {
    setActiveMarket(m);
    notifyHypothesisOpen();
  };

  const TrendIcon = group.trend === 'up' ? TrendingUp : group.trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    group.trend === 'up' ? 'text-emerald-600' : group.trend === 'down' ? 'text-rose-600' : 'text-slate-400';

  const kindBadge =
    group.kind === 'hypothesis'
      ? { label: 'Hypothesis', cls: 'bg-amber-100 text-amber-700' }
      : group.kind === 'bundle'
        ? { label: 'Bundle', cls: 'bg-violet-100 text-violet-700' }
        : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all p-4">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
          <Icon size={18} className={fg} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {kindBadge && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${kindBadge.cls}`}>
                {kindBadge.label}
              </span>
            )}
            <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[group.confidence]}`} />
              {group.soldCount > 0 ? `${group.soldCount} sold` : 'AI idea'}
            </span>
          </div>
          <h3 className="font-black text-slate-900 text-sm truncate" title={group.label}>
            {group.label}
          </h3>
        </div>
        {group.kind !== 'hypothesis' && (
          <span className="shrink-0 text-[10px] font-black px-2 py-1 rounded-full bg-amber-100 text-amber-700">
            {group.currentStock} of {group.targetStock}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2.5">
        {group.verdict === 'restock' && (
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 inline-block">
            Restock · sells well
          </p>
        )}
        <p className="text-xl font-black text-slate-900">
          Buy ≤ {calc.suggestedMaxBuy != null ? formatEURPrefix(calc.suggestedMaxBuy) : '—'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Sell on KA</p>
            <p className="text-sm font-black text-slate-900">
              {calc.sellKa > 0 ? formatEURPrefix(calc.sellKa) : '—'}
            </p>
            {calc.sellKaSource === 'derived' && (
              <p className="text-[9px] font-semibold text-slate-400">from eBay pocket</p>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
              Sell on eBay · {calc.ebayFeePct}% fees
            </p>
            <p className="text-sm font-black text-slate-900">
              {calc.sellEbay > 0 ? formatEURPrefix(calc.sellEbay) : '—'}
            </p>
            {calc.pocketEbay > 0 && (
              <p className="text-[9px] font-semibold text-slate-500">
                → {formatEURPrefix(calc.pocketEbay)} pocket
                {calc.sellEbaySource === 'derived' ? ' · matched to KA' : ''}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
          <TrendIcon size={13} className={trendColor} />~
          {Math.round(group.avgDaysToSell)}d
          {group.profitPerDay > 0 && <> · {formatEURPrefix(group.profitPerDay)}/day</>}
          {group.soldCount > 0 && <> · {group.soldCount} sold</>}
        </p>
      </div>

      <button
        type="button"
        onClick={handleFindLots}
        className="mt-3 w-full py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-wider"
      >
        Find lots
      </button>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={handleConfirmPurchase}
          className="text-[11px] font-bold text-brand-600 hover:text-brand-700"
        >
          Already bought it?
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          Details {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          {narrative && <p className="text-xs text-slate-600 leading-relaxed">{narrative}</p>}

          {group.warning && (
            <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {group.warning}
            </p>
          )}
          {group.reasonNote && (
            <p className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
              {group.reasonNote}
            </p>
          )}
          {group.seasonalNote && (
            <p className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <Calendar size={13} className="shrink-0 mt-0.5" /> {group.seasonalNote}
            </p>
          )}

          {group.soldCount > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Avg profit" value={formatEURPrefix(group.allInclAvgProfit)} />
              <StatTile
                label="Price range"
                value={group.sellLow != null && group.sellHigh != null ? `${formatEURPrefix(group.sellLow)}–${formatEURPrefix(group.sellHigh)}` : '—'}
              />
              <StatTile
                label="Trend"
                value={
                  <>
                    <TrendIcon size={13} className={trendColor} />
                    {group.trend === 'up' ? 'Up' : group.trend === 'down' ? 'Down' : 'Flat'}
                  </>
                }
              />
            </div>
          )}

          <p className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            {calc.advice}
          </p>

          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="text-slate-400 font-semibold py-0.5">Kleinanzeigen history</td>
                <td className="text-right font-bold text-slate-700 py-0.5">
                  {group.sellKaCount > 0
                    ? `${group.sellKaCount} sold · avg ${formatEURPrefix(group.sellKaMedian!)}`
                    : calc.sellKaSource === 'derived'
                      ? `suggested ${formatEURPrefix(calc.sellKa)}`
                      : 'no data'}
                </td>
              </tr>
              <tr>
                <td className="text-slate-400 font-semibold py-0.5">eBay history (list)</td>
                <td className="text-right font-bold text-slate-700 py-0.5">
                  {group.sellEbayCount > 0
                    ? `${group.sellEbayCount} sold · avg ${formatEURPrefix(group.sellEbayMedian!)}`
                    : calc.sellEbaySource === 'derived'
                      ? `suggested ${formatEURPrefix(calc.sellEbay)} after ${calc.ebayFeePct}% fees`
                      : 'no data'}
                </td>
              </tr>
            </tbody>
          </table>

          <div>
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
              <span>Target margin</span>
              <span className="text-slate-900">{marginPct}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={80}
              step={5}
              value={marginPct}
              onChange={(e) => handleMarginChange(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                <p className="font-black text-slate-400 uppercase tracking-wider text-[9px]">
                  KA @ {calc.sellKa > 0 ? formatEURPrefix(calc.sellKa) : '—'}
                </p>
                {calc.ka ? (
                  <p className="font-bold text-slate-800">+{formatEURPrefix(calc.ka.netProfit)} net</p>
                ) : (
                  <p className="text-slate-400">no data</p>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                <p className="font-black text-slate-400 uppercase tracking-wider text-[9px]">
                  eBay @ {calc.sellEbay > 0 ? formatEURPrefix(calc.sellEbay) : '—'}
                </p>
                {calc.ebay ? (
                  <p className="font-bold text-slate-800">
                    +{formatEURPrefix(calc.ebay.netProfit)} net · {formatEURPrefix(calc.ebay.pocket)} pocket
                  </p>
                ) : (
                  <p className="text-slate-400">no data</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => handleSwitchMarket('ebay')}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                activeMarket === 'ebay' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              eBay.de
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMarket('kleinanzeigen')}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                activeMarket === 'kleinanzeigen' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              Kleinanzeigen
            </button>
          </div>
          <ReinvestListingResults query={group.label} marketplace={activeMarket} maxPrice={calc.suggestedMaxBuy ?? undefined} />
        </div>
      )}
    </div>
  );
};

export default ReinvestCard;
