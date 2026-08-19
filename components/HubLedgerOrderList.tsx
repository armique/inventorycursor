import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronUp, Link2, Loader2 } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet, hubRefundDisplay } from '../utils/ebayOrderFinancial';
import { saleProceedsFromOrder } from '../utils/saleProceeds';
import { hubOrderDisplayTitle } from '../utils/ebayHubOrderTitle';
import { hubOrderIdFromItem, type HubBreakdownReplaceRow } from '../utils/replaceItemSaleProceedsFromHub';
import { scoreItemAgainstOrderLine } from '../utils/ebayOrderMatch';
import { formatEUR } from '../utils/formatMoney';
import { formatHubDate } from './EbayHubOrderDetailModal';

const ROW_H = 68;
const GRID =
  'grid grid-cols-[5.25rem_minmax(11rem,1.5fr)_minmax(7rem,0.8fr)_minmax(8.5rem,0.95fr)_repeat(6,minmax(3.6rem,0.55fr))_minmax(12.5rem,1.15fr)] gap-x-2 items-start';

function money(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `€${formatEUR(n)}` : '—';
}

export function hubSplitFromOrder(order: EbayOrderRecord) {
  const line = order.lineItems[0] || {
    sku: null,
    title: '',
    lineItemCost: order.grossTotal ?? null,
  };
  const p = saleProceedsFromOrder(order, line);
  return {
    total: p.buyerTotalEur ?? order.grossTotal,
    ads: Math.abs(p.adFeeEur ?? 0),
    ebay: Math.abs(p.transactionFeeEur ?? 0),
    ship: Math.abs(p.shippingLabelEur ?? 0),
    net: p.netPayoutEur ?? getOrderEffectiveNet(order),
  };
}

export function candidateItemsForHubOrder(
  order: EbayOrderRecord,
  items: InventoryItem[],
  query: string
): InventoryItem[] {
  const q = query.trim().toLowerCase();
  const scored = items
    .filter((item) => {
      if (item.isDraft) return false;
      if (item.status === ItemStatus.GIFTED) return false;
      if (!q) return true;
      return [item.name, item.ebaySku, item.ebayListingId, item.ebayOrderId, item.customer?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    })
    .map((item) => {
      const lineScore = Math.max(
        0,
        ...(order.lineItems.length
          ? order.lineItems.map((li) => scoreItemAgainstOrderLine(item, order, li).matchScore)
          : [0])
      );
      const idHit = hubOrderIdFromItem(item) === order.orderId ? 5000 : 0;
      return { item, score: lineScore + idHit };
    })
    .filter((row) => (q ? true : row.score >= 28 || hubOrderIdFromItem(row.item) === order.orderId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((row) => row.item);
  return scored;
}

type Props = {
  orders: EbayOrderRecord[];
  items: InventoryItem[];
  apiOrders: EbayOrderRecord[];
  replaceByOrderId: Map<string, HubBreakdownReplaceRow[]>;
  linkedByOrderId: Map<string, InventoryItem[]>;
  applyingOrderId: string | null;
  dateSort: 'desc' | 'asc';
  emptyMessage?: string;
  onToggleDateSort: () => void;
  onOpenOrder: (orderId: string) => void;
  onApplyPending: (rows: HubBreakdownReplaceRow[]) => void;
  onLinkItem: (order: EbayOrderRecord, item: InventoryItem) => void;
};

const HubLedgerOrderList: React.FC<Props> = ({
  orders,
  items,
  apiOrders,
  replaceByOrderId,
  linkedByOrderId,
  applyingOrderId,
  dateSort,
  emptyMessage = 'No orders match.',
  onToggleDateSort,
  onOpenOrder,
  onApplyPending,
  onLinkItem,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [pickerOrderId, setPickerOrderId] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');

  useEffect(() => {
    setPickerQuery('');
  }, [pickerOrderId]);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (orders[index]?.orderId === pickerOrderId ? 268 : ROW_H),
    overscan: 18,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [pickerOrderId, virtualizer]);

  const pickerOrder = useMemo(
    () => (pickerOrderId ? orders.find((o) => o.orderId === pickerOrderId) ?? null : null),
    [orders, pickerOrderId]
  );
  const pickerItems = useMemo(
    () => (pickerOrder ? candidateItemsForHubOrder(pickerOrder, items, pickerQuery) : []),
    [pickerOrder, items, pickerQuery]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100 overflow-x-auto">
      <div className="min-w-[76rem] flex-1 min-h-0 flex flex-col">
        <div
          className={`${GRID} shrink-0 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[9px] font-black uppercase tracking-wider text-slate-400`}
        >
          <button
            type="button"
            onClick={onToggleDateSort}
            className="inline-flex items-center gap-1 text-slate-700 hover:text-orange-800 text-left"
            aria-sort={dateSort === 'desc' ? 'descending' : 'ascending'}
            title={dateSort === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
          >
            Date
            {dateSort === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <span>Item</span>
          <span>Buyer</span>
          <span>Order</span>
          <span className="text-right">Total</span>
          <span className="text-right">Refund</span>
          <span className="text-right">Ads</span>
          <span className="text-right">eBay</span>
          <span className="text-right">Label</span>
          <span className="text-right">Net</span>
          <span>Inventory split</span>
        </div>
        <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
          {orders.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-16">{emptyMessage}</p>
          ) : (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((row) => {
              const order = orders[row.index];
              const split = hubSplitFromOrder(order);
              const refund = hubRefundDisplay(order);
              const pending = replaceByOrderId.get(order.orderId) || [];
              const linked = linkedByOrderId.get(order.orderId) || [];
              const display = hubOrderDisplayTitle(order, items, apiOrders);
              const itemName = display.title || order.lineItems[0]?.sku || '—';
              const applying = applyingOrderId === order.orderId;
              const alreadyHub = linked.some((i) => i.saleProceeds?.source === 'ebay_seller_hub' && !i.saleProceeds?.feesEstimated);
              return (
                <div
                  key={order.orderId}
                  className={`${GRID} absolute left-0 right-0 px-3 py-2 border-b border-slate-100 hover:bg-orange-50/60 cursor-pointer ${
                    pending.length ? 'bg-amber-50/40' : refund.refundEur >= 0.01 ? 'bg-rose-50/40' : ''
                  }`}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  onClick={() => onOpenOrder(order.orderId)}
                >
                  <span className="text-[12px] font-bold tabular-nums text-slate-800 pt-0.5">
                    {formatHubDate(order.creationDate)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 leading-snug line-clamp-2" title={itemName}>
                      {itemName}
                    </p>
                    {display.extraCount > 0 && (
                      <p className="text-[10px] font-bold text-slate-400">+{display.extraCount} more</p>
                    )}
                  </div>
                  <p className="text-[12px] font-bold text-slate-800 truncate">
                    {order.buyer.fullName || order.buyer.username || '—'}
                  </p>
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-black text-slate-900 truncate">{order.orderId}</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {orderHasFeeBreakdown(order) && (
                        <span className="text-[8px] font-black uppercase px-1 py-px rounded bg-emerald-50 text-emerald-800">
                          fees
                        </span>
                      )}
                      {refund.label && (
                        <span className="text-[8px] font-black uppercase px-1 py-px rounded bg-rose-50 text-rose-800">
                          {refund.label}
                          {refund.refundEur >= 0.01 ? ` €${formatEUR(refund.refundEur)}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-right tabular-nums text-[12px] font-bold text-slate-800 pt-0.5">
                    {money(split.total)}
                  </span>
                  <span
                    className={`text-right tabular-nums text-[12px] font-black pt-0.5 ${
                      refund.refundEur >= 0.01 ? 'text-rose-700' : 'text-slate-300'
                    }`}
                  >
                    {refund.refundEur >= 0.01 ? `−${money(refund.refundEur)}` : '—'}
                  </span>
                  <span className="text-right tabular-nums text-[12px] font-bold text-orange-800 pt-0.5">
                    {split.ads >= 0.01 ? money(split.ads) : '—'}
                  </span>
                  <span className="text-right tabular-nums text-[12px] font-bold text-orange-800 pt-0.5">
                    {split.ebay >= 0.01 ? money(split.ebay) : '—'}
                  </span>
                  <span className="text-right tabular-nums text-[12px] font-bold text-slate-600 pt-0.5">
                    {split.ship >= 0.01 ? money(split.ship) : '—'}
                  </span>
                  <span
                    className={`text-right tabular-nums text-[12px] font-black pt-0.5 ${
                      split.net != null && split.net < 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {money(split.net)}
                  </span>
                  <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                    {pending.length > 0 ? (
                      <button
                        type="button"
                        disabled={applying}
                        onClick={() => onApplyPending(pending)}
                        className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-600 text-white text-[9px] font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-50"
                        title={pending.map((r) => r.itemName).join(' · ')}
                      >
                        {applying ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                        Apply Hub split
                        {pending.length > 1 ? ` ×${pending.length}` : ''}
                      </button>
                    ) : alreadyHub ? (
                      <p className="text-[10px] font-bold text-emerald-800 flex items-center gap-1 truncate">
                        <Check size={11} className="shrink-0" />
                        {linked[0]?.name || 'Linked'}
                      </p>
                    ) : (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setPickerOrderId((id) => (id === order.orderId ? null : order.orderId))
                          }
                          className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-orange-200 bg-white text-orange-900 text-[9px] font-black uppercase tracking-wide hover:bg-orange-50"
                        >
                          <Link2 size={11} />
                          {linked.length ? 'Fix split' : 'Link item'}
                        </button>
                        {pickerOrderId === order.orderId && (
                          <div className="mt-1 z-20 w-full rounded-xl border border-slate-200 bg-white shadow-lg p-2">
                            <input
                              autoFocus
                              value={pickerQuery}
                              onChange={(e) => setPickerQuery(e.target.value)}
                              placeholder="Search inventory…"
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] mb-1.5"
                            />
                            <div className="max-h-56 overflow-auto space-y-0.5">
                              {pickerItems.length === 0 ? (
                                <p className="text-[11px] text-slate-500 px-1 py-2">No matching items.</p>
                              ) : (
                                pickerItems.map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    disabled={applying}
                                    onClick={() => {
                                      onLinkItem(order, item);
                                      setPickerOrderId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50"
                                  >
                                    <p className="text-[11px] font-bold text-slate-900 truncate">{item.name}</p>
                                    <p className="text-[9px] text-slate-500 font-bold uppercase">
                                      {item.status}
                                      {item.sellPrice != null ? ` · €${formatEUR(item.sellPrice)}` : ''}
                                    </p>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {pending.length > 0 && pending[0] && (
                      <p className="text-[9px] text-slate-500 truncate mt-0.5" title={pending[0].itemName}>
                        {pending[0].itemName}
                        {pending.length > 1 ? ` +${pending.length - 1}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HubLedgerOrderList;
