import React from 'react';
import { MessageCircle } from 'lucide-react';
import { formatEUR } from '../../utils/formatMoney';
import type { StorefrontTexts } from './storefrontTexts';
import type { StorefrontPromoAd } from '../../services/supabaseService';

const TowerArt: React.FC = () => (
  <svg width="180" height="280" viewBox="0 0 180 280" aria-hidden="true">
    <defs>
      <linearGradient id="promoTower" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#2c2c2e" />
        <stop offset="100%" stopColor="#111113" />
      </linearGradient>
    </defs>
    <rect x="20" y="10" width="140" height="260" rx="18" fill="url(#promoTower)" />
    <rect x="20" y="10" width="6" height="260" rx="3" fill="#0a84ff" />
    <circle cx="90" cy="90" r="34" fill="#0a0a0a" stroke="#48484a" strokeWidth="2" />
    <circle cx="90" cy="90" r="22" fill="none" stroke="#0a84ff" strokeWidth="2" />
    <circle cx="90" cy="180" r="34" fill="#0a0a0a" stroke="#48484a" strokeWidth="2" />
    <circle cx="90" cy="180" r="22" fill="none" stroke="#0a84ff" strokeWidth="2" />
    <circle cx="140" cy="30" r="4" fill="#0a84ff" />
  </svg>
);

interface Props {
  ad: StorefrontPromoAd;
  texts: StorefrontTexts;
  darkMode: boolean;
  onContact: () => void;
}

const StorefrontPromoBand: React.FC<Props> = ({ ad, texts, darkMode, onContact }) => (
  <div className={`relative overflow-hidden text-white ${darkMode ? 'bg-zinc-950' : 'bg-zinc-950'}`}>
    <div
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_85%_40%,rgba(10,132,255,0.22),transparent_60%)]"
      aria-hidden="true"
    />
    <div className="relative mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-brand-400">
          {texts.adTag}
        </p>
        <h2 className="font-display text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
          {ad.name}
        </h2>
        {ad.specLine && <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-zinc-400">{ad.specLine}</p>}
        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">{formatEUR(ad.price)} €</span>
        </div>
        <p className="mt-3 text-sm text-zinc-500">{texts.adNote}</p>
        <div className="mt-8">
          <button
            type="button"
            onClick={onContact}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-transform duration-300 hover:bg-brand-700 active:scale-[0.98]"
            style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            <MessageCircle size={16} strokeWidth={1.75} />
            {ad.ctaLabel || texts.adCta}
          </button>
        </div>
      </div>
      <div className="relative flex min-h-[16rem] items-center justify-center lg:min-h-[22rem]">
        {ad.imageUrl ? (
          <img
            src={ad.imageUrl}
            alt={ad.name}
            className="max-h-[22rem] w-full object-contain drop-shadow-[0_30px_50px_rgba(0,0,0,0.45)]"
          />
        ) : (
          <TowerArt />
        )}
      </div>
    </div>
  </div>
);

export default StorefrontPromoBand;
