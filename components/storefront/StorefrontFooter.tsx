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
  <footer className={`mt-auto border-t ${darkMode ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-zinc-50'}`}>
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-start">
        <div>
          <p className={`font-display text-2xl font-semibold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
            {texts.title}
          </p>
          <p className={`mt-2 max-w-[36ch] text-sm leading-relaxed ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
            {texts.tagline}
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-3 md:justify-end">
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
              className={`text-sm font-medium transition-colors duration-300 ${
                darkMode ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
              }`}
              style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <p
        className={`mt-10 border-t pt-6 font-mono text-[11px] leading-relaxed ${
          darkMode ? 'border-zinc-800 text-zinc-600' : 'border-zinc-200 text-zinc-400'
        }`}
      >
        © {new Date().getFullYear()} {texts.title} · {texts.legal}
      </p>
    </div>
  </footer>
);

export default StorefrontFooter;
