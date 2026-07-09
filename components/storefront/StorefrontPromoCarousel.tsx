import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import type { StorefrontPromoAd } from '../../services/firebaseService';
import StorefrontPromoBand from './StorefrontPromoBand';

interface Props {
  ads: StorefrontPromoAd[];
  texts: StorefrontTexts;
  darkMode: boolean;
  onContact: (ad: StorefrontPromoAd) => void;
}

const StorefrontPromoCarousel: React.FC<Props> = ({ ads, texts, darkMode, onContact }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= ads.length) setIndex(0);
  }, [ads.length, index]);

  if (ads.length === 0) return null;

  const current = ads[Math.min(index, ads.length - 1)];
  const multi = ads.length > 1;

  return (
    <section className={`relative ${darkMode ? 'bg-zinc-900' : 'bg-zinc-950'}`}>
      <StorefrontPromoBand ad={current} texts={texts} darkMode={darkMode} onContact={() => onContact(current)} />

      {multi && (
        <>
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + ads.length) % ads.length)}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % ads.length)}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center transition-colors"
            aria-label="Next"
          >
            <ChevronRight size={20} />
          </button>

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {ads.map((ad, i) => (
              <button
                key={ad.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}`}
                className={`h-2 rounded-full transition-all ${
                  i === index ? 'w-6 bg-brand-500' : 'w-2 bg-white/30 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
};

export default StorefrontPromoCarousel;
