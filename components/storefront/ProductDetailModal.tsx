import React from 'react';
import { formatEUR } from '../../utils/formatMoney';
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Share2,
  X,
} from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import { getItemDescription } from './storefrontTexts';
import { catalogItemImageList, orderedSpecKeys, type StoreItem } from './storefrontUtils';
import ResilientStoreImage from './ResilientStoreImage';

interface Props {
  item: StoreItem;
  similarItems: StoreItem[];
  texts: StorefrontTexts;
  lang: 'de' | 'en';
  darkMode: boolean;
  galleryIndex: number;
  onGalleryIndexChange: (i: number) => void;
  onClose: () => void;
  onContact: () => void;
  onSelectSimilar: (item: StoreItem) => void;
}

const ProductDetailModal: React.FC<Props> = ({
  item,
  similarItems,
  texts,
  lang,
  darkMode,
  galleryIndex,
  onGalleryIndexChange,
  onClose,
  onContact,
  onSelectSimilar,
}) => {
  const galleryImages = catalogItemImageList(item);
  const hasImages = galleryImages.length > 0;
  const currentIndex = Math.min(galleryIndex, hasImages ? galleryImages.length - 1 : 0);
  const hasSpecs = item.specs && Object.keys(item.specs).length > 0;
  const specsTitle =
    /pc|computer|desktop|build/i.test(item.category || '') || /pc|computer|desktop|build/i.test(item.subCategory || '')
      ? texts.keyFeatures
      : texts.specs;
  const desc = getItemDescription(item, lang);
  const sale = item.storeOnSale && item.storeSalePrice != null;
  const price = sale ? item.storeSalePrice! : item.sellPrice;
  const hasPrice = price != null && price > 0;

  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-zinc-950/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col lg:flex-row lg:items-stretch max-w-7xl mx-auto w-full">
          {/* Gallery column */}
          <div
            className={`relative lg:w-[55%] xl:w-[58%] min-h-[45vh] lg:min-h-screen flex flex-col ${
              darkMode ? 'bg-zinc-900' : 'bg-zinc-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                className="p-2.5 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/55 transition-colors"
                aria-label={texts.close}
              >
                <X size={20} />
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const u = `${window.location.origin}/item/${item.id}`;
                    if (navigator.share) navigator.share({ title: item.name, url: u });
                    else navigator.clipboard.writeText(u);
                  }}
                  className="p-2.5 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/55 transition-colors"
                  aria-label={texts.share}
                >
                  <Share2 size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center p-6 sm:p-10 pt-16">
              {hasImages ? (
                <>
                  <ResilientStoreImage
                    key={currentIndex}
                    urls={galleryImages}
                    index={currentIndex}
                    alt={item.name}
                    category={item.category}
                    subCategory={item.subCategory}
                    className="max-w-full max-h-[50vh] lg:max-h-[75vh] object-contain drop-shadow-2xl"
                    imgStyle={{ animation: 'storefrontFadeIn 0.35s ease-out' }}
                  />
                  {galleryImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => onGalleryIndexChange((currentIndex - 1 + galleryImages.length) % galleryImages.length)}
                        className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow-lg flex items-center justify-center hover:bg-white transition-colors"
                      >
                        <ChevronLeft size={22} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onGalleryIndexChange((currentIndex + 1) % galleryImages.length)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow-lg flex items-center justify-center hover:bg-white transition-colors"
                      >
                        <ChevronRight size={22} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <ResilientStoreImage urls={[]} index={0} alt={item.name} category={item.category} subCategory={item.subCategory} className="w-full max-w-md aspect-square rounded-2xl" />
              )}
            </div>

            {galleryImages.length > 1 && (
              <div className={`shrink-0 px-4 pb-6 border-t pt-4 ${darkMode ? 'border-zinc-800' : 'border-zinc-200/80'}`}>
                <div className="flex gap-2 overflow-x-auto justify-center">
                  {galleryImages.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onGalleryIndexChange(i)}
                      className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                        i === currentIndex
                          ? 'border-brand-500 ring-2 ring-brand-500/30'
                          : darkMode
                            ? 'border-zinc-700 opacity-60 hover:opacity-100'
                            : 'border-zinc-200 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Details column */}
          <div
            className={`lg:w-[45%] xl:w-[42%] flex flex-col lg:min-h-screen lg:sticky lg:top-0 ${
              darkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-white text-zinc-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 lg:p-10">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}
                </span>
                {item.badge && (
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                    item.badge === 'New' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-blue-500/15 text-blue-500'
                  }`}>
                    {item.badge === 'New' ? texts.badgeNew : texts.badgePriceReduced}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">{item.name}</h1>

              <div className="mt-5 flex items-baseline gap-3 flex-wrap">
                {hasPrice ? (
                  <>
                    <span className="text-3xl font-bold tracking-tight text-brand-600 dark:text-brand-400">
                      {formatEUR(Number(price))} €
                    </span>
                    {sale && item.sellPrice != null && item.sellPrice > price && (
                      <span className={`text-lg line-through ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {formatEUR(Number(item.sellPrice))} €
                      </span>
                    )}
                  </>
                ) : (
                  <span className={`text-lg font-semibold ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {texts.priceOnRequest}
                  </span>
                )}
              </div>

              {hasSpecs && (
                <div className={`mt-8 rounded-2xl border p-5 ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50/80'}`}>
                  <h2 className="text-xs font-bold uppercase tracking-wider mb-4 text-brand-600 dark:text-brand-400">
                    {specsTitle}
                  </h2>
                  <dl className="space-y-2.5">
                    {orderedSpecKeys(item.specs!, item.categoryFields).slice(0, 12).map((key) => (
                      <div key={key} className="flex justify-between gap-4 text-sm py-1 border-b border-zinc-200/60 dark:border-zinc-800 last:border-0">
                        <dt className={`font-medium shrink-0 ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>{key}</dt>
                        <dd className="font-semibold text-right truncate" title={String(item.specs![key])}>
                          {String(item.specs![key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {desc && (
                <div className="mt-8">
                  <h2 className={`text-xs font-bold uppercase tracking-wider mb-3 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {texts.readDescription}
                  </h2>
                  <p className={`text-sm leading-relaxed whitespace-pre-line ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    {desc}
                  </p>
                </div>
              )}

              {similarItems.length > 0 && (
                <div className="mt-10">
                  <h2 className={`text-xs font-bold uppercase tracking-wider mb-4 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {texts.similarItems}
                  </h2>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {similarItems.map((sim) => (
                      <button
                        key={sim.id}
                        type="button"
                        onClick={() => onSelectSimilar(sim)}
                        className={`shrink-0 w-28 rounded-xl border overflow-hidden text-left transition-colors hover:border-brand-500/50 ${
                          darkMode ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'
                        }`}
                      >
                        <div className="aspect-square bg-zinc-100 dark:bg-zinc-800">
                          <ResilientStoreImage
                            urls={catalogItemImageList(sim)}
                            index={0}
                            alt=""
                            category={sim.category}
                            subCategory={sim.subCategory}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <p className="p-2 text-[10px] font-semibold line-clamp-2">{sim.name}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={`shrink-0 p-6 sm:p-8 border-t sticky bottom-0 ${darkMode ? 'border-zinc-800 bg-zinc-950/95 backdrop-blur' : 'border-zinc-200 bg-white/95 backdrop-blur'}`}>
              <button
                type="button"
                onClick={onContact}
                className="w-full py-4 rounded-full bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 transition-colors inline-flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20"
              >
                <MessageCircle size={18} />
                {texts.contact}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;
