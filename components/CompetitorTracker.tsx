
import React, { useState, useEffect } from 'react';
import { Swords, Plus, Trash2, Globe, Search, RefreshCcw, ExternalLink, TrendingUp, AlertCircle, ShoppingCart } from 'lucide-react';
import { Competitor, Platform } from '../types';
import { analyzeCompetitor } from '../services/geminiService';

const CompetitorTracker: React.FC = () => {
  const [competitors, setCompetitors] = useState<Competitor[]>(() => {
    const saved = localStorage.getItem('competitor_data');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('competitor_data', JSON.stringify(competitors));
  }, [competitors]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompetitorName.trim()) return;
    
    const newComp: Competitor = {
      id: `comp-${Date.now()}`,
      name: newCompetitorName.trim(),
      platform: 'ebay.de',
      observedItems: []
    };
    
    setCompetitors(prev => [...prev, newComp]);
    setNewCompetitorName('');
  };

  const handleDelete = (id: string) => {
    setCompetitors(prev => prev.filter(c => c.id !== id));
  };

  const handleScan = async (competitor: Competitor) => {
    setLoadingId(competitor.id);
    try {
      const result = await analyzeCompetitor(competitor.name);
      if (result) {
        setCompetitors(prev => prev.map(c => 
          c.id === competitor.id ? { 
            ...c, 
            lastCheck: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
            aiAnalysis: result.analysis,
            observedItems: result.items || []
          } : c
        ));
      } else {
        alert("AI could not find data for this seller.");
      }
    } catch (e) {
      alert("Error scanning competitor.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-32 animate-in fade-in">
      <header className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Swords size={32} className="text-indigo-600"/> Rival Tracker
          </h1>
          <p className="text-slate-500 font-medium mt-1">Monitor competitor pricing strategies on eBay.de</p>
        </div>
      </header>

      {/* ADD BAR */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
         <form onSubmit={handleAdd} className="flex gap-4 items-center">
            <div className="relative flex-1">
               <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20}/>
               <input 
                  type="text" 
                  placeholder="Enter eBay Seller ID (e.g. 'hardware-pro-de')"
                  className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-indigo-50 transition-all"
                  value={newCompetitorName}
                  onChange={e => setNewCompetitorName(e.target.value)}
               />
            </div>
            <button type="submit" className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2">
               <Plus size={16}/> Track Rival
            </button>
         </form>
      </div>

      {/* GRID */}
      {competitors.length === 0 ? (
         <div className="text-center py-20 opacity-40">
            <Swords size={64} className="mx-auto mb-4 text-slate-300"/>
            <p className="font-bold text-slate-400">No competitors tracked yet.</p>
         </div>
      ) : (
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {competitors.map(comp => (
               <div key={comp.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
                  <div className="flex justify-between items-start mb-6 relative z-10">
                     <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xl shadow-inner">
                           {comp.name.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                           <h3 className="text-xl font-black text-slate-900">{comp.name}</h3>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                              <Globe size={10}/> {comp.platform}
                           </p>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        <a 
                           href={`https://www.ebay.de/usr/${comp.name}`} 
                           target="_blank" 
                           rel="noopener noreferrer"
                           className="p-3 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                           title="Visit Store"
                        >
                           <ExternalLink size={18}/>
                        </a>
                        <button 
                           onClick={() => handleDelete(comp.id)}
                           className="p-3 bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                           <Trash2 size={18}/>
                        </button>
                     </div>
                  </div>

                  {comp.aiAnalysis ? (
                     <div className="space-y-6 relative z-10">
                        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                           <p className="text-xs text-slate-600 leading-relaxed italic">"{comp.aiAnalysis}"</p>
                           <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between items-center">
                              <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Last Intel: {comp.lastCheck}</span>
                           </div>
                        </div>

                        <div className="space-y-3">
                           <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                              <ShoppingCart size={12}/> Recent Listings
                           </h4>
                           {comp.observedItems && comp.observedItems.length > 0 ? (
                              <div className="space-y-2">
                                 {comp.observedItems.map((item, idx) => {
                                    if (!item) return null;
                                    return (
                                      <div key={idx} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-lg transition-colors">
                                         <span className="font-bold text-slate-700 truncate max-w-[70%]">{item.title}</span>
                                         <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{typeof item.price === 'number' ? `€${Number(item.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : item.price}</span>
                                      </div>
                                    );
                                 })}
                              </div>
                           ) : (
                              <p className="text-xs text-slate-400 italic">No items found in last scan.</p>
                           )}
                        </div>
                        
                        <button 
                           onClick={() => handleScan(comp)}
                           disabled={loadingId === comp.id}
                           className="w-full py-4 bg-white border-2 border-indigo-100 text-indigo-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
                        >
                           {loadingId === comp.id ? <RefreshCcw size={14} className="animate-spin"/> : <RefreshCcw size={14}/>}
                           {loadingId === comp.id ? 'Scanning...' : 'Update Intel'}
                        </button>
                     </div>
                  ) : (
                     <div className="py-8 text-center space-y-4 relative z-10">
                        <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                           <Search size={24} className="text-indigo-400"/>
                        </div>
                        <p className="text-xs font-bold text-slate-400 max-w-xs mx-auto">No data analyzed yet. Scan this seller to reveal pricing strategy and inventory.</p>
                        <button 
                           onClick={() => handleScan(comp)}
                           disabled={loadingId === comp.id}
                           className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg"
                        >
                           {loadingId === comp.id ? 'Scanning...' : 'Start Scan'}
                        </button>
                     </div>
                  )}
                  
                  {/* Decorative Background Icon */}
                  <div className="absolute -bottom-6 -right-6 text-slate-50 opacity-50 transform -rotate-12 group-hover:scale-110 transition-transform duration-700 pointer-events-none">
                     <Swords size={180}/>
                  </div>
               </div>
            ))}
         </div>
      )}
    </div>
  );
};

export default CompetitorTracker;
