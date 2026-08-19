import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Download, Target, Package, TrendingUp, Percent } from 'lucide-react';
import type { InventoryItem, Expense, TaxMode } from '../types';
import { ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  profitByPlatform,
  profitByCategoryTrend,
  daysInStockHistogram,
  sellThroughRate,
  inventoryValuation,
  profitGoalProgress,
  filterByDateRange,
  type DateRange,
} from '../utils/dashboardAnalytics';
import { summarizeEbayMarketplaceCosts } from '../utils/ebayMarketplaceStats';
import { shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';
import { summarizePriceLab, getOrRebuildItemSalesPool } from '../utils/itemSalesPool';
import PlatformBadge from './PlatformBadge';
import { Link } from 'react-router-dom';

interface Props {
  items: InventoryItem[];
  expenses: Expense[];
  range: DateRange;
  rangeLabel: string;
  profitGoal: number;
  taxMode?: TaxMode;
}

const TAX_MODE_SHORT: Record<TaxMode, string> = {
  SmallBusiness: 'Kleinunternehmer',
  DifferentialVAT: 'Diff. VAT',
  RegularVAT: '19% VAT',
};

const DashboardAnalyticsPanel: React.FC<Props> = ({ items, expenses, range, rangeLabel, profitGoal, taxMode = 'SmallBusiness' }) => {
  const byPlatform = useMemo(() => profitByPlatform(items, range, taxMode), [items, range, taxMode]);
  const byCategory = useMemo(() => profitByCategoryTrend(items, range, taxMode), [items, range, taxMode]);
  const daysHist = useMemo(() => daysInStockHistogram(items), [items]);
  const sellThrough = useMemo(() => sellThroughRate(items, range), [items, range]);
  const valuation = useMemo(() => inventoryValuation(items), [items]);
  const goal = useMemo(() => profitGoalProgress(items, expenses, range, profitGoal, taxMode), [items, expenses, range, profitGoal, taxMode]);
  const priceLab = useMemo(() => summarizePriceLab(items, getOrRebuildItemSalesPool(items)), [items]);
  const ebayFees = useMemo(() => {
    const sold = items.filter(
      (i) =>
        i.status === ItemStatus.SOLD &&
        filterByDateRange(i.sellDate, range) &&
        !shouldSkipForAggregatedSaleLine(i, items)
    );
    return summarizeEbayMarketplaceCosts(sold);
  }, [items, range]);

  const exportCsv = (filename: string, rows: Record<string, string | number>[]) => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(';'), ...rows.map((r) => keys.map((k) => r[k]).join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
          Extended analytics · {rangeLabel}
          <span className="ml-2 font-bold normal-case tracking-normal text-slate-400">
            profit · {TAX_MODE_SHORT[taxMode]}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => exportCsv(`profit-by-platform-${rangeLabel}.csv`, byPlatform)}
          className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1 text-slate-500 hover:text-slate-800"
        >
          <Download size={12} /> Export platform CSV
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><Target size={12} /> Profit goal</p>
          <p className="text-2xl font-black text-slate-900">{goal.pct}%</p>
          <p className="text-xs text-slate-500">€{formatEUR(goal.profit)} / €{formatEUR(goal.goal)}</p>
        </div>
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><TrendingUp size={12} /> Sell-through</p>
          <p className="text-2xl font-black text-slate-900">{sellThrough.rate}%</p>
          <p className="text-xs text-slate-500">{sellThrough.sold} sold / {sellThrough.bought} bought</p>
        </div>
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><Package size={12} /> Stock value</p>
          <p className="text-2xl font-black text-slate-900">€{formatEUR(valuation.buyTotal)}</p>
          <p className="text-xs text-slate-500">Est. sell €{formatEUR(valuation.estSellTotal)}</p>
        </div>
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-[10px] font-bold uppercase text-slate-400">Potential</p>
          <p className={`text-2xl font-black ${valuation.potentialProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            €{formatEUR(valuation.potentialProfit)}
          </p>
          <p className="text-xs text-slate-500">{valuation.count} in stock</p>
        </div>
      </div>

      {ebayFees.saleCount > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-4">
            <p className="text-[10px] font-bold uppercase text-orange-700">eBay fees</p>
            <p className="text-2xl font-black text-orange-700">€{formatEUR(ebayFees.ebayFeeEur)}</p>
            <p className="text-xs text-orange-800/80">{ebayFees.saleCount} eBay sales</p>
          </div>
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-4">
            <p className="text-[10px] font-bold uppercase text-orange-700">Ad fees</p>
            <p className="text-2xl font-black text-orange-700">€{formatEUR(ebayFees.adFeeEur)}</p>
            <p className="text-xs text-orange-800/80">Promoted Listings</p>
          </div>
          <div className="bg-white rounded-2xl border p-4">
            <p className="text-[10px] font-bold uppercase text-slate-400">Buyer paid → kept</p>
            <p className="text-2xl font-black text-slate-900">€{formatEUR(ebayFees.netEur)}</p>
            <p className="text-xs text-slate-500">of €{formatEUR(ebayFees.grossEur)} gross</p>
          </div>
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-4">
            <p className="text-[10px] font-bold uppercase text-orange-700 flex items-center gap-1">
              <Percent size={12} /> Avg lost on eBay
            </p>
            <p className="text-2xl font-black text-orange-700">
              {ebayFees.avgTakePct != null ? `${formatEUR(ebayFees.avgTakePct)}%` : '—'}
            </p>
            <p className="text-xs text-orange-800/80">€150 sale → keep ~€{ebayFees.avgTakePct != null ? formatEUR(150 * (1 - ebayFees.avgTakePct / 100)) : '—'}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-black uppercase text-slate-400">Price Lab · part-level sales pool</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400">Events</p>
            <p className="text-xl font-black text-slate-900">{priceLab.eventCount}</p>
            <p className="text-[10px] text-slate-500">
              {priceLab.bundleAttributedCount} from kits
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400">Avg margin</p>
            <p className="text-xl font-black text-emerald-700">
              {priceLab.avgMarginPct != null ? `${Math.round(priceLab.avgMarginPct)}%` : '—'}
            </p>
            <p className="text-[10px] text-slate-500">target curve 60→30%</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400">Avg hold</p>
            <p className="text-xl font-black text-slate-900">
              {priceLab.avgDaysHeld != null ? `${priceLab.avgDaysHeld}d` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400">Models tracked</p>
            <p className="text-xl font-black text-slate-900">{priceLab.modelCoverage.length}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border p-4 h-[280px]">
          <p className="text-xs font-black uppercase text-slate-400 mb-2">Profit by platform</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={byPlatform}>
              <XAxis dataKey="platform" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).replace('.de', '')} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => `€${formatEUR(v)}`} />
              <Bar dataKey="profit" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-2 mt-1 flex-wrap">
            {byPlatform.map((p) => (
              <span key={p.platform} className="flex items-center gap-1 text-[9px]">
                <PlatformBadge platform={p.platform} showFull /> €{formatEUR(p.profit)}
              </span>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl border p-4 h-[280px]">
          <p className="text-xs font-black uppercase text-slate-400 mb-2">Profit by category</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={byCategory.slice(0, 8)} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="category" width={80} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => `€${formatEUR(v)}`} />
              <Bar dataKey="profit" fill="#6366f1" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl border p-4 h-[240px] lg:col-span-2">
          <p className="text-xs font-black uppercase text-slate-400 mb-2">Days in stock (active items)</p>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={daysHist}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};

export default DashboardAnalyticsPanel;
