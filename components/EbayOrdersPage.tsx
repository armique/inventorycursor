import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  Package,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import { loadOrdersForSalesSync, invalidateEbaySalesSyncPeekCache } from '../services/ebaySalesSync';
import { hydrateHubArchiveIndex, loadHubArchiveIndex } from '../services/ebayHubArchiveIndex';
import { bindEbayOrderExact } from '../utils/bindEbayOrderExact';
import {
  buildBindCandidateIndex,
  countOpenEbayOrderLines,
  findItemsForOpenOrderLine,
  blockedEbayBindParentIds,
  isEbayBindCandidate,
  listOpenEbayOrderLines,
  type OpenEbayOrderLine,
} from '../utils/ebayOpenOrders';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
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
  const [visibleLimit, setVisibleLimit] = useState(30);
  const [scoreReady, setScoreReady] = useState(false);

  const bumpCache = useCallback(() => setCacheTick((n) => n + 1), []);

  useEffect(() => {
    const onIndex = () => bumpCache();
    window.addEventListener('ebay-order-index-updated', onIndex);
    window.addEventListener('ebay-hub-archive-updated', onIndex);
    void hydrateHubArchiveIndex().then(() => bumpCache());
    return () => {
      window.removeEventListener('ebay-order-index-updated', onIndex);
      window.removeEventListener('ebay-hub-archive-updated', onIndex);
    };
  }, [bumpCache]);

  const orders = useMemo(() => loadOrdersForSalesSync(), [cacheTick]);
  const hubMeta = useMemo(() => loadHubArchiveIndex().meta, [cacheTick]);

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

  const bindPool = useMemo(() => {
    const blockedParents = blockedEbayBindParentIds(items);
    return items.filter((item) => isEbayBindCandidate(item, blockedParents));
  }, [items]);

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
        const result = await bindEbayOrderExact(
          item,
          { order: row.order, lineItem: row.lineItem, matchScore, matchKind },
          taxMode
        );
        if (result.ok === false) {
          setError(result.hint);
          return;
        }
        const next = result.item;
        onUpdate([next]);
        invalidateEbaySalesSyncPeekCache();
        setPickKey(null);
        setPickQuery('');
        setMessage(
          result.source === 'seller_hub'
            ? `Linked “${item.name}” with Seller Hub payout · ads / fees / label stored · order ${row.order.orderId} left the list.`
            : `Linked “${item.name}” → sold · order ${row.order.orderId} left the list.`
        );
        const nextItems = items.map((i) => (i.id === next.id ? next : i));
        const remaining = countOpenEbayOrderLines(nextItems, loadOrdersForSalesSync());
        onBound?.(next, remaining);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not link order.');
      } finally {
        setApplyingKey(null);
      }
    },
    [onUpdate, taxMode, items, onBound]
  );

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
              {hubMeta.updatedAt ? ` · Hub ledger ${hubMeta.updatedAt.slice(0, 10)}` : ''}
            </p>
          </div>
        )}
        {embedded && (
          <p className="text-[11px] text-slate-500 font-semibold mr-auto">
            {rows.length} open order{rows.length === 1 ? '' : 's'} · bind to mark sold
          </p>
        )}
        <Link
          to="/panel/ebay-store-pull"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider"
        >
          Fetch Hub ledger
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
        {orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
            <p className="text-sm font-black text-slate-800">No Seller Hub orders yet</p>
            <p className="text-[12px] text-slate-500 font-semibold mt-1">
              Load the Hub dump or fetch new sales from eBay Tools → Sales sync.
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
                  <p className="text-sm font-black text-slate-900">
                    €{formatEUR(row.payout.buyerTotal ?? row.payout.gross ?? row.payout.sellPrice)}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                    {row.payout.buyerTotal != null || row.payout.gross != null ? 'Käufer' : row.payout.netKnown ? 'Net' : 'Gross'}
                  </p>
                  {row.payout.netKnown && row.payout.net != null && (
                    <p className="text-[9px] font-bold text-emerald-700 tabular-nums">
                      Net €{formatEUR(row.payout.net)}
                    </p>
                  )}
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
