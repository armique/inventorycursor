
import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Plus, Trash2, Package, Wallet, ArrowRight, Search, Database, FileText, TrendingUp, TrendingDown, RefreshCcw } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { searchAllHardware, HardwareMetadata } from '../services/hardwareDB';
import ItemThumbnail, { CategoryIconBox } from './ItemThumbnail';

interface Props {
  item: InventoryItem;
  onSave: (updatedOriginal: InventoryItem, newItems: InventoryItem[]) => void;
  onClose: () => void;
}

interface IncomingItemDraft {
  id: string;
  name: string;
  estimatedValue: number;
  category: string;
}

const TradeModal: React.FC<Props> = ({ item, onSave, onClose }) => {
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cashDirection, setCashDirection] = useState<'IN' | 'OUT'>('IN'); // IN = You receive, OUT = You pay
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0]);
  const [tradeNote, setTradeNote] = useState('');
  const [incomingItems, setIncomingItems] = useState<IncomingItemDraft[]>([]);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HardwareMetadata[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Manual Form State
  const [newItemName, setNewItemName] = useState('');
  const [newItemValue, setNewItemValue] = useState<number>(0);
  const [newItemCategory, setNewItemCategory] = useState('PC Components');

  // Search Effect
  useEffect(() => {
    const delay = setTimeout(() => {
      if (searchQuery.length >= 2) {
        const results = searchAllHardware(searchQuery);
        setSearchResults(results);
        setShowResults(true);
      } else {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [searchQuery]);

  const handleAddFromSearch = (res: HardwareMetadata) => {
    // Map DB type to Category
    let category = 'PC Components';
    if (res.type) {
       if (['GPU', 'CPU', 'Motherboard', 'RAM', 'Storage', 'PSU', 'Case', 'Cooling'].includes(res.type)) category = 'PC Components';
       if (res.type === 'Laptop') category = 'Laptops';
       if (['Smartphone', 'Tablet'].includes(res.type)) category = 'Gadgets';
    }

    setIncomingItems(prev => [...prev, {
      id: `new-${Date.now()}-${Math.random()}`,
      name: `${res.vendor} ${res.model}`,
      estimatedValue: 0, // User must fill this
      category: category
    }]);
    setSearchQuery('');
    setShowResults(false);
  };

  const addManualItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName || newItemValue < 0) return;

    setIncomingItems(prev => [...prev, {
      id: `new-${Date.now()}`,
      name: newItemName,
      estimatedValue: newItemValue,
      category: newItemCategory
    }]);

    setNewItemName('');
    setNewItemValue(0);
  };

  const updateIncomingValue = (id: string, val: number) => {
    setIncomingItems(prev => prev.map(i => i.id === id ? { ...i, estimatedValue: val } : i));
  };

  const removeIncomingItem = (id: string) => {
    setIncomingItems(prev => prev.filter(i => i.id !== id));
  };

  // Calculations
  const totalIncomingValue = incomingItems.reduce((sum, i) => sum + i.estimatedValue, 0);
  const netCash = cashDirection === 'IN' ? cashAmount : -cashAmount;
  const totalTradeValue = totalIncomingValue + netCash;
  const projectedProfit = totalTradeValue - item.buyPrice;

  const handleConfirmTrade = () => {
    if (incomingItems.length === 0 && cashAmount === 0) {
      alert("Please add at least one item or cash to the trade.");
      return;
    }

    const noteSuffix = tradeNote ? `\n\n[Trade Context]: ${tradeNote}` : '';

    const newInventoryItems: InventoryItem[] = incomingItems.map(draft => ({
      id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: draft.name,
      buyPrice: draft.estimatedValue, // The cost basis is the value assigned during trade
      buyDate: tradeDate,
      category: draft.category,
      subCategory: draft.category,
      status: ItemStatus.IN_STOCK,
      comment1: `Acquired via trade from: ${item.name} (Value: €${draft.estimatedValue})${noteSuffix}`,
      comment2: '',
      vendor: 'Trade',
      tradedFromId: item.id
    }));

    const newIds = newInventoryItems.map(i => i.id);

    const updatedOriginal: InventoryItem = {
      ...item,
      status: ItemStatus.TRADED,
      sellPrice: totalTradeValue,
      sellDate: tradeDate,
      profit: projectedProfit,
      tradedForIds: newIds,
      cashOnTop: netCash,
      paymentType: 'Trade',
      comment2: (item.comment2 || '') + noteSuffix
    };

    onSave(updatedOriginal, newInventoryItems);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-6xl rounded-[3rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[95vh]">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <ArrowRightLeft size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Trade Asset</h2>
              <p className="text-[10px] text-purple-600 font-bold uppercase tracking-widest mt-1">Exchange & Barter Engine</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400">
            <X size={24} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row gap-8 items-stretch h-full">
            
            {/* LEFT: OUTGOING */}
            <div className="flex-1 space-y-6 flex flex-col">
              <div className="bg-red-50 rounded-[2.5rem] p-8 border border-red-100 flex-1 flex flex-col">
                <h3 className="text-xs font-black text-red-400 uppercase tracking-widest mb-6 flex items-center gap-2"><ArrowRight size={14}/> Outgoing (You Give)</h3>
                
                <div className="bg-white rounded-3xl p-5 border border-red-100 shadow-sm mb-6 flex gap-4 items-center">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 border border-slate-100">
                     <ItemThumbnail item={item} className="w-full h-full object-cover" size={64} />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-slate-900 leading-tight line-clamp-2">{item.name}</h4>
                    <p className="text-[10px] text-slate-500 font-bold mt-1 bg-slate-100 inline-block px-2 py-0.5 rounded">Orig. Cost: €{item.buyPrice}</p>
                  </div>
                </div>

                <div className="space-y-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-2 flex items-center gap-2"><FileText size={12}/> Trade Note / Context</label>
                      <textarea 
                        className="w-full px-5 py-4 rounded-2xl border border-red-100 font-medium text-xs outline-none focus:border-red-300 resize-none h-32 shadow-sm focus:ring-4 focus:ring-red-50 transition-all" 
                        placeholder="e.g. Swapped with a gamer from Munich for a laptop and cash..."
                        value={tradeNote}
                        onChange={e => setTradeNote(e.target.value)}
                      />
                   </div>

                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Trade Date</label>
                      <input type="date" className="w-full px-5 py-3 rounded-2xl border border-red-100 font-bold text-sm outline-none" value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
                   </div>
                </div>
              </div>
            </div>

            {/* MIDDLE: CASH */}
            <div className="flex flex-col justify-center gap-4 lg:w-48 shrink-0">
                <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-200 text-center space-y-4 shadow-inner">
                   <div className="w-12 h-12 bg-slate-200 text-slate-500 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                      <Wallet size={24} />
                   </div>
                   <p className="text-[10px] font-black uppercase text-slate-400">Cash Balance</p>
                   
                   <div className="flex bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
                      <button onClick={() => setCashDirection('IN')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex flex-col items-center gap-1 ${cashDirection === 'IN' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}>
                        <ArrowRight size={10} className="rotate-45"/> Get
                      </button>
                      <button onClick={() => setCashDirection('OUT')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex flex-col items-center gap-1 ${cashDirection === 'OUT' ? 'bg-red-500 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}>
                        <ArrowRight size={10} className="-rotate-45"/> Pay
                      </button>
                   </div>

                   <div className="relative">
                      <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black ${cashDirection === 'IN' ? 'text-emerald-500' : 'text-red-500'}`}>€</span>
                      <input 
                        type="number" 
                        className={`w-full pl-8 pr-4 py-3 bg-white border rounded-xl font-black text-xl outline-none text-center shadow-inner ${cashDirection === 'IN' ? 'border-emerald-200 text-emerald-900 focus:ring-2 focus:ring-emerald-200' : 'border-red-200 text-red-900 focus:ring-2 focus:ring-red-200'}`}
                        value={cashAmount}
                        onChange={e => setCashAmount(Number(e.target.value))}
                        placeholder="0"
                     />
                   </div>
                   <p className="text-[9px] font-bold text-slate-400 leading-tight">
                      {cashDirection === 'IN' ? 'You received cash on top' : 'You paid cash on top'}
                   </p>
                </div>
            </div>

            {/* RIGHT: INCOMING */}
            <div className="flex-1 space-y-6 flex flex-col">
               <div className="bg-emerald-50 rounded-[2.5rem] p-8 border border-emerald-100 flex-1 flex flex-col relative overflow-visible">
                  <h3 className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-6 flex items-center gap-2"><ArrowRightLeft size={14}/> Incoming (You Receive)</h3>
                  
                  {/* SEARCH BAR */}
                  <div className="relative mb-4 z-20 group">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 group-focus-within:text-emerald-600" size={18} />
                     <input 
                       type="text" 
                       placeholder="Database Search (e.g. '3060', 'iPad')..." 
                       className="w-full pl-12 pr-4 py-4 bg-white border border-emerald-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-emerald-100 transition-all placeholder:text-emerald-300/70 shadow-sm"
                       value={searchQuery}
                       onChange={e => setSearchQuery(e.target.value)}
                     />
                     {showResults && searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-emerald-100 overflow-hidden max-h-60 overflow-y-auto animate-in slide-in-from-top-2 z-50">
                           <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-black uppercase text-slate-400 tracking-widest">
                              Select Item to Add
                           </div>
                           {searchResults.map((res, idx) => (
                              <button key={idx} onClick={() => handleAddFromSearch(res)} className="w-full text-left px-5 py-3 hover:bg-emerald-50 border-b border-emerald-50 last:border-none flex items-center justify-between group transition-colors">
                                 <div>
                                    <p className="font-black text-xs text-slate-900">{res.vendor} {res.model}</p>
                                    <p className="text-[9px] text-slate-400 uppercase font-bold">{res.type} • {Object.keys(res.specs).length} specs</p>
                                 </div>
                                 <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Plus size={14} />
                                 </div>
                              </button>
                           ))}
                        </div>
                     )}
                  </div>

                  {/* LIST */}
                  <div className="space-y-3 mb-6 flex-1 overflow-y-auto max-h-[300px] scrollbar-hide pr-2">
                     {incomingItems.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center py-8 opacity-40 border-2 border-dashed border-emerald-200 rounded-3xl bg-emerald-50/50">
                           <Database size={40} className="mx-auto mb-3 text-emerald-700" />
                           <p className="text-xs font-bold text-emerald-800">No items added yet</p>
                           <p className="text-[10px] text-emerald-600">Use search or manual entry</p>
                        </div>
                     )}
                     {incomingItems.map(inc => (
                        <div key={inc.id} className="bg-white p-3 rounded-2xl flex items-center gap-3 shadow-sm border border-emerald-100/50 animate-in slide-in-from-right-2 group hover:border-emerald-200 transition-all">
                           <CategoryIconBox category={inc.category} className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 shrink-0 text-emerald-600" size={18} />
                           <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-900 text-xs truncate">{inc.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                 <span className="text-[8px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded uppercase border border-slate-100">{inc.category}</span>
                                 <div className="flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                                    <span className="text-[9px] text-emerald-600 font-bold">Val:</span>
                                    <input 
                                       type="number" 
                                       className="w-16 bg-transparent border-none rounded text-[10px] font-black p-0 text-right focus:ring-0 text-emerald-900 placeholder:text-emerald-300"
                                       value={inc.estimatedValue || ''}
                                       placeholder="0.00"
                                       onChange={e => updateIncomingValue(inc.id, parseFloat(e.target.value) || 0)}
                                    />
                                    <span className="text-[9px] text-emerald-600 font-bold">€</span>
                                 </div>
                              </div>
                           </div>
                           <button onClick={() => removeIncomingItem(inc.id)} className="p-2 text-slate-300 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all"><Trash2 size={14}/></button>
                        </div>
                     ))}
                  </div>

                  {/* MANUAL ADD */}
                  <form onSubmit={addManualItem} className="bg-white/80 p-3 rounded-2xl border border-emerald-100 space-y-2 mt-auto backdrop-blur-sm">
                     <p className="text-[9px] font-black uppercase text-emerald-600 ml-1">Manual Entry (Fallback)</p>
                     <div className="flex gap-2">
                        <input 
                           placeholder="Item Name..." 
                           className="flex-1 px-3 py-2 bg-white rounded-xl border border-emerald-100 text-xs font-bold outline-none focus:border-emerald-300 shadow-sm"
                           value={newItemName}
                           onChange={e => setNewItemName(e.target.value)}
                        />
                        <select 
                           className="w-28 px-2 py-2 bg-white rounded-xl border border-emerald-100 text-[10px] font-bold outline-none shadow-sm"
                           value={newItemCategory}
                           onChange={e => setNewItemCategory(e.target.value)}
                        >
                           {Object.keys(HIERARCHY_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button type="submit" className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-200"><Plus size={16}/></button>
                     </div>
                  </form>
               </div>
            </div>
          </div>
        </div>

        <footer className="p-8 bg-slate-50/50 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between shrink-0 gap-6">
           <div className="flex items-center gap-8 w-full md:w-auto">
              <div className="flex flex-col">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Trade Value</p>
                 <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-slate-900">€{totalTradeValue.toFixed(2)}</span>
                    <span className="text-[10px] font-bold text-slate-400">(Items + Cash)</span>
                 </div>
              </div>
              <div className="h-10 w-px bg-slate-200 hidden md:block"></div>
              <div className="flex flex-col">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Projected Result</p>
                 <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${projectedProfit >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                    {projectedProfit >= 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                    <span className="text-lg font-black">{projectedProfit >= 0 ? '+' : ''}€{projectedProfit.toFixed(2)}</span>
                 </div>
              </div>
           </div>
           
           <div className="flex gap-3 w-full md:w-auto">
              <button onClick={onClose} className="flex-1 md:flex-none px-8 py-4 font-bold text-slate-500 hover:bg-white hover:text-slate-800 rounded-2xl transition-all">Cancel</button>
              <button onClick={handleConfirmTrade} className="flex-1 md:flex-none px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3">
                 <RefreshCcw size={16} /> Confirm Deal
              </button>
           </div>
        </footer>
      </div>
    </div>
  );
};

export default TradeModal;
