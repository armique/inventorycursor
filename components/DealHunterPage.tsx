import React, { useState, useEffect, useCallback } from 'react';
import { Radar, Bell, Sparkles, TrendingUp } from 'lucide-react';
import { InventoryItem } from '../types';
import AIAssistant from './AIAssistant';
import SavedSearches from './SavedSearches';
import DealHunterInsights from './DealHunterInsights';
import { loadDealWatchlist } from '../services/dealHunterExtras';
import type { LiveDeal, DealSearchPlatform } from '../services/geminiService';

export type SavedDealSearch = {
  id: string;
  query: string;
  maxPrice?: number;
  includeEbay?: boolean;
  platform?: DealSearchPlatform;
  customUrl?: string;
  lastRun?: string;
  results: LiveDeal[];
  newResultCount: number;
};

const STORAGE_KEY = 'saved_deal_searches_v1';

function loadSearches(): SavedDealSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type DealHunterTab = 'alerts' | 'sourcing' | 'insights';

interface Props {
  items: InventoryItem[];
  onUpdate?: (items: InventoryItem[]) => void;
}

const TABS: { id: DealHunterTab; label: string; icon: React.ReactNode }[] = [
  { id: 'alerts', label: 'Saved alerts', icon: <Bell size={14} /> },
  { id: 'sourcing', label: 'AI sourcing', icon: <Sparkles size={14} /> },
  { id: 'insights', label: 'Insights', icon: <TrendingUp size={14} /> },
];

const DealHunterPage: React.FC<Props> = ({ items, onUpdate }) => {
  const [searches, setSearches] = useState<SavedDealSearch[]>(loadSearches);
  const [activeTab, setActiveTab] = useState<DealHunterTab>('alerts');
  const [seedQuery, setSeedQuery] = useState<string | null>(null);
  const [watchlistCount, setWatchlistCount] = useState(() => loadDealWatchlist().length);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  }, [searches]);

  useEffect(() => {
    const refresh = () => setWatchlistCount(loadDealWatchlist().length);
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [searches]);

  const handleHuntFromInsights = useCallback((query: string) => {
    setSeedQuery(query);
    setActiveTab('alerts');
  }, []);

  const totalNew = searches.reduce((n, s) => n + (s.newResultCount || 0), 0);

  return (
    <div className="h-[calc(100vh-6.5rem)] min-h-[520px] max-w-[1600px] mx-auto flex flex-col animate-in fade-in">
      {/* Compact header + tabs */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-600 shrink-0">
            <Radar size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-slate-900 tracking-tight truncate">Deal Hunter</h1>
            <p className="text-[11px] text-slate-500 font-medium truncate">
              Kleinanzeigen & eBay alerts · AI niches · inventory-based tips
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.id === 'alerts' && totalNew > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                  {totalNew > 9 ? '9+' : totalNew}
                </span>
              )}
              {tab.id === 'insights' && watchlistCount > 0 && activeTab !== 'insights' && (
                <span className="ml-0.5 text-[9px] text-indigo-600 font-bold">{watchlistCount}★</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Single unified panel */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {activeTab === 'alerts' && (
          <SavedSearches
            searches={searches}
            onUpdate={setSearches}
            embedded
            fillHeight
            seedQuery={seedQuery}
            onSeedQueryConsumed={() => setSeedQuery(null)}
          />
        )}

        {activeTab === 'sourcing' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <AIAssistant items={items} onUpdate={onUpdate} variant="embedded" defaultTab="SOURCING" />
          </div>
        )}

        {activeTab === 'insights' && (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5">
            <DealHunterInsights items={items} compact onRunSearch={handleHuntFromInsights} />
          </div>
        )}
      </div>
    </div>
  );
};

export default DealHunterPage;
