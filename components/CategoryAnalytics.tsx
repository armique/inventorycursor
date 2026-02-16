import React, { useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Clock, Package, Euro, Percent, ChevronDown, ChevronRight } from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings } from '../types';

interface Props {
  items: InventoryItem[];
  businessSettings?: BusinessSettings;
}

type TimeFilter = 'ALL' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';

function calculateItemProfit(item: InventoryItem, taxMode: string): number {
  const sell = Number(item.sellPrice) || 0;
  const buy = Number(item.buyPrice) || 0;
  const fee = Number(item.feeAmount) || 0;
  if (taxMode === 'RegularVAT') {
    const netSell = sell / 1.19;
    return netSell - buy - fee;
  }
  if (taxMode === 'DifferentialVAT') {
    const margin = sell - buy;
    if (margin <= 0) return margin - fee;
    const tax = margin - margin / 1.19;
    return margin - tax - fee;
  }
  return sell - buy - fee;
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export interface CategoryStat {
  category: string;
  subCategory?: string;
  label: string;
  count: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  avgMarginPct: number;
  avgDaysToSell: number;
}

const CategoryAnalytics: React.FC<Props> = ({ items, businessSettings }) => {
  const taxMode = businessSettings?.taxMode || 'SmallBusiness';
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('ALL');
  const [expandCategory, setExpandCategory] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'profit' | 'count' | 'margin' | 'days'>('profit');

  const soldItems = useMemo(() => {
    return items.filter(
      (i) => i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED
    );
  }, [items]);

  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    let start = new Date(0);
    if (timeFilter === 'LAST_90') {
      start = new Date();
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
    } else if (timeFilter === 'THIS_YEAR') {
      start = new Date(end.getFullYear(), 0, 1);
    } else if (timeFilter === 'LAST_YEAR') {
      start = new Date(end.getFullYear() - 1, 0, 1);
      const e = new Date(end.getFullYear() - 1, 11, 31, 23, 59, 59);
      return { startDate: start, endDate: e };
    }
    return { startDate: start, endDate: end };
  }, [timeFilter]);

  const filteredSold = useMemo(() => {
    return soldItems.filter((i) => {
      const d = i.sellDate ? new Date(i.sellDate) : null;
      if (!d) return false;
      return d.getTime() >= startDate.getTime() && d.getTime() <= endDate.getTime();
    });
  }, [soldItems, startDate, endDate]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { items: InventoryItem[]; bySub: Map<string, InventoryItem[]> }>();
    filteredSold.forEach((item) => {
      const cat = item.category || 'Other';
      const sub = item.subCategory || '(no subcategory)';
      if (!map.has(cat)) {
        map.set(cat, { items: [], bySub: new Map() });
      }
      const entry = map.get(cat)!;
      entry.items.push(item);
      if (!entry.bySub.has(sub)) entry.bySub.set(sub, []);
      entry.bySub.get(sub)!.push(item);
    });
    return map;
  }, [filteredSold]);

  const categoryStats = useMemo((): CategoryStat[] => {
    const result: CategoryStat[] = [];
    byCategory.forEach((entry, category) => {
      const list = entry.items;
      const totalRevenue = list.reduce((a, i) => a + (Number(i.sellPrice) || 0), 0);
      const totalCost = list.reduce((a, i) => a + Number(i.buyPrice), 0);
      const totalProfit = list.reduce((a, i) => a + calculateItemProfit(i, taxMode), 0);
      const withDates = list.filter((i) => i.buyDate && i.sellDate);
      const avgDays =
        withDates.length > 0
          ? withDates.reduce((a, i) => a + daysBetween(i.buyDate!, i.sellDate!), 0) / withDates.length
          : 0;
      const avgMarginPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
      result.push({
        category,
        label: category,
        count: list.length,
        totalRevenue,
        totalCost,
        totalProfit,
        avgMarginPct,
        avgDaysToSell: Math.round(avgDays),
      });
    });
    return result.sort((a, b) => {
      if (sortBy === 'profit') return b.totalProfit - a.totalProfit;
      if (sortBy === 'count') return b.count - a.count;
      if (sortBy === 'margin') return b.avgMarginPct - a.avgMarginPct;
      return a.avgDaysToSell - b.avgDaysToSell;
    });
  }, [byCategory, taxMode, sortBy]);

  const subCategoryStats = useMemo(() => {
    const map = new Map<string, CategoryStat[]>();
    byCategory.forEach((entry, category) => {
      const rows: CategoryStat[] = [];
      entry.bySub.forEach((list, sub) => {
        const totalRevenue = list.reduce((a, i) => a + (Number(i.sellPrice) || 0), 0);
        const totalCost = list.reduce((a, i) => a + Number(i.buyPrice), 0);
        const totalProfit = list.reduce((a, i) => a + calculateItemProfit(i, taxMode), 0);
        const withDates = list.filter((i) => i.buyDate && i.sellDate);
        const avgDays =
          withDates.length > 0
            ? withDates.reduce((a, i) => a + daysBetween(i.buyDate!, i.sellDate!), 0) / withDates.length
            : 0;
        const avgMarginPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
        rows.push({
          category,
          subCategory: sub === '(no subcategory)' ? undefined : sub,
          label: sub,
          count: list.length,
          totalRevenue,
          totalCost,
          totalProfit,
          avgMarginPct,
          avgDaysToSell: Math.round(avgDays),
        });
      });
      map.set(category, rows.sort((a, b) => b.totalProfit - a.totalProfit));
    });
    return map;
  }, [byCategory, taxMode]);

  const totals = useMemo(() => {
    return categoryStats.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        totalRevenue: acc.totalRevenue + r.totalRevenue,
        totalCost: acc.totalCost + r.totalCost,
        totalProfit: acc.totalProfit + r.totalProfit,
      }),
      { count: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0 }
    );
  }, [categoryStats]);

  const totalAvgMarginPct =
    totals.totalCost > 0 ? (totals.totalProfit / totals.totalCost) * 100 : 0;

  return (
    <div className="max-w-[1400px] mx-auto pb-20 px-4 md:px-8 animate-in fade-in duration-300">
      <header className="mb-8 pt-6">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
          <BarChart3 size={32} className="text-blue-500" />
          Category analytics
        </h1>
        <p className="text-slate-500 mt-1">
          Margin and days to sell by category — see what sells best.
        </p>
      </header>

      <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['ALL', 'LAST_90', 'THIS_YEAR', 'LAST_YEAR'] as TimeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setTimeFilter(f)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide border transition-all ${
                timeFilter === f
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {f === 'ALL' && 'All time'}
              {f === 'LAST_90' && 'Last 90 days'}
              {f === 'THIS_YEAR' && `This year (${new Date().getFullYear()})`}
              {f === 'LAST_YEAR' && `Last year (${new Date().getFullYear() - 1})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white"
          >
            <option value="profit">Total profit</option>
            <option value="count">Items sold</option>
            <option value="margin">Avg margin %</option>
            <option value="days">Days to sell</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
            <Package size={12} /> Items sold
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1">{totals.count}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
            <Euro size={12} /> Revenue
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1">
            €{totals.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
            <TrendingUp size={12} /> Net profit
          </p>
          <p className={`text-2xl font-black mt-1 ${totals.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {totals.totalProfit >= 0 ? '+' : ''}€
            {totals.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
            <Percent size={12} /> Avg margin
          </p>
          <p className={`text-2xl font-black mt-1 ${totalAvgMarginPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {totalAvgMarginPct >= 0 ? '+' : ''}{totalAvgMarginPct.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 w-10"></th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4">Category</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 text-right">Sold</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 text-right">Revenue</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 text-right">Profit</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 text-right">Margin %</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-6 py-4 text-right">Avg days to sell</th>
              </tr>
            </thead>
            <tbody>
              {categoryStats.map((row) => (
                <React.Fragment key={row.category}>
                  <tr
                    className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      {subCategoryStats.get(row.category) && subCategoryStats.get(row.category)!.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpandCategory(expandCategory === row.category ? null : row.category)}
                          className="p-1 rounded-lg hover:bg-slate-200 text-slate-500"
                        >
                          {expandCategory === row.category ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      ) : (
                        <span className="w-6 inline-block" />
                      )}
                    </td>
                    <td className="px-6 py-3 font-bold text-slate-900">{row.label}</td>
                    <td className="px-6 py-3 text-right font-medium text-slate-700">{row.count}</td>
                    <td className="px-6 py-3 text-right font-medium text-slate-700">
                      €{row.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-6 py-3 text-right font-bold ${row.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {row.totalProfit >= 0 ? '+' : ''}€
                      {row.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-6 py-3 text-right font-bold ${row.avgMarginPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {row.avgMarginPct >= 0 ? '+' : ''}{row.avgMarginPct.toFixed(1)}%
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-slate-600 flex items-center justify-end gap-1">
                      <Clock size={14} className="text-slate-400" />
                      {row.avgDaysToSell}
                    </td>
                  </tr>
                  {expandCategory === row.category &&
                    subCategoryStats.get(row.category)?.map((sub) => (
                      <tr key={`${row.category}-${sub.label}`} className="border-b border-slate-50 bg-slate-50/30">
                        <td className="px-6 py-2 w-10" />
                        <td className="px-6 py-2 pl-8 text-sm font-medium text-slate-600">{sub.label}</td>
                        <td className="px-6 py-2 text-right text-sm text-slate-600">{sub.count}</td>
                        <td className="px-6 py-2 text-right text-sm text-slate-600">
                          €{sub.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`px-6 py-2 text-right text-sm font-medium ${sub.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {sub.totalProfit >= 0 ? '+' : ''}€
                          {sub.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`px-6 py-2 text-right text-sm ${sub.avgMarginPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {sub.avgMarginPct >= 0 ? '+' : ''}{sub.avgMarginPct.toFixed(1)}%
                        </td>
                        <td className="px-6 py-2 text-right text-sm text-slate-500">{sub.avgDaysToSell}</td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {categoryStats.length === 0 && (
          <div className="p-12 text-center text-slate-500 font-medium">
            No sold items in the selected period. Change the time filter or sell some items to see analytics.
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryAnalytics;
