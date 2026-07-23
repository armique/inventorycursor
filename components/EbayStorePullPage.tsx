import { useSearchParams } from 'react-router-dom';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  PackageSearch,
  PlusCircle,
  RefreshCw,
  ShoppingBag,
  Tag,
  GitCompare,
  TrendingDown,
  Layers,
} from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import { fetchMyEbayListings, getEbayUsername } from '../services/ebayService';
import {
  buildEbayStorePullPlan,
  getStorePullRoundedPrice,
  type EbayStorePullMatch,
  type EbayStorePullPlan,
} from '../utils/ebayBulkSyncPlan';
import { formatEUR } from '../utils/formatMoney';
import { normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';
import EbayToolSearchInput from './EbayToolSearchInput';
import type { Expense } from '../types';

const EbayStorePullImportTab = lazy(() => import('./EbayStorePullImportTab'));
const EbayStorePullSoldTab = lazy(() => import('./EbayStorePullSoldTab'));
const EbayStorePullOrdersTab = lazy(() => import('./EbayStorePullOrdersTab'));
const EbayStorePullPurchasesTab = lazy(() => import('./EbayStorePullPurchasesTab'));
const EbayStorePullBundlesTab = lazy(() => import('./EbayStorePullBundlesTab'));
const EbayOrderSourceCompareTab = lazy(() => import('./EbayOrderSourceCompareTab'));

type PhotoMode = 'none' | 'all' | 'pick';
type PullTab = 'sync' | 'import' | 'sold' | 'orders' | 'purchases' | 'compare' | 'bundles';

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => void | Promise<void>;
  onAddExpense: (expense: Expense) => void;
}

function defaultRowState(match: EbayStorePullMatch): RowState {
  const hasPrice = match.listing.price != null && match.listing.price > 0;
  const hasPhotos = match.listing.imageUrls.length > 0;
  return {
    selected: true,
    fetchPrice: hasPrice,
    photoMode: hasPhotos ? 'all' : 'none',
    selectedPhotos: [],
    expanded: false,
  };
}

function matchKindLabel(kind: EbayStorePullMatch['matchKind']): string {
  if (kind === 'sku') return 'SKU match';
  if (kind === 'relinked') return 'Previous link';
  return 'Title match';
}

interface RowState {
  selected: boolean;
  fetchPrice: boolean;
  photoMode: PhotoMode;
  selectedPhotos: string[];
  expanded: boolean;
}

const PRIMARY_TABS: { id: PullTab; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    id: 'orders',
    label: 'Sales sync',
    icon: <PackageSearch size={14} />,
    hint: 'Fetch eBay orders and match inventory',
  },
  {
    id: 'purchases',
    label: 'Purchases',
    icon: <ShoppingBag size={14} />,
    hint: 'What you bought on eBay — filament, expenses, personal',
  },
];

const MORE_TABS: { id: PullTab; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    id: 'bundles',
    label: 'Parse bundles',
    icon: <Layers size={14} />,
    hint: 'Match eBay bundle listings to free inventory parts',
  },
  {
    id: 'sync',
    label: 'Sync existing',
    icon: <RefreshCw size={14} />,
    hint: 'Pull photos & price into items already in inventory',
  },
  {
    id: 'import',
    label: 'Import missing',
    icon: <PlusCircle size={14} />,
    hint: 'Add new inventory items from eBay listings',
  },
  {
    id: 'sold',
    label: 'Detect sold',
    icon: <TrendingDown size={14} />,
    hint: 'Legacy listing snapshot diff — prefer Sales sync',
  },
  {
    id: 'compare',
    label: 'API vs CSV',
    icon: <GitCompare size={14} />,
    hint: 'Compare API and CSV snapshots',
  },
];

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm font-bold">
      <Loader2 size={18} className="animate-spin" /> Loading tool…
    </div>
  );
}

const EbayStorePullPage: React.FC<Props> = ({
  items,
  categories,
  categoryFields,
  taxMode,
  onUpdate,
  onPublishCatalog,
  onAddExpense,
}) => {
  const [tab, setTab] = useState<PullTab>('orders');
  const [showMoreTools, setShowMoreTools] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'sales') setTab('orders');
    else if (t === 'purchases') setTab('purchases');
    else if (
      t === 'sync' ||
      t === 'import' ||
      t === 'sold' ||
      t === 'orders' ||
      t === 'compare' ||
      t === 'purchases' ||
      t === 'bundles'
    ) {
      setTab(t);
      if (MORE_TABS.some((x) => x.id === t)) setShowMoreTools(true);
    }
  }, [searchParams]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EbayStorePullPlan | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<EbayToolProgress | null>(null);
  const [syncSearch, setSyncSearch] = useState('');

  const rowKey = (match: EbayStorePullMatch) => `${match.item.id}:${match.listing.listingId}`;

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyMessage(null);
    setPlan(null);
    setRowState({});
    setProgress({ label: 'Fetching active eBay listings…', done: 0, total: 3 });
    try {
      const listings = await fetchMyEbayListings();
      setProgress({
        label: 'Fetching active eBay listings…',
        done: 1,
        total: 3,
        detail: `${listings.length} listing${listings.length === 1 ? '' : 's'}`,
      });
      if (!listings.length) {
        setError(`No active eBay listings found for seller ${getEbayUsername()}.`);
        return;
      }
      setProgress({ label: 'Matching inventory to listings…', done: 2, total: 3 });
      const nextPlan = buildEbayStorePullPlan(items, listings);
      setProgress({
        label: 'Preparing results…',
        done: 3,
        total: 3,
        detail: `${nextPlan.matches.length} match${nextPlan.matches.length === 1 ? '' : 'es'}`,
      });
      setPlan(nextPlan);
      const initial: Record<string, RowState> = {};
      for (const match of nextPlan.matches) {
        initial[rowKey(match)] = defaultRowState(match);
      }
      setRowState(initial);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load eBay listings.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 900);
    }
  }, [items]);

  const selectedMatches = useMemo(() => {
    if (!plan) return [];
    return plan.matches.filter((m) => rowState[rowKey(m)]?.selected);
  }, [plan, rowState]);

  const visibleSyncMatches = useMemo(() => {
    if (!plan) return [];
    return plan.matches.filter((m) =>
      matchesEbayToolSearch(syncSearch, [
        m.item.name,
        m.item.ebaySku,
        m.item.ebayListingId,
        m.listing.title,
        m.listing.sku,
        m.listing.listingId,
        m.matchKind,
        m.warning,
      ])
    );
  }, [plan, syncSearch]);

  const visibleUnmatchedItems = useMemo(() => {
    if (!plan) return [];
    return plan.unmatchedItems.filter((item) =>
      matchesEbayToolSearch(syncSearch, [item.name, item.ebaySku, item.category, item.subCategory])
    );
  }, [plan, syncSearch]);

  const visibleUnusedListings = useMemo(() => {
    if (!plan) return [];
    return plan.unusedListings.filter((listing) =>
      matchesEbayToolSearch(syncSearch, [listing.title, listing.sku, listing.listingId])
    );
  }, [plan, syncSearch]);

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const setAllSelected = (selected: boolean) => {
    if (!plan) return;
    setRowState((prev) => {
      const next = { ...prev };
      for (const match of plan.matches) {
        const key = rowKey(match);
        next[key] = { ...next[key], selected };
      }
      return next;
    });
  };

  const setAllFetchPrice = (fetchPrice: boolean) => {
    if (!plan) return;
    setRowState((prev) => {
      const next = { ...prev };
      for (const match of plan.matches) {
        const key = rowKey(match);
        if (!next[key]?.selected) continue;
        next[key] = { ...next[key], fetchPrice };
      }
      return next;
    });
  };

  const setAllPhotoMode = (photoMode: PhotoMode) => {
    if (!plan) return;
    setRowState((prev) => {
      const next = { ...prev };
      for (const match of plan.matches) {
        const key = rowKey(match);
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
        [key]: { ...row, photoMode: 'pick', selectedPhotos: Array.from(set) },
      };
    });
  };

  const applySelected = async () => {
    if (!plan || !selectedMatches.length) return;
    setApplying(true);
    setApplyMessage(null);
    setError(null);
    const total = selectedMatches.length;
    setProgress({ label: 'Applying eBay sync…', done: 0, total });
    try {
      const updates: InventoryItem[] = [];
      for (let i = 0; i < selectedMatches.length; i++) {
        const match = selectedMatches[i];
        const key = rowKey(match);
        const row = rowState[key];
        if (!row) continue;

        setProgress({
          label: 'Applying eBay sync…',
          done: i,
          total,
          detail: match.item.name,
        });

        let updated: InventoryItem = { ...match.item };
        const listing = match.listing;

        if (row.fetchPrice) {
          const rounded = getStorePullRoundedPrice(listing);
          if (rounded != null) {
            updated.storePrice = rounded;
          }
        }

        if (row.photoMode === 'all' && listing.imageUrls.length) {
          const prepared = await prepareInventoryImagesForStorage(listing.imageUrls, {
            itemId: match.item.id,
          });
          if (prepared.length) {
            const merged = normalizeImageList([
              ...(match.item.imageUrl ? [match.item.imageUrl] : []),
              ...(match.item.imageUrls || []),
              ...prepared,
            ]);
            updated = { ...updated, imageUrl: merged[0], imageUrls: merged };
          }
        } else if (row.photoMode === 'pick' && row.selectedPhotos.length) {
          const prepared = await prepareInventoryImagesForStorage(row.selectedPhotos, {
            itemId: match.item.id,
          });
          if (prepared.length) {
            const merged = normalizeImageList([
              ...(match.item.imageUrl ? [match.item.imageUrl] : []),
              ...(match.item.imageUrls || []),
              ...prepared,
            ]);
            updated = { ...updated, imageUrl: merged[0], imageUrls: merged };
          }
        }

        updated.listedOnEbay = true;
        updated.ebayListingId = listing.listingId;
        if (listing.sku) updated.ebaySku = updated.ebaySku || listing.sku;
        if (listing.offerId) updated.ebayOfferId = updated.ebayOfferId || listing.offerId;

        updates.push(updated);
        setProgress({
          label: 'Applying eBay sync…',
          done: i + 1,
          total,
          detail: match.item.name,
        });
      }

      if (updates.length) {
        onUpdate(updates);
        void onPublishCatalog?.();
        setApplyMessage(`Applied ${updates.length} item${updates.length === 1 ? '' : 's'} from eBay.`);
        setPlan(null);
        setRowState({});
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to apply changes.');
    } finally {
      setApplying(false);
      setTimeout(() => setProgress(null), 900);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full animate-in fade-in">
      <header className="shrink-0 flex flex-wrap items-start justify-between gap-4 px-1">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-3 rounded-2xl bg-blue-100 text-blue-700 shrink-0">
            <PackageSearch size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">eBay Tools</h1>
            <p className="text-sm text-slate-500 mt-1">
              Sync, import, and reconcile orders from{' '}
              <span className="font-bold text-slate-700">{getEbayUsername()}</span> — review every change
              before applying.
            </p>
          </div>
        </div>
        {tab === 'sync' && (
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-500/20"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? 'Analyzing…' : 'Analyze eBay listings'}
          </button>
        )}
      </header>

      <div className="shrink-0 w-full overflow-x-auto mt-4 space-y-2">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/80 w-full min-w-max">
          {PRIMARY_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 xl:px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all whitespace-nowrap min-w-[7.5rem] ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowMoreTools((v) => !v)}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${
              showMoreTools || MORE_TABS.some((t) => t.id === tab)
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            More
            {showMoreTools ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
        {showMoreTools && (
          <div className="flex gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200/80 w-full min-w-max">
            {MORE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                title={t.hint}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all whitespace-nowrap ${
                  tab === t.id ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-4 pb-2">
      {tab === 'sync' && progress && (
        <EbayToolProgressBar {...progress} tone="blue" />
      )}

      <Suspense fallback={<TabFallback />}>
      {tab === 'bundles' ? (
        <EbayStorePullBundlesTab items={items} onUpdate={onUpdate} />
      ) : tab === 'import' ? (
        <EbayStorePullImportTab
          items={items}
          categories={categories}
          categoryFields={categoryFields}
          onUpdate={onUpdate}
          onPublishCatalog={onPublishCatalog}
        />
      ) : tab === 'sold' ? (
        <EbayStorePullSoldTab
          items={items}
          taxMode={taxMode}
          onUpdate={onUpdate}
          onPublishCatalog={onPublishCatalog}
        />
      ) : tab === 'orders' ? (
        <EbayStorePullOrdersTab items={items} taxMode={taxMode} onUpdate={onUpdate} />
      ) : tab === 'compare' ? (
        <EbayOrderSourceCompareTab />
      ) : tab === 'purchases' ? (
        <EbayStorePullPurchasesTab items={items} onAddExpense={onAddExpense} />
      ) : (
        <>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-black text-slate-900">How matching works (re-lists & duplicates)</h2>
        <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4">
          <li>
            Only <span className="font-bold">in-stock</span> items with{' '}
            <span className="font-bold">no storefront price</span> are analyzed — once you pull from eBay,
            that item is skipped on future runs.
          </li>
          <li>
            Only your <span className="font-bold">currently active</span> eBay listings are used. Sold or
            ended listings are not in the feed, so a sold part won&apos;t steal a match from a new re-list.
          </li>
          <li>
            Each listing is assigned to <span className="font-bold">at most one</span> inventory item
            (highest confidence first). <span className="font-bold">SKU matches</span> always win over title
            guessing.
          </li>
          <li>
            Re-listed the same part with a <span className="font-bold">new eBay listing ID</span>? Add a
            fresh inventory row (or clear its storefront price only if you intentionally want to re-pull).
            The old sold row stays out of the pool.
          </li>
          <li>
            Two identical in-stock names? Review <span className="font-bold">title-match</span> rows carefully
            — assign SKUs on eBay or in inventory for reliable pairing.
          </li>
        </ul>
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

      {plan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Need pull', value: plan.candidateCount },
              { label: 'Active listings', value: plan.activeListingCount },
              { label: 'Matches found', value: plan.matches.length },
              { label: 'Already synced', value: plan.claimedListingCount },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase text-slate-400">{stat.label}</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{stat.value}</p>
              </div>
            ))}
          </div>

          {(plan.matches.length > 0 || plan.unmatchedItems.length > 0 || plan.unusedListings.length > 0) && (
            <EbayToolSearchInput
              value={syncSearch}
              onChange={setSyncSearch}
              placeholder="Search inventory item, listing title, SKU…"
              matchCount={visibleSyncMatches.length + visibleUnmatchedItems.length + visibleUnusedListings.length}
              totalCount={plan.matches.length + plan.unmatchedItems.length + plan.unusedListings.length}
            />
          )}

          {plan.matches.length > 0 && (
            <div className="space-y-3">
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
                className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-black uppercase text-amber-800 hover:bg-amber-100"
              >
                Price: all on
              </button>
              <button
                type="button"
                onClick={() => setAllFetchPrice(false)}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
              >
                Price: all off
              </button>
              <button
                type="button"
                onClick={() => setAllPhotoMode('all')}
                className="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-[10px] font-black uppercase text-blue-800 hover:bg-blue-100"
              >
                Photos: all
              </button>
              <button
                type="button"
                onClick={() => setAllPhotoMode('none')}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
              >
                Photos: none
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={applying || selectedMatches.length === 0}
                onClick={() => void applySelected()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
              >
                {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Apply {selectedMatches.length} selected
              </button>
            </div>

          <div className="space-y-3">
            {visibleSyncMatches.length === 0 && syncSearch.trim() ? (
              <p className="text-sm text-slate-500 text-center py-8">No matches for your search.</p>
            ) : null}
            {visibleSyncMatches.map((match) => {
              const key = rowKey(match);
              const row = rowState[key] ?? defaultRowState(match);
              const rounded = getStorePullRoundedPrice(match.listing);
              const photoSet = new Set(row.selectedPhotos);

              return (
                <div
                  key={key}
                  className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition-all ${
                    row.selected ? 'border-blue-200' : 'border-slate-200 opacity-70'
                  }`}
                >
                  <div className="p-4 flex flex-wrap gap-4">
                    <label className="flex items-start gap-3 min-w-[200px] flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => updateRow(key, { selected: e.target.checked })}
                        className="mt-1 rounded border-slate-300"
                      />
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-slate-400">Inventory item</p>
                        <p className="text-sm font-bold text-slate-900">{match.item.name}</p>
                        {match.item.ebaySku && (
                          <p className="text-[10px] text-slate-500 mt-0.5">SKU: {match.item.ebaySku}</p>
                        )}
                      </div>
                    </label>

                    <div className="flex gap-3 min-w-[240px] flex-1">
                      {match.listing.thumbnail ? (
                        <img
                          src={match.listing.thumbnail}
                          alt=""
                          className="w-14 h-14 rounded-xl object-cover border border-slate-100 shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-slate-100 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase text-slate-400">eBay listing</p>
                        {match.listing.listingUrl ? (
                          <a
                            href={match.listing.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-bold text-blue-600 hover:underline line-clamp-2 inline-flex items-start gap-1"
                          >
                            {match.listing.title}
                            <ExternalLink size={12} className="shrink-0 mt-0.5" />
                          </a>
                        ) : (
                          <p className="text-sm font-bold text-slate-900 line-clamp-2">{match.listing.title}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {matchKindLabel(match.matchKind)}
                          </span>
                          <span className="text-[9px] font-bold text-slate-500">
                            {match.listing.imageUrls.length} photo
                            {match.listing.imageUrls.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.fetchPrice}
                          disabled={!row.selected || rounded == null}
                          onChange={(e) => updateRow(key, { fetchPrice: e.target.checked })}
                          className="rounded border-slate-300"
                        />
                        <Tag size={14} className="text-amber-600" />
                        Fetch storefront price
                        {rounded != null && (
                          <span className="text-emerald-700 font-black">€{formatEUR(rounded)}</span>
                        )}
                      </label>

                      <div className="flex flex-wrap gap-1.5">
                        {(['none', 'all', 'pick'] as PhotoMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            disabled={!row.selected || (mode !== 'none' && !match.listing.imageUrls.length)}
                            onClick={() =>
                              updateRow(key, {
                                photoMode: mode,
                                selectedPhotos: mode === 'pick' ? row.selectedPhotos : [],
                                expanded: mode === 'pick' ? true : row.expanded,
                              })
                            }
                            className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase border ${
                              row.photoMode === mode
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            } disabled:opacity-40`}
                          >
                            {mode === 'none' ? 'No photos' : mode === 'all' ? 'All photos' : 'Pick photos'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {match.warning && (
                    <div className="px-4 pb-3">
                      <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                        {match.warning}
                      </p>
                    </div>
                  )}

                  {row.photoMode === 'pick' && match.listing.imageUrls.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50">
                      <button
                        type="button"
                        onClick={() => updateRow(key, { expanded: !row.expanded })}
                        className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-500 mb-2"
                      >
                        {row.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {row.selectedPhotos.length} photo{row.selectedPhotos.length === 1 ? '' : 's'} selected
                      </button>
                      {row.expanded && (
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {match.listing.imageUrls.map((url) => {
                            const picked = photoSet.has(url);
                            return (
                              <button
                                key={url}
                                type="button"
                                onClick={() => togglePhoto(key, url)}
                                className={`relative aspect-square rounded-lg overflow-hidden ring-2 ${
                                  picked ? 'ring-blue-500' : 'ring-slate-200'
                                }`}
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                                {picked && (
                                  <span className="absolute top-1 right-1 bg-blue-600 text-white rounded-full p-0.5">
                                    <CheckCircle2 size={10} />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
            </div>
          )}

          {visibleUnmatchedItems.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
              <p className="text-xs font-black uppercase text-amber-800">
                {visibleUnmatchedItems.length} item{visibleUnmatchedItems.length === 1 ? '' : 's'} without a listing match
                {syncSearch.trim() ? ` (filtered)` : ''}
              </p>
              <ul className="text-xs text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                {visibleUnmatchedItems.map((item) => (
                  <li key={item.id} className="font-medium">
                    {item.name}
                    {item.ebaySku ? ` · SKU ${item.ebaySku}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {visibleUnusedListings.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-black uppercase text-slate-500">
                {visibleUnusedListings.length} active listing{visibleUnusedListings.length === 1 ? '' : 's'} not
                paired (no matching inventory without storefront price)
                {syncSearch.trim() ? ` (filtered)` : ''}
              </p>
              <ul className="text-xs text-slate-600 space-y-1 max-h-40 overflow-y-auto">
                {visibleUnusedListings.slice(0, 20).map((listing) => (
                  <li key={listing.listingId} className="line-clamp-1">
                    {listing.title}
                  </li>
                ))}
                {visibleUnusedListings.length > 20 && (
                  <li className="text-slate-400">…and {visibleUnusedListings.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {!plan && !loading && !error && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <ShoppingBag size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-bold text-slate-600">Run analysis to see matches</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Items with a storefront price already set are treated as manually synced and excluded from this
            tool.
          </p>
        </div>
      )}
        </>
      )}
      </Suspense>
      </div>
    </div>
  );
};

export default EbayStorePullPage;
