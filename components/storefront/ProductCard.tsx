import React, { useMemo, useState } from 'react';
import { formatEUR } from '../../utils/formatMoney';
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Share2 } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import { catalogItemImageList, type StoreItem } from './storefrontUtils';
import ResilientStoreImage from './ResilientStoreImage';

interface Props {
  item: StoreItem;
  priceDisplay: { value: number; sale: boolean; hasPrice: boolean };
  texts: StorefrontTexts;
  lang: 'de' | 'en';
  darkMode: boolean;
  onContact: () => void;
  onDetailsClick: () => void;
  layout?: 'grid' | 'list';
  isInWishlist?: boolean;
  onToggleWishlist?: () => void;
  onShare?: () => void;
}

const ProductCard: React.FC<Props> = ({
  item,
  priceDisplay: pd,
  texts,
  darkMode,
  onContact,
  onDetailsClick,
  layout = 'grid',
  isInWishlist = false,
  onToggleWishlist,
  onShare,
}) => {
  const [galleryIndex, setGalleryIndex] = useState(0);
  const images = useMemo(() => catalogItemImageList(item), [item.imageUrl, item.storeGalleryUrls]);
  const isList = layout === 'list';

  const cardShell = darkMode
    ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
    : 'bg-white border-zinc-200/90 hover:border-zinc-300';

  const tag = pd.sale ? (
    <span className="inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 mb-3">
      {texts.onSale}
    </span>
  ) : item.badge ? (
    <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide mb-3 ${
      item.badge === 'New' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
    }`}>
      {item.badge === 'New' ? texts.badgeNew : texts.badgePriceReduced}
    </span>
  ) : null;

  const priceBlock = (
    <div className="flex items-baseline gap-2 flex-wrap">
      {pd.hasPrice ? (
        <>
          <span className={`text-lg font-bold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
            {formatEUR(Number(pd.value))} €
          </span>
          {pd.sale && item.sellPrice != null && item.sellPrice > pd.value && (
            <span className={`text-sm line-through ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {formatEUR(Number(item.sellPrice))} €
            </span>
          )}
        </>
      ) : (
        <span className={`text-sm font-semibold ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
          {texts.priceOnRequest}
        </span>
      )}
    </div>
  );

  const imageBox = (
    <div className={`relative shrink-0 rounded-xl overflow-hidden ${isList ? 'w-32 h-32 sm:w-36 sm:h-36' : 'aspect-[4/3] w-full'} ${
      darkMode ? 'bg-zinc-800' : 'bg-zinc-50'
    }`}>
      {images.length > 0 ? (
        <>
          <ResilientStoreImage
            urls={images}
            index={galleryIndex}
            alt={item.name}
            category={item.category}
            subCategory={item.subCategory}
            className="relative w-full h-full object-contain object-center p-4 transition-transform duration-500 group-hover:scale-[1.04]"
          />
          {images.length > 1 && !isList && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setGalleryIndex((i) => (i - 1 + images.length) % images.length); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Previous"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setGalleryIndex((i) => (i + 1) % images.length); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Next"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <div className="absolute top-2 right-2 flex gap-1.5 z-10">
            {onToggleWishlist && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleWishlist(); }}
                className="p-2 rounded-full bg-white/95 shadow-sm hover:bg-white text-zinc-600 transition-colors"
                title={isInWishlist ? texts.removeFromWishlist : texts.addToWishlist}
              >
                <Heart size={15} className={isInWishlist ? 'fill-rose-500 text-rose-500' : ''} />
              </button>
            )}
            {onShare && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onShare(); }}
                className="p-2 rounded-full bg-white/95 shadow-sm hover:bg-white text-zinc-600 transition-colors"
                title={texts.share}
              >
                <Share2 size={15} />
              </button>
            )}
          </div>
        </>
      ) : (
        <ResilientStoreImage urls={[]} index={0} alt={item.name} category={item.category} subCategory={item.subCategory} className="relative w-full h-full" />
      )}
    </div>
  );

  const contactButton = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onContact(); }}
      className="w-full py-2.5 rounded-full bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors inline-flex items-center justify-center gap-1.5"
    >
      <MessageCircle size={14} />
      {texts.contact}
    </button>
  );

  if (isList) {
    return (
      <article
        onClick={onDetailsClick}
        className={`group flex gap-4 rounded-2xl border p-4 cursor-pointer transition-all duration-300 hover:shadow-card-hover ${cardShell}`}
      >
        {imageBox}
        <div className="flex flex-col flex-1 min-w-0 justify-center">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}
          </span>
          <h2 className={`font-semibold mt-1 line-clamp-2 text-base leading-snug ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
            {item.name}
          </h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            {priceBlock}
            <div className="w-40 shrink-0">{contactButton}</div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      onClick={onDetailsClick}
      className={`group flex flex-col rounded-2xl border p-5 cursor-pointer transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5 h-full ${cardShell}`}
    >
      {tag}
      {imageBox}
      <h2 className={`font-semibold mt-4 line-clamp-2 text-base leading-snug ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
        {item.name}
      </h2>
      <p className={`text-xs mt-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
        {item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}
      </p>
      <div className="mt-auto pt-4 space-y-3">
        {priceBlock}
        {contactButton}
      </div>
    </article>
  );
};

export default ProductCard;
