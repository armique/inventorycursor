import React, { useMemo } from 'react';
import { X, Calculator, ArrowRight, TrendingUp, TrendingDown, BarChart3, Tag } from 'lucide-react';
import { formatEUR } from '../utils/formatMoney';
import type { InventoryItem } from '../types';
import { suggestBundleComponentPrices } from '../utils/bundlePriceRecalc';

interface Props {
  container: InventoryItem;
  allItems: InventoryItem[];
  onApply: (updates: Array<{ itemId: string; newSellPrice: number }>) => void;
  onClose: () => void;
}

/** Preview modal for redistributing a sold bundle/PC's total sell price across its components —
 * replaces a naive equal split with weights from the account's own Dealwatch data (or category
 * priors as a fallback). Mirrors RetroBundleModal's layout so the two feel like one feature. */
const ReinvestBundleRecalcModal: React.FC<Props> = ({ container, allItems, onApply, onClose }) => {
  const suggestions = useMemo(
    () => suggestBundleComponentPrices(container, allItems),
    [container, allItems],
  );

  const totalOld = suggestions.reduce((sum, s) => sum + (s.oldSellPrice ?? 0), 0);
  const totalNew = suggestions.reduce((sum, s) => sum + s.newSellPrice, 0);

  const handleApply = () => {
    onApply(suggestions.map((s) => ({ itemId: s.itemId, newSellPrice: s.newSellPrice })));
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
              <Calculator size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Recalculate Component Prices</h2>
              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mt-1">
                {suggestions.length} components · {container.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400">
            <X size={24} />
          </button>
        </header>

        <div className="p-8 space-y-6 overflow-y-auto scrollbar-hide">
          <div className="flex items-start gap-2 bg-blue-50 p-3 rounded-xl">
            <BarChart3 size={14} className="text-blue-500 mt-0.5 shrink-0" />
            <p className="text-[10px] text-blue-700 leading-tight">
              <strong>How it splits:</strong> each part's share comes from your own past sales of that exact
              variant when there's enough of it (2+ sales), otherwise a typical-value prior — GPUs and CPUs
              carry more of the total than RAM, storage, or a case. The total sell price stays the same,
              only how it's divided across parts changes.
            </p>
          </div>

          {suggestions.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 text-center py-6">
              Nothing to recalculate — this container has no priced components.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => {
                const old = s.oldSellPrice ?? 0;
                const delta = s.newSellPrice - old;
                return (
                  <div key={s.itemId} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700 truncate">{s.name}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest mt-0.5 flex items-center gap-1">
                        {s.weightSource === 'dealwatch' ? (
                          <span className="text-emerald-600 flex items-center gap-1"><Tag size={9} /> Your own sales</span>
                        ) : (
                          <span className="text-slate-400 flex items-center gap-1"><Tag size={9} /> Typical value</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-slate-400">€{formatEUR(old)}</span>
                      <ArrowRight size={12} className="text-slate-300" />
                      <span className="font-mono text-sm font-black text-slate-900">€{formatEUR(s.newSellPrice)}</span>
                      {Math.abs(delta) >= 0.5 && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {delta > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {delta > 0 ? '+' : ''}
                          {formatEUR(delta)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500">Total (unchanged)</span>
            <span className="font-mono text-sm font-black text-slate-900">
              €{formatEUR(totalOld)} → €{formatEUR(totalNew)}
            </span>
          </div>
        </div>

        <footer className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-slate-500 hover:bg-white hover:text-slate-800 rounded-2xl transition-all">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={suggestions.length === 0}
            className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Calculator size={16} /> Apply New Prices
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ReinvestBundleRecalcModal;
