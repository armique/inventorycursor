import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { describeFinancialEvent, getOrderEffectiveNet, hubRefundDisplay } from '../utils/ebayOrderFinancial';
import { saleProceedsFromOrder, saleProceedsRows } from '../utils/saleProceeds';
import { hubOrderIdFromItem } from '../utils/replaceItemSaleProceedsFromHub';
import { hubOrderDisplayTitle } from '../utils/ebayHubOrderTitle';
import { formatEUR } from '../utils/formatMoney';
import ItemLink from './ItemLink';

function formatHubDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function statusLabel(order: EbayOrderRecord): string | null {
  const refund = hubRefundDisplay(order);
  if (refund.label) return refund.label;
  if (/cancel|storn/i.test(`${order.cancelState || ''} ${order.orderFulfillmentStatus || ''}`)) return 'cancelled';
  return null;
}

function toneForAmount(amount: number, kind: string): string {
  if (kind === 'sale') return 'text-slate-900';
  if (amount < 0) return 'text-orange-700';
  return 'text-emerald-800';
}

type Props = {
  order: EbayOrderRecord;
  items: InventoryItem[];
  apiOrders?: EbayOrderRecord[];
  onClose: () => void;
};

const EbayHubOrderDetailModal: React.FC<Props> = ({ order, items, apiOrders, onClose }) => {
  const refund = hubRefundDisplay(order);
  const status = statusLabel(order);
  const net = getOrderEffectiveNet(order);
  const display = hubOrderDisplayTitle(order, items, apiOrders);
  const line = order.lineItems[0] || { sku: null, title: display.title, lineItemCost: order.grossTotal ?? null };
  const split = saleProceedsFromOrder(order, line);
  const moneyRows = saleProceedsRows(split);
  const events = useMemo(
    () =>
      [...(order.financialEvents || [])].sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [order.financialEvents]
  );
  const linked = useMemo(
    () => items.filter((item) => hubOrderIdFromItem(item) === order.orderId),
    [items, order.orderId]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hub-order-detail-title"
    >
      <div
        className="bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-orange-50 to-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-orange-700">Seller Hub order</p>
            <h2 id="hub-order-detail-title" className="text-base font-black text-slate-900 font-mono truncate">
              {order.orderId}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] font-bold text-slate-600 tabular-nums">
                {formatHubDate(order.creationDate)}
              </span>
              {status && (
                <span
                  className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    refund.kind === 'partial' || refund.kind === 'flagged'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {status}
                  {refund.refundEur >= 0.01 ? ` €${formatEUR(refund.refundEur)}` : ''}
                </span>
              )}
              {order.orderPaymentStatus && !/refund/i.test(order.orderPaymentStatus) && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {order.orderPaymentStatus}
                </span>
              )}
              {order.orderFulfillmentStatus && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {order.orderFulfillmentStatus}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <section className="rounded-xl border border-slate-200 p-3 space-y-1.5">
            <p className="text-[10px] font-black uppercase text-slate-400">Buyer</p>
            <p className="text-sm font-black text-slate-900">
              {order.buyer.fullName || order.buyer.username || '—'}
            </p>
            {order.buyer.username && order.buyer.fullName && (
              <p className="text-[11px] text-slate-500">@{order.buyer.username}</p>
            )}
            {order.buyer.address && (
              <p className="text-[12px] text-slate-600 whitespace-pre-line leading-relaxed">{order.buyer.address}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
              {order.buyer.email && <span>{order.buyer.email}</span>}
              {order.buyer.phone && <span>{order.buyer.phone}</span>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 overflow-hidden">
            <p className="text-[10px] font-black uppercase text-slate-400 px-3 pt-3 pb-1.5">Articles</p>
            {order.lineItems.length === 0 && !display.title ? (
              <p className="px-3 pb-3 text-xs text-slate-500">No line items on this Hub row.</p>
            ) : order.lineItems.length === 0 ? (
              <ul className="divide-y divide-slate-100">
                <li className="px-3 py-2 flex items-start justify-between gap-3">
                  <p className="text-[13px] font-bold text-slate-900 leading-snug">{display.title}</p>
                  <span className="text-[13px] font-black tabular-nums text-slate-800 shrink-0">
                    {order.grossTotal != null ? `€${formatEUR(order.grossTotal)}` : '—'}
                  </span>
                </li>
              </ul>
            ) : (
              <ul className="divide-y divide-slate-100">
                {order.lineItems.map((li, idx) => (
                  <li key={`${li.listingId || li.sku || li.title}-${idx}`} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-slate-900 leading-snug">{li.title || display.title || '—'}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {[li.sku ? `SKU ${li.sku}` : null, li.listingId ? `#${li.listingId}` : null, li.quantity && li.quantity > 1 ? `×${li.quantity}` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                    </div>
                    <span className="text-[13px] font-black tabular-nums text-slate-800 shrink-0">
                      {li.lineItemCost != null ? `€${formatEUR(li.lineItemCost)}` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {refund.refundEur >= 0.01 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                  {refund.label || 'Refunded to buyer'}
                </p>
                <p className="text-[11px] text-rose-800/80 mt-0.5">Amount returned to the buyer</p>
              </div>
              <p className="text-lg font-black tabular-nums text-rose-700 shrink-0">
                −€{formatEUR(refund.refundEur)}
              </p>
            </div>
          )}

          <section className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase text-orange-800">Hub split</p>
              {net != null && (
                <span className={`text-[12px] font-black tabular-nums ${net < 0 ? 'text-rose-700' : 'text-emerald-800'}`}>
                  net €{formatEUR(net)}
                </span>
              )}
            </div>
            {split.feesEstimated ? (
              <p className="text-[11px] text-amber-800">No Finanzamt-grade fee events on this row yet.</p>
            ) : moneyRows.length === 0 ? (
              <p className="text-[11px] text-slate-500">No payout lines.</p>
            ) : (
              moneyRows.map((row) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between gap-3 text-[12px] font-bold tabular-nums ${
                    row.tone === 'total' || row.tone === 'net' ? 'pt-1.5 mt-1 border-t border-orange-100' : ''
                  }`}
                >
                  <span className={row.id === 'refund' ? 'text-rose-800 font-black' : 'text-slate-600'}>{row.label}</span>
                  <span
                    className={
                      row.id === 'refund'
                        ? 'text-rose-700 font-black'
                        : row.tone === 'out'
                          ? 'text-orange-700'
                          : row.tone === 'net'
                            ? 'text-emerald-800 font-black'
                            : 'text-slate-900'
                    }
                  >
                    {row.amount < 0 ? '−' : ''}€{formatEUR(Math.abs(row.amount))}
                  </span>
                </div>
              ))
            )}
          </section>

          {events.length > 0 && (
            <section className="rounded-xl border border-slate-200 overflow-hidden">
              <p className="text-[10px] font-black uppercase text-slate-400 px-3 pt-3 pb-1.5">
                Events ({events.length})
              </p>
              <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {events.map((event) => (
                  <li key={event.id} className="px-3 py-1.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-800 truncate">{describeFinancialEvent(event)}</p>
                      <p className="text-[10px] text-slate-400">
                        {formatHubDate(event.date)} · {event.kind}
                      </p>
                    </div>
                    <span className={`text-[11px] font-black tabular-nums shrink-0 ${toneForAmount(event.amount, event.kind)}`}>
                      {event.amount < 0 ? '−' : ''}€{formatEUR(Math.abs(event.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {linked.length > 0 && (
            <section className="rounded-xl border border-slate-200 p-3 space-y-1.5">
              <p className="text-[10px] font-black uppercase text-slate-400">Linked inventory</p>
              {linked.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <ItemLink item={item} itemId={item.id} itemName={item.name} items={items} />
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {item.status}
                    {item.sellDate ? ` · ${formatHubDate(item.sellDate)}` : ''}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EbayHubOrderDetailModal;
export { formatHubDate };
