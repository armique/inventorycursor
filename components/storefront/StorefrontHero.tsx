import React from 'react';
import { Search, Sparkles, Tag } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';

interface Props {
  texts: StorefrontTexts;
  darkMode: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  tab: 'all' | 'sale';
  onTabChange: (tab: 'all' | 'sale') => void;
  itemCount: number;
  saleCount: number;
}

const StorefrontHero: React.FC<Props> = ({
  texts,
  darkMode,
  search,
  onSearchChange,
  tab,
  onTabChange,
  itemCount,
  saleCount,
}) => (
  <section className={`relative overflow-hidden border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-200/80'}`}>
    <div
      className={`absolute inset-0 ${
        darkMode
          ? 'bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(20,184,166,0.18),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(99,102,241,0.08),transparent)]'
          : 'bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(20,184,166,0.12),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(99,102,241,0.06),transparent)]'
      }`}
    />
    <div
      className="absolute inset-0 opacity-[0.35]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 32V0h1v32H0zm31 0V0h1v32h-1zM0 0h32v1H0V0zm0 31h32v1H0v-1z' fill='%2394a3b8' fill-opacity='0.12'/%3E%3C/svg%3E")`,
      }}
    />

    <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-4 border bg-white/60 dark:bg-zinc-900/60 backdrop-blur border-zinc-200/80 dark:border-zinc-700 text-brand-700 dark:text-brand-400">
          <Sparkles size={12} />
          {itemCount > 0 ? `${itemCount} ${texts.itemsAvailable}` : texts.tagline}
        </div>
        <h1 className={`font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
          {texts.title}
          <span className="block mt-1 text-lg sm:text-xl font-medium text-brand-600 dark:text-brand-400">
            {texts.tagline}
          </span>
        </h1>
        <p className={`mt-4 text-sm sm:text-base leading-relaxed max-w-xl ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
          {texts.heroSubtitle}
        </p>
      </div>

      <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-2xl">
        <div className="relative flex-1">
          <Search size={18} className={`absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`} />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={texts.searchHero}
            className={`w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-medium outline-none transition-shadow focus:ring-2 focus:ring-brand-500/30 ${
              darkMode
                ? 'bg-zinc-900/90 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                : 'bg-white border border-zinc-200/90 text-zinc-900 placeholder:text-zinc-400 shadow-sm'
            }`}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onTabChange('all')}
            className={`px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${
              tab === 'all'
                ? darkMode
                  ? 'bg-white text-zinc-900 shadow-lg'
                  : 'bg-zinc-900 text-white shadow-lg'
                : darkMode
                  ? 'bg-zinc-800/80 text-zinc-300 border border-zinc-700 hover:bg-zinc-800'
                  : 'bg-white text-zinc-600 border border-zinc-200 hover:border-zinc-300'
            }`}
          >
            {texts.all}
          </button>
          <button
            type="button"
            onClick={() => onTabChange('sale')}
            className={`px-5 py-3.5 rounded-2xl text-sm font-bold transition-all inline-flex items-center gap-2 ${
              tab === 'sale'
                ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25'
                : darkMode
                  ? 'bg-zinc-800/80 text-zinc-300 border border-zinc-700 hover:border-rose-500/50'
                  : 'bg-white text-zinc-600 border border-zinc-200 hover:border-rose-200 hover:text-rose-600'
            }`}
          >
            <Tag size={15} />
            {texts.sale}
            {saleCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${tab === 'sale' ? 'bg-white/20' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                {saleCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  </section>
);

export default StorefrontHero;
