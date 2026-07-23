/**
 * Inventory → Purchases tab: triage eBay buyer purchases and confirm received → Active stock.
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
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import type { InventoryItem } from '../types';
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
} from '../utils/ebayPurchaseToInventory';
import { formatEUR } from '../utils/formatMoney';
import { matchesEbayToolSearch } from '../utils/ebayToolSearch';
import EbayToolProgressBar, { type EbayToolProgress } from './EbayToolProgressBar';
import EbayToolSearchInput from './EbayToolSearchInput';
import PurchaseBuyInfoBlock from './PurchaseBuyInfoBlock';

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onOpenItem?: (id: string) => void;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

const InventoryPurchasesPanel: React.FC<Props> = ({
  items,
  categories,
  categoryFields,
  onUpdate,
  onOpenItem,
}) => {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const purchases = useMemo(() => loadEbayPurchaseIndex().purchases, [version]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'pending' | 'received' | 'all'>('pending');
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
    if (search.trim()) {
      list = list.filter((p) =>
        matchesEbayToolSearch(search, [
          p.title,
          p.orderId,
          p.sellerUsername,
          p.itemId,
          p.lineKey,
          p.disposition,
        ])
      );
    }
    return [...list].sort((a, b) => (b.creationDate || '').localeCompare(a.creationDate || ''));
  }, [filter, pending, received, purchases, search]);

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
        `Parsed specs for “${draft.name}” · ${draft.category}${
          draft.subCategory ? ` / ${draft.subCategory}` : ''
        } · ${specCount} field${specCount === 1 ? '' : 's'}${
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
      // Prefer already-parsed draft; only run AI again if none saved yet.
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
        }${draft.enrichError ? ` (${draft.enrichError})` : ''}`
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1.5 lg:px-0 pb-4 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900 inline-flex items-center gap-2">
              <ShoppingBag size={16} className="text-indigo-600" />
              Purchases to receive
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Confirm when an eBay buy arrives — Active gets buy price, date, platform (eBay), seller,
              order ID, and parsed specs. Use <span className="font-bold">Parse specs</span> first so
              Confirm is instant. Sync new from{' '}
              <span className="font-bold">{suggested.from}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void syncNew()}
            disabled={syncing || !tokenReady}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-indigo-700 disabled:opacity-50"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync new
          </button>
        </div>
        {syncProgress && <EbayToolProgressBar {...syncProgress} tone="indigo" />}
        <p className="text-[11px] text-slate-400">
          Full history / filament / expenses:{' '}
          <Link to="/panel/ebay-store-pull?tab=purchases" className="font-bold text-indigo-600 hover:underline">
            eBay Tools → Purchases
          </Link>
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-800">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-900">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['pending', `Pending · ${pending.length}`],
            ['received', `In stock · ${received.length}`],
            ['all', `All · ${purchases.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border ${
              filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {purchases.length > 0 && (
        <EbayToolSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search title, order ID, seller…"
          matchCount={rows.length}
          totalCount={filter === 'pending' ? pending.length : filter === 'received' ? received.length : purchases.length}
        />
      )}

      {rows.length === 0 ? (
        <div className="py-16 text-center opacity-50">
          <Package size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-slate-500 text-sm">
            {purchases.length === 0
              ? 'No purchases cached yet — Sync new or open eBay Tools.'
              : 'Nothing in this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => {
            const linked = linkedItem(p);
            const busy = receivingKey === p.lineKey;
            const parsing = parsingKey === p.lineKey;
            const draft = p.inventoryDraft;
            const hasSpecs = purchaseHasParsedSpecs(p);
            const specEntries = draft?.specs ? Object.entries(draft.specs).slice(0, 6) : [];
            return (
              <div
                key={p.lineKey}
                className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm"
              >
                <div className="flex flex-wrap gap-3 items-start justify-between">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                          p.disposition === 'inventory'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.disposition === 'pending'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.disposition === 'inventory' ? 'Received' : p.disposition}
                      </span>
                      {hasSpecs && (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 inline-flex items-center gap-0.5">
                          <Sparkles size={10} /> Specs ready
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-bold">{p.creationDate || '—'}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 leading-snug">
                      {draft?.name || p.title}
                    </p>
                    {draft?.name && draft.name !== p.title && (
                      <p className="text-[11px] text-slate-400 truncate">{p.title}</p>
                    )}
                    <p className="text-[11px] text-slate-500">
                      Order {p.orderId}
                      {p.sellerUsername ? ` · ${p.sellerUsername}` : ''}
                      {p.quantity > 1 ? ` · qty ${p.quantity}` : ''}
                      {draft?.category
                        ? ` · ${draft.category}${draft.subCategory ? ` / ${draft.subCategory}` : ''}`
                        : ''}
                    </p>
                    {linked && (
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(linked.id)}
                        className="text-[11px] font-bold text-indigo-600 hover:underline"
                      >
                        Open in Active → {linked.name}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <p className="text-lg font-black text-slate-900">€{formatEUR(p.totalPaid ?? 0)}</p>
                  </div>
                </div>

                <PurchaseBuyInfoBlock purchase={p} />

                {specEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {specEntries.map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600"
                      >
                        {k}: {String(v)}
                      </span>
                    ))}
                    {Object.keys(draft?.specs || {}).length > specEntries.length && (
                      <span className="text-[10px] font-bold text-slate-400 px-1 py-0.5">
                        +{Object.keys(draft!.specs).length - specEntries.length} more
                      </span>
                    )}
                  </div>
                )}

                {p.disposition === 'pending' && (
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => void parseSpecs(p)}
                      disabled={parsing || receivingKey !== null || parsingKey !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-violet-700 disabled:opacity-50"
                    >
                      {parsing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {parsing ? 'Parsing…' : hasSpecs ? 'Re-parse specs' : 'Parse specs'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmReceived(p)}
                      disabled={busy || receivingKey !== null || parsingKey !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                      {busy ? 'Adding…' : 'Confirm received'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InventoryPurchasesPanel;
