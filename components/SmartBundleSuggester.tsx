
import React, { useState } from 'react';
import { Package, Sparkles, Check, ArrowRight, Loader2, Info } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { getBundleSuggestions, BundleSuggestion } from '../services/geminiService';
import ItemThumbnail from './ItemThumbnail';

interface Props {
  items: InventoryItem[];
  onCreateBundle: (newBundle: InventoryItem, componentIds: string[]) => void;
}

const SmartBundleSuggester: React.FC<Props> = ({ items, onCreateBundle }) => {
  const [suggestions, setSuggestions] = useState<BundleSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Calculate stats for orphans
  const orphans = items.filter(i => {
    if (i.status !== 'In Stock' || i.parentContainerId || i.isBundle || i.isPC) return false;
    const age = (new Date().getTime() - new Date(i.buyDate).getTime()) / (1000 * 60 * 60 * 24);
    return age > 30;
  });

  const handleAnalyze = async () => {
    setLoading(true);
    setSuggestions([]);
    setHasSearched(true);
    try {
      const results = await getBundleSuggestions(items);
      setSuggestions(results);
    } catch (e) {
      console.error("Bundle analysis failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = (suggestion: BundleSuggestion) => {
    const components = items.filter(i => suggestion.componentIds.includes(i.id));
    if (components.length === 0) return;

    const totalCost = components.reduce((sum, i) => sum + i.buyPrice, 0);
    const bundleId = `bundle-${Date.now()}`;

    const newBundle: InventoryItem = {
      id: bundleId,
      name: suggestion.title,
      buyPrice: totalCost,
      buyDate: new Date().toISOString().split('T')[0],
      category: 'Bundle',
      subCategory: 'Smart Bundle',
      status: ItemStatus.IN_STOCK,
      comment1: `AI Suggested Bundle:\n${suggestion.reasoning}\n\nContents:\n${components.map(c => `+ ${c.name}`).join('\n')}`,
      comment2: '',
      isBundle: true,
      componentIds: components.map(c => c.id),
      vendor: 'AI Bundle'
    };

    onCreateBundle(newBundle, components.map(c => c.id));
    
    // Remove used suggestion from view
    setSuggestions(prev => prev.filter(s => s !== suggestion));
  };

  return (
    <div className="space-y-8 animate-in fade-in">
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Package size={140} />
        </div>
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="text-yellow-400" size={24} />
            <h2 className="text-3xl font-black tracking-tight">Smart Bundle Suggester</h2>
          </div>
          <p className="text-indigo-200 text-sm font-medium mb-8 leading-relaxed">
            AI analyzes your "Orphan" parts (older than 30 days) to find compatible, high-value combinations. 
            Clear stale inventory by grouping items that sell better together.
          </p>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={handleAnalyze} 
              disabled={loading || orphans.length < 2}
              className="px-8 py-4 bg-white text-indigo-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-xl disabled:opacity-50 flex items-center gap-3"
            >
              {loading ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}
              {loading ? 'AI Analyzing...' : 'Find Smart Bundles'}
            </button>
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300 bg-white/10 px-4 py-2 rounded-xl">
               <Package size={14}/> {orphans.length} Orphan Items Found
            </div>
          </div>
        </div>
      </div>

      {hasSearched && !loading && suggestions.length === 0 && (
        <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-[2rem] opacity-50">
           <Info size={48} className="mx-auto mb-4 text-slate-300"/>
           <p className="font-bold text-slate-500">No obvious bundles found.</p>
           <p className="text-xs text-slate-400 mt-1">Try adding more components to your inventory.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suggestions.map((suggestion, idx) => (
          <div key={idx} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-lg hover:shadow-xl transition-all group flex flex-col">
            <div className="mb-4">
              <div className="flex justify-between items-start mb-2">
                 <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest">
                    Est. Value €{suggestion.estimatedValue}
                 </span>
              </div>
              <h3 className="text-lg font-black text-slate-900 leading-tight">{suggestion.title}</h3>
              <p className="text-xs text-slate-500 mt-2 italic leading-relaxed">"{suggestion.reasoning}"</p>
            </div>

            <div className="space-y-2 mb-6 flex-1">
              {suggestion.componentIds.map(id => {
                const item = items.find(i => i.id === id);
                if (!item) return null;
                const age = Math.floor((new Date().getTime() - new Date(item.buyDate).getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <ItemThumbnail item={item} className="w-10 h-10 rounded-lg object-cover bg-white" size={40} useCategoryImage />
                    <div className="flex-1 min-w-0">
                       <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                       <p className="text-[9px] text-amber-600 font-black uppercase">{age} Days Old</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <button 
              onClick={() => handleCreate(suggestion)}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2 group-hover:scale-105"
            >
              Create Bundle <ArrowRight size={14}/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartBundleSuggester;
