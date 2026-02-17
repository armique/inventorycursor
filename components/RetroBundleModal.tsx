
import React, { useState, useEffect } from 'react';
import { X, Package, ArrowRight, CheckCircle2, Layers, Calendar, Edit2, Check, HelpCircle } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';

interface Props {
  items: InventoryItem[];
  onConfirm: (bundle: InventoryItem, updatedComponents: InventoryItem[]) => void;
  onClose: () => void;
}

const getSmartBundleName = (items: InventoryItem[]) => {
  const cpus = items.filter(i => i.category === 'Components' && i.subCategory === 'Processors' || i.category === 'Processors');
  const gpus = items.filter(i => i.category === 'Components' && i.subCategory === 'Graphics Cards' || i.category === 'Graphics Cards');
  const mobos = items.filter(i => i.category === 'Components' && i.subCategory === 'Motherboards' || i.category === 'Motherboards');
  const cases = items.filter(i => i.category === 'Components' && i.subCategory === 'Cases' || i.category === 'Cases');
  
  // Clean names helper
  const cleanName = (name: string) => name.replace(/(Intel|AMD|Core|Ryzen|NVIDIA|GeForce|Radeon|ASUS|MSI|Gigabyte)/gi, '').trim();

  // 1. Full PC
  if (cases.length > 0 && cpus.length > 0 && gpus.length > 0) {
     return `Gaming PC: ${cleanName(cpus[0].name)} + ${cleanName(gpus[0].name)}`;
  }
  
  // 2. Mobo Bundle
  if (cpus.length > 0 && mobos.length > 0) {
     return `Upgrade Bundle: ${cleanName(cpus[0].name)} + Mobo`;
  }
  
  // 3. GPU Farm
  if (gpus.length > 1) {
     return `GPU Bundle: ${gpus.length}x Graphics Cards`;
  }
  
  // 4. Fallback: Top Value Items
  const sortedByPrice = [...items].sort((a,b) => b.buyPrice - a.buyPrice);
  const topNames = sortedByPrice.slice(0, 2).map(i => i.name).join(' + ');
  return `Bundle: ${topNames}${items.length > 2 ? '...' : ''}`;
};

const RetroBundleModal: React.FC<Props> = ({ items, onConfirm, onClose }) => {
  const [bundleName, setBundleName] = useState(() => getSmartBundleName(items));
  
  // Calculate Totals - Strict Number Casting
  const totalBuy = items.reduce((sum, i) => sum + Number(i.buyPrice || 0), 0);
  const totalSell = items.reduce((sum, i) => sum + Number(i.sellPrice || 0), 0);
  const totalFees = items.reduce((sum, i) => sum + Number(i.feeAmount || 0), 0);
  const hasFees = items.some(i => i.hasFee);
  
  // Simple Profit (Before Tax)
  const margin = totalSell - totalBuy - totalFees;
  
  // Platform logic
  const platform = items[0]?.platformSold || 'Other';
  const payment = items[0]?.paymentType || 'Other';
  
  // Smart Date Logic
  const uniqueSellDates = Array.from(new Set(items.map(i => i.sellDate).filter(Boolean)));
  const initialSellDate = uniqueSellDates.length === 1 ? (uniqueSellDates[0] as string) : new Date().toISOString().split('T')[0];

  const [sellDate, setSellDate] = useState(initialSellDate);

  // Edit Modes
  const [isEditingSellDate, setIsEditingSellDate] = useState(false);

  const handleConfirm = () => {
    const bundleId = `bundle-${Date.now()}`;
    
    const newBundle: InventoryItem = {
      id: bundleId,
      name: bundleName,
      category: 'Bundle',
      subCategory: 'Retro Bundle',
      status: ItemStatus.SOLD, 
      buyPrice: totalBuy,
      sellPrice: totalSell,
      profit: margin, // Note: This is pre-tax profit. Dashboard calculates tax dynamically.
      feeAmount: totalFees,
      hasFee: hasFees,
      sellDate: sellDate,
      // No buyDate - bundles don't have buy dates, only their components do
      platformSold: platform,
      paymentType: payment,
      isBundle: true,
      componentIds: items.map(i => i.id),
      comment1: `Retroactive Bundle of ${items.length} items.`,
      comment2: '',
      vendor: 'Combined'
    };

    const updatedComponents = items.map(i => ({
      ...i,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: bundleId
    }));

    onConfirm(newBundle, updatedComponents);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
        
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center">
              <Layers size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Group into Bundle</h2>
              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest mt-1">{items.length} Items Selected</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400"><X size={24} /></button>
        </header>

        <div className="p-8 space-y-6 overflow-y-auto scrollbar-hide">
          <div className="space-y-2">
             <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Bundle Name</label>
             <input 
                autoFocus
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-indigo-500 transition-all"
                value={bundleName}
                onChange={e => setBundleName(e.target.value)}
                placeholder="e.g. Gaming PC Sale to John"
             />
          </div>

          <div className="grid grid-cols-1 gap-4">
             {/* SELL DATE */}
             <div 
                className="bg-slate-50 p-4 rounded-2xl border border-slate-100 cursor-pointer hover:border-indigo-200 transition-colors group"
                onDoubleClick={() => setIsEditingSellDate(true)}
             >
                <div className="flex justify-between items-center mb-1">
                   <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Sale Date</p>
                   {!isEditingSellDate && <Edit2 size={10} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"/>}
                </div>
                {isEditingSellDate ? (
                   <div className="flex items-center gap-2">
                      <input 
                         type="date" 
                         autoFocus
                         className="w-full bg-white border border-indigo-300 rounded-lg px-2 py-1 text-xs font-bold outline-none"
                         value={sellDate}
                         onChange={e => setSellDate(e.target.value)}
                         onBlur={() => setIsEditingSellDate(false)}
                         onKeyDown={e => e.key === 'Enter' && setIsEditingSellDate(false)}
                      />
                      <button onClick={() => setIsEditingSellDate(false)} className="text-emerald-500"><Check size={14}/></button>
                   </div>
                ) : (
                   <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Calendar size={14} className="text-slate-400"/>
                      {new Date(sellDate).toLocaleDateString()}
                   </div>
                )}
             </div>
          </div>

          {/* FINANCIAL SUMMARY */}
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-3">
             <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">Total Sold Price</span>
                <span className="font-mono text-xs font-bold text-slate-900">€{totalSell.toFixed(2)}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">Total Cost (Buy)</span>
                <span className="font-mono text-xs text-slate-900">-€{totalBuy.toFixed(2)}</span>
             </div>
             {totalFees > 0 && (
               <div className="flex justify-between items-center text-red-500">
                  <span className="text-xs font-bold">Aggregated Fees</span>
                  <span className="font-mono text-xs">-€{totalFees.toFixed(2)}</span>
               </div>
             )}
             <div className="h-px bg-slate-200 my-1"></div>
             <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-black text-slate-700">Net Profit</span>
                <div className="text-right">
                   <span className={`font-black text-xl ${margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      €{margin.toFixed(2)}
                   </span>
                   <p className="text-[9px] text-slate-400 font-medium">Pre-Tax</p>
                </div>
             </div>
          </div>

          <div className="flex items-start gap-2 bg-blue-50 p-3 rounded-xl">
             <HelpCircle size={14} className="text-blue-500 mt-0.5 shrink-0"/>
             <p className="text-[10px] text-blue-700 leading-tight">
                <strong>Note:</strong> Bundling merges margins. If you use <em>Differential Taxation</em>, this can correctly increase net profit by offsetting losses against gains before tax calculation.
             </p>
          </div>

          <div className="max-h-32 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
             {items.map(item => (
                <div key={item.id} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-lg">
                   <div className="flex flex-col">
                      <span className="font-medium text-slate-600 truncate max-w-[200px]">{item.name}</span>
                      {item.hasFee && item.feeAmount && <span className="text-[8px] text-red-400">Fee: €{item.feeAmount}</span>}
                   </div>
                   <div className="text-right">
                      <span className="font-bold text-slate-900">€{item.sellPrice?.toFixed(2)}</span>
                      <span className="text-[9px] text-slate-400 block">Buy: €{item.buyPrice}</span>
                   </div>
                </div>
             ))}
          </div>
        </div>

        <footer className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-slate-500 hover:bg-white hover:text-slate-800 rounded-2xl transition-all">Cancel</button>
          <button 
            onClick={handleConfirm} 
            className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            <Package size={16} /> Confirm Bundle
          </button>
        </footer>

      </div>
    </div>
  );
};

export default RetroBundleModal;
