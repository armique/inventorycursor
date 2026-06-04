import React, { useMemo, useState, useEffect } from 'react';
import { formatEUR } from '../utils/formatMoney';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  TrendingUp, Target, Package, TrendingDown, Trophy, Star, Crown, Zap,
  Edit3, Check, CalendarDays, ArrowRight, CheckCircle2, Plus, X, Activity, AlertCircle,
  Settings2, ChevronUp, ChevronDown, ChevronRight, Download, Sparkles,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { InventoryItem, ItemStatus, Expense, BusinessSettings, TaxMode, DashboardPreferences, DashboardTask } from '../types';
import { DEFAULT_DASHBOARD_WIDGET_IDS } from '../services/constants';
import { calculateTaxSummary, generateTaxReportCSV } from '../services/taxService';
import {
  roundMoney,
  computeItemProfitBeforeOverhead,
  shouldSkipForAggregatedSaleLine,
  shouldSkipForInventoryCostLine,
  shouldSkipContainerForPurchaseCogs,
} from '../services/financialAggregation';
import { toLocalCalendarDateKey, yearMonthKeyFromDate, currentLocalYearMonth } from '../utils/calendarDate';

interface Props {
  items: InventoryItem[];
  expenses?: Expense[];
  monthlyGoal: number;
  onGoalChange: (newGoal: number) => void;
  businessSettings?: BusinessSettings;
  categoryFields?: Record<string, string[]>;
  dashboardPreferences: DashboardPreferences;
  onDashboardPreferencesChange: (next: DashboardPreferences) => void;
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

const DASH_CARD = 'bg-white rounded-xl border border-slate-200/90 shadow-sm';

const QUICK_FILTERS: { value: string; label: string }[] = [
  { value: 'LAST_7', label: '7d' },
  { value: 'LAST_30', label: '30d' },
  { value: 'THIS_MONTH', label: 'Month' },
  { value: 'LAST_90', label: '90d' },
  { value: 'ALL', label: 'All' },
];

function exportPeriodSalesCsv(sold: InventoryItem[], label: string) {
  const headers = ['Name', 'Category', 'SellDate', 'SellPrice', 'BuyPrice', 'Fees', 'Profit'];
  const rows = sold.map((i) => {
    const sell = Number(i.sellPrice) || 0;
    const buy = Number(i.buyPrice) || 0;
    const fee = Number(i.feeAmount) || 0;
    const profit = roundMoney(sell - buy - fee);
    return [i.name, i.category || '', i.sellDate || '', sell, buy, fee, profit]
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
}) => {
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
        item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED ? item.sellDate : item.buyDate;
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
          (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
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
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
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
              (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
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
              (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
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
    const byMonth: Record<string, { items: InventoryItem[]; saleProfit: number }> = {};
    soldInPeriod.forEach((i) => {
      if (!i.sellDate) return;
      const key = yearMonthKeyFromDate(i.sellDate);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { items: [], saleProfit: 0 };
      byMonth[key].items.push(i);
      byMonth[key].saleProfit += calculateItemProfit(i);
    });
    filteredExpenses.forEach((e) => {
      const key = yearMonthKeyFromDate(e.date);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { items: [], saleProfit: 0 };
    });
    return Object.entries(byMonth)
      .map(([name, g]) => {
        const saleProfit = roundMoney(g.saleProfit);
        const scopeExpenses = filteredExpenses.filter((e) => yearMonthKeyFromDate(e.date) === name);
        const expenses = roundMoney(scopeExpenses.reduce((acc, e) => acc + Number(e.amount), 0));
        return {
          name,
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
    };
  }, [soldInPeriod, stats.grossProfit, items, taxMode]);

  const monthOverMonth = useMemo(() => {
    if (timeFilter !== 'THIS_MONTH') return null;
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const soldPrev = items.filter(
      (i) =>
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
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
    let missingSpecsCount = 0;
    items.forEach((item) => {
      const key = `${item.category}:${item.subCategory || ''}`;
      const fields = categoryFields[key] || categoryFields[item.category || ''] || [];
      const missing = fields.filter((f) => {
        const val = item.specs?.[f];
        return val === undefined || val === null || String(val).trim() === '';
      });
      if (missing.length > 0) missingSpecsCount++;
    });
    return [
      { id: 'no-image', label: 'Items without image', count: noImage.length, href: '/panel/inventory' },
      { id: 'hidden-store', label: 'Items hidden from store', count: hiddenFromStore.length, href: '/panel/store-management' },
      { id: 'missing-specs', label: 'Items missing key specs', count: missingSpecsCount, href: '/panel/missing-specs' },
    ].filter(t => t.count > 0);
  }, [items, categoryFields]);

  // Recent Activity Data
  const activityFeed = useMemo(() => {
    const actions: { type: string, date: string, item: string, amount: number }[] = [];
    items.forEach((i) => {
      if (i.buyDate && !shouldSkipContainerForPurchaseCogs(i, items)) {
        actions.push({ type: 'BOUGHT', date: i.buyDate, item: i.name, amount: -Number(i.buyPrice) });
      }
      if (
        i.sellDate &&
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
        !shouldSkipForAggregatedSaleLine(i, items)
      ) {
        actions.push({ type: 'SOLD', date: i.sellDate, item: i.name, amount: Number(i.sellPrice || 0) });
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
          <button onClick={() => window.location.hash = '#/add'} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all">Add Item</button>
          <button onClick={() => window.location.hash = '#/import'} className="bg-white text-slate-700 border px-8 py-3 rounded-2xl font-bold hover:bg-slate-50 transition-all">Import Data</button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full min-h-0 overflow-y-auto space-y-2.5 sm:space-y-3 animate-in fade-in pb-8 max-w-[1600px] mx-auto">
      {/* Compact header + period filters */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-500 truncate">
            {items.length} items · {expenses.length} expenses · {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setTimeFilter(f.value)}
                className={`px-2.5 py-1.5 text-xs font-bold rounded-md transition-colors min-h-[36px] ${
                  timeFilter === f.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex items-center rounded-lg border border-slate-200 bg-white">
            <CalendarDays size={14} className="absolute left-2 text-slate-400 pointer-events-none" />
            <select
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-700 pl-7 pr-6 py-2 cursor-pointer appearance-none min-w-[100px]"
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
            <div className="flex items-center gap-1">
              <input type="date" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <ArrowRight size={12} className="text-slate-300" />
              <input type="date" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowWidgetModal(true)}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Customise widgets"
          >
            <Settings2 size={16} />
          </button>
        </div>
      </header>

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
          className="w-full grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100 hover:bg-slate-50/50 transition-colors text-left"
        >
          {[
            { label: 'Revenue', value: `€${formatEUR(stats.totalTurnover)}`, tone: 'text-slate-900' },
            { label: 'Sale profit', value: `€${formatEUR(stats.grossProfit)}`, tone: 'text-blue-700' },
            { label: 'Expenses', value: `−€${formatEUR(stats.totalExpenses)}`, tone: 'text-red-600' },
            { label: 'Net profit', value: `€${formatEUR(stats.netProfit)}`, tone: stats.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600' },
          ].map((k) => (
            <div key={k.label} className="bg-white px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-slate-400">{k.label}</p>
              <p className={`text-base sm:text-lg font-black tabular-nums ${k.tone}`}>{k.value}</p>
            </div>
          ))}
        </button>

        {monthOverMonth && (
          <div className="px-3 py-1.5 bg-blue-50/80 border-b border-blue-100 flex items-center gap-2 text-xs">
            <Sparkles size={13} className="text-blue-600 shrink-0" />
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
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-2.5 py-2 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                <Target size={11} className="text-blue-600" /> Goal
              </span>
              <button type="button" onClick={() => setIsEditingGoal(true)} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Edit goal">
                <Edit3 size={11} />
              </button>
            </div>
            {isEditingGoal ? (
              <div className="flex items-center gap-1">
                <input autoFocus type="number" className="w-full border-b border-blue-500 text-sm font-black outline-none min-h-[32px]" value={tempGoal} onChange={(e) => setTempGoal(e.target.value)} onBlur={handleSaveGoal} onKeyDown={(e) => e.key === 'Enter' && handleSaveGoal()} />
                <button type="button" onClick={handleSaveGoal} className="p-1 bg-blue-600 text-white rounded"><Check size={12} /></button>
              </div>
            ) : (
              <p className="text-sm font-black tabular-nums truncate">
                €{formatEUR(gameStats.monthProfit)}<span className="text-slate-400 font-bold text-xs"> /€{formatEUR(monthlyGoal)}</span>
              </p>
            )}
            <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
              <div className={`h-full rounded-full ${gameStats.goalProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${gameStats.goalProgress}%` }} />
            </div>
          </div>
          <div className="px-2.5 py-2 min-w-0">
            <span className="text-[10px] font-bold uppercase text-slate-400">Rank</span>
            <p className="text-sm font-black truncate flex items-center gap-1">
              <span className={`inline-flex p-0.5 rounded ${gameStats.currentLevel.bg}`}>{React.cloneElement(gameStats.currentLevel.icon as React.ReactElement<any>, { size: 12 })}</span>
              {gameStats.currentLevel.name}
            </p>
            <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-slate-700 rounded-full" style={{ width: `${gameStats.progressToNext}%` }} />
            </div>
          </div>
          <div className="px-2.5 py-2 min-w-0">
            <span className="text-[10px] font-bold uppercase text-slate-400">Lifetime</span>
            <p className={`text-sm font-black tabular-nums ${gameStats.allTimeProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              €{formatEUR(gameStats.allTimeProfit)}
            </p>
            <p className="text-[10px] text-slate-400">{gameStats.allTimeSoldCount} sold</p>
          </div>
        </div>
        )}

        {isVisible('statCards') && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <span className="text-slate-500"><strong className="text-slate-800">{periodInsights.soldCount}</strong> sold</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">Avg <strong className="text-slate-800">€{formatEUR(periodInsights.avgProfitPerSale)}</strong>/sale</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500"><strong className="text-slate-800">{periodInsights.inStockCount}</strong> in stock</span>
          <span className="text-slate-300">·</span>
          <span className={`${stats.deathPileCount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
            <strong>{stats.deathPileCount}</strong> stale &gt;60d (€{formatEUR(stats.deathPileValue)})
          </span>
          {periodInsights.bestSale && (
            <>
              <span className="text-slate-300">·</span>
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
                className="text-emerald-700 font-bold hover:underline truncate max-w-[140px] sm:max-w-none"
              >
                Best +€{formatEUR(periodInsights.bestSaleProfit)}
              </button>
            </>
          )}
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => exportPeriodSalesCsv(soldInPeriod, periodLabel)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-700 font-bold hover:bg-slate-200"
            >
              <Download size={12} /> CSV
            </button>
          </span>
        </div>
        )}
      </div>
      )}

      {isVisible('todoFromData') && todoFromData.length > 0 && (
         <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs">
            <AlertCircle size={14} className="text-amber-600 shrink-0" />
            {todoFromData.map((t) => (
               <a key={t.id} href={t.href} className="inline-flex items-center gap-1 font-bold text-amber-800 hover:underline">
                  {t.label} <span className="bg-amber-200 px-1.5 rounded">{t.count}</span>
               </a>
            ))}
         </div>
      )}

      {/* Charts + breakdown — compact row */}
      {(isVisible('performanceChart') || isVisible('capitalDistribution') || isVisible('profitByCategory') || isVisible('profitByMonth')) && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
         {isVisible('performanceChart') && (
         <div className={`lg:col-span-7 ${DASH_CARD} p-3 h-[200px] sm:h-[220px] flex flex-col`}>
            <h3 className="text-xs font-black uppercase text-slate-500 mb-1">Performance</h3>
            <div className="flex-1 min-h-0 [&_rect]:cursor-pointer">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748b', fontSize: 10 }}
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
                                fontSize={10}
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
                     <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} width={42} />
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
                     <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Revenue" maxBarSize={28} onClick={(data: any) => { const p = data?.payload ?? data; openDayDetail({ dayLabel: p?.dayLabel ?? '', dateStr: p?.dateStr ?? '', items: p?.soldItems ?? [], revenue: p?.revenue, itemProfit: p?.itemProfit, expTotal: p?.expTotal, netProfit: p?.netProfit }); }} />
                     <Bar dataKey="netProfit" fill="#10B981" radius={[4, 4, 0, 0]} name="Net" maxBarSize={28} onClick={(data: any) => { const p = data?.payload ?? data; openDayDetail({ dayLabel: p?.dayLabel ?? '', dateStr: p?.dateStr ?? '', items: p?.soldItems ?? [], revenue: p?.revenue, itemProfit: p?.itemProfit, expTotal: p?.expTotal, netProfit: p?.netProfit }); }} />
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>
         )}

         <div className={`${isVisible('performanceChart') ? 'lg:col-span-5' : 'lg:col-span-12'} grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5`}>
         {isVisible('capitalDistribution') && (
         <div className={`${DASH_CARD} p-3 h-[200px] sm:h-[220px] flex flex-col`}>
            <div className="flex justify-between items-center mb-1">
               <h3 className="text-xs font-black uppercase text-slate-500">Stock by category</h3>
               <span className="text-[10px] font-bold text-slate-400">€{formatEUR(stats.totalInventoryValue)}</span>
            </div>
            {categoryData.length > 0 ? (
               <>
               <div className="flex-1 min-h-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={categoryData} cx="50%" cy="50%" innerRadius={36} outerRadius={52} paddingAngle={3} dataKey="value">
                           {categoryData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                           ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => `€${formatEUR(value)}`} contentStyle={{ borderRadius: '8px', fontSize: '11px' }} />
                     </PieChart>
                  </ResponsiveContainer>
               </div>
               <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-h-[44px] overflow-hidden">
                  {categoryData.slice(0, 4).map((cat, idx) => (
                     <span key={cat.name} className="text-[10px] text-slate-600 truncate">
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
         <div className={`${DASH_CARD} p-3 flex flex-col ${isVisible('capitalDistribution') ? 'h-[200px] sm:h-[220px]' : 'min-h-[200px]'}`}>
            <div className="flex gap-1 mb-2">
               {isVisible('profitByMonth') && (
                 <button type="button" onClick={() => setProfitTab('month')} className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${profitTab === 'month' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>By month</button>
               )}
               {isVisible('profitByCategory') && (
                 <button type="button" onClick={() => setProfitTab('category')} className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${profitTab === 'category' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>By category</button>
               )}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-0.5 -mx-1 px-1">
               {profitTab === 'month' && isVisible('profitByMonth') && (
                 profitByMonth.length === 0 ? (
                   <p className="text-xs text-slate-400 py-4 text-center">No data</p>
                 ) : profitByMonth.map((row) => (
                   <button key={row.name} type="button" onClick={() => openFinancialDetail({ title: formatYearMonthLabel(row.name), items: row.items, scopeExpenses: row.scopeExpenses, itemProfit: row.saleProfit, expTotal: row.expenses, netProfit: row.netProfit })} className="w-full flex items-center gap-1 py-1.5 px-1 rounded-lg hover:bg-slate-50 text-left text-xs">
                     <span className="font-medium text-slate-700 w-16 shrink-0 truncate">{formatYearMonthLabel(row.name).split(' ')[0]}</span>
                     <span className="text-slate-400 flex-1 truncate">S €{formatEUR(row.saleProfit)}</span>
                     <span className={`font-black shrink-0 ${row.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>N €{formatEUR(row.netProfit)}</span>
                     <ChevronRight size={12} className="text-slate-300 shrink-0" />
                   </button>
                 ))
               )}
               {profitTab === 'category' && isVisible('profitByCategory') && (
                 profitByCategory.length === 0 ? (
                   <p className="text-xs text-slate-400 py-4 text-center">No sales</p>
                 ) : profitByCategory.map((row) => (
                   <button key={row.name} type="button" onClick={() => openFinancialDetail({ title: `Category — ${row.name}`, items: row.items, scopeExpenses: [], itemProfit: row.saleProfit, netProfit: row.saleProfit, footnote: 'Sale profit only — expenses not split by category.' })} className="w-full flex items-center gap-1 py-1.5 px-1 rounded-lg hover:bg-slate-50 text-left text-xs">
                     <span className="font-medium text-slate-700 flex-1 truncate">{row.name}</span>
                     <span className="text-slate-400 shrink-0">{row.items.length}×</span>
                     <span className={`font-black shrink-0 ${row.saleProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>€{formatEUR(row.saleProfit)}</span>
                     <ChevronRight size={12} className="text-slate-300 shrink-0" />
                   </button>
                 ))
               )}
            </div>
         </div>
         )}
         </div>
      </div>
      )}

      {/* Collapsible: tax, tasks, activity */}
      {(isVisible('taxReport') || isVisible('tasks') || isVisible('recentActivity')) && (
      <div className={DASH_CARD}>
        <button
          type="button"
          onClick={() => setShowMoreSections((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <span>Tax export, tasks & activity</span>
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${showMoreSections ? 'rotate-180' : ''}`} />
        </button>
        {showMoreSections && (
        <div className="border-t border-slate-100 p-3 space-y-3">
      {isVisible('taxReport') && (
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-xs font-black uppercase text-slate-500 flex-1">Finanzamt / EÜR</h3>
          <select value={taxReportYear} onChange={(e) => setTaxReportYear(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold">
            {taxYears.length ? taxYears.map(y => <option key={y} value={y}>{y}</option>) : <option value={taxReportYear}>{taxReportYear}</option>}
          </select>
          <button type="button" onClick={() => { const csv = generateTaxReportCSV(items, expenses, taxReportYear); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tax-report-${taxReportYear}.csv`; a.click(); URL.revokeObjectURL(a.href); }} className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold">
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-slate-500 font-bold uppercase">
                <th className="py-1 pr-2 text-left">Revenue</th>
                <th className="py-1 pr-2 text-left">COGS</th>
                <th className="py-1 pr-2 text-left">Exp</th>
                <th className="py-1 pr-2 text-left">Fees</th>
                <th className="py-1 text-left">Net</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold tabular-nums">
                <td className="py-1">€{formatEUR(taxSummary.revenue)}</td>
                <td className="py-1 text-slate-600">€{formatEUR(taxSummary.cogs)}</td>
                <td className="py-1 text-slate-600">€{formatEUR(taxSummary.expenses)}</td>
                <td className="py-1 text-slate-600">€{formatEUR(taxSummary.fees)}</td>
                <td className="py-1 text-emerald-600">€{formatEUR(taxSummary.netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}

      {(isVisible('tasks') || isVisible('recentActivity')) && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
         {isVisible('tasks') && (
         <div>
            <h3 className="text-xs font-black uppercase text-slate-500 mb-2 flex items-center gap-1"><CheckCircle2 size={14}/> Tasks</h3>
            <form onSubmit={handleAddTask} className="flex gap-1 mb-2">
               <input className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none min-h-[36px]" placeholder="Add task…" value={newTaskText} onChange={e => setNewTaskText(e.target.value)} />
               <button type="submit" className="bg-blue-600 text-white p-1.5 rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"><Plus size={16}/></button>
            </form>
            <div className="space-y-1 max-h-[120px] overflow-y-auto">
               {tasks.map(task => (
                  <div key={task.id} className="group flex items-center gap-2 py-1 px-1 hover:bg-slate-50 rounded-lg cursor-pointer text-xs" onClick={() => toggleTask(task.id)}>
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
            <h3 className="text-xs font-black uppercase text-slate-500 mb-2 flex items-center gap-1"><Activity size={14}/> Recent</h3>
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
               {activityFeed.map((action, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                     <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${action.type === 'SOLD' ? 'bg-emerald-100 text-emerald-600' : action.type === 'BOUGHT' ? 'bg-blue-100 text-blue-600' : 'bg-red-50 text-red-500'}`}>
                        {action.type === 'SOLD' ? <TrendingUp size={14}/> : action.type === 'BOUGHT' ? <Package size={14}/> : <TrendingDown size={14}/>}
                     </div>
                     <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 truncate">{action.item}</p>
                        <p className="text-[10px] text-slate-400">{new Date(action.date).toLocaleDateString()}</p>
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
            {financialDetailModal.footnote && (
              <p className="col-span-2 text-[11px] text-slate-500 bg-amber-50/80 border border-amber-100 rounded-lg px-3 py-2">
                {financialDetailModal.footnote}
              </p>
            )}
          </div>
          <div className="p-4 overflow-y-auto max-h-[52vh] space-y-3">
            {financialDetailModal.items.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No sold items in this selection.</p>
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
                      <p className="font-medium text-slate-900 truncate">{item.name}</p>
                      {soldOn && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Sold {soldOn}</p>
                      )}
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
