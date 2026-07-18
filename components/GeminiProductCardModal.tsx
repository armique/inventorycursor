import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Sparkles, X, Check, Upload, Image as ImageIcon } from 'lucide-react';
import type { InventoryItem } from '../types';
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

  const activePhotos = useMemo(() => {
    if (customPhotos.length) return customPhotos.slice(0, 3);
    if (useItemPhotos) return itemPhotos;
    return [];
  }, [customPhotos, useItemPhotos, itemPhotos]);

  useEffect(() => {
    void fetchProductCardProviders().then((list) => {
      setProviders(list);
      const preferred =
        list.find((p) => p.id === 'openai' && p.available) ||
        list.find((p) => p.available) ||
        list[0];
      if (preferred?.id) setProvider(preferred.id);
    });
  }, []);

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

  const run = async () => {
    setStarted(true);
    setLoading(true);
    setError(null);
    setPreview(null);
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

  const apply = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const prepared = await prepareInventoryImagesForStorage([preview], { itemId: item.id });
      await onApplyAsMainPhoto(prepared[0] || preview);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save card');
    } finally {
      setApplying(false);
    }
  };

  const download = () => {
    if (!preview) return;
    const a = document.createElement('a');
    a.href = preview;
    a.download = `${item.name.replace(/[^\w\-]+/g, '_').slice(0, 48)}_card.png`;
    a.click();
  };

  const providerList: ProductCardProviderInfo[] =
    providers.length > 0
      ? providers
      : [
          { id: 'openai', name: 'OpenAI', available: true, blurb: 'GPT Image · ~$0.05' },
          { id: 'gemini', name: 'Gemini', available: true, blurb: 'Flash Image · ~$0.04' },
        ];

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
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
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
            </div>
          )}

          {!started && !loading && !error && (
            <p className="text-[11px] text-slate-500 font-medium text-center py-4">
              Upload photo → pick style → generate (AI edits your photo into a listing card).
            </p>
          )}
        </div>

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
                onClick={download}
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
      </div>
    </div>,
    document.body
  );
};

export default GeminiProductCardModal;
