import React, { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatEUR } from '../utils/formatMoney';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  TrendingUp, Target, Package, TrendingDown, Trophy, Star, Crown, Zap,
  Edit3, Check, CalendarDays, ArrowRight, CheckCircle2, Plus, X, Activity, AlertCircle,
  Settings2, ChevronUp, ChevronDown, ChevronRight, Download, Sparkles, BarChart3, LayoutDashboard,
  Gift, ArrowRightLeft,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  dismissPendingReminder,
  getActiveReminderForDisplay,
  type EbayReminderPending,
} from '../services/ebayListingReminder';
import EbaySoldReminderWidget from './EbaySoldReminderWidget';
import ItemLink from './ItemLink';
import { InventoryItem, ItemStatus, Expense, BusinessSettings, TaxMode, DashboardPreferences, DashboardTask } from '../types';
import { DEFAULT_DASHBOARD_WIDGET_IDS } from '../services/constants';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { calculateTaxSummary, generateTaxReportCSV } from '../services/taxService';
import {
  roundMoney,
  computeItemProfitBeforeOverhead,
  shouldSkipForAggregatedSaleLine,
  shouldSkipForInventoryCostLine,
  shouldSkipContainerForPurchaseCogs,
} from '../services/financialAggregation';
import { toLocalCalendarDateKey, yearMonthKeyFromDate, currentLocalYearMonth } from '../utils/calendarDate';
import { countSalesByPlatform, formatItemSalePlatform, groupSalesByPlatform, PLATFORM_GROUP_LABEL, buildPlatformReconciliation, buildEbayTagFixUpdates, sumRevenueByPlatform, countOrdersByPlatform, groupItemsByMarketplaceOrder, countMissingExplicitSalePlatform, type PlatformGroupKey } from '../utils/salePlatform';

const DashboardAnalyticsPanel = lazy(() => import('./DashboardAnalyticsPanel'));

interface Props {
  items: InventoryItem[];
  expenses?: Expense[];
  monthlyGoal: number;
  onGoalChange: (newGoal: number) => void;
  businessSettings?: BusinessSettings;
  categoryFields?: Record<string, string[]>;
  dashboardPreferences: DashboardPreferences;
  onDashboardPreferencesChange: (next: DashboardPreferences) => void;
  onUpdateItems?: (items: InventoryItem[]) => void;
}

const LEVELS = [
  { name: 'Novice Flipper', min: 0, icon: <Package size={20}/>, color: 'text-slate-500', bg: 'bg-slate-100' },
  { name: 'Hobby Reseller', min: 500, icon: <Star size={20}/>, color: 'text-blue-500', bg: 'bg-blue-100' },
  { name: 'Pro Merchant', min: 2500, icon: <Zap size={20}/>, color: 'text-purple-500', bg: 'bg-purple-100' },
  { name: 'Market Tycoon', min: 10000, icon: <Crown size={20}/>, color: 'text-yellow-500', bg: 'bg-yellow-100' },
  { name: 'Inventory Legend', min: 50000, icon: <Trophy size={20}/>, color: 'text-emerald-500', bg: 'bg-emerald-100' }
];

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#64748B'];

const DASHBOARD_WIDGET_IDS = DEFAULT_DASHBOARD_WIDGET_IDS;

type WidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

const TIME_FILTER_LABELS: Record<string, string> = {
  ALL: 'All time',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  LAST_7: 'Last 7 days',
  LAST_30: 'Last 30 days',
  LAST_90: 'Last 90 days',
  CUSTOM: 'Custom range',
};

function formatYearMonthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

const DASH_CARD = 'bg-white rounded-xl lg:rounded-2xl border border-slate-200/90 shadow-sm';
/** Chart / side-panel height scales with viewport on large screens */
const CHART_PANEL_H =
  'h-[220px] sm:h-[280px] md:h-[320px] lg:h-[min(42vh,420px)] xl:h-[min(45vh,480px)] 2xl:h-[min(48vh,520px)] min-h-[220px]';
const CARD_PAD = 'p-3 sm:p-4 lg:p-5 xl:p-6';
const KPI_LABEL = 'text-[10px] sm:text-xs lg:text-sm font-bold uppercase text-slate-400';
const KPI_VALUE = 'text-lg sm:text-xl lg:text-2xl xl:text-3xl 2xl:text-[2rem] font-black tabular-nums leading-tight';
const SECTION_TITLE = 'text-xs sm:text-sm lg:text-base font-black uppercase tracking-wide text-slate-500';

const QUICK_FILTERS: { value: string; label: string }[] = [
  { value: 'LAST_7', label: '7d' },
  { value: 'LAST_30', label: '30d' },
  { value: 'THIS_MONTH', label: 'Month' },
  { value: 'LAST_90', label: '90d' },
  { value: 'ALL', label: 'All' },
];

type DashboardMainTab = 'overview' | 'charts';

function exportPeriodSalesCsv(sold: InventoryItem[], label: string) {
  const headers = ['Name', 'Category', 'Platform', 'eBayOrderId', 'SellDate', 'SellPrice', 'BuyPrice', 'Fees', 'Profit'];
  const rows = sold.map((i) => {
    const sell = Number(i.sellPrice) || 0;
    const buy = Number(i.buyPrice) || 0;
    const fee = Number(i.feeAmount) || 0;
    const profit = roundMoney(sell - buy - fee);
    return [i.name, i.category || '', formatItemSalePlatform(i), i.ebayOrderId || '', i.sellDate || '', sell, buy, fee, profit]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(';');
  });
  const csv = [headers.join(';'), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sales-${label.replace(/\s+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const WIDGET_LABELS: Record<WidgetId, string> = {
  gamification: 'Monthly goal & level',
  statCards: 'Stats (inventory, sales, profit, overhead, capital trap)',
  performanceChart: 'Performance analytics',
  capitalDistribution: 'Capital distribution (pie)',
  profitByCategory: 'Profit by category',
  profitByMonth: 'Profit by month',
  taxReport: 'Tax report',
  todoFromData: 'Data to review',
  tasks: 'Reseller tasks',
  recentActivity: 'Recent activity',
};

const Dashboard: React.FC<Props> = ({
  items,
  expenses = [],
  monthlyGoal,
  onGoalChange,
  businessSettings,
  categoryFields = {},
  dashboardPreferences,
  onDashboardPreferencesChange,
  onUpdateItems,
}) => {
  const navigate = useNavigate();
  const timeFilter = dashboardPreferences.timeFilter;
  const customStart = dashboardPreferences.customStart;
  const customEnd = dashboardPreferences.customEnd;
  const tasks = dashboardPreferences.tasks;

  const setTimeFilter = (v: string) =>
    onDashboardPreferencesChange({ ...dashboardPreferences, timeFilter: v });
  const setCustomStart = (v: string) =>
    onDashboardPreferencesChange({ ...dashboardPreferences, customStart: v });
  const setCustomEnd = (v: string) =>
    onDashboardPreferencesChange({ ...dashboardPreferences, customEnd: v });

  type FinancialDetailModal = {
    title: string;
    items: InventoryItem[];
    scopeExpenses: Expense[];
    revenue: number;
    itemProfit: number;
    expTotal: number;
    netProfit: number;
    footnote?: string;
    orderStats?: { orderCount: number; itemCount: number };
    orderGroups?: ReturnType<typeof groupItemsByMarketplaceOrder>;
  };
  const [financialDetailModal, setFinancialDetailModal] = useState<FinancialDetailModal | null>(null);

  const openFinancialDetail = (p: {
    title: string;
    items: InventoryItem[];
    scopeExpenses: Expense[];
    revenue?: number;
    itemProfit?: number;
    expTotal?: number;
    netProfit?: number;
    footnote?: string;
    orderStats?: { orderCount: number; itemCount: number };
    orderGroups?: ReturnType<typeof groupItemsByMarketplaceOrder>;
  }) => {
    const sold = p.items;
    const revenue = p.revenue ?? roundMoney(sold.reduce((acc, i) => acc + (Number(i.sellPrice) || 0), 0));
    const itemProfit = p.itemProfit ?? roundMoney(sold.reduce((acc, i) => acc + calculateItemProfit(i), 0));
    const expTotal = p.expTotal ?? roundMoney(p.scopeExpenses.reduce((acc, e) => acc + Number(e.amount), 0));
    const netProfit = p.netProfit ?? roundMoney(itemProfit - expTotal);
    setFinancialDetailModal({
      title: p.title,
      items: sold,
      scopeExpenses: p.scopeExpenses,
      revenue,
      itemProfit,
      expTotal,
      netProfit,
      footnote: p.footnote,
      orderStats: p.orderStats,
      orderGroups: p.orderGroups,
    });
  };

  const openDayDetail = (p: {
    dayLabel: string;
    dateStr: string;
    items: InventoryItem[];
    revenue?: number;
    itemProfit?: number;
    expTotal?: number;
    netProfit?: number;
  }) => {
    const dayExpenses =
      p.dateStr.length === 10 ? expenses.filter((e) => toLocalCalendarDateKey(e.date) === p.dateStr) : [];
    openFinancialDetail({
      title: `Day — ${p.dayLabel}`,
      items: p.items,
      scopeExpenses: dayExpenses,
      revenue: p.revenue,
      itemProfit: p.itemProfit,
      expTotal: p.expTotal,
      netProfit: p.netProfit,
    });
  };
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [ebayReminder, setEbayReminder] = useState<EbayReminderPending | null>(() => getActiveReminderForDisplay());

  useEffect(() => {
    const sync = () => setEbayReminder(getActiveReminderForDisplay());
    window.addEventListener('ebay-reminder-updated', sync);
    return () => window.removeEventListener('ebay-reminder-updated', sync);
  }, []);
  const [mainTab, setMainTab] = useState<DashboardMainTab>('overview');
  const [profitTab, setProfitTab] = useState<'month' | 'category'>('month');
  const [showMoreSections, setShowMoreSections] = useState(false);

  /** Enabled widgets only, in order (subset of DASHBOARD_WIDGET_IDS). */
  const visibleWidgets = useMemo((): WidgetId[] => {
    return dashboardPreferences.widgets.filter((id): id is WidgetId =>
      DASHBOARD_WIDGET_IDS.includes(id as WidgetId)
    );
  }, [dashboardPreferences.widgets]);

  const toggleWidget = (id: WidgetId) => {
    const next = visibleWidgets.includes(id)
      ? visibleWidgets.filter((w) => w !== id)
      : [...visibleWidgets, id];
    onDashboardPreferencesChange({ ...dashboardPreferences, widgets: next });
  };

  const moveWidget = (id: WidgetId, dir: 'up' | 'down') => {
    const idx = visibleWidgets.indexOf(id);
    if (idx < 0) return;
    const next = [...visibleWidgets];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onDashboardPreferencesChange({ ...dashboardPreferences, widgets: next });
  };

  const resetWidgets = () => {
    onDashboardPreferencesChange({ ...dashboardPreferences, widgets: [...DASHBOARD_WIDGET_IDS] });
  };

  const isVisible = (id: WidgetId) => visibleWidgets.includes(id);

  const showCommandCenter = isVisible('gamification') || isVisible('statCards');
  const hasChartWidgets =
    isVisible('performanceChart') ||
    isVisible('capitalDistribution') ||
    isVisible('profitByCategory') ||
    isVisible('profitByMonth');

  useEffect(() => {
    if (!visibleWidgets.includes('profitByMonth') && visibleWidgets.includes('profitByCategory')) {
      setProfitTab('category');
    }
  }, [visibleWidgets]);

  // Goal State managed via props now
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [tempGoal, setTempGoal] = useState(monthlyGoal.toString());

  const updateTasks = (next: DashboardTask[] | ((prev: DashboardTask[]) => DashboardTask[])) => {
    const resolved = typeof next === 'function' ? next(dashboardPreferences.tasks) : next;
    onDashboardPreferencesChange({ ...dashboardPreferences, tasks: resolved });
  };

  const [newTaskText, setNewTaskText] = useState('');

  const taxMode = businessSettings?.taxMode || 'SmallBusiness';

  const calculateItemProfit = (item: InventoryItem): number =>
    computeItemProfitBeforeOverhead(item, taxMode);

  // Sync tempGoal with props when not editing
  useEffect(() => {
    if (!isEditingGoal) {
      setTempGoal(monthlyGoal.toString());
    }
  }, [monthlyGoal, isEditingGoal]);

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    updateTasks((prev) => [{ id: Date.now().toString(), text: newTaskText, completed: false }, ...prev]);
    setNewTaskText('');
  };

  const toggleTask = (id: string) => {
    updateTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  const deleteTask = (id: string) => {
    updateTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSaveGoal = () => {
    const val = parseInt(tempGoal) || 1000;
    onGoalChange(val);
    setIsEditingGoal(false);
  };

  // ... (Date Logic remains same)
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    items.forEach(item => {
      if (item.sellDate) years.add(new Date(item.sellDate).getFullYear());
      if (item.buyDate) years.add(new Date(item.buyDate).getFullYear());
    });
    expenses.forEach(e => years.add(new Date(e.date).getFullYear()));
    return Array.from(years).sort((a: number, b: number) => Number(b) - Number(a));
  }, [items, expenses]);

  const { startDate, endDate } = useMemo((): { startDate: Date; endDate: Date } => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    let start = new Date(0); 

    if (timeFilter === 'ALL') {
       // Keep start at Epoch
    } else if (timeFilter === 'LAST_7') {
       start = new Date();
       start.setDate(end.getDate() - 6);
       start.setHours(0,0,0,0);
    } else if (timeFilter === 'LAST_30') {
       start = new Date();
       start.setDate(end.getDate() - 29);
       start.setHours(0,0,0,0);
    } else if (timeFilter === 'LAST_90') {
       start = new Date();
       start.setDate(end.getDate() - 89);
       start.setHours(0,0,0,0);
    } else if (timeFilter === 'THIS_MONTH') {
       start = new Date(end.getFullYear(), end.getMonth(), 1);
       start.setHours(0, 0, 0, 0);
    } else if (timeFilter === 'LAST_MONTH') {
       start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
       start.setHours(0, 0, 0, 0);
       const lastDay = new Date(end.getFullYear(), end.getMonth(), 0, 23, 59, 59, 999);
       return { startDate: start, endDate: lastDay };
    } else if (timeFilter === 'CUSTOM') {
       if (customStart) start = new Date(customStart);
       if (customEnd) {
          const e = new Date(customEnd);
          e.setHours(23, 59, 59, 999);
          return { startDate: start, endDate: e }; 
       }
    } else {
       const year = parseInt(timeFilter);
       if (!isNaN(year)) {
          start = new Date(year, 0, 1);
          const e = new Date(year, 11, 31, 23, 59, 59);
          return { startDate: start, endDate: e };
       }
    }
    return { startDate: start, endDate: end };
  }, [timeFilter, customStart, customEnd]);

  const filteredItems = useMemo(() => {
    const startKey = toLocalCalendarDateKey(startDate);
    const endKey = toLocalCalendarDateKey(endDate);
    return items.filter((item) => {
      const raw =
        isRealizedDisposal(item) ? item.sellDate : item.buyDate;
      if (!raw) return false;
      const k = toLocalCalendarDateKey(raw);
      if (!k) return false;
      return k >= startKey && k <= endKey;
    });
  }, [items, startDate, endDate]);

  const filteredExpenses = useMemo(() => {
    const startKey = toLocalCalendarDateKey(startDate);
    const endKey = toLocalCalendarDateKey(endDate);
    return expenses.filter((e) => {
      if (!e.date) return false;
      const k = toLocalCalendarDateKey(e.date);
      if (!k) return false;
      return k >= startKey && k <= endKey;
    });
  }, [expenses, startDate, endDate]);

  const soldInPeriod = useMemo(
    () =>
      filteredItems.filter(
        (i) =>
          isRealizedDisposal(i) &&
          !shouldSkipForAggregatedSaleLine(i, items)
      ),
    [filteredItems, items]
  );

  const periodLabel = useMemo(() => {
    if (timeFilter === 'CUSTOM' && customStart && customEnd) {
      return `${customStart} – ${customEnd}`;
    }
    const year = parseInt(timeFilter, 10);
    if (!Number.isNaN(year)) return String(year);
    return TIME_FILTER_LABELS[timeFilter] ?? timeFilter;
  }, [timeFilter, customStart, customEnd]);

  const stats = useMemo(() => {
    const soldForStats = soldInPeriod;
    const inStockForValue = filteredItems.filter(
      (i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items)
    );

    const totalTurnover = roundMoney(
      soldForStats.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0)
    );
    const grossProfit = roundMoney(
      soldForStats.reduce((acc: number, i) => acc + calculateItemProfit(i), 0)
    );

    const totalExpenses = roundMoney(filteredExpenses.reduce((acc: number, e) => acc + Number(e.amount), 0));
    const netProfit = roundMoney(grossProfit - totalExpenses);
    const inventoryValue = roundMoney(
      inStockForValue.reduce((acc: number, i) => acc + Number(i.buyPrice), 0)
    );

    const today = new Date();
    const globalInStock = items.filter(
      (i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items)
    );
    const deathPileItems = globalInStock.filter((i) => {
      const buyDate = new Date(i.buyDate);
      const diffTime = Math.abs(today.getTime() - buyDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 60;
    });
    const deathPileValue = roundMoney(
      deathPileItems.reduce((acc: number, i) => acc + Number(i.buyPrice), 0)
    );

    const totalInventoryValue = roundMoney(
      items
        .filter((i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items))
        .reduce((acc, i) => acc + Number(i.buyPrice || 0), 0)
    );
    return {
      totalTurnover,
      grossProfit,
      totalExpenses,
      netProfit,
      inventoryValue,
      totalInventoryValue,
      deathPileCount: deathPileItems.length,
      deathPileValue,
    };
  }, [soldInPeriod, filteredItems, filteredExpenses, items, taxMode]);

  const gameStats = useMemo(() => {
    const soldForRollup = items.filter(
      (i) =>
        isRealizedDisposal(i) &&
        !shouldSkipForAggregatedSaleLine(i, items)
    );
    const allTimeProfit = roundMoney(
      soldForRollup.reduce((acc: number, i) => acc + calculateItemProfit(i), 0) -
        expenses.reduce((acc: number, e) => acc + Number(e.amount || 0), 0)
    );

    const currentLevel = LEVELS.slice().reverse().find((l) => allTimeProfit >= l.min) || LEVELS[0];
    const nextLevel = LEVELS.find((l) => l.min > allTimeProfit);
    const progressToNext = nextLevel
      ? ((allTimeProfit - currentLevel.min) / (nextLevel.min - currentLevel.min)) * 100
      : 100;

    const thisYearMonth = currentLocalYearMonth();
    const currentMonthItems = soldForRollup.filter(
      (i) => !!i.sellDate && yearMonthKeyFromDate(i.sellDate) === thisYearMonth
    );
    const currentMonthExpenses = expenses.filter(
      (e) => !!e.date && yearMonthKeyFromDate(e.date) === thisYearMonth
    );
    const monthSaleProfit = roundMoney(
      currentMonthItems.reduce((acc: number, i) => acc + calculateItemProfit(i), 0)
    );
    const monthExpensesTotal = roundMoney(
      currentMonthExpenses.reduce((acc: number, e) => acc + Number(e.amount || 0), 0)
    );
    const monthProfit = roundMoney(monthSaleProfit - monthExpensesTotal);
    const monthRevenue = roundMoney(
      currentMonthItems.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0)
    );
    const goalProgress = Math.min((monthlyGoal > 0 ? (monthProfit / monthlyGoal) * 100 : 0), 100);

    return {
      allTimeProfit,
      currentLevel,
      nextLevel,
      progressToNext,
      monthProfit,
      monthSaleProfit,
      monthExpensesTotal,
      monthRevenue,
      monthSoldCount: currentMonthItems.length,
      allTimeSoldCount: soldForRollup.length,
      goalProgress,
    };
  }, [items, expenses, monthlyGoal, taxMode]);

  const chartData = useMemo(() => {
    // Explicitly convert Date objects to timestamps (number) to safely use in arithmetic
    const startMs: number = startDate.getTime();
    const endMs: number = endDate.getTime();
    
    // Calculate difference using numeric timestamps
    const diffTime: number = Math.abs(endMs - startMs);
    const diffDays: number = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const data: {
      name: string;
      revenue: number;
      itemProfit: number;
      expTotal: number;
      netProfit: number;
      timestamp: number;
      soldItems: InventoryItem[];
      dayLabel: string;
      dateStr: string;
    }[] = [];

    if (timeFilter === 'ALL' || diffDays > 366) {
       const years = new Set<number>();
       filteredItems.forEach(i => { if (i.sellDate) years.add(new Date(i.sellDate).getFullYear()); });
       filteredExpenses.forEach(e => years.add(new Date(e.date).getFullYear()));
       
       const sortedYears = Array.from(years).sort((a: number, b: number) => Number(a) - Number(b));
       
       sortedYears.forEach(year => {
          const sold = filteredItems.filter(
            (i) =>
              isRealizedDisposal(i) &&
              !shouldSkipForAggregatedSaleLine(i, items) &&
              i.sellDate &&
              new Date(i.sellDate).getFullYear() === year
          );
          const exps = filteredExpenses.filter(e => new Date(e.date).getFullYear() === year);
          const revenue = roundMoney(sold.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0));
          const itemProfit = roundMoney(sold.reduce((acc: number, i) => acc + calculateItemProfit(i), 0));
          const expTotal = roundMoney(exps.reduce((acc: number, e) => acc + Number(e.amount), 0));
          
          data.push({
            name: year.toString(),
            revenue,
            itemProfit,
            expTotal,
            netProfit: roundMoney(itemProfit - expTotal),
            timestamp: year,
            soldItems: sold,
            dayLabel: year.toString(),
            dateStr: year.toString(),
          });
       });
    } else {
       let curr: Date = new Date(startMs);
       
       while (curr.getTime() <= endMs) {
          const dayStr = toLocalCalendarDateKey(curr);
          const label = diffDays > 32 ? curr.toLocaleString('default', { month: 'short' }) : curr.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
          
          const sold = filteredItems.filter(
            (i) =>
              isRealizedDisposal(i) &&
              !shouldSkipForAggregatedSaleLine(i, items) &&
              !!i.sellDate &&
              toLocalCalendarDateKey(i.sellDate) === dayStr
          );
          const exps = filteredExpenses.filter((e) => toLocalCalendarDateKey(e.date) === dayStr);
          const revenue = roundMoney(sold.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0));
          const itemProfit = roundMoney(sold.reduce((acc: number, i) => acc + calculateItemProfit(i), 0));
          const expTotal = roundMoney(exps.reduce((acc: number, e) => acc + Number(e.amount), 0));

          const profitVal = roundMoney(itemProfit - expTotal);

          data.push({
            name: label,
            revenue,
            itemProfit,
            expTotal,
            netProfit: profitVal,
            timestamp: curr.getTime(),
            soldItems: sold,
            dayLabel: label,
            dateStr: dayStr,
          });
          
          const nextDay = new Date(curr);
          nextDay.setDate(curr.getDate() + 1);
          curr = nextDay;
       }
    }
    return data;
  }, [filteredItems, filteredExpenses, startDate, endDate, timeFilter, taxMode, items]);

  // NEW: Category Pie Chart Data
  const categoryData = useMemo(() => {
    const inStock = items.filter(
      (i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items)
    );
    const grouped = inStock.reduce((acc: Record<string, number>, item) => {
      const currentVal = Number(acc[item.category] || 0);
      const addVal = Number(item.buyPrice || 0);
      acc[item.category] = currentVal + addVal;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: roundMoney(Number(value)) }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  type ProfitRollupRow = {
    name: string;
    revenue?: number;
    saleProfit: number;
    expenses: number;
    netProfit: number;
    items: InventoryItem[];
    scopeExpenses: Expense[];
  };

  // Profit by category — sale margin per category (expenses are period-wide; see month / P&L strip for net)
  const profitByCategory = useMemo((): ProfitRollupRow[] => {
    const byCat: Record<string, { items: InventoryItem[]; saleProfit: number }> = {};
    soldInPeriod.forEach((i) => {
      const cat = i.category || 'Other';
      if (!byCat[cat]) byCat[cat] = { items: [], saleProfit: 0 };
      byCat[cat].items.push(i);
      byCat[cat].saleProfit += calculateItemProfit(i);
    });
    return Object.entries(byCat)
      .map(([name, g]) => {
        const saleProfit = roundMoney(g.saleProfit);
        return {
          name,
          saleProfit,
          expenses: 0,
          netProfit: saleProfit,
          items: g.items,
          scopeExpenses: [] as Expense[],
        };
      })
      .sort((a, b) => b.saleProfit - a.saleProfit);
  }, [soldInPeriod, taxMode]);

  // Profit by month — sale profit minus expenses dated that month
  const profitByMonth = useMemo((): ProfitRollupRow[] => {
    const byMonth: Record<string, { items: InventoryItem[]; saleProfit: number; revenue: number }> = {};
    soldInPeriod.forEach((i) => {
      if (!i.sellDate) return;
      const key = yearMonthKeyFromDate(i.sellDate);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { items: [], saleProfit: 0, revenue: 0 };
      byMonth[key].items.push(i);
      byMonth[key].saleProfit += calculateItemProfit(i);
      byMonth[key].revenue += Number(i.sellPrice) || 0;
    });
    filteredExpenses.forEach((e) => {
      const key = yearMonthKeyFromDate(e.date);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { items: [], saleProfit: 0, revenue: 0 };
    });
    return Object.entries(byMonth)
      .map(([name, g]) => {
        const saleProfit = roundMoney(g.saleProfit);
        const revenue = roundMoney(g.revenue);
        const scopeExpenses = filteredExpenses.filter((e) => yearMonthKeyFromDate(e.date) === name);
        const expenses = roundMoney(scopeExpenses.reduce((acc, e) => acc + Number(e.amount), 0));
        return {
          name,
          revenue,
          saleProfit,
          expenses,
          netProfit: roundMoney(saleProfit - expenses),
          items: g.items,
          scopeExpenses,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [soldInPeriod, filteredExpenses, taxMode]);

  const periodInsights = useMemo(() => {
    const count = soldInPeriod.length;
    const avgProfitPerSale = count > 0 ? roundMoney(stats.grossProfit / count) : 0;
    let bestSale: InventoryItem | null = null;
    let bestSaleProfit = 0;
    soldInPeriod.forEach((i) => {
      const p = calculateItemProfit(i);
      if (p > bestSaleProfit) {
        bestSaleProfit = p;
        bestSale = i;
      }
    });
    const inStockCount = items.filter(
      (i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items)
    ).length;
    return {
      soldCount: count,
      avgProfitPerSale,
      bestSale,
      bestSaleProfit: roundMoney(bestSaleProfit),
      inStockCount,
      platformSales: countSalesByPlatform(soldInPeriod),
      salesByPlatform: groupSalesByPlatform(soldInPeriod),
      platformRevenue: sumRevenueByPlatform(soldInPeriod),
      platformOrders: countOrdersByPlatform(soldInPeriod),
      missingPlatformCount: countMissingExplicitSalePlatform(soldInPeriod),
    };
  }, [soldInPeriod, stats.grossProfit, items, taxMode]);

  const formatPlatformChipLabel = (key: PlatformGroupKey) => {
    const stats = periodInsights.platformOrders[key];
    const rev = periodInsights.platformRevenue[key];
    if (stats.orderCount !== stats.itemCount && stats.itemCount > 0) {
      return `${stats.orderCount} orders · ${stats.itemCount} items · €${formatEUR(rev)}`;
    }
    return `${stats.itemCount} · €${formatEUR(rev)}`;
  };

  const openPlatformSales = (key: PlatformGroupKey) => {
    const platformItems = periodInsights.salesByPlatform[key];
    const rev = periodInsights.platformRevenue[key];
    const orderStats = periodInsights.platformOrders[key];
    const orderGroups =
      orderStats.orderCount !== orderStats.itemCount
        ? groupItemsByMarketplaceOrder(platformItems, items)
        : undefined;
    openFinancialDetail({
      title: `${PLATFORM_GROUP_LABEL[key]} — ${periodLabel}`,
      items: platformItems,
      scopeExpenses: [],
      revenue: rev,
      orderStats,
      orderGroups,
      footnote:
        key === 'unknown'
          ? 'No platform selected — set Sold on in Inventory → Sold tab. Items may still infer eBay from order ID until you confirm; use “Fix eBay tags” if needed.'
          : key === 'ebay' && orderStats.orderCount !== orderStats.itemCount
            ? `${orderStats.orderCount} eBay orders split across ${orderStats.itemCount} inventory items (e.g. bundle parts). Compare order count to eBay “Stückzahl verkauft”; revenue is the sum of all parts.`
            : key === 'ebay'
              ? 'Compare order count to eBay “Stückzahl verkauft”. Revenue = sum of sell prices on each inventory row.'
              : key === 'inPerson'
                ? 'Local pickup / in-person sales — not counted on eBay or Kleinanzeigen.'
                : undefined,
    });
  };

  const platformReconciliation = useMemo(
    () => buildPlatformReconciliation(soldInPeriod),
    [soldInPeriod]
  );

  const ebayMonthlyReconciliation = useMemo(() => {
    const ebayItems = periodInsights.salesByPlatform.ebay || [];
    const orderStats = periodInsights.platformOrders.ebay;
    const orderGroups = groupItemsByMarketplaceOrder(ebayItems, items);
    const bundleSplits = orderGroups.filter((g) => g.items.length > 1);
    return {
      ebayItems,
      orderStats,
      orderGroups,
      bundleSplits,
      revenue: periodInsights.platformRevenue.ebay,
    };
  }, [periodInsights, items]);

  const handleFixEbayTags = () => {
    if (!onUpdateItems) return;
    const updates = buildEbayTagFixUpdates(soldInPeriod);
    if (updates.length === 0) return;
    onUpdateItems(updates);
  };

  const monthOverMonth = useMemo(() => {
    if (timeFilter !== 'THIS_MONTH') return null;
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const soldPrev = items.filter(
      (i) =>
        isRealizedDisposal(i) &&
        !shouldSkipForAggregatedSaleLine(i, items) &&
        i.sellDate &&
        yearMonthKeyFromDate(i.sellDate) === prevKey
    );
    const salePrev = roundMoney(soldPrev.reduce((acc, i) => acc + calculateItemProfit(i), 0));
    const expPrev = roundMoney(
      expenses
        .filter((e) => yearMonthKeyFromDate(e.date) === prevKey)
        .reduce((acc, e) => acc + Number(e.amount), 0)
    );
    const netPrev = roundMoney(salePrev - expPrev);
    const delta = roundMoney(stats.netProfit - netPrev);
    return { netPrev, delta };
  }, [timeFilter, stats.netProfit, items, expenses, taxMode]);

  // Tax report summary (by year)
  const [taxReportYear, setTaxReportYear] = useState(() => new Date().getFullYear());
  const taxSummary = useMemo(() => calculateTaxSummary(items, expenses, taxReportYear, taxMode), [items, expenses, taxReportYear, taxMode]);
  const taxYears = useMemo(() => {
    const years = new Set<number>();
    items.forEach(i => { if (i.buyDate) years.add(new Date(i.buyDate).getFullYear()); if (i.sellDate) years.add(new Date(i.sellDate).getFullYear()); });
    expenses.forEach(e => years.add(new Date(e.date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [items, expenses]);

  // Todo from data: items needing attention
  const todoFromData = useMemo(() => {
    const inStock = items.filter(i => i.status === ItemStatus.IN_STOCK);
    const noImage = inStock.filter(i => !i.imageUrl || (typeof i.imageUrl === 'string' && !i.imageUrl.trim()));
    const hiddenFromStore = inStock.filter(i => i.storeVisible === false);
    return [
      { id: 'no-image', label: 'Items without image', count: noImage.length, href: '/panel/inventory' },
      { id: 'hidden-store', label: 'Items hidden from store', count: hiddenFromStore.length, href: '/panel/store-management' },
    ].filter(t => t.count > 0);
  }, [items]);

  // Recent Activity Data
  const activityFeed = useMemo(() => {
    const actions: { type: string; date: string; item: string; amount: number; itemId?: string }[] = [];
    items.forEach((i) => {
      if (i.buyDate && !shouldSkipContainerForPurchaseCogs(i, items)) {
        actions.push({ type: 'BOUGHT', date: i.buyDate, item: i.name, amount: -Number(i.buyPrice), itemId: i.id });
      }
      if (
        i.sellDate &&
        isRealizedDisposal(i) &&
        !shouldSkipForAggregatedSaleLine(i, items)
      ) {
        const type =
          i.status === ItemStatus.GIFTED
            ? 'GIFTED'
            : i.status === ItemStatus.TRADED
              ? 'TRADED'
              : 'SOLD';
        actions.push({ type, date: i.sellDate, item: i.name, amount: Number(i.sellPrice || 0), itemId: i.id });
      }
    });
    expenses.forEach(e => {
      actions.push({ type: 'EXPENSE', date: e.date, item: e.description, amount: -Number(e.amount) });
    });
    
    return actions.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      return timeB - timeA;
    }).slice(0, 5);
  }, [items, expenses]);

  if (items.length === 0 && expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
        <div className="w-24 h-24 bg-white rounded-3xl shadow-xl border border-slate-100 flex items-center justify-center animate-bounce">
          <Package size={48} className="text-blue-500" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-slate-800">Inventory is Empty</h2>
          <p className="text-slate-500 max-w-sm mt-2">Add your first item or import sales history from CSV to start analysis.</p>
        </div>
        <div className="flex gap-4">
          <button type="button" onClick={() => navigate('/panel/add')} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all">Add Item</button>
          <button type="button" onClick={() => navigate('/panel/import')} className="bg-white text-slate-700 border px-8 py-3 rounded-2xl font-bold hover:bg-slate-50 transition-all">Import Data</button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full min-h-0 w-full overflow-y-auto space-y-3 sm:space-y-4 lg:space-y-6 xl:space-y-7 animate-in fade-in pb-8 lg:pb-10 xl:px-1">
      {ebayReminder && (
        <EbaySoldReminderWidget
          reminder={ebayReminder}
          onDismiss={() => {
            dismissPendingReminder();
            setEbayReminder(null);
          }}
          variant="banner"
        />
      )}
      {/* Header + period filters */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-black text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-xs sm:text-sm lg:text-base text-slate-500 truncate mt-0.5">
            {items.length} items · {expenses.length} expenses · {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <div className="flex rounded-lg lg:rounded-xl border border-slate-200 bg-white p-0.5 lg:p-1">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setTimeFilter(f.value)}
                className={`px-2.5 py-1.5 lg:px-4 lg:py-2 text-xs lg:text-sm font-bold rounded-md lg:rounded-lg transition-colors min-h-[36px] lg:min-h-[44px] ${
                  timeFilter === f.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex items-center rounded-lg lg:rounded-xl border border-slate-200 bg-white">
            <CalendarDays size={14} className="lg:w-[18px] lg:h-[18px] absolute left-2 lg:left-3 text-slate-400 pointer-events-none" />
            <select
              className="bg-transparent border-none outline-none text-xs lg:text-sm font-bold text-slate-700 pl-7 lg:pl-9 pr-6 lg:pr-8 py-2 lg:py-2.5 cursor-pointer appearance-none min-w-[100px] lg:min-w-[130px]"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
            >
              <option value="THIS_MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
              <option value="CUSTOM">Custom</option>
            </select>
          </div>
          {timeFilter === 'CUSTOM' && (
            <div className="flex items-center gap-1 lg:gap-2">
              <input type="date" className="rounded-lg border border-slate-200 px-2 lg:px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-bold" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <ArrowRight size={12} className="text-slate-300 lg:w-4 lg:h-4" />
              <input type="date" className="rounded-lg border border-slate-200 px-2 lg:px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-bold" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowWidgetModal(true)}
            className="p-2 lg:p-2.5 rounded-lg lg:rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 min-h-[36px] min-w-[36px] lg:min-h-[44px] lg:min-w-[44px] flex items-center justify-center"
            aria-label="Customise widgets"
          >
            <Settings2 size={16} className="lg:w-5 lg:h-5" />
          </button>
        </div>
      </header>

      {/* Overview vs charts */}
      <div className="flex rounded-xl lg:rounded-2xl border border-slate-200 bg-white p-1 lg:p-1.5 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setMainTab('overview')}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 lg:px-6 py-2.5 lg:py-3 rounded-lg lg:rounded-xl text-xs lg:text-sm font-black uppercase tracking-wide transition-all min-h-[44px] ${
            mainTab === 'overview' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <LayoutDashboard size={16} className="lg:w-[18px] lg:h-[18px] shrink-0" />
          Overview
        </button>
        <button
          type="button"
          onClick={() => setMainTab('charts')}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 lg:px-6 py-2.5 lg:py-3 rounded-lg lg:rounded-xl text-xs lg:text-sm font-black uppercase tracking-wide transition-all min-h-[44px] ${
            mainTab === 'charts' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <BarChart3 size={16} className="lg:w-[18px] lg:h-[18px] shrink-0" />
          Charts
        </button>
      </div>

      {mainTab === 'overview' && (
      <>
      {/* Command center — period P&L + performance + insights */}
      {showCommandCenter && (
      <div className={`${DASH_CARD} overflow-hidden`}>
        <button
          type="button"
          onClick={() =>
            openFinancialDetail({
              title: `Period — ${periodLabel}`,
              items: soldInPeriod,
              scopeExpenses: filteredExpenses,
              revenue: stats.totalTurnover,
              itemProfit: stats.grossProfit,
              expTotal: stats.totalExpenses,
              netProfit: stats.netProfit,
            })
          }
          className="w-full grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100 hover:bg-slate-50/50 transition-colors text-left"
        >
          {[
            { label: 'Revenue', value: `€${formatEUR(stats.totalTurnover)}`, tone: 'text-slate-900' },
            { label: 'Sale profit', value: `€${formatEUR(stats.grossProfit)}`, tone: 'text-blue-700' },
            { label: 'Expenses', value: `−€${formatEUR(stats.totalExpenses)}`, tone: 'text-red-600' },
            { label: 'Net profit', value: `€${formatEUR(stats.netProfit)}`, tone: stats.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600' },
          ].map((k) => (
            <div key={k.label} className="bg-white px-3 py-3 sm:px-4 sm:py-3.5 lg:px-6 lg:py-5 flex flex-col justify-center min-h-[4.5rem] lg:min-h-[5.5rem]">
              <p className={`${KPI_LABEL} mb-1 lg:mb-1.5`}>{k.label}</p>
              <p className={`${KPI_VALUE} ${k.tone} leading-tight`}>{k.value}</p>
            </div>
          ))}
        </button>

        {monthOverMonth && (
          <div className="px-3 lg:px-6 py-2 lg:py-3 bg-blue-50/80 border-b border-blue-100 flex items-center gap-2 text-xs lg:text-sm">
            <Sparkles size={13} className="lg:w-4 lg:h-4 text-blue-600 shrink-0" />
            <span className="text-slate-600">
              vs last month:{' '}
              <span className={`font-black ${monthOverMonth.delta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {monthOverMonth.delta >= 0 ? '+' : ''}€{formatEUR(monthOverMonth.delta)}
              </span>
              <span className="text-slate-400 ml-1">(last: €{formatEUR(monthOverMonth.netPrev)})</span>
            </span>
          </div>
        )}

        {isVisible('gamification') && (
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-3 py-4 sm:px-4 lg:px-6 lg:py-5 min-w-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 min-h-[1.25rem] lg:min-h-[1.5rem] mb-2">
              <span className={`${KPI_LABEL} flex items-center gap-1.5`}>
                <Target size={11} className="lg:w-4 lg:h-4 text-blue-600 shrink-0" /> Goal
              </span>
              <button type="button" onClick={() => setIsEditingGoal(true)} className="p-1 lg:p-1.5 text-slate-400 hover:text-slate-700 shrink-0" aria-label="Edit goal">
                <Edit3 size={11} className="lg:w-4 lg:h-4" />
              </button>
            </div>
            <div className="min-h-[2rem] lg:min-h-[2.75rem] flex items-center">
              {isEditingGoal ? (
                <div className="flex items-center gap-2 w-full">
                  <input autoFocus type="number" className="w-full border-b-2 border-blue-500 text-base lg:text-xl font-black outline-none min-h-[36px] lg:min-h-[44px]" value={tempGoal} onChange={(e) => setTempGoal(e.target.value)} onBlur={handleSaveGoal} onKeyDown={(e) => e.key === 'Enter' && handleSaveGoal()} />
                  <button type="button" onClick={handleSaveGoal} className="p-1.5 lg:p-2 bg-blue-600 text-white rounded-lg shrink-0"><Check size={14} className="lg:w-5 lg:h-5" /></button>
                </div>
              ) : (
                <p className="text-base sm:text-lg lg:text-xl xl:text-2xl font-black tabular-nums truncate w-full">
                  €{formatEUR(gameStats.monthProfit)}<span className="text-slate-400 font-bold text-sm lg:text-base"> / €{formatEUR(monthlyGoal)}</span>
                </p>
              )}
            </div>
            <div className="h-2 lg:h-2.5 bg-slate-100 rounded-full mt-3 overflow-hidden shrink-0">
              <div className={`h-full rounded-full ${gameStats.goalProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${gameStats.goalProgress}%` }} />
            </div>
          </div>
          <div className="px-3 py-4 sm:px-4 lg:px-6 lg:py-5 min-w-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 min-h-[1.25rem] lg:min-h-[1.5rem] mb-2">
              <span className={KPI_LABEL}>Rank</span>
              <span className="w-7 lg:w-8 shrink-0" aria-hidden="true" />
            </div>
            <div className="min-h-[2rem] lg:min-h-[2.75rem] flex items-center">
              <p className="text-base sm:text-lg lg:text-xl font-black truncate flex items-center gap-2 w-full">
                <span className={`inline-flex p-1 lg:p-1.5 rounded-lg shrink-0 ${gameStats.currentLevel.bg}`}>{React.cloneElement(gameStats.currentLevel.icon as React.ReactElement<any>, { size: 16 })}</span>
                <span className="truncate">{gameStats.currentLevel.name}</span>
              </p>
            </div>
            <div className="h-2 lg:h-2.5 bg-slate-100 rounded-full mt-3 overflow-hidden shrink-0">
              <div className="h-full bg-slate-700 rounded-full" style={{ width: `${gameStats.progressToNext}%` }} />
            </div>
          </div>
          <div className="px-3 py-4 sm:px-4 lg:px-6 lg:py-5 min-w-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 min-h-[1.25rem] lg:min-h-[1.5rem] mb-2">
              <span className={KPI_LABEL}>Lifetime</span>
              <span className="w-7 lg:w-8 shrink-0" aria-hidden="true" />
            </div>
            <div className="min-h-[2rem] lg:min-h-[2.75rem] flex items-center">
              <p className={`text-base sm:text-lg lg:text-xl xl:text-2xl font-black tabular-nums truncate w-full ${gameStats.allTimeProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                €{formatEUR(gameStats.allTimeProfit)}
              </p>
            </div>
            <p className="mt-3 text-xs lg:text-sm text-slate-400 shrink-0 min-h-[0.625rem] lg:min-h-[0.75rem]">{gameStats.allTimeSoldCount} sold all time</p>
          </div>
        </div>
        )}

        {isVisible('statCards') && (
        <div className="px-3 lg:px-6 py-3 lg:py-4 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
            <button
              type="button"
              onClick={() =>
                openFinancialDetail({
                  title: `All sales — ${periodLabel}`,
                  items: soldInPeriod,
                  scopeExpenses: filteredExpenses,
                  revenue: stats.totalTurnover,
                  itemProfit: stats.grossProfit,
                  expTotal: stats.totalExpenses,
                  netProfit: stats.netProfit,
                })
              }
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 lg:px-4 lg:py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left shrink-0"
            >
              <span className={KPI_LABEL}>Total sales</span>
              <span className="text-lg lg:text-xl font-black text-slate-900 tabular-nums">{periodInsights.soldCount}</span>
              <span className="text-xs lg:text-sm text-slate-500 tabular-nums">Rev €{formatEUR(stats.totalTurnover)}</span>
            </button>
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              {(
                [
                  { key: 'ebay' as PlatformGroupKey, className: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
                  { key: 'kleinanzeigen' as PlatformGroupKey, className: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200' },
                  { key: 'inPerson' as PlatformGroupKey, className: 'bg-violet-50 text-violet-800 hover:bg-violet-100 border-violet-200' },
                  { key: 'amazon' as PlatformGroupKey, className: 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200' },
                  { key: 'other' as PlatformGroupKey, className: 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200' },
                  { key: 'unknown' as PlatformGroupKey, className: 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-300' },
                ] as const
              )
                .filter(({ key }) =>
                  key === 'ebay' ||
                  key === 'kleinanzeigen' ||
                  key === 'inPerson' ||
                  periodInsights.platformSales[key] > 0 ||
                  (key === 'unknown' && periodInsights.missingPlatformCount > 0)
                )
                .map(({ key, className }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => openPlatformSales(key)}
                    disabled={periodInsights.platformSales[key] === 0}
                    className={`inline-flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 px-3 py-2 lg:px-4 lg:py-2.5 rounded-xl border text-xs lg:text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
                  >
                    <span>{PLATFORM_GROUP_LABEL[key]}{key === 'unknown' && periodInsights.missingPlatformCount > 0 ? ' ⚠' : ''}</span>
                    <span className="font-black tabular-nums whitespace-nowrap">
                      {formatPlatformChipLabel(key)}
                    </span>
                    <ChevronRight size={14} className="opacity-50 shrink-0 hidden sm:block" />
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={() => exportPeriodSalesCsv(soldInPeriod, periodLabel)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 lg:px-4 lg:py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 text-xs lg:text-sm shrink-0 self-start lg:self-center"
            >
              <Download size={14} className="lg:w-4 lg:h-4" /> CSV
            </button>
          </div>
          {(platformReconciliation.needingTagRevenue > 0 ||
            platformReconciliation.misclassifiedEbay.length > 0 ||
            platformReconciliation.zeroSellPrice.length > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 lg:px-4 lg:py-3 text-xs sm:text-sm text-amber-950 space-y-2">
              <p className="font-bold">Why eBay totals may differ from Seller Hub</p>
              <ul className="list-disc list-inside space-y-1 text-amber-900/90">
                <li>
                  App eBay revenue: <strong>€{formatEUR(periodInsights.platformRevenue.ebay)}</strong> ({periodInsights.platformSales.ebay} sales) — sum of{' '}
                  <strong>sell prices</strong> tagged or detected as eBay for {periodLabel}.
                </li>
                {platformReconciliation.needingTagRevenue > 0 && (
                  <li>
                    <strong>{periodInsights.missingPlatformCount}</strong> sold item{periodInsights.missingPlatformCount === 1 ? '' : 's'} with{' '}
                    <strong>no platform selected</strong> (€{formatEUR(platformReconciliation.needingTagRevenue)} revenue).
                    <button
                      type="button"
                      onClick={() => openPlatformSales('unknown')}
                      className="ml-1 font-bold underline hover:no-underline"
                    >
                      Review
                    </button>
                    {' · '}
                    Fix in Inventory → Sold tab (Sold on column).
                  </li>
                )}
                {platformReconciliation.misclassifiedEbay.length > 0 && (
                  <li>
                    <strong>{platformReconciliation.misclassifiedEbay.length}</strong> sales have eBay order/username but are not tagged as eBay (
                    €{formatEUR(platformReconciliation.misclassifiedEbayRevenue)}).
                    {onUpdateItems && (
                      <button type="button" onClick={handleFixEbayTags} className="ml-1 font-bold underline hover:no-underline">
                        Fix eBay tags
                      </button>
                    )}
                  </li>
                )}
                {platformReconciliation.zeroSellPrice.length > 0 && (
                  <li>
                    <strong>{platformReconciliation.zeroSellPrice.length}</strong> sold items have sell price €0 — they add no revenue until you enter the price.
                  </li>
                )}
              </ul>
              <p className="text-[11px] sm:text-xs text-amber-800/80">
                eBay Seller Hub gross sales can also include buyer shipping and orders not yet in inventory. Use the same year filter (e.g. 2026) on both sides.
              </p>
            </div>
          )}
          {ebayMonthlyReconciliation.orderStats.itemCount > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 lg:px-4 lg:py-3 text-xs sm:text-sm text-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">Monthly eBay ↔ inventory reconciliation ({periodLabel})</p>
                <button
                  type="button"
                  onClick={() => openPlatformSales('ebay')}
                  className="text-[10px] font-black uppercase tracking-widest text-blue-700 hover:underline"
                >
                  Open all eBay sales
                </button>
              </div>
              <ul className="space-y-1 text-slate-700">
                <li>
                  <strong>{ebayMonthlyReconciliation.orderStats.orderCount}</strong> eBay order
                  {ebayMonthlyReconciliation.orderStats.orderCount === 1 ? '' : 's'} in app →{' '}
                  <strong>{ebayMonthlyReconciliation.orderStats.itemCount}</strong> inventory row
                  {ebayMonthlyReconciliation.orderStats.itemCount === 1 ? '' : 's'} · revenue{' '}
                  <strong>€{formatEUR(ebayMonthlyReconciliation.revenue)}</strong>
                </li>
                {ebayMonthlyReconciliation.orderStats.orderCount !== ebayMonthlyReconciliation.orderStats.itemCount && (
                  <li className="text-slate-600">
                    {ebayMonthlyReconciliation.bundleSplits.length} order
                    {ebayMonthlyReconciliation.bundleSplits.length === 1 ? '' : 's'} split into multiple parts (bundle rows) — normal if one eBay sale = several components.
                  </li>
                )}
                {ebayMonthlyReconciliation.bundleSplits.slice(0, 5).map((g) => (
                  <li key={g.key} className="text-[11px] text-slate-500 pl-3">
                    {g.label} — €{formatEUR(g.revenue)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-500">
                Compare <strong>{ebayMonthlyReconciliation.orderStats.orderCount}</strong> to eBay Seller Hub “Stückzahl” for the same period. Revenue here is net sell prices stored per item (after fees if you used screenshot parse).
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm lg:text-base text-slate-500 border-t border-slate-100 pt-3">
            <span>Avg <strong className="text-slate-800">€{formatEUR(periodInsights.avgProfitPerSale)}</strong>/sale</span>
            <span className="text-slate-300 hidden sm:inline">·</span>
            <span><strong className="text-slate-800">{periodInsights.inStockCount}</strong> in stock</span>
            <span className="text-slate-300 hidden sm:inline">·</span>
            <span className={stats.deathPileCount > 0 ? 'text-amber-700' : undefined}>
              <strong>{stats.deathPileCount}</strong> stale &gt;60d (€{formatEUR(stats.deathPileValue)})
            </span>
            {periodInsights.bestSale && (
              <>
                <span className="text-slate-300 hidden sm:inline">·</span>
                <ItemLink
                  item={periodInsights.bestSale}
                  itemName={periodInsights.bestSale.name}
                  className="text-emerald-800 font-bold hover:text-emerald-900 hover:underline truncate max-w-[120px] sm:max-w-[220px]"
                />
                <button
                  type="button"
                  onClick={() =>
                    openFinancialDetail({
                      title: `Best sale — ${periodInsights.bestSale!.name}`,
                      items: [periodInsights.bestSale!],
                      scopeExpenses: [],
                      itemProfit: periodInsights.bestSaleProfit,
                      netProfit: periodInsights.bestSaleProfit,
                    })
                  }
                  className="text-emerald-700 font-bold hover:underline tabular-nums shrink-0"
                >
                  +€{formatEUR(periodInsights.bestSaleProfit)}
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </div>
      )}

      {isVisible('todoFromData') && todoFromData.length > 0 && (
         <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 lg:py-3 rounded-xl lg:rounded-2xl bg-amber-50 border border-amber-200 text-xs sm:text-sm lg:text-base">
            <AlertCircle size={14} className="lg:w-5 lg:h-5 text-amber-600 shrink-0" />
            {todoFromData.map((t) => (
               <a key={t.id} href={t.href} className="inline-flex items-center gap-1 font-bold text-amber-800 hover:underline">
                  {t.label} <span className="bg-amber-200 px-1.5 rounded">{t.count}</span>
               </a>
            ))}
         </div>
      )}

      {(isVisible('taxReport') || isVisible('tasks') || isVisible('recentActivity')) && (
      <div className={DASH_CARD}>
        <button
          type="button"
          onClick={() => setShowMoreSections((v) => !v)}
          className="w-full flex items-center justify-between px-4 lg:px-6 py-3 lg:py-4 text-sm lg:text-base font-bold text-slate-700 hover:bg-slate-50"
        >
          <span>Tax export, tasks & activity</span>
          <ChevronDown size={18} className={`lg:w-5 lg:h-5 text-slate-400 transition-transform ${showMoreSections ? 'rotate-180' : ''}`} />
        </button>
        {showMoreSections && (
        <div className="border-t border-slate-100 p-4 lg:p-6 space-y-4 lg:space-y-6">
      {isVisible('taxReport') && (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className={`${SECTION_TITLE} flex-1`}>Finanzamt / EÜR</h3>
          <select value={taxReportYear} onChange={(e) => setTaxReportYear(Number(e.target.value))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">
            {taxYears.length ? taxYears.map(y => <option key={y} value={y}>{y}</option>) : <option value={taxReportYear}>{taxReportYear}</option>}
          </select>
          <button type="button" onClick={() => { const csv = generateTaxReportCSV(items, expenses, taxReportYear); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tax-report-${taxReportYear}.csv`; a.click(); URL.revokeObjectURL(a.href); }} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold">
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto text-sm lg:text-base">
          <table className="w-full">
            <thead>
              <tr className="text-slate-500 font-bold uppercase">
                <th className="py-2 pr-3 text-left">Revenue</th>
                <th className="py-2 pr-3 text-left">COGS</th>
                <th className="py-2 pr-3 text-left">Exp</th>
                <th className="py-2 pr-3 text-left">Fees</th>
                <th className="py-2 text-left">Net</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold tabular-nums">
                <td className="py-2">€{formatEUR(taxSummary.revenue)}</td>
                <td className="py-2 text-slate-600">€{formatEUR(taxSummary.cogs)}</td>
                <td className="py-2 text-slate-600">€{formatEUR(taxSummary.expenses)}</td>
                <td className="py-2 text-slate-600">€{formatEUR(taxSummary.fees)}</td>
                <td className="py-2 text-emerald-600">€{formatEUR(taxSummary.netProfit)}</td>
              </tr>
              {(taxSummary.revenueFromGifts > 0 || taxSummary.revenueFromTrades > 0) && (
                <tr className="text-[11px] text-slate-500">
                  <td colSpan={5} className="pt-1 pb-2">
                    Revenue breakdown: sales €{formatEUR(taxSummary.revenueFromSales)}
                    {taxSummary.revenueFromTrades > 0 && ` · trades €${formatEUR(taxSummary.revenueFromTrades)}`}
                    {taxSummary.revenueFromGifts > 0 && ` · gifts (Privatentnahme) €${formatEUR(taxSummary.revenueFromGifts)} (${taxSummary.giftCount ?? 0})`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {(isVisible('tasks') || isVisible('recentActivity')) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
         {isVisible('tasks') && (
         <div>
            <h3 className={`${SECTION_TITLE} mb-3 flex items-center gap-2`}><CheckCircle2 size={16}/> Tasks</h3>
            <form onSubmit={handleAddTask} className="flex gap-2 mb-3">
               <input className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm lg:text-base font-bold outline-none min-h-[44px]" placeholder="Add task…" value={newTaskText} onChange={e => setNewTaskText(e.target.value)} />
               <button type="submit" className="bg-blue-600 text-white p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"><Plus size={18}/></button>
            </form>
            <div className="space-y-2 max-h-[160px] lg:max-h-[220px] overflow-y-auto">
               {tasks.map(task => (
                  <div key={task.id} className="group flex items-center gap-2 py-1.5 px-1 hover:bg-slate-50 rounded-lg cursor-pointer text-sm lg:text-base" onClick={() => toggleTask(task.id)}>
                     <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${task.completed ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                        {task.completed && <Check size={10} className="text-white"/>}
                     </div>
                     <span className={`flex-1 truncate ${task.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{task.text}</span>
                     <button type="button" onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={14}/></button>
                  </div>
               ))}
            </div>
         </div>
         )}
         {isVisible('recentActivity') && (
         <div>
            <h3 className={`${SECTION_TITLE} mb-3 flex items-center gap-2`}><Activity size={16}/> Recent</h3>
            <div className="space-y-2 max-h-[160px] lg:max-h-[220px] overflow-y-auto">
               {activityFeed.map((action, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm lg:text-base">
                     <div className={`w-9 h-9 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center shrink-0 ${
                       action.type === 'SOLD' ? 'bg-emerald-100 text-emerald-600'
                       : action.type === 'GIFTED' ? 'bg-rose-100 text-rose-600'
                       : action.type === 'TRADED' ? 'bg-indigo-100 text-indigo-600'
                       : action.type === 'BOUGHT' ? 'bg-blue-100 text-blue-600'
                       : 'bg-red-50 text-red-500'
                     }`}>
                        {action.type === 'SOLD' ? <TrendingUp size={16}/> : action.type === 'GIFTED' ? <Gift size={16}/> : action.type === 'TRADED' ? <ArrowRightLeft size={16}/> : action.type === 'BOUGHT' ? <Package size={16}/> : <TrendingDown size={16}/>}
                     </div>
                     <div className="flex-1 min-w-0">
                        {action.itemId ? (
                          <ItemLink
                            itemId={action.itemId}
                            itemName={action.item}
                            items={items}
                            className="font-bold text-slate-900 hover:text-indigo-600 hover:underline truncate block"
                          />
                        ) : (
                          <p className="font-bold text-slate-900 truncate">{action.item}</p>
                        )}
                        <p className="text-xs lg:text-sm text-slate-400">{new Date(action.date).toLocaleDateString()}</p>
                     </div>
                     <span className={`font-black tabular-nums shrink-0 ${action.amount > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                        {action.amount > 0 ? '+' : ''}€{formatEUR(Math.abs(action.amount))}
                     </span>
                  </div>
               ))}
            </div>
         </div>
         )}
      </div>
      )}
        </div>
        )}
      </div>
      )}
      </>
      )}

      {mainTab === 'charts' && (
      <>
      {/* Charts + breakdown */}
      {hasChartWidgets ? (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 lg:gap-5 xl:gap-6 lg:min-h-[min(52vh,560px)]">
         {isVisible('performanceChart') && (
         <div className={`xl:col-span-7 ${DASH_CARD} ${CARD_PAD} ${CHART_PANEL_H} flex flex-col`}>
            <h3 className={`${SECTION_TITLE} mb-2 lg:mb-3`}>Performance</h3>
            <div className="flex-1 min-h-0 [&_rect]:cursor-pointer">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={(props: { x: number; y: number; payload?: { value?: string }; index?: number }) => {
                          const { x, y, payload, index } = props;
                          const point = typeof index === 'number' ? chartData[index] : chartData.find(d => d.name === payload?.value);
                          return (
                            <g transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}>
                              <text
                                x={0}
                                y={0}
                                dy={8}
                                textAnchor="middle"
                                fill="#64748b"
                                fontSize={12}
                                fontWeight="bold"
                                onClick={() => point && openDayDetail({ dayLabel: point.dayLabel, dateStr: point.dateStr, items: point.soldItems ?? [], revenue: point.revenue, itemProfit: point.itemProfit, expTotal: point.expTotal, netProfit: point.netProfit })}
                                role="button"
                                tabIndex={0}
                              >
                                {payload?.value}
                              </text>
                            </g>
                          );
                        }}
                     />
                     <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={48} />
                     <Tooltip 
                        cursor={{ fill: '#f8fafc' }} 
                        contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} 
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload;
                          const sold = p?.soldItems ?? [];
                          const itemProfit = Number(p?.itemProfit) || 0;
                          const expTotal = Number(p?.expTotal) || 0;
                          return (
                            <div className="bg-white rounded-lg border border-slate-200 shadow-lg p-2 text-xs">
                              <p className="font-bold text-slate-500 mb-1">{p?.dayLabel ?? p?.name}</p>
                              {payload.map((entry) => (
                                <p key={entry.dataKey} className="font-bold">€{formatEUR(Number(entry.value))} ({entry.name})</p>
                              ))}
                              <p className="text-slate-500 mt-1">Sale €{formatEUR(itemProfit)}{expTotal > 0 ? ` · Exp −€${formatEUR(expTotal)}` : ''}</p>
                              {sold.length > 0 && (
                                <button type="button" onClick={() => openDayDetail({ dayLabel: p?.dayLabel ?? p?.name, dateStr: p?.dateStr ?? '', items: sold, revenue: p?.revenue, itemProfit: p?.itemProfit, expTotal: p?.expTotal, netProfit: p?.netProfit })} className="mt-1 font-bold text-blue-600 hover:underline">
                                  {sold.length} sold →
                                </button>
                              )}
                            </div>
                          );
                        }}
                     />
                     <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Revenue" maxBarSize={40} onClick={(data: any) => { const p = data?.payload ?? data; openDayDetail({ dayLabel: p?.dayLabel ?? '', dateStr: p?.dateStr ?? '', items: p?.soldItems ?? [], revenue: p?.revenue, itemProfit: p?.itemProfit, expTotal: p?.expTotal, netProfit: p?.netProfit }); }} />
                     <Bar dataKey="netProfit" fill="#10B981" radius={[4, 4, 0, 0]} name="Net" maxBarSize={40} onClick={(data: any) => { const p = data?.payload ?? data; openDayDetail({ dayLabel: p?.dayLabel ?? '', dateStr: p?.dateStr ?? '', items: p?.soldItems ?? [], revenue: p?.revenue, itemProfit: p?.itemProfit, expTotal: p?.expTotal, netProfit: p?.netProfit }); }} />
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>
         )}

         <div className={`${isVisible('performanceChart') ? 'xl:col-span-5' : 'xl:col-span-12'} grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 gap-3 lg:gap-5 min-h-0`}>
         {isVisible('capitalDistribution') && (
         <div className={`${DASH_CARD} ${CARD_PAD} ${CHART_PANEL_H} flex flex-col`}>
            <div className="flex justify-between items-center mb-2 lg:mb-3">
               <h3 className={SECTION_TITLE}>Stock by category</h3>
               <span className="text-xs lg:text-sm font-bold text-slate-500">€{formatEUR(stats.totalInventoryValue)}</span>
            </div>
            {categoryData.length > 0 ? (
               <>
               <div className="flex-1 min-h-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={categoryData} cx="50%" cy="50%" innerRadius="42%" outerRadius="68%" paddingAngle={3} dataKey="value">
                           {categoryData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                           ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => `€${formatEUR(value)}`} contentStyle={{ borderRadius: '12px', fontSize: '13px' }} />
                     </PieChart>
                  </ResponsiveContainer>
               </div>
               <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-[56px] lg:max-h-[72px] overflow-hidden mt-1">
                  {categoryData.slice(0, 5).map((cat, idx) => (
                     <span key={cat.name} className="text-xs lg:text-sm text-slate-600 truncate">
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        {cat.name} €{formatEUR(cat.value)}
                     </span>
                  ))}
               </div>
               </>
            ) : (
               <div className="flex-1 flex items-center justify-center text-slate-300 text-xs">No stock</div>
            )}
         </div>
         )}

         {(isVisible('profitByCategory') || isVisible('profitByMonth')) && (
         <div className={`${DASH_CARD} ${CARD_PAD} flex flex-col ${CHART_PANEL_H}`}>
            <div className="flex gap-2 mb-3">
               {isVisible('profitByMonth') && (
                 <button type="button" onClick={() => setProfitTab('month')} className={`px-3 py-1.5 lg:px-4 lg:py-2 rounded-lg text-xs lg:text-sm font-black uppercase ${profitTab === 'month' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>By month</button>
               )}
               {isVisible('profitByCategory') && (
                 <button type="button" onClick={() => setProfitTab('category')} className={`px-3 py-1.5 lg:px-4 lg:py-2 rounded-lg text-xs lg:text-sm font-black uppercase ${profitTab === 'category' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>By category</button>
               )}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-1 -mx-1 px-1">
               {profitTab === 'month' && isVisible('profitByMonth') && (
                 profitByMonth.length === 0 ? (
                   <p className="text-sm text-slate-400 py-6 text-center">No data</p>
                 ) : profitByMonth.map((row) => (
                   <button key={row.name} type="button" onClick={() => openFinancialDetail({ title: formatYearMonthLabel(row.name), items: row.items, scopeExpenses: row.scopeExpenses, revenue: row.revenue, itemProfit: row.saleProfit, expTotal: row.expenses, netProfit: row.netProfit })} className="w-full flex items-center gap-2 py-2 lg:py-2.5 px-2 rounded-lg hover:bg-slate-50 text-left text-sm lg:text-base">
                     <span className="font-medium text-slate-700 w-16 lg:w-20 shrink-0 truncate">{formatYearMonthLabel(row.name).split(' ')[0]}</span>
                     <span className="text-slate-800 flex-1 truncate tabular-nums">Rev €{formatEUR(row.revenue ?? 0)}</span>
                     <span className="text-blue-700 shrink-0 tabular-nums hidden sm:inline">Margin €{formatEUR(row.saleProfit)}</span>
                     <span className={`font-black shrink-0 tabular-nums ${row.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>Net €{formatEUR(row.netProfit)}</span>
                     <ChevronRight size={14} className="lg:w-[18px] lg:h-[18px] text-slate-300 shrink-0" />
                   </button>
                 ))
               )}
               {profitTab === 'category' && isVisible('profitByCategory') && (
                 profitByCategory.length === 0 ? (
                   <p className="text-sm text-slate-400 py-6 text-center">No sales</p>
                 ) : profitByCategory.map((row) => (
                   <button key={row.name} type="button" onClick={() => openFinancialDetail({ title: `Category — ${row.name}`, items: row.items, scopeExpenses: [], itemProfit: row.saleProfit, netProfit: row.saleProfit, footnote: 'Sale profit only — expenses not split by category.' })} className="w-full flex items-center gap-2 py-2 lg:py-2.5 px-2 rounded-lg hover:bg-slate-50 text-left text-sm lg:text-base">
                     <span className="font-medium text-slate-700 flex-1 truncate">{row.name}</span>
                     <span className="text-slate-500 shrink-0">{row.items.length}×</span>
                     <span className={`font-black shrink-0 ${row.saleProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>€{formatEUR(row.saleProfit)}</span>
                     <ChevronRight size={14} className="lg:w-[18px] lg:h-[18px] text-slate-300 shrink-0" />
                   </button>
                 ))
               )}
            </div>
         </div>
         )}
         </div>
      </div>
      ) : (
        <div className={`${DASH_CARD} ${CARD_PAD} text-center py-16 lg:py-20`}>
          <BarChart3 size={40} className="mx-auto text-slate-300 mb-4" />
          <p className="font-bold text-slate-600 mb-2">No chart widgets enabled</p>
          <p className="text-sm text-slate-500 mb-4">Turn on Performance, Stock pie, or Profit breakdown in widget settings.</p>
          <button
            type="button"
            onClick={() => setShowWidgetModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
          >
            <Settings2 size={16} /> Customise widgets
          </button>
        </div>
      )}

      <Suspense fallback={null}>
        <DashboardAnalyticsPanel
          items={items}
          expenses={expenses}
          range={{ start: startDate, end: endDate }}
          rangeLabel={periodLabel}
          profitGoal={monthlyGoal}
        />
      </Suspense>
      </>
      )}
    </div>

    {financialDetailModal && createPortal(
      <div 
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-in fade-in" 
        onClick={() => setFinancialDetailModal(null)}
      >
        <div 
          className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden m-4 animate-in zoom-in-95" 
          onClick={e => e.stopPropagation()}
        >
          <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-slate-900 truncate">{financialDetailModal.title}</h3>
            <button onClick={() => setFinancialDetailModal(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0"><X size={20} className="text-slate-500"/></button>
          </div>
          <div className="px-4 pt-4 pb-2 grid grid-cols-2 gap-2 text-sm">
            <div className="p-3 rounded-xl bg-blue-50">
              <p className="text-[10px] font-bold uppercase text-blue-600">Revenue</p>
              <p className="font-black text-slate-900">€{formatEUR(financialDetailModal.revenue)}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50">
              <p className="text-[10px] font-bold uppercase text-emerald-600">Net profit</p>
              <p className={`font-black ${financialDetailModal.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                €{formatEUR(financialDetailModal.netProfit)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 col-span-2 text-xs text-slate-600 space-y-1">
              <p>
                <span className="font-bold">Sale profit</span> (sell − buy − fees): €{formatEUR(financialDetailModal.itemProfit)}
              </p>
              {financialDetailModal.expTotal > 0 && (
                <p>
                  <span className="font-bold">Operating expenses</span>: −€{formatEUR(financialDetailModal.expTotal)}
                </p>
              )}
            </div>
            {financialDetailModal.orderStats &&
              financialDetailModal.orderStats.orderCount !== financialDetailModal.orderStats.itemCount && (
              <div className="col-span-2 p-3 rounded-xl bg-blue-50/80 border border-blue-100 text-xs text-blue-900">
                <span className="font-bold">{financialDetailModal.orderStats.orderCount} marketplace orders</span>
                {' · '}
                <span>{financialDetailModal.orderStats.itemCount} inventory items</span>
                <span className="text-blue-700/80"> — bundles count as one order on eBay but several rows here.</span>
              </div>
            )}
          </div>
          <div className="p-4 overflow-y-auto max-h-[52vh] space-y-3">
            {financialDetailModal.items.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No sold items in this selection.</p>
            ) : financialDetailModal.orderGroups && financialDetailModal.orderGroups.length > 0 ? (
              <>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                  By order ({financialDetailModal.orderGroups.length})
                </p>
                {financialDetailModal.orderGroups.map((group) => (
                  <div key={group.key} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-100 flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800 truncate">{group.label}</p>
                      <span className="text-xs font-black text-slate-600 tabular-nums shrink-0">€{formatEUR(group.revenue)}</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.items.map((item) => {
                        const sell = Number(item.sellPrice) || 0;
                        const buy = Number(item.buyPrice) || 0;
                        const fee = Number(item.feeAmount) || 0;
                        const profit = calculateItemProfit(item);
                        return (
                          <div key={item.id} className="px-3 py-2.5 space-y-0.5">
                            <ItemLink
                              item={item}
                              itemName={item.name}
                              className="font-medium text-slate-900 hover:text-indigo-600 hover:underline truncate text-sm block"
                            />
                            <div className="flex flex-wrap gap-x-3 text-xs text-slate-600">
                              <span>Sell €{formatEUR(sell)}</span>
                              <span>Buy €{formatEUR(buy)}</span>
                              {fee > 0 && <span>Fees €{formatEUR(fee)}</span>}
                              <span className={`font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                Profit €{formatEUR(profit)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                  Sold items ({financialDetailModal.items.length})
                </p>
                {financialDetailModal.items.map((item) => {
                  const sell = Number(item.sellPrice) || 0;
                  const buy = Number(item.buyPrice) || 0;
                  const fee = Number(item.feeAmount) || 0;
                  const profit = calculateItemProfit(item);
                  const soldOn = item.sellDate ? toLocalCalendarDateKey(item.sellDate) : '';
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 rounded-xl space-y-1">
                      <ItemLink
                        item={item}
                        itemName={item.name}
                        className="font-medium text-slate-900 hover:text-indigo-600 hover:underline truncate block"
                      />
                      {soldOn && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Sold {soldOn}</p>
                      )}
                      <p className="text-[10px] text-slate-500 font-bold">{formatItemSalePlatform(item)}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                        <span>Sell €{formatEUR(sell)}</span>
                        <span>Buy €{formatEUR(buy)}</span>
                        {fee > 0 && <span>Fees €{formatEUR(fee)}</span>}
                        <span className={`font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          Profit €{formatEUR(profit)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            {financialDetailModal.footnote && (
              <p className="text-[11px] text-slate-500 bg-amber-50/80 border border-amber-100 rounded-lg px-3 py-2">
                {financialDetailModal.footnote}
              </p>
            )}
            {financialDetailModal.scopeExpenses.length > 0 && (
              <>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider pt-2">
                  Expenses ({financialDetailModal.scopeExpenses.length})
                </p>
                {financialDetailModal.scopeExpenses.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between gap-3 p-3 bg-amber-50 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{exp.description}</p>
                      {exp.date && (
                        <p className="text-[10px] text-slate-500">{toLocalCalendarDateKey(exp.date)}</p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-amber-800 shrink-0">−€{formatEUR(Number(exp.amount) || 0)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
    {showWidgetModal && createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-in fade-in"
        onClick={() => setShowWidgetModal(false)}
      >
        <div
          className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden m-4 animate-in zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Customise widgets</h3>
            <button
              onClick={() => setShowWidgetModal(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-slate-500" />
            </button>
          </div>
          <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
            <p className="text-sm text-slate-500 mb-4">Choose which widgets appear on your dashboard. Use arrows to reorder.</p>
            {visibleWidgets.map((id, idx) => (
              <div
                key={id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleWidget(id)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    visibleWidgets.includes(id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                  }`}
                >
                  {visibleWidgets.includes(id) && <Check size={12} className="text-white" />}
                </button>
                <span className="flex-1 text-sm font-medium text-slate-700">{WIDGET_LABELS[id]}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveWidget(id, 'up')}
                    disabled={idx === 0}
                    className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveWidget(id, 'down')}
                    disabled={idx === visibleWidgets.length - 1}
                    className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>
            ))}
            {DASHBOARD_WIDGET_IDS.filter((id) => !visibleWidgets.includes(id)).map((id) => (
              <div
                key={id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 opacity-75"
              >
                <button
                  type="button"
                  onClick={() => toggleWidget(id)}
                  className="w-5 h-5 rounded border-2 border-slate-300 flex items-center justify-center shrink-0 hover:border-blue-400"
                />
                <span className="flex-1 text-sm font-medium text-slate-400">{WIDGET_LABELS[id]}</span>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-slate-100 flex justify-between">
            <button
              type="button"
              onClick={resetWidgets}
              className="text-sm font-bold text-slate-500 hover:text-slate-700"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={() => setShowWidgetModal(false)}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
  );
};

export default Dashboard;
