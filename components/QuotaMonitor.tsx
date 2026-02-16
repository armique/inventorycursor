import React, { useState, useEffect } from 'react';
import { Zap, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { subscribeToQuota } from '../services/geminiService';

const DAILY_QUOTA_LIMIT = 1500;

const QuotaMonitor: React.FC = () => {
  const [quota, setQuota] = useState<any>({});
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Subscribe to updates from the service
    const unsubscribe = subscribeToQuota((newState) => {
      setQuota(newState);
    });
    return () => { unsubscribe(); };
  }, []);

  const totalRequests = (Object.values(quota) as any[]).reduce((acc: number, curr: any) => acc + (curr.requests || 0), 0);
  const activeModel = Object.values(quota).find((m: any) => m.status === 'HEALTHY' && m.requests > 0) || Object.values(quota)[0];
  const depletedModels = Object.values(quota).filter((m: any) => m.status === 'DEPLETED');
  
  const remaining = Math.max(0, DAILY_QUOTA_LIMIT - totalRequests);
  const percentUsed = (totalRequests / DAILY_QUOTA_LIMIT) * 100;

  if (totalRequests === 0) return null;

  return (
    <div className="relative w-full">
      {/* Minimized View (Sidebar Widget) */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all border text-left group ${
           isOpen ? 'bg-slate-800 border-slate-700' : 'bg-transparent border-transparent hover:bg-slate-800/50'
        }`}
      >
        <div className={`p-1.5 rounded-lg shrink-0 ${depletedModels.length > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
           {depletedModels.length > 0 ? <AlertTriangle size={14}/> : <Zap size={14}/>}
        </div>
        <div className="flex flex-col items-start leading-none flex-1 min-w-0">
           <div className="flex justify-between w-full mb-1">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">AI Quota</span>
              <span className={`text-[9px] font-mono ${remaining < 100 ? 'text-red-400' : 'text-slate-400'}`}>{remaining}</span>
           </div>
           <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
              <div 
                 className={`h-full transition-all duration-500 ${percentUsed > 90 ? 'bg-red-500' : percentUsed > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                 style={{ width: `${percentUsed}%` }} 
              />
           </div>
        </div>
      </button>

      {/* Expanded View (Popover) */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-3 w-64 bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl p-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800">
             <div className="flex items-center gap-2">
                <Zap size={14} className="text-blue-400"/>
                <h4 className="font-black text-xs text-white uppercase tracking-widest">AI Engine Status</h4>
             </div>
             <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white"><XCircle size={14}/></button>
          </div>

          <div className="space-y-3">
             <div className="flex justify-between text-xs font-bold text-slate-400">
                <span>Usage Today</span>
                <span>{Math.round(percentUsed)}% ({totalRequests})</span>
             </div>

             <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-hide">
                {Object.values(quota).map((model: any) => (
                   <div key={model.id} className="flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-2 max-w-[140px]">
                         {model.status === 'HEALTHY' ? <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0"/> : <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0"/>}
                         <span className={`font-bold truncate ${model.status === 'DEPLETED' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                            {model.id.replace('gemini-', '').replace('-preview', '').replace('-latest', '')}
                         </span>
                      </div>
                      <span className="font-mono text-slate-500">{model.requests}</span>
                   </div>
                ))}
             </div>
          </div>

          {depletedModels.length > 0 && (
             <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[9px] text-amber-200 leading-tight flex gap-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
                <span>Some models depleted. Fallbacks active.</span>
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuotaMonitor;
