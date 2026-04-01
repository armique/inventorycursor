import React, { useState, useMemo, useEffect } from 'react';
import { FileText, Check, Search, Receipt, Calendar, Info, CreditCard, Square, CheckSquare, Minus, CheckCircle } from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings } from '../types';
import { formatEUR } from '../utils/formatMoney';
import InvoiceGenerator from './InvoiceGenerator';

type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';

function getDateRangeForFilter(timeFilter: TimeFilter): { start: Date; end: Date } {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  let start = new Date(0);
  let end = new Date(now);

  switch (timeFilter) {
    case 'THIS_WEEK':
      const day = now.getDay() || 7;
      const weekStart = new Date(now);
      if (day !== 1) weekStart.setDate(now.getDate() - (day - 1));
      weekStart.setHours(0, 0, 0, 0);
      start = weekStart;
      break;
    case 'LAST_WEEK':
      start = new Date(now);
      start.setDate(now.getDate() - 7 - (now.getDay() || 7) + 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'THIS_MONTH':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'LAST_MONTH':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'LAST_30':
      start = new Date(now);
      start.setDate(now.getDate() - 30);
      break;
    case 'LAST_90':
      start = new Date(now);
      start.setDate(now.getDate() - 90);
      break;
    case 'THIS_YEAR':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'LAST_YEAR':
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      break;
  }
  return { start, end };
}

interface Props {
  items: InventoryItem[];
  businessSettings: BusinessSettings;
}

const InvoiceManager: React.FC<Props> = ({ items, businessSettings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => {
    const saved = localStorage.getItem('invoice_manager_time_filter');
    return (saved as TimeFilter) || 'ALL';
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [invoiceType, setInvoiceType] = useState<'FINAL' | 'PAYMENT_REQUEST'>('FINAL');

  useEffect(() => {
    localStorage.setItem('invoice_manager_time_filter', timeFilter);
  }, [timeFilter]);

  const dateRange = useMemo(() => getDateRangeForFilter(timeFilter), [timeFilter]);

  const soldItems = useMemo(() => {
    return items.filter(i => {
      if (i.status !== ItemStatus.SOLD && i.status !== ItemStatus.TRADED) return false;
      if (!i.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (timeFilter !== 'ALL') {
        const dateStr = i.sellDate;
        if (!dateStr) return false;
        const itemDate = new Date(dateStr);
        if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = a.sellDate || '';
      const db = b.sellDate || '';
      return db.localeCompare(da);
    });
  }, [items, searchTerm, timeFilter, dateRange]);

  const business = businessSettings;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectedIds.length === soldItems.length && soldItems.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(soldItems.map(i => i.id));
    }
  };

  const handleGenerate = (type: 'FINAL' | 'PAYMENT_REQUEST') => {
    if (selectedIds.length === 0) return;
    setInvoiceType(type);
    setShowGenerator(true);
  };

  const selectedItems = items.filter(i => selectedIds.includes(i.id));

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Invoice Engine</h1>
          <p className="text-sm text-slate-500 italic">Manage professional billing for pro-resellers</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
           <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                   <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="text" 
                     className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:bg-white focus:border-slate-900 font-bold transition-all"
                     placeholder="Filter sold assets..."
                     value={searchTerm}
                     onChange={e => setSearchTerm(e.target.value)}
                   />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                   <Calendar size={18} className="text-slate-400 shrink-0" />
                   <select
                     value={timeFilter}
                     onChange={e => setTimeFilter(e.target.value as TimeFilter)}
                     className="px-4 py-4 rounded-2xl bg-slate-50 border border-slate-100 font-bold text-sm text-slate-700 outline-none focus:bg-white focus:border-slate-300 min-w-[160px]"
                   >
                     <option value="ALL">All time</option>
                     <option value="THIS_WEEK">This week</option>
                     <option value="LAST_WEEK">Last week</option>
                     <option value="THIS_MONTH">This month</option>
                     <option value="LAST_MONTH">Last month</option>
                     <option value="LAST_30">Last 30 days</option>
                     <option value="LAST_90">Last 90 days</option>
                     <option value="THIS_YEAR">This year</option>
                     <option value="LAST_YEAR">Last year</option>
                   </select>
                </div>
                <button 
                  onClick={handleSelectAll}
                  className="px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-600 hover:bg-slate-100 transition-all flex items-center gap-2"
                >
                  {selectedIds.length === soldItems.length && soldItems.length > 0 ? (
                    <><CheckSquare size={16} className="text-blue-600" /> Deselect All</>
                  ) : selectedIds.length > 0 ? (
                    <><Minus size={16} className="text-blue-600" /> Select All</>
                  ) : (
                    <><Square size={16} /> Select All</>
                  )}
                </button>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto scrollbar-hide pr-2">
                 {soldItems.length > 0 ? soldItems.map(item => {
                   const isSelected = selectedIds.includes(item.id);
                   return (
                     <div 
                       key={item.id} 
                       onClick={() => toggleSelect(item.id)}
                       className={`p-5 rounded-3xl border transition-all cursor-pointer flex items-center justify-between group ${isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-xl translate-x-1' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                     >
                        <div className="flex items-center gap-4">
                           <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-white/20' : 'bg-slate-50'}`}>
                              <Receipt size={20} className={isSelected ? 'text-white' : 'text-slate-400'} />
                           </div>
                           <div>
                              <p className="text-sm font-black truncate max-w-xs">{item.name}</p>
                              <p className={`text-[10px] font-black uppercase tracking-widest ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                                €{item.sellPrice != null ? formatEUR(item.sellPrice) : '—'} • Sold on {item.sellDate}
                              </p>
                           </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-white border-white text-blue-600' : 'border-slate-200'}`}>
                           {isSelected && <Check size={14} />}
                        </div>
                     </div>
                   );
                 }) : (
                   <div className="py-20 text-center opacity-30 italic">No sold items found</div>
                 )}
              </div>
           </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
           <div className="bg-slate-900 p-8 rounded-[3rem] text-white space-y-6 shadow-2xl">
              <h3 className="font-black text-xl flex items-center gap-3"><FileText className="text-blue-400" /> Billing Actions</h3>
              
              {selectedIds.length > 0 ? (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                   <div className="p-4 bg-white/10 rounded-2xl border border-white/10 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selected Total</p>
                      <p className="text-2xl font-black text-blue-400">€{formatEUR(selectedItems.reduce((acc, i) => acc + (i.sellPrice || 0), 0))}</p>
                      <p className="text-xs font-bold text-slate-500">{selectedIds.length} position(s)</p>
                   </div>

                   <div className="space-y-2">
                      <button 
                        onClick={() => handleGenerate('FINAL')}
                        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                      >
                         <Receipt size={16}/> Final Invoice (Rechnung)
                      </button>
                      <button 
                        onClick={() => handleGenerate('PAYMENT_REQUEST')}
                        className="w-full py-4 bg-white/10 text-white border border-white/20 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2"
                      >
                         <CreditCard size={16}/> Request Payment (Vorkasse)
                      </button>
                   </div>
                   <button onClick={() => setSelectedIds([])} className="w-full text-center text-slate-500 text-[9px] font-black uppercase tracking-widest hover:text-white">Clear Selection</button>
                </div>
              ) : (
                <div className="space-y-4 opacity-50">
                   <div className="flex items-center gap-3 p-4 border border-dashed border-white/10 rounded-2xl">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-blue-400"><Info size={16}/></div>
                      <p className="text-xs italic leading-tight">Select one or more items from the list to start generating a professional document.</p>
                   </div>
                </div>
              )}
           </div>

           <div className="bg-white p-8 rounded-[3rem] border border-slate-100 space-y-4">
              <h4 className="font-black text-xs uppercase tracking-widest text-slate-400">Tax Mode Active</h4>
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center"><CheckCircle size={20}/></div>
                 <div>
                    <p className="text-sm font-black text-slate-900">{business.taxMode === 'SmallBusiness' ? 'Kleinunternehmer (§19)' : business.taxMode === 'DifferentialVAT' ? 'Differenzbesteuerung (§25a)' : 'Regular VAT (19%)'}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Status confirmed</p>
                 </div>
              </div>
           </div>
        </div>
      </div>

      {showGenerator && (
        <InvoiceGenerator 
          items={selectedItems} 
          business={business} 
          type={invoiceType}
          onClose={() => setShowGenerator(false)} 
        />
      )}
    </div>
  );
};

export default InvoiceManager;
