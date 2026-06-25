import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Download, Target, Package, TrendingUp } from 'lucide-react';
import type { InventoryItem, Expense } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  profitByPlatform,
  profitByCategoryTrend,
  daysInStockHistogram,
  sellThroughRate,
  inventoryValuation,
  profitGoalProgress,
  type DateRange,
} from '../utils/dashboardAnalytics';
import PlatformBadge from './PlatformBadge';

interface Props {
  items: InventoryItem[];
  expenses: Expense[];
  range: DateRange;
  rangeLabel: string;
  profitGoal: number;
}

const DashboardAnalyticsPanel: React.FC<Props> = ({ items, expenses, range, rangeLabel, profitGoal }) => {
  const byPlatform = useMemo(() => profitByPlatform(items, range), [items, range]);
  const byCategory = useMemo(() => profitByCategoryTrend(items, range), [items, range]);
  const daysHist = useMemo(() => daysInStockHistogram(items), [items]);
  const sellThrough = useMemo(() => sellThroughRate(items, range), [items, range]);
  const valuation = useMemo(() => inventoryValuation(items), [items]);
  const goal = useMemo(() => profitGoalProgress(items, expenses, range, profitGoal), [items, expenses, range, profitGoal]);

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
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Extended analytics · {rangeLabel}</h2>
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
