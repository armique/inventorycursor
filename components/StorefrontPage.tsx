import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Loader2, Package, SlidersHorizontal } from 'lucide-react';
import { parseLocaleNumber } from '../utils/formatMoney';
import { isUsableProductImageUrl } from '../services/storefrontImageUtils';
import {
  subscribeToStoreCatalog,
  createStoreInquiry,
  subscribeToStorefrontConfig,
  DEFAULT_STOREFRONT_CONFIG,
  type StoreCatalogPayload,
  type StorefrontConfig,
  type StorefrontBlockId,
} from '../services/firebaseService';
import LegalModal, { type LegalModalType } from './LegalModal';
import AboutContactModal from './AboutContactModal';
import CookieConsent, { getCookieConsentAccepted } from './CookieConsent';
import { getWishlistIds, toggleWishlistId, getRecentlyViewedIds, addRecentlyViewedId } from '../utils/storefrontStorage';

import StorefrontHeader from './storefront/StorefrontHeader';
import StorefrontHero from './storefront/StorefrontHero';
import StorefrontCategoryGrid from './storefront/StorefrontCategoryGrid';
import StorefrontPromoCarousel from './storefront/StorefrontPromoCarousel';
import StorefrontTrustRow from './storefront/StorefrontTrustRow';
import StorefrontFiltersSidebar, { StorefrontFiltersDrawer } from './storefront/StorefrontFilters';
import ProductCard from './storefront/ProductCard';
import ProductDetailModal from './storefront/ProductDetailModal';
import ContactInquiryModal from './storefront/ContactInquiryModal';
import StorefrontFooter from './storefront/StorefrontFooter';
import { TEXTS_DE, TEXTS_EN, getItemDescription } from './storefront/storefrontTexts';
import {
  catalogItemImageList,
  priceDisplay,
  hasActiveFilters,
  clearFilters,
  type StoreItem,
  type FilterState,
} from './storefront/storefrontUtils';

const DEFAULT_TITLE = 'ArmikTech – armiktech.com';
const DEFAULT_DESCRIPTION = 'ArmikTech – Technik und mehr. Durchstöbern Sie unseren Shop.';

function ProductGridSkeleton({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className={`rounded-2xl border overflow-hidden animate-pulse ${
            darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
          }`}
        >
          <div className={`aspect-[4/3] ${darkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`} />
          <div className="p-5 space-y-3">
            <div className={`h-3 rounded w-1/3 ${darkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`} />
            <div className={`h-5 rounded w-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`} />
            <div className={`h-10 rounded w-full mt-4 ${darkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

const StorefrontPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: itemIdFromUrl } = useParams<{ id: string }>();

  const [catalog, setCatalog] = useState<StoreCatalogPayload | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig>(DEFAULT_STOREFRONT_CONFIG);
  const [filters, setFilters] = useState<FilterState>({
    tab: 'all',
    categoryFilter: '',
    subCategoryFilter: '',
    minPrice: '',
    maxPrice: '',
    search: '',
    sortBy: 'default',
    viewMode: 'grid',
  });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [modalItem, setModalItem] = useState<StoreItem | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [galleryItem, setGalleryItem] = useState<StoreItem | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalModalType | null>(null);
  const [aboutContactModal, setAboutContactModal] = useState<'about' | 'contact' | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('armiktech_dark') === '1'; } catch { return false; }
  });
  const [wishlistIds, setWishlistIdsState] = useState<string[]>(() => getWishlistIds());
  const [recentKey, setRecentKey] = useState(0);
  const [lang, setLang] = useState<'de' | 'en'>(() => {
    try { return (localStorage.getItem('armiktech_lang') as 'de' | 'en') || 'de'; } catch { return 'de'; }
  });

  const TEXTS = lang === 'en' ? TEXTS_EN : TEXTS_DE;
  const patchFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);
  const handleClearFilters = useCallback(() => {
    setFilters((f) => ({ ...f, ...clearFilters() }));
  }, []);

  useEffect(() => {
    const unsub = subscribeToStoreCatalog((data) => {
      setCatalog(data);
      setCatalogLoaded(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToStorefrontConfig((data) => {
      setStorefrontConfig(data ?? DEFAULT_STOREFRONT_CONFIG);
    });
    return () => unsub();
  }, []);

  const closeGallery = useCallback(() => {
    setGalleryItem(null);
    if (itemIdFromUrl) navigate('/');
  }, [itemIdFromUrl, navigate]);

  useEffect(() => {
    if (!galleryItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGallery();
      else if (e.key === 'ArrowLeft') {
        const imgs = catalogItemImageList(galleryItem);
        if (imgs.length > 1) setGalleryIndex((i) => (i - 1 + imgs.length) % imgs.length);
      } else if (e.key === 'ArrowRight') {
        const imgs = catalogItemImageList(galleryItem);
        if (imgs.length > 1) setGalleryIndex((i) => (i + 1) % imgs.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryItem, closeGallery]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('armiktech_dark', darkMode ? '1' : '0'); } catch {}
  }, [darkMode]);

  useEffect(() => {
    try { localStorage.setItem('armiktech_lang', lang); } catch {}
  }, [lang]);

  useEffect(() => {
    if (!galleryItem) {
      document.title = DEFAULT_TITLE;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', DEFAULT_DESCRIPTION);
      return;
    }
    const title = (galleryItem.storeMetaTitle || galleryItem.name).trim() + ' | ArmikTech';
    const description = (galleryItem.storeMetaDescription || getItemDescription(galleryItem, lang) || '').trim().slice(0, 160) || DEFAULT_DESCRIPTION;
    document.title = title;
    let descEl = document.querySelector('meta[name="description"]');
    if (!descEl) { descEl = document.createElement('meta'); descEl.setAttribute('name', 'description'); document.head.appendChild(descEl); }
    descEl.setAttribute('content', description);
  }, [galleryItem, lang]);

  const items = useMemo(() => (catalog?.items ?? []).filter((i) => i.storeVisible !== false), [catalog]);
  const saleCount = useMemo(() => items.filter((i) => i.storeOnSale).length, [items]);

  useEffect(() => {
    if (!catalogLoaded) return;
    document.title = items.length > 0 ? `ArmikTech — ${items.length} PC parts` : 'ArmikTech — PC parts store';
  }, [catalogLoaded, items.length]);

  useEffect(() => {
    if (!catalogLoaded || !itemIdFromUrl || items.length === 0) return;
    const item = items.find((i) => i.id === itemIdFromUrl);
    if (item) setGalleryItem(item);
  }, [catalogLoaded, itemIdFromUrl, items]);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      if (!i.category) continue;
      counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    }
    return categories.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [items, categories]);

  const scrollToProducts = useCallback(() => {
    document.getElementById('bestsellers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goToCategory = useCallback((category: string) => {
    patchFilters({ categoryFilter: category, subCategoryFilter: '' });
    scrollToProducts();
  }, [patchFilters, scrollToProducts]);
  const subCategories = useMemo(() => {
    if (!filters.categoryFilter) return [];
    return Array.from(new Set(items.filter((i) => i.category === filters.categoryFilter).map((i) => i.subCategory).filter(Boolean))).sort() as string[];
  }, [items, filters.categoryFilter]);

  const breadcrumbCounts = useMemo(() => ({
    total: items.length,
    inCategory: filters.categoryFilter ? items.filter((i) => i.category === filters.categoryFilter).length : 0,
    inSubCategory: filters.categoryFilter && filters.subCategoryFilter
      ? items.filter((i) => i.category === filters.categoryFilter && i.subCategory === filters.subCategoryFilter).length
      : 0,
  }), [items, filters.categoryFilter, filters.subCategoryFilter]);

  const similarItems = useMemo(() => {
    if (!galleryItem) return [];
    return items.filter((i) => i.id !== galleryItem.id && (i.category === galleryItem.category || i.subCategory === galleryItem.subCategory)).slice(0, 4);
  }, [galleryItem, items]);

  const recentlyViewedItems = useMemo(() => {
    return getRecentlyViewedIds().map((id) => items.find((i) => i.id === id)).filter(Boolean) as StoreItem[];
  }, [items, recentKey]);

  const filtered = useMemo(() => {
    let list = items;
    if (filters.tab === 'sale') list = list.filter((i) => i.storeOnSale);
    if (filters.categoryFilter) list = list.filter((i) => i.category === filters.categoryFilter);
    if (filters.subCategoryFilter) list = list.filter((i) => i.subCategory === filters.subCategoryFilter);
    const min = filters.minPrice ? parseLocaleNumber(filters.minPrice) : NaN;
    const max = filters.maxPrice ? parseLocaleNumber(filters.maxPrice) : NaN;
    if (!Number.isNaN(min)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) >= min);
    if (!Number.isNaN(max)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) <= max);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q) || (i.subCategory || '').toLowerCase().includes(q));
    }
    return list;
  }, [items, filters]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    if (filters.sortBy === 'priceAsc') list.sort((a, b) => ((a.storeOnSale ? a.storeSalePrice : a.sellPrice) ?? Infinity) - ((b.storeOnSale ? b.storeSalePrice : b.sellPrice) ?? Infinity));
    if (filters.sortBy === 'priceDesc') list.sort((a, b) => ((b.storeOnSale ? b.storeSalePrice : b.sellPrice) ?? -Infinity) - ((a.storeOnSale ? a.storeSalePrice : a.sellPrice) ?? -Infinity));
    if (filters.sortBy === 'nameAsc') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [filtered, filters.sortBy]);

  const filterProps = {
    texts: TEXTS,
    darkMode,
    filters,
    categories,
    subCategories,
    breadcrumbCounts,
    onChange: patchFilters,
    onClear: handleClearFilters,
    active: hasActiveFilters(filters),
  };

  const openContact = (item: StoreItem) => {
    setModalItem(item);
    setForm({ name: '', email: '', phone: '', message: '' });
    setSent(false);
  };

  const handleOpenDetails = (item: StoreItem) => {
    addRecentlyViewedId(item.id);
    setRecentKey((k) => k + 1);
    setGalleryIndex(0);
    setGalleryItem(item);
    navigate(`/item/${item.id}`);
  };

  const handleSend = async () => {
    if (!modalItem) return;
    setSending(true);
    try {
      await createStoreInquiry({
        itemId: modalItem.id,
        itemName: modalItem.name,
        message: form.message || '(Keine Nachricht)',
        contactName: form.name || undefined,
        contactEmail: form.email || undefined,
        contactPhone: form.phone || undefined,
      });
      setSent(true);
    } catch {
      setSent(false);
      alert(TEXTS.sendError);
    } finally {
      setSending(false);
    }
  };

  const shareItem = (item: StoreItem) => {
    const u = `${window.location.origin}/item/${item.id}`;
    if (navigator.share) navigator.share({ title: item.name, url: u });
    else navigator.clipboard.writeText(u);
  };

  const showLoading = !catalogLoaded;
  const showEmptyCatalog = catalogLoaded && items.length === 0;
  const showNoResults = catalogLoaded && items.length > 0 && sortedFiltered.length === 0;

  // --- Storefront configurator: derived, config-driven data ---
  const orderedBlocks = useMemo(
    () => [...storefrontConfig.blocks].sort((a, b) => a.order - b.order),
    [storefrontConfig.blocks]
  );
  const activePromoAds = useMemo(
    () => storefrontConfig.promoAds.filter((a) => a.visible && !a.archived),
    [storefrontConfig.promoAds]
  );
  const DEFAULT_TRUST_FALLBACK: Record<string, { title: string; description: string }> = {
    'trust-checked': { title: TEXTS.trustCheckedTitle, description: TEXTS.trustCheckedDesc },
    'trust-direct': { title: TEXTS.trustDirectTitle, description: TEXTS.trustDirectDesc },
    'trust-fair': { title: TEXTS.trustFairTitle, description: TEXTS.trustFairDesc },
    'trust-support': { title: TEXTS.trustSupportTitle, description: TEXTS.trustSupportDesc },
  };
  const activeTrustItems = useMemo(
    () => storefrontConfig.trustItems
      .filter((t) => t.visible && !t.archived)
      .map((t) => ({
        id: t.id,
        icon: t.icon,
        title: t.title || DEFAULT_TRUST_FALLBACK[t.id]?.title || t.title,
        description: t.description || DEFAULT_TRUST_FALLBACK[t.id]?.description || t.description,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storefrontConfig.trustItems, lang]
  );

  const renderBlock = (id: StorefrontBlockId): React.ReactNode => {
    switch (id) {
      case 'hero':
        return (
          <StorefrontHero
            key="hero"
            texts={TEXTS}
            darkMode={darkMode}
            search={filters.search}
            onSearchChange={(search) => patchFilters({ search })}
            tab={filters.tab}
            onTabChange={(tab) => patchFilters({ tab })}
            itemCount={items.length}
            saleCount={saleCount}
            subtitleOverride={storefrontConfig.hero.subtitle}
            ctaLabelOverride={storefrontConfig.hero.ctaLabel}
            ctaSaleLabelOverride={storefrontConfig.hero.ctaSaleLabel}
          />
        );
      case 'categoryGrid':
        return (
          <StorefrontCategoryGrid
            key="categoryGrid"
            texts={TEXTS}
            darkMode={darkMode}
            categories={categoryCounts}
            onSelect={goToCategory}
            headingOverride={storefrontConfig.categoryGrid.heading}
            subheadingOverride={storefrontConfig.categoryGrid.subheading}
          />
        );
      case 'promoAds':
        return activePromoAds.length > 0 ? (
          <StorefrontPromoCarousel
            key="promoAds"
            ads={activePromoAds}
            texts={TEXTS}
            darkMode={darkMode}
            onContact={() => setAboutContactModal('contact')}
          />
        ) : null;
      case 'bestSellers':
        return (
          <div id="bestsellers" key="bestSellers" className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-10 flex gap-8 flex-1">
            <StorefrontFiltersSidebar {...filterProps} className="hidden lg:block w-64 shrink-0 self-start" />

            <main className="flex-1 min-w-0">
              <div className="mb-6">
                <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
                  {storefrontConfig.bestSellers.heading || TEXTS.bestsellersHeading}
                </h2>
                <p className={`text-sm mt-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {storefrontConfig.bestSellers.subheading || TEXTS.bestsellersSub}
                </p>
              </div>

              {categories.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
                  <button
                    type="button"
                    onClick={() => patchFilters({ categoryFilter: '', subCategoryFilter: '' })}
                    className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                      !filters.categoryFilter
                        ? darkMode ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 text-white border-zinc-900'
                        : darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                    }`}
                  >
                    {TEXTS.all}
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patchFilters({ categoryFilter: c, subCategoryFilter: '' })}
                      className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                        filters.categoryFilter === c
                          ? darkMode ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 text-white border-zinc-900'
                          : darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                  {!showLoading && sortedFiltered.length > 0 && (
                    <>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                        darkMode ? 'bg-brand-500/20 text-brand-400' : 'bg-brand-50 text-brand-700'
                      }`}>
                        {sortedFiltered.length}
                      </span>
                      <span className={`text-sm font-medium ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
                        {TEXTS.results}
                      </span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className={`lg:hidden inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                    darkMode ? 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800' : 'border-zinc-200 bg-white hover:bg-zinc-50 shadow-sm'
                  }`}
                >
                  <SlidersHorizontal size={16} />
                  {TEXTS.filters}
                  {hasActiveFilters(filters) && (
                    <span className="w-2 h-2 rounded-full bg-brand-500" />
                  )}
                </button>
              </div>

              {showLoading && (
                <div className="space-y-8">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Loader2 size={32} className={`animate-spin mb-4 ${darkMode ? 'text-brand-400' : 'text-brand-600'}`} />
                    <p className={`font-medium ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>{TEXTS.loading}</p>
                  </div>
                  <ProductGridSkeleton darkMode={darkMode} />
                </div>
              )}

              {showEmptyCatalog && (
                <div className="flex flex-col items-center justify-center py-24 text-center max-w-md mx-auto">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${darkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                    <Package size={32} className={darkMode ? 'text-zinc-500' : 'text-zinc-400'} />
                  </div>
                  <h2 className={`text-xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{TEXTS.emptyTitle}</h2>
                  <p className={`text-sm leading-relaxed mb-8 ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>{TEXTS.noCatalog}</p>
                </div>
              )}

              {showNoResults && (
                <div className={`flex flex-col items-center justify-center py-24 text-center rounded-2xl border p-8 ${
                  darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200 shadow-card'
                }`}>
                  <p className={`font-semibold ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>{TEXTS.noItems}</p>
                  <p className={`text-sm mt-2 ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>{TEXTS.resetHint}</p>
                  <button type="button" onClick={handleClearFilters} className="mt-6 px-5 py-2.5 rounded-full bg-brand-600 text-white text-sm font-bold hover:bg-brand-700">
                    {TEXTS.clearFilters}
                  </button>
                </div>
              )}

              {catalogLoaded && sortedFiltered.length > 0 && (
                <>
                  <div className={filters.viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5' : 'space-y-4'}>
                    {sortedFiltered.map((item) => (
                      <ProductCard
                        key={item.id}
                        item={item}
                        priceDisplay={priceDisplay(item)}
                        texts={TEXTS}
                        lang={lang}
                        darkMode={darkMode}
                        onContact={() => openContact(item)}
                        onDetailsClick={() => handleOpenDetails(item)}
                        layout={filters.viewMode}
                        isInWishlist={wishlistIds.includes(item.id)}
                        onToggleWishlist={() => { toggleWishlistId(item.id); setWishlistIdsState(getWishlistIds()); }}
                        onShare={() => shareItem(item)}
                      />
                    ))}
                  </div>

                  {recentlyViewedItems.length > 0 && (
                    <section className="mt-16 pt-10 border-t border-zinc-200/80 dark:border-zinc-800">
                      <h2 className={`text-lg font-bold mb-5 ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{TEXTS.recentlyViewed}</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                        {recentlyViewedItems.slice(0, 3).map((item) => (
                          <ProductCard
                            key={item.id}
                            item={item}
                            priceDisplay={priceDisplay(item)}
                            texts={TEXTS}
                            lang={lang}
                            darkMode={darkMode}
                            onContact={() => openContact(item)}
                            onDetailsClick={() => handleOpenDetails(item)}
                            layout="grid"
                            isInWishlist={wishlistIds.includes(item.id)}
                            onToggleWishlist={() => { toggleWishlistId(item.id); setWishlistIdsState(getWishlistIds()); }}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </main>
          </div>
        );
      case 'trustRow':
        return <StorefrontTrustRow key="trustRow" darkMode={darkMode} items={activeTrustItems} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col antialiased storefront-page ${
        darkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'
      }`}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
    >
      <style>{`
        @keyframes storefrontFadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <StorefrontHeader
        texts={TEXTS}
        lang={lang}
        onLangChange={setLang}
        darkMode={darkMode}
        onDarkModeToggle={() => setDarkMode((d) => !d)}
        wishlistCount={wishlistIds.length}
        onHome={() => { navigate('/'); setGalleryItem(null); patchFilters(clearFilters()); }}
        categories={categories}
        onCategoryClick={goToCategory}
      />

      {orderedBlocks.filter((b) => b.visible).map((b) => renderBlock(b.id))}

      <StorefrontFooter
        texts={TEXTS}
        darkMode={darkMode}
        onAbout={() => setAboutContactModal('about')}
        onContact={() => setAboutContactModal('contact')}
        onLegal={setLegalModal}
      />

      <StorefrontFiltersDrawer {...filterProps} open={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} />

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 hover:scale-105 transition-all flex items-center justify-center"
          aria-label={TEXTS.backToTop}
        >
          <ArrowUp size={18} />
        </button>
      )}

      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} closeLabel={TEXTS.close} />}

      {modalItem && (
        <ContactInquiryModal
          item={modalItem}
          texts={TEXTS}
          darkMode={darkMode}
          form={form}
          onFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          sending={sending}
          sent={sent}
          onSend={handleSend}
          onClose={() => !sending && setModalItem(null)}
        />
      )}

      {galleryItem && (
        <ProductDetailModal
          item={galleryItem}
          similarItems={similarItems}
          texts={TEXTS}
          lang={lang}
          darkMode={darkMode}
          galleryIndex={galleryIndex}
          onGalleryIndexChange={setGalleryIndex}
          onClose={closeGallery}
          onContact={() => { closeGallery(); openContact(galleryItem); }}
          onSelectSimilar={(sim) => {
            addRecentlyViewedId(sim.id);
            setRecentKey((k) => k + 1);
            setGalleryIndex(0);
            setGalleryItem(sim);
            navigate(`/item/${sim.id}`);
          }}
        />
      )}

      {aboutContactModal && (
        <AboutContactModal
          type={aboutContactModal}
          onClose={() => setAboutContactModal(null)}
          onOpenPrivacy={() => { setAboutContactModal(null); setLegalModal('datenschutz'); }}
        />
      )}

      {!getCookieConsentAccepted() && (
        <CookieConsent onAccept={() => {}} onPrivacyClick={() => setLegalModal('datenschutz')} />
      )}

      {catalogLoaded && items.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              itemListElement: items.slice(0, 20).map((item, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                item: {
                  '@type': 'Product',
                  name: item.name,
                  description: getItemDescription(item, lang) || item.name,
                  image: isUsableProductImageUrl(item.imageUrl) ? item.imageUrl : catalogItemImageList(item)[0],
                  category: item.category,
                  offers: item.sellPrice != null ? { '@type': 'Offer', price: item.sellPrice, priceCurrency: 'EUR' } : undefined,
                },
              })),
            }),
          }}
        />
      )}
    </div>
  );
};

export default StorefrontPage;
