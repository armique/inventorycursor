import React, { useCallback, useEffect, useMemo, useState, startTransition } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import { loadOrdersForSalesSync, invalidateEbaySalesSyncPeekCache } from '../services/ebaySalesSync';
import { hydrateHubArchiveIndex } from '../services/ebayHubArchiveIndex';
import { useHubArchiveCacheTick } from '../hooks/useHubArchiveCacheTick';
import { bindEbayOrderExact } from '../utils/bindEbayOrderExact';
import {
  blockedEbayBindParentIds,
  buildBindCandidateIndex,
  countOpenEbayOrderLines,
  findItemsForOpenOrderLine,
  isEbayBindCandidate,
} from '../utils/ebayOpenOrders';
import { buildOrderMatcherRows, type OrderMatcherRow } from '../utils/orderMatcherQueue';
import {
  ignoreOrderMatcherKey,
  unignoreOrderMatcherKey,
} from '../utils/orderMatcherIgnored';
import {
  linkIncompatibilityReason,
  orderItemLinkCompatible,
} from '../utils/orderMatcherCompatibility';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import ItemLink from './ItemLink';
import EbayToolSearchInput from './EbayToolSearchInput';

type Props = {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdateItems?: (items: InventoryItem[]) => void;
};

function matchKindLabel(kind: string): string {
  if (kind === 'listingId') return 'Listing';
  if (kind === 'sku') return 'SKU';
  if (kind === 'title') return 'Title';
  return 'Recent';
}

const OrderMatcherTab: React.FC<Props> = ({ items, taxMode, onUpdateItems }) => {
  const cacheTick = useHubArchiveCacheTick();
  const [search, setSearch] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [ignoredTick, setIgnoredTick] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [replaceKey, setReplaceKey] = useState<string | null>(null);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [pickedItemByKey, setPickedItemByKey] = useState<Record<string, InventoryItem>>({});
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoreReady, setScoreReady] = useState(false);
  const [rows, setRows] = useState<OrderMatcherRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);

  const bumpCache = useCallback(() => {
    void hydrateHubArchiveIndex();
  }, []);
  const bumpIgnored = useCallback(() => setIgnoredTick((n) => n + 1), []);

  const orders = useMemo(() => loadOrdersForSalesSync(), [cacheTick]);

  useEffect(() => {
    setScoreReady(false);
    setRowsLoading(true);
    const id = window.requestAnimationFrame(() => setScoreReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [items, orders, ignoredTick]);

  useEffect(() => {
    if (!scoreReady) return;
    let cancelled = false;
    const build = () => {
      if (cancelled) return;
      const built = buildOrderMatcherRows(items, orders, { includeIgnored: showIgnored });
      startTransition(() => {
        if (cancelled) return;
        setRows(built);
        setRowsLoading(false);
      });
    };
    const idleId =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(build, { timeout: 1200 })
        : window.setTimeout(build, 0);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId as number);
      } else {
        window.clearTimeout(idleId as number);
      }
    };
  }, [items, orders, showIgnored, scoreReady, ignoredTick]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesEbayToolSearch(search, [
          row.order.orderId,
          row.order.buyer.username,
          row.order.buyer.fullName,
          row.lineItem.title,
          row.lineItem.sku,
          row.topMatch?.item.name,
        ])
      ),
    [rows, search]
  );

  const bindIndex = useMemo(
    () => (scoreReady ? buildBindCandidateIndex(items) : null),
    [items, scoreReady]
  );

  const bindPool = useMemo(() => {
    const blockedParents = blockedEbayBindParentIds(items);
    return items.filter((item) => isEbayBindCandidate(item, blockedParents));
  }, [items]);

  const replaceHits = useMemo(() => {
    const q = replaceQuery.trim().toLowerCase();
    if (!q || replaceQuery.trim().length < 2) return [] as InventoryItem[];
    return bindPool
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.ebaySku || '').toLowerCase().includes(q) ||
          (item.category || '').toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [bindPool, replaceQuery]);

  const resolveRowItem = useCallback(
    (row: OrderMatcherRow): InventoryItem | null => {
      if (pickedItemByKey[row.key]) return pickedItemByKey[row.key];
      return row.topMatch?.item ?? null;
    },
    [pickedItemByKey]
  );

  const approveRow = useCallback(
    async (
      row: OrderMatcherRow,
      item: InventoryItem,
      options?: { silent?: boolean; workingItems?: InventoryItem[] }
    ): Promise<InventoryItem | null> => {
      if (!onUpdateItems) {
        setError('Inventory updates are not available from the dashboard.');
        return null;
      }
      const title = row.lineItem.title || '';
      const liveItem =
        options?.workingItems?.find((i) => i.id === item.id) ?? items.find((i) => i.id === item.id) ?? item;
      if (!orderItemLinkCompatible(title, liveItem)) {
        setError(linkIncompatibilityReason(title, liveItem) || 'This item cannot be linked to this order.');
        return null;
      }

      if (!options?.silent) setApplyingKey(row.key);
      setError(null);
      try {
        const suggestion = row.compatibleSuggestions.find((s) => s.item.id === liveItem.id);
        const rawSuggestions = bindIndex
          ? findItemsForOpenOrderLine(row.lineItem, row.order, bindIndex, { limit: 12 })
          : [];
        const raw = rawSuggestions.find((s) => s.item.id === liveItem.id);
        const matchScore = suggestion?.matchScore ?? raw?.matchScore ?? 0;
        const matchKind = suggestion?.matchKind ?? raw?.matchKind ?? 'title';

        const result = await bindEbayOrderExact(
          liveItem,
          { order: row.order, lineItem: row.lineItem, matchScore, matchKind },
          taxMode
        );
        if (result.ok === false) {
          setError(result.hint);
          return null;
        }

        onUpdateItems([result.item]);
        invalidateEbaySalesSyncPeekCache();
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });
        setPickedItemByKey((prev) => {
          const next = { ...prev };
          delete next[row.key];
          return next;
        });
        setReplaceKey(null);
        if (!options?.silent) {
          setMessage(`Linked “${liveItem.name}” → sold · order ${row.order.orderId}`);
        }
        bumpCache();
        return result.item;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not link order.');
        return null;
      } finally {
        if (!options?.silent) setApplyingKey(null);
      }
    },
    [onUpdateItems, taxMode, items, bindIndex, bumpCache]
  );

  const bulkApprove = useCallback(async () => {
    const targets = filteredRows.filter((row) => {
      if (!selectedKeys.has(row.key)) return false;
      if (row.ignored) return false;
      return Boolean(resolveRowItem(row));
    });
    if (!targets.length) return;

    setBulkApplying(true);
    setError(null);
    let workingItems = items;
    let ok = 0;
    for (const row of targets) {
      const item = resolveRowItem(row);
      if (!item) continue;
      setApplyingKey(row.key);
      const updated = await approveRow(row, item, { silent: true, workingItems });
      if (!updated) break;
      workingItems = workingItems.map((i) => (i.id === updated.id ? updated : i));
      ok += 1;
    }
    setApplyingKey(null);
    setBulkApplying(false);
    if (ok > 0) setMessage(`Approved ${ok} order link${ok === 1 ? '' : 's'}.`);
    setSelectedKeys(new Set());
  }, [filteredRows, selectedKeys, resolveRowItem, approveRow, items]);

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const eligible = filteredRows.filter((r) => !r.ignored && resolveRowItem(r));
    const allSelected = eligible.every((r) => selectedKeys.has(r.key));
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(eligible.map((r) => r.key)));
    }
  };

  const handleIgnore = (row: OrderMatcherRow) => {
    ignoreOrderMatcherKey(row.key);
    bumpIgnored();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.delete(row.key);
      return next;
    });
    setMessage(`Ignored order ${row.order.orderId} — still available on eBay Orders for manual bind.`);
  };

  const handleUnignore = (row: OrderMatcherRow) => {
    unignoreOrderMatcherKey(row.key);
    bumpIgnored();
    setMessage(`Restored order ${row.order.orderId} to the matcher queue.`);
  };

  const selectableCount = filteredRows.filter((r) => !r.ignored && resolveRowItem(r)).length;
  const selectedCount = filteredRows.filter((r) => selectedKeys.has(r.key) && resolveRowItem(r)).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 px-3 sm:px-4 py-3 border-b border-slate-100 bg-slate-50/80 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold text-slate-600 mr-auto">
            {rows.length} unmatched order line{rows.length === 1 ? '' : 's'}
            {showIgnored ? ' · including ignored' : ''}
            {rowsLoading ? ' · matching…' : ''}
          </p>
          <label className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => setShowIgnored(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show ignored
          </label>
          {selectedCount > 0 && (
            <button
              type="button"
              disabled={bulkApplying || !onUpdateItems}
              onClick={() => void bulkApprove()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {bulkApplying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Approve selected ({selectedCount})
            </button>
          )}
        </div>
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search order, buyer, title, match…"
          matchCount={filteredRows.length}
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
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {orders.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">
            No Seller Hub orders cached yet. Fetch sales from eBay Tools first.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">
            {rowsLoading
              ? 'Matching orders to inventory…'
              : search.trim()
              ? 'No rows match your search.'
              : showIgnored
                ? 'No unmatched orders in the queue.'
                : 'All open orders are linked or ignored. Toggle “Show ignored” or bind manually on eBay Orders.'}
          </div>
        ) : (
          <table className="w-full min-w-[920px] text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
              <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectableCount > 0 && selectedCount === selectableCount}
                    onChange={toggleSelectAll}
                    disabled={selectableCount === 0}
                    className="rounded border-slate-300"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2.5 min-w-[220px]">Order</th>
                <th className="px-3 py-2.5 min-w-[220px]">Suggested item</th>
                <th className="px-3 py-2.5 w-24">Match</th>
                <th className="px-3 py-2.5 w-24 text-right">Payout</th>
                <th className="px-3 py-2.5 w-52 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => {
                const busy = applyingKey === row.key || bulkApplying;
                const picked = pickedItemByKey[row.key];
                const displayItem = resolveRowItem(row);
                const expanded = replaceKey === row.key;
                const canApprove = Boolean(displayItem) && !row.ignored && onUpdateItems;
                const incompatible =
                  displayItem &&
                  !orderItemLinkCompatible(row.lineItem.title || '', displayItem);

                return (
                  <React.Fragment key={row.key}>
                    <tr
                      className={`align-top ${row.ignored ? 'bg-slate-50/80 opacity-75' : 'bg-white hover:bg-slate-50/50'}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(row.key)}
                          disabled={row.ignored || !displayItem || Boolean(incompatible)}
                          onChange={() => toggleSelect(row.key)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="px-3 py-3 min-w-0">
                        <p className="text-[12px] font-black text-slate-900 leading-snug">
                          {row.lineItem.title || 'eBay order'}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                          {row.order.creationDate || '—'} · {row.order.orderId}
                          {row.order.buyer.username ? ` · ${row.order.buyer.username}` : ''}
                        </p>
                        {row.lineItem.sku && (
                          <p className="text-[10px] font-semibold text-slate-400">SKU {row.lineItem.sku}</p>
                        )}
                        {row.ignored && (
                          <span className="inline-flex mt-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800">
                            Ignored
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 min-w-0">
                        {displayItem ? (
                          <div className="flex items-start gap-2 min-w-0">
                            <Package size={14} className="text-slate-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <ItemLink
                                item={displayItem}
                                itemName={displayItem.name}
                                className="text-[12px] font-bold text-slate-900 hover:text-indigo-600 truncate block"
                              />
                              <p className="text-[10px] font-semibold text-slate-500">
                                {displayItem.status} · {displayItem.category || '—'} · EK €
                                {formatEUR(displayItem.buyPrice || 0)}
                              </p>
                              {picked && (
                                <p className="text-[9px] font-black uppercase tracking-wider text-violet-700 mt-0.5">
                                  Manual pick
                                </p>
                              )}
                              {incompatible && (
                                <p className="text-[10px] font-semibold text-rose-600 mt-0.5">
                                  {linkIncompatibilityReason(row.lineItem.title || '', displayItem)}
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] font-semibold text-slate-400">
                            No compatible match — use Replace to pick manually.
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {displayItem && row.topMatch?.item.id === displayItem.id ? (
                          <>
                            <p className="text-[11px] font-black text-slate-800 tabular-nums">
                              {Math.round(row.topMatch.matchScore)}
                            </p>
                            <p className="text-[9px] font-bold uppercase text-slate-400">
                              {matchKindLabel(row.topMatch.matchKind)}
                            </p>
                          </>
                        ) : displayItem ? (
                          <p className="text-[9px] font-bold uppercase text-violet-600">Picked</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <p className="text-[12px] font-black text-slate-900">
                          €{formatEUR(row.payout.buyerTotal ?? row.payout.gross ?? row.payout.sellPrice)}
                        </p>
                        {row.payout.netKnown && row.payout.net != null && (
                          <p className="text-[9px] font-bold text-emerald-700">
                            Net €{formatEUR(row.payout.net)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            disabled={!canApprove || busy || Boolean(incompatible)}
                            onClick={() => displayItem && void approveRow(row, displayItem)}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-600 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-40"
                          >
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setReplaceKey((k) => (k === row.key ? null : row.key));
                              setReplaceQuery('');
                              setError(null);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase tracking-wider text-slate-700 hover:border-slate-400 disabled:opacity-40"
                          >
                            <RefreshCw size={11} />
                            Replace
                          </button>
                          {row.ignored ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleUnignore(row)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[9px] font-black uppercase tracking-wider text-amber-800 disabled:opacity-40"
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleIgnore(row)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase tracking-wider text-slate-500 hover:border-rose-200 hover:text-rose-700 disabled:opacity-40"
                            >
                              <Ban size={11} />
                              Ignore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                              Pick inventory item
                            </p>
                            <div className="relative max-w-md">
                              <Search
                                size={13}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                              />
                              <input
                                value={replaceQuery}
                                onChange={(e) => setReplaceQuery(e.target.value)}
                                placeholder="Type inventory name…"
                                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-slate-400"
                              />
                            </div>
                            {row.compatibleSuggestions.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                  Compatible suggestions
                                </p>
                                {row.compatibleSuggestions.map((s) => (
                                  <button
                                    key={s.item.id}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      setPickedItemByKey((prev) => ({ ...prev, [row.key]: s.item }));
                                      setReplaceKey(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50"
                                  >
                                    <span className="text-[12px] font-bold text-slate-900 truncate flex-1">
                                      {s.item.name}
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-500 shrink-0">
                                      {matchKindLabel(s.matchKind)} · {Math.round(s.matchScore)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {replaceHits.map((item) => {
                              const ok = orderItemLinkCompatible(row.lineItem.title || '', item);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  disabled={busy || !ok}
                                  title={
                                    ok
                                      ? undefined
                                      : linkIncompatibilityReason(row.lineItem.title || '', item) ||
                                        'Incompatible'
                                  }
                                  onClick={() => {
                                    setPickedItemByKey((prev) => ({ ...prev, [row.key]: item }));
                                    setReplaceKey(null);
                                  }}
                                  className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-2 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <span className="block text-[12px] font-bold text-slate-900 truncate">
                                    {item.name}
                                  </span>
                                  <span className="text-[10px] font-semibold text-slate-500">
                                    {item.status} · {item.category}
                                    {!ok && ' · blocked'}
                                  </span>
                                </button>
                              );
                            })}
                            {replaceQuery.trim().length >= 2 && replaceHits.length === 0 && (
                              <p className="text-[11px] font-semibold text-slate-400">No stock matches.</p>
                            )}
                            <button
                              type="button"
                              onClick={() => setReplaceKey(null)}
                              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500"
                            >
                              <X size={12} /> Close
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-slate-100 text-[10px] font-semibold text-slate-500">
          Approve uses the same Seller Hub bind as eBay Orders. Ignored rows stay on eBay Orders for manual overwrite.
          {countOpenEbayOrderLines(items, orders) !== rows.length && (
            <span>
              {' '}
              · {countOpenEbayOrderLines(items, orders)} total open lines in Hub
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderMatcherTab;
