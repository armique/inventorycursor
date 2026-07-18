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
} from 'lucide-react';
import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import {
  fetchProductCardProviders,
  generateProductCard,
  type ProductCardProviderId,
  type ProductCardProviderInfo,
} from '../services/productCardGemini';
import {
  filesToDataUrls,
  getItemUserPhotoUrls,
  prepareInventoryImagesForStorage,
} from '../utils/imageImport';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES,
  type ProductCardStyleId,
} from '../services/productCardStyles';
import {
  isProductCardGalleryCloudReady,
  listProductCardGallery,
  removeProductCardFromGallery,
  saveGeneratedProductCard,
} from '../services/productCardGallery';

interface Props {
  item: InventoryItem;
  categoryFields?: string[];
  onClose: () => void;
  onApplyAsMainPhoto: (url: string) => void | Promise<void>;
}

const GeminiProductCardModal: React.FC<Props> = ({
  item,
  categoryFields,
  onClose,
  onApplyAsMainPhoto,
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
  const [started, setStarted] = useState(false);
  const [savingGallery, setSavingGallery] = useState(false);
  const [galleryNote, setGalleryNote] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryScope, setGalleryScope] = useState<'item' | 'all'>('item');

  const activePhotos = useMemo(() => {
    if (customPhotos.length) return customPhotos.slice(0, 3);
    if (useItemPhotos) return itemPhotos;
    return [];
  }, [customPhotos, useItemPhotos, itemPhotos]);

  const reloadGallery = async (scope: 'item' | 'all' = galleryScope) => {
    setGalleryLoading(true);
    try {
      const list = await listProductCardGallery(scope === 'item' ? item.id : undefined);
      setGallery(list);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when panel/scope opens
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
      setError(e instanceof Error ? e.message : 'Could not load photo');
    } finally {
      setUploading(false);
    }
  };

  const persistToGallery = async (
    dataUrl: string,
    info: { provider?: string; model?: string; styleName?: string }
  ) => {
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
      setGalleryNote(
        entry.cloudStored
          ? 'Saved to cloud gallery (high quality)'
          : 'Saved to local gallery — sign in to sync to cloud'
      );
      if (showGallery) void reloadGallery(galleryScope);
    } catch (e) {
      setGalleryNote(e instanceof Error ? e.message : 'Could not save to gallery');
    } finally {
      setSavingGallery(false);
    }
  };

  const run = async () => {
    setStarted(true);
    setLoading(true);
    setError(null);
    setPreview(null);
    setGalleryNote(null);
    try {
      const result = await generateProductCard(item, categoryFields, {
        styleId,
        provider,
        photos: activePhotos,
        editFromPhoto: activePhotos.length > 0,
      });
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
      // Auto-save paid generations so they are never lost
      void persistToGallery(result.dataUrl, {
        provider: result.provider,
        model: result.model,
        styleName: result.styleName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = async (url?: string) => {
    const src = url || preview;
    if (!src) return;
    setApplying(true);
    try {
      const prepared = await prepareInventoryImagesForStorage([src], { itemId: item.id });
      await onApplyAsMainPhoto(prepared[0] || src);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save card');
    } finally {
      setApplying(false);
    }
  };

  const download = (url?: string) => {
    const src = url || preview;
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = `${item.name.replace(/[^\w\-]+/g, '_').slice(0, 48)}_card.png`;
    a.click();
  };

  const pickFromGallery = (entry: GeneratedProductCardEntry) => {
    setPreview(entry.imageUrl);
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
  };

  const deleteGalleryEntry = async (id: string) => {
    await removeProductCardFromGallery(id);
    setGallery((prev) => prev.filter((e) => e.id !== id));
  };

  const providerList: ProductCardProviderInfo[] =
    providers.length > 0
      ? providers
      : [
          { id: 'openai', name: 'OpenAI', available: true, blurb: 'GPT Image · ~$0.05' },
          { id: 'gemini', name: 'Gemini', available: true, blurb: 'Flash Image · ~$0.04' },
        ];

  const cloudReady = isProductCardGalleryCloudReady();

  return createPortal(
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
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
                    Paid generations are kept here so you can reuse them anytime.
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
                  : 'Local only — sign in to store high-quality copies in the cloud'}
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {gallery.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 group"
                    >
                      <button
                        type="button"
                        onClick={() => pickFromGallery(entry)}
                        className="block w-full text-left"
                        title="Use this card"
                      >
                        <img
                          src={entry.imageUrl}
                          alt={entry.itemName}
                          className="w-full aspect-square object-cover bg-white"
                        />
                      </button>
                      <div className="px-2 py-1.5 space-y-1">
                        <p className="text-[9px] font-bold text-slate-700 truncate" title={entry.itemName}>
                          {entry.itemName}
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium truncate">
                          {entry.styleName || entry.styleId || '—'} ·{' '}
                          {new Date(entry.createdAt).toLocaleDateString()}
                          {entry.cloudStored ? ' · cloud' : ''}
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => pickFromGallery(entry)}
                            className="flex-1 py-1 rounded-md bg-slate-900 text-white text-[9px] font-black uppercase"
                          >
                            Use
                          </button>
                          <button
                            type="button"
                            onClick={() => download(entry.imageUrl)}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
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
                  {/429|quota/i.test(error) ? (
                    <p className="text-[10px] text-amber-800/80">
                      Quota/rate limit — switch provider or retry later.
                    </p>
                  ) : null}
                </div>
              )}

              {preview && !loading && (
                <div className="space-y-2">
                  <img
                    src={preview}
                    alt="AI product card"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 object-contain max-h-[42vh]"
                  />
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
                  Upload photo → pick style → generate. Each card is auto-saved to your gallery.
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
              disabled={loading || uploading}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {preview ? 'Regenerate' : activePhotos.length ? 'Edit into card' : 'Generate'}
            </button>
            {preview && (
              <>
                <button
                  type="button"
                  onClick={() => download()}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                >
                  <Download size={12} /> Download
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={applying}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase hover:bg-slate-800 disabled:opacity-50"
                >
                  {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Use as main photo
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default GeminiProductCardModal;
