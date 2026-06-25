import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle, RefreshCw, Key, Cloud, ShoppingBag } from 'lucide-react';
import { hasClientGeminiKey } from '../services/geminiService';
import { isCloudEnabled } from '../services/firebaseService';
import { loadAISettings, type AISettings } from '../services/aiSettings';

interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'loading';
  detail: string;
}

const HealthCheckPage: React.FC = () => {
  const [checks, setChecks] = useState<Check[]>([]);
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);

  const runChecks = async () => {
    const ai = loadAISettings();
    setAiSettings(ai);
    const list: Check[] = [];

    list.push({
      id: 'gemini',
      label: 'Gemini API (browser)',
      status: hasClientGeminiKey() ? 'ok' : 'warn',
      detail: hasClientGeminiKey()
        ? 'VITE_GEMINI_API_KEY detected in build.'
        : 'Optional in browser — on Vercel set GEMINI_API_KEY (server) for Deal Hunter; redeploy after adding.',
    });

    list.push({
      id: 'groq',
      label: 'Groq API',
      status: import.meta.env.VITE_GROQ_API_KEY ? 'ok' : 'warn',
      detail: import.meta.env.VITE_GROQ_API_KEY ? 'Configured for specs AI.' : 'Optional — add VITE_GROQ_API_KEY for fast spec fill.',
    });

    list.push({
      id: 'cloud',
      label: 'Firebase cloud sync',
      status: isCloudEnabled() ? 'ok' : 'warn',
      detail: isCloudEnabled() ? 'Cloud sync enabled.' : 'Local-only mode — enable Firebase in Settings.',
    });

    list.push({
      id: 'deal-api',
      label: 'Deal search API',
      status: 'loading',
      detail: 'Testing /api/gemini?route=deal-search…',
    });
    setChecks([...list]);

    try {
      const res = await fetch('/api/gemini?route=deal-search', { method: 'OPTIONS' });
      list[list.length - 1] = {
        id: 'deal-api',
        label: 'Deal search API',
        status: res.ok || res.status === 204 ? 'ok' : 'warn',
        detail: res.ok || res.status === 204
          ? 'Server route reachable. Set GEMINI_API_KEY on Vercel for live listings; GROQ_API_KEY optional fallback.'
          : 'Not available in plain vite dev — uses browser Gemini fallback.',
      };
    } catch {
      list[list.length - 1] = {
        id: 'deal-api',
        label: 'Deal search API',
        status: 'warn',
        detail: 'Not reachable — normal for `npm run dev`; use `vercel dev` or deploy to Vercel.',
      };
    }

    list.push({
      id: 'ai-priority',
      label: 'AI provider priority',
      status: 'ok',
      detail: ai.providerPriority.join(' → '),
    });

    list.push({
      id: 'storage',
      label: 'Browser storage',
      status: typeof localStorage !== 'undefined' ? 'ok' : 'error',
      detail: typeof localStorage !== 'undefined' ? 'localStorage available.' : 'localStorage blocked.',
    });

    setChecks([...list]);
  };

  useEffect(() => {
    void runChecks();
  }, []);

  const icon = (s: Check['status']) => {
    if (s === 'ok') return <CheckCircle2 size={18} className="text-emerald-500" />;
    if (s === 'error') return <AlertTriangle size={18} className="text-red-500" />;
    if (s === 'loading') return <RefreshCw size={18} className="text-slate-400 animate-spin" />;
    return <AlertTriangle size={18} className="text-amber-500" />;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in pb-20">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <Activity className="text-indigo-500" /> System health
          </h1>
          <p className="text-sm text-slate-500 mt-1">API keys, sync, and AI configuration status.</p>
        </div>
        <button
          type="button"
          onClick={() => void runChecks()}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest flex items-center gap-2"
        >
          <RefreshCw size={14} /> Re-run
        </button>
      </header>

      <div className="space-y-3">
        {checks.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl border border-slate-100 p-4 flex gap-3 items-start shadow-sm">
            {icon(c.status)}
            <div>
              <p className="font-bold text-slate-900 text-sm">{c.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {aiSettings && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-xs text-slate-600 space-y-2">
          <p className="font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Key size={14} /> AI settings snapshot
          </p>
          <p>Specs model tier: <strong>{aiSettings.specsModelTier}</strong></p>
          <p>Deal search model tier: <strong>{aiSettings.dealSearchModelTier}</strong></p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center gap-3">
          <Cloud size={20} className="text-indigo-500" />
          <span>Configure Firebase in Settings → Cloud</span>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center gap-3">
          <ShoppingBag size={20} className="text-emerald-500" />
          <span>Store catalog syncs when items are marked store-visible</span>
        </div>
      </div>
    </div>
  );
};

export default HealthCheckPage;
