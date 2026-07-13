import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  Download,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  FileJson,
  FolderOpen,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { getItemUserPhotoUrls, normalizeImageList, prepareInventoryImagesForStorage, filesToDataUrls } from '../utils/imageImport';
import { matchesInventorySearch } from '../utils/inventorySearchIndex';
import {
  listConfiguredAIProviders,
  type AIProviderId,
} from '../services/specsAI';
import {
  generateProductCardDesignBatch,
  getDefaultCardStudioProviderIds,
  type GenerateDesignResult,
} from '../services/productCardAI';
import {
  deleteFromProductCardLibrary,
  loadProductCardLibrary,
  saveToProductCardLibrary,
  type SavedProductCardDesign,
} from '../services/productCardLibrary';
import {
  BUILTIN_PRODUCT_CARD_TEMPLATES,
  PREMIUM_NOIR_EDITORIAL_TEMPLATE,
  saveProductCardTemplate,
  suggestTemplateForItem,
  type ProductCardTemplate,
} from '../services/productCardTemplates';
import {
  downloadProductCardBlob,
  renderProductCardBlob,
  renderProductCardToCanvas,
} from '../services/productCardRenderer';
import { detectProductCardFamily, DEFAULT_USPS } from '../utils/productCardContent';
import ProductPhotoEnhancePanel from './ProductPhotoEnhancePanel';
import {
  loadBuiltinTemplatePack,
  parseProductCardTemplateJson,
  exportProductCardTemplateJson,
} from '../utils/productCardTemplateImport';
import {
  deleteSavedProductCardTemplate,
  loadSavedProductCardTemplates,
} from '../services/productCardTemplates';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
  categoryFields?: Record<string, string[]>;
}

type StudioTab = 'create' | 'library' | 'templates';

interface VariantPreview {
  key: string;
  result: GenerateDesignResult;
  previewUrl: string | null;
  loading: boolean;
}

const ProductCardStudioPage: React.FC<Props> = ({ items, onUpdate, categoryFields = {} }) => {
  const providers = useMemo(() => listConfiguredAIProviders(), []);
  const [tab, setTab] = useState<StudioTab>('create');
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [activePhoto, setActivePhoto] = useState('');
  const [photoEnhanceMeta, setPhotoEnhanceMeta] = useState<{ provider: string; note?: string } | null>(null);
  const [packTemplates, setPackTemplates] = useState<ProductCardTemplate[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<ProductCardTemplate[]>(() => loadSavedProductCardTemplates());
  const [selectedProviders, setSelectedProviders] = useState<AIProviderId[]>(() =>
    getDefaultCardStudioProviderIds(providers)
  );
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<VariantPreview[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<ProductCardTemplate | null>(null);
  const [library, setLibrary] = useState<SavedProductCardDesign[]>(() => loadProductCardLibrary());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const rawPhotoSource = uploadPreview || photoUrl;

  const filteredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return items.filter((i) => i.status !== 'Sold').slice(0, 40);
    return items.filter((i) => matchesInventorySearch(i, q)).slice(0, 40);
  }, [items, search]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  const itemPhotos = useMemo(
    () => (selectedItem ? getItemUserPhotoUrls(selectedItem) : []),
    [selectedItem]
  );

  const activePhotoResolved = activePhoto || rawPhotoSource;

  useEffect(() => {
    void loadBuiltinTemplatePack().then(setPackTemplates);
  }, []);

  const categoryFieldsForItem = useMemo(() => {
    if (!selectedItem) return undefined;
    return (
      categoryFields[`${selectedItem.category}:${selectedItem.subCategory}`] ||
      categoryFields[selectedItem.category]
    );
  }, [categoryFields, selectedItem]);

  useEffect(() => {
    if (!selectedItem) return;
    const photos = getItemUserPhotoUrls(selectedItem);
    setPhotoUrl(photos[0] || '');
    setUploadPreview(null);
    setActivePhoto('');
    setPhotoEnhanceMeta(null);
    setActiveTemplate(suggestTemplateForItem(selectedItem));
    setVariants([]);
  }, [selectedItem?.id]);

  const renderPreview = useCallback(
    async (template: ProductCardTemplate): Promise<string | null> => {
      if (!selectedItem || !activePhotoResolved) return null;
      const canvas = await renderProductCardToCanvas({
        item: selectedItem,
        template,
        photoUrl: activePhotoResolved,
        categoryFields: categoryFieldsForItem,
      });
      return canvas.toDataURL('image/jpeg', 0.82);
    },
    [activePhotoResolved, categoryFieldsForItem, selectedItem]
  );

  const handleGenerate = async () => {
    if (!selectedItem) {
      setError('Select an inventory item first.');
      return;
    }
    if (selectedProviders.length === 0) {
      setError('Select at least one AI provider.');
      return;
    }
    setGenerating(true);
    setError(null);
    setMessage(null);
    setVariants([]);
    try {
      const results = await generateProductCardDesignBatch(
        selectedItem,
        selectedProviders,
        categoryFieldsForItem
      );
      const initial: VariantPreview[] = results.map((result, idx) => ({
        key: `${result.provider}-${idx}`,
        result,
        previewUrl: null,
        loading: !result.error,
      }));
      setVariants(initial);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.error || !activePhotoResolved) {
          setVariants((prev) =>
            prev.map((v, j) => (j === i ? { ...v, loading: false } : v))
          );
          continue;
        }
        try {
          const url = await renderPreview(result.template);
          setVariants((prev) =>
            prev.map((v, j) => (j === i ? { ...v, previewUrl: url, loading: false } : v))
          );
        } catch {
          setVariants((prev) =>
            prev.map((v, j) => (j === i ? { ...v, loading: false } : v))
          );
        }
      }
      setMessage(`Generated ${results.filter((r) => !r.error).length} variant(s). Compare and save your favourite.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveVariant = async (variant: VariantPreview) => {
    const preview = variant.previewUrl || (await renderPreview(variant.result.template));
    saveProductCardTemplate(variant.result.template);
    saveToProductCardLibrary({
      template: variant.result.template,
      previewDataUrl: preview || undefined,
      sourceItemId: selectedItem?.id,
      sourceItemName: selectedItem?.name,
    });
    setLibrary(loadProductCardLibrary());
    setMessage(`Saved „${variant.result.template.name}" to library`);
  };

  const handleExport = async (template: ProductCardTemplate) => {
    if (!selectedItem || !activePhotoResolved) return;
    setExporting(true);
    try {
      const blob = await renderProductCardBlob({
        item: selectedItem,
        template,
        photoUrl: activePhotoResolved,
        categoryFields: categoryFieldsForItem,
      });
      const safe = selectedItem.name.replace(/[^a-zA-Z0-9äöüÄÖÜß\-]+/g, '-').slice(0, 40);
      downloadProductCardBlob(blob, `${safe}-card.jpg`);
    } finally {
      setExporting(false);
    }
  };

  const handleApplyToItem = async (template: ProductCardTemplate) => {
    if (!selectedItem || !activePhotoResolved) return;
    setExporting(true);
    try {
      const blob = await renderProductCardBlob({
        item: selectedItem,
        template,
        photoUrl: activePhotoResolved,
        categoryFields: categoryFieldsForItem,
      });
      const file = new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Read failed'));
        r.readAsDataURL(file);
      });
      const prepared = await prepareInventoryImagesForStorage([dataUrl], { itemId: selectedItem.id });
      if (!prepared[0]) throw new Error('Storage failed');
      const merged = normalizeImageList([prepared[0], selectedItem.imageUrl, ...(selectedItem.imageUrls || [])]);
      onUpdate(
        items.map((i) =>
          i.id === selectedItem.id ? { ...i, imageUrl: merged[0], imageUrls: merged } : i
        )
      );
      setMessage('Card applied as main photo on inventory item');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setExporting(false);
    }
  };

  const toggleProvider = (id: AIProviderId) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 pb-8">
      <header className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#09090b] via-[#111113] to-[#141418] text-white p-6 sm:p-8 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-zinc-400 text-[10px] font-black uppercase tracking-[0.2em] mb-2">
              <Sparkles size={14} /> Product Card Studio
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-50">Premium listing card generator</h1>
            <p className="text-sm text-zinc-400 mt-2 max-w-xl">
              Apple-style showcase layouts with flanking spec callouts. Generate, compare, export JPG, and apply to inventory.
            </p>
          </div>
          <div className="flex rounded-xl bg-white/[0.06] border border-white/10 p-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setTab('create')}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-colors ${tab === 'create' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:text-white'}`}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setTab('library')}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-colors ${tab === 'library' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:text-white'}`}
            >
              Library ({library.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('templates')}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-colors ${tab === 'templates' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:text-white'}`}
            >
              Templates
            </button>
          </div>
        </div>
      </header>

      {providers.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <div>
            <p className="font-bold">No AI API keys configured</p>
            <p className="text-xs mt-1">
              Chat subscriptions (Cursor, Claude app, Gemini app) are <strong>not</strong> API access. Add keys in{' '}
              <code className="bg-amber-100 px-1 rounded">.env</code>: free — Groq, Gemini, Together, Mistral, Ollama; paid — OpenAI, Anthropic.{' '}
              <Link to="/panel/settings" className="underline font-bold">Settings</Link>
            </p>
          </div>
        </div>
      )}

      {(error || message) && (
        <div className={`rounded-xl px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
          {error || message}
          <button type="button" className="ml-2 underline text-xs" onClick={() => { setError(null); setMessage(null); }}>Dismiss</button>
        </div>
      )}

      {tab === 'create' ? (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase text-zinc-500 mb-2">1 · Pick item</p>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search inventory…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
              </div>
              <ul className="max-h-52 overflow-y-auto space-y-1">
                {filteredItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold truncate transition-colors ${
                        selectedItemId === item.id ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50 text-zinc-700'
                      }`}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {selectedItem && (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-slate-500 mb-2">2 · Photo</p>
                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    {itemPhotos.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => { setPhotoUrl(url); setUploadPreview(null); setActivePhoto(''); }}
                        className={`aspect-square rounded-lg overflow-hidden border-2 ${rawPhotoSource === url ? 'border-indigo-600' : 'border-slate-200'}`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void filesToDataUrls(Array.from(e.target.files || [])).then((u) => { if (u[0]) { setUploadPreview(u[0]); setActivePhoto(''); } })} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="w-full py-2 rounded-xl border border-dashed text-xs font-bold text-slate-600 flex items-center justify-center gap-1">
                    <Upload size={12} /> Upload
                  </button>
                  {rawPhotoSource && (
                    <ProductPhotoEnhancePanel
                      sourceUrl={rawPhotoSource}
                      onEnhanced={(url, meta) => {
                        setActivePhoto(url);
                        setPhotoEnhanceMeta(meta);
                      }}
                      className="mt-3"
                    />
                  )}
                  {photoEnhanceMeta && (
                    <p className="text-[10px] text-slate-500 mt-1">Using: {photoEnhanceMeta.provider}</p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-slate-500 mb-2">3 · AI providers (compare)</p>
                  <ul className="space-y-1.5">
                    {providers.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedProviders.includes(p.id)}
                            onChange={() => toggleProvider(p.id)}
                          />
                          <span className="text-xs font-bold text-slate-800">{p.label}</span>
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${p.tier === 'paid' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {p.tier}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={generating || !selectedItem || selectedProviders.length === 0}
                    onClick={() => void handleGenerate()}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900 text-white text-xs font-black uppercase disabled:opacity-50 hover:bg-zinc-800 transition-colors"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    Generate & compare
                  </button>
                </section>

                <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-zinc-500 mb-2">Built-in templates</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTemplate({
                          ...PREMIUM_NOIR_EDITORIAL_TEMPLATE,
                          usps: [...DEFAULT_USPS[detectProductCardFamily(selectedItem)]],
                          family: detectProductCardFamily(selectedItem),
                        })
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                        activeTemplate?.id === PREMIUM_NOIR_EDITORIAL_TEMPLATE.id
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      }`}
                    >
                      Premium Showcase
                    </button>
                    {BUILTIN_PRODUCT_CARD_TEMPLATES.filter(
                      (t) => t.id !== PREMIUM_NOIR_EDITORIAL_TEMPLATE.id && t.family === detectProductCardFamily(selectedItem)
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTemplate({ ...t, usps: [...t.usps] })}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                          activeTemplate?.id === t.id
                            ? 'bg-zinc-900 text-white'
                            : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                        }`}
                      >
                        {t.name.split('—')[1]?.trim() || t.name}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </aside>

          <div className="space-y-4">
            {!selectedItem ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-24 text-center text-slate-500">
                <Sparkles size={32} className="mx-auto mb-3 opacity-40" />
                <p className="font-bold">Select an item to start</p>
              </div>
            ) : variants.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {variants.map((v) => (
                  <article key={v.key} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <div className="aspect-[4/5] bg-slate-100 relative">
                      {v.loading ? (
                        <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
                      ) : v.previewUrl ? (
                        <img src={v.previewUrl} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-red-600 px-4 text-center">{v.result.error || 'Preview failed'}</div>
                      )}
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-black text-sm text-slate-900">{v.result.template.name}</p>
                          {v.result.template.aiMeta && (
                            <p className="text-[10px] font-bold text-indigo-600 mt-0.5">
                              AI: {v.result.template.aiMeta.provider} · {v.result.template.aiMeta.variantStyle}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" disabled={exporting || !v.previewUrl} onClick={() => void handleSaveVariant(v)} className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase">
                          <BookmarkPlus size={10} className="inline mr-1" /> Save
                        </button>
                        <button type="button" disabled={exporting || !v.previewUrl} onClick={() => void handleExport(v.result.template)} className="px-2.5 py-1.5 rounded-lg border text-[10px] font-black uppercase">
                          <Download size={10} className="inline mr-1" /> JPG
                        </button>
                        <button type="button" disabled={exporting || !v.previewUrl} onClick={() => void handleApplyToItem(v.result.template)} className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase">
                          Apply photo
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : activeTemplate && activePhotoResolved ? (
              <div className="rounded-2xl border border-zinc-200/80 bg-[#fafafa] p-6 shadow-sm">
                <p className="text-xs font-black uppercase text-zinc-500 mb-4">Live preview · {activeTemplate.name}</p>
                <div className="rounded-2xl bg-[#09090b] p-6 sm:p-10 flex justify-center">
                  <ManualPreview
                    item={selectedItem}
                    template={activeTemplate}
                    photoUrl={activePhotoResolved}
                    categoryFields={categoryFieldsForItem}
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <button type="button" disabled={exporting} onClick={() => void handleExport(activeTemplate)} className="px-4 py-2 rounded-xl border border-zinc-300 text-xs font-black uppercase hover:bg-white transition-colors">Download</button>
                  <button type="button" disabled={exporting} onClick={() => void handleApplyToItem(activeTemplate)} className="px-4 py-2 rounded-xl bg-zinc-900 text-white text-xs font-black uppercase hover:bg-zinc-800 transition-colors">Apply as main photo</button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center text-slate-500 text-sm">
                Add a photo, then click <strong>Generate & compare</strong> or pick a built-in template.
              </div>
            )}
          </div>
        </div>
      ) : tab === 'library' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {library.length === 0 ? (
            <p className="col-span-full text-center text-slate-500 py-16">No saved designs yet.</p>
          ) : (
            library.map((entry) => (
              <article key={entry.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden group">
                <div className="aspect-[4/5] bg-slate-100">
                  {entry.previewDataUrl ? (
                    <img src={entry.previewDataUrl} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">No preview</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-bold text-xs text-slate-900 truncate">{entry.template.name}</p>
                  {entry.template.aiMeta ? (
                    <p className="text-[10px] text-indigo-600 font-bold">{entry.template.aiMeta.provider}</p>
                  ) : (
                    <p className="text-[10px] text-slate-400">Manual</p>
                  )}
                  {entry.sourceItemName && (
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{entry.sourceItemName}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setLibrary(deleteFromProductCardLibrary(entry.id));
                      setMessage('Design removed from library');
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-red-600 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2 mb-2">
              <FolderOpen size={16} /> Template packs (built-in)
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Ready-made layouts you can reuse. No scraping from Canva/eBay — those templates are copyrighted. Import your own JSON or use these packs.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {packTemplates.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="h-16 rounded-lg" style={{ background: `linear-gradient(135deg, ${t.theme.bgFrom}, ${t.theme.bgTo})` }} />
                  <p className="text-xs font-bold text-slate-900">{t.name}</p>
                  <p className="text-[10px] text-slate-500">{t.family} · {t.layout}</p>
                  <button
                    type="button"
                    onClick={() => {
                      saveProductCardTemplate(t);
                      setSavedTemplates(loadSavedProductCardTemplates());
                      setMessage(`Saved „${t.name}" to your templates`);
                    }}
                    className="text-[10px] font-black uppercase text-indigo-600"
                  >
                    Save to my templates
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2 mb-2">
              <FileJson size={16} /> Import / export JSON
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Share templates as <code className="bg-slate-100 px-1 rounded">.json</code> files. Export from a saved design or create manually (see{' '}
              <code className="bg-slate-100 px-1 rounded">public/product-card-templates/</code> for examples).
            </p>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const t = parseProductCardTemplateJson(String(reader.result));
                    saveProductCardTemplate(t);
                    setSavedTemplates(loadSavedProductCardTemplates());
                    setMessage(`Imported „${t.name}"`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Invalid template JSON');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase"
            >
              <Upload size={14} /> Import template JSON
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 mb-3">My saved templates</h2>
            {savedTemplates.length === 0 ? (
              <p className="text-sm text-slate-500">No custom templates yet — save from Create tab or import JSON.</p>
            ) : (
              <ul className="space-y-2">
                {savedTemplates.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{t.name}</p>
                      <p className="text-[10px] text-slate-500">{t.aiMeta?.provider || 'Manual'} · {t.family}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const json = exportProductCardTemplateJson(t);
                          const blob = new Blob([json], { type: 'application/json' });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `${t.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
                          a.click();
                        }}
                        className="text-[10px] font-bold text-indigo-600 px-2 py-1"
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteSavedProductCardTemplate(t.id);
                          setSavedTemplates(loadSavedProductCardTemplates());
                        }}
                        className="text-[10px] font-bold text-red-600 px-2 py-1"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 space-y-2">
        <p className="font-black text-slate-800">About AI subscriptions vs API</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li><strong>Cursor / Claude chat / Gemini app</strong> — paid subscriptions for those apps; they do not automatically give API keys for this site.</li>
          <li><strong>Free API tiers</strong> — Groq, Google AI Studio (Gemini), Together, Mistral; Ollama runs locally for free.</li>
          <li><strong>Paid API</strong> — OpenAI and Anthropic keys from their developer consoles (pay per use).</li>
          <li>Each saved AI template stores <strong>which provider</strong> generated it and the date.</li>
        </ul>
      </section>
    </div>
  );
};

function ManualPreview({
  item,
  template,
  photoUrl,
  categoryFields,
}: {
  item: InventoryItem;
  template: ProductCardTemplate;
  photoUrl: string;
  categoryFields?: string[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void renderProductCardToCanvas({ item, template, photoUrl, categoryFields }).then((c) => {
      if (!cancelled) setUrl(c.toDataURL('image/jpeg', 0.85));
    });
    return () => { cancelled = true; };
  }, [item, template, photoUrl, categoryFields]);
  if (!url) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-zinc-400" /></div>;
  return <img src={url} alt="" className="max-w-full w-[min(100%,360px)] rounded-xl shadow-2xl ring-1 ring-white/10" />;
}

export default ProductCardStudioPage;
