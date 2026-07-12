import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  BookmarkPlus,
  CheckCircle2,
  Download,
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { getItemUserPhotoUrls } from '../utils/imageImport';
import { prepareInventoryImagesForStorage, filesToDataUrls } from '../utils/imageImport';
import {
  BUILTIN_PRODUCT_CARD_TEMPLATES,
  cloneTemplateAsCustom,
  deleteSavedProductCardTemplate,
  listAllProductCardTemplates,
  loadSavedProductCardTemplates,
  saveProductCardTemplate,
  suggestTemplateForItem,
  type ProductCardTemplate,
} from '../services/productCardTemplates';
import {
  downloadProductCardBlob,
  PRODUCT_CARD_HEIGHT,
  PRODUCT_CARD_WIDTH,
  renderProductCardBlob,
  renderProductCardToCanvas,
} from '../services/productCardRenderer';
import { detectProductCardFamily } from '../utils/productCardContent';
import ProductPhotoEnhancePanel from './ProductPhotoEnhancePanel';

interface Props {
  item: InventoryItem;
  categoryFields?: string[];
  onClose: () => void;
  onApplyAsMainPhoto: (url: string) => void | Promise<void>;
}

const ProductCardGeneratorModal: React.FC<Props> = ({
  item,
  categoryFields,
  onClose,
  onApplyAsMainPhoto,
}) => {
  const existingPhotos = useMemo(() => getItemUserPhotoUrls(item), [item]);
  const [templates, setTemplates] = useState<ProductCardTemplate[]>(() => listAllProductCardTemplates());
  const [template, setTemplate] = useState<ProductCardTemplate>(() => suggestTemplateForItem(item));
  const [photoUrl, setPhotoUrl] = useState<string>(() => existingPhotos[0] || '');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [enhancedPhoto, setEnhancedPhoto] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const renderSeq = useRef(0);

  const rawPhoto = uploadPreview || photoUrl;
  const activePhoto = enhancedPhoto || rawPhoto;

  const refreshPreview = useCallback(async () => {
    if (!activePhoto) {
      setPreviewUrl(null);
      return;
    }
    const seq = ++renderSeq.current;
    setRendering(true);
    setError(null);
    try {
      const canvas = await renderProductCardToCanvas({
        item,
        template,
        photoUrl: activePhoto,
        categoryFields,
      });
      if (seq !== renderSeq.current) return;
      setPreviewUrl(canvas.toDataURL('image/jpeg', 0.88));
    } catch (e) {
      if (seq !== renderSeq.current) return;
      setError(e instanceof Error ? e.message : 'Preview failed');
      setPreviewUrl(null);
    } finally {
      if (seq === renderSeq.current) setRendering(false);
    }
  }, [activePhoto, categoryFields, item, template]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const urls = await filesToDataUrls(Array.from(files));
      if (!urls[0]) return;
      setUploadPreview(urls[0]);
      setPhotoUrl('');
      setEnhancedPhoto('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const handleSaveTemplate = () => {
    const name = customName.trim() || `${template.name} · ${new Date().toLocaleDateString('de-DE')}`;
    const custom = cloneTemplateAsCustom(template, name);
    const next = saveProductCardTemplate(custom);
    setTemplates([...BUILTIN_PRODUCT_CARD_TEMPLATES.filter((b) => !next.some((s) => s.id === b.id)), ...next]);
    setTemplate(custom);
    setCustomName('');
    setMessage(`Template „${name}" saved`);
  };

  const handleDeleteTemplate = (id: string) => {
    const next = deleteSavedProductCardTemplate(id);
    setTemplates(listAllProductCardTemplates());
    if (template.id === id) {
      setTemplate(suggestTemplateForItem(item));
    }
    setMessage('Template removed from history');
    void next;
  };

  const exportBlob = async () => {
    if (!activePhoto) throw new Error('Select or upload a photo first');
    return renderProductCardBlob({ item, template, photoUrl: activePhoto, categoryFields });
  };

  const handleDownload = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await exportBlob();
      const safeName = item.name.replace(/[^a-zA-Z0-9äöüÄÖÜß\-]+/g, '-').slice(0, 48);
      downloadProductCardBlob(blob, `${safeName || 'product'}-card.jpg`);
      setMessage('Card downloaded');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyMain = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await exportBlob();
      const file = new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Read failed'));
        r.readAsDataURL(file);
      });
      const prepared = await prepareInventoryImagesForStorage([dataUrl], { itemId: item.id });
      if (!prepared[0]) throw new Error('Could not store card image');
      await onApplyAsMainPhoto(prepared[0]);
      setMessage('Applied as main inventory photo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setSaving(false);
    }
  };

  const family = detectProductCardFamily(item);
  const savedOnly = loadSavedProductCardTemplates();

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-6xl max-h-[96vh] sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50 to-white">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={18} className="text-indigo-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Product Card Studio</span>
            </div>
            <h2 className="text-lg font-black text-slate-900 leading-snug">{item.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Premium listing card · {family === '3d' ? '3D print template' : family === 'pc' ? 'PC hardware template' : 'Universal'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-0 lg:gap-0 min-h-0">
          {/* Templates */}
          <aside className="border-b lg:border-b-0 lg:border-r border-slate-100 p-4 space-y-4 bg-slate-50/50">
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500 mb-2 flex items-center gap-1">
                <Palette size={12} /> Templates
              </p>
              <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTemplate({ ...t, usps: [...t.usps], theme: { ...t.theme } })}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                        template.id === t.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-700 hover:border-indigo-200'
                      }`}
                    >
                      {t.name}
                      {!t.isBuiltin && <span className="block text-[9px] opacity-70 font-semibold mt-0.5">Saved</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {savedOnly.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Your saved templates</p>
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {savedOnly.map((t) => (
                    <li key={t.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setTemplate({ ...t, usps: [...t.usps], theme: { ...t.theme } })}
                        className="flex-1 text-left px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 truncate"
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        title="Delete template"
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-200">
              <p className="text-[10px] font-black uppercase text-slate-500">USP badges (card text)</p>
              {template.usps.map((usp, idx) => (
                <input
                  key={idx}
                  value={usp}
                  onChange={(e) => {
                    const next = [...template.usps];
                    next[idx] = e.target.value;
                    setTemplate({ ...template, usps: next });
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold"
                />
              ))}
              <button
                type="button"
                onClick={() => setTemplate({ ...template, usps: [...template.usps, ''] })}
                className="text-[10px] font-bold text-indigo-600"
              >
                + Add badge
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Template name…"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs"
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase"
              >
                <BookmarkPlus size={12} /> Save
              </button>
            </div>
          </aside>

          {/* Preview */}
          <div className="p-4 sm:p-6 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,_#f8fafc_0%,_#eef2ff_100%)] min-h-[320px]">
            <div
              className="relative rounded-2xl shadow-2xl ring-1 ring-slate-200/80 overflow-hidden bg-white"
              style={{ width: 'min(100%, 360px)', aspectRatio: `${PRODUCT_CARD_WIDTH}/${PRODUCT_CARD_HEIGHT}` }}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Card preview" className="w-full h-full object-contain" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2 p-6 text-center">
                  <ImagePlus size={32} />
                  <p className="text-sm font-bold">Add a photo to preview</p>
                </div>
              )}
              {rendering && (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-indigo-600" />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-3 font-semibold">
              Export {PRODUCT_CARD_WIDTH}×{PRODUCT_CARD_HEIGHT}px · eBay / Kleinanzeigen ready ·{' '}
              <Link to="/panel/product-card-studio" className="text-indigo-600 font-bold hover:underline">Open Card Studio</Link> for AI compare
            </p>
          </div>

          {/* Photo source */}
          <aside className="border-t lg:border-t-0 lg:border-l border-slate-100 p-4 space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Photo source</p>
              {existingPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {existingPhotos.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => {
                        setPhotoUrl(url);
                        setUploadPreview(null);
                        setEnhancedPhoto('');
                      }}
                      className={`aspect-square rounded-xl overflow-hidden border-2 ${
                        rawPhoto === url ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 mb-2">No inventory photos yet — upload below.</p>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleUpload(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-xs font-black uppercase text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
              >
                <Upload size={14} /> Upload photo
              </button>
              {rawPhoto && (
                <ProductPhotoEnhancePanel
                  sourceUrl={rawPhoto}
                  onEnhanced={(url) => setEnhancedPhoto(url)}
                  className="mt-3"
                />
              )}
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-1">
              <p className="font-black uppercase text-slate-500 text-[9px]">Text strategy</p>
              {family === '3d' ? (
                <>
                  <p>3D cards highlight: Made in Germany, fast delivery, color choice, PLA+ quality.</p>
                  <p>Specs: filament type, weight, print time.</p>
                </>
              ) : family === 'pc' ? (
                <>
                  <p>PC parts: tested hardware, German shipping, ready to ship, key specs (VRAM, socket, etc.).</p>
                </>
              ) : (
                <p>Universal template — edit USP badges on the left.</p>
              )}
            </div>
          </aside>
        </div>

        {(error || message) && (
          <div className={`shrink-0 px-4 py-2 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {error || message}
          </div>
        )}

        <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!activePhoto || saving}
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-black uppercase hover:bg-slate-100 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Save image
          </button>
          <button
            type="button"
            disabled={!activePhoto || saving}
            onClick={() => void handleApplyMain()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Apply as main photo
          </button>
          <button type="button" onClick={onClose} className="ml-auto px-4 py-2.5 text-[11px] font-black uppercase text-slate-500">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProductCardGeneratorModal;
