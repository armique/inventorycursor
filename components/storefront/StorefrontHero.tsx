import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, ImageOff } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import type { StoreItem } from './storefrontUtils';
import { catalogItemImageList } from './storefrontUtils';
import { formatEUR } from '../../utils/formatMoney';
import { toHeroImageUrl } from '../../utils/displayImageUrl';

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
  /** Top matches for the current search text, shown live below the input as you type. */
  liveResults?: StoreItem[];
  onSelectResult?: (item: StoreItem) => void;
  /** Full-bleed hero plane — first catalog image with usable photo. */
  featuredImageUrl?: string | null;
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

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
  liveResults = [],
  onSelectResult,
  featuredImageUrl,
}) => {
  const [searchFocused, setSearchFocused] = useState(false);
  const [entered, setEntered] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const showLiveResults = searchFocused && search.trim().length > 0;

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const reveal = (delayMs: number) =>
    ({
      opacity: entered ? 1 : 0,
      transform: entered ? 'translateY(0)' : 'translateY(18px)',
      transition: `opacity 0.7s ${EASE} ${delayMs}ms, transform 0.7s ${EASE} ${delayMs}ms`,
    }) as React.CSSProperties;

  return (
    <section className="relative isolate min-h-[100dvh] overflow-hidden">
      {/* Full-bleed visual plane */}
      <div className="absolute inset-0" aria-hidden="true">
        {featuredImageUrl ? (
          <img
            src={toHeroImageUrl(featuredImageUrl)}
            alt=""
            className={`h-full w-full object-cover scale-105 transition-transform duration-[1.4s] ${
              entered ? 'scale-100' : 'scale-105'
            }`}
            style={{ transitionTimingFunction: EASE }}
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div
            className={`h-full w-full ${
              darkMode
                ? 'bg-[radial-gradient(ellipse_90%_70%_at_70%_40%,rgba(10,132,255,0.22),transparent_55%),linear-gradient(145deg,#09090b_0%,#18181b_48%,#0c1220_100%)]'
                : 'bg-[radial-gradient(ellipse_90%_70%_at_75%_35%,rgba(10,132,255,0.18),transparent_55%),linear-gradient(145deg,#f4f4f5_0%,#e4e4e7_45%,#dbeafe_100%)]'
            }`}
          />
        )}
        {/* Left readability wash — keeps brand readable without floating chips */}
        <div
          className={`absolute inset-0 ${
            darkMode || featuredImageUrl
              ? 'bg-gradient-to-r from-zinc-950 via-zinc-950/85 to-zinc-950/25'
              : 'bg-gradient-to-r from-zinc-50 via-zinc-50/92 to-zinc-50/20'
          }`}
        />
        <div
          className={`absolute inset-0 opacity-[0.35] mix-blend-overlay pointer-events-none ${
            darkMode || featuredImageUrl ? 'bg-[url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.55\'/%3E%3C/svg%3E")]' : ''
          }`}
        />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] max-w-[1400px] flex-col justify-end px-4 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32 lg:justify-center lg:pb-24">
        <div className="max-w-xl lg:max-w-[34rem]">
          <p
            className={`font-display text-[clamp(2.75rem,8vw,5.5rem)] font-semibold leading-[0.92] tracking-tighter ${
              darkMode || featuredImageUrl ? 'text-white' : 'text-zinc-900'
            }`}
            style={reveal(40)}
          >
            {texts.title}
          </p>

          <h1
            className={`mt-5 font-display text-xl font-medium tracking-tight sm:text-2xl ${
              darkMode || featuredImageUrl ? 'text-zinc-100' : 'text-zinc-800'
            }`}
            style={reveal(120)}
          >
            {texts.tagline}
          </h1>

          <p
            className={`mt-3 max-w-[42ch] text-sm leading-relaxed sm:text-[15px] ${
              darkMode || featuredImageUrl ? 'text-zinc-400' : 'text-zinc-600'
            }`}
            style={reveal(200)}
          >
            {subtitleOverride || texts.heroSubtitle}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3" style={reveal(280)}>
            <a
              href="#bestsellers"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(10,132,255,0.55)] transition-transform duration-300 hover:bg-brand-700 active:scale-[0.98]"
              style={{ transitionTimingFunction: EASE }}
            >
              {ctaLabelOverride || texts.heroCta}
              <ArrowRight size={16} strokeWidth={2} />
            </a>
            <button
              type="button"
              onClick={() => {
                onTabChange('sale');
                document.getElementById('bestsellers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold transition-colors duration-300 active:scale-[0.98] ${
                darkMode || featuredImageUrl
                  ? 'text-zinc-200 hover:bg-white/10'
                  : 'text-zinc-700 hover:bg-zinc-900/5'
              }`}
              style={{ transitionTimingFunction: EASE }}
            >
              {ctaSaleLabelOverride || texts.heroCtaSale}
              {saleCount > 0 ? (
                <span className="font-mono text-xs tabular-nums text-brand-400">{saleCount}</span>
              ) : null}
            </button>
          </div>

          <div className="mt-10 w-full max-w-lg" style={reveal(360)}>
            <label className="sr-only" htmlFor="storefront-hero-search">
              {texts.search}
            </label>
            <div className="relative">
              <Search
                size={18}
                strokeWidth={1.75}
                className={`pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 ${
                  darkMode || featuredImageUrl ? 'text-zinc-500' : 'text-zinc-400'
                }`}
              />
              <input
                id="storefront-hero-search"
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                placeholder={texts.searchHero}
                className={`w-full rounded-xl border py-3.5 pl-11 pr-4 text-sm font-medium outline-none transition-[box-shadow,border-color] duration-300 focus:ring-2 focus:ring-brand-500/25 ${
                  darkMode || featuredImageUrl
                    ? 'border-white/10 bg-zinc-950/55 text-zinc-100 placeholder:text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md'
                    : 'border-zinc-200/90 bg-white/80 text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-md'
                }`}
                style={{ transitionTimingFunction: EASE }}
              />

              {showLiveResults && (
                <div
                  className={`absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border text-left shadow-[0_20px_40px_-15px_rgba(0,0,0,0.35)] ${
                    darkMode ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'
                  }`}
                >
                  {liveResults.length === 0 ? (
                    <p className={`px-4 py-4 text-center text-sm ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {texts.noItems}
                    </p>
                  ) : (
                    <ul className={`max-h-96 overflow-y-auto divide-y ${darkMode ? 'divide-zinc-800' : 'divide-zinc-100'}`}>
                      {liveResults.map((item) => {
                        const img = catalogItemImageList(item)[0];
                        const price = item.storeOnSale ? item.storeSalePrice : item.sellPrice;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => onSelectResult?.(item)}
                              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                darkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'
                              }`}
                            >
                              <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg ${
                                  darkMode ? 'bg-zinc-800' : 'bg-zinc-100'
                                }`}
                              >
                                {img ? (
                                  <img src={img} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <ImageOff size={16} className={darkMode ? 'text-zinc-600' : 'text-zinc-400'} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-semibold ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                                  {item.name}
                                </p>
                                <p className={`truncate text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  {item.category}
                                  {item.subCategory ? ` · ${item.subCategory}` : ''}
                                </p>
                              </div>
                              {price != null && (
                                <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${darkMode ? 'text-brand-400' : 'text-brand-600'}`}>
                                  {formatEUR(Number(price))} €
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-4 text-[11px] font-medium uppercase tracking-[0.14em]">
              <button
                type="button"
                onClick={() => onTabChange('all')}
                className={`transition-colors ${
                  tab === 'all'
                    ? darkMode || featuredImageUrl
                      ? 'text-white'
                      : 'text-zinc-900'
                    : darkMode || featuredImageUrl
                      ? 'text-zinc-500 hover:text-zinc-300'
                      : 'text-zinc-400 hover:text-zinc-700'
                }`}
              >
                {texts.all}
                {itemCount > 0 ? ` · ${itemCount}` : ''}
              </button>
              <button
                type="button"
                onClick={() => onTabChange('sale')}
                className={`transition-colors ${
                  tab === 'sale'
                    ? 'text-rose-400'
                    : darkMode || featuredImageUrl
                      ? 'text-zinc-500 hover:text-rose-300'
                      : 'text-zinc-400 hover:text-rose-600'
                }`}
              >
                {texts.sale}
                {saleCount > 0 ? ` · ${saleCount}` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StorefrontHero;
