import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { fetchMyEbayListings, getEbayUsername, type EbayMyListing } from '../services/ebayService';
import {
  buildEbayBundleParsePlan,
  isFreeBundlePart,
  rankFreePartsForListingRole,
  type EbayBundleParsePlan,
  type EbayBundlePartMatch,
  type EbayBundlePartRole,
  type EbayBundleSuggestion,
} from '../utils/ebayBundleParsePlan';
import { getStorePullRoundedPrice } from '../utils/ebayBulkSyncPlan';
import { buildContainerTitle } from '../utils/buildTitle';
import { formatEUR } from '../utils/formatMoney';
import { normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { todayLocalDateKey } from '../utils/calendarDate';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';
import ItemThumbnail from './ItemThumbnail';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
}

interface EditablePart {
  itemId: string;
  role: EbayBundlePartRole;
  score: number;
}

interface RowState {
  selected: boolean;
  name: string;
  /** True once the user typed a custom name — stop auto-renaming */
  nameManual: boolean;
  includePhotos: boolean;
  includePrice: boolean;
  parts: EditablePart[];
}

type PickerState = {
  suggestionId: string;
  role: EbayBundlePartRole | 'any';
  /** When set, selecting a candidate replaces this part */
  replaceItemId?: string;
};

const ROLE_OPTIONS: Array<{ id: EbayBundlePartRole | 'any'; label: string }> = [
  { id: 'mobo', label: 'Mobo' },
  { id: 'cpu', label: 'CPU' },
  { id: 'ram', label: 'RAM' },
  { id: 'gpu', label: 'GPU' },
  { id: 'storage', label: 'Storage' },
  { id: 'any', label: 'Any' },
];

function partsToEditable(parts: EbayBundlePartMatch[]): EditablePart[] {
  return parts.map((p) => ({ itemId: p.item.id, role: p.role, score: p.score }));
}

function resolveParts(
  parts: EditablePart[],
  inventory: InventoryItem[]
): Array<{ item: InventoryItem; role: EbayBundlePartRole; score: number }> {
  const out: Array<{ item: InventoryItem; role: EbayBundlePartRole; score: number }> = [];
  for (const p of parts) {
    const item = inventory.find((it) => it.id === p.itemId);
    if (!item) continue;
    out.push({ item, role: p.role, score: p.score });
  }
  return out;
}

function editWarnings(parts: EditablePart[]): string[] {
  const roles = new Set(parts.map((p) => p.role));
  const w: string[] = [];
  if (!roles.has('mobo')) w.push('No motherboard selected');
  if (!roles.has('cpu')) w.push('No CPU selected');
  if (!roles.has('ram')) w.push('No RAM selected');
  if (parts.length < 2) w.push('Need at least 2 parts');
  if (!roles.has('mobo') && !roles.has('cpu')) w.push('Need motherboard or CPU');
  return w;
}

function autoTitleForParts(
  suggestion: EbayBundleSuggestion,
  parts: EditablePart[],
  inventory: InventoryItem[]
): string {
  const resolved = resolveParts(parts, inventory).map((p) => p.item);
  if (resolved.length < 1) return suggestion.suggestedName;
  const kind = suggestion.kind === 'mixed' ? 'mixed' : 'bundle';
  return (
    buildContainerTitle(kind, resolved, { preferAufrustkit: suggestion.preferAufrustkit }) ||
    suggestion.suggestedName
  );
}

const EbayStorePullBundlesTab: React.FC<Props> = ({ items, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<EbayBundleParsePlan | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');

  const freeParts = useMemo(() => items.filter(isFreeBundlePart), [items]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyMessage(null);
    setPlan(null);
    setRowState({});
    setPicker(null);
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
          nameManual: false,
          includePhotos: s.listing.imageUrls.length > 0,
          includePrice: s.listing.price != null && s.listing.price > 0,
          parts: partsToEditable(s.parts),
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

  const setPartsForRow = (suggestion: EbayBundleSuggestion, nextParts: EditablePart[]) => {
    setRowState((prev) => {
      const row = prev[suggestion.id];
      if (!row) return prev;
      const name = row.nameManual
        ? row.name
        : autoTitleForParts(suggestion, nextParts, items);
      return {
        ...prev,
        [suggestion.id]: { ...row, parts: nextParts, name },
      };
    });
  };

  const removePart = (suggestion: EbayBundleSuggestion, itemId: string) => {
    const row = rowState[suggestion.id];
    if (!row) return;
    setPartsForRow(
      suggestion,
      row.parts.filter((p) => p.itemId !== itemId)
    );
  };

  const claimedIdsOutside = (suggestionId: string): Set<string> => {
    const claimed = new Set<string>();
    for (const [id, row] of Object.entries(rowState)) {
      if (id === suggestionId) continue;
      if (!row.selected) continue;
      for (const p of row.parts) claimed.add(p.itemId);
    }
    return claimed;
  };

  const pickerListing: EbayMyListing | null = useMemo(() => {
    if (!picker || !plan) return null;
    return plan.suggestions.find((s) => s.id === picker.suggestionId)?.listing ?? null;
  }, [picker, plan]);

  const pickerCandidates = useMemo(() => {
    if (!picker || !pickerListing) return [] as EbayBundlePartMatch[];
    const row = rowState[picker.suggestionId];
    const exclude = claimedIdsOutside(picker.suggestionId);
    // Allow replacing current card's parts except the one being replaced stays selectable
    for (const p of row?.parts || []) {
      if (p.itemId !== picker.replaceItemId) exclude.add(p.itemId);
    }
    return rankFreePartsForListingRole(
      pickerListing,
      freeParts,
      picker.role,
      exclude,
      pickerQuery,
      50
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claimedIdsOutside reads rowState
  }, [picker, pickerListing, freeParts, pickerQuery, rowState]);

  useEffect(() => {
    if (!picker) setPickerQuery('');
  }, [picker]);

  const pickCandidate = (match: EbayBundlePartMatch) => {
    if (!picker || !plan) return;
    const suggestion = plan.suggestions.find((s) => s.id === picker.suggestionId);
    if (!suggestion) return;
    const row = rowState[suggestion.id];
    if (!row) return;

    let next = [...row.parts];
    if (picker.replaceItemId) {
      next = next.filter((p) => p.itemId !== picker.replaceItemId);
    }
    if (!next.some((p) => p.itemId === match.item.id)) {
      next.push({
        itemId: match.item.id,
        role: picker.role === 'any' ? match.role : picker.role,
        score: match.score,
      });
    }
    setPartsForRow(suggestion, next);
    setPicker(null);
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

        const parts = resolveParts(row.parts, items)
          .map((p) => p.item)
          .filter((p) => !claimedPartIds.has(p.id) && isStillFree(p));

        const roles = new Set(
          resolveParts(row.parts, items)
            .filter((p) => parts.some((x) => x.id === p.item.id))
            .map((p) => p.role)
        );
        const hasCore = roles.has('mobo') || roles.has('cpu');

        if (parts.length < 2 || !hasCore) {
          setProgress({
            label: 'Creating bundles from eBay…',
            done: i + 1,
            total,
            detail: `Skipped ${suggestion.listing.title.slice(0, 40)}… (need ≥2 parts + mobo/CPU)`,
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
          buyDate: todayLocalDateKey(),
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
        setPlan(null);
        setRowState({});
      } else {
        setError('No bundles created — check part selection (need ≥2 free parts including mobo or CPU).');
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
              . Matching uses model/chipset/DDR signals. For each proposal you can remove wrong parts
              or pick replacements from free inventory before confirm.
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
            listing titles closely enough. You can still re-scan after adding free parts.
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
              const resolved = resolveParts(row.parts, items);
              const liveWarnings = [
                ...s.warnings.filter((w) => !/No (motherboard|CPU|RAM) matched/i.test(w)),
                ...editWarnings(row.parts),
              ];
              const uniqueWarnings = [...new Set(liveWarnings)];

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
                        onChange={(e) =>
                          updateRow(s.id, { name: e.target.value, nameManual: true })
                        }
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
                      {uniqueWarnings.length > 0 && (
                        <p className="text-[10px] font-medium text-amber-700">
                          {uniqueWarnings.join(' · ')}
                        </p>
                      )}

                      <div className="space-y-1.5 pt-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Parts ({resolved.length})
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setPicker({ suggestionId: s.id, role: 'any' })
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-violet-700 hover:text-violet-900"
                          >
                            <Plus size={12} /> Add part
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {resolved.length === 0 && (
                            <p className="text-[10px] text-slate-400 font-medium">
                              No parts — add from inventory search.
                            </p>
                          )}
                          {resolved.map((p) => (
                            <div
                              key={p.item.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-slate-50 border border-slate-100"
                              title={`Score ${p.score}`}
                            >
                              <ItemThumbnail item={p.item} size={28} />
                              <span className="text-[10px] font-black uppercase text-violet-600 w-14 shrink-0">
                                {p.role}
                              </span>
                              <span className="text-[11px] font-bold text-slate-800 truncate flex-1 min-w-0">
                                {p.item.name}
                              </span>
                              <span className="text-[9px] font-bold text-slate-400 shrink-0">
                                {p.score}
                              </span>
                              <button
                                type="button"
                                title="Replace from inventory"
                                onClick={() =>
                                  setPicker({
                                    suggestionId: s.id,
                                    role: p.role,
                                    replaceItemId: p.item.id,
                                  })
                                }
                                className="p-1 rounded-lg text-slate-400 hover:text-violet-700 hover:bg-violet-50"
                              >
                                <Replace size={13} />
                              </button>
                              <button
                                type="button"
                                title="Remove part"
                                onClick={() => removePart(s, p.item.id)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {ROLE_OPTIONS.filter((r) => r.id !== 'any').map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() =>
                                setPicker({ suggestionId: s.id, role: r.id })
                              }
                              className="px-2 py-0.5 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-500 hover:border-violet-300 hover:text-violet-700"
                            >
                              + {r.label}
                            </button>
                          ))}
                        </div>
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

      {picker &&
        pickerListing &&
        createPortal(
          <div
            className="fixed inset-0 z-[240] flex items-end sm:items-center justify-center bg-slate-900/50 p-3"
            onClick={() => setPicker(null)}
          >
            <div
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-900">
                    {picker.replaceItemId ? 'Replace part' : 'Add part'}
                  </h3>
                  <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                    {pickerListing.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPicker(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-4 py-3 space-y-2 border-b border-slate-50">
                <div className="flex flex-wrap gap-1">
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPicker((p) => (p ? { ...p, role: r.id } : p))}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                        picker.role === r.id
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search free inventory…"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-medium outline-none focus:ring-2 focus:ring-violet-200"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                {pickerCandidates.length === 0 ? (
                  <p className="text-[11px] text-slate-500 font-medium text-center py-8">
                    No free parts match this filter.
                  </p>
                ) : (
                  pickerCandidates.map((c) => (
                    <button
                      key={c.item.id}
                      type="button"
                      onClick={() => pickCandidate(c)}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-violet-50 text-left"
                    >
                      <ItemThumbnail item={c.item} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{c.item.name}</p>
                        <p className="text-[9px] font-medium text-slate-400">
                          {c.role}
                          {c.item.subCategory ? ` · ${c.item.subCategory}` : ''}
                          {c.score > 0 ? ` · score ${c.score}` : ''}
                        </p>
                      </div>
                      <span className="text-[9px] font-black uppercase text-violet-700 shrink-0">
                        {picker.replaceItemId ? 'Use' : 'Add'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

function isStillFree(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if (item.isPC || item.isBundle || item.parentContainerId) return false;
  if (item.isDefective) return false;
  return true;
}

export default EbayStorePullBundlesTab;
