import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Sparkles, X, Check } from 'lucide-react';
import type { InventoryItem } from '../types';
import { generateGeminiProductCard } from '../services/productCardGemini';
import { prepareInventoryImagesForStorage } from '../utils/imageImport';
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
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [started, setStarted] = useState(false);

  const run = async (nextStyle?: ProductCardStyleId) => {
    const useStyle = nextStyle || styleId;
    setStarted(true);
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await generateGeminiProductCard(item, categoryFields, useStyle);
      setPreview(result.dataUrl);
      setMeta(
        [result.styleName || useStyle, result.provider, result.model, result.note]
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
              Design style
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
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
              <p className="text-xs font-bold">Generating full card with Gemini…</p>
              <p className="text-[10px] text-slate-400 text-center max-w-xs">
                AI builds the entire design from the selected style + your product data.
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
              <p className="text-xs font-bold text-amber-900 whitespace-pre-wrap">{error}</p>
              {/429|quota/i.test(error) ? (
                <p className="text-[10px] text-amber-800/80">
                  Key is fine — image models hit a separate quota. Enable billing for this Google Cloud
                  project in{' '}
                  <a
                    href="https://aistudio.google.com/usage"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold"
                  >
                    AI Studio → Usage
                  </a>{' '}
                  (Set up billing / Paid tier), or wait for the daily reset. Gemini app Pro does not
                  raise API image limits.
                </p>
              ) : /not set|missing|401|403|auth|invalid/i.test(error) ? (
                <p className="text-[10px] text-amber-800/80">
                  Need an API key from{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold"
                  >
                    Google AI Studio
                  </a>
                  . Set <code className="bg-amber-100 px-1 rounded">GEMINI_API_KEY</code> on the
                  server or <code className="bg-amber-100 px-1 rounded">VITE_GEMINI_API_KEY</code> in{' '}
                  <code className="bg-amber-100 px-1 rounded">.env</code>.
                </p>
              ) : null}
            </div>
          )}

          {preview && !loading && (
            <div className="space-y-2">
              <img
                src={preview}
                alt="AI product card"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 object-contain max-h-[48vh]"
              />
              {meta && <p className="text-[10px] text-slate-400 font-medium">{meta}</p>}
            </div>
          )}

          {!started && !loading && !error && (
            <p className="text-[11px] text-slate-500 font-medium text-center py-6">
              Pick a style, then generate. Gemini creates the full card (layout + typography).
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
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {preview ? 'Regenerate' : 'Generate'}
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
