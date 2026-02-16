import React, { useState, useEffect, useMemo } from 'react';
import { MessageCircle, ChevronLeft, ChevronRight, Tag, X, Send, Loader2, Package, Sparkles, LayoutGrid, List } from 'lucide-react';
import { subscribeToStoreCatalog, createStoreInquiry, type StoreCatalogPayload } from '../services/firebaseService';

const TEXTS = {
  title: 'Shop',
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
  noCatalog: 'Noch keine Artikel im Shop. Der Händler kann im Admin-Bereich Artikel freischalten.',
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
  adminLink: 'Admin',
  sort: 'Sortieren',
  priceLow: 'Preis aufsteigend',
  priceHigh: 'Preis absteigend',
  nameAz: 'Name A–Z',
  results: 'Ergebnisse',
};

type StoreItem = NonNullable<StoreCatalogPayload['items']>[number];

const StorefrontPage: React.FC = () => {
  const [catalog, setCatalog] = useState<StoreCatalogPayload | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [tab, setTab] = useState<'all' | 'sale'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [modalItem, setModalItem] = useState<StoreItem | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'priceAsc' | 'priceDesc' | 'nameAsc'>('default');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const unsub = subscribeToStoreCatalog((data) => {
      setCatalog(data);
      setCatalogLoaded(true);
    });
    return () => unsub();
  }, []);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'sale') list = list.filter((i) => i.storeOnSale);
    if (categoryFilter) list = list.filter((i) => i.category === categoryFilter);
    const min = minPrice ? parseFloat(minPrice) : NaN;
    const max = maxPrice ? parseFloat(maxPrice) : NaN;
    if (!Number.isNaN(min)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) >= min);
    if (!Number.isNaN(max)) list = list.filter((i) => (i.storeOnSale ? i.storeSalePrice : i.sellPrice) != null && (i.storeOnSale ? i.storeSalePrice! : i.sellPrice!) <= max);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q) || (i.subCategory || '').toLowerCase().includes(q));
    }
    return list;
  }, [items, tab, categoryFilter, minPrice, maxPrice, search]);

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
    <div className="min-h-screen bg-[#fafafa] text-[#1a1a1a] antialiased storefront-page" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-[#eee]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold tracking-tight text-[#1a1a1a] hover:opacity-80 transition-opacity">
            {TEXTS.title}
          </a>
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'all' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:bg-[#f0f0f0] hover:text-[#1a1a1a]'}`}
            >
              {TEXTS.all}
            </button>
            <button
              type="button"
              onClick={() => setTab('sale')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'sale' ? 'bg-[#c41e3a] text-white' : 'text-[#666] hover:bg-[#fef2f2] hover:text-[#c41e3a]'}`}
            >
              <Tag size={14} strokeWidth={2.2} /> {TEXTS.sale}
            </button>
            <a href="/panel" className="ml-2 px-3 py-2 rounded-lg text-sm text-[#888] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors">
              {TEXTS.adminLink}
            </a>
          </nav>
        </div>
      </header>

      {/* Filters — compact: category pills + inline search & price */}
      <section className="bg-white border-b border-[#eee]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[#666] text-xs font-medium uppercase tracking-wider hidden sm:inline">{TEXTS.category}</span>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin scrollbar-thumb-[#ddd] scrollbar-track-transparent">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('')}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!categoryFilter ? 'bg-[#1a1a1a] text-white' : 'bg-[#f0f0f0] text-[#666] hover:bg-[#e5e5e5]'}`}
                >
                  {TEXTS.all}
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryFilter(c)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${categoryFilter === c ? 'bg-[#1a1a1a] text-white' : 'bg-[#f0f0f0] text-[#666] hover:bg-[#e5e5e5]'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={TEXTS.search}
                className="flex-1 min-w-0 max-w-[200px] sm:max-w-none rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1a1a]/20 focus:bg-white placeholder:text-[#999]"
              />
              <div className="flex items-center gap-1">
                <input type="number" min={0} step={1} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder={TEXTS.minPrice} className="w-16 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#1a1a1a]/20" />
                <span className="text-[#999] text-xs">–</span>
                <input type="number" min={0} step={1} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder={TEXTS.maxPrice} className="w-16 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#1a1a1a]/20" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-12">
        {showLoading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#1a1a1a]/5 flex items-center justify-center mb-4">
              <Loader2 size={24} className="animate-spin text-[#1a1a1a]/60" />
            </div>
            <p className="text-[#666] font-medium">{TEXTS.loading}</p>
          </div>
        )}

        {showEmptyCatalog && (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-[#f0f0f0] flex items-center justify-center mb-5">
              <Package size={28} className="text-[#999]" />
            </div>
            <h2 className="text-lg font-semibold text-[#1a1a1a] mb-2">Noch keine Artikel</h2>
            <p className="text-[#666] text-sm leading-relaxed mb-6">{TEXTS.noCatalog}</p>
            <a href="/panel" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1a1a1a] text-white text-sm font-medium hover:bg-[#333] transition-colors">
              <Sparkles size={16} /> Admin öffnen
            </a>
          </div>
        )}

        {showNoResults && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[#666] font-medium">{TEXTS.noItems}</p>
            <p className="text-[#999] text-sm mt-1">Filter anpassen oder Alle / Sale wechseln.</p>
          </div>
        )}

        {catalogLoaded && sortedFiltered.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <p className="text-sm text-[#666]">{sortedFiltered.length} {TEXTS.results}</p>
              <div className="flex items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:ring-2 focus:ring-[#1a1a1a]/20"
                >
                  <option value="default">{TEXTS.sort}</option>
                  <option value="priceAsc">{TEXTS.priceLow}</option>
                  <option value="priceDesc">{TEXTS.priceHigh}</option>
                  <option value="nameAsc">{TEXTS.nameAz}</option>
                </select>
                <div className="flex rounded-lg border border-[#e5e5e5] overflow-hidden">
                  <button type="button" onClick={() => setViewMode('grid')} className={`p-2 ${viewMode === 'grid' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#666] hover:bg-[#f5f5f5]'}`} title="Grid"><LayoutGrid size={18} /></button>
                  <button type="button" onClick={() => setViewMode('list')} className={`p-2 ${viewMode === 'list' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#666] hover:bg-[#f5f5f5]'}`} title="List"><List size={18} /></button>
                </div>
              </div>
            </div>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
                {sortedFiltered.map((item) => (
                  <StoreItemCard key={item.id} item={item} priceDisplay={priceDisplay(item)} texts={TEXTS} onContact={() => openContact(item)} layout="grid" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {sortedFiltered.map((item) => (
                  <StoreItemCard key={item.id} item={item} priceDisplay={priceDisplay(item)} texts={TEXTS} onContact={() => openContact(item)} layout="list" />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[#eee] bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 text-center">
          <p className="text-[#888] text-sm">© {new Date().getFullYear()} · {TEXTS.title}</p>
          <a href="/panel" className="text-[#999] text-sm hover:text-[#1a1a1a] mt-1 inline-block transition-colors">{TEXTS.adminLink}</a>
        </div>
      </footer>

      {/* Contact modal */}
      {modalItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !sending && setModalItem(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 border border-[#eee]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1a1a1a] text-lg">{TEXTS.aboutItem}</h3>
              <button type="button" onClick={() => !sending && setModalItem(null)} className="p-2 rounded-xl hover:bg-[#f5f5f5] text-[#666] transition-colors">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[#666] mb-5 font-medium">«{modalItem.name}»</p>
            {sent ? (
              <div className="text-center py-6">
                <p className="text-[#16a34a] font-semibold">{TEXTS.sent}</p>
                <button type="button" onClick={() => setModalItem(null)} className="mt-4 text-sm text-[#666] hover:text-[#1a1a1a] underline">{TEXTS.close}</button>
              </div>
            ) : (
              <>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={TEXTS.yourName} className="w-full mb-3 rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#1a1a1a]/20" />
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={TEXTS.yourEmail} className="w-full mb-3 rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#1a1a1a]/20" />
                <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={TEXTS.yourPhone} className="w-full mb-3 rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#1a1a1a]/20" />
                <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder={TEXTS.yourMessage} rows={3} className="w-full mb-5 rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#1a1a1a]/20 resize-none" />
                <button type="button" onClick={handleSend} disabled={sending} className="w-full py-3.5 rounded-xl bg-[#1a1a1a] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#333] disabled:opacity-60 transition-all">
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
                  {TEXTS.send}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const StoreItemCard: React.FC<{ item: StoreItem; priceDisplay: { value: number; sale: boolean; hasPrice: boolean }; texts: typeof TEXTS; onContact: () => void; layout?: 'grid' | 'list' }> = ({ item, priceDisplay, texts, onContact, layout = 'grid' }) => {
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
      <p className="text-xs text-[#888] uppercase tracking-wider font-medium">{item.category}{item.subCategory ? ` / ${item.subCategory}` : ''}</p>
      <h2 className="font-semibold text-[#1a1a1a] mt-1 line-clamp-2 text-base leading-snug">{item.name}</h2>
      {item.storeDescription && (
        <p className="text-sm text-[#666] mt-2 line-clamp-2">{item.storeDescription}</p>
      )}
      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
        {priceDisplay.hasPrice ? (
          <>
            <span className="text-xl font-bold text-[#1a1a1a]">{priceDisplay.value.toFixed(2)} €</span>
            {priceDisplay.sale && item.sellPrice != null && item.sellPrice > priceDisplay.value && (
              <span className="text-sm text-[#999] line-through">{item.sellPrice.toFixed(2)} €</span>
            )}
          </>
        ) : (
          <span className="text-base font-medium text-[#888]">{texts.priceOnRequest}</span>
        )}
      </div>
      {hasSpecs && specKeys.length > 0 && !isList && (
        <dl className="mt-4 pt-4 border-t border-[#f0f0f0] text-xs text-[#666] space-y-1.5">
          <dt className="font-medium text-[#888]">{texts.specs}</dt>
          {specKeys.slice(0, 5).map((k) => (
            <dd key={k} className="flex justify-between gap-2"><span>{k}</span><span className="text-[#1a1a1a] font-medium">{String(item.specs![k])}</span></dd>
          ))}
        </dl>
      )}
      <button type="button" onClick={onContact} className={`w-full py-3 rounded-xl border-2 border-[#1a1a1a] text-[#1a1a1a] text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#1a1a1a] hover:text-white transition-colors ${isList ? 'mt-3 max-w-[200px]' : 'mt-5'}`}>
        <MessageCircle size={18} /> {texts.contact}
      </button>
    </>
  );

  if (isList) {
    return (
      <article className="group rounded-2xl bg-white border border-[#eee] overflow-hidden shadow-sm hover:shadow-md hover:border-[#e0e0e0] transition-all flex flex-row">
        <div className="w-40 sm:w-48 shrink-0 aspect-square bg-[#f5f5f5] overflow-hidden">
          {images.length > 0 ? (
            <img src={images[galleryIndex]} alt={item.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#bbb] text-xs px-2 text-center">{item.name}</div>
          )}
        </div>
        <div className="p-4 sm:p-5 flex-1 min-w-0 flex flex-col">
          {contentBlock}
        </div>
      </article>
    );
  }

  return (
    <article className="group rounded-2xl bg-white border border-[#eee] overflow-hidden shadow-sm hover:shadow-lg hover:border-[#e0e0e0] hover:-translate-y-0.5 transition-all duration-300 flex flex-col">
      {/* Gallery */}
      <div className="relative aspect-[4/3] bg-[#f5f5f5] overflow-hidden">
        {images.length > 0 ? (
          <>
            <img src={images[galleryIndex]} alt={item.name} className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => setGalleryIndex((i) => (i - 1 + images.length) % images.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md flex items-center justify-center text-[#1a1a1a] hover:bg-white transition-colors" aria-label="Vorheriges Bild">
                  <ChevronLeft size={20} />
                </button>
                <button type="button" onClick={() => setGalleryIndex((i) => (i + 1) % images.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md flex items-center justify-center text-[#1a1a1a] hover:bg-white transition-colors" aria-label="Nächstes Bild">
                  <ChevronRight size={20} />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <span key={i} className={`w-2 h-2 rounded-full transition-colors ${i === galleryIndex ? 'bg-[#1a1a1a]' : 'bg-white/80'}`} />
                  ))}
                </div>
              </>
            )}
            {priceDisplay.sale && (
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-[#c41e3a] text-white text-xs font-bold uppercase tracking-wide shadow">
                {texts.onSale}
              </span>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#bbb] text-sm px-4 text-center">{item.name}</div>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col">
        {contentBlock}
      </div>
    </article>
  );
};

export default StorefrontPage;
