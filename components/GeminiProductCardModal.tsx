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
import { resolveProductCardAccessoryHints } from '../utils/itemAccessories';
import {
  buildProductCardBatchJobs,
  MIN_PRODUCT_CARD_BATCH,
} from '../utils/productCardBatch';

interface Props {
  item: InventoryItem;
  categoryFields?: string[];
  /** Full inventory — used to resolve OVP / IO-Blende from bundle children. */
  allItems?: InventoryItem[] | null;
  onClose: () => void;
  onApplyAsMainPhoto: (url: string) => void | Promise<void>;
}

type BatchCardPreview = {
  index: number;
  dataUrl: string;
  entry: GeneratedProductCardEntry | null;
  meta: string;
  styleId: string;
};

const GeminiProductCardModal: React.FC<Props> = ({
  item,
  categoryFields,
  allItems,
  onClose,
  onApplyAsMainPhoto,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const allItemPhotos = useMemo(() => getItemUserPhotoUrls(item), [item]);
  /** First N gallery photos used for the 3-card batch (extras beyond 3 ignored). */
  const itemPhotos = useMemo(
    () => allItemPhotos.slice(0, MIN_PRODUCT_CARD_BATCH),
    [allItemPhotos]
  );
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
  const [savedEntry, setSavedEntry] = useState<GeneratedProductCardEntry | null>(null);
  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<Record<string, string>>({});
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryScope, setGalleryScope] = useState<'item' | 'all'>('item');
  const [batchCards, setBatchCards] = useState<BatchCardPreview[]>([]);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);

  const activePhotos = useMemo(() => {
    if (customPhotos.length) return customPhotos.slice(0, MIN_PRODUCT_CARD_BATCH);
    if (useItemPhotos) return itemPhotos;
    return [];
  }, [customPhotos, useItemPhotos, itemPhotos]);

  const accessoryHints = useMemo(
    () => resolveProductCardAccessoryHints(item, allItems),
    [item, allItems]
  );

  const styleName = PRODUCT_CARD_STYLES.find((s) => s.id === styleId)?.name;

  const batchJobs = useMemo(
    () =>
      buildProductCardBatchJobs(activePhotos, {
        styleId,
        styleIds: PRODUCT_CARD_STYLES.map((s) => s.id),
      }),
    [activePhotos, styleId]
  );

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
      setError(e instanceof Error ? e.message : 'Could not load photo');
    } finally {
      setUploading(false);
    }
  };

  const persistToGallery = async (
    dataUrl: string,
    info: { provider?: string; model?: string; styleId?: string; styleName?: string }
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
        styleId: (info.styleId as ProductCardStyleId) || styleId,
        styleName: info.styleName,
      });
      setGalleryNote(
        entry.cloudStored
          ? 'Saved to cloud gallery (high quality) — credits safe'
          : 'Saved locally (IndexedDB) — sign in to also sync to cloud'
      );
      return entry;
    } catch (e) {
      setGalleryNote(e instanceof Error ? e.message : 'Could not save to gallery');
      return null;
    } finally {
      setSavingGallery(false);
    }
  };

  const selectBatchCard = (card: BatchCardPreview) => {
    setSelectedBatchIndex(card.index);
    setPreview(card.dataUrl);
    setSavedEntry(card.entry);
    setMeta(card.meta);
  };

  const run = async () => {
    setStarted(true);
    setLoading(true);
    setError(null);
    setPreview(null);
    setSavedEntry(null);
    setGalleryNote(null);
    setBatchCards([]);
    setSelectedBatchIndex(0);

    const jobs = buildProductCardBatchJobs(activePhotos, {
      styleId,
      styleIds: PRODUCT_CARD_STYLES.map((s) => s.id),
    });
    const completed: BatchCardPreview[] = [];
    const errors: string[] = [];

    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setBatchProgress(`Generating card ${i + 1} / ${jobs.length}…`);
        try {
          const result = await generateProductCard(item, categoryFields, {
            styleId: job.styleId,
            provider,
            photos: job.photos,
            editFromPhoto: job.editFromPhoto,
            allItems,
          });
          const cardMeta = [
            result.styleName || job.styleId,
            result.provider,
            result.model,
            job.photos.length
              ? `from photo ${Math.min(i + 1, activePhotos.length) || 1}`
              : 'no photo',
            `card ${i + 1}/${jobs.length}`,
            result.note,
          ]
            .filter(Boolean)
            .join(' · ');

          // Persist immediately so a mid-batch failure still keeps paid cards
          setSavingGallery(true);
          const entry = await persistToGallery(result.dataUrl, {
            provider: result.provider,
            model: result.model,
            styleId: result.styleId || job.styleId,
            styleName: result.styleName,
          });

          let displayUrl = result.dataUrl;
          if (entry?.cloudStored && entry.imageUrl.startsWith('http')) {
            displayUrl = entry.imageUrl;
          }

          const card: BatchCardPreview = {
            index: i,
            dataUrl: displayUrl,
            entry,
            meta: cardMeta,
            styleId: (result.styleId as string) || job.styleId,
          };
          completed.push(card);
          setBatchCards([...completed]);

          // Keep latest as live preview while batch runs
          setPreview(displayUrl);
          setSavedEntry(entry);
          setMeta(cardMeta);
          setSelectedBatchIndex(i);
        } catch (e) {
          errors.push(
            `Card ${i + 1}: ${e instanceof Error ? e.message : 'Generation failed'}`
          );
        }
      }

      if (completed.length === 0) {
        throw new Error(errors.join('\n') || 'All card generations failed');
      }

      // Prefer first successful card as the selected preview
      selectBatchCard(completed[0]);
      void reloadGallery(galleryScope);

      if (errors.length) {
        setError(
          `Generated ${completed.length}/${jobs.length} cards. Some failed:\n${errors.join('\n')}`
        );
      }
      setGalleryNote(
        `Saved ${completed.length} card${completed.length === 1 ? '' : 's'} to gallery — pick one to use as main photo`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
      setBatchProgress(null);
      setSavingGallery(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const applyBlocked = applying || savingGallery;

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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {gallery.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
                    >
                      <button
                        type="button"
                        onClick={() => void pickFromGallery(entry)}
                        className="block w-full text-left"
                        title="Use this card"
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
                            className="flex-1 py-1 rounded-md bg-slate-900 text-white text-[9px] font-black uppercase"
                          >
                            Use
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
                  Uses up to {MIN_PRODUCT_CARD_BATCH} gallery photos to generate{' '}
                  {MIN_PRODUCT_CARD_BATCH} different cards (one composition per photo). Extra
                  photos beyond {MIN_PRODUCT_CARD_BATCH} are skipped.
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
                  {allItemPhotos.length > 0 && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setCustomPhotos([]);
                        setUseItemPhotos(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                    >
                      <ImageIcon size={12} /> Use item photos ({allItemPhotos.length}
                      {allItemPhotos.length > MIN_PRODUCT_CARD_BATCH
                        ? ` → ${MIN_PRODUCT_CARD_BATCH} cards`
                        : ''}
                      )
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
                    {activePhotos.map((url, idx) => (
                      <div key={`${idx}-${url.slice(0, 40)}`} className="relative">
                        <img
                          src={url}
                          alt={`Source ${idx + 1}`}
                          className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-slate-50"
                        />
                        <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-emerald-600 text-white text-[8px] font-black flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </div>
                    ))}
                    <span className="text-[10px] font-bold text-emerald-700 self-center">
                      {MIN_PRODUCT_CARD_BATCH} cards · {activePhotos.length} source photo
                      {activePhotos.length === 1 ? '' : 's'}
                      {allItemPhotos.length > MIN_PRODUCT_CARD_BATCH && useItemPhotos && !customPhotos.length
                        ? ` (of ${allItemPhotos.length})`
                        : ''}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-700 font-medium mt-2">
                    No photo selected — still generates {MIN_PRODUCT_CARD_BATCH} cards from
                    name/specs (styles rotate for variety).
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
                    {batchProgress ||
                      (activePhotos.length
                        ? `Editing photos into ${MIN_PRODUCT_CARD_BATCH} cards with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}…`
                        : `Generating ${MIN_PRODUCT_CARD_BATCH} cards with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}…`)}
                  </p>
                  {batchCards.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 w-full max-w-sm mt-2">
                      {Array.from({ length: MIN_PRODUCT_CARD_BATCH }).map((_, i) => {
                        const card = batchCards.find((c) => c.index === i);
                        return (
                          <div
                            key={i}
                            className="aspect-square rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center"
                          >
                            {card ? (
                              <img
                                src={card.dataUrl}
                                alt={`Card ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Loader2 size={14} className="animate-spin text-slate-300" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {error && !loading && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
                  <p className="text-xs font-bold text-amber-900 whitespace-pre-wrap">{error}</p>
                  <p className="text-[10px] text-amber-800/80">
                    Successful cards are still in Gallery — open Gallery and try Use.
                  </p>
                </div>
              )}

              {batchCards.length > 0 && !loading && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    This batch ({batchCards.length} cards)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {batchCards.map((card) => {
                      const active = selectedBatchIndex === card.index;
                      return (
                        <button
                          key={card.index}
                          type="button"
                          onClick={() => selectBatchCard(card)}
                          className={`rounded-xl overflow-hidden border-2 text-left transition-all ${
                            active
                              ? 'border-emerald-500 ring-2 ring-emerald-200'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <img
                            src={card.dataUrl}
                            alt={`Card ${card.index + 1}`}
                            className="w-full aspect-square object-cover bg-slate-50"
                          />
                          <span className="block text-[9px] font-black uppercase text-center py-1 bg-white text-slate-600">
                            Card {card.index + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                  Generate creates {MIN_PRODUCT_CARD_BATCH} cards
                  {batchJobs.some((j) => j.photos.length)
                    ? ' from your photos'
                    : ' from name/specs'}
                  . Each is auto-saved before you apply one.
                </p>
              )}
            </>
          )}
        </div>

        {!showGallery && (
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-2 bg-white">
            {(accessoryHints.hasOVP || accessoryHints.hasIOShield) && (
              <div className="w-full flex flex-wrap gap-1.5 mb-1">
                {accessoryHints.hasOVP && (
                  <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wide">
                    Mit OVP
                  </span>
                )}
                {accessoryHints.hasIOShield && (
                  <span className="px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 text-[9px] font-black uppercase tracking-wide">
                    IO-Blende inklusive
                  </span>
                )}
                <span className="text-[9px] text-slate-400 font-medium self-center">
                  from item / bundle parts — added as text badges on the card
                </span>
              </div>
            )}
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
              {preview || batchCards.length
                ? `Regenerate ${MIN_PRODUCT_CARD_BATCH}`
                : `Generate ${MIN_PRODUCT_CARD_BATCH} cards`}
            </button>
            {preview && (
              <>
                <button
                  type="button"
                  onClick={() => void downloadPreview()}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                >
                  <Download size={12} /> Download
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
    </div>,
    document.body
  );
};

export default GeminiProductCardModal;
