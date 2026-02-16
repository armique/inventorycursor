import React, { useState, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Tag, MessageCircle, ExternalLink, Loader2, Check, Mail, Phone, Upload, CheckCircle2, Pencil, X, Image as ImageIcon, Filter, Search as SearchIcon, Wand2 } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { subscribeToStoreInquiries, markStoreInquiryRead, uploadItemImage, isCloudEnabled, getCurrentUser } from '../services/firebaseService';
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
  priceEur: 'Price €',
  editStoreItem: 'Edit store listing',
  storeDescription: 'Store description',
  galleryUrls: 'Gallery image URLs (one per line)',
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
  const applyEdit = (updates: Partial<InventoryItem>) => {
    if (!editingItem) return;
    const next = items.map((it) => (it.id === editingItem.id ? { ...it, ...updates } : it));
    onUpdate(next);
    setEditingItem(null);
  };

  const unreadCount = inquiries.filter((i) => !i.read).length;

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
  const [galleryUrlsText, setGalleryUrlsText] = useState((item.storeGalleryUrls ?? []).join('\n'));
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [galleryProgress, setGalleryProgress] = useState<string | null>(null);
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([]);
  const cloudReady = typeof window !== 'undefined' && isCloudEnabled() && !!getCurrentUser();

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

  const handleSelectGalleryFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setPendingGalleryFiles(files);
    setGalleryProgress(files.length ? `${files.length} selected` : null);
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
        const file = pendingGalleryFiles[idx];
        const resized = await resizeImage(file);
        const url = await uploadItemImage(resized, item.id);
        urls.push(url);
        setGalleryProgress(`${idx + 1} / ${pendingGalleryFiles.length}`);
      }
      setGalleryUrlsText((prev) => {
        const existing = prev ? prev.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
        return [...existing, ...urls].join('\n');
      });
      setPendingGalleryFiles([]);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingGallery(false);
      setGalleryProgress(null);
    }
  };

  const handleSave = () => {
    const galleryUrls = galleryUrlsText.trim()
      ? galleryUrlsText
          .trim()
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    onSave({
      name: name.trim() || item.name,
      storeDescription: storeDescription.trim() || undefined,
      sellPrice: sellPrice === '' ? undefined : parseFloat(sellPrice) || undefined,
      storeOnSale,
      storeSalePrice: storeSalePrice === '' ? undefined : parseFloat(storeSalePrice) || undefined,
      // Use first gallery image as the main image for item cards
      imageUrl: galleryUrls && galleryUrls.length > 0 ? galleryUrls[0] : undefined,
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
            <label className="block text-xs font-medium text-slate-500 mb-1">{texts.galleryUrls}</label>
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                {/* Hidden textarea keeps string representation but UI focuses on thumbnails/buttons for simplicity */}
                <textarea
                  value={galleryUrlsText}
                  onChange={(e) => setGalleryUrlsText(e.target.value)}
                  rows={3}
                  className="hidden"
                  placeholder="https://…&#10;https://…"
                />
                {/* Gallery preview with delete buttons */}
                {galleryUrlsText.trim() && (
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {galleryUrlsText
                      .trim()
                      .split(/\r?\n/)
                      .map((u) => u.trim())
                      .filter(Boolean)
                      .map((url, idx) => (
                        <div key={`${url}-${idx}`} className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                          <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          <div className="absolute top-0 right-0 flex flex-col items-end gap-0.5 m-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const urls = galleryUrlsText
                                  .split(/\r?\n/)
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                urls.splice(idx, 1);
                                setGalleryUrlsText(urls.join('\n'));
                              }}
                              className="rounded-full bg-black/70 text-white p-0.5"
                              aria-label="Remove image"
                            >
                              <X size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  // Optional per-image AI enhancement: download existing image and replace URL
                                  const resp = await fetch(url);
                                  const blob = await resp.blob();
                                  const file = new File([blob], 'enhance.png', { type: blob.type || 'image/png' });
                                  alert('AI enhancement is currently disabled by default for reliability. You can still edit or replace this image manually.');
                                  // In future, we can re-enable calling /api/enhance-image here if desired.
                                } catch {
                                  alert('Could not enhance this image.');
                                }
                              }}
                              className="rounded-full bg-white/80 text-slate-800 p-0.5"
                              aria-label="Enhance image"
                            >
                              <Wand2 size={10} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <label className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                  <ImageIcon size={14} />
                  Upload images
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
                  <button
                    type="button"
                    onClick={handleConfirmGalleryUpload}
                    disabled={uploadingGallery}
                    className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {uploadingGallery ? galleryProgress || 'Uploading…' : `Start upload (${pendingGalleryFiles.length})`}
                  </button>
                )}
              </div>
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
