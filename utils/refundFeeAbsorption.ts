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
 *
 * BUNDLE/PC HANDLING: the app enforces container.buyPrice === sum(children.buyPrice),
 * resynced on every save (services/containerAggregates.ts). Bumping a container's own
 * buyPrice field directly is silently overwritten back to the (unchanged) children sum on
 * the very next update — the fee never actually sticks anywhere. So when the target is a
 * bundle/PC, the fee is instead distributed across its children proportional to each
 * child's current share of the total, and the container's buyPrice is set to the resulting
 * (self-consistent) new sum. This also means removing a child later carries its own
 * already-adjusted price with it correctly, instead of leaving a phantom amount behind.
 */
import type { EbaySaleAdjustment, InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { appendBuyPriceChange } from '../services/priceHistory';
import {
  applyRestockAfterRefundToItem,
  orderCancellationCostAbs,
  round2,
} from './ebaySaleAdjustments';
import { getContainerChildParts } from './containerBuyPriceRecalc';
import type { EbayTxOrderLedger } from './ebayTransactionReport';

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
 * Distributes `feeEur` across `children` proportional to each one's current buyPrice share
 * (an expensive part absorbs more than a cheap one). Children with no measurable share split
 * it equally. Returns only the children that actually changed (delta >= 1 cent).
 */
function distributeFeeAcrossChildren(
  children: InventoryItem[],
  feeEur: number,
  orderId: string,
  reasonPrefix: string,
  dateIso: string
): InventoryItem[] {
  const childrenSum = children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
  const updated: InventoryItem[] = [];
  for (const c of children) {
    const share = childrenSum > 0.01 ? (Number(c.buyPrice) || 0) / childrenSum : 1 / children.length;
    const delta = round2(feeEur * share);
    if (delta < 0.01) continue;
    const buyBefore = round2(c.buyPrice);
    const buyAfter = round2(buyBefore + delta);
    updated.push(
      appendBuyPriceChange(
        { ...c, buyPrice: buyAfter },
        {
          buyBefore,
          buyAfter,
          reason: 'refund_capitalize',
          reasonLabel: `${reasonPrefix} — +€${delta.toFixed(2)} allocated share`,
          orderId,
          date: dateIso,
        }
      )
    );
  }
  return updated;
}

/**
 * Capitalizes `feeEur` into `item`'s buy price (or, for a bundle/PC, distributed across its
 * children — see file header) and records the audit trail. No-op if this order's fee was
 * already absorbed into this item. Returns every changed item — a standalone target is
 * `[item]`, a bundle target is `[updatedParent, ...updatedChildren]`.
 */
export function applyRefundFeeAbsorption(
  item: InventoryItem,
  orderId: string,
  feeEur: number,
  allItems: InventoryItem[],
  note?: string
): InventoryItem[] {
  if (hasAbsorbedRefundFee(item, orderId)) return [item];
  const fee = round2(Math.max(0, feeEur));
  if (fee < 0.01) return [item];

  const children = getContainerChildParts(item, allItems);
  const dateIso = new Date().toISOString().slice(0, 10);

  if (!children.length) {
    const buyBefore = round2(item.buyPrice);
    const buyAfter = round2(buyBefore + fee);
    const adjustment: EbaySaleAdjustment = {
      id: `fee-absorb-${orderId}-${item.id}`,
      date: dateIso,
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
    return [
      appendBuyPriceChange(withAdjustment, {
        buyBefore,
        buyAfter,
        reason: 'refund_capitalize',
        reasonLabel: `Absorbed refund fee +€${fee.toFixed(2)} from order ${orderId}`,
        orderId,
      }),
    ];
  }

  // Bundle/PC — distribute across children, then set the container to the new true sum.
  const updatedChildren = distributeFeeAcrossChildren(
    children,
    fee,
    orderId,
    note?.trim() || `Absorbed refund/cancellation fee from order ${orderId}`,
    dateIso
  );
  const byId = new Map(updatedChildren.map((c) => [c.id, c]));
  const newContainerBuyPrice = round2(
    children.reduce((s, c) => s + Number((byId.get(c.id) || c).buyPrice ?? 0), 0)
  );
  const updatedParent: InventoryItem = {
    ...item,
    buyPrice: newContainerBuyPrice,
    pendingRefundFeeOrderIds: [...(item.pendingRefundFeeOrderIds || []), orderId],
  };
  return [updatedParent, ...updatedChildren];
}

// ---------------------------------------------------------------------------
// Own-order auto-revert: an item's OWN linked order comes back fully refunded.
// Unlike the manual absorb-into-candidate flow above, this is unambiguous — it's that
// exact item's own sale, so it's safe to apply automatically (no item to pick). Reuses
// the same applyRestockAfterRefundToItem mutator as the app's existing (dead-code) Seller
// Hub matcher, just fed from Abrechnung's EbayTxRow/ledger data instead of EbayOrderRecord.
// ---------------------------------------------------------------------------

/**
 * True once this item has already been reverted-to-stock for this specific order.
 *
 * Checks priceHistory rather than ebaySaleAdjustments: applyRestockAfterRefundToItem routes
 * through archiveActiveSaleAndClear (utils/itemSaleCycle.ts), which explicitly wipes
 * ebaySaleAdjustments back to undefined as part of clearing the just-closed sale's live
 * fields — so an adjustment recorded there never actually survives the same call that adds
 * it. priceHistory is a separate array that call never touches, and
 * appendBuyPriceHistory/appendBuyPriceChange always records a 'refund_capitalize' entry
 * tagged with the orderId, so it's the reliable signal here.
 */
export function hasOwnOrderRefundRevert(item: Pick<InventoryItem, 'priceHistory'>, orderId: string): boolean {
  return (item.priceHistory || []).some((h) => h.reason === 'refund_capitalize' && h.orderId === orderId);
}

/**
 * Reverts `item` to In Stock and capitalizes the order's leftover fee/loss into its buy
 * price — for when the item's OWN order (item.ebayOrderId === orderId) is fully refunded.
 * For a bundle/PC, the fee is distributed across its children (see file header) instead of
 * the container's own buyPrice, which is derived and won't hold a direct bump. Returns every
 * changed item — a standalone item is `[reverted]`, a bundle is `[revertedParent, ...updatedChildren]`.
 * No-op (returns `[item]`) if already reverted for this order.
 */
export function applyOwnOrderRefundRevert(
  item: InventoryItem,
  orderId: string,
  feeEur: number,
  allItems: InventoryItem[],
  dateIso?: string
): InventoryItem[] {
  if (hasOwnOrderRefundRevert(item, orderId)) return [item];
  const fee = round2(Math.max(0, feeEur));
  const date = (dateIso || new Date().toISOString()).slice(0, 10);
  const children = getContainerChildParts(item, allItems);

  let buyAfter: number;
  let updatedChildren: InventoryItem[] = [];
  if (children.length) {
    updatedChildren = distributeFeeAcrossChildren(
      children,
      fee,
      orderId,
      `Bundle order ${orderId} fully refunded`,
      `${date}T12:00:00.000Z`
    );
    const byId = new Map(updatedChildren.map((c) => [c.id, c]));
    buyAfter = round2(children.reduce((s, c) => s + Number((byId.get(c.id) || c).buyPrice ?? 0), 0));
  } else {
    buyAfter = round2(round2(item.buyPrice) + fee);
  }

  const buyBefore = round2(item.buyPrice);
  const adjustment: EbaySaleAdjustment = {
    id: `adj-restock-${orderId}-${item.id}`,
    date,
    kind: 'restock_after_refund',
    amount: -fee,
    orderId,
    reason:
      fee > 0
        ? children.length
          ? `Fully refunded on order ${orderId} — €${fee.toFixed(2)} allocated across ${children.length} part(s), item returned to stock`
          : `Fully refunded on order ${orderId} — €${fee.toFixed(2)} leftover fees/costs added to buy price, item returned to stock`
        : `Fully refunded on order ${orderId} — item returned to active inventory`,
    source: 'ebay_sync',
    importedAt: new Date().toISOString(),
    sellPriceBefore: item.sellPrice ?? 0,
    sellPriceAfter: 0,
    revertToStock: true,
    buyPriceBefore: buyBefore,
    buyPriceAfter: buyAfter,
    buyPriceDelta: round2(buyAfter - buyBefore),
  };
  const revertedParent = applyRestockAfterRefundToItem(item, adjustment);
  return [revertedParent, ...updatedChildren];
}

/**
 * Scans all SOLD items whose own linked order is now fully refunded (order pocket ≤ 0) and
 * haven't been reverted yet — the candidates for automatic revert-to-stock.
 */
export function findOwnOrderFullRefundReverts(
  items: InventoryItem[],
  ledgers: Map<string, EbayTxOrderLedger>
): InventoryItem[] {
  const updates: InventoryItem[] = [];
  for (const item of items) {
    if (item.status !== ItemStatus.SOLD) continue;
    const orderId = (item.ebayOrderId || '').trim();
    if (!orderId) continue;
    const ledger = ledgers.get(orderId);
    if (!ledger) continue;
    const pocket = ledger.pocketEur;
    if (pocket == null || !Number.isFinite(pocket) || pocket > 0.01) continue;
    if (hasOwnOrderRefundRevert(item, orderId)) continue;
    const fee = orderCancellationCostAbs(pocket);
    updates.push(...applyOwnOrderRefundRevert(item, orderId, fee, items));
  }
  return updates;
}
