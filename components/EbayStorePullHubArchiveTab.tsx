import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  Bookmark,
  ClipboardPaste,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { InventoryItem, ItemStatus, ItemUpdateOptions, TaxMode } from '../types';
import { parseEbayOrderImportText } from '../services/ebayOrderCsvImport';
import {
  appendHubBreakdownApplyLog,
  loadHubBreakdownApplyLog,
} from '../services/ebayHubBreakdownApplyLog';
import {
  backfillHubTitlesFromOrderIndex,
  clearHubArchiveIndex,
  flushHubArchivePersist,
  getHubArchiveStats,
  getHubIncrementalFromDate,
  hydrateHubArchiveIndex,
  loadHubArchiveIndex,
  upsertHubArchiveOrders,
} from '../services/ebayHubArchiveIndex';
import { fetchNewHubOrdersFromSellerHub, ingestHubBrowserDump, pollHubBrowserIngestInbox, pushHubArchiveToCloud } from '../services/ebayHubArchiveSync';
import { hubFetchBookmarkletHref } from '../utils/hubFetchBookmarklet';
import { parseHubBrowserDump } from '../utils/hubBrowserDump';
import { EBAY_DE_BUSINESS_TX_FEE_FROM, EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout';
import { invalidateEbaySalesSyncPeekCache } from '../services/ebaySalesSync';
import { loadEbayOrderIndex, type EbayOrderRecord } from '../services/ebayOrderIndex';
import { isHubArchiveJson } from '../utils/ebayHubArchiveFile';
import { hubRefundDisplay } from '../utils/ebayOrderFinancial';
import { hubOrderDisplayTitle } from '../utils/ebayHubOrderTitle';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import {
  applyHubPayoutBreakdownToSoldItem,
  buildHubBreakdownReplacePlan,
  hubBreakdownActionDetails,
  hubBreakdownItemsToSave,
  hubOrderIdFromItem,
  pickHubLineForItem,
  type HubBreakdownReplaceRow,
} from '../utils/replaceItemSaleProceedsFromHub';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { lineItemClaimKey } from '../utils/ebayOrderLinkAnalysis';
import HubLedgerOrderList from './HubLedgerOrderList';
import HubSplitApplyModal from './HubSplitApplyModal';
import { getParentContainer, shouldHideContainerChildInList, computeSoldTabMargin } from '../services/financialAggregation';
import ItemLink from './ItemLink';
import EbayHubOrderDetailModal from './EbayHubOrderDetailModal';

function hubApplyWhereabouts(itemId: string, allItems: InventoryItem[]): string {
  const item = allItems.find((i) => i.id === itemId);
  if (!item) return 'not in inventory — check Trash, or Sold with time filter All';
  const parent = getParentContainer(item, allItems);
  if (parent && shouldHideContainerChildInList(item, allItems)) {
    return `nested under ${parent.name}`;
  }
  const when = item.sellDate ? ` · ${item.sellDate}` : '';
  return `${item.status}${when}`;
}

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
  onArchiveUpdated?: () => void;
}

function orderLooksRefunded(order: EbayOrderRecord): boolean {
  return hubRefundDisplay(order).kind !== 'none';
}

const EbayStorePullHubArchiveTab: React.FC<Props> = ({ items, taxMode, onUpdate, onArchiveUpdated }) => {
  const [version, setVersion] = useState(0);
  const [orderSearch, setOrderSearch] = useState('');
  const [browseFilter, setBrowseFilter] = useState<'all' | 'refunded' | 'needs_split'>('all');
  const [dateSort, setDateSort] = useState<'desc' | 'asc'>('desc');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replaceMessage, setReplaceMessage] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [listening, setListening] = useState(false);
  const [applyingOrderId, setApplyingOrderId] = useState<string | null>(null);
  const [previewPlan, setPreviewPlan] = useState<HubBreakdownReplaceRow[] | null>(null);
  const [applyLogTick, setApplyLogTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyLog = useMemo(() => loadHubBreakdownApplyLog(), [applyLogTick]);

  const bumpArchive = () => {
    setVersion((v) => v + 1);
    onArchiveUpdated?.();
  };

  const noteDumpResult = (result: {
    ok: boolean;
    error?: string;
    hint?: string;
    scraped?: number;
    added?: number;
    merged?: number;
    total?: number;
    cloudPushed?: number;
    persistError?: string;
    cloudError?: string;
    listed?: number;
  }) => {
    if (!result.ok) {
      setError([result.error, result.hint].filter(Boolean).join(' — ') || 'Hub ingest failed.');
      return;
    }
    bumpArchive();
    const persistNote = result.persistError ? ` Browser save failed: ${result.persistError}.` : '';
    const cloudNote = result.cloudError ? ` Firebase: ${result.cloudError}.` : '';
    setMessage(
      `Hub dump · ${result.scraped ?? 0} readable order(s) · ${result.added ?? 0} new, ${result.merged ?? 0} updated · ledger ${result.total ?? 0}${result.cloudPushed ? ` · Firebase +${result.cloudPushed}` : ''}.${persistNote}${cloudNote}`
    );
  };

  const ingestDumpText = async (text: string) => {
    setError(null);
    setMessage(null);
    const dump = parseHubBrowserDump(text);
    if (!dump) {
      setError('Clipboard / paste was not a Hub browser dump. Click the bookmarklet on Seller Hub first.');
      return;
    }
    setFetching(true);
    try {
      noteDumpResult(await ingestHubBrowserDump(dump));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Hub ingest failed.');
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const onUpdated = () => {
      if (cancelled) return;
      setVersion((v) => v + 1);
      onArchiveUpdated?.();
    };
    window.addEventListener('ebay-hub-archive-updated', onUpdated);
    void hydrateHubArchiveIndex()
      .then(async () => {
        const filled = backfillHubTitlesFromOrderIndex();
        if (filled.filled) await flushHubArchivePersist();
      })
      .then(() => {
        if (!cancelled) onUpdated();
      });
    return () => {
      cancelled = true;
      window.removeEventListener('ebay-hub-archive-updated', onUpdated);
    };
  }, [onArchiveUpdated]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; dump?: unknown } | null;
      if (!data || data.type !== 'DEINVENTORY_HUB_BROWSER_DUMP' || !data.dump) return;
      setListening(false);
      setError(null);
      setFetching(true);
      void ingestHubBrowserDump(data.dump)
        .then(noteDumpResult)
        .finally(() => setFetching(false));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!listening) return;
    let cancelled = false;
    const tick = async () => {
      const result = await pollHubBrowserIngestInbox();
      if (cancelled || !result) return;
      setListening(false);
      noteDumpResult(result);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    const stop = window.setTimeout(() => setListening(false), 180000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [listening]);

  const stats = useMemo(() => getHubArchiveStats(), [version]);
  const meta = useMemo(() => loadHubArchiveIndex().meta, [version]);

  const orders = useMemo(() => loadHubArchiveIndex().orders, [version]);
  const apiOrders = useMemo(() => loadEbayOrderIndex().orders, [version]);

  const feeSplit = useMemo(() => {
    let adsOnly = 0;
    let withSaleFees = 0;
    for (const o of orders) {
      if (o.creationDate && o.creationDate >= EBAY_DE_BUSINESS_TX_FEE_FROM) withSaleFees += 1;
      else adsOnly += 1;
    }
    return { adsOnly, withSaleFees };
  }, [orders]);

  const refundedOrders = useMemo(() => orders.filter(orderLooksRefunded), [orders]);

  const replacePlan = useMemo(
    () => (orders.length ? buildHubBreakdownReplacePlan(items, orders, taxMode) : []),
    [items, orders, taxMode]
  );

  const replaceByOrderId = useMemo(() => {
    const map = new Map<string, HubBreakdownReplaceRow[]>();
    for (const row of replacePlan) {
      const list = map.get(row.orderId);
      if (list) list.push(row);
      else map.set(row.orderId, [row]);
    }
    return map;
  }, [replacePlan]);

  const linkedByOrderId = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const id = hubOrderIdFromItem(item);
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(item);
      else map.set(id, [item]);
    }
    return map;
  }, [items]);

  const visible = useMemo(() => {
    const filtered = orders.filter((o) => {
      if (browseFilter === 'refunded' && !orderLooksRefunded(o)) return false;
      if (browseFilter === 'needs_split' && !replaceByOrderId.has(o.orderId)) return false;
      return matchesEbayToolSearch(orderSearch, [
        o.orderId,
        o.buyer.username,
        o.buyer.fullName,
        o.lineItems.map((li) => li.title).join(' '),
        hubOrderDisplayTitle(o, items, apiOrders).title,
        o.cancelState,
        o.orderPaymentStatus,
      ]);
    });
    const dir = dateSort === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => dir * (a.creationDate || '').localeCompare(b.creationDate || ''));
  }, [orders, orderSearch, browseFilter, dateSort, items, apiOrders, replaceByOrderId]);

  const openOrder = useMemo(
    () => (openOrderId ? orders.find((o) => o.orderId === openOrderId) ?? null : null),
    [orders, openOrderId]
  );

  const applyBreakdowns = (plan: HubBreakdownReplaceRow[]) => {
    if (!plan.length) return;
    const detailsByItemId: Record<string, string> = {};
    for (const row of plan) detailsByItemId[row.itemId] = hubBreakdownActionDetails(row);
    const toSave = hubBreakdownItemsToSave(plan).map((item) => ({
      ...item,
      profit: computeSoldTabMargin(item),
    }));
    onUpdate(toSave, undefined, {
      skipMembershipSync: true,
      skipContainerSync: true,
      flushCloud: true,
      actionNote: { action: 'Hub fee split approved', detailsByItemId },
    });
    appendHubBreakdownApplyLog(
      plan.map((row) => ({
        at: new Date().toISOString(),
        itemId: row.itemId,
        itemName: row.itemName,
        orderId: row.orderId,
        sellDate: row.nextItem.sellDate,
        total: row.after.total,
        net: row.after.net,
      }))
    );
    setApplyLogTick((n) => n + 1);
    invalidateEbaySalesSyncPeekCache();
    if (plan.length === 1) {
      const row = plan[0];
      setReplaceMessage(
        `Saved ${row.itemName} · ${hubApplyWhereabouts(row.itemId, items)} · ${row.orderId}. It leaves this queue because the split now matches Hub — open the item or Action History.`
      );
    } else {
      setReplaceMessage(
        `Saved ${plan.length} Hub split(s). They leave this queue once they match Hub — see Applied below and Action History.`
      );
    }
  };

  const applyAllBreakdowns = () => {
    if (!replacePlan.length) return;
    setPreviewPlan(replacePlan);
  };

  const confirmPreviewPlan = (plan: HubBreakdownReplaceRow[]) => {
    setApplyingOrderId(plan[0]?.orderId ?? null);
    try {
      applyBreakdowns(plan);
      setPreviewPlan(null);
    } finally {
      setApplyingOrderId(null);
    }
  };

  const applyHubLink = (order: EbayOrderRecord, item: InventoryItem) => {
    const line = pickHubLineForItem(order, item);
    setApplyingOrderId(order.orderId);
    try {
      let next = item;
      if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) {
        next = applyEbayOrderMatchToItem(
          item,
          { order, lineItem: line, matchScore: 900, matchKind: 'title' },
          taxMode
        );
      } else {
        next = {
          ...item,
          ebayOrderId: order.orderId,
          ebayOrderLineKey: lineItemClaimKey(order.orderId, line),
        };
      }
      next = applyHubPayoutBreakdownToSoldItem(next, order, line, taxMode);
      onUpdate([next], undefined, {
        skipMembershipSync: true,
        skipContainerSync: true,
        flushCloud: true,
        actionNote: {
          action: 'Hub fee split approved',
          detailsByItemId: { [next.id]: `${order.orderId} · Hub split linked` },
        },
      });
      appendHubBreakdownApplyLog([
        {
          at: new Date().toISOString(),
          itemId: next.id,
          itemName: next.name,
          orderId: order.orderId,
          sellDate: next.sellDate,
          total: next.saleProceeds?.buyerTotalEur ?? next.sellPrice,
          net: next.saleProceeds?.netPayoutEur ?? null,
        },
      ]);
      setApplyLogTick((n) => n + 1);
      invalidateEbaySalesSyncPeekCache();
      setReplaceMessage(`Linked Hub split to ${next.name} · ${order.orderId}.`);
    } finally {
      setApplyingOrderId(null);
    }
  };

  const importFile = async (file: File) => {
    setFileName(file.name);
    setError(null);
    setMessage(null);
    setParsing(true);
    try {
      await hydrateHubArchiveIndex();
      const text = await file.text();
      const result = parseEbayOrderImportText(text);
      if (!result.orders.length) {
        setError('No orders could be parsed from this file.');
        return;
      }
      if (!isHubArchiveJson(text) && !result.orders.some((o) => o.sources.includes('hub'))) {
        setError(
          'This looks like an API/CSV mix, not the Seller Hub dump. Use the Hub archive JSON (data/ebay-orders or Desktop/ebay-order-archive).'
        );
        return;
      }
      invalidateEbaySalesSyncPeekCache();
      const upsert = upsertHubArchiveOrders(result.orders, { fileName: file.name });
      backfillHubTitlesFromOrderIndex();
      const persist = await flushHubArchivePersist();
      if (!persist.ok) {
        setError(
          `Ledger is in memory only (${persist.error || 'this browser did not save the dump'}). It will vanish on refresh — keep the JSON file.`
        );
        bumpArchive();
        return;
      }
      const cloud = await pushHubArchiveToCloud(upsert.changed);
      const localNote = persist.via === 'idb' ? 'Saved in this browser (IndexedDB).' : 'Saved in this browser.';
      const cloudNote =
        cloud.ok && cloud.pushed
          ? ` Firebase +${cloud.pushed} new/changed order(s).`
          : /not signed in/i.test(cloud.error || '')
            ? ' Sign in to also keep a Firebase copy.'
            : cloud.skipped
              ? ''
              : ` Firebase: ${cloud.error || 'not saved'}.`;
      setMessage(
        `Merged ${upsert.added} new Hub order(s), updated ${upsert.merged} · ledger ${upsert.total}. ${localNote}${cloudNote}`
      );
      bumpArchive();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to read file.');
    } finally {
      setParsing(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear the Hub fee archive in this browser? Firebase keeps the ledger if you signed in — it will reload on the next visit.')) return;
    clearHubArchiveIndex();
    await flushHubArchivePersist();
    invalidateEbaySalesSyncPeekCache();
    setMessage(null);
    bumpArchive();
  };

  const sinceDate = getHubIncrementalFromDate();

  const fetchNew = async () => {
    setFetching(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fetchNewHubOrdersFromSellerHub({ fromDate: sinceDate });
      if (!result.ok) {
        setError([result.error, result.hint].filter(Boolean).join(' — ') || 'Hub fetch failed.');
        return;
      }
      bumpArchive();
      const persistNote = result.persistError ? ` Browser save failed: ${result.persistError}.` : '';
      const cloudNote = result.cloudError ? ` Firebase: ${result.cloudError}.` : '';
      if (result.scraped) {
        setMessage(
          `Fetched ${result.scraped} Hub order(s) ${result.fromDate} → ${result.toDate} · ${result.added} new, ${result.merged} updated · ledger ${result.total}${result.cloudPushed ? ` · Firebase +${result.cloudPushed}` : ''}.${persistNote}${cloudNote}`
        );
      } else {
        setMessage(
          `No new Hub sales since ${result.fromDate}. Recent list had ${result.listed ?? 0} order(s) already in the ledger.${persistNote}${cloudNote}`
        );
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Hub fetch failed.');
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="shrink-0 px-3 py-2 space-y-2 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-orange-100 text-orange-800 shrink-0">
              <Database size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black text-slate-900">Hub ledger</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Seller Hub source of truth — buyer total, ads, eBay fee, label, net. Link the split onto inventory from each row.
                {sinceDate ? ` History from ${sinceDate}.` : ''}
                {meta.fileName ? ` Loaded from ${meta.fileName}.` : ''}
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={hubFetchBookmarkletHref()}
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-900 text-[10px] font-black uppercase tracking-widest"
              title="Drag this onto your bookmarks bar"
            >
              <Bookmark size={14} />
              Fetch Hub → Inventory Pro
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(hubFetchBookmarkletHref());
                  setMessage('Bookmarklet URL copied. Create a bookmark and paste it as the URL, or drag Fetch Hub onto the bookmarks bar.');
                } catch {
                  setError('Could not copy. Drag Fetch Hub onto your bookmarks bar instead.');
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-orange-700"
            >
              Copy bookmarklet
            </button>
            <button
              type="button"
              onClick={async () => {
                setListening(true);
                setError(null);
                setMessage('Waiting for the bookmarklet… keep this tab open, then click Fetch Hub in your eBay browser.');
                try {
                  const text = await navigator.clipboard.readText();
                  if (parseHubBrowserDump(text)) {
                    setListening(false);
                    await ingestDumpText(text);
                  }
                } catch {
                  /* permission — user can paste */
                }
              }}
              disabled={parsing || fetching}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
            >
              {listening || fetching ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPaste size={14} />}
              {listening ? 'Waiting…' : fetching ? 'Merging…' : 'Paste dump'}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || fetching}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
            >
              {parsing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {parsing ? 'Reading…' : 'Load JSON'}
            </button>
            {fileName && <span className="text-xs font-bold text-slate-600">{fileName}</span>}
          </div>
          <p className="text-[11px] text-slate-500">
            Once a day:{' '}
            <a href={EBAY_SELLER_HUB_ORDERS_URL} target="_blank" rel="noreferrer" className="font-bold text-orange-900 underline">
              Seller Hub → All orders
            </a>
            , click the bookmark while logged in, then paste here if it does not merge automatically.
          </p>
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer font-bold text-slate-600">Paste dump JSON · debug Chrome</summary>
            <div className="mt-2 space-y-2">
              <textarea
                className="w-full min-h-[3rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-700 outline-none focus:border-orange-400 focus:bg-white"
                placeholder="Paste the Hub dump JSON here…"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (parseHubBrowserDump(text)) {
                    e.preventDefault();
                    void ingestDumpText(text);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void fetchNew()}
                disabled={parsing || fetching}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50"
              >
                {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {fetching ? 'Fetching Hub…' : `CDP fetch since ${sinceDate}`}
              </button>
            </div>
          </details>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          {message && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              {message}
            </div>
          )}
          {replaceMessage && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              {replaceMessage}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all' as const, label: `All ${stats.count}` },
              { id: 'needs_split' as const, label: `Needs split ${replacePlan.length}` },
              { id: 'refunded' as const, label: `Refunded ${refundedOrders.length}` },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setBrowseFilter(s.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border ${
                  browseFilter === s.id
                    ? s.id === 'refunded'
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : s.id === 'needs_split'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-orange-50 border-orange-300 text-orange-900'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
            <span className="px-2 py-1.5 text-[10px] font-bold text-slate-400 tabular-nums">
              {stats.oldestDate && stats.newestDate ? `${stats.oldestDate} → ${stats.newestDate}` : '—'}
              {` · ads ${feeSplit.adsOnly} · fees ${feeSplit.withSaleFees}`}
            </span>
            <button
              type="button"
              disabled={!replacePlan.length}
              onClick={applyAllBreakdowns}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
            >
              <RefreshCw size={12} />
              {replacePlan.length ? `Approve all ${replacePlan.length}` : 'Nothing to replace'}
            </button>
          </div>
          <input
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Search order ID, buyer, item…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          {applyLog.length > 0 && (
            <details className="rounded-lg border border-slate-200 overflow-hidden">
              <summary className="px-2 py-1 bg-slate-50 text-[9px] font-black uppercase tracking-wider text-slate-400 cursor-pointer">
                Applied · {applyLog.length}
              </summary>
              <div className="max-h-36 overflow-auto divide-y divide-slate-100">
                {applyLog.slice(0, 20).map((row) => (
                  <div
                    key={`${row.itemId}-${row.orderId}-${row.at}`}
                    className="grid grid-cols-[minmax(0,1.4fr)_auto_auto] gap-2 items-center px-2 py-1"
                  >
                    <div className="min-w-0">
                      <ItemLink
                        itemId={row.itemId}
                        itemName={row.itemName}
                        items={items}
                        className="text-[12px] font-bold text-slate-900 hover:text-indigo-600 hover:underline truncate block"
                      />
                      <p className="text-[10px] font-mono text-slate-500 truncate">
                        {row.orderId}
                        {row.sellDate ? ` · sold ${row.sellDate}` : ''}
                        {' · '}
                        {hubApplyWhereabouts(row.itemId, items)}
                      </p>
                    </div>
                    <span className="text-[11px] tabular-nums text-slate-600">
                      {row.total != null ? `€${formatEUR(row.total)}` : '—'}
                    </span>
                    <span className="text-[11px] tabular-nums text-emerald-800 font-bold">
                      {row.net != null ? `net €${formatEUR(row.net)}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
        <HubLedgerOrderList
          orders={visible}
          items={items}
          apiOrders={apiOrders}
          replaceByOrderId={replaceByOrderId}
          linkedByOrderId={linkedByOrderId}
          applyingOrderId={applyingOrderId}
          dateSort={dateSort}
          emptyMessage={
            stats.count === 0
              ? 'Load ebay-order-archive.json or fetch Hub orders.'
              : browseFilter === 'refunded'
                ? 'No refunded orders match.'
                : browseFilter === 'needs_split'
                  ? 'No orders need a Hub split.'
                  : 'No orders match.'
          }
          onToggleDateSort={() => setDateSort((d) => (d === 'desc' ? 'asc' : 'desc'))}
          onOpenOrder={setOpenOrderId}
          onApplyPending={setPreviewPlan}
          onLinkItem={applyHubLink}
        />
      </div>
      <div className="shrink-0 mt-2 rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <FileSpreadsheet size={14} />
          Stored in this browser. New sales append to this ledger with the same Hub split.
        </p>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase text-red-600 hover:bg-red-50"
        >
          <Trash2 size={12} />
          Clear Hub archive
        </button>
      </div>
      {previewPlan && previewPlan.length > 0 && (
        <HubSplitApplyModal
          rows={previewPlan}
          applying={applyingOrderId != null}
          onClose={() => {
            if (applyingOrderId == null) setPreviewPlan(null);
          }}
          onConfirm={confirmPreviewPlan}
        />
      )}
      {openOrder && (
        <EbayHubOrderDetailModal
          order={openOrder}
          items={items}
          apiOrders={apiOrders}
          onClose={() => setOpenOrderId(null)}
        />
      )}
    </div>
  );
};

export default EbayStorePullHubArchiveTab;
