import React, { useState, useEffect } from 'react';
import { Radar } from 'lucide-react';
import { InventoryItem } from '../types';
import AIAssistant from './AIAssistant';
import SavedSearches from './SavedSearches';
import DealHunterInsights from './DealHunterInsights';
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

interface Props {
  items: InventoryItem[];
  onUpdate?: (items: InventoryItem[]) => void;
}

const DealHunterPage: React.FC<Props> = ({ items, onUpdate }) => {
  const [searches, setSearches] = useState<SavedDealSearch[]>(loadSearches);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  }, [searches]);

  return (
    <div className="space-y-8 animate-in fade-in pb-24">
      <header className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-indigo-100 text-indigo-600">
          <Radar size={28} />
        </div>
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Deal Hunter</h1>
          <p className="text-sm text-slate-500 mt-1">
            Saved searches on eBay.de & Kleinanzeigen, plus AI sourcing ideas from your inventory gaps.
          </p>
        </div>
      </header>

      <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Sourcing insights</h2>
        <DealHunterInsights items={items} />
      </section>

      <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Saved searches</h2>
        <SavedSearches searches={searches} onUpdate={setSearches} embedded />
      </section>

      <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">AI sourcing & live deals</h2>
        </div>
        <AIAssistant items={items} onUpdate={onUpdate} defaultTab="SOURCING" />
      </section>
    </div>
  );
};

export default DealHunterPage;
