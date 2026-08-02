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
  gpu: { Icon: Gamepad2, bg: 'bg-[#eef2ff]', fg: 'text-[#4338ca]' },
  cpu: { Icon: Cpu, bg: 'bg-[#eff6ff]', fg: 'text-[#1d4ed8]' },
  ram: { Icon: Layers, bg: 'bg-[#f5f3ff]', fg: 'text-[#6d28d9]' },
  storage: { Icon: Database, bg: 'bg-[#ecfdf5]', fg: 'text-[#047857]' },
  motherboard: { Icon: CircuitBoard, bg: 'bg-[#eff6ff]', fg: 'text-[#1d4ed8]' },
  psu: { Icon: Zap, bg: 'bg-[#fffbeb]', fg: 'text-[#b45309]' },
  case: { Icon: Box, bg: 'bg-[#f8fafc]', fg: 'text-[#475569]' },
  cooler: { Icon: Wind, bg: 'bg-[#f0f9ff]', fg: 'text-[#0369a1]' },
};
const DEFAULT_ICON = { Icon: Package, bg: 'bg-[#f8fafc]', fg: 'text-[#475569]' };

function iconForGroup(group: ReinvestGroup | AnchorBundleGroup) {
  const prefix = group.kind === 'bundle' ? group.siblingCategory : group.key.split(':')[0];
  return CATEGORY_ICON[prefix] || DEFAULT_ICON;
}

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
    group.trend === 'up' ? 'text-[var(--rx-ok)]' : group.trend === 'down' ? 'text-[var(--rx-bad)]' : 'text-[var(--rx-muted)]';

  return (
    <div className="rx-panel p-4 flex flex-col h-full transition-shadow hover:shadow-[0_12px_32px_rgba(15,20,25,0.08)]">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
          <Icon size={17} className={fg} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {group.kind === 'hypothesis' && <span className="rx-pill rx-pill-warn">Idea</span>}
            {group.kind === 'bundle' && <span className="rx-pill">Kit</span>}
            <span className="text-[11px] text-[var(--rx-muted)] font-medium flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[group.confidence]}`} />
              {group.soldCount > 0 ? `${group.soldCount} sold` : 'new'}
            </span>
          </div>
          <h3 className="font-semibold text-[14px] tracking-tight text-[var(--rx-ink)] truncate mt-0.5" title={group.label}>
            {group.label}
          </h3>
        </div>
        {group.kind !== 'hypothesis' && (
          <span className="rx-num shrink-0 text-[12px] font-semibold text-[var(--rx-muted)]">
            {group.currentStock}/{group.targetStock}
          </span>
        )}
      </div>

      <div className="mt-4 flex-1 space-y-3">
        <div>
          <p className="text-[11px] text-[var(--rx-muted)] font-medium">Buy up to</p>
          <p className="rx-num text-[26px] font-semibold tracking-tight leading-none mt-1">
            {calc.suggestedMaxBuy != null ? formatEURPrefix(calc.suggestedMaxBuy) : '—'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[var(--rx-soft)] px-2.5 py-2">
            <p className="text-[10px] text-[var(--rx-muted)] font-medium">KA</p>
            <p className="rx-num text-[14px] font-semibold mt-0.5">
              {calc.sellKa > 0 ? formatEURPrefix(calc.sellKa) : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-[var(--rx-soft)] px-2.5 py-2">
            <p className="text-[10px] text-[var(--rx-muted)] font-medium">eBay</p>
            <p className="rx-num text-[14px] font-semibold mt-0.5">
              {calc.sellEbay > 0 ? formatEURPrefix(calc.sellEbay) : '—'}
            </p>
          </div>
        </div>

        <p className="text-[12px] text-[var(--rx-muted)] font-medium flex items-center gap-1.5">
          <TrendIcon size={13} className={trendColor} />
          <span className="rx-num">~{Math.round(group.avgDaysToSell)}d</span>
          {group.profitPerDay > 0 && (
            <span className="rx-num">· {formatEURPrefix(group.profitPerDay)}/day</span>
          )}
        </p>
      </div>

      <button type="button" onClick={handleFindLots} className="rx-cta mt-4">
        Find lots
      </button>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={handleConfirmPurchase} className="rx-link">
          Bought it
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[12px] font-medium text-[var(--rx-muted)] flex items-center gap-1"
        >
          More {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--rx-line)] space-y-3">
          {group.warning && (
            <p className="text-[11px] font-medium text-[var(--rx-warn)] bg-[var(--rx-warn-soft)] rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {group.warning}
            </p>
          )}
          {group.seasonalNote && (
            <p className="text-[11px] font-medium text-[var(--rx-ok)] bg-[var(--rx-ok-soft)] rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <Calendar size={13} className="shrink-0 mt-0.5" /> {group.seasonalNote}
            </p>
          )}

          {group.soldCount > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[var(--rx-soft)] px-2 py-1.5">
                <p className="text-[9px] text-[var(--rx-muted)]">Pocket</p>
                <p className="rx-num text-[13px] font-semibold">{formatEURPrefix(group.allInclAvgProfit)}</p>
              </div>
              <div className="rounded-lg bg-[var(--rx-soft)] px-2 py-1.5">
                <p className="text-[9px] text-[var(--rx-muted)]">Range</p>
                <p className="rx-num text-[12px] font-semibold truncate">
                  {group.sellLow != null && group.sellHigh != null
                    ? `${formatEURPrefix(group.sellLow)}–${formatEURPrefix(group.sellHigh)}`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--rx-soft)] px-2 py-1.5">
                <p className="text-[9px] text-[var(--rx-muted)]">Trend</p>
                <p className="text-[12px] font-semibold flex items-center gap-1">
                  <TrendIcon size={12} className={trendColor} />
                  {group.trend === 'up' ? 'Up' : group.trend === 'down' ? 'Down' : 'Flat'}
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--rx-muted)] mb-1">
              <span>Margin</span>
              <span className="rx-num text-[var(--rx-ink)]">{marginPct}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={80}
              step={5}
              value={marginPct}
              onChange={(e) => handleMarginChange(Number(e.target.value))}
              className="w-full accent-[var(--rx-ink)]"
            />
          </div>

          <div className="rx-seg w-full">
            <button
              type="button"
              aria-pressed={activeMarket === 'kleinanzeigen'}
              className="flex-1"
              onClick={() => handleSwitchMarket('kleinanzeigen')}
            >
              KA
            </button>
            <button
              type="button"
              aria-pressed={activeMarket === 'ebay'}
              className="flex-1"
              onClick={() => handleSwitchMarket('ebay')}
            >
              eBay
            </button>
          </div>

          <ReinvestListingResults
            query={group.label}
            marketplace={activeMarket}
            maxPrice={calc.suggestedMaxBuy ?? undefined}
          />
        </div>
      )}
    </div>
  );
};

export default ReinvestCard;
