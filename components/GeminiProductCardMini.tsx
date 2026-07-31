import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, Wand2 } from 'lucide-react';
import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import {
  fetchProductCardProviders,
  generateProductCard,
  type ProductCardProviderId,
  type ProductCardProviderInfo,
} from '../services/productCardGemini';
import {
  listProductCardGalleryForItemIds,
  resolveProductCardImageUrl,
  saveGeneratedProductCard,
} from '../services/productCardGallery';
import { getItemUserPhotoUrls } from '../utils/imageImport';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES,
  getProductCardStyle,
  type ProductCardStyleId,
} from '../services/productCardStyles';
import {
  resolveUrlForInventoryMainPhoto,
} from '../utils/applyProductCardAsMainPhoto';
import {
  productCardGalleryItemIds,
  resolveProductCardGalleryOwner,
} from '../utils/productCardParentMatch';
import { listingAccessoriesReady } from '../utils/itemAccessoryToggles';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL } from './addFlowShared';

type Props = {
  item: InventoryItem;
  /** Full inventory — used to attach cards to an exact parent SKU gallery. */
  inventoryItems?: InventoryItem[];
  categoryFields?: string[];
  /** Append a prepared photo URL to the item (first photo if empty). */
  onAppendPhoto: (url: string) => void | Promise<void>;
  /** Remove a photo URL from the item (gallery entry stays saved). */
  onRemovePhotoUrl: (url: string) => void | Promise<void>;
  highlight?: boolean;
};

function urlsOnItem(item: InventoryItem): string[] {
  return [item.imageUrl, ...(item.imageUrls || [])].filter(
    (u): u is string => typeof u === 'string' && u.trim().length > 0
  );
}

/**
 * Compact product-card generator for the New Asset bottom column.
 * Generated cards are saved to the (shared parent) card gallery and added as item photos.
 * Gallery thumbnails can be selected/deselected for the item card photos.
 */
const GeminiProductCardMini: React.FC<Props> = ({
  item,
  inventoryItems = [],
  categoryFields,
  onAppendPhoto,
  onRemovePhotoUrl,
  highlight,
}) => {
  const itemPhotos = useMemo(() => getItemUserPhotoUrls(item).slice(0, 1), [item]);
  const galleryOwner = useMemo(
    () => resolveProductCardGalleryOwner(inventoryItems, item),
    [inventoryItems, item]
  );
  const galleryItemIds = useMemo(
    () => productCardGalleryItemIds(inventoryItems, item),
    [inventoryItems, item]
  );

  const [provider, setProvider] = useState<ProductCardProviderId>('openai');
  const [providers, setProviders] = useState<ProductCardProviderInfo[]>([]);
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [loading, setLoading] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  /** entryId → durable URL currently on the item (selected for the card). */
  const [selectedOnItem, setSelectedOnItem] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchProductCardProviders().then(setProviders).catch(() => undefined);
  }, []);

  const reloadGallery = useCallback(async () => {
    try {
      const list = await listProductCardGalleryForItemIds(galleryItemIds);
      setGallery(list);
      const nextThumbs: Record<string, string> = {};
      await Promise.all(
        list.slice(0, 24).map(async (e) => {
          try {
            nextThumbs[e.id] = await resolveProductCardImageUrl(e);
          } catch {
            /* skip */
          }
        })
      );
      setThumbs((prev) => ({ ...prev, ...nextThumbs }));

      const onItem = new Set(urlsOnItem(item));
      const selected: Record<string, string> = {};
      for (const e of list) {
        const candidates = [e.imageUrl, nextThumbs[e.id]].filter(Boolean) as string[];
        const hit = candidates.find((u) => onItem.has(u));
        if (hit) selected[e.id] = hit;
      }
      setSelectedOnItem(selected);
    } catch (e) {
      console.warn('Card gallery load failed:', e);
    }
  }, [galleryItemIds, item]);

  useEffect(() => {
    void reloadGallery();
  }, [reloadGallery]);

  const providerList =
    providers.length > 0
      ? providers
      : [
          { id: 'openai' as const, name: 'OpenAI', available: true, blurb: 'GPT Image' },
          { id: 'gemini' as const, name: 'Gemini', available: true, blurb: 'Flash Image' },
        ];

  const accessoriesGate = listingAccessoriesReady(item);
  const canGenerateCard = Boolean(item.name?.trim()) && accessoriesGate.ok;

  const pushPhotoOntoItem = async (source: string, entry?: GeneratedProductCardEntry | null) => {
    const prepared = await resolveUrlForInventoryMainPhoto(
      source,
      item.id || 'draft',
      entry || null
    );
    await onAppendPhoto(prepared);
    return prepared;
  };

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
      const style = getProductCardStyle(styleId);
      const result = await generateProductCard(item, categoryFields, {
        styleId,
        provider,
        photos: itemPhotos.length ? itemPhotos : null,
        editFromPhoto: itemPhotos.length > 0,
      });
      setPreview(result.dataUrl);

      const entry = await saveGeneratedProductCard({
        itemId: galleryOwner.ownerId,
        itemName: galleryOwner.ownerName || item.name,
        dataUrl: result.dataUrl,
        provider: result.provider,
        model: result.model,
        styleId: result.styleId || styleId,
        styleName: result.styleName || style.name,
      });

      const prepared = await pushPhotoOntoItem(result.dataUrl, entry);
      setSelectedOnItem((prev) => ({ ...prev, [entry.id]: prepared }));
      setThumbs((prev) => ({ ...prev, [entry.id]: result.dataUrl }));
      setGallery((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleGalleryOnItem = async (entry: GeneratedProductCardEntry) => {
    setBusyEntryId(entry.id);
    setError(null);
    try {
      const already = selectedOnItem[entry.id];
      if (already) {
        await onRemovePhotoUrl(already);
        setSelectedOnItem((prev) => {
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
        return;
      }

      const source = thumbs[entry.id] || (await resolveProductCardImageUrl(entry));
      const prepared = await pushPhotoOntoItem(source, entry);
      setSelectedOnItem((prev) => ({ ...prev, [entry.id]: prepared }));
      if (!thumbs[entry.id]) {
        setThumbs((prev) => ({ ...prev, [entry.id]: source }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update item photos');
    } finally {
      setBusyEntryId(null);
    }
  };

  if (!started && !preview && gallery.length === 0) {
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
            Generated cards are added as item photos and saved to the card gallery.
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
            Generate adds a photo · tick gallery cards for the item
          </p>
          {galleryOwner.isSharedParent && (
            <p className="text-[10px] font-bold text-amber-800 mt-1">
              Shared gallery with exact match: {galleryOwner.ownerName}
            </p>
          )}
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

      <div className="flex-1 min-h-[8rem] rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center relative">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <Loader2 size={22} className="animate-spin" />
            <p className="text-[10px] font-bold">Generating…</p>
          </div>
        ) : preview ? (
          <img src={preview} alt="AI product card" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="text-[11px] font-semibold text-slate-400 text-center px-4">
            Latest generate preview
          </p>
        )}
      </div>

      {gallery.length > 0 && (
        <div className="space-y-1.5">
          <p className={ADD_FLOW_LABEL}>
            Card gallery · selected = on item photos
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gallery.map((entry) => {
              const selected = Boolean(selectedOnItem[entry.id]);
              const thumb = thumbs[entry.id];
              const busy = busyEntryId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={busy || loading}
                  onClick={() => void toggleGalleryOnItem(entry)}
                  title={
                    selected
                      ? 'On item — click to remove from item photos (stays in gallery)'
                      : 'Click to add this card to item photos'
                  }
                  className={`relative shrink-0 w-16 h-16 rounded-lg border-2 overflow-hidden bg-white transition-colors ${
                    selected
                      ? 'border-emerald-500 ring-2 ring-emerald-200'
                      : 'border-slate-200 opacity-70 hover:opacity-100'
                  }`}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Loader2 size={12} className="animate-spin text-slate-400" />
                    </span>
                  )}
                  {selected && (
                    <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-emerald-500 text-white inline-flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                  {busy && (
                    <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
                      <Loader2 size={12} className="animate-spin" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-[10px] font-bold text-red-600">{error}</p>}

      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || !item.name?.trim() || !listingAccessoriesReady(item).ok}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {preview || gallery.length ? 'Regen' : 'Generate'}
        </button>
      </div>
    </div>
  );
};

export default GeminiProductCardMini;
