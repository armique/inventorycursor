import React, { useMemo, useState } from 'react';
import { formatEUR } from '../../utils/formatMoney';
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Share2 } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import { getItemDescription } from './storefrontTexts';
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
  lang,
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
  const desc = getItemDescription(item, lang);

  const cardShell = darkMode
    ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
    : 'bg-white border-zinc-200/90 hover:border-zinc-300';

  const priceBlock = (
    <div className="flex items-baseline gap-2 flex-wrap">
      {pd.hasPrice ? (
        <>
          <span className={`text-xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
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

  const metaRow = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}
      </span>
      {item.badge && (
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
          item.badge === 'New' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
        }`}>
          {item.badge === 'New' ? texts.badgeNew : texts.badgePriceReduced}
        </span>
      )}
    </div>
  );

  const imageArea = (
    <div className={`relative overflow-hidden shrink-0 ${isList ? 'w-36 sm:w-44 aspect-square' : 'aspect-[4/3] w-full'}`}>
      <div className={`absolute inset-0 ${darkMode ? 'bg-zinc-800' : 'bg-zinc-50'}`} />
      {images.length > 0 ? (
        <>
          <ResilientStoreImage
            urls={images}
            index={galleryIndex}
            alt={item.name}
            category={item.category}
            subCategory={item.subCategory}
            className="relative w-full h-full object-contain object-center transition-transform duration-500 group-hover:scale-[1.04]"
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
          {pd.sale && (
            <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-sm">
              {texts.onSale}
            </span>
          )}
          <div className="absolute top-3 right-3 flex gap-1.5 z-10">
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

  const body = (
    <div className={`flex flex-col flex-1 min-w-0 ${isList ? 'p-4 sm:p-5 justify-center' : 'p-4 sm:p-5'}`}>
      {metaRow}
      <h2 className={`font-semibold mt-1.5 line-clamp-2 text-base leading-snug ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
        {item.name}
      </h2>
      {desc && !isList && (
        <p className={`text-sm mt-2 line-clamp-2 leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
          {desc}
        </p>
      )}
      <div className="mt-auto pt-4 space-y-3">
        {priceBlock}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDetailsClick(); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${
              darkMode ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
          >
            {texts.viewDetails}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onContact(); }}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <MessageCircle size={14} />
            {texts.contact}
          </button>
        </div>
      </div>
    </div>
  );

  if (isList) {
    return (
      <article
        onClick={onDetailsClick}
        className={`group flex rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-card-hover ${cardShell}`}
      >
        {imageArea}
        {body}
      </article>
    );
  }

  return (
    <article
      onClick={onDetailsClick}
      className={`group flex flex-col rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5 h-full ${cardShell}`}
    >
      {imageArea}
      {body}
    </article>
  );
};

export default ProductCard;
