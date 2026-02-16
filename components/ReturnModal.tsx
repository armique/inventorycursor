
import React, { useState } from 'react';
import { X, RotateCcw, AlertTriangle, Check, ArrowDown, Wallet } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';

interface Props {
  items: InventoryItem[];
  onConfirm: (updatedItems: InventoryItem[]) => void;
  onClose: () => void;
}

const ReturnModal: React.FC<Props> = ({ items, onConfirm, onClose }) => {
  const [hasFee, setHasFee] = useState(false);
  const [totalFee, setTotalFee] = useState<string>('');

  const handleSave = () => {
    const feeAmount = hasFee ? parseFloat(totalFee) : 0;
    const feePerItem = items.length > 0 ? feeAmount / items.length : 0;

    const updatedItems = items.map(item => {
      // Calculate new cost basis
      const newBuyPrice = item.buyPrice + feePerItem;
      
      // Append note about return to internal comments
      const returnNote = feeAmount > 0 
        ? ` [Returned ${new Date().toLocaleDateString()}: +€${feePerItem.toFixed(2)} cost]` 
        : ` [Returned ${new Date().toLocaleDateString()}]`;

      return {
        ...item,
        status: ItemStatus.IN_STOCK,
        buyPrice: parseFloat(newBuyPrice.toFixed(2)), // Increase cost by fee
        sellPrice: undefined,
        sellDate: undefined,
        profit: undefined,
        platformSold: undefined,
        paymentType: undefined,
        feeAmount: undefined,
        hasFee: false,
        comment2: (item.comment2 || '') + returnNote,
        // Keep invoice number if you want a record, or clear it. 
        // Usually better to keep history or clear if generating credit note. 
        // Clearing here for fresh start:
        invoiceNumber: undefined, 
        customer: undefined
      };
    });

    onConfirm(updatedItems);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-amber-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
              <RotateCcw size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Process Return</h2>
              <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest mt-1">Restock {items.length} Item{items.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400"><X size={24} /></button>
        </header>

        <div className="p-8 space-y-6">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs text-slate-500 leading-relaxed">
            <p><span className="font-bold text-slate-700">Action:</span> Selected items will be moved back to <span className="font-bold text-blue-600">Active Inventory</span>.</p>
            <p className="mt-1">Sales data (Price, Date, Profit) will be cleared.</p>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-3 p-4 border border-slate-200 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all group">
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${hasFee ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 bg-white'}`}>
                {hasFee && <Check size={14} />}
              </div>
              <input type="checkbox" className="hidden" checked={hasFee} onChange={e => setHasFee(e.target.checked)} />
              <div className="flex-1">
                <p className="font-bold text-slate-900 text-sm">Fee Paid? (Return Label, Penalty)</p>
                <p className="text-[10px] text-slate-400">Cost will be added to item's buy price</p>
              </div>
            </label>

            {hasFee && (
              <div className="animate-in slide-in-from-top-2 fade-in">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest mb-1 block">Total Fee Amount (€)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">€</span>
                  <input 
                    autoFocus
                    type="number" 
                    step="0.01" 
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-4 bg-white border-2 border-amber-100 rounded-2xl outline-none focus:border-amber-400 font-black text-xl text-slate-900"
                    value={totalFee}
                    onChange={e => setTotalFee(e.target.value)}
                  />
                </div>
                {items.length > 1 && totalFee && (
                  <p className="text-[10px] text-amber-600 font-bold mt-2 text-right flex items-center justify-end gap-1">
                    <ArrowDown size={10}/> +€{(parseFloat(totalFee) / items.length).toFixed(2)} added to each item
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-slate-500 hover:bg-white hover:text-slate-800 rounded-2xl transition-all">Cancel</button>
          <button 
            onClick={handleSave} 
            className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-black transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} /> Confirm Restock
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ReturnModal;
