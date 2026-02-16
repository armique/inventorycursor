import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Tag, MessageCircle, ExternalLink, Loader2, Check, Mail, Phone, Upload, CheckCircle2, Pencil, X, Image as ImageIcon, Filter, Search as SearchIcon, Sparkles, Copy, Download } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { subscribeToStoreInquiries, markStoreInquiryRead, updateStoreInquiryStatus, uploadItemImage, isCloudEnabled, getCurrentUser, type StoreInquiryStatus } from '../services/firebaseService';
import { generateStoreDescription } from '../services/specsAI';
import ItemThumbnail from './ItemThumbnail';
import { removeBackground } from '@imgly/background-removal';

const TEXTS = {
  title: 'Store management',
  subtitle: 'Visibility, sale & inquiries',
  visible: 'Visible on store',
  hidden: 'Hidden on store',
  onSale: 'On sale',
  notOnSale: 'Not on sale',
  inquiries: 'Inquiries',
  noInquiries: 'No inquiries.',
  item: 'Item',
  message: 'Message',
  contact: 'Contact',
  date: 'Date',
  markRead: 'Mark read',
  openItem: 'Open item',
  status: 'Status',
  statusNew: 'Neu',
  statusAnswered: 'Beantwortet',
  statusDone: 'Erledigt',
  copyTemplate: 'Vorlage kopieren',
  inquiriesTotal: 'Anfragen gesamt',
  inquiriesLast7: 'Letzte 7 Tage',
  duplicateItem: 'Kopie erstellen',
  exportCatalog: 'Katalog als CSV',
  replyTemplateThanks: 'Danke für Ihre Anfrage. Wir melden uns in Kürze.',
  replyTemplateReserved: 'Der Artikel ist für Sie reserviert. Wir kontaktieren Sie zur Abwicklung.',
  replyTemplateSold: 'Leider ist der Artikel bereits verkauft. Gerne informieren wir Sie über ähnliche Angebote.',
  catalogNote: 'Only "In Stock" items appear below. "Show" = on storefront; "Hide" = hidden. Catalog updates ~1s after changes, or click Publish to store now. Only “In Stock” items with “Visible on store” appear on the storefront.',
  publishNow: 'Publish to store now',
  published: 'Published',
  showOnStore: 'Show',
  hideFromStore: 'Hide',
  priceEur: 'Price €',
  editStoreItem: 'Edit store listing',
  storeDescription: 'Store description',
  galleryUrls: 'Store images',
  galleryNote: 'First image = main (carousel #1). Reorder or set as main as needed.',
  save: 'Save',
  cancel: 'Cancel',
};

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => Promise<void>;
}

const IN_STOCK = ItemStatus.IN_STOCK;

const StoreManagementPage: React.FC<Props> = ({ items, categories, categoryFields, onUpdate, onPublishCatalog }) => {
  const [inquiries, setInquiries] = useState<({ id: string; itemId: string; itemName: string; message: string; contactEmail?: string; contactPhone?: string; contactName?: string; createdAt: string; read?: boolean; status?: StoreInquiryStatus })[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<number | null>(null);
  const handlePublish = async () => {
    if (!onPublishCatalog) return;
    setPublishing(true);
    try {
      await onPublishCatalog();
      setPublishedAt(Date.now());
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    const unsub = subscribeToStoreInquiries(setInquiries);
    return () => unsub();
  }, []);

  // Show all in-stock items (simple: no category filtering)
  const storeVisibleItems = items.filter((i) => i.status === IN_STOCK);
  const setVisibility = (item: InventoryItem, visible: boolean) => {
    const next = items.map((it) => (it.id === item.id ? { ...it, storeVisible: visible } : it));
    onUpdate(next);
  };
  const toggleSale = (item: InventoryItem) => {
    const next = items.map((it) => (it.id === item.id ? { ...it, storeOnSale: !it.storeOnSale } : it));
    onUpdate(next);
  };
  const setSalePrice = (item: InventoryItem, value: number | '') => {
    const next = items.map((it) => (it.id === item.id ? { ...it, storeSalePrice: value === '' ? undefined : value } : it));
    onUpdate(next);
  };
  const setSellPrice = (item: InventoryItem, value: number | '') => {
    const next = items.map((it) => (it.id === item.id ? { ...it, sellPrice: value === '' ? undefined : value } : it));
    onUpdate(next);
  };

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [generateDescriptionWhenOpen, setGenerateDescriptionWhenOpen] = useState(false);
  const applyEdit = (updates: Partial<InventoryItem>) => {
    if (!editingItem) return;
    const next = items.map((it) => (it.id === editingItem.id ? { ...it, ...updates } : it));
    onUpdate(next);
    setEditingItem(null);
  };

  const handleDuplicateItem = (item: InventoryItem) => {
    const copy: InventoryItem = {
      ...item,
      id: `item-${Date.now()}`,
      name: `${item.name} (Kopie)`,
    };
    onUpdate([...items, copy]);
    setEditingItem(copy);
  };

  const handleExportCatalog = () => {
    const visible = storeVisibleItems.filter((i) => i.storeVisible !== false);
    const headers = ['Name', 'Category', 'SubCategory', 'Price', 'SalePrice', 'OnSale', 'Visible', 'Description'];
    const rows = visible.map((i) => [
      (i.name || '').replace(/"/g, '""'),
      i.category || '',
      i.subCategory || '',
      i.sellPrice ?? '',
      i.storeSalePrice ?? '',
      i.storeOnSale ? '1' : '0',
      i.storeVisible !== false ? '1' : '0',
      (i.storeDescription || '').replace(/"/g, '""').replace(/\n/g, ' '),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `armiktech-katalog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unreadCount = inquiries.filter((i) => !i.read).length;

  const mostInquired = React.useMemo(() => {
    const byItem: Record<string, { itemName: string; count: number }> = {};
    inquiries.forEach((inq) => {
      const id = inq.itemId;
      if (!byItem[id]) byItem[id] = { itemName: inq.itemName || id, count: 0 };
      byItem[id].count++;
    });
    return Object.entries(byItem)
      .map(([itemId, { itemName, count }]) => ({ itemId, itemName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [inquiries]);

  const totalInStock = storeVisibleItems.length;
  const visibleCount = storeVisibleItems.filter((i) => i.storeVisible !== false).length;
  const onSaleCount = storeVisibleItems.filter((i) => i.storeVisible !== false && i.storeOnSale).length;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [saleFilter, setSaleFilter] = useState<'all' | 'sale' | 'regular'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'priceAsc' | 'priceDesc' | 'nameAsc'>('recent');

  const filteredItems = storeVisibleItems
    .filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (statusFilter === 'visible' && item.storeVisible === false) return false;
      if (statusFilter === 'hidden' && item.storeVisible !== false) return false;
      if (saleFilter === 'sale' && !item.storeOnSale) return false;
      if (saleFilter === 'regular' && item.storeOnSale) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${item.name} ${item.category} ${item.subCategory || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const priceA = a.storeOnSale ? (a.storeSalePrice ?? a.sellPrice ?? 0) : (a.sellPrice ?? 0);
      const priceB = b.storeOnSale ? (b.storeSalePrice ?? b.sellPrice ?? 0) : (b.sellPrice ?? 0);
      if (sortBy === 'priceAsc') return priceA - priceB;
      if (sortBy === 'priceDesc') return priceB - priceA;
      if (sortBy === 'nameAsc') return a.name.localeCompare(b.name);
      return 0;
    });

  return (
    <div className="space-y-8">
      {/* Header + stats + publish */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{TEXTS.title}</h1>
          <p className="text-slate-600 mt-1 text-sm">{TEXTS.subtitle}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              onClick={() => { setStatusFilter('all'); setSaleFilter('all'); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${statusFilter === 'all' && saleFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              Show all
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter('visible'); setSaleFilter('all'); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${statusFilter === 'visible' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
            >
              Show visible
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter('all'); setSaleFilter('sale'); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${saleFilter === 'sale' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-800 hover:bg-rose-100'}`}
            >
              Show on sale
            </button>
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-xs">
            <button
              type="button"
              onClick={() => { setStatusFilter('all'); setSaleFilter('all'); }}
              className={`px-3 py-1.5 rounded-full font-bold uppercase tracking-widest transition-colors ${statusFilter === 'all' && saleFilter === 'all' ? 'bg-slate-800 text-white ring-2 ring-slate-400' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {totalInStock} In-stock
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('visible')}
              className={`px-3 py-1.5 rounded-full font-bold uppercase tracking-widest transition-colors ${statusFilter === 'visible' ? 'bg-emerald-700 text-white ring-2 ring-emerald-400' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'}`}
            >
              {visibleCount} Visible
            </button>
            <button
              type="button"
              onClick={() => setSaleFilter('sale')}
              className={`px-3 py-1.5 rounded-full font-bold uppercase tracking-widest transition-colors ${saleFilter === 'sale' ? 'bg-rose-700 text-white ring-2 ring-rose-400' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
            >
              {onSaleCount} On sale
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-bold text-slate-500">
            <span>{TEXTS.inquiriesTotal}: {inquiries.length}</span>
            <span>·</span>
            <span>{TEXTS.inquiriesLast7}: {inquiries.filter((i) => new Date(i.createdAt) > new Date(Date.now() - 7 * 24 * 3600 * 1000)).length}</span>
          </div>
          {mostInquired.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Most inquired</p>
              <ul className="space-y-1">
                {mostInquired.slice(0, 5).map(({ itemId, itemName, count }) => (
                  <li key={itemId} className="flex justify-between items-center text-xs">
                    <span className="truncate max-w-[180px]" title={itemName}>{itemName}</span>
                    <span className="font-bold text-slate-700 shrink-0">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleExportCatalog}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            <Download size={18} /> {TEXTS.exportCatalog}
          </button>
          {onPublishCatalog && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {publishing ? <Loader2 size={18} className="animate-spin" /> : publishedAt ? <CheckCircle2 size={18} /> : <Upload size={18} />}
              {publishing ? 'Publishing…' : publishedAt ? TEXTS.published : TEXTS.publishNow}
            </button>
          )}
            {publishedAt && onPublishCatalog && (
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                Last published {new Date(publishedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* LEFT: Items & filters */}
        <div className="flex-1 w-full space-y-4">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter size={16} className="text-slate-400" />
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Store items</p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <div className="relative">
                  <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, category…"
                    className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white outline-none"
                >
                  <option value="all">All categories</option>
                  {Array.from(new Set(storeVisibleItems.map((i) => i.category))).map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white outline-none"
                >
                  <option value="all">All visibility</option>
                  <option value="visible">Visible only</option>
                  <option value="hidden">Hidden only</option>
                </select>
                <select
                  value={saleFilter}
                  onChange={(e) => setSaleFilter(e.target.value as any)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white outline-none"
                >
                  <option value="all">All pricing</option>
                  <option value="sale">On sale</option>
                  <option value="regular">Regular price</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white outline-none"
                >
                  <option value="recent">Sort: default</option>
                  <option value="priceAsc">Price ↑</option>
                  <option value="priceDesc">Price ↓</option>
                  <option value="nameAsc">Name A–Z</option>
                </select>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">{TEXTS.catalogNote}</p>

            <div className="rounded-2xl border border-slate-100 overflow-hidden">
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-3 w-16">Item</th>
                      <th className="px-2 py-3">Name</th>
                      <th className="px-2 py-3 w-28">{TEXTS.priceEur}</th>
                      <th className="px-2 py-3 w-28">Store</th>
                      <th className="px-2 py-3 w-24">Sale</th>
                      <th className="px-2 py-3 w-32">Sale price €</th>
                      <th className="px-3 py-3 w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-slate-500 text-center text-sm">No items match the current filters.</td></tr>
                    ) : (
                      filteredItems.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 align-top">
                            <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-slate-50" size={48} useCategoryImage />
                          </td>
                          <td className="px-2 py-3 align-top">
                            <div className="font-semibold text-slate-900 truncate">{item.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {item.category}{item.subCategory ? ` • ${item.subCategory}` : ''}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.storeVisible === false ? (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-widest">Hidden</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest">Visible</span>
                              )}
                              {item.storeOnSale && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-widest">Sale</span>
                              )}
                              {!item.imageUrl && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-widest">No image</span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-3 align-top">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.sellPrice ?? ''}
                              onChange={(e) => setSellPrice(item, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                              placeholder="0"
                              className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </td>
                          <td className="px-2 py-3 align-top">
                            {item.storeVisible !== false ? (
                              <button
                                type="button"
                                onClick={() => setVisibility(item, false)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                title="Click to hide from store"
                              >
                                <Eye size={12} /> {TEXTS.hideFromStore}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setVisibility(item, true)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-200 text-slate-600 hover:bg-slate-300"
                                title="Click to show on store"
                              >
                                <EyeOff size={12} /> {TEXTS.showOnStore}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-3 align-top">
                            <button
                              type="button"
                              onClick={() => toggleSale(item)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${item.storeOnSale ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}
                            >
                              <Tag size={12} />
                              {item.storeOnSale ? 'Sale' : 'No'}
                            </button>
                          </td>
                          <td className="px-2 py-3 align-top">
                            {item.storeOnSale ? (
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={item.storeSalePrice ?? ''}
                                onChange={(e) => setSalePrice(item, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-400"
                              />
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => handleDuplicateItem(item)} className="p-2 rounded-lg hover:bg-blue-50 text-blue-600" title={TEXTS.duplicateItem}>
                                <Copy size={16} />
                              </button>
                              <button type="button" onClick={() => { setEditingItem(item); setGenerateDescriptionWhenOpen(true); }} className="p-2 rounded-lg hover:bg-violet-100 text-violet-600" title="Generate description (AI)">
                                <Sparkles size={16} />
                              </button>
                              <button type="button" onClick={() => setEditingItem(item)} className="p-2 rounded-lg hover:bg-slate-200 text-slate-600" title={TEXTS.editStoreItem}>
                                <Pencil size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <p className="px-4 py-6 text-slate-500 text-center text-sm">No items match the current filters.</p>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="w-full text-left px-4 py-3 flex flex-col gap-3 bg-white border-b border-slate-100 last:border-b-0"
                    >
                      <div className="flex gap-3">
                        <ItemThumbnail
                          item={item}
                          className="w-14 h-14 rounded-xl object-cover border border-slate-200 bg-slate-50 shrink-0"
                          size={56}
                          useCategoryImage
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900 text-sm truncate">{item.name}</p>
                            <span className="text-[11px] text-slate-400">{(item.sellPrice ?? 0).toFixed(2)} €</span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate">
                            {item.category}{item.subCategory ? ` • ${item.subCategory}` : ''}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.storeVisible === false ? (
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-widest">Hidden</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest">Visible</span>
                            )}
                            {item.storeOnSale && (
                              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-widest">Sale</span>
                            )}
                            {!item.imageUrl && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-widest">No image</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleDuplicateItem(item)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold hover:bg-blue-100">
                          <Copy size={14} /> {TEXTS.duplicateItem}
                        </button>
                        <button type="button" onClick={() => { setEditingItem(item); setGenerateDescriptionWhenOpen(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-800 text-xs font-semibold hover:bg-violet-100">
                          <Sparkles size={14} /> AI
                        </button>
                        <button type="button" onClick={() => setEditingItem(item)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">
                          <Pencil size={14} /> Edit
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Inquiries */}
        <div className="w-full lg:w-96 space-y-4">
          <section className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
            <h2 className="text-sm font-black text-slate-900 mb-1 flex items-center gap-2 uppercase tracking-widest">
              <MessageCircle size={16} /> {TEXTS.inquiries}
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black">{unreadCount}</span>
              )}
            </h2>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/40 overflow-hidden mt-3">
              {inquiries.length === 0 ? (
                <p className="px-4 py-8 text-slate-500 text-center text-sm">{TEXTS.noInquiries}</p>
              ) : (
                <ul className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
                  {inquiries.map((inq) => (
                    <li key={inq.id} className={`px-4 py-3 ${inq.read ? 'bg-white' : 'bg-amber-50/60'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 text-sm truncate">{inq.itemName}</p>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{inq.message}</p>
                          <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-slate-500">
                            {inq.contactName && <span>{inq.contactName}</span>}
                            {inq.contactEmail && (
                              <a href={`mailto:${inq.contactEmail}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                                <Mail size={10} /> {inq.contactEmail}
                              </a>
                            )}
                            {inq.contactPhone && (
                              <a href={`tel:${inq.contactPhone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                                <Phone size={10} /> {inq.contactPhone}
                              </a>
                            )}
                            <span>{new Date(inq.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            <select
                              value={inq.status || 'new'}
                              onChange={(e) => updateStoreInquiryStatus(inq.id, e.target.value as StoreInquiryStatus)}
                              className="text-[10px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700"
                            >
                              <option value="new">{TEXTS.statusNew}</option>
                              <option value="answered">{TEXTS.statusAnswered}</option>
                              <option value="done">{TEXTS.statusDone}</option>
                            </select>
                            <button type="button" onClick={() => navigator.clipboard.writeText(TEXTS.replyTemplateThanks)} className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title={TEXTS.copyTemplate}>Danke</button>
                            <button type="button" onClick={() => navigator.clipboard.writeText(TEXTS.replyTemplateReserved)} className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title={TEXTS.copyTemplate}>Reserviert</button>
                            <button type="button" onClick={() => navigator.clipboard.writeText(TEXTS.replyTemplateSold)} className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title={TEXTS.copyTemplate}>Verkauft</button>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <a href={`/panel/inventory?highlight=${inq.itemId}`} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" title={TEXTS.openItem}>
                            <ExternalLink size={14} />
                          </a>
                          {!inq.read && (
                            <button type="button" onClick={() => markStoreInquiryRead(inq.id, true)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-slate-200 text-slate-700 hover:bg-slate-300">
                              <Check size={10} /> {TEXTS.markRead}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {editingItem && (
        <StoreItemEditPanel
          item={editingItem}
          onSave={applyEdit}
          onClose={() => { setEditingItem(null); setGenerateDescriptionWhenOpen(false); }}
          runGenerateDescriptionOnce={generateDescriptionWhenOpen}
          onClearGenerateFlag={() => setGenerateDescriptionWhenOpen(false)}
          texts={TEXTS}
        />
      )}
    </div>
  );
};

interface EditPanelProps {
  item: InventoryItem;
  onSave: (updates: Partial<InventoryItem>) => void;
  onClose: () => void;
  runGenerateDescriptionOnce?: boolean;
  onClearGenerateFlag?: () => void;
  texts: typeof TEXTS;
}

const StoreItemEditPanel: React.FC<EditPanelProps> = ({ item, onSave, onClose, runGenerateDescriptionOnce, onClearGenerateFlag, texts }) => {
  const [name, setName] = useState(item.name);
  const [storeDescription, setStoreDescription] = useState(item.storeDescription ?? '');
  const [sellPrice, setSellPriceState] = useState<string>(item.sellPrice != null ? String(item.sellPrice) : '');
  const [storeOnSale, setStoreOnSale] = useState(!!item.storeOnSale);
  const [storeSalePrice, setStoreSalePriceState] = useState<string>(item.storeSalePrice != null ? String(item.storeSalePrice) : '');
  const [storeVisible, setStoreVisible] = useState<boolean>(item.storeVisible !== false);
  const [storeBadge, setStoreBadge] = useState<'auto' | 'New' | 'Price reduced' | 'none'>(item.storeBadge ?? 'auto');
  const [storeMetaTitle, setStoreMetaTitle] = useState(item.storeMetaTitle ?? '');
  const [storeMetaDescription, setStoreMetaDescription] = useState(item.storeMetaDescription ?? '');
  const [storeDescriptionEn, setStoreDescriptionEn] = useState(item.storeDescriptionEn ?? '');
  const [quantity, setQuantity] = useState<number>(item.quantity ?? 1);
  /** Ordered list: [0] = main image (carousel #1), rest = gallery. */
  const [storeImageUrls, setStoreImageUrls] = useState<string[]>(() => {
    const main = item.imageUrl?.trim();
    const gallery = item.storeGalleryUrls ?? [];
    if (main) return [main, ...gallery];
    return [...gallery];
  });
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [galleryProgress, setGalleryProgress] = useState<string | null>(null);
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([]);
  /** Indices of pending files to remove background from (optional per image) */
  const [removeBackgroundForIndices, setRemoveBackgroundForIndices] = useState<Set<number>>(new Set());
  const [pendingPreviewUrls, setPendingPreviewUrls] = useState<string[]>([]);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const uploadOptionsRef = useRef<HTMLDivElement>(null);
  const cloudReady = typeof window !== 'undefined' && isCloudEnabled() && !!getCurrentUser();

  const handleGenerateDescription = async () => {
    setGeneratingDescription(true);
    try {
      const text = await generateStoreDescription(name.trim() || item.name, storeDescription || undefined);
      setStoreDescription(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI description failed.';
      alert(msg);
    } finally {
      setGeneratingDescription(false);
      onClearGenerateFlag?.();
    }
  };

  useEffect(() => {
    if (runGenerateDescriptionOnce) {
      handleGenerateDescription();
    }
  }, [runGenerateDescriptionOnce]);

  const resizeImage = (file: File, maxSize = 1600, quality = 0.8): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        if (!e.target?.result) return reject(new Error("Failed to read image"));
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas not supported"));
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("Failed to compress image"));
              const ext = file.type.includes("png") ? "png" : "jpeg";
              const resizedFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + ext, {
                type: blob.type,
              });
              resolve(resizedFile);
            },
            file.type.startsWith("image/") ? file.type : "image/jpeg",
            quality
          );
        };
        img.onerror = () => reject(new Error("Invalid image"));
        img.src = e.target.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  // Revoke preview object URLs on unmount or when pending files are replaced
  useEffect(() => {
    const urls = pendingPreviewUrls;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingPreviewUrls]);

  const handleSelectGalleryFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPendingPreviewUrls([]);
    setRemoveBackgroundForIndices(new Set());
    setPendingGalleryFiles(files);
    setGalleryProgress(files.length ? `${files.length} selected` : null);
    if (files.length > 0) {
      setPendingPreviewUrls(files.map((f) => URL.createObjectURL(f)));
    }
    if (files.length > 0 && uploadOptionsRef.current) {
      setTimeout(() => uploadOptionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  };

  const toggleRemoveBackgroundForIndex = (idx: number) => {
    setRemoveBackgroundForIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleConfirmGalleryUpload = async () => {
    if (!pendingGalleryFiles.length) return;
    if (!cloudReady) {
      alert('To upload gallery images, first enable Cloud sync and sign in with Google in Settings (top-right).');
      return;
    }
    try {
      setUploadingGallery(true);
      setGalleryProgress(`0 / ${pendingGalleryFiles.length}`);
      const urls: string[] = [];
      
      for (let idx = 0; idx < pendingGalleryFiles.length; idx++) {
        let file = pendingGalleryFiles[idx];
        const removeBg = removeBackgroundForIndices.has(idx);

        if (removeBg) {
          try {
            setGalleryProgress(`Removing background ${idx + 1} / ${pendingGalleryFiles.length}...`);
            const processedBlob = await removeBackground(file);
            file = new File([processedBlob], `bg-removed-${Date.now()}-${file.name}`, { type: 'image/png' });
          } catch (bgErr: any) {
            console.warn('Background removal failed for one image, continuing with original:', bgErr);
            alert(`Background removal failed for image ${idx + 1}. Uploading original image instead.`);
          }
        }

        // Resize then upload (show each step so we see where it hangs)
        setGalleryProgress(`Resizing ${idx + 1} / ${pendingGalleryFiles.length}...`);
        const resized = await resizeImage(file, 1600, 0.9);
        setGalleryProgress(`Uploading ${idx + 1} / ${pendingGalleryFiles.length}...`);
        const url = await uploadItemImage(resized, item.id, (pct) => {
          setGalleryProgress(`Uploading ${idx + 1} / ${pendingGalleryFiles.length} (${Math.round(pct)}%)...`);
        });
        urls.push(url);
        setGalleryProgress(`${idx + 1} / ${pendingGalleryFiles.length}`);
      }
      
      setStoreImageUrls((prev) => [...prev, ...urls]);
      pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      setPendingPreviewUrls([]);
      setPendingGalleryFiles([]);
      setRemoveBackgroundForIndices(new Set());
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingGallery(false);
      setGalleryProgress(null);
    }
  };

  const handleSave = () => {
    const main = storeImageUrls[0]?.trim();
    const rest = storeImageUrls.length > 1 ? storeImageUrls.slice(1) : undefined;
    onSave({
      name: name.trim() || item.name,
      storeDescription: storeDescription.trim() || undefined,
      sellPrice: sellPrice === '' ? undefined : parseFloat(sellPrice) || undefined,
      storeVisible,
      storeOnSale,
      storeSalePrice: storeSalePrice === '' ? undefined : parseFloat(storeSalePrice) || undefined,
      storeBadge: storeBadge === 'auto' ? undefined : storeBadge,
      storeMetaTitle: storeMetaTitle.trim() || undefined,
      storeMetaDescription: storeMetaDescription.trim() || undefined,
      storeDescriptionEn: storeDescriptionEn.trim() || undefined,
      quantity: quantity < 0 ? undefined : quantity,
      imageUrl: main || undefined,
      storeGalleryUrls: rest?.length ? rest : undefined,
    });
  };

  const setStoreImageAsMain = (index: number) => {
    if (index <= 0) return;
    setStoreImageUrls((prev) => {
      const next = [...prev];
      const [url] = next.splice(index, 1);
      next.unshift(url);
      return next;
    });
  };

  const removeStoreImage = (index: number) => {
    setStoreImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStoreImage = (index: number, delta: -1 | 1) => {
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= storeImageUrls.length) return;
    setStoreImageUrls((prev) => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 z-0" onClick={onClose} />
      {/* Slide-over panel */}
      <div className="relative z-10 w-full max-w-md bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">{texts.editStoreItem}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Visibility</p>
              <p className="text-[11px] text-slate-500">
                {storeVisible ? 'This item is visible on the storefront.' : 'This item is hidden from the storefront.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStoreVisible((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold ${
                storeVisible
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {storeVisible ? <Eye size={12} /> : <EyeOff size={12} />}
              {storeVisible ? texts.visible : texts.hidden}
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.storeDescription}</label>
            <button
              type="button"
              onClick={handleGenerateDescription}
              disabled={generatingDescription}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-violet-400 bg-violet-50 text-violet-800 text-sm font-semibold hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed mb-2"
            >
              {generatingDescription ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Generate description (AI)
                </>
              )}
            </button>
            <textarea value={storeDescription} onChange={(e) => setStoreDescription(e.target.value)} rows={12} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 resize-y font-mono whitespace-pre-line" placeholder="Structured description (German, with emojis and sections). Use the button above to generate with AI." />
            <p className="mt-1 text-[11px] text-slate-500">Generated text is kept until you click “Generate description” again or edit it. Save to store permanently.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{texts.priceEur}</label>
              <input type="number" min={0} step={0.01} value={sellPrice} onChange={(e) => setSellPriceState(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">On sale</label>
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={storeOnSale} onChange={(e) => setStoreOnSale(e.target.checked)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                <span className="text-sm text-slate-700">Show as sale</span>
              </label>
            </div>
          </div>
          {storeOnSale && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Sale price €</label>
              <input type="number" min={0} step={0.01} value={storeSalePrice} onChange={(e) => setStoreSalePriceState(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Store badge</label>
            <select value={storeBadge} onChange={(e) => setStoreBadge(e.target.value as 'auto' | 'New' | 'Price reduced' | 'none')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400">
              <option value="auto">Auto (New this week / Price reduced from history)</option>
              <option value="New">Always show “New”</option>
              <option value="Price reduced">Always show “Price reduced”</option>
              <option value="none">No badge</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500">Auto: “New” if added in last 7 days; “Price reduced” if sell price was lowered (from price history).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SEO meta title</label>
            <input type="text" value={storeMetaTitle} onChange={(e) => setStoreMetaTitle(e.target.value)} placeholder={item.name} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-[11px] text-slate-500">Used in &lt;title&gt; and sharing when this item is open. Defaults to item name.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SEO meta description</label>
            <textarea value={storeMetaDescription} onChange={(e) => setStoreMetaDescription(e.target.value)} rows={2} placeholder="Short description for search and social sharing" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 resize-y" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Store description (English)</label>
            <textarea value={storeDescriptionEn} onChange={(e) => setStoreDescriptionEn(e.target.value)} rows={4} placeholder="Optional English description when store language is EN" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 resize-y" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Quantity (store stock)</label>
            <input type="number" min={0} value={quantity} onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-[11px] text-slate-500">Shows &quot;Only 1 left&quot; when 1, &quot;Out of stock&quot; when 0. Default 1.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.galleryUrls}</label>
            <p className="text-[11px] text-slate-500 mb-2">{texts.galleryNote}</p>
            <div className="flex flex-col sm:flex-row items-start gap-3">
              <div className="flex-1 w-full space-y-2">
                {storeImageUrls.length > 0 ? (
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {storeImageUrls.map((url, idx) => (
                      <div key={`${url}-${idx}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <span className="text-[11px] font-bold text-slate-400 w-5 shrink-0">{idx + 1}</span>
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-white shrink-0">
                          <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {idx === 0 ? (
                            <span className="text-xs font-semibold text-emerald-700">Main (carousel #1)</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setStoreImageAsMain(idx)}
                              className="text-xs font-medium text-violet-600 hover:text-violet-800"
                            >
                              Set as main
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveStoreImage(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 rounded hover:bg-slate-200 disabled:opacity-40 text-slate-600"
                            aria-label="Move left"
                          >
                            <span className="text-xs font-bold">←</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStoreImage(idx, 1)}
                            disabled={idx === storeImageUrls.length - 1}
                            className="p-1 rounded hover:bg-slate-200 disabled:opacity-40 text-slate-600"
                            aria-label="Move right"
                          >
                            <span className="text-xs font-bold">→</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStoreImage(idx)}
                            className="p-1 rounded-full hover:bg-red-100 text-slate-600 hover:text-red-700"
                            aria-label="Remove image"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div ref={uploadOptionsRef} className="flex flex-col gap-2 w-full sm:w-auto shrink-0">
                <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition-colors">
                  <ImageIcon size={16} />
                  <span>Select Images</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleSelectGalleryFiles}
                    disabled={uploadingGallery}
                  />
                </label>
                {pendingGalleryFiles.length > 0 && (
                  <div className="space-y-2 p-3 bg-blue-50 border-2 border-blue-300 rounded-lg shadow-sm">
                    <p className="text-xs font-semibold text-blue-900 text-center">
                      {pendingGalleryFiles.length} image{pendingGalleryFiles.length > 1 ? 's' : ''} selected
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {pendingGalleryFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white p-2">
                          <div className="w-12 h-12 rounded border border-slate-200 overflow-hidden bg-slate-50 shrink-0">
                            {pendingPreviewUrls[idx] && (
                              <img src={pendingPreviewUrls[idx]} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <span className="flex-1 min-w-0 truncate text-xs text-slate-700" title={file.name}>
                            {file.name}
                          </span>
                          <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={removeBackgroundForIndices.has(idx)}
                              onChange={() => toggleRemoveBackgroundForIndex(idx)}
                              disabled={uploadingGallery}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                            />
                            <Sparkles size={12} className="text-blue-600" />
                            <span className="text-[11px] font-medium text-blue-800">Remove BG</span>
                          </label>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmGalleryUpload}
                      disabled={uploadingGallery}
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 active:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                      {uploadingGallery ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          {galleryProgress || 'Uploading…'}
                        </span>
                      ) : (
                        `Upload ${pendingGalleryFiles.length} image${pendingGalleryFiles.length > 1 ? 's' : ''}`
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100">
            {texts.cancel}
          </button>
          <button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
            {texts.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoreManagementPage;
