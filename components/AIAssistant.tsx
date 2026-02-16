
import React, { useState, useEffect } from 'react';
import { Send, Sparkles, TrendingUp, AlertTriangle, RefreshCcw, Info, Globe, Package, Radar, ArrowRight, ExternalLink, ShoppingCart, Target, ArrowLeft, History, Clock, Trash2, ChevronRight } from 'lucide-react';
import { analyzeMarket, getSlowSellingAdvice, analyzeSourcingStrategy, findLiveDeals, SourcingStrategy, LiveDeal } from '../services/geminiService';
import { InventoryItem, ItemStatus } from '../types';
import SmartBundleSuggester from './SmartBundleSuggester';

interface AIResponse {
  text: string;
  sources: { uri: string; title?: string }[];
}

interface SourcingSession {
  id: string;
  timestamp: string;
  strategies: SourcingStrategy[];
}

interface Props {
  items: InventoryItem[];
  onUpdate?: (toSave: InventoryItem[]) => void;
}

const AIAssistant: React.FC<Props> = ({ items, onUpdate }) => {
  const [activeTab, setActiveTab] = useState<'MARKET' | 'BUNDLES' | 'SOURCING'>('MARKET');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [slowAdvice, setSlowAdvice] = useState<AIResponse | null>(null);

  // Sourcing State
  const [strategies, setStrategies] = useState<SourcingStrategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<SourcingStrategy | null>(null);
  const [liveDeals, setLiveDeals] = useState<LiveDeal[]>([]);
  const [isFindingDeals, setIsFindingDeals] = useState(false);
  
  // Sourcing History State
  const [sourcingHistory, setSourcingHistory] = useState<SourcingSession[]>(() => {
    const saved = localStorage.getItem('ai_sourcing_history');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('ai_sourcing_history', JSON.stringify(sourcingHistory));
  }, [sourcingHistory]);

  useEffect(() => {
    const fetchAdvice = async () => {
      if (items.length > 0 && activeTab === 'MARKET') {
        try {
          const result = await getSlowSellingAdvice(items);
          setSlowAdvice(result as AIResponse);
        } catch (err) {
          console.error("Failed to fetch advice", err);
        }
      }
    };
    fetchAdvice();
  }, [items, activeTab]);

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query) return;
    setLoading(true);
    try {
      const result = await analyzeMarket(query, "General Hardware Market Analysis");
      setResponse(result as AIResponse);
    } catch (err) {
      console.error("Market analysis failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateStrategies = async () => {
    setLoading(true);
    setStrategies([]);
    setSelectedStrategy(null);
    setLiveDeals([]);
    try {
      const results = await analyzeSourcingStrategy(items);
      setStrategies(results);
      
      // Save to History
      if (results.length > 0) {
        const newSession: SourcingSession = {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          strategies: results
        };
        setSourcingHistory(prev => [newSession, ...prev]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSession = (session: SourcingSession) => {
    setStrategies(session.strategies);
    setSelectedStrategy(null);
    setLiveDeals([]);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSourcingHistory(prev => prev.filter(s => s.id !== id));
    // If we deleted the currently viewed strategies, clear them
    // (Optional logic, for now we keep the view as is until they click another)
  };

  const handleSelectStrategy = (strategy: SourcingStrategy) => {
    setSelectedStrategy(strategy);
    setLiveDeals([]);
  };

  const handleBackToStrategies = () => {
    setSelectedStrategy(null);
    setLiveDeals([]);
  };

  const handleFindDeals = async () => {
    if (!selectedStrategy) return;
    setIsFindingDeals(true);
    try {
      const deals = await findLiveDeals(selectedStrategy);
      setLiveDeals(deals);
    } finally {
      setIsFindingDeals(false);
    }
  };

  const handleCreateBundle = (newBundle: InventoryItem, componentIds: string[]) => {
    if (!onUpdate) return;
    
    // Components: Status = IN_COMPOSITION, Parent = bundle ID
    const componentsToUpdate = items
      .filter(i => componentIds.includes(i.id))
      .map(c => ({
        ...c,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: newBundle.id
      }));

    onUpdate([newBundle, ...componentsToUpdate]);
    alert(`Bundle "${newBundle.name}" created successfully!`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">AI Command Center</h1>
          <p className="text-slate-500 font-medium">Market intelligence and inventory optimization</p>
        </div>
        <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto max-w-full">
           <button 
             onClick={() => setActiveTab('MARKET')} 
             className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'MARKET' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
           >
             <TrendingUp size={14}/> Market Research
           </button>
           <button 
             onClick={() => setActiveTab('SOURCING')} 
             className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'SOURCING' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
           >
             <Radar size={14}/> Deal Hunter
           </button>
           <button 
             onClick={() => setActiveTab('BUNDLES')} 
             className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'BUNDLES' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
           >
             <Package size={14}/> Smart Bundles
           </button>
        </div>
      </header>

      {activeTab === 'BUNDLES' && (
        <SmartBundleSuggester items={items} onCreateBundle={handleCreateBundle} />
      )}

      {activeTab === 'SOURCING' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in slide-in-from-right-4">
           
           {/* SIDEBAR: HISTORY */}
           <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden h-full max-h-[600px] flex flex-col">
                 <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                       <History size={14}/> Search History
                    </h3>
                 </div>
                 <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {sourcingHistory.length === 0 && (
                       <p className="text-[10px] text-slate-400 text-center py-8 italic">No previous searches.</p>
                    )}
                    {sourcingHistory.map(session => (
                       <div 
                          key={session.id} 
                          onClick={() => handleLoadSession(session)}
                          className={`p-3 rounded-xl cursor-pointer group hover:bg-slate-50 transition-all border border-transparent ${JSON.stringify(strategies) === JSON.stringify(session.strategies) ? 'bg-emerald-50 border-emerald-100' : ''}`}
                       >
                          <div className="flex justify-between items-start">
                             <div>
                                <p className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                                   <Clock size={10} className="text-slate-400"/>
                                   {new Date(session.timestamp).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                                </p>
                                <p className="text-[9px] text-slate-400 mt-0.5">
                                   {new Date(session.timestamp).toLocaleTimeString(undefined, {hour:'2-digit', minute:'2-digit'})}
                                </p>
                             </div>
                             <button onClick={(e) => handleDeleteSession(e, session.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 size={12}/>
                             </button>
                          </div>
                          <div className="mt-2 flex items-center gap-1 text-[9px] font-black text-emerald-600 uppercase">
                             <Package size={10}/> {session.strategies.length} Strategies
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
           </div>

           {/* MAIN CONTENT */}
           <div className="lg:col-span-9 space-y-6">
              {/* Header Area */}
              <div className="bg-gradient-to-br from-emerald-900 to-teal-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
                 <div className="relative z-10 max-w-3xl">
                    <h2 className="text-3xl font-black tracking-tight mb-4 flex items-center gap-3"><Radar size={32} className="text-emerald-400"/> AI Sourcing Agent</h2>
                    <p className="text-emerald-100 text-sm font-medium mb-8 leading-relaxed max-w-xl">
                       I analyze your entire sales history to identify multiple winning strategies. Select a "Golden Niche" below to start hunting for live deals on eBay.de and Kleinanzeigen.
                    </p>
                    
                    <button 
                       onClick={handleGenerateStrategies} 
                       disabled={loading}
                       className="px-8 py-4 bg-white text-emerald-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-50 transition-all shadow-xl disabled:opacity-50 flex items-center gap-3"
                    >
                       {loading ? <RefreshCcw className="animate-spin" size={16}/> : <Sparkles size={16}/>}
                       {loading ? 'Analyzing Sales History...' : 'Generate New Strategies'}
                    </button>
                 </div>
                 <div className="absolute -right-10 -bottom-20 opacity-10">
                    <ShoppingCart size={300} />
                 </div>
              </div>

              {/* STRATEGY SELECTION GRID */}
              {strategies.length > 0 && !selectedStrategy && (
                 <div className="space-y-4 animate-in slide-in-from-bottom-4">
                    <div className="flex justify-between items-center px-4">
                       <h3 className="text-lg font-black text-slate-900">Recommended Niches</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                       {strategies.map((strat, idx) => (
                          <button 
                             key={idx} 
                             onClick={() => handleSelectStrategy(strat)}
                             className="text-left bg-white p-6 rounded-[2rem] border border-slate-100 shadow-lg hover:shadow-xl hover:scale-[1.02] hover:border-emerald-200 transition-all group flex flex-col h-full"
                          >
                             <div className="flex justify-between items-start mb-4">
                                <div className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${strat.difficulty === 'Easy' ? 'bg-green-100 text-green-700' : strat.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                   {strat.difficulty}
                                </div>
                                <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors"/>
                             </div>
                             
                             <h4 className="text-lg font-black text-slate-900 mb-2 leading-tight">{strat.title}</h4>
                             <p className="text-xs text-slate-500 mb-6 flex-1 line-clamp-3 leading-relaxed">{strat.reasoning}</p>
                             
                             <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-2 border border-slate-100">
                                <div>
                                   <p className="text-[8px] font-black uppercase text-slate-400">Buy Limit</p>
                                   <p className="text-sm font-black text-slate-900">€{strat.maxBuyPrice}</p>
                                </div>
                                <div>
                                   <p className="text-[8px] font-black uppercase text-slate-400">Est. Sell</p>
                                   <p className="text-sm font-black text-emerald-600">€{strat.expectedSellPrice}</p>
                                </div>
                             </div>
                          </button>
                       ))}
                    </div>
                 </div>
              )}

              {/* ACTIVE STRATEGY & DEALS */}
              {selectedStrategy && (
                 <div className="space-y-6 animate-in fade-in">
                    <button onClick={handleBackToStrategies} className="text-xs font-bold text-slate-400 hover:text-slate-900 flex items-center gap-1">
                       <ArrowLeft size={14}/> Back to List
                    </button>

                    <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
                       <div className="bg-slate-50 p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-6">
                          <div>
                             <div className="flex items-center gap-3 mb-2">
                                <Target size={20} className="text-emerald-600"/>
                                <h3 className="text-2xl font-black text-slate-900">{selectedStrategy.title}</h3>
                             </div>
                             <p className="text-sm text-slate-500 max-w-2xl">{selectedStrategy.reasoning}</p>
                             <div className="flex gap-4 mt-4 text-xs font-bold text-slate-600">
                                <span className="bg-white px-3 py-1 rounded-lg border">Target: {selectedStrategy.targetCategory}</span>
                                <span className="bg-white px-3 py-1 rounded-lg border">Max Buy: €{selectedStrategy.maxBuyPrice}</span>
                             </div>
                          </div>
                          <div className="flex items-center">
                             <button 
                                onClick={handleFindDeals}
                                disabled={isFindingDeals}
                                className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg disabled:opacity-50 flex items-center gap-3"
                             >
                                {isFindingDeals ? <RefreshCcw className="animate-spin" size={16}/> : <Globe size={16}/>}
                                {isFindingDeals ? 'Scanning Markets...' : 'Hunt Live Deals'}
                             </button>
                          </div>
                       </div>

                       {liveDeals.length > 0 && (
                          <div className="p-8 bg-slate-50/50">
                             <div className="flex items-center gap-3 mb-6">
                                <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center font-black text-xs">{liveDeals.length}</div>
                                <h4 className="font-black text-slate-900">Active Listings Found</h4>
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {liveDeals.map((deal, idx) => (
                                   <a 
                                      key={idx} 
                                      href={deal.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-emerald-200 transition-all group flex flex-col justify-between"
                                   >
                                      <div className="mb-4">
                                         <div className="flex justify-between items-start mb-2">
                                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${deal.platform === 'Kleinanzeigen' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                               {deal.platform}
                                            </span>
                                            <ExternalLink size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors"/>
                                         </div>
                                         <h4 className="font-bold text-slate-900 text-sm line-clamp-2 leading-tight group-hover:text-emerald-700 transition-colors">{deal.title}</h4>
                                      </div>
                                      <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                         <p className="text-lg font-black text-slate-900">{deal.price}</p>
                                         <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                                            <ArrowRight size={10}/> View
                                         </div>
                                      </div>
                                   </a>
                                ))}
                             </div>
                          </div>
                       )}
                    </div>
                 </div>
              )}
           </div>
        </div>
      )}

      {activeTab === 'MARKET' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-left-4">
          <div className="lg:col-span-2 space-y-4">
            {slowAdvice && items.some(i => i.status === 'In Stock') && (
              <div className="bg-amber-50 border border-amber-100 p-6 rounded-[2rem] flex gap-4">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={24}/>
                </div>
                <div className="space-y-1 w-full">
                  <h3 className="font-black text-amber-900 uppercase text-xs tracking-widest">Slow Selling Analytics</h3>
                  <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{slowAdvice.text}</p>
                  {slowAdvice.sources && slowAdvice.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-amber-200">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2">Sources:</p>
                      <div className="flex flex-wrap gap-2">
                        {slowAdvice.sources.map((s, idx) => (
                          <a key={idx} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-600 border border-amber-200 rounded-lg text-[10px] font-bold hover:bg-amber-50 transition-colors">
                            <Globe size={12} /> {s.title || 'Market Source'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden flex flex-col h-[600px]">
              <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
                {response ? (
                  <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-100">
                        <Sparkles size={20} className="text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">{response.text}</p>
                      </div>
                    </div>
                    {response.sources && response.sources.length > 0 && (
                      <div className="ml-14 mt-2 border-t border-slate-50 pt-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Research Grounding:</p>
                        <div className="flex flex-wrap gap-2">
                          {response.sources.map((s, idx) => (
                            <a key={idx} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-100 transition-colors">
                              <Globe size={12} /> {s.title || 'Market Reference'}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4 opacity-40">
                    <Sparkles size={64} className="text-blue-600" />
                    <p className="font-bold text-slate-400">Ask me about market prices or hardware trends...</p>
                  </div>
                )}
                {loading && (
                  <div className="flex items-center gap-3 text-blue-600 font-black uppercase text-[10px] tracking-widest animate-pulse ml-14">
                    <RefreshCcw className="animate-spin" size={14}/> Researching Market Data...
                  </div>
                )}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100">
                <form onSubmit={handleAnalyze} className="relative">
                  <input 
                    type="text" 
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="What is the market price for an RTX 4070?"
                    className="w-full pl-6 pr-14 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-100 shadow-sm font-medium"
                  />
                  <button disabled={loading || !query} type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50">
                    <Send size={20} />
                  </button>
                </form>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
              <h3 className="font-black text-slate-800 mb-6 flex items-center gap-3"><TrendingUp size={20} className="text-emerald-600" /> Popular Queries</h3>
              <div className="space-y-3">
                {['RTX 4090 Market Price', 'Gaming PC Bundle Ideas', 'GPU Market Trends 2024'].map(item => (
                  <button 
                    key={item}
                    onClick={() => { setQuery(item); }}
                    className="w-full text-left p-4 rounded-xl border border-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-between group"
                  >
                    {item}
                    <Send size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-600" />
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2rem] text-white space-y-4">
               <div className="flex items-center gap-3">
                  <Info className="text-blue-400" />
                  <h4 className="font-bold text-sm">Market Optimization</h4>
               </div>
               <p className="text-xs text-slate-400 leading-relaxed">
                 Use the AI to compare current prices on eBay.de with your inventory values to find the best time to sell.
               </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default AIAssistant;
