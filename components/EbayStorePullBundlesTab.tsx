import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { fetchMyEbayListings, getEbayUsername } from '../services/ebayService';
import {
  buildEbayBundleParsePlan,
  type EbayBundleParsePlan,
  type EbayBundleSuggestion,
} from '../utils/ebayBundleParsePlan';
import { getStorePullRoundedPrice } from '../utils/ebayBulkSyncPlan';
import { buildContainerTitle } from '../utils/buildTitle';
import { formatEUR } from '../utils/formatMoney';
import { normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';
import ItemThumbnail from './ItemThumbnail';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
}

interface RowState {
  selected: boolean;
  name: string;
  includePhotos: boolean;
  includePrice: boolean;
}

const EbayStorePullBundlesTab: React.FC<Props> = ({ items, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<EbayBundleParsePlan | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyMessage(null);
    setPlan(null);
    setRowState({});
    setProgress({ label: 'Fetching your eBay store listings…', done: 0, total: 3 });
    try {
      const listings = await fetchMyEbayListings();
      setProgress({
        label: 'Fetching your eBay store listings…',
        done: 1,
        total: 3,
        detail: `${listings.length} listing${listings.length === 1 ? '' : 's'} · ${getEbayUsername()}`,
      });
      if (!listings.length) {
        setError(`No active eBay listings found for seller ${getEbayUsername()}.`);
        return;
      }
      setProgress({ label: 'Matching free inventory parts to bundle listings…', done: 2, total: 3 });
      const next = buildEbayBundleParsePlan(items, listings);
      setProgress({
        label: 'Preparing suggestions…',
        done: 3,
        total: 3,
        detail: `${next.suggestions.length} proposal${next.suggestions.length === 1 ? '' : 's'}`,
      });
      setPlan(next);
      const initial: Record<string, RowState> = {};
      for (const s of next.suggestions) {
        initial[s.id] = {
          selected: true,
          name: s.suggestedName,
          includePhotos: s.listing.imageUrls.length > 0,
          includePrice: s.listing.price != null && s.listing.price > 0,
        };
      }
      setRowState(initial);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to parse eBay bundles.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 900);
    }
  }, [items]);

  const selected = useMemo(() => {
    if (!plan) return [] as EbayBundleSuggestion[];
    return plan.suggestions.filter((s) => rowState[s.id]?.selected);
  }, [plan, rowState]);

  const updateRow = (id: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const applySelected = async () => {
    if (!selected.length) return;
    setApplying(true);
    setError(null);
    setApplyMessage(null);
    const total = selected.length;
    setProgress({ label: 'Creating bundles from eBay…', done: 0, total });

    try {
      const updates: InventoryItem[] = [];
      const claimedPartIds = new Set<string>();
      const stamp = Date.now();

      for (let i = 0; i < selected.length; i++) {
        const suggestion = selected[i];
        const row = rowState[suggestion.id];
        if (!row) continue;

        const parts = suggestion.parts
          .map((p) => items.find((it) => it.id === p.item.id) || p.item)
          .filter((p) => !claimedPartIds.has(p.id) && isStillFree(p));

        if (parts.length < 2) {
          setProgress({
            label: 'Creating bundles from eBay…',
            done: i + 1,
            total,
            detail: `Skipped ${suggestion.listing.title.slice(0, 40)}… (parts unavailable)`,
          });
          continue;
        }

        for (const p of parts) claimedPartIds.add(p.id);

        const parentId = `bundle-ebay-${stamp}-${i}`;
        const preferAufrustkit = suggestion.preferAufrustkit;
        const kind = suggestion.kind === 'mixed' ? 'mixed' : 'bundle';
        const autoTitle = buildContainerTitle(kind, parts, { preferAufrustkit });
        const name = row.name.trim() || autoTitle || suggestion.listing.title;
        const buyTotal =
          Math.round(parts.reduce((s, p) => s + Number(p.buyPrice || 0), 0) * 100) / 100;

        setProgress({
          label: 'Creating bundles from eBay…',
          done: i,
          total,
          detail: name,
        });

        let imageUrls: string[] = [];
        if (row.includePhotos && suggestion.listing.imageUrls.length) {
          imageUrls = await prepareInventoryImagesForStorage(suggestion.listing.imageUrls, {
            itemId: parentId,
          });
        }
        const normalized = normalizeImageList(imageUrls);
        const storePrice = row.includePrice
          ? getStorePullRoundedPrice(suggestion.listing)
          : undefined;

        const parent: InventoryItem = {
          id: parentId,
          name,
          category: kind === 'mixed' ? 'Mixed Bundle' : 'Bundle',
          status: ItemStatus.IN_STOCK,
          buyPrice: buyTotal,
          buyDate: '',
          comment1: [
            `Bundle from eBay listing ${suggestion.listing.listingId} (${parts.length} parts).`,
            suggestion.listing.listingUrl || `https://www.ebay.de/itm/${suggestion.listing.listingId}`,
          ].join('\n'),
          comment2: parts
            .map((p) => `- ${p.name}`)
            .join('\n')
            .slice(0, 2000),
          isPC: false,
          isBundle: true,
          componentIds: parts.map((p) => p.id),
          vendor: kind === 'mixed' ? 'Mixed Bundle' : preferAufrustkit ? 'Aufrustkit' : 'PC Bundle',
          marketTitle: name,
          imageUrl: normalized[0] || parts.find((p) => p.imageUrl)?.imageUrl,
          imageUrls: normalized.length ? normalized : undefined,
          presence: 'present',
          listedOnEbay: true,
          ebayListingId: suggestion.listing.listingId,
          ebaySku: suggestion.listing.sku,
          ebayOfferId: suggestion.listing.offerId,
          storePrice,
        };

        const updatedParts = parts.map((comp) => ({
          ...comp,
          status: ItemStatus.IN_COMPOSITION,
          parentContainerId: parentId,
        }));

        updates.push(parent, ...updatedParts);
        setProgress({
          label: 'Creating bundles from eBay…',
          done: i + 1,
          total,
          detail: name,
        });
      }

      if (updates.length) {
        onUpdate(updates);
        const created = updates.filter((u) => u.isBundle).length;
        setApplyMessage(`Created ${created} bundle${created === 1 ? '' : 's'} with eBay photos & links.`);
        // Refresh plan against current items + leftover
        setPlan(null);
        setRowState({});
      } else {
        setError('No bundles created — matched parts may already be in use.');
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create bundles.');
    } finally {
      setApplying(false);
      setTimeout(() => setProgress(null), 900);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Layers size={16} className="text-violet-600" />
              Parse bundles from eBay profile
            </h2>
            <p className="text-[11px] text-slate-600 font-medium mt-1.5 leading-relaxed">
              Scans active listings on{' '}
              <a
                href={`https://www.ebay.de/usr/${getEbayUsername()}`}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-violet-700 underline"
              >
                ebay.de/usr/{getEbayUsername()}
              </a>
              . When inventory has matching free parts (mobo / CPU / RAM / …) that are not yet in a
              bundle, you get proposals. Confirm → creates the bundle, links the listing, and imports
              eBay photos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {plan ? 'Re-scan' : 'Scan profile'}
          </button>
        </div>
      </div>

      {progress && <EbayToolProgressBar {...progress} tone="indigo" />}

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-900 flex gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {applyMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-900 flex gap-2">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          {applyMessage}
        </div>
      )}

      {plan && (
        <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
          <span className="px-2.5 py-1 rounded-lg bg-slate-100">{plan.activeListingCount} listings</span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100">{plan.freePartCount} free parts</span>
          <span className="px-2.5 py-1 rounded-lg bg-violet-100 text-violet-800">
            {plan.suggestions.length} proposals
          </span>
          {plan.alreadyBundled.length > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">
              {plan.alreadyBundled.length} already linked
            </span>
          )}
          {plan.skippedBundleListings.length > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800">
              {plan.skippedBundleListings.length} no inventory match
            </span>
          )}
        </div>
      )}

      {plan && plan.suggestions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <Package size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-700">No bundle proposals right now</p>
          <p className="text-[11px] text-slate-500 font-medium mt-1 max-w-md mx-auto">
            Either bundle-like listings already have containers, or free inventory parts don’t match
            listing titles closely enough.
          </p>
        </div>
      )}

      {plan && plan.suggestions.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setRowState((prev) => {
                  const next = { ...prev };
                  for (const s of plan.suggestions) {
                    next[s.id] = { ...next[s.id], selected: true };
                  }
                  return next;
                })
              }
              className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-800"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() =>
                setRowState((prev) => {
                  const next = { ...prev };
                  for (const s of plan.suggestions) {
                    next[s.id] = { ...next[s.id], selected: false };
                  }
                  return next;
                })
              }
              className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-800"
            >
              Select none
            </button>
            <button
              type="button"
              disabled={applying || selected.length === 0}
              onClick={() => void applySelected()}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Confirm {selected.length} bundle{selected.length === 1 ? '' : 's'}
            </button>
          </div>

          <div className="space-y-3">
            {plan.suggestions.map((s) => {
              const row = rowState[s.id];
              if (!row) return null;
              const listingUrl =
                s.listing.listingUrl || `https://www.ebay.de/itm/${s.listing.listingId}`;
              return (
                <div
                  key={s.id}
                  className={`rounded-2xl border bg-white overflow-hidden ${
                    row.selected ? 'border-violet-300 shadow-sm' : 'border-slate-200 opacity-70'
                  }`}
                >
                  <div className="p-4 flex flex-wrap gap-3 items-start">
                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => updateRow(s.id, { selected: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                    </label>
                    {s.listing.thumbnail && (
                      <img
                        src={s.listing.thumbnail}
                        alt=""
                        className="w-16 h-16 rounded-xl object-cover border border-slate-100 bg-slate-50"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg">
                          {s.preferAufrustkit ? 'Aufrustkit' : s.kind === 'mixed' ? 'Mixed' : 'PC Bundle'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">
                          Confidence {s.confidence}%
                        </span>
                        {s.listing.price != null && (
                          <span className="text-[10px] font-black text-slate-700">
                            eBay {formatEUR(s.listing.price)} €
                          </span>
                        )}
                      </div>
                      <a
                        href={listingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-slate-800 hover:text-violet-700 inline-flex items-center gap-1"
                      >
                        {s.listing.title}
                        <ExternalLink size={11} />
                      </a>
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateRow(s.id, { name: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900"
                        placeholder="Bundle name"
                      />
                      <div className="flex flex-wrap gap-3 text-[10px] font-bold text-slate-600">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.includePhotos}
                            onChange={(e) => updateRow(s.id, { includePhotos: e.target.checked })}
                            disabled={!s.listing.imageUrls.length}
                          />
                          Import {s.listing.imageUrls.length} photo
                          {s.listing.imageUrls.length === 1 ? '' : 's'}
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.includePrice}
                            onChange={(e) => updateRow(s.id, { includePrice: e.target.checked })}
                            disabled={s.listing.price == null}
                          />
                          Set store price
                        </label>
                      </div>
                      {s.warnings.length > 0 && (
                        <p className="text-[10px] font-medium text-amber-700">
                          {s.warnings.join(' · ')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {s.parts.map((p) => (
                          <div
                            key={p.item.id}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 max-w-full"
                            title={`Score ${p.score}`}
                          >
                            <ItemThumbnail item={p.item} size={22} />
                            <span className="text-[10px] font-black uppercase text-violet-600">
                              {p.role}
                            </span>
                            <span className="text-[10px] font-bold text-slate-700 truncate max-w-[10rem]">
                              {p.item.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {plan && plan.skippedBundleListings.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <summary className="text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-pointer">
            Bundle-like listings without inventory match ({plan.skippedBundleListings.length})
          </summary>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {plan.skippedBundleListings.map((l) => (
              <li key={l.listingId} className="text-[11px] text-slate-600 font-medium truncate">
                {l.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

function isStillFree(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if (item.isPC || item.isBundle || item.parentContainerId) return false;
  return true;
}

export default EbayStorePullBundlesTab;
