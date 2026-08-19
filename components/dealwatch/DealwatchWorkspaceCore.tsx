import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ExternalLink,
  Grid3x3,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  Star,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { formatEURPrefix } from '../../utils/formatMoney';
import {
  addToWatchlist,
  createSearch,
  deleteSearch,
  fetchKaPurchases,
  fetchKaSales,
  fetchListings,
  fetchDealwatchStore,
  listingParamsFromSearch,
  removeFromWatchlist,
  restoreSearch,
  setActiveSearch,
  setAlerts,
  updateSearch,
  type DealwatchKaRecord,
  type DealwatchListing,
  type DealwatchSearch,
  type DealwatchStore,
} from '../../services/dealwatchApi';
import SearchBuilder from './SearchBuilder';
import {
  compileSearchBuilder,
  draftFromSearch,
  emptySearchBuilderDraft,
  ensureLibraryHasSelection,
  isBuilderDirty,
  loadBuilderLibrary,
  saveBuilderLibrary,
  type BuilderLibrary,
  type SearchBuilderDraft,
} from '../../utils/dealwatchSearchBuilder';
import {
  isPickupOnlyListing,
  rejectReasonLabel,
} from '../../utils/dealwatchListingFlags';

type DealwatchTab = 'matches' | 'watchlist' | 'trash' | 'ka-buys' | 'ka-sales';
type ListingView = 'small' | 'list' | 'large';

const LISTING_VIEW_KEY = 'dealwatch_listing_view_v1';
const SHOW_REJECTED_KEY = 'dealwatch_show_rejected_v1';
const HIDE_PICKUP_KEY = 'dealwatchHidePickupOnly';

function readFlag(key: string, onValue = '1'): boolean {
  try {
    return localStorage.getItem(key) === onValue;
  } catch {
    return false;
  }
}
const LISTING_VIEWS: { id: ListingView; label: string; Icon: typeof LayoutGrid }[] = [
  { id: 'small', label: 'Small tiles', Icon: Grid3x3 },
  { id: 'list', label: 'List', Icon: List },
  { id: 'large', label: 'Large tiles', Icon: LayoutGrid },
];

function readListingView(): ListingView {
  try {
    const raw = localStorage.getItem(LISTING_VIEW_KEY);
    if (raw === 'small' || raw === 'list' || raw === 'large') return raw;
  } catch {
    /* ignore */
  }
  return 'large';
}

function euros(value?: number) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return formatEURPrefix(Number(value));
}

function searchLabel(search: DealwatchSearch) {
  const variants = (search.searchVariants || []).map((v) => String(v || '').trim()).filter(Boolean);
  if (variants.length > 1) return variants.join(' · ');
  return String(search.search || search.name || 'Untitled').trim() || 'Untitled';
}

const TABS: { id: DealwatchTab; label: string }[] = [
  { id: 'matches', label: 'Matches' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'ka-buys', label: 'KA buys' },
  { id: 'ka-sales', label: 'KA sales' },
  { id: 'trash', label: 'Trash' },
];

export type DealwatchWorkspaceProps = {
  /** Compact header when embedded in Dashboard */
  embedded?: boolean;
};

const DealwatchWorkspaceCore: React.FC<DealwatchWorkspaceProps> = ({ embedded = false }) => {
  const [tab, setTab] = useState<DealwatchTab>('matches');
  const [listingView, setListingView] = useState<ListingView>(() => readListingView());
  const [showRejected, setShowRejected] = useState(() => readFlag(SHOW_REJECTED_KEY));
  const [hidePickupOnly, setHidePickupOnly] = useState(() => readFlag(HIDE_PICKUP_KEY));
  const [store, setStore] = useState<DealwatchStore | null>(null);
  const [items, setItems] = useState<DealwatchListing[]>([]);
  const [rejectedItems, setRejectedItems] = useState<DealwatchListing[]>([]);
  const [metrics, setMetrics] = useState({ matched: 0, rejected: 0, best: 0 });
  const [watchIds, setWatchIds] = useState<Set<string>>(new Set());
  const [kaBuys, setKaBuys] = useState<DealwatchKaRecord[]>([]);
  const [kaSales, setKaSales] = useState<DealwatchKaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [lastScan, setLastScan] = useState<string | null>(null);

  const [library, setLibrary] = useState<BuilderLibrary>(() => loadBuilderLibrary());
  const [draft, setDraft] = useState<SearchBuilderDraft>(() => emptySearchBuilderDraft());

  const searches = store?.searches || [];
  const trash = store?.trash || [];
  const watchlist = store?.watchlist || [];
  const activeId = store?.activeId || searches[0]?.id || '';
  const active = useMemo(
    () => searches.find((s) => s.id === activeId) || searches[0] || null,
    [searches, activeId],
  );
  const compiled = useMemo(() => compileSearchBuilder(draft, library), [draft, library]);
  const dirty = useMemo(() => isBuilderDirty(draft, library, active), [draft, library, active]);
  const alertsOn = store?.alerts !== false;
  const visibleMatches = useMemo(() => {
    const pool = showRejected ? [...items, ...rejectedItems] : items;
    return hidePickupOnly ? pool.filter((item) => !isPickupOnlyListing(item)) : pool;
  }, [hidePickupOnly, items, rejectedItems, showRejected]);
  const visibleWatchlist = useMemo(() => {
    const pool = watchlist as DealwatchListing[];
    return hidePickupOnly ? pool.filter((item) => !isPickupOnlyListing(item)) : pool;
  }, [hidePickupOnly, watchlist]);
  const pickupHiddenCount = useMemo(() => {
    const pool = showRejected ? [...items, ...rejectedItems] : items;
    return hidePickupOnly ? pool.filter(isPickupOnlyListing).length : 0;
  }, [hidePickupOnly, items, rejectedItems, showRejected]);

  const payloadFromDraft = useCallback(
    (base?: DealwatchSearch | null) => ({
      ...(base || {}),
      search: compiled.search,
      searchVariants: compiled.searchVariants,
      name: compiled.name,
      minPrice: compiled.minPrice,
      maxPrice: compiled.maxPrice,
      marketplace: compiled.marketplace,
      radiusKm: compiled.radiusKm,
      locationId: compiled.locationId,
      locationLabel: compiled.locationLabel,
      constructor: compiled.constructor,
    }),
    [compiled]
  );

  useEffect(() => {
    saveBuilderLibrary(library);
  }, [library]);

  useEffect(() => {
    try {
      localStorage.setItem(LISTING_VIEW_KEY, listingView);
    } catch {
      /* ignore */
    }
  }, [listingView]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_REJECTED_KEY, showRejected ? '1' : '0');
      localStorage.setItem(HIDE_PICKUP_KEY, hidePickupOnly ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showRejected, hidePickupOnly]);

  const applyStore = useCallback((next: DealwatchStore) => {
    setStore(next);
    setWatchIds(new Set((next.watchlist || []).map((w) => String(w.id))));
    if (Array.isArray(next.kaPurchases)) setKaBuys(next.kaPurchases);
    if (Array.isArray(next.kaSales)) setKaSales(next.kaSales);
  }, []);

  const syncDraftFromSearch = useCallback((search: DealwatchSearch | null) => {
    const loaded = loadBuilderLibrary();
    const inferred = draftFromSearch(search, loaded);
    const nextLibrary = ensureLibraryHasSelection(loaded, inferred);
    setLibrary(nextLibrary);
    setDraft(draftFromSearch(search, nextLibrary));
  }, []);

  const scan = useCallback(
    async (search: DealwatchSearch, opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        setScanning(true);
        setNote(`Scanning ${search.marketplace === 'kleinanzeigen' ? 'Kleinanzeigen' : 'eBay.de'}…`);
      }
      setError('');
      try {
        const result = await fetchListings(listingParamsFromSearch(search, alertsOn));
        setItems(result.items || []);
        setRejectedItems(result.rejectedItems || []);
        setMetrics({
          matched: Number(result.matched ?? result.items?.length ?? 0),
          rejected: Number(result.rejected ?? result.rejectedItems?.length ?? 0),
          best: Number(result.best ?? 0),
        });
        if (result.watchlistIds) setWatchIds(new Set(result.watchlistIds.map(String)));
        if (result.store) applyStore(result.store);
        setLastScan(result.checkedAt || new Date().toISOString());
        setNote(
          `${result.items?.length ?? 0} matches · ${Number(result.rejected ?? 0)} rejected`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setNote('');
      } finally {
        setScanning(false);
      }
    },
    [alertsOn, applyStore],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const next = await fetchDealwatchStore();
        if (cancelled) return;
        applyStore(next);
        const current = (next.searches || []).find((s) => s.id === next.activeId) || next.searches?.[0];
        syncDraftFromSearch(current || null);
        if (current) await scan(current, { quiet: true });
        const [buys, sales] = await Promise.all([
          fetchKaPurchases().catch(() => null),
          fetchKaSales().catch(() => null),
        ]);
        if (cancelled) return;
        if (buys?.purchases) setKaBuys(buys.purchases);
        if (sales?.sales) setKaSales(sales.sales);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStore, scan, syncDraftFromSearch]);

  const onSelectSearch = async (id: string) => {
    setError('');
    try {
      const next = await setActiveSearch(id);
      applyStore(next);
      const selected = (next.searches || []).find((s) => s.id === id) || null;
      syncDraftFromSearch(selected);
      setTab('matches');
      if (selected) await scan(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onScanDraft = async () => {
    if (!compiled.search) {
      setError('Pick a part type first.');
      return;
    }
    const adHoc: DealwatchSearch = {
      id: active?.id || 'draft',
      name: compiled.name,
      ...payloadFromDraft(active),
    };
    await scan(adHoc);
  };

  const onSaveChanges = async () => {
    if (!active) return;
    if (!compiled.search) {
      setError('Pick a part type first.');
      return;
    }
    setError('');
    try {
      const next = await updateSearch(active.id, payloadFromDraft(active));
      applyStore(next);
      const updated = next.search || active;
      syncDraftFromSearch(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSaveAsNew = async () => {
    if (!compiled.search) {
      setError('Pick a part type first.');
      return;
    }
    setError('');
    try {
      const next = await createSearch({
        ...payloadFromDraft(null),
        search: compiled.search,
        minFeedback: compiled.marketplace === 'ebay' ? 90 : 0,
        condition: 'any',
        enabledSmartFilters: [],
        includeCapacities: [],
      });
      applyStore(next);
      const created = next.search;
      syncDraftFromSearch(created);
      setTab('matches');
      if (created) await scan(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onNewSearch = async () => {
    await onSaveAsNew();
  };

  const onDeleteSearch = async (id: string) => {
    if (searches.length <= 1) {
      setError('Keep at least one tracked search.');
      return;
    }
    try {
      const next = await deleteSearch(id);
      applyStore(next);
      const current = (next.searches || []).find((s) => s.id === next.activeId) || next.searches?.[0];
      syncDraftFromSearch(current || null);
      if (current) await scan(current, { quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRestore = async (id: string) => {
    try {
      const next = await restoreSearch(id);
      applyStore(next);
      setTab('matches');
      if (next.search) {
        syncDraftFromSearch(next.search);
        await scan(next.search);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onToggleAlerts = async () => {
    try {
      const next = await setAlerts(!alertsOn);
      applyStore(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onToggleWatch = async (item: DealwatchListing) => {
    const id = String(item.id);
    try {
      if (watchIds.has(id)) {
        const next = await removeFromWatchlist(id);
        applyStore(next as DealwatchStore);
      } else {
        const next = await addToWatchlist(item, {
          searchId: active?.id,
          searchName: active?.name,
        });
        applyStore(next as DealwatchStore);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !store) {
    return (
      <div className="flex-1 min-h-[320px] flex items-center justify-center gap-3 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
        <span className="text-sm font-bold">Loading Dealwatch intelligence…</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {!embedded && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-none bg-slate-900 text-white shrink-0">
              <Radar size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900 tracking-tight truncate">Dealwatch Intelligence</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate">
                React workspace · Dealwatch APIs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/dealwatch/explore.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-none border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
            >
              Free search <ExternalLink size={12} />
            </a>
            <a
              href="/dealwatch/compare.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-none border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
            >
              Compare <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b md:border-b-0 md:border-r border-slate-100 bg-slate-950 text-white flex flex-col min-h-0">
          <div className="p-3 flex items-center justify-between gap-2 border-b border-white/10">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Tracked</p>
            <button
              type="button"
              onClick={() => void onNewSearch()}
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:text-emerald-200"
            >
              <Plus size={12} /> New
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {searches.map((search) => {
              const activeRow = search.id === activeId;
              return (
                <div
                  key={search.id}
                  className={`group flex items-stretch gap-1 rounded-none ${
                    activeRow ? 'bg-white text-slate-900' : 'hover:bg-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void onSelectSearch(search.id)}
                    className="flex-1 min-w-0 text-left px-2.5 py-2"
                  >
                    <span className="block text-xs font-bold truncate">{searchLabel(search)}</span>
                    <span className={`block text-[10px] font-semibold truncate ${activeRow ? 'text-slate-500' : 'text-slate-400'}`}>
                      €{search.minPrice ?? 1}–€{search.maxPrice ?? '—'}
                      {search.marketplace === 'kleinanzeigen' ? ' · KA' : ' · eBay'}
                      {search.monitor === false ? ' · paused' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Move to trash"
                    onClick={() => void onDeleteSearch(search.id)}
                    className={`px-2 opacity-0 group-hover:opacity-100 ${activeRow ? 'text-slate-400 hover:text-rose-600' : 'text-slate-500 hover:text-rose-300'}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-white/10 text-[10px] text-slate-500">
            <p className="font-bold uppercase tracking-wider">Marketplace</p>
            <p className="text-slate-300 font-semibold mt-0.5">eBay.de / Kleinanzeigen</p>
          </div>
        </aside>

        <div className="flex flex-col min-h-0 min-w-0">
          <div className="shrink-0 flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-100 bg-slate-50/60">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 rounded-none text-[10px] font-black uppercase tracking-wider ${
                  tab === t.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t.label}
                {t.id === 'watchlist' ? ` ${watchlist.length}` : ''}
                {t.id === 'trash' ? ` ${trash.length}` : ''}
                {t.id === 'ka-buys' ? ` ${kaBuys.length}` : ''}
                {t.id === 'ka-sales' ? ` ${kaSales.length}` : ''}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              {(tab === 'matches' || tab === 'watchlist') && (
                <div className="flex border border-slate-200 bg-white">
                  {LISTING_VIEWS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={listingView === id}
                      onClick={() => setListingView(id)}
                      className={`px-2 py-1.5 ${
                        listingView === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              )}
              {tab === 'matches' && (
                <button
                  type="button"
                  aria-pressed={showRejected}
                  onClick={() => setShowRejected((v) => !v)}
                  className={`px-2 py-1.5 border text-[10px] font-black uppercase tracking-wider ${
                    showRejected
                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {showRejected ? 'Hide rejected' : 'Show rejected'}
                  {metrics.rejected ? ` ${metrics.rejected}` : ''}
                </button>
              )}
              {(tab === 'matches' || tab === 'watchlist') && (
                <button
                  type="button"
                  aria-pressed={hidePickupOnly}
                  onClick={() => setHidePickupOnly((v) => !v)}
                  className={`px-2 py-1.5 border text-[10px] font-black uppercase tracking-wider ${
                    hidePickupOnly
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {hidePickupOnly ? 'Show Nur Abholung' : 'Hide Nur Abholung'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void onToggleAlerts()}
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-none border text-[10px] font-black uppercase tracking-wider ${
                  alertsOn
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                <Bell size={12} /> Alerts {alertsOn ? 'on' : 'off'}
              </button>
              {embedded && (
                <>
                  <a href="/dealwatch/explore.html" target="_blank" rel="noreferrer" className="px-2 py-1.5 rounded-none border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-600">Explore</a>
                  <a href="/dealwatch/compare.html" target="_blank" rel="noreferrer" className="px-2 py-1.5 rounded-none border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-600">Compare</a>
                </>
              )}
            </div>
          </div>

          {tab === 'matches' && (
            <div className="shrink-0 border-b border-slate-100 p-3 space-y-2 bg-white">
              <SearchBuilder
                draft={draft}
                library={library}
                dirty={dirty}
                scanning={scanning}
                canSave={Boolean(active)}
                onChange={setDraft}
                onLibraryChange={setLibrary}
                onScan={() => void onScanDraft()}
                onSaveChanges={() => void onSaveChanges()}
                onSaveAsNew={() => void onSaveAsNew()}
              />
              <div className="flex flex-wrap gap-3 text-[11px] font-semibold text-slate-500 items-center">
                <span>Lots <strong className="text-slate-800">{visibleMatches.length}</strong></span>
                <span>Best <strong className="text-slate-800">{metrics.best || '—'}</strong></span>
                <span>Rejected <strong className="text-slate-800">{metrics.rejected || rejectedItems.length || '—'}</strong></span>
                <span>Last scan {lastScan ? new Date(lastScan).toLocaleTimeString() : '—'}</span>
                {note && <span className="text-slate-700">{note}</span>}
                <button
                  type="button"
                  disabled={scanning || !active}
                  onClick={() => active && void scan(active)}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-none border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wider text-slate-600 disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                  Rescan saved
                </button>
              </div>
              {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {tab === 'matches' && (
              <ListingGrid
                view={listingView}
                items={visibleMatches}
                watchIds={watchIds}
                empty={
                  scanning
                    ? 'Scanning…'
                    : pickupHiddenCount
                      ? `${pickupHiddenCount} lot${pickupHiddenCount === 1 ? '' : 's'} hidden as Nur Abholung. Show them to see pickup-only ads.`
                      : !showRejected && rejectedItems.length
                        ? `${rejectedItems.length} rejected by filters. Show rejected to see them.`
                        : 'No matches — adjust filters and scan.'
                }
                onToggleWatch={onToggleWatch}
              />
            )}
            {tab === 'watchlist' && (
              <ListingGrid
                view={listingView}
                items={visibleWatchlist}
                watchIds={watchIds}
                empty={
                  hidePickupOnly && watchlist.length
                    ? 'Nur Abholung ads are hidden.'
                    : 'Watchlist is empty.'
                }
                onToggleWatch={onToggleWatch}
              />
            )}
            {tab === 'trash' && (
              <div className="space-y-2">
                {trash.length === 0 && <EmptyState text="Trash is empty." />}
                {trash.map((search) => (
                  <div key={search.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{search.name || searchLabel(search)}</p>
                      <p className="text-[11px] text-slate-500 truncate">{searchLabel(search)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onRestore(search.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-none border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            {tab === 'ka-buys' && <KaList records={kaBuys} empty="No Kleinanzeigen purchases imported yet." />}
            {tab === 'ka-sales' && <KaList records={kaSales} empty="No Kleinanzeigen sales imported yet." />}
          </div>
        </div>
      </div>
    </div>
  );
};

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm font-semibold text-slate-500 py-10 text-center">{text}</p>;
}

function ListingFlags({ item }: { item: DealwatchListing }) {
  const pickup = isPickupOnlyListing(item);
  return (
    <>
      {item.rejected && (
        <span className="px-1.5 py-0.5 bg-rose-600 text-white text-[9px] font-black uppercase">
          {rejectReasonLabel(item.rejectReason)}
        </span>
      )}
      {pickup && (
        <span className="px-1.5 py-0.5 bg-amber-600 text-white text-[9px] font-black uppercase">
          Abholung
        </span>
      )}
    </>
  );
}

function ListingGrid({
  view,
  items,
  watchIds,
  empty,
  onToggleWatch,
}: {
  view: ListingView;
  items: DealwatchListing[];
  watchIds: Set<string>;
  empty: string;
  onToggleWatch: (item: DealwatchListing) => void;
}) {
  if (!items.length) return <EmptyState text={empty} />;

  if (view === 'list') {
    return (
      <div className="flex flex-col gap-1.5">
        {items.map((item) => {
          const watched = watchIds.has(String(item.id));
          const isKa = item.marketplace === 'kleinanzeigen' || /kleinanzeigen\.de/i.test(item.url || '');
          return (
            <article
              key={item.id}
              className={`flex items-center gap-3 border bg-white px-2 py-1.5 ${
                item.rejected ? 'border-rose-300' : item.isNew ? 'border-emerald-300' : 'border-slate-200'
              }`}
            >
              <div className="w-16 h-16 shrink-0 bg-slate-100 overflow-hidden relative">
                {item.image ? (
                  <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 text-[10px] font-bold">
                    —
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black text-slate-900 tabular-nums">
                    {euros(item.total ?? item.price)}
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {isKa ? 'KA' : 'eBay'}
                  </span>
                  {item.isNew && (
                    <span className="px-1 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase">
                      New
                    </span>
                  )}
                  <ListingFlags item={item} />
                </div>
                <h3 className="text-sm font-bold text-slate-800 truncate">{item.title}</h3>
                <p className="text-[11px] text-slate-500 truncate">
                  {item.condition || '—'}
                  {item.seller ? ` · ${item.seller}` : ''}
                  {item.location ? ` · ${item.location}` : ''}
                </p>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center justify-center gap-1 px-2.5 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider"
              >
                Open <ExternalLink size={12} />
              </a>
              <button
                type="button"
                onClick={() => onToggleWatch(item)}
                className={`shrink-0 px-2.5 py-2 border text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 ${
                  watched
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Star size={12} className={watched ? 'fill-current' : ''} />
                {watched ? 'Watching' : 'Watch'}
              </button>
            </article>
          );
        })}
      </div>
    );
  }

  const compact = view === 'small';
  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2'
          : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3'
      }
    >
      {items.map((item) => {
        const watched = watchIds.has(String(item.id));
        const isKa = item.marketplace === 'kleinanzeigen' || /kleinanzeigen\.de/i.test(item.url || '');
        return (
          <article
            key={item.id}
            className={`border overflow-hidden bg-white flex flex-col ${
              item.rejected
                ? 'border-rose-300'
                : item.isNew
                  ? 'border-emerald-300 ring-1 ring-emerald-100'
                  : 'border-slate-200'
            }`}
          >
            <div className={`${compact ? 'aspect-square' : 'aspect-[16/10]'} bg-slate-100 relative overflow-hidden`}>
              {item.image ? (
                <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs font-bold">
                  No image
                </div>
              )}
              {item.isNew && (
                <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-emerald-600 text-white text-[10px] font-black uppercase">
                  New
                </span>
              )}
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                <ListingFlags item={item} />
              </div>
            </div>
            <div className={`${compact ? 'p-2 gap-1' : 'p-3 gap-2'} flex-1 flex flex-col`}>
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`${compact ? 'text-sm' : 'text-lg'} font-black text-slate-900 tracking-tight`}
                >
                  {euros(item.total ?? item.price)}
                </p>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                  {isKa ? 'KA' : 'eBay'}
                </span>
              </div>
              <h3
                className={`${compact ? 'text-xs line-clamp-2' : 'text-sm line-clamp-2'} font-bold text-slate-800 leading-snug`}
              >
                {item.title}
              </h3>
              {!compact && (
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  {item.condition || '—'}
                  {item.seller ? ` · ${item.seller}` : ''}
                  {item.location ? ` · ${item.location}` : ''}
                </p>
              )}
              <div className={`mt-auto flex items-center gap-1.5 ${compact ? 'pt-0.5' : 'pt-1'}`}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex-1 inline-flex items-center justify-center gap-1 ${
                    compact ? 'px-1.5 py-1.5' : 'px-2.5 py-2'
                  } bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider`}
                >
                  Open {compact ? null : <ExternalLink size={12} />}
                </a>
                <button
                  type="button"
                  title={watched ? 'Watching' : 'Watch'}
                  aria-label={watched ? 'Watching' : 'Watch'}
                  onClick={() => onToggleWatch(item)}
                  className={`${compact ? 'px-1.5 py-1.5' : 'px-2.5 py-2'} border text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 ${
                    watched
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Star size={12} className={watched ? 'fill-current' : ''} />
                  {compact ? null : watched ? 'Watching' : 'Watch'}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function KaList({ records, empty }: { records: DealwatchKaRecord[]; empty: string }) {
  if (!records.length) return <EmptyState text={empty} />;
  return (
    <div className="space-y-2">
      {records.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
          {item.image ? (
            <img src={item.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-slate-100" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-100" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 truncate">{item.displayName || item.title || 'Item'}</p>
            <p className="text-[11px] text-slate-500">{euros(item.price)}{item.period ? ` · ${item.period}` : ''}</p>
          </div>
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default DealwatchWorkspaceCore;
