import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, Wand2 } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  fetchProductCardProviders,
  generateProductCard,
  type ProductCardProviderId,
  type ProductCardProviderInfo,
} from '../services/productCardGemini';
import { getItemUserPhotoUrls } from '../utils/imageImport';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES,
  type ProductCardStyleId,
} from '../services/productCardStyles';
import { resolveUrlForInventoryMainPhoto } from '../utils/applyProductCardAsMainPhoto';
import { listingAccessoriesReady } from '../utils/itemAccessoryToggles';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL } from './addFlowShared';

type Props = {
  item: InventoryItem;
  categoryFields?: string[];
  onApplyAsMainPhoto: (url: string) => void | Promise<void>;
  /** When true, scroll/focus attention (e.g. after toolbar AI card click). */
  highlight?: boolean;
};

/**
 * Compact product-card generator for the New Asset bottom column.
 * Same generate path as the full modal — fewer controls.
 */
const GeminiProductCardMini: React.FC<Props> = ({
  item,
  categoryFields,
  onApplyAsMainPhoto,
  highlight,
}) => {
  const itemPhotos = useMemo(() => getItemUserPhotoUrls(item).slice(0, 1), [item]);
  const [provider, setProvider] = useState<ProductCardProviderId>('openai');
  const [providers, setProviders] = useState<ProductCardProviderInfo[]>([]);
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    void fetchProductCardProviders().then(setProviders).catch(() => undefined);
  }, []);

  const providerList =
    providers.length > 0
      ? providers
      : [
          { id: 'openai' as const, name: 'OpenAI', available: true, blurb: 'GPT Image' },
          { id: 'gemini' as const, name: 'Gemini', available: true, blurb: 'Flash Image' },
        ];

  const generate = async () => {
    if (!item.name?.trim()) {
      setError('Add an item name first.');
      return;
    }
    const gate = listingAccessoriesReady(item);
    if (!gate.ok) {
      setError(gate.reason || 'Confirm OVP / IO Blende first.');
      return;
    }
    setStarted(true);
    setLoading(true);
    setError(null);
    try {
      const result = await generateProductCard(item, categoryFields, {
        styleId,
        provider,
        photos: itemPhotos.length ? itemPhotos : null,
        editFromPhoto: itemPhotos.length > 0,
      });
      setPreview(result.dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const prepared = await resolveUrlForInventoryMainPhoto(preview, item.id || 'draft', null);
      await onApplyAsMainPhoto(prepared);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set as main photo');
    } finally {
      setApplying(false);
    }
  };

  const accessoriesGate = listingAccessoriesReady(item);
  const canGenerateCard = Boolean(item.name?.trim()) && accessoriesGate.ok;

  if (!started && !preview) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center text-center gap-3 px-4 py-8 ${
          highlight ? 'ring-2 ring-slate-900/10 rounded-xl' : ''
        }`}
      >
        <div className="w-12 h-12 rounded-2xl border border-slate-200 bg-white text-slate-600 inline-flex items-center justify-center">
          <Sparkles size={22} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900">AI card studio</p>
          <p className="text-[11px] font-semibold text-slate-500 mt-1 max-w-[16rem]">
            Uses OVP / IO flags plus your item
            {itemPhotos.length ? ' photo' : ' name'} for a listing card.
          </p>
        </div>
        {!accessoriesGate.ok && (
          <p className="text-[10px] font-semibold text-violet-900 bg-violet-100 border border-violet-300 rounded-lg px-3 py-2 max-w-[18rem]">
            {accessoriesGate.reason}
          </p>
        )}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || !canGenerateCard}
          title={accessoriesGate.reason || undefined}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          Generate card
        </button>
        {error && <p className="text-[10px] font-bold text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col gap-3 min-h-0 ${
        highlight ? 'ring-2 ring-slate-900/10 rounded-xl' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`${ADD_FLOW_LABEL} flex items-center gap-1.5`}>
            <Sparkles size={11} /> AI card studio
          </p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
            1) Pick style · 2) Generate · 3) Use as main
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={ADD_FLOW_LABEL}>AI</label>
          <select
            className={`${ADD_FLOW_INPUT} py-2 text-xs font-bold`}
            value={provider}
            disabled={loading}
            onChange={(e) => setProvider(e.target.value as ProductCardProviderId)}
          >
            {providerList.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={ADD_FLOW_LABEL}>Style</label>
          <select
            className={`${ADD_FLOW_INPUT} py-2 text-xs font-bold`}
            value={styleId}
            disabled={loading}
            onChange={(e) => setStyleId(e.target.value as ProductCardStyleId)}
          >
            {PRODUCT_CARD_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-[10rem] rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center relative">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <Loader2 size={22} className="animate-spin" />
            <p className="text-[10px] font-bold">Generating…</p>
          </div>
        ) : preview ? (
          <img src={preview} alt="AI product card" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="text-[11px] font-semibold text-slate-400 text-center px-4">
            Preview appears here
          </p>
        )}
      </div>

      {error && <p className="text-[10px] font-bold text-red-600">{error}</p>}

      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || !item.name?.trim() || !listingAccessoriesReady(item).ok}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {preview ? 'Regen' : 'Generate'}
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!preview || applying || loading}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40"
        >
          {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Use as main
        </button>
      </div>
    </div>
  );
};

export default GeminiProductCardMini;
