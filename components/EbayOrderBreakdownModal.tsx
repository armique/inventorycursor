import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import type { InventoryItem, TaxMode } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { describeFinancialEvent, getOrderEffectiveNet, hubRefundDisplay } from '../utils/ebayOrderFinancial';
import {
  buildHubApplyRowForItem,
  hubBreakdownReplaceReason,
  hubMarginMathCheckForRow,
  type HubBreakdownReplaceRow,
  type HubBreakdownSnapshot,
} from '../utils/replaceItemSaleProceedsFromHub';
import {
  hubSaleColumnSplitForItem,
  mergeHubOrderLines,
  pickHubLinesForItem,
} from '../utils/hubOrderProceeds';
import {
  loadEbayOrderBreakdownForItem,
  type LoadEbayOrderBreakdownResult,
} from '../utils/loadEbayOrderForBreakdown';
import { buildEbayOrderUrl } from '../utils/sourceLinks';
import { isHubArchiveJson, parseHubArchiveJson } from '../utils/ebayHubArchiveFile';
import { upsertHubArchiveOrders } from '../services/ebayHubArchiveIndex';
import { formatEUR } from '../utils/formatMoney';
import { HubSellSplitLedger } from './HubSellSplitLedger';
import { formatHubDate } from './EbayHubOrderDetailModal';

const REASON_LABEL: Record<string, string> = {
  screenshot: 'Screenshot / guess split on item',
  estimated: 'Estimated fees on item',
  missing: 'No Hub breakdown on item yet',
  differs: 'Amounts differ from order',
  order_meta: 'Missing buyer / order fields',
};

const COMPARE_FIELDS: Array<{ key: keyof HubBreakdownSnapshot; label: string }> = [
  { key: 'total', label: 'Gesamtbetrag' },
  { key: 'ebay', label: 'Transaktionsgebühren' },
  { key: 'ads', label: 'Anzeigengebühr' },
  { key: 'ship', label: 'Versandetikett' },
  { key: 'refund', label: 'Rückerstattung' },
  { key: 'net', label: 'Bestelleinnahmen' },
  { key: 'profit', label: 'Margin' },
];

function moneyText(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `€${formatEUR(value)}`;
}

function fieldChanged(before: number | null | undefined, after: number | null | undefined): boolean {
  return Math.abs((before ?? 0) - (after ?? 0)) >= 0.02;
}

function fieldMissing(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value);
}

type Props = {
  item: InventoryItem;
  items: InventoryItem[];
  taxMode: TaxMode;
  onClose: () => void;
  onApply: (rows: HubBreakdownReplaceRow[]) => void;
  onArchiveUpdated?: () => void;
};

const EbayOrderBreakdownModal: React.FC<Props> = ({
  item,
  items,
  taxMode,
  onClose,
  onApply,
  onArchiveUpdated,
}) => {
  const [order, setOrder] = useState<EbayOrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchHint, setFetchHint] = useState<string | null>(null);
  const [fetchedLive, setFetchedLive] = useState(false);
  const [importingArchive, setImportingArchive] = useState(false);
  const archiveFileRef = useRef<HTMLInputElement>(null);
  const onArchiveUpdatedRef = useRef(onArchiveUpdated);
  onArchiveUpdatedRef.current = onArchiveUpdated;

  const loadOrder = useCallback(
    async (forceFetch = false) => {
      setError(null);
      setFetchHint(null);
      if (forceFetch) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await loadEbayOrderBreakdownForItem(item, { forceFetch });
        if (result.ok) {
          setOrder(result.order);
          setFetchedLive(result.fetchedLive);
          // Cache hits must not bump Hub maps — that re-renders this modal with a new
          // onArchiveUpdated identity and retriggers loadOrder (full-page freeze).
          // Live fetches already persist via upsertHubArchiveOrders → archive event.
          if (result.fetchedLive) onArchiveUpdatedRef.current?.();
        } else {
          // tsconfig has strictNullChecks off, which breaks discriminant narrowing here.
          const fail = result as Extract<LoadEbayOrderBreakdownResult, { ok: false }>;
          if (fail.order) setOrder(fail.order);
          setFetchHint(fail.hint || 'Could not load fee breakdown from Seller Hub.');
          if (fail.code === 'no_order_id') setError(fail.hint || 'No order ID.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [item]
  );

  useEffect(() => {
    void loadOrder(false);
  }, [loadOrder]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applying, onClose]);

  const applyRow = useMemo(() => {
    if (!order) return null;
    const lines = pickHubLinesForItem(order, item, items);
    const line = mergeHubOrderLines(lines);
    const reason = hubBreakdownReplaceReason(item, order, line, items);
    return buildHubApplyRowForItem(item, order, taxMode, items, reason ?? 'differs');
  }, [order, item, items, taxMode]);

  const hubSplit = useMemo(
    () => (order ? hubSaleColumnSplitForItem(order, item, items) : null),
    [order, item, items]
  );

  const marginCheck = useMemo(() => {
    if (!applyRow || !hubSplit) return null;
    return hubMarginMathCheckForRow(item, hubSplit, applyRow, taxMode);
  }, [applyRow, hubSplit, item, taxMode]);

  const needsApply = useMemo(() => {
    if (!applyRow) return false;
    return COMPARE_FIELDS.some((field) => {
      const before = applyRow.before[field.key] as number | null;
      const after = applyRow.after[field.key] as number | null;
      return fieldMissing(before) && !fieldMissing(after);
    }) || COMPARE_FIELDS.some((field) => {
      const before = applyRow.before[field.key] as number | null;
      const after = applyRow.after[field.key] as number | null;
      return fieldChanged(before, after);
    });
  }, [applyRow]);

  const refund = order ? hubRefundDisplay(order) : null;
  const net = order ? getOrderEffectiveNet(order) : null;
  const externalUrl = item.ebayOrderId ? buildEbayOrderUrl(item.ebayOrderId) : null;

  const handleApply = () => {
    if (!applyRow || !needsApply) return;
    setApplying(true);
    onApply([applyRow]);
    setApplying(false);
  };

  const handleArchiveFile = async (file: File | undefined) => {
    if (!file) return;
    setImportingArchive(true);
    setError(null);
    try {
      const text = await file.text();
      if (!isHubArchiveJson(text)) {
        setError('Not a Hub archive JSON. Use ebay-order-archive.json (kind inventory-pro-ebay-order-archive).');
        return;
      }
      const parsed = parseHubArchiveJson(text);
      upsertHubArchiveOrders(parsed.orders, { fileName: file.name });
      onArchiveUpdatedRef.current?.();
      await loadOrder(false);
    } catch (e) {
      setError((e as Error)?.message || 'Could not import archive JSON.');
    } finally {
      setImportingArchive(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (!applying) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ebay-order-breakdown-title"
    >
      <div
        className="bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-sky-50 to-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-sky-800">Inventory vs eBay archive</p>
            <h2 id="ebay-order-breakdown-title" className="text-base font-black text-slate-900 truncate">
              {item.name}
            </h2>
            <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
              {item.ebayOrderId || '—'}
              {order?.creationDate ? ` · ${formatHubDate(order.creationDate)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-slate-500">
              <Loader2 size={18} className="animate-spin text-sky-600" />
              Loading order breakdown…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">{error}</div>
          ) : (
            <>
              {fetchHint && !orderHasFeeBreakdown(order!) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2 text-[11px] text-amber-950">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden />
                  <span>{fetchHint}</span>
                </div>
              )}

              {fetchedLive && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-900 flex items-center gap-2">
                  <Check size={14} strokeWidth={2.75} className="text-emerald-600 shrink-0" aria-hidden />
                  Parsed live from Seller Hub and saved to archive.
                </div>
              )}

              {order && hubSplit && (
                <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase text-sky-900">eBay archive payout</p>
                    {net != null && (
                      <span className={`text-[12px] font-black tabular-nums ${net < 0 ? 'text-rose-700' : 'text-emerald-800'}`}>
                        net €{formatEUR(net)}
                      </span>
                    )}
                  </div>
                  <HubSellSplitLedger split={hubSplit} />
                  {refund && refund.refundEur >= 0.01 && (
                    <p className="text-[11px] font-semibold text-rose-700 tabular-nums">
                      Refund −€{formatEUR(refund.refundEur)}
                    </p>
                  )}
                </section>
              )}

              {applyRow && (
                <section className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase text-slate-500">Now on item → eBay archive</p>
                      <p className="text-[11px] text-slate-600 truncate">
                        {needsApply
                          ? REASON_LABEL[applyRow.reason] || applyRow.reason
                          : 'Ads / shipping / eBay already match this payout'}
                      </p>
                    </div>
                    {needsApply ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                        <AlertTriangle size={10} aria-hidden />
                        Update needed
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-800">
                        <Check size={10} strokeWidth={2.75} aria-hidden />
                        In sync
                      </span>
                    )}
                  </div>

                  {marginCheck?.expectedMarginEur != null && (
                    <div
                      className={`mx-3 mt-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold tabular-nums ${
                        marginCheck.matches
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-amber-200 bg-amber-50 text-amber-950'
                      }`}
                    >
                      {marginCheck.matches ? (
                        <Check size={14} strokeWidth={2.75} className="shrink-0 mt-0.5 text-emerald-600" aria-hidden />
                      ) : (
                        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" aria-hidden />
                      )}
                      <span>
                        Net €{formatEUR(marginCheck.netEur ?? 0)} − Buy €{formatEUR(marginCheck.buyPriceEur)} ={' '}
                        <strong>€{formatEUR(marginCheck.expectedMarginEur)}</strong>
                        {marginCheck.matches ? (
                          <span className="text-emerald-700"> · matches margin after apply ✓</span>
                        ) : (
                          <span className="text-amber-800"> · stored margin differs</span>
                        )}
                      </span>
                    </div>
                  )}

                  <div className="divide-y divide-slate-100">
                    {COMPARE_FIELDS.map((field) => {
                      const before = applyRow.before[field.key] as number | null;
                      const after = applyRow.after[field.key] as number | null;
                      const changed = fieldChanged(before, after);
                      const missingOnItem = fieldMissing(before) && !fieldMissing(after);
                      return (
                        <div
                          key={field.key}
                          className={`grid grid-cols-[minmax(5rem,1fr)_minmax(4rem,auto)_auto_minmax(4rem,auto)_auto] gap-1.5 items-center px-3 py-1.5 ${
                            changed || missingOnItem ? 'bg-emerald-50/35' : ''
                          }`}
                        >
                          <span className="text-[11px] font-bold text-slate-500">{field.label}</span>
                          <span
                            className={`text-right tabular-nums text-[12px] font-bold ${
                              missingOnItem ? 'text-amber-700' : changed ? 'text-rose-600 line-through' : 'text-slate-600'
                            }`}
                          >
                            {moneyText(before)}
                          </span>
                          <ArrowRight size={12} className={`justify-self-center ${changed || missingOnItem ? 'text-emerald-700' : 'text-slate-300'}`} />
                          <span
                            className={`text-right tabular-nums text-[12px] font-black ${
                              changed || missingOnItem ? 'text-emerald-800' : 'text-slate-700'
                            }`}
                          >
                            {moneyText(after)}
                          </span>
                          {missingOnItem ? (
                            <span title="Will fill missing value" className="shrink-0 flex items-center">
                              <Check size={13} strokeWidth={2.75} className="text-emerald-600" aria-hidden />
                            </span>
                          ) : changed ? (
                            <RefreshCw size={12} className="text-emerald-600 shrink-0" aria-hidden />
                          ) : (
                            <Check size={13} strokeWidth={2.75} className="text-slate-300 shrink-0" aria-hidden />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {order && (order.financialEvents?.length ?? 0) > 0 && (
                <section className="rounded-xl border border-slate-200 overflow-hidden">
                  <p className="text-[10px] font-black uppercase text-slate-400 px-3 pt-3 pb-1.5">
                    Parsed events ({order.financialEvents!.length})
                  </p>
                  <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                    {order.financialEvents!.map((event) => (
                      <li key={event.id} className="px-3 py-1.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-800 truncate">{describeFinancialEvent(event)}</p>
                          <p className="text-[10px] text-slate-400">{formatHubDate(event.date)} · {event.kind}</p>
                        </div>
                        <span className={`text-[11px] font-black tabular-nums shrink-0 ${event.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                          {event.amount < 0 ? '−' : ''}€{formatEUR(Math.abs(event.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="shrink-0 px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || refreshing || applying}
              onClick={() => void loadOrder(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh Hub
            </button>
            <input
              ref={archiveFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void handleArchiveFile(file);
              }}
            />
            <button
              type="button"
              disabled={loading || applying || importingArchive}
              onClick={() => archiveFileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {importingArchive ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Import archive JSON
            </button>
            {externalUrl ? (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
              >
                <ExternalLink size={12} />
                eBay
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Close
            </button>
            <button
              type="button"
              disabled={loading || applying || !applyRow || !needsApply}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Saving…
                </>
              ) : needsApply ? (
                <>
                  <Check size={12} strokeWidth={2.75} />
                  Apply to Sell
                </>
              ) : (
                <>
                  <Check size={12} strokeWidth={2.75} />
                  Sell cell in sync
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
};

export default EbayOrderBreakdownModal;
