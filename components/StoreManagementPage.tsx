import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Tag, MessageCircle, ExternalLink, Loader2, Check, Mail, Phone, Upload, CheckCircle2, FolderOpen, Pencil, X, Image as ImageIcon } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { subscribeToStoreInquiries, markStoreInquiryRead, uploadItemImage } from '../services/firebaseService';
import type { StoreCategoryFilter } from '../App';

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
  if (rule === undefined) return true;
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

  const categoryEntries = Object.entries(categories || {}).filter(([cat]) => cat && cat !== 'Unknown');
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
    onStoreCategoryFilterChange({
      ...storeCategoryFilter,
      [category]: show ? true : [],
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{TEXTS.title}</h1>
          <p className="text-slate-600 mt-1">{TEXTS.subtitle}</p>
        </div>
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
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <FolderOpen size={20} /> {TEXTS.categoriesOnStore}
        </h2>
        <p className="text-sm text-slate-500 mb-4">{TEXTS.categoriesOnStoreNote}</p>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {categoryEntries.length === 0 ? (
            <p className="px-4 py-6 text-slate-500 text-sm">No categories defined. Add categories in Settings or when adding items.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {categoryEntries.map(([category, subcategories]) => {
                return (
                  <li key={category} className="bg-white">
                    <div className="px-4 py-3 flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/50">
                      <span className="font-semibold text-slate-800">{category}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setCategoryAll(category, true)} className="text-xs font-medium text-emerald-600 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50">
                          {TEXTS.showAll}
                        </button>
                        <button type="button" onClick={() => setCategoryAll(category, false)} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100">
                          {TEXTS.hideAll}
                        </button>
                      </div>
                    </div>
                    <ul className="divide-y divide-slate-50">
                      {subcategories.length === 0 ? (
                        <li className="px-4 py-2 text-slate-500 text-sm">No subcategories</li>
                      ) : (
                        subcategories.map((sub) => {
                          const shown = isSubcategoryShown(storeCategoryFilter, category, sub);
                          return (
                            <li key={`${category}:${sub}`} className="px-6 py-2.5 flex items-center gap-3">
                              <label className="flex items-center gap-2 cursor-pointer flex-1">
                                <input
                                  type="checkbox"
                                  checked={shown}
                                  onChange={() => toggleCategorySubcategory(category, sub, !shown)}
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-sm text-slate-700">{sub}</span>
                              </label>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Visibility & sale</h2>
        <p className="text-sm text-slate-500 mb-4">{TEXTS.catalogNote}</p>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-4 py-3 font-medium text-slate-600">Item</th>
                <th className="px-4 py-3 font-medium text-slate-600 w-24">{TEXTS.priceEur}</th>
                <th className="px-4 py-3 font-medium text-slate-600 w-24">Store</th>
                <th className="px-4 py-3 font-medium text-slate-600 w-24">Sale</th>
                <th className="px-4 py-3 font-medium text-slate-600 w-28">Sale price €</th>
                <th className="px-4 py-3 font-medium text-slate-600 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {storeVisibleItems.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-slate-500 text-center">No in-stock items.</td></tr>
              ) : (
                storeVisibleItems.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{item.name}</span>
                      <span className="text-slate-500 ml-2">{item.category}{item.subCategory ? ` / ${item.subCategory}` : ''}</span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.sellPrice ?? ''}
                        onChange={(e) => setSellPrice(item, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {item.storeVisible !== false ? (
                        <button type="button" onClick={() => setVisibility(item, false)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200" title="Click to hide from store">
                          <Eye size={14} /> {TEXTS.hideFromStore}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setVisibility(item, true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-200 text-slate-600 hover:bg-slate-300" title="Click to show on store">
                          <EyeOff size={14} /> {TEXTS.showOnStore}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSale(item)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${item.storeOnSale ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}
                      >
                        <Tag size={14} />
                        {item.storeOnSale ? 'Sale' : 'No'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {item.storeOnSale ? (
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.storeSalePrice ?? ''}
                          onChange={(e) => setSalePrice(item, e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setEditingItem(item)} className="p-2 rounded-lg hover:bg-slate-200 text-slate-600" title={TEXTS.editStoreItem}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <MessageCircle size={20} /> {TEXTS.inquiries}
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">{unreadCount}</span>
          )}
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {inquiries.length === 0 ? (
            <p className="px-4 py-8 text-slate-500 text-center">{TEXTS.noInquiries}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {inquiries.map((inq) => (
                <li key={inq.id} className={`px-4 py-4 ${inq.read ? 'bg-slate-50/50' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{inq.itemName}</p>
                      <p className="text-sm text-slate-600 mt-1">{inq.message}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                        {inq.contactName && <span className="flex items-center gap-1">{inq.contactName}</span>}
                        {inq.contactEmail && (
                          <a href={`mailto:${inq.contactEmail}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                            <Mail size={12} /> {inq.contactEmail}
                          </a>
                        )}
                        {inq.contactPhone && (
                          <a href={`tel:${inq.contactPhone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                            <Phone size={12} /> {inq.contactPhone}
                          </a>
                        )}
                        <span>{new Date(inq.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a href={`/panel/inventory?highlight=${inq.itemId}`} className="p-2 rounded-lg hover:bg-slate-200 text-slate-600" title={TEXTS.openItem}>
                        <ExternalLink size={16} />
                      </a>
                      {!inq.read && (
                        <button
                          type="button"
                          onClick={() => markStoreInquiryRead(inq.id, true)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300"
                        >
                          <Check size={12} /> {TEXTS.markRead}
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
      const url = await uploadItemImage(resized, item.id);
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
      const url = await uploadItemImage(resized, item.id);
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
