import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react';
import { fetchEbayOrder, hasEbayToken } from '../services/ebayService';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import type { OrderLinkSuggestion, OrderLinkSuggestionKind } from '../utils/ebayOrderLinkAnalysis';
import { getLinePayout } from '../utils/ebayOrderPayout';
import { describeFinancialEvent } from '../utils/ebayOrderFinancial';
import { isRestockAfterRefundAdjustment, getAdjustmentSuggestionLabel, getAdjustmentSuggestionBadgeClass } from '../utils/ebaySaleAdjustments';
import { scoreListingTitleMatch } from '../utils/ebayListingMatch';
import { formatEUR } from '../utils/formatMoney';

interface Props {
  row: OrderLinkSuggestion;
  applying?: boolean;
  onClose: () => void;
  onApply: (row: OrderLinkSuggestion) => void;
  onDismiss: (row: OrderLinkSuggestion) => void;
}

function isRestockRow(row: OrderLinkSuggestion): boolean {
  return Boolean(row.adjustment && isRestockAfterRefundAdjustment(row.adjustment));
}

function kindLabel(kind: OrderLinkSuggestionKind, row?: OrderLinkSuggestion): string {
  if (kind === 'mark_sold') return 'Mark sold';
  if (kind === 'link') return 'Link order';
  if (kind === 'adjustment' && row?.adjustment) return getAdjustmentSuggestionLabel(row.adjustment);
  if (kind === 'adjustment') return 'Adjustment';
  return 'Fix payout';
}

function kindBadgeClass(kind: OrderLinkSuggestionKind, row?: OrderLinkSuggestion): string {
  if (kind === 'mark_sold') return 'bg-emerald-100 text-emerald-800';
  if (kind === 'link') return 'bg-blue-100 text-blue-800';
  if (kind === 'adjustment' && row?.adjustment) return getAdjustmentSuggestionBadgeClass(row.adjustment);
  if (kind === 'adjustment') return 'bg-rose-100 text-rose-900';
  return 'bg-amber-100 text-amber-900';
}

function matchKindLabel(kind: OrderLinkSuggestion['match']['matchKind']): string {
  if (kind === 'listingId') return 'Listing ID';
  if (kind === 'sku') return 'SKU';
  return 'Title';
}

function CompareRow({
  label,
  left,
  right,
  match,
}: {
  label: string;
  left: string;
  right: string;
  match: 'yes' | 'partial' | 'no' | 'neutral';
}) {
  const icon =
    match === 'yes' ? (
      <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
    ) : match === 'partial' ? (
      <AlertCircle size={14} className="text-amber-600 shrink-0" />
    ) : match === 'no' ? (
      <AlertCircle size={14} className="text-red-500 shrink-0" />
    ) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-start text-[11px] py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase text-slate-400 mb-0.5">Inventory</p>
        <p className="font-semibold text-slate-800 break-words">{left || '—'}</p>
      </div>
      <div className="pt-4 px-1 flex flex-col items-center gap-0.5">
        {icon}
        <span className="text-[8px] font-black uppercase text-slate-400 whitespace-nowrap">{label}</span>
      </div>
      <div className="min-w-0 text-right">
        <p className="text-[9px] font-black uppercase text-slate-400 mb-0.5">eBay order</p>
        <p className="font-semibold text-slate-800 break-words">{right || '—'}</p>
      </div>
    </div>
  );
}

const EbaySalesMatchReviewModal: React.FC<Props> = ({
  row,
  applying = false,
  onClose,
  onApply,
  onDismiss,
}) => {
  const { item, match, kind } = row;
  const { order: matchOrder, lineItem, matchKind, matchScore } = match;
  const [cachedOrder, setCachedOrder] = useState<EbayOrderRecord>(matchOrder);
  const order = cachedOrder;

  useEffect(() => {
    const refresh = () => {
      const fresh = loadEbayOrderIndex().orders.find((o) => o.orderId === matchOrder.orderId);
      if (fresh) setCachedOrder(fresh);
    };
    refresh();
    window.addEventListener('ebay-order-index-updated', refresh);
    return () => window.removeEventListener('ebay-order-index-updated', refresh);
  }, [matchOrder.orderId]);
  const payout = useMemo(() => getLinePayout(order, lineItem), [order, lineItem]);

  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<Awaited<ReturnType<typeof fetchEbayOrder>> | null>(null);
  const tokenReady = hasEbayToken();

  const titleScore = useMemo(
    () => (item.name && lineItem.title ? scoreListingTitleMatch(item.name, lineItem.title, lineItem.sku || undefined, item.ebaySku) : 0),
    [item.name, item.ebaySku, lineItem.title, lineItem.sku]
  );

  const skuMatch =
    item.ebaySku && lineItem.sku
      ? item.ebaySku.trim().toLowerCase() === lineItem.sku.trim().toLowerCase()
      : null;
  const listingMatch =
    item.ebayListingId && lineItem.listingId ? item.ebayListingId === lineItem.listingId : null;

  const refreshLive = useCallback(async () => {
    if (!tokenReady) {
      setLiveError('Add eBay token in Settings to refresh live order data.');
      return;
    }
    setLiveLoading(true);
    setLiveError(null);
    try {
      const data = await fetchEbayOrder(order.orderId);
      setLiveData(data);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Live fetch failed');
    } finally {
      setLiveLoading(false);
    }
  }, [order.orderId, tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    (async () => {
      setLiveLoading(true);
      setLiveError(null);
      try {
        const data = await fetchEbayOrder(order.orderId);
        if (!cancelled) setLiveData(data);
      } catch (e) {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : 'Live fetch failed');
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.orderId, tokenReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lineKey = (li: (typeof order.lineItems)[0], idx: number) =>
    `${order.orderId}-${li.sku || li.listingId || idx}`;

  const isMatchedLine = (li: (typeof order.lineItems)[0]) =>
    (lineItem.sku && li.sku && lineItem.sku === li.sku) ||
    (lineItem.listingId && li.listingId && lineItem.listingId === li.listingId) ||
    li.title === lineItem.title;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ebay-match-review-title"
    >
      <div
        className="bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[96vh] sm:max-w-[min(96vw,1400px)] sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${kindBadgeClass(kind, row)}`}>
                {kindLabel(kind, row)}
              </span>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                {matchKindLabel(matchKind)} · score {matchScore}
              </span>
            </div>
            <h2 id="ebay-match-review-title" className="text-base sm:text-lg font-black text-slate-900 leading-snug">
              Review match before applying
            </h2>
            <p className="text-xs text-slate-500">
              Compare your inventory row with the cached eBay order line. Apply only when you are confident it is the same sale.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Quick compare strip */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 sm:p-4">
            <p className="text-[10px] font-black uppercase text-indigo-800 mb-2">Match signals</p>
            <CompareRow
              label="Title"
              left={item.name || '—'}
              right={lineItem.title || '—'}
              match={
                matchKind === 'listingId' || matchKind === 'sku'
                  ? 'yes'
                  : titleScore >= 70
                    ? 'yes'
                    : titleScore >= 40
                      ? 'partial'
                      : 'no'
              }
            />
            <CompareRow
              label="SKU"
              left={item.ebaySku || '—'}
              right={lineItem.sku || '—'}
              match={skuMatch === true ? 'yes' : skuMatch === false ? 'no' : 'neutral'}
            />
            <CompareRow
              label="Listing"
              left={item.ebayListingId || '—'}
              right={lineItem.listingId || '—'}
              match={listingMatch === true ? 'yes' : listingMatch === false ? 'no' : 'neutral'}
            />
            <CompareRow
              label="Date"
              left={item.sellDate || item.buyDate || '—'}
              right={order.creationDate || '—'}
              match={
                item.sellDate && order.creationDate
                  ? Math.abs(
                      (new Date(item.sellDate).getTime() - new Date(order.creationDate).getTime()) /
                        (86400000)
                    ) <= 14
                    ? 'yes'
                    : 'partial'
                  : 'neutral'
              }
            />
          </div>

          {row.adjustmentReason && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">
              {row.adjustmentReason}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Inventory column */}
            <section className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                <Package size={16} className="text-slate-600" />
                <h3 className="text-xs font-black uppercase text-slate-700">Your inventory item</h3>
              </div>
              <div className="p-3 space-y-3">
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-full max-h-36 object-contain rounded-lg bg-slate-50 border border-slate-100"
                  />
                )}
                <div>
                  <p className="text-sm font-black text-slate-900">{item.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {item.category}
                    {item.subCategory ? ` · ${item.subCategory}` : ''} · {item.status}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">Buy (EK)</dt>
                    <dd className="font-bold text-slate-900">€{formatEUR(item.buyPrice)}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">Status</dt>
                    <dd className="font-bold text-slate-900">{item.status}</dd>
                  </div>
                  {!isRestockRow(row) && (
                    <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                      <dt className="text-[9px] font-black uppercase text-slate-400">Current sell</dt>
                      <dd className="font-bold text-slate-900">
                        {row.currentSellPrice != null ? `€${formatEUR(row.currentSellPrice)}` : '—'}
                      </dd>
                    </div>
                  )}
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">eBay SKU</dt>
                    <dd className="font-bold text-slate-800 truncate">{item.ebaySku || '—'}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">Linked order</dt>
                    <dd className="font-bold text-slate-800 truncate">{item.ebayOrderId || '—'}</dd>
                  </div>
                </dl>
                {isRestockRow(row) ? (
                  <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase text-indigo-800">After apply</span>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-indigo-900">In Stock · sell cleared</p>
                      <p className="text-lg font-black text-indigo-700 tabular-nums">
                        EK €{formatEUR(item.buyPrice)}
                        <ArrowRight size={12} className="inline mx-1 text-slate-400" />
                        €{formatEUR(row.suggestedBuyPrice ?? item.buyPrice)}
                      </p>
                      {row.adjustment?.buyPriceDelta != null && row.adjustment.buyPriceDelta > 0 && (
                        <p className="text-[10px] font-bold text-rose-700">
                          +€{formatEUR(row.adjustment.buyPriceDelta)} cancellation fee
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  kind !== 'mark_sold' && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase text-emerald-800">Suggested payout</span>
                      <span className="text-lg font-black text-emerald-700 tabular-nums">
                        €{formatEUR(row.suggestedSellPrice)}
                      </span>
                    </div>
                  )
                )}
              </div>
            </section>

            {/* Order column */}
            <section className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShoppingBag size={16} className="text-indigo-600 shrink-0" />
                  <h3 className="text-xs font-black uppercase text-slate-700 truncate">eBay order {order.orderId}</h3>
                </div>
                <button
                  type="button"
                  disabled={liveLoading || !tokenReady}
                  onClick={() => void refreshLive()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 shrink-0"
                  title="Refresh buyer & address from eBay API"
                >
                  {liveLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Live
                </button>
              </div>
              <div className="p-3 space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">Order date</dt>
                    <dd className="font-bold text-slate-900">{order.creationDate || '—'}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <dt className="text-[9px] font-black uppercase text-slate-400">Status</dt>
                    <dd className="font-bold text-slate-800 text-[10px]">
                      {order.orderPaymentStatus || '—'}
                      {order.orderFulfillmentStatus ? ` · ${order.orderFulfillmentStatus}` : ''}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Buyer (cached)</p>
                  <p className="text-sm font-bold text-slate-900">
                    {order.buyer.fullName || order.buyer.username || '—'}
                  </p>
                  {order.buyer.username && (
                    <p className="text-[11px] text-slate-500">@{order.buyer.username}</p>
                  )}
                  {order.buyer.address && (
                    <p className="text-[11px] text-slate-600 whitespace-pre-line mt-1">{order.buyer.address}</p>
                  )}
                </div>

                {liveData && (
                  <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-2">
                    <p className="text-[9px] font-black uppercase text-indigo-700 mb-1 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Live from eBay API
                    </p>
                    <p className="text-sm font-bold text-slate-900">{liveData.customer.name || liveData.ebayUsername}</p>
                    {liveData.customer.address && (
                      <p className="text-[11px] text-slate-600 whitespace-pre-line mt-1">{liveData.customer.address}</p>
                    )}
                    {liveData.sellPrice != null && (
                      <p className="text-[11px] text-slate-600 mt-1">
                        API line gross: €{formatEUR(liveData.sellPrice)}
                        {liveData.sellDate ? ` · ${liveData.sellDate}` : ''}
                      </p>
                    )}
                  </div>
                )}
                {liveError && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 space-y-1.5">
                    <p className="font-semibold">{liveError}</p>
                    {/expired|invalid|401/i.test(liveError) && (
                      <>
                        <p className="text-[10px] text-amber-900/90 leading-snug">
                          eBay OAuth access tokens expire (often after ~2 hours). Cached buyer and line items below still work — only the Live refresh needs a fresh token.
                        </p>
                        <Link
                          to="/panel/settings?tab=EBAY"
                          className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-indigo-700 hover:underline"
                        >
                          Settings → eBay API → paste new User Token
                        </Link>
                      </>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">
                    Line items ({order.lineItems.length})
                  </p>
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {order.lineItems.map((li, idx) => {
                      const matched = isMatchedLine(li);
                      const liPayout = getLinePayout(order, li);
                      return (
                        <li
                          key={lineKey(li, idx)}
                          className={`rounded-lg border p-2 text-[11px] ${
                            matched
                              ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                              : 'border-slate-100 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-bold text-slate-900 line-clamp-2">{li.title || 'Untitled line'}</p>
                            {matched && (
                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-600 text-white shrink-0">
                                Match
                              </span>
                            )}
                          </div>
                          <p className="text-slate-500 mt-0.5">
                            {li.sku ? `SKU ${li.sku}` : 'No SKU'}
                            {li.quantity != null ? ` · qty ${li.quantity}` : ''}
                          </p>
                          <p className="text-slate-700 font-semibold tabular-nums mt-0.5">
                            {liPayout.netKnown ? (
                              <>Net €{formatEUR(liPayout.sellPrice)}</>
                            ) : liPayout.gross != null ? (
                              <>Gross €{formatEUR(liPayout.gross)}</>
                            ) : (
                              '—'
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="rounded-lg border border-slate-200 p-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Gross</p>
                    <p className="font-bold tabular-nums">{payout.gross != null ? `€${formatEUR(payout.gross)}` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Net payout</p>
                    <p className="font-black text-emerald-700 tabular-nums">
                      {payout.netKnown ? `€${formatEUR(payout.sellPrice)}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Fees</p>
                    <p className="font-bold tabular-nums">{payout.fee > 0 ? `€${formatEUR(payout.fee)}` : '—'}</p>
                  </div>
                </div>
                {!row.netKnown && (
                  <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                    Net payout unknown — import Seller Hub Payments CSV for accurate after-fee amounts.
                  </p>
                )}
                {row.netKnown && (
                  <p className="text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1">
                    Net payout = Bestelleinnahmen (order proceeds − Promoted Listings − Versandetikett − fees), matching eBay Seller Hub.
                  </p>
                )}

                {order.financialEvents && order.financialEvents.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-500 mb-1">Financial events</p>
                    <ul className="space-y-1 max-h-24 overflow-y-auto">
                      {order.financialEvents.slice(0, 6).map((ev) => (
                        <li
                          key={ev.id}
                          className="text-[10px] flex justify-between gap-2 bg-slate-50 rounded px-2 py-1 border border-slate-100"
                        >
                          <span className="text-slate-600 truncate">
                            {ev.date} · {describeFinancialEvent(ev)}
                          </span>
                          <span
                            className={`font-bold tabular-nums shrink-0 ${ev.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}
                          >
                            {ev.amount >= 0 ? '+' : ''}€{formatEUR(ev.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Payout preview for apply */}
          {isRestockRow(row) ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-indigo-900">If you apply this suggestion</span>
              <div className="text-sm font-black tabular-nums text-indigo-800">
                Sold → In Stock · buy €{formatEUR(item.buyPrice)} → €{formatEUR(row.suggestedBuyPrice ?? item.buyPrice)}
                {row.adjustment?.buyPriceDelta != null && row.adjustment.buyPriceDelta > 0 && (
                  <span className="text-rose-700"> (+€{formatEUR(row.adjustment.buyPriceDelta)} fee)</span>
                )}
              </div>
            </div>
          ) : (
            kind !== 'mark_sold' &&
            row.currentSellPrice != null && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-emerald-900">If you apply this suggestion</span>
                <div className="flex items-center gap-2 text-sm font-black tabular-nums">
                  <span className="text-slate-500">€{formatEUR(row.currentSellPrice)}</span>
                  <ArrowRight size={14} className="text-slate-400" />
                  <span className="text-emerald-700">€{formatEUR(row.suggestedSellPrice)}</span>
                  {row.priceDelta != null && Math.abs(row.priceDelta) >= 0.02 && (
                    <span className={row.priceDelta < 0 ? 'text-red-600' : 'text-emerald-600'}>
                      ({row.priceDelta > 0 ? '+' : ''}€{formatEUR(row.priceDelta)})
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50/80 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(row)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {isRestockRow(row)
              ? 'Restock & apply fee'
              : kind === 'adjustment'
                ? 'Apply adjustment'
                : kind === 'mark_sold'
                  ? 'Mark sold & apply'
                  : 'Confirm & apply'}
          </button>
          <button
            type="button"
            onClick={() => {
              onDismiss(row);
              onClose();
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase text-slate-600 hover:bg-slate-50"
          >
            Dismiss suggestion
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-[11px] font-black uppercase text-slate-500 hover:text-slate-800 ml-auto"
          >
            Close
          </button>
          <a
            href={`https://www.ebay.de/mesh/ord/details?orderid=${encodeURIComponent(order.orderId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline w-full sm:w-auto sm:ml-0"
          >
            Open on eBay.de <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EbaySalesMatchReviewModal;
