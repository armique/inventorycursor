import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Loader2,
  Sparkles,
  X,
  Check,
  Upload,
  Image as ImageIcon,
  Images,
  Trash2,
  Cloud,
  Plus,
  Maximize2,
} from 'lucide-react';
import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import {
  fetchProductCardProviders,
  generateProductCard,
  type ProductCardProviderId,
  type ProductCardProviderInfo,
} from '../services/productCardGemini';
import { filesToDataUrls, getItemUserPhotoUrls } from '../utils/imageImport';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES,
  type ProductCardStyleId,
} from '../services/productCardStyles';
import {
  buildProductCardFileName,
  downloadProductCardEntry,
  isProductCardGalleryCloudReady,
  listProductCardGallery,
  removeProductCardFromGallery,
  resolveProductCardImageUrl,
  saveGeneratedProductCard,
} from '../services/productCardGallery';
import { resolveUrlForInventoryMainPhoto } from '../utils/applyProductCardAsMainPhoto';

interface Props {
  item: InventoryItem;
  categoryFields?: string[];
  onClose: () => void;
  onApplyAsMainPhoto: (url: string) => void | Promise<void>;
  onAddToItemGallery: (url: string) => void | Promise<void>;
}

const GeminiProductCardModal: React.FC<Props> = ({
  item,
  categoryFields,
  onClose,
  onApplyAsMainPhoto,
  onAddToItemGallery,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const itemPhotos = useMemo(() => getItemUserPhotoUrls(item).slice(0, 3), [item]);
  const [customPhotos, setCustomPhotos] = useState<string[]>([]);
  const [useItemPhotos, setUseItemPhotos] = useState(true);
  const [provider, setProvider] = useState<ProductCardProviderId>('openai');
  const [providers, setProviders] = useState<ProductCardProviderInfo[]>([]);
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [addingToGallery, setAddingToGallery] = useState(false);
  const [started, setStarted] = useState(false);
  const [savingGallery, setSavingGallery] = useState(false);
  const [galleryNote, setGalleryNote] = useState<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<GeneratedProductCardEntry | null>(null);
  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<Record<string, string>>({});
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryScope, setGalleryScope] = useState<'item' | 'all'>('item');
  const [enlargedSrc, setEnlargedSrc] = useState<string | null>(null);
  const [enlargedLabel, setEnlargedLabel] = useState<string | null>(null);

  const openEnlarged = (src: string | null | undefined, label?: string) => {
    if (!src) return;
    setEnlargedSrc(src);
    setEnlargedLabel(label || null);
  };

  const activePhotos = useMemo(() => {
    if (customPhotos.length) return customPhotos.slice(0, 3);
    if (useItemPhotos) return itemPhotos;
    return [];
  }, [customPhotos, useItemPhotos, itemPhotos]);

  const styleName = PRODUCT_CARD_STYLES.find((s) => s.id === styleId)?.name;

  const reloadGallery = async (scope: 'item' | 'all' = galleryScope) => {
    setGalleryLoading(true);
    try {
      const list = await listProductCardGallery(scope === 'item' ? item.id : undefined);
      setGallery(list);
      const thumbs: Record<string, string> = {};
      await Promise.all(
        list.slice(0, 36).map(async (e) => {
          try {
            thumbs[e.id] = await resolveProductCardImageUrl(e);
          } catch {
            /* skip */
          }
        })
      );
      setGalleryThumbs(thumbs);
    } catch {
      /* ignore */
    } finally {
      setGalleryLoading(false);
    }
  };

  useEffect(() => {
    void fetchProductCardProviders().then((list) => {
      setProviders(list);
      const preferred =
        list.find((p) => p.id === 'openai' && p.available) ||
        list.find((p) => p.available) ||
        list[0];
      if (preferred?.id) setProvider(preferred.id);
    });
    void reloadGallery('item');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (showGallery) void reloadGallery(galleryScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGallery, galleryScope, item.id]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const urls = await filesToDataUrls(Array.from(files).slice(0, 3), { itemId: item.id });
      setCustomPhotos(urls);
      setUseItemPhotos(false);
    } catch (e) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      setError(localImageReadErrorMessage(e, 'Could not load photo'));
    } finally {
      setUploading(false);
    }
  };

  const persistToGallery = async (
    dataUrl: string,
    info: { provider?: string; model?: string; styleName?: string }
  ): Promise<GeneratedProductCardEntry | null> => {
    setSavingGallery(true);
    setGalleryNote(null);
    try {
      const entry = await saveGeneratedProductCard({
        itemId: item.id,
        itemName: item.name,
        dataUrl,
        provider: info.provider,
        model: info.model,
        styleId,
        styleName: info.styleName,
      });
      setSavedEntry(entry);
      setGalleryNote(
        entry.cloudStored
          ? 'Saved to cloud gallery (high quality) — credits safe'
          : 'Saved locally (IndexedDB) — sign in to also sync to cloud'
      );
      void reloadGallery(galleryScope);
      return entry;
    } catch (e) {
      setGalleryNote(e instanceof Error ? e.message : 'Could not save to gallery');
      return null;
    } finally {
      setSavingGallery(false);
    }
  };

  const run = async () => {
    setStarted(true);
    setLoading(true);
    setError(null);
    setPreview(null);
    setSavedEntry(null);
    setGalleryNote(null);
    try {
      const result = await generateProductCard(item, categoryFields, {
        styleId,
        provider,
        photos: activePhotos,
        editFromPhoto: activePhotos.length > 0,
      });
      // Show preview immediately so UX feels fast
      setPreview(result.dataUrl);
      setMeta(
        [
          result.styleName || styleId,
          result.provider,
          result.model,
          activePhotos.length ? 'edited from your photo' : 'generated without photo',
          result.note,
        ]
          .filter(Boolean)
          .join(' · ')
      );
      setLoading(false);

      // Guaranteed save before user can lose the paid generation
      setSavingGallery(true);
      const entry = await persistToGallery(result.dataUrl, {
        provider: result.provider,
        model: result.model,
        styleName: result.styleName,
      });
      if (entry?.cloudStored && entry.imageUrl.startsWith('http')) {
        // Prefer durable URL for later Apply (avoids re-encoding huge data URLs)
        setPreview(entry.imageUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
      setLoading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (enlargedSrc) {
        setEnlargedSrc(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enlargedSrc]);

  const apply = async (url?: string, entry?: GeneratedProductCardEntry | null) => {
    const src = url || preview;
    if (!src && !entry && !savedEntry) return;
    setApplying(true);
    setError(null);
    try {
      const prepared = await resolveUrlForInventoryMainPhoto(
        src || '',
        item.id,
        entry || savedEntry
      );
      await onApplyAsMainPhoto(prepared);
      onClose();
    } catch (e) {
      console.error('Apply AI card failed:', e);
      setError(
        e instanceof Error
          ? e.message
          : 'Could not set as main photo. The card is still in Gallery — open Gallery and try Use again.'
      );
    } finally {
      setApplying(false);
    }
  };

  const addToItemGallery = async (url?: string, entry?: GeneratedProductCardEntry | null) => {
    const src = url || preview;
    if (!src && !entry && !savedEntry) return;
    setAddingToGallery(true);
    setError(null);
    setGalleryNote(null);
    try {
      const prepared = await resolveUrlForInventoryMainPhoto(
        src || '',
        item.id,
        entry || savedEntry
      );
      await onAddToItemGallery(prepared);
      setGalleryNote('Added to item photos');
    } catch (e) {
      console.error('Add AI card to item gallery failed:', e);
      setError(e instanceof Error ? e.message : 'Could not add card to item photos');
    } finally {
      setAddingToGallery(false);
    }
  };

  const downloadPreview = async () => {
    if (savedEntry) {
      try {
        await downloadProductCardEntry(savedEntry);
        return;
      } catch {
        /* fall through */
      }
    }
    if (!preview) return;
    const a = document.createElement('a');
    a.href = preview;
    a.download = buildProductCardFileName(item.name, styleName || savedEntry?.styleName, savedEntry?.createdAt);
    a.click();
  };

  const pickFromGallery = async (entry: GeneratedProductCardEntry) => {
    try {
      const url = galleryThumbs[entry.id] || (await resolveProductCardImageUrl(entry));
      setPreview(url);
      setSavedEntry(entry);
      setMeta(
        [
          entry.styleName || entry.styleId,
          entry.provider,
          entry.model,
          entry.cloudStored ? 'from cloud gallery' : 'from gallery',
          new Date(entry.createdAt).toLocaleString(),
        ]
          .filter(Boolean)
          .join(' · ')
      );
      setStarted(true);
      setShowGallery(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open gallery image');
    }
  };

  const deleteGalleryEntry = async (id: string) => {
    await removeProductCardFromGallery(id);
    setGallery((prev) => prev.filter((e) => e.id !== id));
    if (savedEntry?.id === id) setSavedEntry(null);
  };

  const providerList: ProductCardProviderInfo[] =
    providers.length > 0
      ? providers
      : [
          { id: 'openai', name: 'OpenAI', available: true, blurb: 'GPT Image · ~$0.05' },
          { id: 'gemini', name: 'Gemini', available: true, blurb: 'Flash Image · ~$0.04' },
        ];

  const cloudReady = isProductCardGalleryCloudReady();
  const applyBlocked = applying || addingToGallery || savingGallery;

  return createPortal(
    <>
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[96vh] h-[min(900px,96vh)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-600" /> AI product card
            </h3>
            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5" title={item.name}>
              {item.name}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowGallery((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                showGallery
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'text-slate-500 hover:bg-slate-100 border border-transparent'
              }`}
              title="Saved generations"
            >
              <Images size={12} /> Gallery
              {gallery.length > 0 && !showGallery ? (
                <span className="text-emerald-700">({gallery.length})</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          {showGallery ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Card history
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                    Every paid generation is kept here automatically.
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setGalleryScope('item')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                      galleryScope === 'item'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    This item
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryScope('all')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                      galleryScope === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    All cards
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                <Cloud size={11} className={cloudReady ? 'text-emerald-600' : 'text-slate-400'} />
                {cloudReady
                  ? 'Cloud sync on — high-quality files in Firebase Storage'
                  : 'Local IndexedDB backup on — sign in to sync high-quality copies'}
              </p>
              {galleryLoading ? (
                <div className="flex justify-center py-10 text-slate-400">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : gallery.length === 0 ? (
                <p className="text-[11px] text-slate-500 font-medium text-center py-8">
                  No saved cards yet. Generate one — it will appear here automatically.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {gallery.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
                    >
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => void pickFromGallery(entry)}
                          className="block w-full text-left"
                          title="Load into generator"
                        >
                          {galleryThumbs[entry.id] ? (
                            <img
                              src={galleryThumbs[entry.id]}
                              alt={entry.itemName}
                              className="w-full aspect-square object-cover bg-white"
                            />
                          ) : (
                            <div className="w-full aspect-square flex items-center justify-center bg-slate-100 text-slate-400">
                              <Images size={18} />
                            </div>
                          )}
                        </button>
                        {galleryThumbs[entry.id] && (
                          <button
                            type="button"
                            onClick={() =>
                              openEnlarged(
                                galleryThumbs[entry.id],
                                entry.styleName || entry.itemName || 'AI card'
                              )
                            }
                            className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-slate-900/75 text-white shadow-sm opacity-90 hover:opacity-100 hover:bg-slate-900"
                            title="Enlarge"
                          >
                            <Maximize2 size={12} />
                          </button>
                        )}
                      </div>
                      <div className="px-2 py-1.5 space-y-1">
                        <p className="text-[9px] font-bold text-slate-700 truncate" title={entry.itemName}>
                          {entry.itemName}
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium truncate">
                          {entry.styleName || entry.styleId || '—'} ·{' '}
                          {new Date(entry.createdAt).toLocaleDateString()}
                          {entry.cloudStored ? ' · cloud' : ' · local'}
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => void apply(galleryThumbs[entry.id], entry)}
                            disabled={applyBlocked}
                            className="flex-1 py-1 rounded-md bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-40"
                          >
                            Use
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openEnlarged(
                                galleryThumbs[entry.id],
                                entry.styleName || entry.itemName || 'AI card'
                              )
                            }
                            disabled={!galleryThumbs[entry.id]}
                            className="p-1 rounded-md border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40"
                            title="Enlarge"
                          >
                            <Maximize2 size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void addToItemGallery(galleryThumbs[entry.id], entry)}
                            disabled={applyBlocked}
                            className="p-1 rounded-md border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            title="Add to item photos"
                          >
                            {addingToGallery ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Plus size={11} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadProductCardEntry(entry)}
                            className="p-1 rounded-md border border-slate-200 text-slate-500 hover:bg-white"
                            title="Download"
                          >
                            <Download size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteGalleryEntry(entry.id)}
                            className="p-1 rounded-md border border-slate-200 text-rose-500 hover:bg-rose-50"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowGallery(false)}
                className="w-full py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600"
              >
                Back to generator
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  Your product photo
                </p>
                <p className="text-[10px] text-slate-500 font-medium mb-2">
                  Upload a real photo — AI will edit it into a card (not invent a random product).
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void onPickFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    disabled={loading || uploading}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px] font-black uppercase hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Upload photo
                  </button>
                  {itemPhotos.length > 0 && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setCustomPhotos([]);
                        setUseItemPhotos(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                    >
                      <ImageIcon size={12} /> Use item photos ({itemPhotos.length})
                    </button>
                  )}
                  {activePhotos.length > 0 && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setCustomPhotos([]);
                        setUseItemPhotos(false);
                      }}
                      className="text-[10px] font-bold text-slate-400 hover:text-slate-700 uppercase"
                    >
                      Clear photos
                    </button>
                  )}
                </div>
                {activePhotos.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {activePhotos.map((url) => (
                      <img
                        key={url.slice(0, 48)}
                        src={url}
                        alt="Source"
                        className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-slate-50"
                      />
                    ))}
                    <span className="text-[10px] font-bold text-emerald-700 self-center">
                      Edit mode · {activePhotos.length} photo
                      {activePhotos.length === 1 ? '' : 's'}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-700 font-medium mt-2">
                    No photo selected — AI will invent a product look from the name/specs only.
                  </p>
                )}
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  AI provider
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {providerList.map((p) => {
                    const active = p.id === provider;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={loading || !p.available}
                        onClick={() => setProvider(p.id)}
                        title={p.available ? p.blurb : `${p.name} — API key not configured`}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                          active
                            ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        } disabled:opacity-40`}
                      >
                        <span className="block text-[11px] font-black text-slate-800">{p.name}</span>
                        <span className="block text-[10px] text-slate-500 font-medium">{p.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  Design style
                </p>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 ${preview ? 'max-h-28' : 'max-h-40'}`}>
                  {PRODUCT_CARD_STYLES.map((s) => {
                    const active = s.id === styleId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={loading}
                        onClick={() => setStyleId(s.id)}
                        className={`text-left rounded-xl border px-2.5 py-2 transition-colors ${
                          active
                            ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        } disabled:opacity-60`}
                      >
                        <span className="block text-[11px] font-black text-slate-800">{s.name}</span>
                        <span className="block text-[10px] text-slate-500 font-medium leading-snug mt-0.5">
                          {s.blurb}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                  <Loader2 size={28} className="animate-spin text-emerald-600" />
                  <p className="text-xs font-bold">
                    {activePhotos.length
                      ? `Editing your photo with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}…`
                      : `Generating with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}…`}
                  </p>
                </div>
              )}

              {error && !loading && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
                  <p className="text-xs font-bold text-amber-900 whitespace-pre-wrap">{error}</p>
                  <p className="text-[10px] text-amber-800/80">
                    If you already generated a card, open Gallery — it should still be saved.
                  </p>
                </div>
              )}

              {preview && !loading && (
                <div className="space-y-2">
                  <div className="relative group rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => openEnlarged(preview, styleName || 'AI product card')}
                      className="block w-full text-left cursor-zoom-in"
                      title="Click to enlarge"
                    >
                      <img
                        src={preview}
                        alt="AI product card"
                        className="w-full object-contain max-h-[min(62vh,640px)] mx-auto"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEnlarged(preview, styleName || 'AI product card')}
                      className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900/80 text-white text-[10px] font-black uppercase shadow-sm hover:bg-slate-900"
                      title="Enlarge"
                    >
                      <Maximize2 size={12} /> Enlarge
                    </button>
                  </div>
                  {meta && <p className="text-[10px] text-slate-400 font-medium">{meta}</p>}
                  {(savingGallery || galleryNote) && (
                    <p className="text-[10px] font-medium text-emerald-700 flex items-center gap-1">
                      {savingGallery ? (
                        <>
                          <Loader2 size={11} className="animate-spin" /> Saving to gallery…
                        </>
                      ) : (
                        <>
                          <Images size={11} /> {galleryNote}
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {!started && !loading && !error && (
                <p className="text-[11px] text-slate-500 font-medium text-center py-4">
                  Upload photo → pick style → generate. Each card is auto-saved before you apply it.
                </p>
              )}
            </>
          )}
        </div>

        {!showGallery && (
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-2 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-500"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={loading || uploading || savingGallery}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {preview ? 'Regenerate' : activePhotos.length ? 'Edit into card' : 'Generate'}
            </button>
            {preview && (
              <>
                <button
                  type="button"
                  onClick={() => openEnlarged(preview, styleName || 'AI product card')}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                >
                  <Maximize2 size={12} /> Enlarge
                </button>
                <button
                  type="button"
                  onClick={() => void downloadPreview()}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                >
                  <Download size={12} /> Download
                </button>
                <button
                  type="button"
                  onClick={() => void addToItemGallery()}
                  disabled={applyBlocked}
                  title="Add to item photos"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-emerald-200 text-emerald-800 text-[10px] font-black uppercase hover:bg-emerald-50 disabled:opacity-50"
                >
                  {addingToGallery ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                  Add to photos
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={applyBlocked}
                  title={savingGallery ? 'Wait until the card is saved to gallery' : undefined}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase hover:bg-slate-800 disabled:opacity-50"
                >
                  {applying || savingGallery ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Check size={12} />
                  )}
                  {savingGallery ? 'Saving…' : 'Use as main photo'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>

    {enlargedSrc && (
      <div
        className="fixed inset-0 z-[240] flex flex-col items-center justify-center bg-slate-950/90 p-3 sm:p-6"
        onClick={() => setEnlargedSrc(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Enlarged product card"
      >
        <button
          type="button"
          onClick={() => setEnlargedSrc(null)}
          className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
          aria-label="Close enlarge"
        >
          <X size={20} />
        </button>
        <div
          className="relative w-full max-w-6xl max-h-[92vh] flex flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={enlargedSrc}
            alt={enlargedLabel || 'AI product card'}
            className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl bg-black/20"
          />
          <div className="w-full flex flex-wrap items-center justify-between gap-2 text-white/90 px-1">
            <p className="text-sm font-bold truncate">{enlargedLabel || 'AI product card'}</p>
            <button
              type="button"
              onClick={() => setEnlargedSrc(null)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white text-slate-900 text-[10px] font-black uppercase"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>,
    document.body
  );
};

export default GeminiProductCardModal;
