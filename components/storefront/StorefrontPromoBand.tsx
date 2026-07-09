import React from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { formatEUR } from '../../utils/formatMoney';
import type { StorefrontTexts } from './storefrontTexts';
import type { StorefrontPromoAd } from '../../services/firebaseService';

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
  <div className={`${darkMode ? 'bg-zinc-900' : 'bg-zinc-950'} text-white`}>
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-14 sm:py-16 grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-10 items-center">
      <div>
        <span className="inline-flex items-center gap-1.5 bg-brand-500 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg mb-5">
          <Sparkles size={12} />
          {texts.adTag}
        </span>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight tracking-tight">
          {ad.name}
        </h2>
        {ad.specLine && <p className="mt-2.5 text-sm text-zinc-400">{ad.specLine}</p>}
        <div className="mt-5 flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl font-bold tracking-tight">{formatEUR(ad.price)} €</span>
        </div>
        <p className="mt-3 text-sm font-medium text-zinc-400">{texts.adNote}</p>
        <div className="mt-8">
          <button
            type="button"
            onClick={onContact}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-500 text-white text-sm font-bold hover:bg-brand-600 transition-colors"
          >
            <MessageCircle size={16} />
            {ad.ctaLabel || texts.adCta}
          </button>
        </div>
      </div>
      <div className="flex justify-center">
        <div className="w-full max-w-sm aspect-[3/4] rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center p-8 overflow-hidden">
          {ad.imageUrl ? (
            <img src={ad.imageUrl} alt={ad.name} className="w-full h-full object-contain" />
          ) : (
            <TowerArt />
          )}
        </div>
      </div>
    </div>
  </div>
);

export default StorefrontPromoBand;
