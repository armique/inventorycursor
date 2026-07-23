/**
 * Purchases tab logic + UI pieces for embedding in InventoryList shells.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { hasEbayToken } from '../services/ebayService';
import {
  getSuggestedPurchaseFetchRange,
  loadEbayPurchaseIndex,
  pullPurchaseIndexFromCloud,
  setPurchaseDisposition,
  type EbayPurchaseRecord,
} from '../services/ebayPurchaseIndex';
import { syncNewEbayPurchases } from '../services/ebayPurchaseBackfill';
import {
  createInventoryFromPurchase,
  parseAndSavePurchaseSpecs,
  purchaseHasParsedSpecs,
  purchaseToPreviewItem,
} from '../utils/ebayPurchaseToInventory';
import { formatEUR } from '../utils/formatMoney';
import { formatPlatformBoughtLabel } from '../utils/purchaseSource';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import ItemThumbnail from './ItemThumbnail';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';

export type PurchaseViewFilter = 'pending' | 'received' | 'all';

export type UseInventoryPurchasesArgs = {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onOpenItem?: (id: string) => void;
  searchTerm?: string;
};

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function useInventoryPurchases({
  items,
  categories,
  categoryFields,
  onUpdate,
  onOpenItem,
  searchTerm = '',
}: UseInventoryPurchasesArgs) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const purchases = useMemo(() => loadEbayPurchaseIndex().purchases, [version]);
  const [filter, setFilter] = useState<PurchaseViewFilter>('pending');
  const [receivingKey, setReceivingKey] = useState<string | null>(null);
  const [parsingKey, setParsingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<EbayToolProgress | null>(null);
  const [tokenReady] = useState(() => hasEbayToken());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loadEbayPurchaseIndex().purchases.length > 0) return;
      await pullPurchaseIndexFromCloud();
      if (!cancelled) refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const pending = useMemo(
    () => purchases.filter((p) => p.disposition === 'pending'),
    [purchases]
  );
  const received = useMemo(
    () => purchases.filter((p) => p.disposition === 'inventory' && p.inventoryItemId),
    [purchases]
  );

  const rows = useMemo(() => {
    let list =
      filter === 'pending' ? pending : filter === 'received' ? received : purchases;
    const q = searchTerm.trim();
    if (q) {
      list = list.filter((p) =>
        matchesEbayToolSearch(q, [
          p.title,
          p.inventoryDraft?.name,
          p.orderId,
          p.sellerUsername,
          p.itemId,
          p.lineKey,
          p.disposition,
          p.inventoryDraft?.category,
          p.inventoryDraft?.subCategory,
        ])
      );
    }
    return [...list].sort((a, b) => (b.creationDate || '').localeCompare(a.creationDate || ''));
  }, [filter, pending, received, purchases, searchTerm]);

  const syncNew = async () => {
    if (!tokenReady) {
      setError('Add an eBay OAuth token in Settings to sync purchases.');
      return;
    }
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncNewEbayPurchases(
        (p) =>
          setSyncProgress({
            label: 'Syncing new purchases…',
            done: p.chunkIndex + 1,
            total: p.chunkCount,
            detail: `${p.rangeLabel} · ${p.fetchedTotal} lines`,
          }),
        () => false
      );
      if (result.error) setError(result.error);
      else {
        setMessage(
          `Synced ${result.from} → ${result.to}: ${result.added} new · ${result.merged} updated`
        );
      }
      refresh();
    } catch (e) {
      setError((e as Error)?.message || 'Purchase sync failed.');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncProgress(null), 800);
    }
  };

  const parseSpecs = async (p: EbayPurchaseRecord) => {
    if (p.disposition !== 'pending') return;
    setParsingKey(p.lineKey);
    setError(null);
    setMessage(null);
    try {
      const { draft } = await parseAndSavePurchaseSpecs(p, categories, categoryFields);
      refresh();
      const specCount = Object.keys(draft.specs || {}).length;
      setMessage(
        `Parsed “${draft.name}” · ${draft.category}${
          draft.subCategory ? ` / ${draft.subCategory}` : ''
        } · ${specCount} spec${specCount === 1 ? '' : 's'}${
          draft.enrichError ? ` · ${draft.enrichError}` : ''
        }`
      );
    } catch (e) {
      setError((e as Error)?.message || 'Failed to parse specs.');
    } finally {
      setParsingKey(null);
    }
  };

  const confirmReceived = async (p: EbayPurchaseRecord) => {
    if (p.disposition === 'inventory' && p.inventoryItemId) {
      setError('Already added to inventory.');
      return;
    }
    if (p.disposition !== 'pending') {
      setError('Only pending purchases can be confirmed as received.');
      return;
    }
    setReceivingKey(p.lineKey);
    setError(null);
    setMessage(null);
    try {
      const fresh = loadEbayPurchaseIndex().purchases.find((x) => x.lineKey === p.lineKey) || p;
      const { item, draft } = await createInventoryFromPurchase(fresh, categories, categoryFields, {
        parseSpecs: !purchaseHasParsedSpecs(fresh),
        itemId: `item-${Date.now()}-ebay-buy`,
        receiveDate: todayISO(),
      });
      onUpdate([item]);
      setPurchaseDisposition(p.lineKey, 'inventory', {
        inventoryItemId: item.id,
        note: draft.enrichError || undefined,
      });
      refresh();
      const specCount = Object.keys(item.specs || {}).length;
      setMessage(
        `Received → Active: ${item.name} · €${formatEUR(item.buyPrice)} · ${specCount} spec${
          specCount === 1 ? '' : 's'
        }`
      );
      onOpenItem?.(item.id);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to add purchase to inventory.');
    } finally {
      setReceivingKey(null);
    }
  };

  const linkedItem = (p: EbayPurchaseRecord) =>
    p.inventoryItemId ? items.find((i) => i.id === p.inventoryItemId) : undefined;

  const suggested = getSuggestedPurchaseFetchRange(todayISO());
  const busy = receivingKey !== null || parsingKey !== null;

  const actionButtons = (p: EbayPurchaseRecord) => {
    if (p.disposition !== 'pending') {
      const linked = linkedItem(p);
      if (linked) {
        return (
          <button
            type="button"
            onClick={() => onOpenItem?.(linked.id)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-black uppercase"
          >
            Open in Active
          </button>
        );
      }
      return (
        <span className="text-[10px] font-black uppercase text-slate-400 px-2">{p.disposition}</span>
      );
    }
    const parsing = parsingKey === p.lineKey;
    const receiving = receivingKey === p.lineKey;
    const hasSpecs = purchaseHasParsedSpecs(p);
    return (
      <div className="flex flex-wrap items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => void parseSpecs(p)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
        >
          {parsing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {parsing ? 'Parsing…' : hasSpecs ? 'Re-parse' : 'Parse specs'}
        </button>
        <button
          type="button"
          onClick={() => void confirmReceived(p)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
        >
          {receiving ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
          {receiving ? 'Adding…' : 'Confirm'}
        </button>
      </div>
    );
  };

  const chrome = (
    <div className="space-y-1">
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 min-h-[28px] items-center">
        {(
          [
            ['pending', `Pending · ${pending.length}`],
            ['received', `Received · ${received.length}`],
            ['all', `All · ${purchases.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              filter === id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void syncNew()}
          disabled={syncing || !tokenReady}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold disabled:opacity-50 ml-auto"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Sync
        </button>
        <Link
          to="/panel/ebay-store-pull?tab=purchases"
          className="shrink-0 text-[10px] font-bold text-indigo-600 hover:underline px-1"
        >
          Tools
        </Link>
      </div>
      {syncProgress && <EbayToolProgressBar {...syncProgress} tone="indigo" />}
      {(error || message) && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
            error
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {error ? (
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          )}
          {error || message}
        </div>
      )}
      <p className="text-[10px] text-slate-400 truncate">
        Parse specs · Confirm · since <span className="font-bold text-slate-500">{suggested.from}</span>
      </p>
    </div>
  );

  const empty = (
    <div className="py-16 text-center opacity-40">
      <Package size={40} className="mx-auto mb-3 text-slate-300" />
      <p className="font-bold text-slate-400 text-sm">
        {purchases.length === 0
          ? 'No purchases yet — tap Sync or open Tools.'
          : searchTerm.trim()
            ? 'No matches found'
            : 'Nothing in this view.'}
      </p>
      <p className="text-xs text-slate-400 mt-1">Try clearing search or filters</p>
    </div>
  );

  const mobileList =
    rows.length === 0
      ? empty
      : rows.map((p) => {
          const preview = purchaseToPreviewItem(p);
          const hasSpecs = purchaseHasParsedSpecs(p);
          return (
            <article
              key={p.lineKey}
              className={`rounded-xl border bg-white px-2.5 py-2 ${
                p.disposition === 'pending'
                  ? 'border-amber-200/80'
                  : p.disposition === 'inventory'
                    ? 'border-emerald-200/80'
                    : 'border-slate-100'
              }`}
            >
              <div className="flex gap-2 items-center">
                <ItemThumbnail
                  item={preview}
                  className="w-11 h-11 rounded-lg object-cover border border-slate-100 shrink-0"
                  size={44}
                />
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="font-bold text-[13px] leading-tight text-slate-900 line-clamp-1">
                    {preview.name}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-500 truncate">
                    €{formatEUR(preview.buyPrice)}
                    {preview.buyDate ? ` · ${preview.buyDate}` : ''}
                    {preview.subCategory || preview.category
                      ? ` · ${preview.subCategory || preview.category}`
                      : ''}
                    {` · ${formatPlatformBoughtLabel(preview.platformBought) || 'eBay'}`}
                    {preview.ebayOrderId ? ` · #${preview.ebayOrderId}` : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
                        p.disposition === 'pending'
                          ? 'bg-amber-50 text-amber-900 border-amber-200'
                          : p.disposition === 'inventory'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      {p.disposition === 'inventory'
                        ? 'Received'
                        : p.disposition === 'pending'
                          ? ItemStatus.ORDERED
                          : p.disposition}
                    </span>
                    {hasSpecs && (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-violet-50 text-violet-800 border-violet-200 inline-flex items-center gap-0.5">
                        <Sparkles size={9} /> Specs
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100">{actionButtons(p)}</div>
            </article>
          );
        });

  const desktopList = (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="overflow-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5 font-black">Item</th>
                  <th className="px-3 py-2.5 font-black">Category</th>
                  <th className="px-3 py-2.5 font-black">Status</th>
                  <th className="px-3 py-2.5 font-black text-right">Buy price</th>
                  <th className="px-3 py-2.5 font-black">Acquired</th>
                  <th className="px-3 py-2.5 font-black">Bought</th>
                  <th className="px-3 py-2.5 font-black text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const preview = purchaseToPreviewItem(p);
                  const hasSpecs = purchaseHasParsedSpecs(p);
                  return (
                    <tr
                      key={p.lineKey}
                      className="border-b border-slate-100 hover:bg-slate-50/80 align-middle"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ItemThumbnail
                            item={preview}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-100 shrink-0"
                            size={36}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{preview.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {preview.vendor || 'eBay'}
                              {preview.ebayOrderId ? ` · order ${preview.ebayOrderId}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {preview.subCategory || preview.category || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
                              p.disposition === 'pending'
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : p.disposition === 'inventory'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}
                          >
                            {p.disposition === 'inventory'
                              ? 'Received'
                              : p.disposition === 'pending'
                                ? 'Ordered'
                                : p.disposition}
                          </span>
                          {hasSpecs && (
                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-violet-50 text-violet-800 border-violet-200">
                              Specs
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm font-black text-slate-900 text-right tabular-nums whitespace-nowrap">
                        €{formatEUR(preview.buyPrice)}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {preview.buyDate || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {formatPlatformBoughtLabel(preview.platformBought) || 'eBay'}
                      </td>
                      <td className="px-3 py-2 text-right">{actionButtons(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-slate-100 text-[11px] font-semibold text-slate-400">
            {rows.length} purchase{rows.length === 1 ? '' : 's'}
          </div>
        </>
      )}
    </div>
  );

  return {
    rowCount: rows.length,
    chrome,
    mobileList,
    desktopList,
  };
}

/** Standalone wrapper (eBay tools etc.) — full panel with own shells. */
const InventoryPurchasesPanel: React.FC<UseInventoryPurchasesArgs> = (props) => {
  const { chrome, mobileList, desktopList } = useInventoryPurchases(props);
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-2">
      <div className="shrink-0 px-1.5 lg:px-0">{chrome}</div>
      <div
        className="lg:hidden flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y custom-scrollbar px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {mobileList}
      </div>
      <div className="hidden lg:flex flex-1 min-h-0 flex-col">{desktopList}</div>
    </div>
  );
};

export default InventoryPurchasesPanel;
