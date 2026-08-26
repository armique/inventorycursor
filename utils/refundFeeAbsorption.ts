/**
 * Manual refund/cancellation fee absorption — you identify which in-stock item should eat
 * the fee from a refunded/cancelled order (an order you didn't necessarily sell THIS item
 * on), the app capitalizes it into that item's buy price and keeps the item flagged as a
 * "candidate" (still sellable, awaiting relink to the actual successful order later).
 *
 * Distinct from utils/ebaySaleAdjustments.ts's applyRestockAfterRefundToItem, which handles
 * the item's OWN order being refunded (closes the sale cycle, reverts status to IN_STOCK).
 * Here the target item is picked manually and its status/sale state are untouched — it may
 * already be IN_STOCK (a fresh candidate) or may later get linked normally via
 * linkInventoryItemToEbayTx, which naturally ends its "candidate" visual state once SOLD.
 */
import type { EbaySaleAdjustment, InventoryItem } from '../types';
import { appendBuyPriceChange } from '../services/priceHistory';
import { round2 } from './ebaySaleAdjustments';

/** True once this order's fee has already been absorbed into this item (idempotency guard). */
export function hasAbsorbedRefundFee(item: Pick<InventoryItem, 'pendingRefundFeeOrderIds'>, orderId: string): boolean {
  return (item.pendingRefundFeeOrderIds || []).includes(orderId);
}

/** In-stock item still carrying an absorbed fee it hasn't been resold against yet — the
 *  "candidate, different color" state from your spec. */
export function isPendingRefundFeeCandidate(item: Pick<InventoryItem, 'status' | 'pendingRefundFeeOrderIds'>): boolean {
  return item.status === 'In Stock' && (item.pendingRefundFeeOrderIds || []).length > 0;
}

/** Finds the item (if any) that already absorbed a given order's fee — for the retroactive
 *  "which refunded orders still need this" queue. */
export function findItemThatAbsorbedOrderFee(items: InventoryItem[], orderId: string): InventoryItem | undefined {
  return items.find((i) => hasAbsorbedRefundFee(i, orderId));
}

/**
 * Capitalizes `feeEur` into `item`'s buy price and records the audit trail. No-op (returns
 * item unchanged) if this order's fee was already absorbed into this item.
 */
export function applyRefundFeeAbsorption(
  item: InventoryItem,
  orderId: string,
  feeEur: number,
  note?: string
): InventoryItem {
  if (hasAbsorbedRefundFee(item, orderId)) return item;
  const fee = round2(Math.max(0, feeEur));
  if (fee < 0.01) return item;

  const buyBefore = round2(item.buyPrice);
  const buyAfter = round2(buyBefore + fee);
  const adjustment: EbaySaleAdjustment = {
    id: `fee-absorb-${orderId}-${item.id}`,
    date: new Date().toISOString().slice(0, 10),
    kind: 'fee_adjustment',
    amount: -fee,
    orderId,
    reason: note?.trim() || `Absorbed refund/cancellation fee from order ${orderId}`,
    source: 'ebay_sync',
    importedAt: new Date().toISOString(),
    sellPriceBefore: item.sellPrice ?? 0,
    sellPriceAfter: item.sellPrice ?? 0,
    buyPriceBefore: buyBefore,
    buyPriceAfter: buyAfter,
    buyPriceDelta: fee,
  };

  const withAdjustment: InventoryItem = {
    ...item,
    buyPrice: buyAfter,
    ebaySaleAdjustments: [...(item.ebaySaleAdjustments || []), adjustment],
    pendingRefundFeeOrderIds: [...(item.pendingRefundFeeOrderIds || []), orderId],
  };

  return appendBuyPriceChange(withAdjustment, {
    buyBefore,
    buyAfter,
    reason: 'refund_capitalize',
    reasonLabel: `Absorbed refund fee +€${fee.toFixed(2)} from order ${orderId}`,
    orderId,
  });
}
