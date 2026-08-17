import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import { hasEbayToken } from '../services/ebayService';
import { isCloudEnabled } from '../services/firebaseService';
import { loadEbayOrderIndex, pullOrderIndexFromCloud } from '../services/ebayOrderIndex';
import { invalidateEbaySalesSyncPeekCache, runEbaySalesSync } from '../services/ebaySalesSync';
import type { BackfillProgress } from '../services/ebayOrderBackfill';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import {
  buildBindCandidateIndex,
  countOpenEbayOrderLines,
  findItemsForOpenOrderLine,
  isEbayBindCandidate,
  listOpenEbayOrderLines,
  type OpenEbayOrderLine,
} from '../utils/ebayOpenOrders';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import EbayToolProgressBar from './EbayToolProgressBar';
import EbayToolSearchInput from './EbayToolSearchInput';

type Props = {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
  /** Compact chrome when hosted inside a modal. */
  embedded?: boolean;
  /** Fired after a successful bind. `remainingOpen` is open order lines left. */
  onBound?: (updated: InventoryItem, remainingOpen: number) => void;
};

function matchKindLabel(kind: OpenEbayOrderLine['suggestions'][number]['matchKind']): string {
  if (kind === 'listingId') return 'Listing';
  if (kind === 'sku') return 'SKU';
  if (kind === 'title') return 'Title';
  return 'Recent';
}

const EbayOrdersPage: React.FC<Props> = ({ items, taxMode, onUpdate, embedded = false, onBound }) => {
  const [cacheTick, setCacheTick] = useState(0);
  const [search, setSearch] = useState('');
  const [pickKey, setPickKey] = useState<string | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<BackfillProgress | null>(null);
  const [tokenReady, setTokenReady] = useState(() => hasEbayToken());
  const cancelRef = useRef({ cancelled: false });

  const [visibleLimit, setVisibleLimit] = useState(30);
  const [scoreReady, setScoreReady] = useState(false);

  const bumpCache = useCallback(() => setCacheTick((n) => n + 1), []);

  useEffect(() => {
    const refresh = () => setTokenReady(hasEbayToken());
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('ebay-config-updated', refresh);
    const onIndex = () => bumpCache();
    window.addEventListener('ebay-order-index-updated', onIndex);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ebay-config-updated', refresh);
      window.removeEventListener('ebay-order-index-updated', onIndex);
    };
  }, [bumpCache]);

  useEffect(() => {
    if (!isCloudEnabled() || loadEbayOrderIndex().orders.length > 0) return;
    let cancelled = false;
    void pullOrderIndexFromCloud().then((result) => {
      if (cancelled || result.error || result.skipped || !result.pulled) return;
      bumpCache();
    });
    return () => {
      cancelled = true;
    };
  }, [bumpCache]);

  const { orders, meta } = useMemo(() => loadEbayOrderIndex(), [cacheTick]);

  const rows = useMemo(() => listOpenEbayOrderLines(items, orders), [items, orders]);
  const bindIndex = useMemo(
    () => (scoreReady ? buildBindCandidateIndex(items) : null),
    [items, scoreReady]
  );

  useEffect(() => {
    setScoreReady(false);
    const id = window.requestAnimationFrame(() => setScoreReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [items, orders]);

  useEffect(() => {
    setVisibleLimit(30);
  }, [search]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesEbayToolSearch(search, [
          row.order.orderId,
          row.order.buyer.username,
          row.order.buyer.fullName,
          row.lineItem.title,
          row.lineItem.sku,
        ])
      ),
    [rows, search]
  );
  const filteredCount = filteredRows.length;
  const visible = useMemo(
    () =>
      filteredRows.slice(0, visibleLimit).map((row) => ({
        ...row,
        suggestions: bindIndex
          ? findItemsForOpenOrderLine(row.lineItem, row.order, bindIndex)
          : [],
      })),
    [filteredRows, visibleLimit, bindIndex]
  );

  const bindPool = useMemo(() => items.filter(isEbayBindCandidate), [items]);

  const pickHits = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q || pickQuery.trim().length < 2) return [] as InventoryItem[];
    return bindPool
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.ebaySku || '').toLowerCase().includes(q) ||
          (item.category || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [bindPool, pickQuery]);

  const bindItem = useCallback(
    async (row: OpenEbayOrderLine, item: InventoryItem) => {
      setApplyingKey(row.key);
      setError(null);
      try {
        const { matchScore, matchKind } = row.suggestions.find((s) => s.item.id === item.id) || {
          matchScore: 0,
          matchKind: 'title' as const,
        };
        const next = applyEbayOrderMatchToItem(
          item,
          { order: row.order, lineItem: row.lineItem, matchScore, matchKind },
          taxMode
        );
        onUpdate([next]);
        invalidateEbaySalesSyncPeekCache();
        setPickKey(null);
        setPickQuery('');
        setMessage(`Linked “${item.name}” → sold · order ${row.order.orderId} left the list.`);
        const nextItems = items.map((i) => (i.id === next.id ? next : i));
        const remaining = countOpenEbayOrderLines(nextItems, loadEbayOrderIndex().orders);
        onBound?.(next, remaining);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not link order.');
      } finally {
        setApplyingKey(null);
      }
    },
    [onUpdate, taxMode, items, onBound]
  );

  const syncOrders = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    setFetchProgress(null);
    cancelRef.current = { cancelled: false };
    try {
      const result = await runEbaySalesSync(items, {
        skipFetch: !hasEbayToken(),
        onFetchProgress: setFetchProgress,
        cancelToken: cancelRef.current,
      });
      bumpCache();
      if (result.fetch?.error) {
        setError(result.fetch.error);
        return;
      }
      if (result.fetch && !result.fetch.error && !result.fetch.cancelled) {
        setMessage(
          `Fetched ${result.fetch.ordersFetched} · ${result.fetch.added} new, ${result.fetch.merged} updated.`
        );
      } else if (result.fetchSkippedReason) {
        setMessage(result.fetchSkippedReason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
      window.setTimeout(() => setFetchProgress(null), 800);
    }
  }, [items, bumpCache]);

  return (
    <div className={`${embedded ? 'h-full' : 'flex-1 min-h-0'} flex flex-col overflow-hidden bg-slate-50`}>
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-2">
        {!embedded && (
          <div className="min-w-0 mr-auto">
            <h1 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <ShoppingCart size={16} /> eBay Orders
            </h1>
            <p className="text-[11px] text-slate-500 font-semibold">
              {rows.length} open · bind a stock item to mark it sold and drop the order
              {meta.apiBackfill?.completedThroughDate
                ? ` · cache through ${meta.apiBackfill.completedThroughDate}`
                : ''}
            </p>
          </div>
        )}
        {embedded && (
          <p className="text-[11px] text-slate-500 font-semibold mr-auto">
            {rows.length} open order{rows.length === 1 ? '' : 's'} · bind to mark sold
          </p>
        )}
        <button
          type="button"
          disabled={syncing}
          onClick={() => void syncOrders()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {tokenReady ? 'Sync eBay' : 'Refresh cache'}
        </button>
        <Link
          to="/panel/ebay-store-pull?tab=orders"
          className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
        >
          Cache setup
        </Link>
      </div>

      <div className="shrink-0 px-4 py-2 border-b border-slate-100 bg-white space-y-2">
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search order, buyer, title, SKU…"
          matchCount={filteredCount}
          totalCount={rows.length}
        />
        {fetchProgress && (
          <EbayToolProgressBar
            label={`Fetching orders (chunk ${fetchProgress.chunkIndex + 1}/${fetchProgress.chunkCount})`}
            done={fetchProgress.chunkIndex + 1}
            total={fetchProgress.chunkCount}
            detail={`${fetchProgress.rangeLabel} · ${fetchProgress.ordersFetchedTotal} total`}
          />
        )}
        {message && (
          <p className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
            {message}
          </p>
        )}
        {error && (
          <p className="text-[11px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
            {error}
          </p>
        )}
        {!tokenReady && (
          <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            No eBay token — showing cached orders. Add OAuth in Settings, or import CSV under Cache setup.
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
            <p className="text-sm font-black text-slate-800">No eBay orders in cache yet</p>
            <p className="text-[12px] text-slate-500 font-semibold mt-1">
              Sync from eBay or import a Seller Hub CSV in Cache setup.
            </p>
          </div>
        )}
        {orders.length > 0 && visible.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
            <p className="text-sm font-black text-slate-800">
              {search.trim() ? 'No orders match that search' : 'All cached orders are already linked'}
            </p>
            <p className="text-[12px] text-slate-500 font-semibold mt-1">
              Linked sales stay in Sold inventory and leave this list.
            </p>
          </div>
        )}

        {visible.map((row) => {
          const busy = applyingKey === row.key;
          return (
            <article
              key={row.key}
              className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2.5"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-black text-slate-900 leading-snug">
                    {row.lineItem.title || 'eBay order'}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                    {row.order.creationDate || '—'} · {row.order.orderId}
                    {row.order.buyer.username ? ` · ${row.order.buyer.username}` : ''}
                    {row.lineItem.sku ? ` · SKU ${row.lineItem.sku}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-900">€{formatEUR(row.payout.sellPrice)}</p>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                    {row.payout.netKnown ? 'Net' : 'Gross'}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  Suggested inventory
                </p>
                {row.suggestions.length === 0 ? (
                  <p className="text-[11px] font-semibold text-slate-400">
                    {bindIndex
                      ? 'No close title/SKU match — search stock below.'
                      : 'Matching inventory…'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {row.suggestions.map((s) => (
                      <button
                        key={s.item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void bindItem(row, s.item)}
                        className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50 px-2.5 py-2 text-left disabled:opacity-50"
                      >
                        <Package size={14} className="text-slate-400 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-bold text-slate-900 truncate">
                            {s.item.name}
                          </span>
                          <span className="block text-[10px] font-semibold text-slate-500">
                            {matchKindLabel(s.matchKind)} · {s.item.status} · EK €
                            {formatEUR(s.item.buyPrice || 0)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          Bind · sold
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setPickKey((k) => (k === row.key ? null : row.key));
                    setPickQuery('');
                  }}
                  className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
                >
                  {pickKey === row.key ? 'Hide search' : 'Pick another item'}
                </button>
                {pickKey === row.key && (
                  <div className="mt-1.5 space-y-1.5">
                    <div className="relative">
                      <Search
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={pickQuery}
                        onChange={(e) => setPickQuery(e.target.value)}
                        placeholder="Type inventory name…"
                        className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-slate-400"
                      />
                    </div>
                    {pickHits.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void bindItem(row, item)}
                        className="w-full text-left rounded-xl border border-slate-200 px-2.5 py-2 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <span className="block text-[12px] font-bold text-slate-900 truncate">
                          {item.name}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">
                          {item.status} · {item.category}
                        </span>
                      </button>
                    ))}
                    {pickQuery.trim().length >= 2 && pickHits.length === 0 && (
                      <p className="text-[11px] font-semibold text-slate-400">No in-stock matches.</p>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {filteredCount > visible.length && (
          <button
            type="button"
            onClick={() => setVisibleLimit((n) => n + 30)}
            className="w-full py-2.5 rounded-2xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-wider text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            Show more ({visible.length} / {filteredCount})
          </button>
        )}
      </div>
    </div>
  );
};

export default EbayOrdersPage;
