import React from 'react';
import type { StorefrontTexts } from './storefrontTexts';

interface Props {
  texts: StorefrontTexts;
  darkMode: boolean;
  onAbout: () => void;
  onContact: () => void;
  onLegal: (type: 'impressum' | 'datenschutz' | 'agb') => void;
}

const StorefrontFooter: React.FC<Props> = ({ texts, darkMode, onAbout, onContact, onLegal }) => (
  <footer className={`mt-auto border-t ${darkMode ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200/80 bg-zinc-50/80'}`}>
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <span className="text-white font-black text-[10px]">AT</span>
          </div>
          <div>
            <p className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{texts.title}</p>
            <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>{texts.tagline}</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {[
            { label: texts.aboutUs, action: onAbout },
            { label: texts.contactLink, action: onContact },
            { label: texts.imprint, action: () => onLegal('impressum') },
            { label: texts.privacy, action: () => onLegal('datenschutz') },
            { label: texts.terms, action: () => onLegal('agb') },
          ].map(({ label, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              className={`text-sm font-medium transition-colors ${
                darkMode ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <p className={`mt-8 pt-6 border-t text-xs text-center sm:text-left ${darkMode ? 'border-zinc-800 text-zinc-600' : 'border-zinc-200 text-zinc-400'}`}>
        © {new Date().getFullYear()} {texts.title} · {texts.legal}
      </p>
    </div>
  </footer>
);

export default StorefrontFooter;
