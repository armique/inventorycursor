import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Package,
  Plus,
  Zap,
  Receipt,
  ScanBarcode,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Tag,
  DollarSign,
  Settings,
} from 'lucide-react';
import { InventoryItem, Expense, BusinessSettings, ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { roundMoney } from '../services/financialAggregation';

interface MobileDashboardViewProps {
  items: InventoryItem[];
  expenses: Expense[];
  monthlyGoal: number;
  businessSettings?: BusinessSettings;
  gameStats: {
    allTimeProfit: number;
    monthProfit: number;
    monthRevenue: number;
    monthSoldCount: number;
    goalProgress: number;
    currentLevel: { name: string; icon: React.ReactNode; color: string; bg: string };
  };
  onOpenQuickAdd?: () => void;
}

export const MobileDashboardView: React.FC<MobileDashboardViewProps> = ({
  items,
  expenses,
  monthlyGoal,
  businessSettings,
  gameStats,
  onOpenQuickAdd,
}) => {
  const navigate = useNavigate();

  // Financial calculations
  const activeStockItems = useMemo(() => items.filter((i) => !i.is_trash && i.status === ItemStatus.IN_STOCK), [items]);
  const activeStockCount = activeStockItems.length;
  const activeStockValue = useMemo(
    () => roundMoney(activeStockItems.reduce((sum, item) => sum + (Number(item.buyPrice) || 0), 0)),
    [activeStockItems]
  );

  const profitMarginPercent = useMemo(() => {
    if (gameStats.monthRevenue <= 0) return 0;
    return Math.min(100, Math.round((gameStats.monthProfit / gameStats.monthRevenue) * 100));
  }, [gameStats.monthProfit, gameStats.monthRevenue]);

  // Recent activity feed (latest 5 sold, added, or linked items)
  const recentActivities = useMemo(() => {
    const active = items.filter((i) => !i.is_trash);
    const sorted = [...active].sort((a, b) => {
      const dateA = a.sellDate || a.createdAt || '';
      const dateB = b.sellDate || b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    return sorted.slice(0, 5);
  }, [items]);

  // SVG Circular progress radius
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, gameStats.goalProgress)) / 100) * circumference;

  return (
    <div className="md:hidden flex flex-col gap-4 pb-20 px-3 pt-2 bg-slate-950 text-slate-100 min-h-screen">
      {/* Top Greeting & Level Badge */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-md shadow-emerald-950">
            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-emerald-400 font-black text-sm">
              {businessSettings?.companyName?.slice(0, 2).toUpperCase() || 'IP'}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400">Welcome back</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Sparkles size={10} /> Pro
              </span>
            </div>
            <h2 className="text-base font-black tracking-tight text-white">
              {businessSettings?.ownerName || businessSettings?.companyName || 'Inventory Pro'}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/panel/settings')}
          className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center shadow-sm"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Hero Financial Card: Circular Goal Progress & Key Metrics */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/90 to-slate-900/50 border border-slate-800 p-4 shadow-xl shadow-black/40 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          {/* Circular Progress Gauge */}
          <div className="relative flex items-center justify-center shrink-0">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="text-slate-800"
                strokeWidth="7"
                stroke="currentColor"
                fill="transparent"
              />
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="text-emerald-400 transition-all duration-1000 ease-out"
                strokeWidth="7"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                stroke="currentColor"
                fill="transparent"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-sm font-black text-emerald-400">{Math.round(gameStats.goalProgress)}%</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Goal</span>
            </div>
          </div>

          {/* Revenue & Monthly Target */}
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Monthly Revenue</span>
            <div className="text-xl font-black text-white tabular-nums tracking-tight">
              {formatEUR(gameStats.monthRevenue)}
            </div>
            <div className="text-[11px] font-medium text-slate-400 mt-0.5">
              Target: <span className="text-slate-300 font-bold">{formatEUR(monthlyGoal)}</span>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                <ArrowUpRight size={12} /> {gameStats.monthSoldCount} sold
              </span>
            </div>
          </div>
        </div>

        {/* 2-Column Sub-metrics: Net Profit & Active Stock */}
        <div className="mt-3.5 pt-3.5 border-t border-slate-800/80 grid grid-cols-2 gap-2">
          <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/60 flex flex-col">
            <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <TrendingUp size={11} className="text-emerald-400" /> Net Profit
            </span>
            <span className="text-sm font-black text-emerald-400 tabular-nums mt-0.5">
              {formatEUR(gameStats.monthProfit)}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
              {profitMarginPercent > 0 ? `+${profitMarginPercent}% margin` : '0% margin'}
            </span>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/60 flex flex-col">
            <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <Package size={11} className="text-sky-400" /> Active Stock
            </span>
            <span className="text-sm font-black text-white tabular-nums mt-0.5">
              {activeStockCount} items
            </span>
            <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
              {formatEUR(activeStockValue)} EK
            </span>
          </div>
        </div>
      </div>

      {/* Quick Launch Action 2x2 Grid */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Quick Launch</h3>
          <span className="text-[10px] font-bold text-slate-500">1-Tap Actions</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {/* Action 1: Quick Add / Scan */}
          <button
            type="button"
            onClick={() => {
              if (onOpenQuickAdd) onOpenQuickAdd();
              else navigate('/panel/add');
            }}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 hover:border-emerald-400 active:scale-[0.98] transition-all text-left shadow-md shadow-emerald-950/20"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2 shadow-inner">
              <ScanBarcode size={20} />
            </div>
            <span className="text-xs font-black text-white">Quick Add & Scan</span>
            <span className="text-[10px] font-medium text-slate-400 mt-0.5">Camera & AI Autofill</span>
          </button>

          {/* Action 2: eBay Abrechnung Matcher */}
          <button
            type="button"
            onClick={() => navigate('/panel/ebay-abrechnung')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 active:scale-[0.98] transition-all text-left shadow-md"
          >
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center mb-2 shadow-inner">
              <Zap size={20} />
            </div>
            <span className="text-xs font-black text-white">eBay Abrechnung</span>
            <span className="text-[10px] font-medium text-slate-400 mt-0.5">Reconcile & Payouts</span>
          </button>

          {/* Action 3: Expense Log */}
          <button
            type="button"
            onClick={() => navigate('/panel/expenses')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 active:scale-[0.98] transition-all text-left shadow-md"
          >
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-2 shadow-inner">
              <Receipt size={20} />
            </div>
            <span className="text-xs font-black text-white">Expense Log</span>
            <span className="text-[10px] font-medium text-slate-400 mt-0.5">Workshop & Shipping</span>
          </button>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="mt-1">
        <div className="flex items-center justify-between px-1 mb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Recent Activity</h3>
          <button
            type="button"
            onClick={() => navigate('/panel/action-history')}
            className="text-[11px] font-bold text-emerald-400 hover:underline flex items-center gap-0.5"
          >
            View All <ChevronRight size={12} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {recentActivities.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
              No recent activity found. Add your first item to start tracking!
            </div>
          ) : (
            recentActivities.map((item) => {
              const isSold = item.status === ItemStatus.SOLD;
              const hasEbay = Boolean(item.ebayOrderId);
              return (
                <div
                  key={item.id}
                  onClick={() => navigate(`/panel/edit/${item.id}`)}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Photo or Category Icon */}
                  <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 shrink-0 overflow-hidden flex items-center justify-center">
                    {item.images?.[0] ? (
                      <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={18} className="text-slate-500" />
                    )}
                  </div>

                  {/* Item Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          isSold
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                            : 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                        }`}
                      >
                        {isSold ? 'Sold' : 'In Stock'}
                      </span>
                      {hasEbay && (
                        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                          ⚡ eBay
                        </span>
                      )}
                      <span className="text-[10px] font-medium text-slate-500 truncate">
                        {item.category || 'Hardware'}
                      </span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-white tabular-nums">
                      {isSold ? formatEUR(item.sellPrice || 0) : formatEUR(item.buyPrice || 0)}
                    </div>
                    <div className="text-[9px] font-bold uppercase text-slate-500">
                      {isSold ? 'VK' : 'EK'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileDashboardView;
