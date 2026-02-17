import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, Wallet, Target, Package, Calendar, TrendingDown, Hourglass, Skull, Trophy, Star, Crown, Zap, Edit3, Check, CalendarDays, ArrowRight, CheckCircle2, Circle, Plus, X, Activity, Clock, AlertCircle } from 'lucide-react';
import { InventoryItem, ItemStatus, Expense, BusinessSettings, TaxMode } from '../types';
import { calculateTaxSummary, generateTaxReportCSV } from '../services/taxService';

interface Props {
  items: InventoryItem[];
  expenses?: Expense[];
  monthlyGoal: number;
  onGoalChange: (newGoal: number) => void;
  businessSettings?: BusinessSettings;
  categoryFields?: Record<string, string[]>;
}

const LEVELS = [
  { name: 'Novice Flipper', min: 0, icon: <Package size={20}/>, color: 'text-slate-500', bg: 'bg-slate-100' },
  { name: 'Hobby Reseller', min: 500, icon: <Star size={20}/>, color: 'text-blue-500', bg: 'bg-blue-100' },
  { name: 'Pro Merchant', min: 2500, icon: <Zap size={20}/>, color: 'text-purple-500', bg: 'bg-purple-100' },
  { name: 'Market Tycoon', min: 10000, icon: <Crown size={20}/>, color: 'text-yellow-500', bg: 'bg-yellow-100' },
  { name: 'Inventory Legend', min: 50000, icon: <Trophy size={20}/>, color: 'text-emerald-500', bg: 'bg-emerald-100' }
];

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#64748B'];

interface Task {
  id: string;
  text: string;
  completed: boolean;
}

const Dashboard: React.FC<Props> = ({ items, expenses = [], monthlyGoal, onGoalChange, businessSettings, categoryFields = {} }) => {
  const [timeFilter, setTimeFilter] = useState<string>('ALL');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  
  // Goal State managed via props now
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [tempGoal, setTempGoal] = useState(monthlyGoal.toString());

  // Task State
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('dashboard_tasks');
    return saved ? JSON.parse(saved) : [
      { id: '1', text: 'Check eBay for new deals', completed: false },
      { id: '2', text: 'Update sold listings', completed: true }
    ];
  });
  const [newTaskText, setNewTaskText] = useState('');

  const taxMode = businessSettings?.taxMode || 'SmallBusiness';

  // Helper to calculate Net Profit for a single item
  const calculateItemProfit = (item: InventoryItem): number => {
    const sell = Number(item.sellPrice) || 0;
    const buy = Number(item.buyPrice) || 0;
    const fee = Number(item.feeAmount) || 0;

    if (taxMode === 'RegularVAT') {
      // 19% VAT included in sell price (Gross).
      // Net Sell = Gross Sell / 1.19
      const netSell = sell / 1.19;
      return netSell - buy - fee;
    }
    
    if (taxMode === 'DifferentialVAT') {
      const margin = sell - buy;
      if (margin <= 0) return margin - fee;
      // Tax is 19% of the margin
      const tax = margin - (margin / 1.19);
      return margin - tax - fee;
    }

    // SmallBusiness or default: No tax
    return sell - buy - fee;
  };

  // Sync tempGoal with props when not editing
  useEffect(() => {
    if (!isEditingGoal) {
      setTempGoal(monthlyGoal.toString());
    }
  }, [monthlyGoal, isEditingGoal]);

  useEffect(() => {
    localStorage.setItem('dashboard_tasks', JSON.stringify(tasks));
  }, [tasks]);

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    setTasks(prev => [{ id: Date.now().toString(), text: newTaskText, completed: false }, ...prev]);
    setNewTaskText('');
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
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
    return items.filter(item => {
      let relevantDate: Date | null = null;
      if (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) {
         if (item.sellDate) relevantDate = new Date(item.sellDate);
      } else {
         if (item.buyDate) relevantDate = new Date(item.buyDate);
      }
      if (!relevantDate) return false;
      return relevantDate.getTime() >= startDate.getTime() && relevantDate.getTime() <= endDate.getTime();
    });
  }, [items, startDate, endDate]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
       const d = new Date(e.date);
       return d.getTime() >= startDate.getTime() && d.getTime() <= endDate.getTime();
    });
  }, [expenses, startDate, endDate]);

  const stats = useMemo(() => {
    const soldItems = filteredItems.filter(i => i.status === ItemStatus.SOLD);
    const inStockItems = filteredItems.filter(i => i.status === ItemStatus.IN_STOCK);
    // Only count real, atomic items (no PC/Bundle containers) for money metrics
    const soldAtomic = soldItems.filter(i => !i.isPC && !i.isBundle);
    const inStockAtomic = inStockItems.filter(i => !i.isPC && !i.isBundle);
    
    const totalTurnover = soldAtomic.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0);
    const grossProfit = soldAtomic.reduce((acc: number, i) => acc + Number(calculateItemProfit(i)), 0);

    const totalExpenses = filteredExpenses.reduce((acc: number, e) => acc + Number(e.amount), 0);
    const netProfit = grossProfit - totalExpenses;
    const inventoryValue = inStockAtomic.reduce((acc: number, i) => acc + Number(i.buyPrice), 0);

    const today = new Date();
    const globalInStock = items.filter(i => i.status === ItemStatus.IN_STOCK && !i.isPC && !i.isBundle);
    const deathPileItems = globalInStock.filter(i => {
        const buyDate = new Date(i.buyDate);
        const diffTime = Math.abs(today.getTime() - buyDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 60;
    });
    const deathPileValue = deathPileItems.reduce((acc: number, i) => acc + Number(i.buyPrice), 0);

    const totalInventoryValue = items
      .filter(i => i.status === ItemStatus.IN_STOCK && !i.isPC && !i.isBundle)
      .reduce((acc, i) => acc + Number(i.buyPrice || 0), 0);
    return { totalTurnover, grossProfit, totalExpenses, netProfit, inventoryValue, totalInventoryValue, deathPileCount: deathPileItems.length, deathPileValue };
  }, [filteredItems, filteredExpenses, items, taxMode]);

  const gameStats = useMemo(() => {
    const soldAtomic = items.filter(i => i.status === ItemStatus.SOLD && !i.isPC && !i.isBundle);
    const allTimeProfit = soldAtomic
      .reduce((acc: number, i) => acc + Number(calculateItemProfit(i)), 0) 
      - expenses.reduce((acc: number, e) => acc + Number(e.amount || 0), 0);

    const currentLevel = LEVELS.slice().reverse().find(l => allTimeProfit >= l.min) || LEVELS[0];
    const nextLevel = LEVELS.find(l => l.min > allTimeProfit);
    const progressToNext = nextLevel ? ((allTimeProfit - currentLevel.min) / (nextLevel.min - currentLevel.min)) * 100 : 100;

    const now = new Date();
    const currentMonthItems = items.filter(
      i =>
        i.status === ItemStatus.SOLD &&
        !i.isPC &&
        !i.isBundle &&
        i.sellDate &&
        new Date(i.sellDate).getMonth() === now.getMonth() &&
        new Date(i.sellDate).getFullYear() === now.getFullYear()
    );
    const currentMonthExpenses = expenses.filter(e => new Date(e.date).getMonth() === now.getMonth() && new Date(e.date).getFullYear() === now.getFullYear());
    const monthProfit = currentMonthItems.reduce((acc: number, i) => acc + Number(calculateItemProfit(i)), 0) - currentMonthExpenses.reduce((acc: number, e) => acc + Number(e.amount || 0), 0);
    const goalProgress = Math.min((monthProfit / monthlyGoal) * 100, 100);

    return { allTimeProfit, currentLevel, nextLevel, progressToNext, monthProfit, goalProgress };
  }, [items, expenses, monthlyGoal, taxMode]);

  const chartData = useMemo(() => {
    // Explicitly convert Date objects to timestamps (number) to safely use in arithmetic
    const startMs: number = startDate.getTime();
    const endMs: number = endDate.getTime();
    
    // Calculate difference using numeric timestamps
    const diffTime: number = Math.abs(endMs - startMs);
    const diffDays: number = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const data: { name: string, revenue: number, netProfit: number, timestamp: number }[] = [];

    if (timeFilter === 'ALL' || diffDays > 366) {
       const years = new Set<number>();
       filteredItems.forEach(i => { if (i.sellDate) years.add(new Date(i.sellDate).getFullYear()); });
       filteredExpenses.forEach(e => years.add(new Date(e.date).getFullYear()));
       
       const sortedYears = Array.from(years).sort((a: number, b: number) => Number(a) - Number(b));
       
       sortedYears.forEach(year => {
          const sold = filteredItems.filter(
            i =>
              i.status === ItemStatus.SOLD &&
              !i.isPC &&
              !i.isBundle &&
              i.sellDate &&
              new Date(i.sellDate).getFullYear() === year
          );
          const exps = filteredExpenses.filter(e => new Date(e.date).getFullYear() === year);
          const revenue = sold.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0);
          const itemProfit = sold.reduce((acc: number, i) => acc + Number(calculateItemProfit(i)), 0);
          const expTotal = exps.reduce((acc: number, e) => acc + Number(e.amount), 0);
          
          data.push({ name: year.toString(), revenue, netProfit: itemProfit - expTotal, timestamp: year });
       });
    } else {
       let curr: Date = new Date(startMs);
       
       while (curr.getTime() <= endMs) {
          const dayStr = curr.toISOString().split('T')[0];
          const label = diffDays > 32 ? curr.toLocaleString('default', { month: 'short' }) : curr.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
          
          const sold = filteredItems.filter(
            i =>
              i.status === ItemStatus.SOLD &&
              !i.isPC &&
              !i.isBundle &&
              i.sellDate === dayStr
          );
          const exps = filteredExpenses.filter(e => e.date === dayStr);
          const revenue = sold.reduce((acc: number, i) => acc + (Number(i.sellPrice) || 0), 0);
          const itemProfit: number = sold.reduce((acc: number, i) => acc + Number(calculateItemProfit(i)), 0);
          const expTotal: number = exps.reduce((acc: number, e) => acc + Number(e.amount), 0);

          const profitVal = itemProfit - expTotal;

          data.push({ name: label, revenue, netProfit: profitVal, timestamp: curr.getTime() });
          
          const nextDay = new Date(curr);
          nextDay.setDate(curr.getDate() + 1);
          curr = nextDay;
       }
    }
    return data;
  }, [filteredItems, filteredExpenses, startDate, endDate, timeFilter, taxMode]);

  // NEW: Category Pie Chart Data
  const categoryData = useMemo(() => {
    const inStock = items.filter(i => i.status === ItemStatus.IN_STOCK);
    const grouped = inStock.reduce((acc: Record<string, number>, item) => {
      const currentVal = Number(acc[item.category] || 0);
      const addVal = Number(item.buyPrice || 0);
      acc[item.category] = currentVal + addVal;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: Number(value) }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  // Profit by category (sold items in period)
  const profitByCategory = useMemo(() => {
    const sold = filteredItems.filter(
      i =>
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
        !i.isPC &&
        !i.isBundle
    );
    const byCat: Record<string, number> = {};
    sold.forEach(i => {
      const cat = i.category || 'Other';
      byCat[cat] = (byCat[cat] || 0) + calculateItemProfit(i);
    });
    return Object.entries(byCat)
      .map(([name, profit]) => ({ name, profit }))
      .sort((a, b) => b.profit - a.profit);
  }, [filteredItems, taxMode]);

  // Profit by month (sold items in period)
  const profitByMonth = useMemo(() => {
    const sold = filteredItems.filter(
      i =>
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
        !i.isPC &&
        !i.isBundle
    );
    const byMonth: Record<string, number> = {};
    sold.forEach(i => {
      if (!i.sellDate) return;
      const d = new Date(i.sellDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + calculateItemProfit(i);
    });
    return Object.entries(byMonth)
      .map(([name, profit]) => ({ name, profit }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredItems, taxMode]);

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
    items.forEach(i => {
      if (i.buyDate) actions.push({ type: 'BOUGHT', date: i.buyDate, item: i.name, amount: -Number(i.buyPrice) });
      if (i.sellDate && (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED)) actions.push({ type: 'SOLD', date: i.sellDate, item: i.name, amount: Number(i.sellPrice || 0) });
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
    <div className="space-y-6 animate-in fade-in pb-20">
      {/* Header & Date Filter */}
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">Analytics for {items.length} items & {expenses.length} expenses</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 bg-white p-2 rounded-2xl shadow-sm border border-slate-200">
          <div className="relative flex items-center">
             <div className="absolute left-3 text-slate-400 pointer-events-none"><CalendarDays size={18} /></div>
             <select 
               className="bg-transparent border-none outline-none font-bold text-slate-700 pl-10 pr-8 py-2 cursor-pointer appearance-none min-w-[140px]"
               value={timeFilter}
               onChange={(e) => setTimeFilter(e.target.value)}
             >
               <option value="ALL">All Time</option>
               <option value="LAST_7">Last 7 Days</option>
               <option value="LAST_30">Last 30 Days</option>
               <option value="LAST_90">Last 90 Days</option>
               <option disabled>──────────</option>
               {availableYears.map(year => (
                 <option key={year} value={year}>{year}</option>
               ))}
               <option disabled>──────────</option>
               <option value="CUSTOM">Custom Range</option>
             </select>
          </div>
          {timeFilter === 'CUSTOM' && (
             <div className="flex items-center gap-2 animate-in slide-in-from-right-4 fade-in">
                <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>
                <input type="date" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none" value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <ArrowRight size={12} className="text-slate-300"/>
                <input type="date" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
             </div>
          )}
        </div>
      </header>

      {/* GAMIFICATION SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Monthly Goal Card */}
         <div className="bg-slate-900 text-white p-6 rounded-[2.5rem] relative overflow-hidden shadow-2xl flex flex-col justify-between group">
            <div className="absolute top-0 right-0 p-6 opacity-10 transition-transform group-hover:scale-110 duration-500">
               <Target size={120} />
            </div>
            <div className="relative z-10">
               <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-black uppercase tracking-widest">
                     <Calendar size={12}/> Current Month
                  </div>
                  <button onClick={() => setIsEditingGoal(true)} className="p-2 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white">
                     <Edit3 size={14}/>
                  </button>
               </div>
               {isEditingGoal ? (
                  <div className="flex items-center gap-2 mb-2 animate-in fade-in">
                     <span className="text-2xl font-black text-slate-500">€</span>
                     <input autoFocus type="number" className="w-32 bg-white/10 border-b-2 border-blue-500 text-3xl font-black text-white outline-none p-1" value={tempGoal} onChange={e => setTempGoal(e.target.value)} onBlur={handleSaveGoal} onKeyDown={e => e.key === 'Enter' && handleSaveGoal()} />
                     <button onClick={handleSaveGoal} className="bg-blue-600 p-2 rounded-lg text-white"><Check size={16}/></button>
                  </div>
               ) : (
                  <>
                     <h3 className="text-4xl font-black tracking-tight mb-1">€{gameStats.monthProfit.toFixed(0)} <span className="text-slate-500 text-lg font-bold">/ €{monthlyGoal}</span></h3>
                     <p className="text-xs font-medium text-slate-400">Net profit vs goal · {gameStats.monthProfit >= monthlyGoal ? 'Goal reached!' : `€${(monthlyGoal - gameStats.monthProfit).toFixed(0)} to go`}</p>
                  </>
               )}
            </div>
            <div className="relative z-10 mt-6 space-y-2">
               <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  <span>Progress</span>
                  <span>{gameStats.goalProgress.toFixed(0)}%</span>
               </div>
               <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div className={`h-full rounded-full transition-all duration-1000 ease-out ${gameStats.goalProgress >= 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-gradient-to-r from-blue-600 to-indigo-500'}`} style={{ width: `${gameStats.goalProgress}%` }}></div>
               </div>
            </div>
         </div>

         {/* Level Status Card */}
         <div className="lg:col-span-2 bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col md:flex-row gap-8 items-center relative overflow-hidden">
            <div className="flex-1 space-y-4 relative z-10 w-full">
               <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${gameStats.currentLevel.bg} ${gameStats.currentLevel.color}`}>
                     {gameStats.currentLevel.icon}
                  </div>
                  <div>
                     <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Current Rank</p>
                     <h3 className="text-xl font-black text-slate-900">{gameStats.currentLevel.name}</h3>
                  </div>
               </div>
               <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold text-slate-500">
                     <span>Total Profit: €{gameStats.allTimeProfit.toFixed(0)}</span>
                     {gameStats.nextLevel ? <span>Next: {gameStats.nextLevel.name} (€{gameStats.nextLevel.min})</span> : <span>Max Level!</span>}
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                     <div className="h-full bg-slate-900 rounded-full transition-all duration-1000" style={{ width: `${gameStats.progressToNext}%` }} />
                  </div>
               </div>
            </div>
            <div className="hidden md:flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 w-48 shrink-0">
               <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 shadow-sm ${gameStats.currentLevel.bg} ${gameStats.currentLevel.color}`}>
                  {React.cloneElement(gameStats.currentLevel.icon as React.ReactElement<any>, { size: 32 })}
               </div>
               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center">Lifetime Earnings</p>
               <p className="text-lg font-black text-slate-900">€{gameStats.allTimeProfit.toLocaleString()}</p>
            </div>
         </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard title="Inventory value" value={`€${stats.totalInventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={<Package className="text-slate-600" />} subtitle="All in-stock (cost)" />
        <StatCard title="Total Sales" value={`€${stats.totalTurnover.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={<Wallet className="text-blue-600" />} subtitle="Revenue (period)" />
        <StatCard title="Net Profit" value={`€${stats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={<TrendingUp className="text-emerald-600" />} subtitle={taxMode === 'RegularVAT' ? "After Tax & Exp" : "After Expenses"} />
        <StatCard title="Overhead" value={`€${stats.totalExpenses.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={<TrendingDown className="text-red-500" />} subtitle="Expenses" />
        <div className={`bg-white p-6 rounded-3xl shadow-sm border ${stats.deathPileCount > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-100'}`}>
           <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-2xl ${stats.deathPileCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-50 text-slate-400'}`}>
                 {stats.deathPileCount > 0 ? <Skull size={24}/> : <Hourglass size={24}/>}
              </div>
              <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${stats.deathPileCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-50 text-slate-400'}`}>
                 {stats.deathPileCount > 0 ? 'Action Needed' : 'Healthy'}
              </span>
           </div>
           <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{`Capital Trap (>60d)`}</p>
           <h4 className={`text-2xl font-black ${stats.deathPileCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              €{stats.deathPileValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
           </h4>
        </div>
      </div>

      {/* ANALYTICS & PIE CHART ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Main Bar Chart */}
         <div className="lg:col-span-2 bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 h-[400px] flex flex-col">
            <h3 className="text-lg font-bold mb-4">Performance Analytics</h3>
            <div className="flex-1">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                     <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                     <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)' }} formatter={(v: number) => [`€${v.toLocaleString()}`, '']} />
                     <Bar dataKey="revenue" fill="#3B82F6" radius={[6, 6, 0, 0]} name="Revenue" />
                     <Bar dataKey="netProfit" fill="#10B981" radius={[6, 6, 0, 0]} name="Net Profit" />
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>

         {/* Inventory Capital Distribution Pie Chart */}
         <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-2">
               <h3 className="text-lg font-bold">Capital Distribution</h3>
               <span className="text-[10px] font-black uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Active Inventory</span>
            </div>
            {categoryData.length > 0 ? (
               <div className="flex-1 relative">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie
                           data={categoryData}
                           cx="50%"
                           cy="50%"
                           innerRadius={60}
                           outerRadius={80}
                           paddingAngle={5}
                           dataKey="value"
                        >
                           {categoryData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                           ))}
                        </Pie>
                        <Tooltip 
                           formatter={(value: number) => `€${value.toLocaleString()}`} 
                           contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                     </PieChart>
                  </ResponsiveContainer>
                  {/* Custom Legend */}
                  <div className="absolute inset-0 flex flex-col justify-center pointer-events-none items-center">
                     <p className="text-2xl font-black text-slate-900">€{stats.inventoryValue.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Value</p>
                  </div>
               </div>
            ) : (
               <div className="flex-1 flex items-center justify-center opacity-30 text-center flex-col">
                  <Package size={48} className="mb-2"/>
                  <p className="text-xs font-bold">No Inventory</p>
               </div>
            )}
            {/* Mini Legend List */}
            <div className="mt-2 space-y-1 overflow-y-auto max-h-[100px] scrollbar-hide">
               {categoryData.map((cat, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                     <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}></div>
                        <span className="font-medium text-slate-600 truncate max-w-[120px]">{cat.name}</span>
                     </div>
                     <span className="font-bold text-slate-900">€{cat.value.toLocaleString()}</span>
                  </div>
               ))}
            </div>
         </div>
      </div>

      {/* Profit by category & by month */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4">Profit by category (period)</h3>
            {profitByCategory.length === 0 ? (
               <p className="text-slate-400 text-sm">No sales in this period.</p>
            ) : (
               <div className="space-y-2 max-h-64 overflow-y-auto">
                  {profitByCategory.map((row, idx) => (
                     <div key={row.name} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                        <span className="font-medium text-slate-700 truncate">{row.name}</span>
                        <span className={`font-bold shrink-0 ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>€{row.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                     </div>
                  ))}
               </div>
            )}
         </div>
         <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4">Profit by month (period)</h3>
            {profitByMonth.length === 0 ? (
               <p className="text-slate-400 text-sm">No sales in this period.</p>
            ) : (
               <div className="space-y-2 max-h-64 overflow-y-auto">
                  {profitByMonth.map((row) => (
                     <div key={row.name} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                        <span className="font-medium text-slate-700">{row.name}</span>
                        <span className={`font-bold ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>€{row.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* Tax report (period summary for accountant / export) */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold mb-3">Tax report (period summary)</h3>
        <p className="text-sm text-slate-500 mb-4">Summary by calendar year for export or accountant. VAT figures when applicable.</p>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <label className="text-sm font-medium text-slate-600">Year</label>
          <select value={taxReportYear} onChange={(e) => setTaxReportYear(Number(e.target.value))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400">
            {taxYears.length ? taxYears.map(y => <option key={y} value={y}>{y}</option>) : <option value={taxReportYear}>{taxReportYear}</option>}
          </select>
          <button
            type="button"
            onClick={() => {
              const csv = generateTaxReportCSV(items, expenses, taxReportYear);
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `tax-report-${taxReportYear}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
          >
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-2 pr-4">Revenue (net)</th>
                <th className="py-2 pr-4">COGS</th>
                <th className="py-2 pr-4">Expenses</th>
                <th className="py-2 pr-4">Fees</th>
                {taxMode === 'RegularVAT' && <th className="py-2 pr-4">VAT (est.)</th>}
                <th className="py-2">Net profit</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-3 font-semibold text-slate-900">€{taxSummary.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="py-3 text-slate-600">€{taxSummary.cogs.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="py-3 text-slate-600">€{taxSummary.expenses.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="py-3 text-slate-600">€{taxSummary.fees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                {taxMode === 'RegularVAT' && <td className="py-3 text-amber-600 font-semibold">€{(taxSummary.vatPayable ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>}
                <td className="py-3 font-bold text-emerald-600">€{taxSummary.netProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Todo from data */}
      {todoFromData.length > 0 && (
         <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2">
               <AlertCircle size={18} className="text-amber-600"/> Data to review
            </h3>
            <ul className="space-y-2">
               {todoFromData.map(t => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                     <span className="text-sm font-medium text-amber-800">{t.label}</span>
                     <a href={t.href} className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-700 hover:text-amber-900 hover:underline">
                        <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded-lg">{t.count}</span>
                        <ArrowRight size={14}/>
                     </a>
                  </li>
               ))}
            </ul>
         </div>
      )}

      {/* TASKS & ACTIVITY ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {/* TASKS WIDGET */}
         <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col min-h-[300px]">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
               <CheckCircle2 className="text-blue-600"/> Reseller Tasks
            </h3>
            
            <form onSubmit={handleAddTask} className="flex gap-2 mb-4">
               <input 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:border-blue-500"
                  placeholder="Add new task..."
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
               />
               <button type="submit" className="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 transition-all"><Plus size={20}/></button>
            </form>

            <div className="flex-1 space-y-2 overflow-y-auto max-h-[250px] scrollbar-hide pr-1">
               {tasks.length === 0 && (
                  <p className="text-center text-slate-400 text-xs py-8 italic">No active tasks. Good job!</p>
               )}
               {tasks.map(task => (
                  <div key={task.id} className="group flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl transition-all cursor-pointer" onClick={() => toggleTask(task.id)}>
                     <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${task.completed ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                        {task.completed && <Check size={12} className="text-white"/>}
                     </div>
                     <span className={`flex-1 text-sm font-medium transition-all ${task.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{task.text}</span>
                     <button onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <X size={16}/>
                     </button>
                  </div>
               ))}
            </div>
         </div>

         {/* RECENT ACTIVITY FEED */}
         <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col min-h-[300px]">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
               <Activity className="text-indigo-600"/> Recent Activity
            </h3>
            
            <div className="flex-1 space-y-4 overflow-y-auto max-h-[300px] scrollbar-hide">
               {activityFeed.length === 0 && (
                  <p className="text-center text-slate-400 text-xs py-8 italic">No recent activity recorded.</p>
               )}
               {activityFeed.map((action, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                     <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        action.type === 'SOLD' ? 'bg-emerald-100 text-emerald-600' : 
                        action.type === 'BOUGHT' ? 'bg-blue-100 text-blue-600' : 
                        'bg-red-50 text-red-500'
                     }`}>
                        {action.type === 'SOLD' ? <TrendingUp size={18}/> : 
                         action.type === 'BOUGHT' ? <Package size={18}/> : 
                         <TrendingDown size={18}/>}
                     </div>
                     <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{action.item}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                           <Clock size={10}/> {new Date(action.date).toLocaleDateString()}
                        </p>
                     </div>
                     <div className={`font-black text-sm ${action.amount > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                        {action.amount > 0 ? '+' : ''}€{Math.abs(action.amount).toLocaleString()}
                     </div>
                  </div>
               ))}
            </div>
         </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ title: string, value: string, icon: React.ReactNode, subtitle?: string, description?: string }> = ({ title, value, icon, subtitle, description }) => (
  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
    <div className="flex justify-between items-start mb-4">
      <div className="p-3 bg-slate-50 rounded-2xl">{icon}</div>
      {subtitle && <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">{subtitle}</span>}
    </div>
    <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
    <h4 className="text-2xl font-black text-slate-900">{value}</h4>
    {description && <p className="text-[10px] text-slate-400 mt-2 font-medium">{description}</p>}
  </div>
);

export default Dashboard;
