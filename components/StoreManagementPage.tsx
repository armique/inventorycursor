import React, { useState, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Tag, MessageCircle, ExternalLink, Loader2, Check, Mail, Phone, Upload, CheckCircle2, FolderOpen, Pencil, X, Image as ImageIcon, Filter, Search as SearchIcon } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { subscribeToStoreInquiries, markStoreInquiryRead, uploadItemImage } from '../services/firebaseService';
import type { StoreCategoryFilter } from '../App';
import ItemThumbnail from './ItemThumbnail';

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
  catalogNote: 'Only "In Stock" items appear below. "Show" = on storefront; "Hide" = hidden. Catalog updates ~1s after changes, or click Publish to store now. Only “In Stock” items with “Visible on store” appear on the storefront.',
  publishNow: 'Publish to store now',
  published: 'Published',
  showOnStore: 'Show',
  hideFromStore: 'Hide',
  categoriesOnStore: 'Categories on store',
  categoriesOnStoreNote: 'Choose which categories and subcategories appear on the storefront. Leave all checked to show everything.',
  showAll: 'Show all',
  hideAll: 'Hide all',
  priceEur: 'Price €',
  editStoreItem: 'Edit store listing',
  storeDescription: 'Store description',
  mainImageUrl: 'Main image URL',
  galleryUrls: 'Gallery image URLs (one per line)',
  save: 'Save',
  cancel: 'Cancel',
};

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  storeCategoryFilter: StoreCategoryFilter;
  onStoreCategoryFilterChange: (filter: StoreCategoryFilter) => void;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => Promise<void>;
}

const IN_STOCK = ItemStatus.IN_STOCK;

function isSubcategoryShown(filter: StoreCategoryFilter, category: string, subcategory: string): boolean {
  const rule = filter[category];
  // Align with storefront: if a category is not configured in the filter at all,
  // treat it as HIDDEN (only explicitly selected categories/subcategories are shown).
  if (rule === undefined) return false;
  if (rule === true) return true;
  return rule.includes(subcategory);
}

const StoreManagementPage: React.FC<Props> = ({ items, categories, categoryFields, storeCategoryFilter, onStoreCategoryFilterChange, onUpdate, onPublishCatalog }) => {
  const [inquiries, setInquiries] = useState<({ id: string; itemId: string; itemName: string; message: string; contactEmail?: string; contactPhone?: string; contactName?: string; createdAt: string; read?: boolean })[]>([]);
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

  // Base set: all in-stock items
  const inStockItems = items.filter((i) => i.status === IN_STOCK);

  // Items whose category/subcategory is enabled in "Categories on store"
  const enabledByCategory = inStockItems.filter((i) => {
    if (i.status !== IN_STOCK) return false;
    const cat = i.category;
    if (!cat) return false;
    const sub = i.subCategory || '';
    const subs = categories[cat] || [];
    // If category has no configured subcategories, treat as visible by default.
    if (subs.length === 0) return true;
    return isSubcategoryShown(storeCategoryFilter, cat, sub);
  });

  // Items actually shown in the main table (respecting category visibility)
  const storeVisibleItems = enabledByCategory;
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
  const applyEdit = (updates: Partial<InventoryItem>) => {
    if (!editingItem) return;
    const next = items.map((it) => (it.id === editingItem.id ? { ...it, ...updates } : it));
    onUpdate(next);
    setEditingItem(null);
  };

  const unreadCount = inquiries.filter((i) => !i.read).length;

  // Categories used in the UI: merge configured categories with actual in-stock item categories
  const categoryEntries = useMemo(() => {
    const merged: Record<string, string[]> = { ...(categories || {}) };
    inStockItems.forEach((item) => {
      if (item.category && !merged[item.category]) {
        merged[item.category] = [];
      }
    });
    return Object.entries(merged).filter(([cat]) => cat && cat !== 'Unknown');
  }, [categories, inStockItems]);
  const toggleCategorySubcategory = (category: string, subcategory: string, show: boolean) => {
    const subs = categories[category] || [];
    let next: true | string[];
    if (show) {
      const arr = Array.from(new Set([...(Array.isArray(storeCategoryFilter[category]) ? storeCategoryFilter[category] : []), subcategory]));
      next = arr.length === subs.length ? true : arr;
    } else {
      const arr = storeCategoryFilter[category] === true
        ? subs.filter((s) => s !== subcategory)
        : (Array.isArray(storeCategoryFilter[category]) ? storeCategoryFilter[category].filter((s) => s !== subcategory) : []);
      next = arr;
    }
    onStoreCategoryFilterChange({ ...storeCategoryFilter, [category]: next });
  };
  const setCategoryAll = (category: string, show: boolean) => {
    // Update category visibility filter
    const nextFilter: StoreCategoryFilter = {
      ...storeCategoryFilter,
      [category]: show ? true : [],
    };
    onStoreCategoryFilterChange(nextFilter);

    // Also update storeVisible flag for all in-stock items in this category so that
    // "Show all" / "Hide all" has an immediate effect on what is considered visible.
    const nextItems = items.map((it) =>
      it.status === IN_STOCK && it.category === category
        ? { ...it, storeVisible: show }
        : it
    );
    onUpdate(nextItems);
  };

  const totalInStock = inStockItems.length;
  const visibleCount = storeVisibleItems.filter((i) => i.storeVisible !== false).length;
  const onSaleCount = storeVisibleItems.filter((i) => i.storeVisible !== false && i.storeOnSale).length;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [saleFilter, setSaleFilter] = useState<'all' | 'sale' | 'regular'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'priceAsc' | 'priceDesc' | 'nameAsc'>('recent');

  const hideAllCategories = () => {
    const nextFilter: StoreCategoryFilter = {};
    Object.keys(categories || {}).forEach((cat) => {
      if (!cat || cat === 'Unknown') return;
      nextFilter[cat] = [];
    });
    onStoreCategoryFilterChange(nextFilter);

    // Also mark all currently in-stock items as not visible on store for clarity.
    const nextItems = items.map((it) =>
      it.status === IN_STOCK ? { ...it, storeVisible: false } : it
    );
    onUpdate(nextItems);
  };

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
          <div className="flex flex-wrap gap-3 mt-4 text-xs">
            <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 font-bold uppercase tracking-widest">
              {totalInStock} In-stock
            </span>
            <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 font-bold uppercase tracking-widest">
              {visibleCount} Visible
            </span>
            <span className="px-3 py-1.5 rounded-full bg-rose-100 text-rose-700 font-bold uppercase tracking-widest">
              {onSaleCount} On sale
            </span>
          </div>
        </div>
        {onPublishCatalog && (
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {publishing ? <Loader2 size={18} className="animate-spin" /> : publishedAt ? <CheckCircle2 size={18} /> : <Upload size={18} />}
              {publishing ? 'Publishing…' : publishedAt ? TEXTS.published : TEXTS.publishNow}
            </button>
            {publishedAt && (
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                Last published {new Date(publishedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
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
                <button
                  type="button"
                  onClick={hideAllCategories}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 bg-white hover:bg-slate-50"
                  title="Hide all categories from store"
                >
                  Hide all
                </button>
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
                      <th className="px-3 py-3 w-10"></th>
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
                            <button
                              type="button"
                              onClick={() => setEditingItem(item)}
                              className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
                              title={TEXTS.editStoreItem}
                            >
                              <Pencil size={16} />
                            </button>
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
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setEditingItem(item)}
                      className="w-full text-left px-4 py-3 flex gap-3 bg-white hover:bg-slate-50 active:bg-slate-100"
                    >
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
                        <p className="mt-1 text-[10px] text-slate-400">Tap to edit price, visibility, gallery & description.</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Categories + Inquiries */}
        <div className="w-full lg:w-96 space-y-4">
          <section className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
            <h2 className="text-sm font-black text-slate-900 mb-1 flex items-center gap-2 uppercase tracking-widest">
              <FolderOpen size={16} /> {TEXTS.categoriesOnStore}
            </h2>
            <p className="text-xs text-slate-500 mb-4">{TEXTS.categoriesOnStoreNote}</p>
            <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
              {categoryEntries.length === 0 ? (
                <p className="text-xs text-slate-500">No categories defined. Add categories in Settings or when adding items.</p>
              ) : (
                categoryEntries.map(([category, subcategories]) => (
                  <div key={category} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between bg-slate-50">
                      <span className="text-xs font-semibold text-slate-800">{category}</span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCategoryAll(category, true)}
                          className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 px-2 py-1 rounded-lg hover:bg-emerald-50"
                        >
                          {TEXTS.showAll}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCategoryAll(category, false)}
                          className="text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100"
                        >
                          {TEXTS.hideAll}
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2 space-y-1">
                      {subcategories.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No subcategories</p>
                      ) : (
                        subcategories.map((sub) => {
                          const shown = isSubcategoryShown(storeCategoryFilter, category, sub);
                          return (
                            <label key={`${category}:${sub}`} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={shown}
                                onChange={() => toggleCategorySubcategory(category, sub, !shown)}
                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>{sub}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

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
                <ul className="max-h-[260px] overflow-y-auto divide-y divide-slate-100">
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
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <a
                            href={`/panel/inventory?highlight=${inq.itemId}`}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                            title={TEXTS.openItem}
                          >
                            <ExternalLink size={14} />
                          </a>
                          {!inq.read && (
                            <button
                              type="button"
                              onClick={() => markStoreInquiryRead(inq.id, true)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-slate-200 text-slate-700 hover:bg-slate-300"
                            >
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
          onClose={() => setEditingItem(null)}
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
  texts: typeof TEXTS;
}

const StoreItemEditPanel: React.FC<EditPanelProps> = ({ item, onSave, onClose, texts }) => {
  const [name, setName] = useState(item.name);
  const [storeDescription, setStoreDescription] = useState(item.storeDescription ?? '');
  const [sellPrice, setSellPriceState] = useState<string>(item.sellPrice != null ? String(item.sellPrice) : '');
  const [storeOnSale, setStoreOnSale] = useState(!!item.storeOnSale);
  const [storeSalePrice, setStoreSalePriceState] = useState<string>(item.storeSalePrice != null ? String(item.storeSalePrice) : '');
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? '');
  const [galleryUrlsText, setGalleryUrlsText] = useState((item.storeGalleryUrls ?? []).join('\n'));
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });

  const dataUrlToFile = async (dataUrl: string, fallbackName: string): Promise<File> => {
    const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
    if (!match) {
      throw new Error('Invalid enhanced image data');
    }
    const mime = match[1];
    const base64 = match[2];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new File([bytes], fallbackName, { type: mime });
  };

  const enhanceWithAI = async (file: File): Promise<File> => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const kind =
        item.isPC || item.category === 'PC' || item.subCategory === 'Custom Built PC' || item.subCategory === 'Pre-Built PC'
          ? 'pc'
          : 'part';
      const resp = await fetch('/api/enhance-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: dataUrl,
          kind,
          name: item.name,
          category: item.category,
          subCategory: item.subCategory,
        }),
      });
      if (!resp.ok) return file;
      const json = await resp.json().catch(() => null);
      if (!json?.dataUrl || typeof json.dataUrl !== 'string') return file;
      return await dataUrlToFile(json.dataUrl, `enhanced-${file.name || 'image.png'}`);
    } catch {
      return file;
    }
  };

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

  const handleUploadMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadingMain(true);
      const resized = await resizeImage(file);
      const enhanced = await enhanceWithAI(resized);
      const url = await uploadItemImage(enhanced, item.id);
      setImageUrl(url);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingMain(false);
    }
  };

  const handleUploadGalleryImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadingGallery(true);
      const resized = await resizeImage(file);
      const enhanced = await enhanceWithAI(resized);
      const url = await uploadItemImage(enhanced, item.id);
      setGalleryUrlsText((prev) => (prev ? `${prev}\n${url}` : url));
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingGallery(false);
    }
  };

  const handleSave = () => {
    const galleryUrls = galleryUrlsText.trim() ? galleryUrlsText.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined;
    onSave({
      name: name.trim() || item.name,
      storeDescription: storeDescription.trim() || undefined,
      sellPrice: sellPrice === '' ? undefined : parseFloat(sellPrice) || undefined,
      storeOnSale,
      storeSalePrice: storeSalePrice === '' ? undefined : parseFloat(storeSalePrice) || undefined,
      imageUrl: imageUrl.trim() || undefined,
      storeGalleryUrls: galleryUrls?.length ? galleryUrls : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">{texts.editStoreItem}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.storeDescription}</label>
            <textarea value={storeDescription} onChange={(e) => setStoreDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 resize-none" placeholder="Short description for the store" />
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
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.mainImageUrl}</label>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              />
              <label className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                <Upload size={14} />
                {uploadingMain ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/*" className="hidden" onChange={handleUploadMainImage} disabled={uploadingMain} />
              </label>
            </div>
            {imageUrl && (
              <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 aspect-video flex items-center justify-center">
                <img src={imageUrl} alt="" className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.galleryUrls}</label>
            <div className="flex items-start gap-2">
              <textarea
                value={galleryUrlsText}
                onChange={(e) => setGalleryUrlsText(e.target.value)}
                rows={3}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 resize-none font-mono text-xs"
                placeholder="https://…&#10;https://…"
              />
              <label className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer shrink-0">
                <ImageIcon size={14} />
                {uploadingGallery ? 'Uploading…' : 'Add image'}
                <input type="file" accept="image/*" className="hidden" onChange={handleUploadGalleryImage} disabled={uploadingGallery} />
              </label>
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
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
