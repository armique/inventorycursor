
import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, ExternalLink, RefreshCcw, Bell, ArrowRight, X, Clock, MapPin, Euro, Loader2, Link as LinkIcon, Power, Play } from 'lucide-react';
import { executeSavedSearch, SavedSearchCriteria, LiveDeal } from '../services/geminiService';

interface SavedSearch extends SavedSearchCriteria {
  id: string; // Ensure ID is present
  results: LiveDeal[];
  newResultCount: number;
}

interface Props {
  searches?: SavedSearch[];
  onUpdate?: (searches: SavedSearch[]) => void;
}

const SavedSearches: React.FC<Props> = ({ searches = [], onUpdate }) => {
  // Use props, default to empty array if undefined
  
  // Background Check State
  const [isAutoCheckActive, setIsAutoCheckActive] = useState(() => localStorage.getItem('auto_check_active') === 'true');
  const [lastAutoCheck, setLastAutoCheck] = useState<string | null>(localStorage.getItem('last_auto_check'));
  const [autoCheckCountdown, setAutoCheckCountdown] = useState<number>(0);
  
  // State for Selection & UI
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingSearchId, setLoadingSearchId] = useState<string | null>(null);
  
  // New Search Form State
  const [isCreating, setIsCreating] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [newMaxPrice, setNewMaxPrice] = useState<string>('');
  const [newCustomUrl, setNewCustomUrl] = useState('');
  const [includeEbay, setIncludeEbay] = useState(false);

  useEffect(() => {
    localStorage.setItem('auto_check_active', String(isAutoCheckActive));
  }, [isAutoCheckActive]);

  useEffect(() => {
    if (lastAutoCheck) localStorage.setItem('last_auto_check', lastAutoCheck);
  }, [lastAutoCheck]);

  // --- AUTOMATIC BACKGROUND CHECKER ---
  useEffect(() => {
    let interval: any;
    let timer: any;

    if (isAutoCheckActive) {
      // Run immediately if never run or > 30 mins ago
      const now = Date.now();
      const last = lastAutoCheck ? parseInt(lastAutoCheck) : 0;
      const diff = now - last;
      const checkInterval = 30 * 60 * 1000; // 30 mins

      if (diff > checkInterval) {
        runAutoCheckBatch();
      } else {
        setAutoCheckCountdown(Math.ceil((checkInterval - diff) / 60000));
      }

      interval = setInterval(() => {
        runAutoCheckBatch();
      }, checkInterval); 

      // Update countdown UI every minute
      timer = setInterval(() => {
         const currentDiff = Date.now() - (lastAutoCheck ? parseInt(lastAutoCheck) : 0);
         const remaining = Math.max(0, Math.ceil((checkInterval - currentDiff) / 60000));
         setAutoCheckCountdown(remaining);
      }, 60000);
    }

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [isAutoCheckActive, lastAutoCheck, searches]); 

  const updateSearches = (newSearches: SavedSearch[]) => {
    if (onUpdate) onUpdate(newSearches);
  };

  const runAutoCheckBatch = async () => {
    if (searches.length === 0) return;
    setLoadingSearchId('AUTO'); 
    
    // Create a copy to update
    let updatedSearches = [...searches];

    for (let i = 0; i < updatedSearches.length; i++) {
       const search = updatedSearches[i];
       try {
          const results = await executeSavedSearch(search);
          const oldUrls = search.results.map(r => r.url);
          const newItems = results.filter(r => !oldUrls.includes(r.url));
          
          updatedSearches[i] = {
             ...search,
             results,
             lastRun: new Date().toISOString(),
             newResultCount: search.newResultCount + newItems.length
          };
       } catch (e) { console.error(e); }
       await new Promise(r => setTimeout(r, 2000));
    }
    
    updateSearches(updatedSearches);
    const nowStr = Date.now().toString();
    setLastAutoCheck(nowStr);
    setLoadingSearchId(null);
    setAutoCheckCountdown(30);
  };

  const selectedSearch = searches.find(s => s.id === selectedId);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuery.trim()) return;

    const newSearch: SavedSearch = {
      id: `search-${Date.now()}`,
      query: newQuery.trim(),
      maxPrice: parseFloat(newMaxPrice) || 0,
      includeEbay,
      customUrl: newCustomUrl.trim(),
      results: [],
      newResultCount: 0
    };

    updateSearches([newSearch, ...searches]);
    setSelectedId(newSearch.id);
    setIsCreating(false);
    setNewQuery('');
    setNewMaxPrice('');
    setNewCustomUrl('');
    setIncludeEbay(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this saved search?")) {
      updateSearches(searches.filter(s => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
  };

  const runSearch = async (search: SavedSearch) => {
    setLoadingSearchId(search.id);
    try {
      const results = await executeSavedSearch(search);
      
      const updated = searches.map(s => {
        if (s.id === search.id) {
          const oldUrls = s.results.map(r => r.url);
          const newItems = results.filter(r => !oldUrls.includes(r.url));
          
          return {
            ...s,
            results: results, 
            lastRun: new Date().toISOString(),
            newResultCount: newItems.length
          };
        }
        return s;
      });
      updateSearches(updated);
    } finally {
      setLoadingSearchId(null);
    }
  };

  const clearNewCount = (id: string) => {
    const updated = searches.map(s => s.id === id ? { ...s, newResultCount: 0 } : s);
    // Only update if changed
    const current = searches.find(s => s.id === id);
    if (current && current.newResultCount > 0) {
        updateSearches(updated);
    }
  };

  useEffect(() => {
    if (selectedId) {
      clearNewCount(selectedId);
    }
  }, [selectedId]);

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-100px)] flex flex-col animate-in fade-in">
      <header className="flex justify-between items-center mb-6 shrink-0 px-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Bell className="text-emerald-500" size={32} /> Saved Searches
          </h1>
          <p className="text-sm text-slate-500 font-bold">Monitor Kleinanzeigen & eBay for new deals</p>
        </div>
        
        {/* AUTO-CHECK TOGGLE */}
        <div className={`flex items-center gap-4 px-4 py-2 rounded-2xl border transition-all ${isAutoCheckActive ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
           <div className="flex flex-col items-end">
              <span className={`text-[10px] font-black uppercase tracking-widest ${isAutoCheckActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                 {isAutoCheckActive ? (loadingSearchId === 'AUTO' ? 'Scanning now...' : `Next check: ${autoCheckCountdown}m`) : 'Auto-Check Off'}
              </span>
              {isAutoCheckActive && <span className="text-[9px] font-bold text-slate-400">Every 30 mins</span>}
           </div>
           <button 
              onClick={() => setIsAutoCheckActive(!isAutoCheckActive)}
              className={`relative w-12 h-6 rounded-full transition-colors ${isAutoCheckActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
           >
              <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isAutoCheckActive ? 'translate-x-6' : 'translate-x-0'}`} />
           </button>
        </div>
      </header>

      <div className="flex flex-1 gap-6 overflow-hidden px-4">
        
        {/* LEFT SIDEBAR: SEARCH LIST */}
        <div className="w-[350px] flex flex-col gap-4 shrink-0">
          
          {/* Create Button */}
          {!isCreating ? (
            <button 
              onClick={() => setIsCreating(true)}
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={16}/> New Alert
            </button>
          ) : (
            <form onSubmit={handleCreate} className="bg-white p-5 rounded-[2rem] border border-emerald-200 shadow-lg space-y-4 animate-in slide-in-from-left-4">
               <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Search Term</label>
                  <input 
                    autoFocus
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-emerald-500"
                    placeholder="e.g. RTX 4070"
                    value={newQuery}
                    onChange={e => setNewQuery(e.target.value)}
                  />
               </div>
               <div className="flex gap-2">
                  <div className="flex-1">
                     <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Max Price (€)</label>
                     <input 
                        type="number"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-emerald-500"
                        placeholder="Any"
                        value={newMaxPrice}
                        onChange={e => setNewMaxPrice(e.target.value)}
                     />
                  </div>
               </div>
               <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><LinkIcon size={10}/> Custom URL (Optional)</label>
                  <input 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[10px] outline-none focus:border-emerald-500 text-slate-600"
                    placeholder="https://www.kleinanzeigen.de/..."
                    value={newCustomUrl}
                    onChange={e => setNewCustomUrl(e.target.value)}
                  />
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">Use a pre-filtered URL for best results.</p>
               </div>
               <label className="flex items-center gap-2 px-1 cursor-pointer">
                  <input type="checkbox" checked={includeEbay} onChange={e => setIncludeEbay(e.target.checked)} className="accent-emerald-500 w-4 h-4"/>
                  <span className="text-xs font-bold text-slate-600">Include eBay.de</span>
               </label>
               <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setIsCreating(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs">Cancel</button>
                  <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold text-xs shadow-md">Save</button>
               </div>
            </form>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hide">
             {searches.length === 0 && !isCreating && (
                <div className="text-center py-10 opacity-40">
                   <Search size={48} className="mx-auto mb-2 text-slate-300"/>
                   <p className="font-bold text-slate-400 text-sm">No saved searches</p>
                </div>
             )}
             {searches.map(search => (
                <div 
                   key={search.id} 
                   onClick={() => setSelectedId(search.id)}
                   className={`p-4 rounded-[1.5rem] border-2 cursor-pointer transition-all group relative ${selectedId === search.id ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-200' : 'bg-white border-slate-100 hover:border-emerald-200'}`}
                >
                   <div className="flex justify-between items-start mb-2">
                      <h3 className="font-black text-slate-900 text-sm truncate pr-6">{search.query}</h3>
                      {search.newResultCount > 0 && (
                         <span className="absolute top-4 right-4 bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                            +{search.newResultCount}
                         </span>
                      )}
                   </div>
                   <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest flex-wrap">
                      {search.maxPrice > 0 ? <span>&lt; €{search.maxPrice}</span> : <span>Any Price</span>}
                      <span>•</span>
                      {search.customUrl ? <span className="text-blue-500 flex items-center gap-1"><LinkIcon size={8}/> URL</span> : <span>{search.includeEbay ? 'All Sites' : 'KA Only'}</span>}
                   </div>
                   
                   <div className="mt-3 flex items-center justify-between">
                      <p className="text-[9px] text-slate-400 font-medium">
                         {search.lastRun ? `Checked: ${new Date(search.lastRun).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'Never checked'}
                      </p>
                      <div className="flex gap-2">
                         <button 
                            onClick={(e) => { e.stopPropagation(); runSearch(search); }}
                            className={`p-1.5 rounded-lg transition-all ${loadingSearchId === search.id ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 hover:bg-emerald-600 hover:text-white'}`}
                            disabled={loadingSearchId === search.id}
                         >
                            <RefreshCcw size={14} className={loadingSearchId === search.id ? 'animate-spin' : ''}/>
                         </button>
                         <button 
                            onClick={(e) => handleDelete(search.id, e)}
                            className="p-1.5 bg-slate-100 text-slate-400 hover:bg-red-500 hover:text-white rounded-lg transition-all"
                         >
                            <Trash2 size={14}/>
                         </button>
                      </div>
                   </div>
                </div>
             ))}
          </div>
        </div>

        {/* RIGHT: RESULTS AREA */}
        <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col relative">
           {selectedSearch ? (
              <>
                 <header className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
                          <Search size={24}/>
                       </div>
                       <div>
                          <h2 className="text-xl font-black text-slate-900">{selectedSearch.query}</h2>
                          <div className="flex items-center gap-2 mt-1">
                             <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">
                                {selectedSearch.results.length} results • Max: {selectedSearch.maxPrice > 0 ? `€${selectedSearch.maxPrice}` : 'Any'}
                             </p>
                             {selectedSearch.customUrl && (
                                <a 
                                   href={selectedSearch.customUrl} 
                                   target="_blank" 
                                   rel="noreferrer"
                                   className="text-[9px] font-black uppercase text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg flex items-center gap-1 hover:bg-blue-100 transition-colors"
                                >
                                   <LinkIcon size={8}/> Open Custom URL
                                </a>
                             )}
                          </div>
                       </div>
                    </div>
                    <button 
                       onClick={() => runSearch(selectedSearch)}
                       disabled={loadingSearchId === selectedSearch.id}
                       className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                       {loadingSearchId === selectedSearch.id ? <Loader2 size={16} className="animate-spin"/> : <RefreshCcw size={16}/>}
                       {loadingSearchId === selectedSearch.id ? 'Scanning...' : 'Check Now'}
                    </button>
                 </header>

                 <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    {selectedSearch.results.length === 0 ? (
                       <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                          <Search size={64} className="mb-4 text-slate-300"/>
                          <p className="font-bold text-slate-400">No active listings found</p>
                          <p className="text-xs text-slate-400 mt-1">Try refreshing the search</p>
                       </div>
                    ) : (
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {selectedSearch.results.map((deal, idx) => (
                             <a 
                                key={idx}
                                href={deal.url}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-emerald-300 transition-all group flex flex-col justify-between h-full"
                             >
                                <div className="space-y-3">
                                   <div className="flex justify-between items-start">
                                      <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${deal.platform === 'Kleinanzeigen' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                         {deal.platform}
                                      </span>
                                      <ExternalLink size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors"/>
                                   </div>
                                   <h4 className="font-bold text-slate-900 text-sm line-clamp-2 leading-tight group-hover:text-emerald-800 transition-colors">{deal.title}</h4>
                                </div>
                                
                                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                                   <p className={`text-lg font-black ${deal.numericPrice === 0 ? 'text-amber-500' : 'text-slate-900'}`}>{deal.price}</p>
                                   <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                      View <ArrowRight size={10}/>
                                   </div>
                                </div>
                             </a>
                          ))}
                       </div>
                    )}
                 </div>
              </>
           ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                 <Bell size={64} className="mb-4 text-slate-300"/>
                 <p className="font-bold text-slate-400">Select a search to view results</p>
              </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default SavedSearches;
