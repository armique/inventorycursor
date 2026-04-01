import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, Wallet, Settings, X } from 'lucide-react';
import { InventoryItem, Expense, BusinessSettings } from '../types';
import { formatEUR } from '../utils/formatMoney';

interface Props {
  items: InventoryItem[];
  expenses: Expense[];
  businessSettings: BusinessSettings;
  onClose?: () => void;
}

const MAX_RESULTS = 5;

function matches(text: string, q: string): boolean {
  if (!q.trim()) return false;
  return text.toLowerCase().includes(q.toLowerCase());
}

const GlobalSearch: React.FC<Props> = ({ items, expenses, businessSettings, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return { items: [] as InventoryItem[], expenses: [] as Expense[], settings: false };

    const itemMatches = items.filter(
      (i) =>
        matches(i.name, q) ||
        matches(i.category, q) ||
        matches(i.subCategory || '', q) ||
        matches(i.vendor || '', q) ||
        matches(i.comment1 || '', q) ||
        matches(i.comment2 || '', q)
    );
    const expenseMatches = expenses.filter(
      (e) => matches(e.description, q) || matches(e.category, q)
    );
    const settingsMatch =
      matches(businessSettings.companyName || '', q) ||
      matches(businessSettings.ownerName || '', q) ||
      matches(businessSettings.address || '', q);

    return {
      items: itemMatches.slice(0, MAX_RESULTS),
      expenses: expenseMatches.slice(0, MAX_RESULTS),
      settings: settingsMatch,
    };
  }, [query, items, expenses, businessSettings]);

  const hasResults =
    results.items.length > 0 || results.expenses.length > 0 || results.settings;

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (containerRef.current?.contains(el)) return;
      setIsOpen(false);
      onClose?.();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen, onClose]);

  const handleSelectItem = (item: InventoryItem) => {
    navigate(`/panel/edit/${item.id}`);
    setIsOpen(false);
    setQuery('');
  };

  const handleSelectExpense = () => {
    navigate(`/panel/expenses?q=${encodeURIComponent(query.trim())}`);
    setIsOpen(false);
    setQuery('');
  };

  const handleSelectSettings = () => {
    navigate('/panel/settings');
    setIsOpen(false);
    setQuery('');
  };

  const handleInventoryResults = () => {
    navigate(`/panel/inventory?q=${encodeURIComponent(query.trim())}`);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search inventory, expenses…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-[200] rounded-xl border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
          {!hasResults ? (
            <p className="px-4 py-4 text-sm text-slate-400">No matches</p>
          ) : (
            <div className="py-2 max-h-80 overflow-y-auto">
              {results.items.length > 0 && (
                <div className="px-2 py-1">
                  <p className="px-2 py-1 text-[10px] font-black uppercase text-slate-500 tracking-wider">Inventory</p>
                  {results.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-left"
                    >
                      <Package size={14} className="text-slate-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}</p>
                      </div>
                    </button>
                  ))}
                  {results.items.length >= MAX_RESULTS && (
                    <button
                      type="button"
                      onClick={handleInventoryResults}
                      className="w-full px-3 py-2 text-xs text-brand-400 hover:bg-slate-800 rounded-lg text-left"
                    >
                      View all inventory results →
                    </button>
                  )}
                </div>
              )}
              {results.expenses.length > 0 && (
                <div className="px-2 py-1 border-t border-slate-800">
                  <p className="px-2 py-1 text-[10px] font-black uppercase text-slate-500 tracking-wider">Expenses</p>
                  {results.expenses.map((exp) => (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={handleSelectExpense}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-left"
                    >
                      <Wallet size={14} className="text-slate-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">{exp.description}</p>
                        <p className="text-[10px] text-slate-400">€{formatEUR(exp.amount)} · {exp.category}</p>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleSelectExpense}
                    className="w-full px-3 py-2 text-xs text-brand-400 hover:bg-slate-800 rounded-lg text-left"
                  >
                    Open expenses →
                  </button>
                </div>
              )}
              {results.settings && (
                <div className="px-2 py-1 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleSelectSettings}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-left"
                  >
                    <Settings size={14} className="text-slate-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">Settings</p>
                      <p className="text-[10px] text-slate-400 truncate">{businessSettings.companyName || businessSettings.ownerName || 'Business settings'}</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
