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
}

const StorefrontHeader: React.FC<Props> = ({
  texts,
  lang,
  onLangChange,
  darkMode,
  onDarkModeToggle,
  wishlistCount,
  onHome,
}) => (
  <header
    className={`sticky top-0 z-50 border-b backdrop-blur-xl ${
      darkMode ? 'bg-zinc-950/80 border-zinc-800' : 'bg-white/80 border-zinc-200/70'
    }`}
  >
    <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <button
        type="button"
        onClick={onHome}
        className="flex items-center gap-2.5 group min-w-0"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shrink-0">
          <span className="text-white font-black text-sm tracking-tight">AT</span>
        </div>
        <div className="min-w-0 text-left hidden sm:block">
          <p className={`font-display font-bold text-base tracking-tight truncate ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
            {texts.title}
          </p>
          <p className={`text-[10px] font-medium truncate ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
            {texts.tagline}
          </p>
        </div>
      </button>

      <nav className="flex items-center gap-1.5 sm:gap-2">
        {wishlistCount > 0 && (
          <span
            className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
              darkMode ? 'bg-zinc-800 text-rose-400' : 'bg-rose-50 text-rose-600'
            }`}
            title={texts.wishlist}
          >
            <Heart size={12} className="fill-current" />
            {wishlistCount}
          </span>
        )}

        <div className={`flex rounded-lg overflow-hidden border ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
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
          className={`p-2 rounded-xl transition-colors ${
            darkMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
          }`}
          aria-label={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </nav>
    </div>
  </header>
);

export default StorefrontHeader;
