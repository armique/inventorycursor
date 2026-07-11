import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  Loader2,
  PlusCircle,
  RefreshCw,
  Tag,
  Wand2,
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { fetchMyEbayListings, getEbayUsername } from '../services/ebayService';
import {
  buildEbayOrphanListingsPlan,
  getStorePullRoundedPrice,
} from '../utils/ebayBulkSyncPlan';
import {
  enrichOrphanListingDraft,
  type EbayOrphanListingDraft,
} from '../utils/ebayListingImportEnrich';
import { formatEUR } from '../utils/formatMoney';
import { normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import { getSpecsAIProvider } from '../services/specsAI';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';

type PhotoMode = 'none' | 'all' | 'pick';

interface ImportRowState {
  selected: boolean;
  fetchPrice: boolean;
  fetchSpecs: boolean;
  photoMode: PhotoMode;
  selectedPhotos: string[];
  expanded: boolean;
  photosExpanded: boolean;
  name: string;
}

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => void | Promise<void>;
}

function defaultImportRowState(draft: EbayOrphanListingDraft): ImportRowState {
  const hasPrice = draft.listing.price != null && draft.listing.price > 0;
  const hasPhotos = draft.listing.imageUrls.length > 0;
  return {
    selected: true,
    fetchPrice: hasPrice,
    fetchSpecs: Boolean(getSpecsAIProvider()),
    photoMode: hasPhotos ? 'all' : 'none',
    selectedPhotos: [],
    expanded: false,
    photosExpanded: false,
    name: draft.parsedName,
  };
}

const EbayStorePullImportTab: React.FC<Props> = ({
  items,
  categories,
  categoryFields,
  onUpdate,
  onPublishCatalog,
}) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EbayOrphanListingDraft[]>([]);
  const [orphanStats, setOrphanStats] = useState<{ activeInventory: number; listings: number } | null>(
    null
  );
  const [rowState, setRowState] = useState<Record<string, ImportRowState>>({});

  const rowKey = (listingId: string) => listingId;

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyMessage(null);
    setDrafts([]);
    setRowState({});
    setOrphanStats(null);
    setProgress({ label: 'Fetching active eBay listings…', done: 0, total: 1 });
    try {
      const listings = await fetchMyEbayListings();
      if (!listings.length) {
        setError(`No active eBay listings found for seller ${getEbayUsername()}.`);
        return;
      }
      setProgress({
        label: 'Finding listings missing from inventory…',
        done: 1,
        total: 1,
        detail: `${listings.length} active listing${listings.length === 1 ? '' : 's'}`,
      });
      const plan = buildEbayOrphanListingsPlan(items, listings);
      setOrphanStats({ activeInventory: plan.activeInventoryCount, listings: plan.activeListingCount });

      if (!plan.orphans.length) {
        setProgress({ label: 'No missing listings', done: 1, total: 1, detail: 'All listings matched' });
        setApplyMessage('Every active listing already has a matching in-stock inventory item.');
        return;
      }

      const nextDrafts: EbayOrphanListingDraft[] = [];
      const nextRows: Record<string, ImportRowState> = {};
      const total = 1 + plan.orphans.length;
      setProgress({
        label: 'Found listings to import',
        done: 1,
        total,
        detail: `${plan.orphans.length} missing`,
      });

      for (let i = 0; i < plan.orphans.length; i++) {
        const listing = plan.orphans[i];
        setProgress({
          label: 'AI analyzing listing…',
          done: 1 + i,
          total,
          detail: listing.title,
        });
        const draft = await enrichOrphanListingDraft(listing, categories, categoryFields, {
          parseSpecs: true,
        });
        nextDrafts.push(draft);
        nextRows[rowKey(listing.listingId)] = defaultImportRowState(draft);
      }

      setProgress({
        label: 'Analysis complete',
        done: total,
        total,
        detail: `${plan.orphans.length} listing${plan.orphans.length === 1 ? '' : 's'}`,
      });
      setDrafts(nextDrafts);
      setRowState(nextRows);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to analyze eBay listings.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 900);
    }
  }, [items, categories, categoryFields]);

  const selectedDrafts = useMemo(() => {
    return drafts.filter((d) => rowState[rowKey(d.listing.listingId)]?.selected);
  }, [drafts, rowState]);

  const updateRow = (key: string, patch: Partial<ImportRowState>) => {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const setAllSelected = (selected: boolean) => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const draft of drafts) {
        const key = rowKey(draft.listing.listingId);
        next[key] = { ...next[key], selected };
      }
      return next;
    });
  };

  const setAllFetchPrice = (fetchPrice: boolean) => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const draft of drafts) {
        const key = rowKey(draft.listing.listingId);
        if (!next[key]?.selected) continue;
        next[key] = { ...next[key], fetchPrice };
      }
      return next;
    });
  };

  const setAllFetchSpecs = (fetchSpecs: boolean) => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const draft of drafts) {
        const key = rowKey(draft.listing.listingId);
        if (!next[key]?.selected) continue;
        next[key] = { ...next[key], fetchSpecs };
      }
      return next;
    });
  };

  const setAllPhotoMode = (photoMode: PhotoMode) => {
    setRowState((prev) => {
      const next = { ...prev };
      for (const draft of drafts) {
        const key = rowKey(draft.listing.listingId);
        if (!next[key]?.selected) continue;
        next[key] = {
          ...next[key],
          photoMode,
          selectedPhotos: photoMode === 'pick' ? next[key].selectedPhotos : [],
        };
      }
      return next;
    });
  };

  const togglePhoto = (key: string, url: string) => {
    setRowState((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const set = new Set(row.selectedPhotos);
      if (set.has(url)) set.delete(url);
      else set.add(url);
      return {
        ...prev,
        [key]: { ...row, photoMode: 'pick', selectedPhotos: Array.from(set), photosExpanded: true },
      };
    });
  };

  const applySelected = async () => {
    if (!selectedDrafts.length) return;
    setApplying(true);
    setError(null);
    setApplyMessage(null);
    const total = selectedDrafts.length;
    setProgress({ label: 'Importing items from eBay…', done: 0, total });
    try {
      const timestamp = Date.now();
      const today = new Date().toISOString().split('T')[0];
      const newItems: InventoryItem[] = [];

      for (let i = 0; i < selectedDrafts.length; i++) {
        const draft = selectedDrafts[i];
        const key = rowKey(draft.listing.listingId);
        const row = rowState[key];
        if (!row) continue;

        setProgress({
          label: 'Importing items from eBay…',
          done: i,
          total,
          detail: row.name.trim() || draft.parsedName,
        });

        const id = `item-${timestamp}-ebay-${i}`;
        const listing = draft.listing;
        const fallbackImage =
          CATEGORY_IMAGES[draft.subCategory || draft.category] || CATEGORY_IMAGES[draft.category];

        let imageUrls: string[] = [];
        if (row.photoMode === 'all' && listing.imageUrls.length) {
          imageUrls = await prepareInventoryImagesForStorage(listing.imageUrls, { itemId: id });
        } else if (row.photoMode === 'pick' && row.selectedPhotos.length) {
          imageUrls = await prepareInventoryImagesForStorage(row.selectedPhotos, { itemId: id });
        }

        const normalizedImages = normalizeImageList(imageUrls);
        const storePrice = row.fetchPrice ? getStorePullRoundedPrice(listing) : undefined;

        const item: InventoryItem = {
          id,
          name: row.name.trim() || draft.parsedName,
          category: draft.category,
          subCategory: draft.subCategory,
          buyPrice: 0,
          buyDate: today,
          status: ItemStatus.IN_STOCK,
          vendor: draft.vendor || 'eBay',
          platformBought: 'ebay.de',
          buyPaymentType: 'ebay.de',
          listedOnEbay: true,
          ebayListingId: listing.listingId,
          ebaySku: listing.sku,
          ebayOfferId: listing.offerId,
          storePrice,
          specs: row.fetchSpecs ? draft.specs : {},
          specsAiSuggested: row.fetchSpecs ? draft.specsAiSuggested : undefined,
          imageUrl: normalizedImages[0] || fallbackImage,
          imageUrls: normalizedImages.length ? normalizedImages : [fallbackImage],
          comment2: `Imported from eBay listing ${listing.listingId}`,
        };

        newItems.push(item);
        setProgress({
          label: 'Importing items from eBay…',
          done: i + 1,
          total,
          detail: item.name,
        });
      }

      if (newItems.length) {
        onUpdate(newItems);
        void onPublishCatalog?.();
        setApplyMessage(`Added ${newItems.length} new inventory item${newItems.length === 1 ? '' : 's'} from eBay.`);
        setDrafts([]);
        setRowState({});
        setOrphanStats(null);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to add items.');
    } finally {
      setApplying(false);
      setTimeout(() => setProgress(null), 900);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-black text-slate-900">Import listings missing from inventory</h2>
        <p className="text-xs text-slate-600">
          Finds active eBay listings that don&apos;t match any <span className="font-bold">in-stock</span>{' '}
          inventory item (by SKU or title). Parses the listing title into an item name, detects category
          with AI, optionally fills tech specs, and pulls photos + storefront price — all pending your
          approval.
        </p>
        <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
          <li>Re-listed parts with a new listing ID appear here until you add them (sold rows are ignored).</li>
          <li>Already-linked listings (<code className="text-[10px]">ebayListingId</code>) are skipped.</li>
        </ul>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={loading || applying}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {loading ? 'Analyzing…' : 'Find missing listings'}
        </button>
        {progress && <EbayToolProgressBar {...progress} tone="indigo" />}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {applyMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          {applyMessage}
        </div>
      )}

      {orphanStats && drafts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'In-stock items', value: orphanStats.activeInventory },
            { label: 'Active listings', value: orphanStats.listings },
            { label: 'Missing from inventory', value: drafts.length },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase text-slate-400">{stat.label}</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAllSelected(true)}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-700 hover:bg-slate-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setAllSelected(false)}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
            >
              Select none
            </button>
            <span className="w-px h-6 bg-slate-200 hidden sm:block" />
            <button
              type="button"
              onClick={() => setAllFetchPrice(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-black uppercase text-amber-800"
            >
              Price: on
            </button>
            <button
              type="button"
              onClick={() => setAllFetchSpecs(true)}
              className="px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-[10px] font-black uppercase text-violet-800"
            >
              Specs: on
            </button>
            <button
              type="button"
              onClick={() => setAllPhotoMode('all')}
              className="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-[10px] font-black uppercase text-blue-800"
            >
              Photos: all
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={applying || selectedDrafts.length === 0}
              onClick={() => void applySelected()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
              Add {selectedDrafts.length} selected
            </button>
          </div>

          <div className="space-y-3">
            {drafts.map((draft) => {
              const key = rowKey(draft.listing.listingId);
              const row = rowState[key] ?? defaultImportRowState(draft);
              const rounded = getStorePullRoundedPrice(draft.listing);
              const photoSet = new Set(row.selectedPhotos);
              const specEntries = Object.entries(draft.specs || {}).slice(0, 6);

              return (
                <div
                  key={key}
                  className={`rounded-2xl border bg-white overflow-hidden shadow-sm ${
                    row.selected ? 'border-indigo-200' : 'border-slate-200 opacity-70'
                  }`}
                >
                  <div className="p-4 space-y-3">
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-start gap-3 shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => updateRow(key, { selected: e.target.checked })}
                          className="mt-1 rounded border-slate-300"
                        />
                      </label>

                      {draft.listing.thumbnail ? (
                        <img
                          src={draft.listing.thumbnail}
                          alt=""
                          className="w-14 h-14 rounded-xl object-cover border border-slate-100 shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-slate-100 shrink-0" />
                      )}

                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <p className="text-[10px] font-black uppercase text-slate-400">eBay listing</p>
                          {draft.listing.listingUrl ? (
                            <a
                              href={draft.listing.listingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-bold text-blue-600 hover:underline line-clamp-2 inline-flex gap-1"
                            >
                              {draft.listing.title}
                              <ExternalLink size={11} className="shrink-0 mt-0.5" />
                            </a>
                          ) : (
                            <p className="text-xs font-bold text-slate-700 line-clamp-2">{draft.listing.title}</p>
                          )}
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                            Parsed item name
                          </label>
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateRow(key, { name: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-indigo-400"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {draft.category} / {draft.subCategory}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">
                            via {draft.categorySource}
                          </span>
                          {draft.listing.sku && (
                            <span className="text-[9px] font-bold text-slate-500">SKU {draft.listing.sku}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {draft.enrichError && (
                      <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {draft.enrichError}
                      </p>
                    )}

                    {specEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {specEntries.map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700"
                          >
                            {k}: {String(v)}
                          </span>
                        ))}
                        {Object.keys(draft.specs).length > 6 && (
                          <span className="text-[10px] text-slate-400">
                            +{Object.keys(draft.specs).length - 6} more
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-100">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.fetchPrice}
                          disabled={!row.selected || rounded == null}
                          onChange={(e) => updateRow(key, { fetchPrice: e.target.checked })}
                          className="rounded border-slate-300"
                        />
                        <Tag size={14} className="text-amber-600" />
                        Storefront price
                        {rounded != null && (
                          <span className="text-emerald-700 font-black">€{formatEUR(rounded)}</span>
                        )}
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.fetchSpecs}
                          disabled={!row.selected || !Object.keys(draft.specs).length}
                          onChange={(e) => updateRow(key, { fetchSpecs: e.target.checked })}
                          className="rounded border-slate-300"
                        />
                        <Wand2 size={14} className="text-violet-600" />
                        Include AI specs
                      </label>

                      <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
                        {(['none', 'all', 'pick'] as PhotoMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            disabled={!row.selected || (mode !== 'none' && !draft.listing.imageUrls.length)}
                            onClick={() =>
                              updateRow(key, {
                                photoMode: mode,
                                photosExpanded: mode === 'pick',
                              })
                            }
                            className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase border ${
                              row.photoMode === mode
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-200'
                            } disabled:opacity-40`}
                          >
                            {mode === 'none' ? 'No photos' : mode === 'all' ? 'All photos' : 'Pick photos'}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => updateRow(key, { expanded: !row.expanded })}
                        className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1"
                      >
                        {row.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Details
                      </button>
                    </div>

                    {row.expanded && (
                      <div className="text-xs text-slate-500 space-y-1 bg-slate-50 rounded-xl p-3">
                        <p>
                          <Cpu size={12} className="inline mr-1" />
                          Listing ID: {draft.listing.listingId}
                        </p>
                        <p>Raw title cleaned → category detected → specs parsed during analyze.</p>
                      </div>
                    )}

                    {row.photoMode === 'pick' && draft.listing.imageUrls.length > 0 && (
                      <div className="border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          onClick={() => updateRow(key, { photosExpanded: !row.photosExpanded })}
                          className="text-[10px] font-black uppercase text-slate-500 mb-2 flex items-center gap-1"
                        >
                          {row.photosExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {row.selectedPhotos.length} photo{row.selectedPhotos.length === 1 ? '' : 's'} selected
                        </button>
                        {row.photosExpanded && (
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                            {draft.listing.imageUrls.map((url) => (
                              <button
                                key={url}
                                type="button"
                                onClick={() => togglePhoto(key, url)}
                                className={`relative aspect-square rounded-lg overflow-hidden ring-2 ${
                                  photoSet.has(url) ? 'ring-blue-500' : 'ring-slate-200'
                                }`}
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                                {photoSet.has(url) && (
                                  <span className="absolute top-1 right-1 bg-blue-600 text-white rounded-full p-0.5">
                                    <CheckCircle2 size={10} />
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && !drafts.length && !error && !applyMessage && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <PlusCircle size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-bold text-slate-600">Run analysis to find listings to import</p>
        </div>
      )}
    </div>
  );
};

export default EbayStorePullImportTab;
