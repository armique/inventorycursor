
import React, { useState, useMemo } from 'react';
import { 
  Plus, Trash2, Calendar, Tag, CreditCard, Search, Wallet, 
  TrendingDown, TrendingUp, Filter, Receipt, ShoppingBag, 
  Wrench, Truck, Percent, Briefcase, X, Repeat, Sparkles, Edit3, Copy
} from 'lucide-react';
import { Expense, ExpenseCategory, RecurringExpense } from '../types';

interface Props {
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  onAddExpense: (expense: Expense) => void;
  onUpdateExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
  onAddRecurringExpense: (recurring: RecurringExpense) => void;
  onDeleteRecurringExpense: (id: string) => void;
  onUpdateRecurringExpense: (recurring: RecurringExpense) => void;
}

const CATEGORIES: { id: ExpenseCategory; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'Shipping', label: 'DHL / Shipping', icon: <Truck size={16}/>, color: 'text-blue-500 bg-blue-50' },
  { id: 'Packaging', label: 'Packaging', icon: <ShoppingBag size={16}/>, color: 'text-amber-500 bg-amber-50' },
  { id: 'Fees', label: 'Platform Fees', icon: <Percent size={16}/>, color: 'text-red-500 bg-red-50' },
  { id: 'Tools', label: 'Tools', icon: <Wrench size={16}/>, color: 'text-slate-500 bg-slate-100' },
  { id: 'Cleaning', label: 'Cleaning', icon: <CreditCard size={16}/>, color: 'text-cyan-500 bg-cyan-50' },
  { id: 'Office', label: 'Office / Admin', icon: <Briefcase size={16}/>, color: 'text-indigo-500 bg-indigo-50' },
  { id: 'Marketing', label: 'Ads / Marketing', icon: <TrendingUp size={16}/>, color: 'text-pink-500 bg-pink-50' },
  { id: 'Other', label: 'Other', icon: <Tag size={16}/>, color: 'text-gray-500 bg-gray-50' },
];

const ExpenseManager: React.FC<Props> = ({ 
  expenses, 
  recurringExpenses,
  onAddExpense, 
  onUpdateExpense,
  onDeleteExpense,
  onAddRecurringExpense,
  onDeleteRecurringExpense,
  onUpdateRecurringExpense
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'ALL'>('ALL');
  const [showRecurring, setShowRecurring] = useState(false);

  // Form State
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    date: new Date().toISOString().split('T')[0],
    category: 'Shipping',
    amount: 0,
    description: ''
  });

  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Recurring Expense Form State
  const [newRecurring, setNewRecurring] = useState<Partial<RecurringExpense>>({
    startDate: new Date().toISOString().split('T')[0],
    category: 'Office',
    monthlyAmount: 0,
    description: ''
  });

  const [editingRecurring, setEditingRecurring] = useState<RecurringExpense | null>(null);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [customRecurringCategory, setCustomRecurringCategory] = useState<string>('');

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      const matchesSearch = e.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = selectedCategory === 'ALL' || e.category === selectedCategory;
      return matchesSearch && matchesCat;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, searchTerm, selectedCategory]);

  const handleSubmitRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRecurring.monthlyAmount || !newRecurring.description || !newRecurring.startDate) return;

    const category: ExpenseCategory = (customRecurringCategory.trim() || newRecurring.category) as ExpenseCategory;

    if (editingRecurring) {
      const updated: RecurringExpense = {
        ...editingRecurring,
        description: newRecurring.description!,
        monthlyAmount: Number(newRecurring.monthlyAmount),
        startDate: newRecurring.startDate!,
        category,
      };
      onUpdateRecurringExpense(updated);
    } else {
      const recurring: RecurringExpense = {
        id: `recurring-${Date.now()}`,
        description: newRecurring.description!,
        monthlyAmount: Number(newRecurring.monthlyAmount),
        startDate: newRecurring.startDate!,
        category,
      };
      onAddRecurringExpense(recurring);
    }

    setIsRecurringModalOpen(false);
    setNewRecurring({
      startDate: new Date().toISOString().split('T')[0],
      category: 'Office',
      monthlyAmount: 0,
      description: ''
    });
    setEditingRecurring(null);
    setCustomRecurringCategory('');
  };

  const stats = useMemo(() => {
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const thisMonth = expenses
      .filter(e => new Date(e.date).getMonth() === new Date().getMonth())
      .reduce((sum, e) => sum + e.amount, 0);
    return { total, thisMonth };
  }, [expenses]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpense.amount || !newExpense.description) return;

    const category: ExpenseCategory = (customCategory.trim() || newExpense.category) as ExpenseCategory;

    if (editingExpense) {
      const updated: Expense = {
        ...editingExpense,
        description: newExpense.description!,
        amount: Number(newExpense.amount),
        date: newExpense.date || new Date().toISOString().split('T')[0],
        category,
      };
      onUpdateExpense(updated);
    } else {
      const expense: Expense = {
        id: `exp-${Date.now()}`,
        description: newExpense.description!,
        amount: Number(newExpense.amount),
        date: newExpense.date || new Date().toISOString().split('T')[0],
        category,
      };
      onAddExpense(expense);
    }

    setIsModalOpen(false);
    setNewExpense({
      date: new Date().toISOString().split('T')[0],
      category: 'Shipping',
      amount: 0,
      description: ''
    });
    setEditingExpense(null);
    setCustomCategory('');
  };

  const getCategoryIcon = (cat: string) => {
    const found = CATEGORIES.find(c => c.id === cat);
    return found ? (
      <div className={`p-2 rounded-xl ${found.color}`}>
        {found.icon}
      </div>
    ) : <Tag size={16} />;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-32">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Overhead & Expenses</h1>
          <p className="text-sm text-slate-500 font-medium italic">Track shipping, packaging, and operational costs</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsRecurringModalOpen(true)}
            className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2"
          >
            <Repeat size={16}/> Recurring
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-black transition-all flex items-center gap-2"
          >
            <Plus size={16}/> Add Expense
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <div className="flex justify-between items-start mb-4">
               <div className="p-3 bg-red-50 text-red-500 rounded-2xl"><TrendingDown size={20}/></div>
               <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Total</span>
            </div>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Expenses</p>
            <h4 className="text-3xl font-black text-slate-900">€{stats.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h4>
         </div>

         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <div className="flex justify-between items-start mb-4">
               <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl"><Calendar size={20}/></div>
               <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Current Month</span>
            </div>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Monthly Cost</p>
            <h4 className="text-3xl font-black text-slate-900">€{stats.thisMonth.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h4>
         </div>
      </div>

      {/* Recurring Expenses Section */}
      {recurringExpenses.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <Repeat size={20}/>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Recurring Expenses</h3>
                <p className="text-xs text-slate-500">Monthly bills automatically generated</p>
              </div>
            </div>
            <button
              onClick={() => setShowRecurring(!showRecurring)}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all"
            >
              {showRecurring ? 'Hide' : 'Show'} ({recurringExpenses.length})
            </button>
          </div>
          {showRecurring && (
            <div className="space-y-2 pt-4 border-t border-slate-100">
              {recurringExpenses.map(recurring => {
                const startDate = new Date(recurring.startDate);
                const monthsSinceStart = Math.max(0, 
                  (new Date().getFullYear() - startDate.getFullYear()) * 12 + 
                  (new Date().getMonth() - startDate.getMonth()) + 1
                );
                return (
                  <div key={recurring.id} className="flex items-center justify-between p-4 bg-blue-50/50 rounded-xl border border-blue-100 group">
                    <div className="flex items-center gap-4">
                      {getCategoryIcon(recurring.category)}
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                          {recurring.description}
                          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase font-black">Recurring</span>
                        </h4>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold text-slate-500">€{recurring.monthlyAmount.toFixed(2)}/month</span>
                          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                            <Calendar size={10}/> Since {startDate.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
                          </span>
                          <span className="text-[10px] font-bold text-emerald-600">
                            {monthsSinceStart} month{monthsSinceStart !== 1 ? 's' : ''} generated
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingRecurring(recurring);
                          setNewRecurring({
                            description: recurring.description,
                            monthlyAmount: recurring.monthlyAmount,
                            startDate: recurring.startDate,
                            category: recurring.category,
                          });
                          setCustomRecurringCategory(typeof recurring.category === 'string' && !CATEGORIES.find(c => c.id === recurring.category) ? recurring.category : '');
                          setIsRecurringModalOpen(true);
                        }}
                        className="p-2 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Edit recurring expense"
                      >
                        <Edit3 size={16}/>
                      </button>
                      <button
                        onClick={() => {
                          const clone: RecurringExpense = {
                            ...recurring,
                            id: `recurring-${Date.now()}`,
                            lastGeneratedDate: undefined,
                          };
                          onAddRecurringExpense(clone);
                        }}
                        className="p-2 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Copy recurring expense"
                      >
                        <Copy size={16}/>
                      </button>
                      <button 
                        onClick={() => onDeleteRecurringExpense(recurring.id)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Delete recurring expense"
                      >
                        <Trash2 size={16}/>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-6 space-y-6">
         <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:max-w-md">
               <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
               <input 
                 type="text" 
                 placeholder="Search expenses..." 
                 className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:bg-white focus:border-slate-300 transition-all font-bold text-sm"
                 value={searchTerm}
                 onChange={e => setSearchTerm(e.target.value)}
               />
            </div>
            <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
               <button 
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedCategory === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
               >
                  All
               </button>
               {CATEGORIES.map(cat => (
                  <button 
                     key={cat.id}
                     onClick={() => setSelectedCategory(cat.id)}
                     className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedCategory === cat.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                  >
                     {cat.label}
                  </button>
               ))}
            </div>
         </div>

         <div className="space-y-3">
            {filteredExpenses.length > 0 ? filteredExpenses.map(expense => (
               <div key={expense.id} className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100 group">
                  <div className="flex items-center gap-4">
                     {getCategoryIcon(expense.category)}
                     <div>
                        <h4 className="font-bold text-slate-900 text-sm">{expense.description}</h4>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded uppercase">{expense.category}</span>
                           <span className="text-[10px] font-bold text-slate-300 flex items-center gap-1"><Calendar size={10}/> {expense.date}</span>
                           {expense.recurringExpenseId && (
                              <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase font-black flex items-center gap-1">
                                 <Sparkles size={8}/> Auto
                              </span>
                           )}
                        </div>
                     </div>
                  </div>
                  <div className="flex items-center gap-3">
                     <span className="font-black text-slate-900 mr-2">€{expense.amount.toFixed(2)}</span>
                     <button
                        onClick={() => {
                          setEditingExpense(expense);
                          setNewExpense({
                            description: expense.description,
                            amount: expense.amount,
                            date: expense.date,
                            category: expense.category,
                          });
                          setCustomCategory(typeof expense.category === 'string' && !CATEGORIES.find(c => c.id === expense.category) ? expense.category : '');
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Edit expense"
                     >
                        <Edit3 size={16}/>
                     </button>
                     <button
                        onClick={() => {
                          const clone: Expense = {
                            ...expense,
                            id: `exp-${Date.now()}`,
                            // keep date & category; treat as normal manual expense
                            recurringExpenseId: expense.recurringExpenseId,
                          };
                          onAddExpense(clone);
                        }}
                        className="p-2 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Copy expense"
                     >
                        <Copy size={16}/>
                     </button>
                     <button 
                        onClick={() => onDeleteExpense(expense.id)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Delete expense"
                     >
                        <Trash2 size={16}/>
                     </button>
                  </div>
               </div>
            )) : (
               <div className="py-20 text-center opacity-40">
                  <Wallet size={48} className="mx-auto mb-3 text-slate-300"/>
                  <p className="font-bold text-slate-400">No expenses found</p>
               </div>
            )}
         </div>
      </div>

      {isModalOpen && (
         <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-[3rem] shadow-2xl p-8 space-y-6">
               <div className="flex justify-between items-center">
                  <h3 className="text-2xl font-black text-slate-900">{editingExpense ? 'Edit Expense' : 'New Expense'}</h3>
                  <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-900"/></button>
               </div>

               <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                     <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Description</label>
                        <input 
                           autoFocus
                           className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm"
                           placeholder="e.g. 50x Shipping Boxes"
                           value={newExpense.description}
                           onChange={e => setNewExpense({...newExpense, description: e.target.value})}
                        />
                     </div>
                     
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Amount (€)</label>
                           <input 
                              type="number"
                              step="0.01"
                              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-black text-lg"
                              value={newExpense.amount || ''}
                              onChange={e => setNewExpense({...newExpense, amount: parseFloat(e.target.value)})}
                           />
                        </div>
                        <div>
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Date</label>
                           <input 
                              type="date"
                              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm"
                              value={newExpense.date}
                              onChange={e => setNewExpense({...newExpense, date: e.target.value})}
                           />
                        </div>
                     </div>

                     <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Category</label>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                           {CATEGORIES.map(cat => (
                              <button
                                 type="button"
                                 key={cat.id}
                                 onClick={() => {
                                   setNewExpense({...newExpense, category: cat.id});
                                   setCustomCategory('');
                                 }}
                                 className={`p-3 rounded-xl border text-[10px] font-black uppercase flex items-center gap-2 transition-all ${newExpense.category === cat.id && !customCategory ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'}`}
                              >
                                 {cat.icon} {cat.label}
                              </button>
                           ))}
                           <div className="col-span-2 space-y-1 mt-2">
                             <label className="text-[9px] font-black uppercase text-slate-400 ml-2 tracking-widest">Custom Category</label>
                             <input
                               type="text"
                               className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                               placeholder="e.g. Health, Phone, Rent..."
                               value={customCategory}
                               onChange={e => {
                                 const val = e.target.value;
                                 setCustomCategory(val);
                                 if (val.trim()) {
                                   setNewExpense(prev => ({ ...prev, category: val }));
                                 }
                               }}
                             />
                           </div>
                        </div>
                     </div>
                  </div>

                  <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-blue-700 transition-all">
                     {editingExpense ? 'Save Changes' : 'Log Expense'}
                  </button>
               </form>
            </div>
         </div>
      )}

      {isRecurringModalOpen && (
         <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-[3rem] shadow-2xl p-8 space-y-6">
               <div className="flex justify-between items-center">
                  <div>
                     <h3 className="text-2xl font-black text-slate-900">{editingRecurring ? 'Edit Recurring Expense' : 'New Recurring Expense'}</h3>
                     <p className="text-xs text-slate-500 mt-1">Monthly bills that auto-generate expenses</p>
                  </div>
                  <button onClick={() => setIsRecurringModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-900"/></button>
               </div>

               <form onSubmit={handleSubmitRecurring} className="space-y-6">
                  <div className="space-y-4">
                     <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Description</label>
                        <input 
                           autoFocus
                           className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm"
                           placeholder="e.g. Health Insurance, Phone Bill"
                           value={newRecurring.description}
                           onChange={e => setNewRecurring({...newRecurring, description: e.target.value})}
                        />
                     </div>
                     
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Monthly Amount (€)</label>
                           <input 
                              type="number"
                              step="0.01"
                              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-black text-lg"
                              value={newRecurring.monthlyAmount || ''}
                              onChange={e => setNewRecurring({...newRecurring, monthlyAmount: parseFloat(e.target.value)})}
                           />
                        </div>
                        <div>
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Start Date</label>
                           <input 
                              type="date"
                              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm"
                              value={newRecurring.startDate}
                              onChange={e => setNewRecurring({...newRecurring, startDate: e.target.value})}
                           />
                        </div>
                     </div>

                     <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Category</label>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                           {CATEGORIES.map(cat => (
                              <button
                                 type="button"
                                 key={cat.id}
                                 onClick={() => {
                                   setNewRecurring({...newRecurring, category: cat.id});
                                   setCustomRecurringCategory('');
                                 }}
                                 className={`p-3 rounded-xl border text-[10px] font-black uppercase flex items-center gap-2 transition-all ${newRecurring.category === cat.id && !customRecurringCategory ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'}`}
                              >
                                 {cat.icon} {cat.label}
                              </button>
                           ))}
                           <div className="col-span-2 space-y-1 mt-2">
                             <label className="text-[9px] font-black uppercase text-slate-400 ml-2 tracking-widest">Custom Category</label>
                             <input
                               type="text"
                               className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                               placeholder="e.g. Health, Phone, Rent..."
                               value={customRecurringCategory}
                               onChange={e => {
                                 const val = e.target.value;
                                 setCustomRecurringCategory(val);
                                 if (val.trim()) {
                                   setNewRecurring(prev => ({ ...prev, category: val as ExpenseCategory }));
                                 }
                               }}
                             />
                           </div>
                        </div>
                     </div>

                     <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-blue-800">
                           <Repeat size={12} className="inline mr-1"/> 
                           Expenses will be automatically generated for each month from the start date to today, 
                           and will continue generating monthly going forward.
                        </p>
                     </div>
                  </div>

                  <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-blue-700 transition-all">
                     {editingRecurring ? 'Save Changes' : 'Create Recurring Expense'}
                  </button>
               </form>
            </div>
         </div>
      )}
    </div>
  );
};

export default ExpenseManager;
