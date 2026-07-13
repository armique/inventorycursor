import { InventoryItem, ItemStatus, TaxMode, type EbaySaleAdjustment } from '../types';
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
    .map((a) => `${a.date} ${a.reason}: ${a.amount >= 0 ? '+' : ''}€${a.amount.toFixed(2)} (order ${a.orderId})`)
    .join(' | ');
}

export function isLinkedSoldEbayItem(item: InventoryItem): boolean {
  return (
    (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) &&
    Boolean(item.ebayOrderId?.trim())
  );
}
