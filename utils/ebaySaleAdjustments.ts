import { InventoryItem, ItemStatus, TaxMode, type EbaySaleAdjustment, type EbaySaleAdjustmentKind, type PriceHistoryEntry } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import type { EbayOrderFinancialEvent } from '../services/ebayOrderIndex';
import { describeFinancialEvent } from './ebayOrderFinancial';
import { calculateSaleProfit } from './saleProfit';

export function getOriginalSellPrice(item: InventoryItem): number | null {
  if (item.originalSellPrice != null && Number.isFinite(item.originalSellPrice)) {
    return item.originalSellPrice;
  }
  if (item.sellPrice != null && Number.isFinite(item.sellPrice)) return item.sellPrice;
  return null;
}

export function getAppliedEventIds(item: InventoryItem): Set<string> {
  return new Set((item.ebaySaleAdjustments || []).map((a) => a.eventId).filter(Boolean) as string[]);
}

export function sumAdjustmentAmounts(item: InventoryItem): number {
  return round2((item.ebaySaleAdjustments || []).reduce((s, a) => s + a.amount, 0));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Current effective revenue after documented adjustments. */
export function getEffectiveSellPrice(item: InventoryItem): number | null {
  if (item.sellPrice != null && Number.isFinite(item.sellPrice)) return item.sellPrice;
  const original = getOriginalSellPrice(item);
  if (original == null) return null;
  return round2(original + sumAdjustmentAmounts(item));
}

export function mapEventKindToAdjustmentKind(
  kind: EbayOrderFinancialEvent['kind']
): EbaySaleAdjustment['kind'] {
  if (kind === 'return') return 'return';
  if (kind === 'refund') return 'refund';
  if (kind === 'cancellation') return 'cancellation';
  if (kind === 'fee') return 'fee_adjustment';
  return 'payout_correction';
}

export function isRestockAfterRefundAdjustment(adjustment: EbaySaleAdjustment): boolean {
  return adjustment.kind === 'restock_after_refund' || Boolean(adjustment.revertToStock);
}

export function isRefundLikeAdjustmentKind(kind: EbaySaleAdjustmentKind): boolean {
  return kind === 'return' || kind === 'refund' || kind === 'cancellation';
}

export function getAdjustmentSuggestionLabel(adjustment: Pick<EbaySaleAdjustment, 'kind'>): string {
  switch (adjustment.kind) {
    case 'restock_after_refund':
      return 'Restock after refund';
    case 'return':
    case 'refund':
      return 'Return / refund';
    case 'cancellation':
      return 'Cancellation';
    case 'fee_adjustment':
      return 'Fee deduction';
    case 'payout_correction':
      return 'Fix payout';
    default:
      return 'Payout adjustment';
  }
}

export function getAdjustmentSuggestionBadgeClass(adjustment: Pick<EbaySaleAdjustment, 'kind'>): string {
  if (adjustment.kind === 'restock_after_refund') return 'bg-indigo-100 text-indigo-800';
  if (isRefundLikeAdjustmentKind(adjustment.kind)) return 'bg-rose-100 text-rose-900';
  if (adjustment.kind === 'fee_adjustment') return 'bg-slate-100 text-slate-700';
  return 'bg-amber-100 text-amber-900';
}

export function summarizeAdjustmentSuggestions(
  suggestions: Array<{ kind: string; adjustment?: EbaySaleAdjustment }>
): { refundLike: number; payoutFix: number; fee: number; restock: number; total: number } {
  const rows = suggestions.filter((s) => s.kind === 'adjustment' && s.adjustment);
  let refundLike = 0;
  let payoutFix = 0;
  let fee = 0;
  let restock = 0;
  for (const row of rows) {
    const k = row.adjustment!.kind;
    if (k === 'restock_after_refund') restock += 1;
    else if (isRefundLikeAdjustmentKind(k)) refundLike += 1;
    else if (k === 'fee_adjustment') fee += 1;
    else payoutFix += 1;
  }
  return { refundLike, payoutFix, fee, restock, total: rows.length };
}

export function hasRestockAfterRefundAdjustment(item: InventoryItem): boolean {
  return (item.ebaySaleAdjustments || []).some(isRestockAfterRefundAdjustment);
}

/** Cancellation / refund loss on order (positive EUR) — e.g. DHL label when net Bestelleinnahmen is negative. */
export function orderCancellationCostAbs(orderNet: number): number {
  if (!Number.isFinite(orderNet) || orderNet >= -0.01) return 0;
  return round2(Math.abs(orderNet));
}

export function buildRestockAfterRefundAdjustment(
  item: InventoryItem,
  order: EbayOrderRecord,
  orderNet: number
): EbaySaleAdjustment {
  const sellBefore = getEffectiveSellPrice(item) ?? item.sellPrice ?? 0;
  const buyBefore = round2(item.buyPrice);
  const buyDelta = orderCancellationCostAbs(orderNet);
  const buyAfter = round2(buyBefore + buyDelta);
  const date = order.lastModifiedDate || order.creationDate || new Date().toISOString().split('T')[0];
  const reason =
    buyDelta > 0
      ? `Full refund on order ${order.orderId} — €${buyDelta.toFixed(2)} cancellation cost added to buy price (DHL label & fees)`
      : `Full refund on order ${order.orderId} — item returned to active inventory`;

  return {
    id: `adj-restock-${order.orderId}-${item.id}`,
    date,
    kind: 'restock_after_refund',
    amount: round2(0 - sellBefore),
    orderId: order.orderId,
    reason,
    source: 'ebay_csv',
    importedAt: new Date().toISOString(),
    sellPriceBefore: sellBefore,
    sellPriceAfter: 0,
    feeBefore: item.feeAmount,
    feeAfter: 0,
    revertToStock: true,
    buyPriceBefore: buyBefore,
    buyPriceAfter: buyAfter,
    buyPriceDelta: buyDelta,
  };
}

function appendRefundNote(comment2: string, adjustment: EbaySaleAdjustment): string {
  const note = `[eBay refund ${adjustment.orderId}]: Buy price +€${(adjustment.buyPriceDelta ?? 0).toFixed(2)} — ${adjustment.reason}`;
  if (comment2.includes(adjustment.orderId) && comment2.includes('Buy price +€')) return comment2;
  return comment2.trim() ? `${comment2.trim()}\n\n${note}` : note;
}

function appendBuyPriceHistory(
  item: InventoryItem,
  buyBefore: number,
  buyAfter: number,
  date: string
): PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [...(item.priceHistory || [])];
  entries.push({
    date: `${date}T12:00:00.000Z`,
    type: 'buy',
    price: buyAfter,
    previousPrice: buyBefore,
  });
  return entries;
}

/** Full refund — back to inventory; capitalize DHL/fees into buy price. */
export function applyRestockAfterRefundToItem(
  item: InventoryItem,
  adjustment: EbaySaleAdjustment
): InventoryItem {
  const existing = item.ebaySaleAdjustments || [];
  if (existing.some((a) => a.id === adjustment.id || (a.eventId && a.eventId === adjustment.eventId))) {
    return item;
  }

  const buyBefore = adjustment.buyPriceBefore ?? item.buyPrice;
  const buyAfter = adjustment.buyPriceAfter ?? round2(buyBefore + (adjustment.buyPriceDelta ?? 0));
  const originalSell =
    item.originalSellPrice ??
    (item.sellPrice != null ? item.sellPrice : adjustment.sellPriceBefore);

  return {
    ...item,
    status: ItemStatus.IN_STOCK,
    buyPrice: buyAfter,
    sellPrice: undefined,
    profit: undefined,
    sellDate: undefined,
    platformSold: undefined,
    paymentType: undefined,
    feeAmount: undefined,
    hasFee: false,
    customer: undefined,
    invoiceNumber: undefined,
    originalSellPrice: originalSell,
    workflowStage: item.listedOnEbay ? 'Listed' : item.workflowStage === 'Sold' || item.workflowStage === 'Shipped' ? 'Ready' : item.workflowStage,
    comment2: appendRefundNote(item.comment2, adjustment),
    priceHistory: appendBuyPriceHistory(item, buyBefore, buyAfter, adjustment.date),
    ebaySaleAdjustments: [...existing, adjustment],
  };
}

export function buildAdjustmentFromEvent(
  item: InventoryItem,
  event: EbayOrderFinancialEvent,
  orderId: string,
  prorateFactor = 1
): EbaySaleAdjustment | null {
  const amount = round2(event.amount * prorateFactor);
  if (Math.abs(amount) < 0.01) return null;
  const sellBefore = getEffectiveSellPrice(item) ?? getOriginalSellPrice(item) ?? 0;
  const sellAfter = round2(sellBefore + amount);
  return {
    id: `adj-${event.id}`,
    eventId: event.id,
    date: event.date || new Date().toISOString().split('T')[0],
    kind: mapEventKindToAdjustmentKind(event.kind),
    amount,
    orderId,
    reason: describeFinancialEvent(event),
    source: event.source === 'csv' ? 'ebay_csv' : 'ebay_api',
    importedAt: new Date().toISOString(),
    sellPriceBefore: sellBefore,
    sellPriceAfter: sellAfter,
    feeBefore: item.feeAmount,
    feeAfter: item.feeAmount,
  };
}

/** Append documented adjustment — preserves originalSellPrice for Finanzamt audit. */
export function applyEbaySaleAdjustmentToItem(
  item: InventoryItem,
  adjustment: EbaySaleAdjustment,
  taxMode: TaxMode
): InventoryItem {
  if (isRestockAfterRefundAdjustment(adjustment)) {
    return applyRestockAfterRefundToItem(item, adjustment);
  }

  const existing = item.ebaySaleAdjustments || [];
  if (existing.some((a) => a.id === adjustment.id || (a.eventId && a.eventId === adjustment.eventId))) {
    return item;
  }

  const original =
    item.originalSellPrice ??
    (item.sellPrice != null ? item.sellPrice : adjustment.sellPriceBefore);

  const sellPrice = adjustment.sellPriceAfter;
  const fee = adjustment.feeAfter ?? item.feeAmount ?? 0;
  const profit = calculateSaleProfit(sellPrice, item.buyPrice, fee, taxMode);

  return {
    ...item,
    originalSellPrice: original,
    sellPrice,
    profit: parseFloat(profit.toFixed(2)),
    hasFee: fee > 0,
    feeAmount: fee,
    ebaySaleAdjustments: [...existing, adjustment],
  };
}

export function formatAdjustmentsForFinanzamt(item: InventoryItem): string {
  const rows = item.ebaySaleAdjustments || [];
  if (!rows.length) return '';
  return rows
    .map((a) => {
      const sellPart = `${a.amount >= 0 ? '+' : ''}€${a.amount.toFixed(2)} sell`;
      const buyPart =
        a.buyPriceDelta != null && a.buyPriceDelta > 0
          ? `; buy +€${a.buyPriceDelta.toFixed(2)} (EK €${(a.buyPriceBefore ?? 0).toFixed(2)}→€${(a.buyPriceAfter ?? 0).toFixed(2)})`
          : '';
      const restockPart = a.revertToStock ? '; restocked' : '';
      return `${a.date} ${a.reason}: ${sellPart}${buyPart}${restockPart} (order ${a.orderId})`;
    })
    .join(' | ');
}

export function isLinkedSoldEbayItem(item: InventoryItem): boolean {
  return (
    (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) &&
    Boolean(item.ebayOrderId?.trim())
  );
}
