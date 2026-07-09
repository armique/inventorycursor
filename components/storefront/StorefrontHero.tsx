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
  subtitleOverride?: string;
  ctaLabelOverride?: string;
  ctaSaleLabelOverride?: string;
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
  subtitleOverride,
  ctaLabelOverride,
  ctaSaleLabelOverride,
}) => (
  <section className={`relative overflow-hidden border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-200/80'}`}>
    <div
      className={`absolute inset-0 ${
        darkMode
          ? 'bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(10,132,255,0.18),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(10,132,255,0.08),transparent)]'
          : 'bg-gradient-to-b from-white to-zinc-50'
      }`}
    />

    <div className="relative mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24 text-center flex flex-col items-center">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-5 border bg-white/60 dark:bg-zinc-900/60 backdrop-blur border-zinc-200/80 dark:border-zinc-700 text-brand-700 dark:text-brand-400">
        <Sparkles size={12} />
        {itemCount > 0 ? `${itemCount} ${texts.itemsAvailable}` : texts.tagline}
      </div>
      <h1 className={`text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
        {texts.title}
      </h1>
      <p className={`mt-3 text-lg sm:text-xl font-medium text-brand-600 dark:text-brand-400`}>
        {texts.tagline}
      </p>
      <p className={`mt-4 text-sm sm:text-base leading-relaxed max-w-xl ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
        {subtitleOverride || texts.heroSubtitle}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <a
          href="#bestsellers"
          className="inline-flex items-center px-6 py-3 rounded-full bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors shadow-sm"
        >
          {ctaLabelOverride || texts.heroCta}
        </a>
        <button
          type="button"
          onClick={() => onTabChange('sale')}
          className={`inline-flex items-center px-6 py-3 rounded-full text-sm font-bold transition-colors ${
            darkMode ? 'text-brand-400 hover:bg-zinc-800' : 'text-brand-600 hover:bg-brand-50'
          }`}
        >
          {ctaSaleLabelOverride || texts.heroCtaSale} &rsaquo;
        </button>
      </div>

      <div className="mt-12 mb-2">
        <svg width="360" height="188" viewBox="0 0 440 230" aria-hidden="true">
          <defs>
            <linearGradient id="storefrontHeroGpu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={darkMode ? '#52525b' : '#3a3a3c'} />
              <stop offset="100%" stopColor={darkMode ? '#18181b' : '#1d1d1f'} />
            </linearGradient>
          </defs>
          <rect x="60" y="60" width="320" height="110" rx="16" fill="url(#storefrontHeroGpu)" />
          <circle cx="130" cy="115" r="42" fill="#0a0a0a" stroke="#3a3a3c" strokeWidth="2" />
          <circle cx="130" cy="115" r="30" fill="none" stroke="#0a84ff" strokeWidth="2" />
          <circle cx="240" cy="115" r="42" fill="#0a0a0a" stroke="#3a3a3c" strokeWidth="2" />
          <circle cx="240" cy="115" r="30" fill="none" stroke="#0a84ff" strokeWidth="2" />
          <rect x="340" y="80" width="10" height="70" rx="3" fill="#0a84ff" />
          <rect x="60" y="176" width="320" height="10" rx="4" fill={darkMode ? '#3f3f46' : '#d2d2d7'} />
        </svg>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-3 w-full max-w-2xl">
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
