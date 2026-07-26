import React from 'react';
import { Moon, Sun, Heart } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';

interface Props {
  texts: StorefrontTexts;
  lang: 'de' | 'en';
  onLangChange: (lang: 'de' | 'en') => void;
  darkMode: boolean;
  onDarkModeToggle: () => void;
  wishlistCount: number;
  onHome: () => void;
  categories?: string[];
  onCategoryClick?: (category: string) => void;
}

const StorefrontHeader: React.FC<Props> = ({
  texts,
  lang,
  onLangChange,
  darkMode,
  onDarkModeToggle,
  wishlistCount,
  onHome,
  categories = [],
  onCategoryClick,
}) => (
  <header
    className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl ${
      darkMode
        ? 'border-white/10 bg-zinc-950/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
        : 'border-zinc-200/60 bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
    }`}
  >
    <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
      <button type="button" onClick={onHome} className="group flex min-w-0 items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-black tracking-tight transition-transform duration-300 group-active:scale-[0.96] ${
            darkMode ? 'bg-white text-zinc-950' : 'bg-zinc-900 text-white'
          }`}
          style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          AT
        </span>
        <span className={`hidden truncate font-display text-sm font-semibold tracking-tight sm:block ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
          {texts.title}
        </span>
      </button>

      {categories.length > 0 && onCategoryClick && (
        <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex">
          {categories.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onCategoryClick(c)}
              className={`whitespace-nowrap text-[13px] font-medium transition-colors duration-300 ${
                darkMode ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
              }`}
              style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
            >
              {c}
            </button>
          ))}
        </nav>
      )}

      <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {wishlistCount > 0 && (
          <span
            className={`hidden items-center gap-1.5 px-2 py-1 font-mono text-[11px] tabular-nums sm:inline-flex ${
              darkMode ? 'text-rose-300' : 'text-rose-600'
            }`}
            title={texts.wishlist}
          >
            <Heart size={12} strokeWidth={1.75} className="fill-current" />
            {wishlistCount}
          </span>
        )}

        <div className={`flex overflow-hidden rounded-lg border ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <button
            type="button"
            onClick={() => onLangChange('de')}
            className={`px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
              lang === 'de'
                ? darkMode
                  ? 'bg-white text-zinc-900'
                  : 'bg-zinc-900 text-white'
                : darkMode
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            DE
          </button>
          <button
            type="button"
            onClick={() => onLangChange('en')}
            className={`px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
              lang === 'en'
                ? darkMode
                  ? 'bg-white text-zinc-900'
                  : 'bg-zinc-900 text-white'
                : darkMode
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            EN
          </button>
        </div>

        <button
          type="button"
          onClick={onDarkModeToggle}
          className={`rounded-lg p-2 transition-colors active:scale-[0.96] ${
            darkMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
          }`}
          aria-label={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>
      </nav>
    </div>
  </header>
);

export default StorefrontHeader;
