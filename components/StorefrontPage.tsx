import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MessageCircle, ChevronLeft, ChevronRight, Tag, X, Send, Loader2, Package, Sparkles, LayoutGrid, List, ArrowUp, FileText, Share2, Heart, Moon, Sun, Search as SearchIcon, SlidersHorizontal, Home } from 'lucide-react';
import { subscribeToStoreCatalog, createStoreInquiry, type StoreCatalogPayload } from '../services/firebaseService';
import { useNavigate, useParams } from 'react-router-dom';
import LegalModal, { type LegalModalType } from './LegalModal';
import AboutContactModal from './AboutContactModal';
import CookieConsent, { getCookieConsentAccepted } from './CookieConsent';
import { getWishlistIds, setWishlistIds, toggleWishlistId, getRecentlyViewedIds, addRecentlyViewedId } from '../utils/storefrontStorage';

const TEXTS_DE = {
  title: 'ArmikTech',
  sale: 'Sale',
  all: 'Alle',
  category: 'Kategorie',
  price: 'Preis',
  minPrice: 'Min €',
  maxPrice: 'Max €',
  search: 'Suchen…',
  noItems: 'Keine Artikel gefunden.',
  priceOnRequest: 'Preis auf Anfrage',
  loading: 'Katalog wird geladen…',
  noCatalog: 'Noch keine Artikel bei ArmikTech.',
  contact: 'Anfrage senden',
  aboutItem: 'Anfrage zu diesem Artikel',
  yourName: 'Ihr Name',
  yourEmail: 'E-Mail',
  yourPhone: 'Telefon',
  yourMessage: 'Nachricht',
  send: 'Senden',
  sent: 'Nachricht gesendet.',
  sendError: 'Fehler beim Senden.',
  close: 'Schließen',
  specs: 'Technische Daten',
  onSale: 'Angebot',
  sort: 'Sortieren',
  toHome: 'Zur Startseite',
  priceLow: 'Preis aufsteigend',
  priceHigh: 'Preis absteigend',
  nameAz: 'Name A–Z',
  results: 'Ergebnisse',
  viewDetails: 'Details anzeigen',
  readDescription: 'Beschreibung lesen',
  backToTop: 'Nach oben',
  keyFeatures: 'Was ist drin?',
  keySpecs: 'Eigenschaften',
  aboutUs: 'Über uns',
  contactLink: 'Kontakt',
  imprint: 'Impressum',
  privacy: 'Datenschutz',
  terms: 'AGB',
  legal: 'Alle Rechte vorbehalten. Alle genannten Marken gehören den jeweiligen Rechteinhabern.',
  wishlist: 'Merkliste',
  addToWishlist: 'Zur Merkliste',
  removeFromWishlist: 'Aus Merkliste',
  share: 'Teilen',
  similarItems: 'Ähnliche Artikel',
  recentlyViewed: 'Zuletzt angesehen',
  home: 'Start',
  badgeNew: 'Neu',
  badgePriceReduced: 'Preis reduziert',
  onlyOneLeft: 'Nur noch 1',
  outOfStock: 'Ausverkauft',
  langDe: 'DE',
  langEn: 'EN',
};

function getItemDescription(item: { storeDescription?: string; storeDescriptionEn?: string }, lang: 'de' | 'en'): string | undefined {
  if (lang === 'en' && item.storeDescriptionEn) return item.storeDescriptionEn;
  return item.storeDescription;
}

const TEXTS_EN = {
  title: 'ArmikTech',
  sale: 'Sale',
  all: 'All',
  category: 'Category',
  price: 'Price',
  minPrice: 'Min €',
  maxPrice: 'Max €',
  search: 'Search…',
  noItems: 'No items found.',
  priceOnRequest: 'Price on request',
  loading: 'Loading catalog…',
  noCatalog: 'No items at ArmikTech yet.',
  contact: 'Contact',
  aboutItem: 'Inquiry about this item',
  yourName: 'Your name',
  yourEmail: 'Email',
  yourPhone: 'Phone',
  yourMessage: 'Message',
  send: 'Send',
  sent: 'Message sent.',
  sendError: 'Error sending.',
  close: 'Close',
  specs: 'Specifications',
  onSale: 'Sale',
  sort: 'Sort',
  toHome: 'Home',
  priceLow: 'Price ascending',
  priceHigh: 'Price descending',
  nameAz: 'Name A–Z',
  results: 'Results',
  viewDetails: 'View details',
  readDescription: 'Read description',
  backToTop: 'Back to top',
  keyFeatures: 'What\'s inside?',
  keySpecs: 'Features',
  aboutUs: 'About us',
  contactLink: 'Contact',
  imprint: 'Imprint',
  privacy: 'Privacy',
  terms: 'Terms',
  legal: 'All rights reserved. All trademarks belong to their respective owners.',
  wishlist: 'Wishlist',
  addToWishlist: 'Add to wishlist',
  removeFromWishlist: 'Remove from wishlist',
  share: 'Share',
  similarItems: 'Similar items',
  recentlyViewed: 'Recently viewed',
  home: 'Home',
  badgeNew: 'New',
  badgePriceReduced: 'Price reduced',
  onlyOneLeft: 'Only 1 left',
  outOfStock: 'Out of stock',
  langDe: 'DE',
  langEn: 'EN',
};

/** Preferred order for PC/build-style specs so CPU, GPU, RAM etc. show first. */
const PREFERRED_SPEC_ORDER = [
  'CPU', 'Prozessor', 'Processor', 'GPU', 'Grafikkarte', 'Graphics', 'RAM', 'Memory', 'Speicher',
  'Motherboard', 'Mainboard', 'Board', 'Storage', 'SSD', 'HDD', 'Festplatte', 'PSU', 'Netzteil', 'Power',
  'Case', 'Gehäuse', 'Cooler', 'Kühler', 'CPU Cooler', 'Cores', 'Threads', 'Socket', 'Chipset',
  'VRAM', 'TDP', 'Base Clock', 'Boost Clock', 'Form Factor', 'Capacity', 'Speed', 'Type',
];

function orderedSpecKeys(specs: Record<string, string | number>, categoryFields?: string[]): string[] {
  const keys = Object.keys(specs);
  if (categoryFields?.length) {
    const ordered = categoryFields.filter((k) => specs[k] != null);
    const rest = keys.filter((k) => !ordered.includes(k));
    return [...ordered, ...rest.sort()];
  }
  return keys.sort((a, b) => {
    const ia = PREFERRED_SPEC_ORDER.findIndex((p) => a.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(a.toLowerCase()));
    const ib = PREFERRED_SPEC_ORDER.findIndex((p) => b.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(b.toLowerCase()));
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

type StoreItem = NonNullable<StoreCatalogPayload['items']>[number];

const StorefrontPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: itemIdFromUrl } = useParams<{ id: string }>();
  const [catalog, setCatalog] = useState<StoreCatalogPayload | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [tab, setTab] = useState<'all' | 'sale'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [modalItem, setModalItem] = useState<StoreItem | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'priceAsc' | 'priceDesc' | 'nameAsc'>('default');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [galleryItem, setGalleryItem] = useState<StoreItem | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalModalType | null>(null);
  const [aboutContactModal, setAboutContactModal] = useState<'about' | 'contact' | null>(null);
  const [cookieConsent, setCookieConsent] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('armiktech_dark') === '1'; } catch { return false; }
  });
  const [wishlistIds, setWishlistIdsState] = useState<string[]>(() => getWishlistIds());
  const [recentKey, setRecentKey] = useState(0);
  const [lang, setLang] = useState<'de' | 'en'>(() => {
    try { return (localStorage.getItem('armiktech_lang') as 'de' | 'en') || 'de'; } catch { return 'de'; }
  });
  const TEXTS = lang === 'en' ? TEXTS_EN : TEXTS_DE;

  useEffect(() => {
    const unsub = subscribeToStoreCatalog((data) => {
      setCatalog(data);
      setCatalogLoaded(true);
    });
    return () => unsub();
  }, []);

  const closeGallery = useCallback(() => {
    setGalleryItem(null);
    if (itemIdFromUrl) navigate('/');
  }, [itemIdFromUrl, navigate]);

  // Keyboard navigation for gallery
  useEffect(() => {
    if (!galleryItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeGallery();
      } else if (e.key === 'ArrowLeft') {
        const galleryImages: string[] = [];
        if (galleryItem.imageUrl) galleryImages.push(galleryItem.imageUrl);
        if (galleryItem.storeGalleryUrls?.length) galleryImages.push(...galleryItem.storeGalleryUrls);
        if (galleryImages.length > 1) {
          setGalleryIndex((i) => (i - 1 + galleryImages.length) % galleryImages.length);
        }
      } else if (e.key === 'ArrowRight') {
        const galleryImages: string[] = [];
        if (galleryItem.imageUrl) galleryImages.push(galleryItem.imageUrl);
        if (galleryItem.storeGalleryUrls?.length) galleryImages.push(...galleryItem.storeGalleryUrls);
        if (galleryImages.length > 1) {
          setGalleryIndex((i) => (i + 1) % galleryImages.length);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryItem, galleryIndex, closeGallery]);

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

  // Per-item meta title/description for SEO and sharing when item detail is open
  const DEFAULT_TITLE = 'ArmikTech – armiktech.com';
  const DEFAULT_DESCRIPTION = 'ArmikTech – Technik und mehr. Durchstöbern Sie unseren Shop.';
  useEffect(() => {
    if (!galleryItem) {
      document.title = DEFAULT_TITLE;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', DEFAULT_DESCRIPTION);
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', DEFAULT_TITLE);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', DEFAULT_DESCRIPTION);
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) ogImage.removeAttribute('content');
      return;
    }
    const title = (galleryItem.storeMetaTitle || galleryItem.name).trim() + ' | ArmikTech';
    const description = (galleryItem.storeMetaDescription || getItemDescription(galleryItem, lang) || '').trim().slice(0, 160) || DEFAULT_DESCRIPTION;
    document.title = title;
    let desc = document.querySelector('meta[name="description"]');
    if (!desc) { desc = document.createElement('meta'); desc.setAttribute('name', 'description'); document.head.appendChild(desc); }
    desc.setAttribute('content', description);
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) { ogTitle = document.createElement('meta'); ogTitle.setAttribute('property', 'og:title'); document.head.appendChild(ogTitle); }
    ogTitle.setAttribute('content', title);
    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (!ogDesc) { ogDesc = document.createElement('meta'); ogDesc.setAttribute('property', 'og:description'); document.head.appendChild(ogDesc); }
    ogDesc.setAttribute('content', description);
    const img = galleryItem.imageUrl || (galleryItem.storeGalleryUrls && galleryItem.storeGalleryUrls[0]);
    if (img) {
      let ogImage = document.querySelector('meta[property="og:image"]');
      if (!ogImage) { ogImage = document.createElement('meta'); ogImage.setAttribute('property', 'og:image'); document.head.appendChild(ogImage); }
      ogImage.setAttribute('content', img);
    }
    return () => {
      document.title = DEFAULT_TITLE;
      const d = document.querySelector('meta[name="description"]');
      if (d) d.setAttribute('content', DEFAULT_DESCRIPTION);
    };
  }, [galleryItem, lang]);

  const handleToggleWishlist = (itemId: string) => {
    const added = toggleWishlistId(itemId);
    setWishlistIdsState(getWishlistIds());
  };

  const handleOpenDetails = (item: StoreItem) => {
    addRecentlyViewedId(item.id);
    setRecentKey((k) => k + 1);
    setGalleryIndex(0);
    setGalleryItem(item);
    navigate(`/item/${item.id}`);
  };

  const items = useMemo(() => catalog?.items ?? [], [catalog]);

  // Open item detail when URL is /item/:id and catalog is loaded
  useEffect(() => {
    if (!catalogLoaded || !itemIdFromUrl || items.length === 0) return;
    const item = items.find((i) => i.id === itemIdFromUrl);
    if (item) setGalleryItem(item);
  }, [catalogLoaded, itemIdFromUrl, items]);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items]);
  const subCategories = useMemo(() => {
    if (!categoryFilter) return [];
    return Array.from(new Set(items.filter((i) => i.category === categoryFilter).map((i) => i.subCategory).filter(Boolean))).sort() as string[];
  }, [items, categoryFilter]);

  const similarItems = useMemo(() => {
    if (!galleryItem || !items.length) return [];
    return items
      .filter((i) => i.id !== galleryItem.id && (i.category === galleryItem.category || i.subCategory === galleryItem.subCategory))
      .slice(0, 3);
  }, [galleryItem, items]);

  /** Breadcrumb counts: total, per category, per subcategory. */
  const breadcrumbCounts = useMemo(() => {
    const total = items.length;
    const inCategory = categoryFilter ? items.filter((i) => i.category === categoryFilter).length : 0;
    const inSubCategory = categoryFilter && subCategoryFilter
      ? items.filter((i) => i.category === categoryFilter && i.subCategory === subCategoryFilter).length
      : 0;
    return { total, inCategory, inSubCategory };
  }, [items, categoryFilter, subCategoryFilter]);

  const recentlyViewedItems = useMemo(() => {
    const ids = getRecentlyViewedIds();
    return ids.map((id) => items.find((i) => i.id === id)).filter(Boolean) as StoreItem[];
  }, [items, recentKey]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'sale') list = list.filter((i) => i.storeOnSale);
    if (categoryFilter) list = list.filter((i) => i.category === categoryFilter);
    if (subCategoryFilter) list = list.filter((i) => i.subCategory === subCategoryFilter);
    const min = minPrice ? parseFloat(minPrice) : NaN;
    const max = maxPrice ? parseFloat(maxPrice) : NaN;
    if (!Number.isNaN(min)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) >= min);
    if (!Number.isNaN(max)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) <= max);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q) || (i.subCategory || '').toLowerCase().includes(q));
    }
    return list;
  }, [items, tab, categoryFilter, subCategoryFilter, minPrice, maxPrice, search]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'priceAsc') list.sort((a, b) => ((a.storeOnSale ? a.storeSalePrice : a.sellPrice) ?? Infinity) - ((b.storeOnSale ? b.storeSalePrice : b.sellPrice) ?? Infinity));
    if (sortBy === 'priceDesc') list.sort((a, b) => ((b.storeOnSale ? b.storeSalePrice : b.sellPrice) ?? -Infinity) - ((a.storeOnSale ? a.storeSalePrice : a.sellPrice) ?? -Infinity));
    if (sortBy === 'nameAsc') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [filtered, sortBy]);

  const openContact = (item: StoreItem) => {
    setModalItem(item);
    setForm({ name: '', email: '', phone: '', message: '' });
    setSent(false);
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

  const priceDisplay = (item: StoreItem) => {
    const sale = item.storeOnSale && item.storeSalePrice != null;
    const value = sale ? item.storeSalePrice! : (item.sellPrice ?? undefined);
    const hasPrice = value != null && value > 0;
    return { value: value ?? 0, sale, hasPrice };
  };

  const showLoading = !catalogLoaded;
  const showEmptyCatalog = catalogLoaded && items.length === 0;
  const showNoResults = catalogLoaded && items.length > 0 && filtered.length === 0;

  return (
    <div className={`min-h-screen flex flex-col antialiased storefront-page ${darkMode ? 'bg-slate-900 text-slate-200' : 'bg-gradient-to-b from-slate-50 via-white to-slate-50/80 text-slate-900'}`} style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {/* Header */}
      <header className={`sticky top-0 z-50 backdrop-blur-xl border-b shadow-sm ${darkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-white/90 border-slate-200/80'}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <button type="button" onClick={() => navigate('/')} className={`text-xl font-bold tracking-tight transition-colors ${darkMode ? 'text-white hover:text-slate-300' : 'text-slate-900 hover:text-slate-600'}`}>
            {TEXTS.title}
          </button>
          <nav className="flex items-center gap-1 sm:gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
              <button type="button" onClick={() => setLang('de')} className={`px-2.5 py-1.5 text-xs font-semibold ${lang === 'de' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`} aria-label="Deutsch">DE</button>
              <button type="button" onClick={() => setLang('en')} className={`px-2.5 py-1.5 text-xs font-semibold ${lang === 'en' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`} aria-label="English">EN</button>
            </div>
            <button type="button" onClick={() => setDarkMode((d) => !d)} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300" aria-label={darkMode ? 'Hell' : 'Dunkel'}>
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'all' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              {TEXTS.all}
            </button>
            <button
              type="button"
              onClick={() => setTab('sale')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 ${tab === 'sale' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-600 hover:bg-rose-50 hover:text-rose-700'}`}
            >
              <Tag size={14} strokeWidth={2.2} /> {TEXTS.sale}
            </button>
          </nav>
        </div>
      </header>

      {/* Compact filters bar */}
      {(() => {
        const hasActiveFilters = tab === 'sale' || categoryFilter || subCategoryFilter || minPrice !== '' || maxPrice !== '' || search.trim() !== '';
        const clearAll = () => {
          setTab('all');
          setCategoryFilter('');
          setSubCategoryFilter('');
          setMinPrice('');
          setMaxPrice('');
          setSearch('');
        };
        return (
          <section className={`sticky top-[57px] z-40 border-b ${darkMode ? 'bg-slate-800/95 border-slate-700' : 'bg-white/95 border-slate-200/80'} backdrop-blur-sm`}>
            <div className="mx-auto max-w-6xl px-3 sm:px-6 py-2">
              {/* Breadcrumbs: Home → Category → SubCategory with counts */}
              <nav className="flex items-center gap-1 text-xs mb-2 min-h-[20px]" aria-label="Breadcrumb">
                <button
                  type="button"
                  onClick={() => { setCategoryFilter(''); setSubCategoryFilter(''); }}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 -ml-1.5 transition-colors ${categoryFilter || subCategoryFilter ? (darkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200') : (darkMode ? 'text-slate-300 font-medium' : 'text-slate-700 font-medium')}`}
                >
                  <Home size={12} strokeWidth={2} />
                  <span>{TEXTS.home}</span>
                  <span className={darkMode ? 'text-slate-500' : 'text-slate-400'}>({breadcrumbCounts.total})</span>
                </button>
                {categoryFilter && (
                  <>
                    <ChevronRight size={14} className={darkMode ? 'text-slate-600' : 'text-slate-300'} aria-hidden />
                    <button
                      type="button"
                      onClick={() => setSubCategoryFilter('')}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 -ml-1 transition-colors ${subCategoryFilter ? (darkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200') : (darkMode ? 'text-slate-300 font-medium' : 'text-slate-700 font-medium')}`}
                    >
                      <span>{categoryFilter}</span>
                      <span className={darkMode ? 'text-slate-500' : 'text-slate-400'}>({breadcrumbCounts.inCategory})</span>
                    </button>
                  </>
                )}
                {categoryFilter && subCategoryFilter && (
                  <>
                    <ChevronRight size={14} className={darkMode ? 'text-slate-600' : 'text-slate-300'} aria-hidden />
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? 'text-slate-300 font-medium' : 'text-slate-700 font-medium'}`}>
                      <span>{subCategoryFilter}</span>
                      <span className={darkMode ? 'text-slate-500' : 'text-slate-400'}>({breadcrumbCounts.inSubCategory})</span>
                    </span>
                  </>
                )}
              </nav>
              {/* Single row: search, category, subcategory, price, sort, view */}
              <div className="flex flex-wrap items-center gap-2">
                <div className={`relative flex-1 min-w-0 max-w-[180px] sm:max-w-[240px]`}>
                  <SearchIcon size={16} className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${darkMode ? 'text-slate-400' : 'text-slate-400'}`} />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={TEXTS.search}
                    className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-500' : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400'}`}
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setSubCategoryFilter(''); }}
                  className={`py-1.5 pl-2.5 pr-7 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 appearance-none bg-no-repeat bg-right ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border border-slate-200 text-slate-900'}`}
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.4rem center' }}
                >
                  <option value="">{TEXTS.category}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {subCategories.length > 0 && (
                  <select
                    value={subCategoryFilter}
                    onChange={(e) => setSubCategoryFilter(e.target.value)}
                    className={`py-1.5 pl-2.5 pr-7 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 appearance-none bg-no-repeat bg-right ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border border-slate-200 text-slate-900'}`}
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.4rem center' }}
                  >
                    <option value="">Unterkategorie</option>
                    {subCategories.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1">
                  <input type="number" min={0} step={1} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder={TEXTS.minPrice} className={`w-14 sm:w-16 py-1.5 px-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-500' : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400'}`} />
                  <span className={`text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>–</span>
                  <input type="number" min={0} step={1} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder={TEXTS.maxPrice} className={`w-14 sm:w-16 py-1.5 px-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-500' : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400'}`} />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className={`py-1.5 pl-2.5 pr-7 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/20 appearance-none bg-no-repeat bg-right ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border border-slate-200 text-slate-900'}`}
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.4rem center' }}
                >
                  <option value="default">{TEXTS.sort}</option>
                  <option value="priceAsc">{TEXTS.priceLow}</option>
                  <option value="priceDesc">{TEXTS.priceHigh}</option>
                  <option value="nameAsc">{TEXTS.nameAz}</option>
                </select>
                <div className={`flex rounded-lg overflow-hidden border ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                  <button type="button" onClick={() => setViewMode('grid')} className={`p-1.5 ${viewMode === 'grid' ? (darkMode ? 'bg-slate-600 text-white' : 'bg-slate-900 text-white') : darkMode ? 'bg-slate-700 text-slate-400 hover:bg-slate-600' : 'bg-white text-slate-600 hover:bg-slate-100'}`} title="Grid"><LayoutGrid size={16} /></button>
                  <button type="button" onClick={() => setViewMode('list')} className={`p-1.5 ${viewMode === 'list' ? (darkMode ? 'bg-slate-600 text-white' : 'bg-slate-900 text-white') : darkMode ? 'bg-slate-700 text-slate-400 hover:bg-slate-600' : 'bg-white text-slate-600 hover:bg-slate-100'}`} title="Liste"><List size={16} /></button>
                </div>
                {hasActiveFilters && (
                  <button type="button" onClick={clearAll} className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium ${darkMode ? 'text-slate-400 hover:bg-slate-700 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}>
                    <SlidersHorizontal size={14} /> Zurücksetzen
                  </button>
                )}
              </div>
              {/* Active filter chips */}
              {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-600/60">
                  {tab === 'sale' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 text-xs font-medium">
                      {TEXTS.sale} <button type="button" onClick={() => setTab('all')} className="hover:opacity-80" aria-label="Remove">×</button>
                    </span>
                  )}
                  {categoryFilter && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-medium">
                      {categoryFilter} <button type="button" onClick={() => { setCategoryFilter(''); setSubCategoryFilter(''); }} className="hover:opacity-80" aria-label="Remove">×</button>
                    </span>
                  )}
                  {subCategoryFilter && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-medium">
                      {subCategoryFilter} <button type="button" onClick={() => setSubCategoryFilter('')} className="hover:opacity-80" aria-label="Remove">×</button>
                    </span>
                  )}
                  {(minPrice !== '' || maxPrice !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-medium">
                      €{minPrice !== '' ? Number(minPrice).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}–{maxPrice !== '' ? `€${Number(maxPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '…'} <button type="button" onClick={() => { setMinPrice(''); setMaxPrice(''); }} className="hover:opacity-80" aria-label="Remove">×</button>
                    </span>
                  )}
                  {search.trim() !== '' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-medium max-w-[120px] truncate" title={search}>
                      „{search.trim()}“ <button type="button" onClick={() => setSearch('')} className="hover:opacity-80 shrink-0" aria-label="Remove">×</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* Content */}
      <main className="flex-1 mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14 w-full">
        {showLoading && (
          <div className="space-y-8">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-900/10 dark:bg-white/10 flex items-center justify-center mb-5">
                <Loader2 size={28} className="animate-spin text-slate-600 dark:text-slate-300" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">{TEXTS.loading}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] max-h-[220px] bg-slate-200 dark:bg-slate-700" />
                  <div className="p-5 space-y-3">
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                    <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-full" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3" />
                    <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-full mt-4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showEmptyCatalog && (
          <div className="flex flex-col items-center justify-center py-28 px-4 text-center max-w-md mx-auto">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-6">
              <Package size={36} className="text-slate-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Noch keine Artikel</h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-8">{TEXTS.noCatalog}</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 shadow-lg transition-colors"
            >
              {TEXTS.toHome}
            </button>
          </div>
        )}

        {showNoResults && (
          <div className={`flex flex-col items-center justify-center py-28 text-center rounded-2xl p-8 ${darkMode ? 'bg-slate-800/80 border border-slate-600/80' : 'bg-white/80 border border-slate-200/80'}`}>
            <p className={darkMode ? 'text-slate-300 font-medium' : 'text-slate-600 font-medium'}>{TEXTS.noItems}</p>
            <p className={darkMode ? 'text-slate-500 text-sm mt-1' : 'text-slate-400 text-sm mt-1'}>Filter anpassen oder Alle / Sale wechseln.</p>
          </div>
        )}

        {catalogLoaded && sortedFiltered.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <p className={`text-sm font-medium ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${darkMode ? 'bg-slate-600 text-white' : 'bg-slate-900 text-white'}`}>{sortedFiltered.length}</span>
                <span className="ml-2">{TEXTS.results}</span>
              </p>
            </div>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
                {sortedFiltered.map((item) => (
                  <StoreItemCard key={item.id} item={item} priceDisplay={priceDisplay(item)} texts={TEXTS} lang={lang} onContact={() => openContact(item)} onDetailsClick={() => handleOpenDetails(item)} layout="grid" isInWishlist={wishlistIds.includes(item.id)} onToggleWishlist={() => handleToggleWishlist(item.id)} onShare={() => { const u = `${window.location.origin}/item/${item.id}`; if (navigator.share) navigator.share({ title: item.name, url: u }); else navigator.clipboard.writeText(u); }} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {sortedFiltered.map((item) => (
                  <StoreItemCard key={item.id} item={item} priceDisplay={priceDisplay(item)} texts={TEXTS} lang={lang} onContact={() => openContact(item)} onDetailsClick={() => handleOpenDetails(item)} layout="list" isInWishlist={wishlistIds.includes(item.id)} onToggleWishlist={() => handleToggleWishlist(item.id)} onShare={() => { const u = `${window.location.origin}/item/${item.id}`; if (navigator.share) navigator.share({ title: item.name, url: u }); else navigator.clipboard.writeText(u); }} />
                ))}
              </div>
            )}
            {recentlyViewedItems.length > 0 && (
              <section className="mt-12">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">{TEXTS.recentlyViewed}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentlyViewedItems.slice(0, 6).map((item) => (
                    <StoreItemCard key={item.id} item={item} priceDisplay={priceDisplay(item)} texts={TEXTS} lang={lang} onContact={() => openContact(item)} onDetailsClick={() => handleOpenDetails(item)} layout="grid" isInWishlist={wishlistIds.includes(item.id)} onToggleWishlist={() => handleToggleWishlist(item.id)} onShare={() => {}} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer – at bottom with links and legal */}
      <footer className="mt-auto border-t border-slate-200/80 bg-slate-900 text-slate-300">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 sm:gap-8">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-6 gap-y-1">
              <button type="button" onClick={() => setAboutContactModal('about')} className="text-sm text-slate-400 hover:text-white transition-colors">{TEXTS.aboutUs}</button>
              <button type="button" onClick={() => setAboutContactModal('contact')} className="text-sm text-slate-400 hover:text-white transition-colors">{TEXTS.contactLink}</button>
              <button type="button" onClick={() => setLegalModal('impressum')} className="text-sm text-slate-400 hover:text-white transition-colors">{TEXTS.imprint}</button>
              <button type="button" onClick={() => setLegalModal('datenschutz')} className="text-sm text-slate-400 hover:text-white transition-colors">{TEXTS.privacy}</button>
              <button type="button" onClick={() => setLegalModal('agb')} className="text-sm text-slate-400 hover:text-white transition-colors">{TEXTS.terms}</button>
            </div>
            <p className="text-slate-500 text-xs text-center sm:text-right order-last sm:order-none">
              © {new Date().getFullYear()} · {TEXTS.title}
            </p>
          </div>
          <p className="mt-6 pt-6 border-t border-slate-700/50 text-slate-500 text-xs text-center">
            {TEXTS.legal}
          </p>
        </div>
      </footer>

      {/* Back to top */}
      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800 hover:scale-105 transition-all flex items-center justify-center"
          aria-label={TEXTS.backToTop}
        >
          <ArrowUp size={20} />
        </button>
      )}

      {/* Legal modals (AGB, Datenschutz, Impressum) – user stays on page */}
      {legalModal && (
        <LegalModal type={legalModal} onClose={() => setLegalModal(null)} closeLabel={TEXTS.close} />
      )}

      {/* Contact modal */}
      {modalItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => !sending && setModalItem(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">{TEXTS.aboutItem}</h3>
              <button type="button" onClick={() => !sending && setModalItem(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-5 font-medium">«{modalItem.name}»</p>
            {sent ? (
              <div className="text-center py-6">
                <p className="text-emerald-600 font-semibold">{TEXTS.sent}</p>
                <button type="button" onClick={() => setModalItem(null)} className="mt-4 text-sm text-slate-500 hover:text-slate-900 underline">{TEXTS.close}</button>
              </div>
            ) : (
              <>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={TEXTS.yourName} className="w-full mb-3 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/20" />
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={TEXTS.yourEmail} className="w-full mb-3 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/20" />
                <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={TEXTS.yourPhone} className="w-full mb-3 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/20" />
                <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder={TEXTS.yourMessage} rows={3} className="w-full mb-5 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/20 resize-none" />
                <button type="button" onClick={handleSend} disabled={sending} className="w-full py-3.5 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-60 transition-all">
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
                  {TEXTS.send}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Gallery carousel modal – image + floating "Was ist drin?" */}
      {galleryItem && (() => {
        const galleryImages: string[] = [];
        if (galleryItem.imageUrl) galleryImages.push(galleryItem.imageUrl);
        if (galleryItem.storeGalleryUrls?.length) galleryImages.push(...galleryItem.storeGalleryUrls);
        const hasImages = galleryImages.length > 0;
        const currentIndex = Math.min(galleryIndex, hasImages ? galleryImages.length - 1 : 0);
        const hasSpecs = galleryItem.specs && Object.keys(galleryItem.specs).length > 0;
        const specsTitle = /pc|computer|desktop|build/i.test(galleryItem.category || '') || /pc|computer|desktop|build/i.test(galleryItem.subCategory || '') ? TEXTS.keyFeatures : TEXTS.specs;
        
        return (
          <div 
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" 
            onClick={closeGallery}
          >
            <div 
              className="relative bg-white rounded-3xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200" 
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-white shrink-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-900 text-base sm:text-lg truncate">{galleryItem.name}</h3>
                    {galleryItem.badge && (
                      <span className={`shrink-0 px-2 py-0.5 rounded-lg text-xs font-bold uppercase ${galleryItem.badge === 'New' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>
                        {galleryItem.badge === 'New' ? TEXTS.badgeNew : TEXTS.badgePriceReduced}
                      </span>
                    )}
                  </div>
                  {galleryImages.length > 1 && (
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                      {currentIndex + 1} von {galleryImages.length}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); const u = `${window.location.origin}/item/${galleryItem.id}`; if (navigator.share) navigator.share({ title: galleryItem.name, url: u }); else navigator.clipboard.writeText(u); }}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-600"
                    aria-label={TEXTS.share}
                  >
                    <Share2 size={20} />
                  </button>
                  <button type="button" onClick={closeGallery} className="ml-2 p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors shrink-0" aria-label="Close gallery">
                    <X size={22} />
                  </button>
                </div>
              </div>

              {/* Main: carousel (left) | details + specs + description + CTA (right) – no overlay */}
              <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* Left: image carousel + thumbnails only */}
                <div className="flex-1 min-w-0 flex flex-col bg-slate-50">
                  <div className="relative flex-1 flex items-center justify-center min-h-[240px] sm:min-h-[280px] p-4 sm:p-6">
                    {hasImages ? (
                      <>
                        <img 
                          key={currentIndex}
                          src={galleryImages[currentIndex]} 
                          alt={`${galleryItem.name} - Bild ${currentIndex + 1}`}
                          className="max-w-full max-h-[50vh] sm:max-h-[55vh] lg:max-h-[calc(90vh-200px)] object-contain rounded-xl shadow-lg transition-opacity duration-300"
                          style={{ animation: 'fadeIn 0.3s ease-in-out' }}
                        />
                        {galleryImages.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setGalleryIndex((i) => (i - 1 + galleryImages.length) % galleryImages.length);
                              }}
                              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg border border-slate-200 flex items-center justify-center text-slate-900 hover:bg-slate-50 transition-all z-10"
                              aria-label="Previous image"
                            >
                              <ChevronLeft size={22} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setGalleryIndex((i) => (i + 1) % galleryImages.length);
                              }}
                              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg border border-slate-200 flex items-center justify-center text-slate-900 hover:bg-slate-50 transition-all z-10"
                              aria-label="Next image"
                            >
                              <ChevronRight size={22} strokeWidth={2} />
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="text-slate-400 text-lg py-12">Keine Bilder verfügbar</div>
                    )}
                  </div>
                  {galleryImages.length > 1 && (
                    <div className="px-4 sm:px-6 py-3 border-t border-slate-200/80 bg-white shrink-0">
                      <div className="flex gap-2 overflow-x-auto scrollbar-thin">
                        {galleryImages.map((img, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setGalleryIndex(i); }}
                            className={`shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border-2 transition-all ${
                              i === currentIndex ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-200 hover:border-slate-300 opacity-70 hover:opacity-100'
                            }`}
                            aria-label={`Bild ${i + 1}`}
                          >
                            <img src={img} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Technische Daten / Was ist drin? then description then CTA – no overlap with photos */}
                <div className="lg:w-[320px] xl:w-[360px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-slate-200 bg-white overflow-y-auto">
                  {hasSpecs && (
                    <div className="p-4 sm:p-5 border-b border-slate-200 shrink-0">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-slate-900 text-white flex items-center justify-center text-[10px]">✓</span>
                        {specsTitle}
                      </h4>
                      <div className="space-y-2">
                        {orderedSpecKeys(galleryItem.specs!, galleryItem.categoryFields).slice(0, 10).map((key) => (
                          <div key={key} className="flex justify-between gap-2 text-xs sm:text-sm py-1 border-b border-slate-100 last:border-b-0">
                            <span className="text-slate-500 font-medium shrink-0">{key}</span>
                            <span className="text-slate-900 font-semibold text-right truncate" title={String(galleryItem.specs![key])}>{String(galleryItem.specs![key])}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {getItemDescription(galleryItem, lang) && (
                    <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto">
                      <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{getItemDescription(galleryItem, lang)}</p>
                    </div>
                  )}
                  <div className="p-4 sm:p-5 border-t border-slate-200 flex flex-wrap gap-2 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); closeGallery(); openContact(galleryItem); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors flex-1 min-w-[140px]">
                      <MessageCircle size={18} /> {TEXTS.contact}
                    </button>
                    <button type="button" onClick={closeGallery} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                      {TEXTS.close}
                    </button>
                  </div>
                  {similarItems.length > 0 && (
                    <div className="p-4 sm:p-5 border-t border-slate-200 shrink-0">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">{TEXTS.similarItems}</h4>
                      <div className="flex gap-2 overflow-x-auto">
                        {similarItems.map((sim) => (
                          <button key={sim.id} type="button" onClick={(e) => { e.stopPropagation(); addRecentlyViewedId(sim.id); setRecentKey((k) => k + 1); setGalleryIndex(0); setGalleryItem(sim); navigate(`/item/${sim.id}`); }} className="shrink-0 w-24 rounded-xl border border-slate-200 overflow-hidden hover:border-slate-400 transition-colors text-left">
                            {sim.imageUrl ? <img src={sim.imageUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" /> : <div className="w-full aspect-square bg-slate-100 flex items-center justify-center text-slate-400 text-[10px] px-1 text-center">{sim.name}</div>}
                            <p className="p-2 text-[10px] font-medium text-slate-700 truncate">{sim.name}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Sticky CTA on mobile when modal open */}
            <div className="fixed bottom-0 left-0 right-0 z-[115] p-3 bg-white border-t border-slate-200 lg:hidden">
              <button type="button" onClick={(e) => { e.stopPropagation(); closeGallery(); openContact(galleryItem); }} className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center justify-center gap-2">
                <MessageCircle size={18} /> {TEXTS.contact}
              </button>
            </div>
          </div>
        );
      })()}
      {aboutContactModal && <AboutContactModal type={aboutContactModal} onClose={() => setAboutContactModal(null)} onOpenPrivacy={() => { setAboutContactModal(null); setLegalModal('datenschutz'); }} />}
      {!getCookieConsentAccepted() && <CookieConsent onAccept={() => { try { localStorage.setItem('armiktech_cookie_consent', '1'); } catch {} setCookieConsent(true); }} onPrivacyClick={() => setLegalModal('datenschutz')} />}
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
                  image: item.imageUrl,
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

const StoreItemCard: React.FC<{
  item: StoreItem;
  priceDisplay: { value: number; sale: boolean; hasPrice: boolean };
  texts: typeof TEXTS_DE;
  lang: 'de' | 'en';
  onContact: () => void;
  onDetailsClick: () => void;
  layout?: 'grid' | 'list';
  isInWishlist?: boolean;
  onToggleWishlist?: () => void;
  onShare?: () => void;
}> = ({ item, priceDisplay, texts, lang, onContact, onDetailsClick, layout = 'grid', isInWishlist = false, onToggleWishlist, onShare }) => {
  const [galleryIndex, setGalleryIndex] = useState(0);
  const images = useMemo(() => {
    const list: string[] = [];
    if (item.imageUrl) list.push(item.imageUrl);
    if (item.storeGalleryUrls?.length) list.push(...item.storeGalleryUrls!);
    return list.length ? list : [];
  }, [item.imageUrl, item.storeGalleryUrls]);
  const hasSpecs = item.specs && Object.keys(item.specs).length > 0;
  const specKeys = item.categoryFields?.length ? item.categoryFields.filter((k) => item.specs?.[k] != null) : (item.specs ? Object.keys(item.specs) : []);

  const isList = layout === 'list';

  const contentBlock = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{item.category}{item.subCategory ? ` / ${item.subCategory}` : ''}</p>
        {item.badge && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.badge === 'New' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
            {item.badge === 'New' ? texts.badgeNew : texts.badgePriceReduced}
          </span>
        )}
        {'quantity' in item && item.quantity === 0 && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 text-slate-700">{texts.outOfStock}</span>
        )}
        {'quantity' in item && item.quantity === 1 && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">{texts.onlyOneLeft}</span>
        )}
      </div>
      <h2 className="font-semibold text-slate-900 mt-1 line-clamp-2 text-base leading-snug">{item.name}</h2>
      {getItemDescription(item, lang) && (
        <p className="text-sm text-slate-600 mt-2 whitespace-pre-line line-clamp-4">{getItemDescription(item, lang)}</p>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDetailsClick(); }}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
      >
        <FileText size={14} /> {texts.viewDetails}
      </button>
      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
        {priceDisplay.hasPrice ? (
          <>
            <span className="text-xl font-bold text-slate-900">{Number(priceDisplay.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} €</span>
            {priceDisplay.sale && item.sellPrice != null && item.sellPrice > priceDisplay.value && (
              <span className="text-sm text-slate-400 line-through">{Number(item.sellPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} €</span>
            )}
          </>
        ) : (
          <span className="text-base font-medium text-slate-500">{texts.priceOnRequest}</span>
        )}
      </div>
      {hasSpecs && specKeys.length > 0 && !isList && (
        <dl className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-600 space-y-1.5">
          <dt className="font-medium text-slate-500">{texts.specs}</dt>
          {specKeys.slice(0, 5).map((k) => (
            <dd key={k} className="flex justify-between gap-2"><span>{k}</span><span className="text-slate-900 font-medium">{String(item.specs![k])}</span></dd>
          ))}
        </dl>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onContact(); }}
        className={`w-full py-3 rounded-xl border-2 border-slate-900 text-slate-900 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-900 hover:text-white transition-colors mt-4 ${isList ? 'max-w-[200px]' : ''}`}
      >
        <MessageCircle size={18} /> {texts.contact}
      </button>
    </>
  );

  if (isList) {
    return (
      <article
        onClick={onDetailsClick}
        className="group rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-md hover:shadow-xl hover:border-slate-300 transition-all duration-300 flex flex-row cursor-pointer"
      >
        <div className="w-32 sm:w-40 shrink-0 aspect-square bg-slate-100 overflow-hidden min-h-0">
          {images.length > 0 ? (
            <img src={images[galleryIndex]} alt={item.name} loading="lazy" className="w-full h-full object-contain object-center" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs px-2 text-center">{item.name}</div>
          )}
        </div>
        <div className="p-4 sm:p-5 flex-1 min-w-0 flex flex-col min-h-0">
          {contentBlock}
        </div>
      </article>
    );
  }

  return (
    <article
      onClick={onDetailsClick}
      className="group rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-md hover:shadow-xl hover:border-slate-300 hover:-translate-y-1 transition-all duration-300 flex flex-col cursor-pointer h-full"
    >
      {/* Image: fixed aspect + max-height so it never overlaps description */}
      <div className="relative w-full flex-shrink-0 bg-slate-100 overflow-hidden min-h-0 aspect-[4/3] max-h-[220px] sm:max-h-[260px] lg:max-h-[280px]">
        {images.length > 0 ? (
          <>
            <img src={images[galleryIndex]} alt={item.name} loading="lazy" className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-[1.03]" />
            {images.length > 1 && (
              <>
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setGalleryIndex((i) => (i - 1 + images.length) % images.length);
                  }} 
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md flex items-center justify-center text-slate-900 hover:bg-white transition-colors z-10" 
                  aria-label="Vorheriges Bild"
                >
                  <ChevronLeft size={20} />
                </button>
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setGalleryIndex((i) => (i + 1) % images.length);
                  }} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md flex items-center justify-center text-slate-900 hover:bg-white transition-colors z-10" 
                  aria-label="Nächstes Bild"
                >
                  <ChevronRight size={20} />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 pointer-events-none">
                  {images.map((_, i) => (
                    <span key={i} className={`w-2 h-2 rounded-full transition-colors ${i === galleryIndex ? 'bg-slate-900' : 'bg-white/80'}`} />
                  ))}
                </div>
              </>
            )}
            {priceDisplay.sale && (
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold uppercase tracking-wide shadow z-10 pointer-events-none">
                {texts.onSale}
              </span>
            )}
            {!priceDisplay.sale && 'quantity' in item && item.quantity === 0 && (
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-600 text-white text-xs font-bold uppercase tracking-wide shadow z-10 pointer-events-none">
                {texts.outOfStock}
              </span>
            )}
            {!priceDisplay.sale && 'quantity' in item && item.quantity === 1 && (
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-amber-500 text-white text-xs font-bold uppercase tracking-wide shadow z-10 pointer-events-none">
                {texts.onlyOneLeft}
              </span>
            )}
            {item.badge && (
              <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide shadow z-10 pointer-events-none ${item.badge === 'New' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>
                {item.badge === 'New' ? texts.badgeNew : texts.badgePriceReduced}
              </span>
            )}
            <div className={`absolute top-3 z-10 flex gap-2 ${item.badge ? 'left-3 mt-10' : 'left-3'}`}>
              {onToggleWishlist && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onToggleWishlist(); }} className="p-2 rounded-full bg-white/90 shadow hover:bg-white text-slate-700" title={isInWishlist ? texts.removeFromWishlist : texts.addToWishlist}>
                  <Heart size={18} className={isInWishlist ? 'fill-rose-500 text-rose-500' : ''} />
                </button>
              )}
              {onShare && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onShare(); }} className="p-2 rounded-full bg-white/90 shadow hover:bg-white text-slate-700" title={texts.share}>
                  <Share2 size={18} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm px-4 text-center min-h-[140px]">{item.name}</div>
        )}
      </div>
      <div className="p-4 sm:p-5 flex-1 flex flex-col min-h-0 min-w-0">
        {contentBlock}
      </div>
    </article>
  );
};

export default StorefrontPage;
