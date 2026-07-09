import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye, EyeOff, ArrowUp, ArrowDown, Plus, Pencil, Archive, ArchiveRestore, Trash2,
  Loader2, Save, ExternalLink, ImagePlus, Check, RotateCcw, ShieldCheck,
  GripVertical,
} from 'lucide-react';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { TRUST_ICONS } from './storefront/trustIcons';
import {
  subscribeToStorefrontConfig,
  writeStorefrontConfig,
  uploadStorefrontAsset,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
  type StorefrontBlockId,
  type StorefrontPromoAd,
  type StorefrontTrustItem,
} from '../services/firebaseService';

const BLOCK_LABELS: Record<StorefrontBlockId, string> = {
  hero: 'Hero (headline & search)',
  categoryGrid: 'Shop by category',
  promoAds: 'Featured PC ad(s)',
  bestSellers: 'Best sellers this week',
  trustRow: 'Trust badges row',
};

const BLOCK_NOTES: Record<StorefrontBlockId, string> = {
  hero: 'Headline text, tagline and CTA buttons. Search bar and All/Sale tabs stay functional.',
  categoryGrid: 'Cards are generated from your real inventory categories — only the heading text is editable here.',
  promoAds: 'Manage ads in the section below. 2+ active ads show as a carousel with dots and arrows.',
  bestSellers: 'Product cards come from your published inventory — only the heading text is editable here.',
  trustRow: 'Manage the badge cards in the section below.',
};

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneConfig(c: StorefrontConfig): StorefrontConfig {
  return JSON.parse(JSON.stringify(c));
}

const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; id?: string }> = ({
  title, subtitle, children, id,
}) => (
  <div id={id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 scroll-mt-24">
    <h2 className="text-base font-bold text-slate-900">{title}</h2>
    {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    <div className="mt-5">{children}</div>
  </div>
);

const StorefrontConfiguratorPage: React.FC = () => {
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<StorefrontConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [editingTrustId, setEditingTrustId] = useState<string | null>(null);
  const [uploadingAdId, setUploadingAdId] = useState<string | null>(null);
  const [showArchivedAds, setShowArchivedAds] = useState(false);
  const [showArchivedTrust, setShowArchivedTrust] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToStorefrontConfig((data, error) => {
      const resolved = data ?? DEFAULT_STOREFRONT_CONFIG;
      setConfig(cloneConfig(resolved));
      setSavedConfig(cloneConfig(resolved));
      setLoadError(
        error
          ? 'Could not load the live config (permission error) — showing defaults. Make sure the Firestore rules have been deployed (firebase deploy --only firestore:rules).'
          : null
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const dirty = useMemo(() => {
    if (!config || !savedConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(savedConfig);
  }, [config, savedConfig]);

  const patch = (fn: (c: StorefrontConfig) => void) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = cloneConfig(prev);
      fn(next);
      return next;
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      await writeStorefrontConfig(config);
      setSavedConfig(cloneConfig(config));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = () => {
    if (!window.confirm('Reset the entire storefront layout to defaults? This does not save until you click "Save changes".')) return;
    setConfig(cloneConfig(DEFAULT_STOREFRONT_CONFIG));
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  const orderedBlocks = [...config.blocks].sort((a, b) => a.order - b.order);
  const activeAds = config.promoAds.filter((a) => !a.archived);
  const archivedAds = config.promoAds.filter((a) => a.archived);
  const activeTrust = config.trustItems.filter((t) => !t.archived);
  const archivedTrust = config.trustItems.filter((t) => t.archived);

  const moveBlock = (id: StorefrontBlockId, dir: -1 | 1) => {
    patch((c) => {
      const sorted = [...c.blocks].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((b) => b.id === id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swapIdx];
      const tmp = a.order;
      a.order = b.order;
      b.order = tmp;
      c.blocks = sorted;
    });
  };

  const toggleBlockVisible = (id: StorefrontBlockId) => {
    patch((c) => {
      const b = c.blocks.find((x) => x.id === id);
      if (b) b.visible = !b.visible;
    });
  };

  const addAd = () => {
    const id = newId('promo');
    patch((c) => {
      c.promoAds.push({
        id,
        name: 'New featured PC',
        specLine: '',
        price: 0,
        visible: true,
        archived: false,
      });
    });
    setEditingAdId(id);
  };

  const updateAd = (id: string, fields: Partial<StorefrontPromoAd>) => {
    patch((c) => {
      const ad = c.promoAds.find((a) => a.id === id);
      if (ad) Object.assign(ad, fields);
    });
  };

  const archiveAd = (id: string, archived: boolean) => {
    updateAd(id, { archived });
    if (editingAdId === id) setEditingAdId(null);
  };

  const deleteAdPermanently = (id: string) => {
    if (!window.confirm('Permanently delete this ad? This cannot be undone after you save.')) return;
    patch((c) => {
      c.promoAds = c.promoAds.filter((a) => a.id !== id);
    });
  };

  const handleAdImageUpload = async (ad: StorefrontPromoAd, file: File) => {
    setUploadingAdId(ad.id);
    try {
      const url = await uploadStorefrontAsset(file, ad.id);
      updateAd(ad.id, { imageUrl: url });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadingAdId(null);
    }
  };

  const addTrustItem = () => {
    const id = newId('trust');
    patch((c) => {
      c.trustItems.push({
        id, icon: 'ShieldCheck', title: 'New badge', description: '', visible: true, archived: false,
      });
    });
    setEditingTrustId(id);
  };

  const updateTrustItem = (id: string, fields: Partial<StorefrontTrustItem>) => {
    patch((c) => {
      const t = c.trustItems.find((x) => x.id === id);
      if (t) Object.assign(t, fields);
    });
  };

  const archiveTrustItem = (id: string, archived: boolean) => {
    updateTrustItem(id, { archived });
    if (editingTrustId === id) setEditingTrustId(null);
  };

  const deleteTrustItemPermanently = (id: string) => {
    if (!window.confirm('Permanently delete this badge? This cannot be undone after you save.')) return;
    patch((c) => {
      c.trustItems = c.trustItems.filter((t) => t.id !== id);
    });
  };

  const moveTrustItem = (id: string, dir: -1 | 1) => {
    patch((c) => {
      const list = c.trustItems.filter((t) => !t.archived);
      const idx = list.findIndex((t) => t.id === id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= list.length) return;
      const a = list[idx];
      const b = list[swapIdx];
      const ia = c.trustItems.findIndex((t) => t.id === a.id);
      const ib = c.trustItems.findIndex((t) => t.id === b.id);
      [c.trustItems[ia], c.trustItems[ib]] = [c.trustItems[ib], c.trustItems[ia]];
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Storefront configurator</h1>
          <p className="text-sm text-slate-500 mt-1">
            Edit, reorder, hide, or restore any block on the public storefront. Changes go live once you click Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700"
          >
            <ExternalLink size={15} />
            View storefront
          </Link>
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700"
          >
            <RotateCcw size={15} />
            Reset all
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          {loadError}
        </div>
      )}

      {/* Blocks: order + visibility + section text */}
      <SectionCard title="Page blocks" subtitle="Show/hide, reorder (align), and edit each section's heading text.">
        <div className="space-y-2.5">
          {orderedBlocks.map((block, i) => (
            <div key={block.id} className={`rounded-xl border p-4 ${block.visible ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
              <div className="flex items-center gap-3">
                <GripVertical size={16} className="text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-900">{BLOCK_LABELS[block.id]}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{BLOCK_NOTES[block.id]}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" disabled={i === 0} onClick={() => moveBlock(block.id, -1)} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600" title="Move up">
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" disabled={i === orderedBlocks.length - 1} onClick={() => moveBlock(block.id, 1)} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600" title="Move down">
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleBlockVisible(block.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
                      block.visible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {block.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    {block.visible ? 'Visible' : 'Hidden'}
                  </button>
                </div>
              </div>

              {block.id === 'hero' && (
                <div className="mt-4 grid sm:grid-cols-2 gap-3 pl-7">
                  <label className="text-xs font-semibold text-slate-500 sm:col-span-2">
                    Subtitle text
                    <input
                      value={config.hero.subtitle ?? ''}
                      onChange={(e) => patch((c) => { c.hero.subtitle = e.target.value; })}
                      placeholder="GPUs, CPUs, RAM and complete builds — inspected, fairly priced, inquire directly."
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Primary button label
                    <input
                      value={config.hero.ctaLabel ?? ''}
                      onChange={(e) => patch((c) => { c.hero.ctaLabel = e.target.value; })}
                      placeholder="Shop the store"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Secondary button label
                    <input
                      value={config.hero.ctaSaleLabel ?? ''}
                      onChange={(e) => patch((c) => { c.hero.ctaSaleLabel = e.target.value; })}
                      placeholder="See sale items"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                </div>
              )}

              {block.id === 'categoryGrid' && (
                <div className="mt-4 grid sm:grid-cols-2 gap-3 pl-7">
                  <label className="text-xs font-semibold text-slate-500">
                    Heading
                    <input
                      value={config.categoryGrid.heading ?? ''}
                      onChange={(e) => patch((c) => { c.categoryGrid.heading = e.target.value; })}
                      placeholder="Shop by category"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Subheading
                    <input
                      value={config.categoryGrid.subheading ?? ''}
                      onChange={(e) => patch((c) => { c.categoryGrid.subheading = e.target.value; })}
                      placeholder="Every category, one click away."
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                </div>
              )}

              {block.id === 'bestSellers' && (
                <div className="mt-4 grid sm:grid-cols-2 gap-3 pl-7">
                  <label className="text-xs font-semibold text-slate-500">
                    Heading
                    <input
                      value={config.bestSellers.heading ?? ''}
                      onChange={(e) => patch((c) => { c.bestSellers.heading = e.target.value; })}
                      placeholder="Best sellers this week"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Subheading
                    <input
                      value={config.bestSellers.subheading ?? ''}
                      onChange={(e) => patch((c) => { c.bestSellers.subheading = e.target.value; })}
                      placeholder="Straight from our inspected stock."
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                </div>
              )}

              {(block.id === 'promoAds' || block.id === 'trustRow') && (
                <div className="mt-3 pl-7">
                  <a
                    href={`#${block.id === 'promoAds' ? 'promo-ads-section' : 'trust-row-section'}`}
                    className="text-xs font-bold text-brand-600 hover:underline"
                  >
                    Manage below ↓
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Featured PC ads */}
      <SectionCard
        id="promo-ads-section"
        title="Featured PC ad(s)"
        subtitle="Add one or several. 2+ active ads automatically show as a carousel with dots and arrows on the storefront."
      >
        <div className="space-y-3">
          {activeAds.length === 0 && (
            <p className="text-sm text-slate-500">No active ads. Add one below.</p>
          )}
          {activeAds.map((ad) => (
            <div key={ad.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-16 h-16 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center overflow-hidden">
                  {ad.imageUrl ? (
                    <img src={ad.imageUrl} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <ImagePlus size={20} className="text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-900 truncate">{ad.name}</p>
                  <p className="text-xs text-slate-500 truncate">{ad.specLine || '—'}</p>
                  <p className="text-sm font-bold text-slate-900 mt-1">{formatEUR(ad.price)} €</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateAd(ad.id, { visible: !ad.visible })}
                    className={`p-2 rounded-lg ${ad.visible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    title={ad.visible ? 'Visible on storefront' : 'Hidden on storefront'}
                  >
                    {ad.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button type="button" onClick={() => setEditingAdId(editingAdId === ad.id ? null : ad.id)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={() => archiveAd(ad.id, true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Archive (recoverable)">
                    <Archive size={15} />
                  </button>
                </div>
              </div>

              {editingAdId === ad.id && (
                <div className="mt-4 pt-4 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-slate-500 sm:col-span-2">
                    Name
                    <input
                      value={ad.name}
                      onChange={(e) => updateAd(ad.id, { name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Spec line
                    <input
                      value={ad.specLine}
                      onChange={(e) => updateAd(ad.id, { specLine: e.target.value })}
                      placeholder="Ryzen 9 · RTX 4080 · 32GB DDR5 · 2TB NVMe"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Price (€)
                    <input
                      inputMode="decimal"
                      value={String(ad.price)}
                      onChange={(e) => updateAd(ad.id, { price: parseLocaleNumber(e.target.value) || 0 })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Button label (optional)
                    <input
                      value={ad.ctaLabel ?? ''}
                      onChange={(e) => updateAd(ad.id, { ctaLabel: e.target.value })}
                      placeholder="Inquire now"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Image URL (optional)
                    <input
                      value={ad.imageUrl ?? ''}
                      onChange={(e) => updateAd(ad.id, { imageUrl: e.target.value })}
                      placeholder="https://…"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500 flex flex-col">
                    Or upload a photo
                    <span className="mt-1 inline-flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAdImageUpload(ad, file);
                          e.target.value = '';
                        }}
                        className="text-xs"
                      />
                      {uploadingAdId === ad.id && <Loader2 size={14} className="animate-spin text-slate-400" />}
                    </span>
                  </label>
                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingAdId(null)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Check size={14} />
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addAd}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold border-2 border-dashed border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600 w-full justify-center"
          >
            <Plus size={16} />
            Add featured PC ad
          </button>

          {archivedAds.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowArchivedAds((s) => !s)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                {showArchivedAds ? 'Hide' : 'Show'} archived ads ({archivedAds.length})
              </button>
              {showArchivedAds && (
                <div className="mt-2 space-y-2">
                  {archivedAds.map((ad) => (
                    <div key={ad.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-sm text-slate-600 truncate">{ad.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => archiveAd(ad.id, false)} className="p-1.5 rounded-lg hover:bg-white text-slate-600" title="Restore">
                          <ArchiveRestore size={14} />
                        </button>
                        <button type="button" onClick={() => deleteAdPermanently(ad.id)} className="p-1.5 rounded-lg hover:bg-white text-rose-500" title="Delete permanently">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Trust row items */}
      <SectionCard id="trust-row-section" title="Trust badges" subtitle="The four cards above the footer. Edit text, choose an icon, reorder, hide, or archive each one.">
        <div className="space-y-2.5">
          {activeTrust.map((item, i) => {
            const Icon = TRUST_ICONS[item.icon] || ShieldCheck;
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{item.title}</p>
                    <p className="text-xs text-slate-500 truncate">{item.description || '—'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" disabled={i === 0} onClick={() => moveTrustItem(item.id, -1)} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600" title="Move up">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" disabled={i === activeTrust.length - 1} onClick={() => moveTrustItem(item.id, 1)} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600" title="Move down">
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTrustItem(item.id, { visible: !item.visible })}
                      className={`p-2 rounded-lg ${item.visible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                      title={item.visible ? 'Visible' : 'Hidden'}
                    >
                      {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button type="button" onClick={() => setEditingTrustId(editingTrustId === item.id ? null : item.id)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => archiveTrustItem(item.id, true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Archive (recoverable)">
                      <Archive size={14} />
                    </button>
                  </div>
                </div>

                {editingTrustId === item.id && (
                  <div className="mt-4 pt-4 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-slate-500">
                      Title
                      <input
                        value={item.title}
                        onChange={(e) => updateTrustItem(item.id, { title: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      Description
                      <input
                        value={item.description}
                        onChange={(e) => updateTrustItem(item.id, { description: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <span className="text-xs font-semibold text-slate-500">Icon</span>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {Object.entries(TRUST_ICONS).map(([name, IconOpt]) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => updateTrustItem(item.id, { icon: name })}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center border-2 ${
                              item.icon === name ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                            title={name}
                          >
                            <IconOpt size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setEditingTrustId(null)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
                      >
                        <Check size={14} />
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addTrustItem}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold border-2 border-dashed border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600 w-full justify-center"
          >
            <Plus size={16} />
            Add trust badge
          </button>

          {archivedTrust.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowArchivedTrust((s) => !s)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                {showArchivedTrust ? 'Hide' : 'Show'} archived badges ({archivedTrust.length})
              </button>
              {showArchivedTrust && (
                <div className="mt-2 space-y-2">
                  {archivedTrust.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-sm text-slate-600 truncate">{item.title}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => archiveTrustItem(item.id, false)} className="p-1.5 rounded-lg hover:bg-white text-slate-600" title="Restore">
                          <ArchiveRestore size={14} />
                        </button>
                        <button type="button" onClick={() => deleteTrustItemPermanently(item.id)} className="p-1.5 rounded-lg hover:bg-white text-rose-500" title="Delete permanently">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          {saveError && <span className="text-rose-600 font-medium">{saveError}</span>}
          {!saveError && savedFlash && <span className="text-emerald-600 font-medium inline-flex items-center gap-1.5"><Check size={15} /> Saved — live on storefront</span>}
          {!saveError && !savedFlash && dirty && <span className="text-slate-500">Unsaved changes</span>}
          {!saveError && !savedFlash && !dirty && <span className="text-slate-400">All changes saved</span>}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save changes
        </button>
      </div>
    </div>
  );
};

export default StorefrontConfiguratorPage;
