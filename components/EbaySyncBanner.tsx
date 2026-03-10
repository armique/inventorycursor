import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, ChevronDown, ChevronUp, Loader2, ArrowRight } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import {
  runEbaySync,
  buildSoldItem,
  setLastSyncTime,
  addProcessedOrderId,
  SyncResult,
  EbayOrderSummary,
} from '../services/ebaySyncService';

const getEbayConfig = () => {
  const saved = localStorage.getItem('ebay_config');
  return saved ? JSON.parse(saved) : { token: '' };
};

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[], deleteIds?: string[]) => void;
}

const EbaySyncBanner: React.FC<Props> = ({ items, onUpdate }) => {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [assignOrder, setAssignOrder] = useState<EbayOrderSummary | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const hasRunSync = useRef(false);

  const runSync = useCallback(async () => {
    const config = getEbayConfig();
    if (!config?.token) return;

    setStatus('syncing');
    setResult(null);
    setDismissed(false);

    try {
      const syncResult = await runEbaySync(items);
      setResult(syncResult);

      if (syncResult.error) {
        setStatus('error');
        return;
      }

      // Apply matched: mark items as sold
      if (syncResult.matched.length > 0) {
        const updatedItems = syncResult.matched.map((m) =>
          buildSoldItem(m.item, m.order, m.lineItem)
        );
        onUpdate(updatedItems);
        syncResult.matched.forEach((m) => addProcessedOrderId(m.order.orderId));
      }

      setLastSyncTime(Date.now());
      setStatus('done');
    } catch (e: any) {
      setResult({ matched: [], unmatched: [], error: e?.message || 'Sync failed' });
      setStatus('error');
    }
  }, [items, onUpdate]);

  useEffect(() => {
    const config = getEbayConfig();
    if (!config?.token || hasRunSync.current) return;
    hasRunSync.current = true;
    runSync();
  }, [runSync]);

  const inStockItems = items.filter(
    (i) => i.status === ItemStatus.IN_STOCK && !i.isPC && !i.isBundle
  );
  const assignFiltered = assignSearch.trim()
    ? inStockItems.filter(
        (i) =>
          i.name.toLowerCase().includes(assignSearch.toLowerCase()) ||
          i.category.toLowerCase().includes(assignSearch.toLowerCase())
      )
    : inStockItems;

  const handleAssignToItem = (order: EbayOrderSummary, item: InventoryItem) => {
    const line = order.lineItems[0];
    const sold = buildSoldItem(item, order, { lineItemCost: line?.lineItemCost ?? null });
    onUpdate([sold]);
    addProcessedOrderId(order.orderId);
    setResult((prev) =>
      prev
        ? { ...prev, unmatched: prev.unmatched.filter((o) => o.orderId !== order.orderId) }
        : null
    );
    setAssignOrder(null);
    setAssignSearch('');
  };

  let bannerContent: React.ReactNode = null;

  if (!dismissed && status !== 'idle') {
    if (status === 'syncing') {
      bannerContent = (
        <div className="mb-6 flex items-center gap-4 p-4 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800">
          <Loader2 size={20} className="animate-spin shrink-0" />
          <span className="text-sm font-bold">Syncing eBay orders…</span>
        </div>
      );
    } else if (status === 'error' && result?.error) {
      bannerContent = (
        <div className="mb-6 flex items-center justify-between gap-4 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800">
          <span className="text-sm font-bold">{result.error}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runSync}
              className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-sm font-bold"
            >
              Retry
            </button>
            <button type="button" onClick={() => setDismissed(true)} className="p-1 hover:bg-red-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>
      );
    } else if (status === 'done' && result) {
      const hasMatched = result.matched.length > 0;
      const hasUnmatched = result.unmatched.length > 0;
      const hasAny = hasMatched || hasUnmatched;

      if (hasAny) {
        bannerContent = (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
              <RefreshCw size={20} />
            </div>
            <div>
              {hasMatched && (
                <p className="text-sm font-bold text-slate-900">
                  {result.matched.length} item{result.matched.length !== 1 ? 's' : ''} marked sold from eBay
                </p>
              )}
              {hasUnmatched && (
                <p className="text-sm text-slate-600">
                  {result.unmatched.length} order{result.unmatched.length !== 1 ? 's' : ''} couldn&apos;t be matched (no SKU link)
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasUnmatched && (
              <button
                type="button"
                onClick={() => setShowUnmatched(!showUnmatched)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-700"
              >
                {showUnmatched ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                View unmatched
              </button>
            )}
            <button type="button" onClick={() => setDismissed(true)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
              <X size={18} />
            </button>
          </div>
        </div>
        {showUnmatched && hasUnmatched && (
          <div className="border-t border-slate-100 p-4 bg-slate-50/50">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Assign manually to an inventory item
            </p>
            <ul className="space-y-2">
              {result.unmatched.map((order) => (
                <li
                  key={order.orderId}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white border border-slate-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      #{order.orderId} · {order.creationDate || '—'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {order.buyer.fullName || order.buyer.username || '—'}
                      {order.lineItems[0]?.title && ` · ${order.lineItems[0].title}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAssignOrder(order)}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                  >
                    Assign
                    <ArrowRight size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
        );
      }
    }
  }

  return (
    <>
      {bannerContent}
      {assignOrder &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-in fade-in p-4"
            onClick={() => setAssignOrder(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden animate-in zoom-in-95"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  Assign order #{assignOrder.orderId} to item
                </h3>
                <button
                  onClick={() => setAssignOrder(null)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4">
                <input
                  type="text"
                  placeholder="Search inventory..."
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 text-sm mb-3"
                />
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {assignFiltered.length === 0 ? (
                    <p className="text-slate-500 text-sm py-4 text-center">
                      No in-stock items found
                    </p>
                  ) : (
                    assignFiltered.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleAssignToItem(assignOrder, item)}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-left"
                      >
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {item.name}
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">
                          €{item.buyPrice?.toFixed(2)} · {item.category}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default EbaySyncBanner;
