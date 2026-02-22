import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Tag, Search, RefreshCcw, ExternalLink, TrendingUp, BarChart3, AlertCircle, History, Trash2, ArrowRight } from 'lucide-react';
import { suggestPriceFromSoldListings, getSpecsAIProvider } from '../services/specsAI';

interface PriceResult {
  itemName: string;
  condition: string;
  currency: string;
  priceLow: number;
  priceHigh: number;
  priceAverage: number;
  confidenceScore: number;
  reasoning: string;
  references: { title: string; price: number; url: string }[];
}

const ebaySoldSearchUrl = (query: string) =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;

const PriceCheck: React.FC = () => {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('Used');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aiAvailable = !!getSpecsAIProvider();
  
  // History State
  const [history, setHistory] = useState<PriceResult[]>(() => {
    const saved = localStorage.getItem('price_check_history');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('price_check_history', JSON.stringify(history));
  }, [history]);

  // Handle incoming navigation with query
  useEffect(() => {
    if (location.state && location.state.query) {
       setQuery(location.state.query);
       // Only trigger if we haven't already searched for this exact thing to prevent loops
       if (!result || result.itemName !== location.state.query) {
          executeSearch(location.state.query, condition);
       }
    }
  }, [location.state]);

  const executeSearch = async (term: string, cond: string) => {
    if (!term.trim()) return;
    if (!aiAvailable) {
      setError('No AI configured. Add VITE_GROQ_API_KEY, VITE_GEMINI_API_KEY, or another provider in .env and restart.');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await suggestPriceFromSoldListings(term, cond);
      const mapped: PriceResult = {
        itemName: term,
        condition: cond,
        currency: 'EUR',
        priceLow: data.priceLow,
        priceHigh: data.priceHigh,
        priceAverage: data.priceAverage,
        confidenceScore: 85,
        reasoning: data.reasoning,
        references: (data.soldExamples || []).map(ex => ({
          title: ex.title,
          price: ex.price,
          url: ebaySoldSearchUrl(ex.title || term)
        }))
      };
      setResult(mapped);
      setHistory(prev => {
         const next = [mapped, ...prev.filter(h => h.itemName !== term || h.condition !== cond)];
         return next.slice(0, 20);
      });
    } catch (e) {
      console.error(e);
      const msg = (e as Error)?.message || 'Failed to fetch price data.';
      setError(msg.includes('API key') || msg.includes('No AI') ? `${msg} Add an AI key in .env and restart.` : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeSearch(query, condition);
  };

  const deleteHistoryItem = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setHistory(prev => prev.filter((_, i) => i !== index));
  };

  const loadHistoryItem = (item: PriceResult) => {
    setQuery(item.itemName);
    setCondition(item.condition);
    setResult(item);
  };

  // Helper for gauge position
  const getPercentPosition = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    const p = ((val - min) / (max - min)) * 100;
    return Math.min(Math.max(p, 0), 100);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 animate-in fade-in">
      <header className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Tag size={32} className="text-emerald-500" /> Price Check
          </h1>
          <p className="text-slate-500 font-medium mt-1">eBay.de sold listings price analysis (Verkaufte Artikel)</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT: CONTROLS & HISTORY */}
        <div className="lg:col-span-4 space-y-6">
           <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
              <form onSubmit={handleSearch} className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Item Name</label>
                    <input 
                       autoFocus
                       className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-emerald-500 transition-all"
                       placeholder="e.g. iPhone 13 128GB"
                       value={query}
                       onChange={e => setQuery(e.target.value)}
                    />
                 </div>
                 
                 <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Condition</label>
                    <div className="flex gap-2">
                       {['New', 'Used', 'Defective'].map(c => (
                          <button
                             type="button"
                             key={c}
                             onClick={() => setCondition(c)}
                             className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${condition === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                          >
                             {c}
                          </button>
                       ))}
                    </div>
                 </div>

                 {!aiAvailable && (
                    <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-200">
                       Add VITE_GROQ_API_KEY or VITE_GEMINI_API_KEY in .env to enable price analysis.
                    </p>
                 )}
                 <button 
                    type="submit" 
                    disabled={loading || !query || !aiAvailable}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                 >
                    {loading ? <RefreshCcw className="animate-spin" size={16}/> : <Search size={16}/>}
                    {loading ? 'Searching eBay sold listings...' : 'Analyze Price (eBay sold)'}
                 </button>
              </form>
           </div>

           {history.length > 0 && (
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
                 <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><History size={14}/> Recent Checks</h3>
                 <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-hide pr-1">
                    {history.map((item, idx) => (
                       <div 
                          key={idx} 
                          onClick={() => loadHistoryItem(item)}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer group relative hover:border-emerald-200 hover:bg-emerald-50 ${result?.itemName === item.itemName && result?.condition === item.condition ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200' : 'bg-slate-50 border-slate-100'}`}
                       >
                          <div className="flex justify-between items-start">
                             <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 text-xs truncate">{item.itemName}</p>
                                <p className="text-[10px] text-slate-500 font-medium">{item.condition} • Avg: €{item.priceAverage}</p>
                             </div>
                             <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => deleteHistoryItem(e, idx)} className="p-1 hover:text-red-500 text-slate-300"><Trash2 size={14}/></button>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
           )}
        </div>

        {/* RIGHT: RESULTS */}
        <div className="lg:col-span-8">
           {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
                 <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5"/>
                 <div>
                    <p className="font-bold text-red-800 text-sm">Price analysis failed</p>
                    <p className="text-xs text-red-600 mt-1">{error}</p>
                 </div>
              </div>
           )}
           {result ? (
              <div className="space-y-6 animate-in slide-in-from-bottom-4">
                 {/* Main Price Card */}
                 <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                       <BarChart3 size={200} />
                    </div>
                    
                    <div className="relative z-10">
                       <div className="flex justify-between items-start mb-8">
                          <div>
                             <h2 className="text-3xl font-black text-slate-900">{result.itemName}</h2>
                             <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wide bg-slate-100 inline-block px-3 py-1 rounded-lg">{result.condition} Condition</p>
                          </div>
                          <div className="text-right">
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Market Average</p>
                             <p className="text-4xl font-black text-emerald-600">€{result.priceAverage}</p>
                          </div>
                       </div>

                       {/* Gauge */}
                       <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 mb-6">
                          <div className="flex justify-between text-xs font-bold text-slate-400 mb-2 px-1">
                             <span>Low: €{result.priceLow}</span>
                             <span>High: €{result.priceHigh}</span>
                          </div>
                          <div className="h-6 bg-slate-200 rounded-full relative overflow-hidden">
                             {/* Gradient Bar */}
                             <div className="absolute inset-0 bg-gradient-to-r from-emerald-300 via-emerald-500 to-emerald-700 opacity-20"></div>
                             {/* Markers */}
                             <div 
                                className="absolute top-0 bottom-0 w-2 bg-slate-900 rounded-full shadow-lg transform -translate-x-1/2 transition-all duration-1000 ease-out"
                                style={{ left: `${getPercentPosition(result.priceAverage, result.priceLow, result.priceHigh)}%` }}
                             >
                                <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-black px-2 py-0.5 rounded">Avg</div>
                             </div>
                          </div>
                          <p className="text-center text-[10px] text-slate-400 mt-3 italic font-medium">Based on eBay.de sold/completed listings (Verkaufte Artikel)</p>
                       </div>

                       <div className="space-y-4">
                          <div className="flex justify-between items-center">
                             <h4 className="font-black text-sm text-slate-900 uppercase tracking-widest flex items-center gap-2"><ExternalLink size={16}/> Sold Listings (eBay.de)</h4>
                             <a 
                                href={ebaySoldSearchUrl(result.itemName)} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                             >
                                View on eBay.de <ArrowRight size={12}/>
                             </a>
                          </div>
                          <p className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200 mb-3">AI estimate – verify on eBay. Click a listing to search for that exact title.</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                             {result.references.length > 0 ? result.references.map((ref, idx) => {
                                if (!ref) return null;
                                return (
                                  <a 
                                     key={idx} 
                                     href={ref.url} 
                                     target="_blank" 
                                     rel="noopener noreferrer"
                                     className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-blue-50 hover:border-blue-200 transition-all group"
                                  >
                                     <span className="text-xs font-bold text-slate-700 truncate max-w-[70%]">{ref.title}</span>
                                     <div className="flex items-center gap-2">
                                        <span className="font-black text-slate-900">€{ref.price}</span>
                                        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity"/>
                                     </div>
                                  </a>
                                );
                             }) : (
                                <p className="text-sm text-slate-500 col-span-2">No examples returned. <a href={ebaySoldSearchUrl(result.itemName)} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">View sold listings on eBay.de</a></p>
                             )}
                          </div>
                       </div>

                       <div className="mt-6 pt-6 border-t border-slate-100">
                          <p className="text-xs text-slate-500 leading-relaxed italic">
                             <span className="font-bold text-emerald-600 not-italic">AI Analysis:</span> "{result.reasoning}"
                          </p>
                       </div>
                    </div>
                 </div>
              </div>
           ) : (
              <div className="h-full flex flex-col items-center justify-center bg-slate-50 rounded-[3rem] border border-dashed border-slate-200 p-12 text-center opacity-50 min-h-[400px]">
                 {loading ? (
                    <>
                       <RefreshCcw size={48} className="animate-spin text-emerald-500 mb-4"/>
                       <p className="font-black text-slate-400 uppercase tracking-widest">Searching German Marketplaces...</p>
                    </>
                 ) : (
                    <>
                       <Tag size={64} className="text-slate-300 mb-4"/>
                       <p className="font-black text-slate-400 text-lg">Enter an item to check prices</p>
                       <p className="text-xs text-slate-400 mt-2">AI analyzes eBay.de sold listings (Verkaufte Artikel) for realistic market value</p>
                    </>
                 )}
              </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default PriceCheck;
