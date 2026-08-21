import type { ActionHistoryEntry, InventoryItem, ItemSaleCycleReason } from '../types';
import { ItemStatus } from '../types';
import type { EbayOrderRecord } from './ebayOrderIndex';
import { loadEbayOrderIndex } from './ebayOrderIndex';
import { mergeHubOverApiOrders } from './ebayHubArchiveIndex';
import { getChildren, getParentContainer } from './financialAggregation';
import { syncContainerBuyTotalsFromComponents } from './containerAggregates';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { allocateFullRefundRestockLoss, round2 } from '../utils/ebaySaleAdjustments';
import { archiveActiveSaleAndClear } from '../utils/itemSaleCycle';
import { hubRefundDisplay } from '../utils/ebayOrderFinancial';
import { appendBuyPriceChange } from './priceHistory';

const ARCHIVE_KEY = 'action_history_archive_v1';
const RETENTION_DAYS = 90;
const SPLIT_SOLD_ID_RE = /^(.*)-sold-\d+$/;
const SOLD_QTY_NAME_RE = /\s*\(Sold x\d+\)\s*$/i;
const RETURNED_NOTE_RE = /\[Returned /i;

export function pruneActionHistory(entries: ActionHistoryEntry[]): {
  active: ActionHistoryEntry[];
  archivedCount: number;
} {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const active: ActionHistoryEntry[] = [];
  const archived: ActionHistoryEntry[] = [];

  for (const e of entries) {
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(t) && t < cutoff) archived.push(e);
    else active.push(e);
  }

  if (archived.length > 0) {
    try {
      const prev = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]') as ActionHistoryEntry[];
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...archived, ...prev].slice(0, 2000)));
    } catch {
      /* ignore */
    }
  }

  return { active, archivedCount: archived.length };
}

export function isRestockableSale(item: Pick<InventoryItem, 'status'> | undefined | null): boolean {
  return item?.status === ItemStatus.SOLD || item?.status === ItemStatus.GIFTED;
}

/** Hub ledger first, then Fulfillment/API cache — used when restocking after Erstattet. */
export function loadRefundOrdersForRestock(): EbayOrderRecord[] {
  try {
    return mergeHubOverApiOrders(loadEbayOrderIndex().orders);
  } catch {
    return [];
  }
}

export function appendReturnedNote(comment2?: string): string {
  const current = comment2 || '';
  if (RETURNED_NOTE_RE.test(current)) return current;
  return `${current} [Returned ${new Date().toLocaleDateString()}]`;
}

export function hasReturnedNote(comment2?: string): boolean {
  return RETURNED_NOTE_RE.test(comment2 || '');
}

function appendRefundLossNote(comment2: string | undefined, delta: number, orderId?: string): string {
  const tag = `[Hub Erstattet +€${delta.toFixed(2)} EK${orderId ? ` ${orderId}` : ''}]`;
  const current = comment2 || '';
  if (current.includes(tag) || (orderId && current.includes(`Hub Erstattet`) && current.includes(orderId))) {
    return current;
  }
  return current.trim() ? `${current.trim()} ${tag}` : tag;
}

function applyBuyPriceLoss(item: InventoryItem, delta: number, orderId?: string): InventoryItem {
  if (delta < 0.01) return item;
  const buyBefore = round2(item.buyPrice);
  const buyAfter = round2(buyBefore + delta);
  const withNote = {
    ...item,
    comment2: appendRefundLossNote(item.comment2, delta, orderId),
  };
  return appendBuyPriceChange(withNote, {
    buyBefore,
    buyAfter,
    reason: orderId ? 'hub_erstattet' : 'restock_loss',
    reasonLabel: orderId
      ? `Erstattet — fees/shipping +€${delta.toFixed(2)} EK · #${orderId}`
      : `Unsold / return — +€${delta.toFixed(2)} EK`,
    orderId,
  });
}

/** Clear live sale fields, archive that sale into ebaySaleCycles, keep listing specs. */
export function restockItemFields(
  item: InventoryItem,
  options?: {
    status?: ItemStatus;
    comment2?: string;
    cycleReason?: ItemSaleCycleReason;
    leftoverLossEur?: number;
    refundEur?: number;
    refundKind?: 'full' | 'partial';
    buyPriceAfter?: number;
  }
): InventoryItem {
  const archived = archiveActiveSaleAndClear(item, options?.cycleReason ?? 'manual_unsold', {
    leftoverLossEur: options?.leftoverLossEur,
    refundEur: options?.refundEur,
    refundKind: options?.refundKind,
    buyPriceAfter: options?.buyPriceAfter,
    status: options?.status,
    comment2: options?.comment2,
  });
  return {
    ...archived,
    name: item.name.replace(SOLD_QTY_NAME_RE, '').trim() || item.name,
  };
}

/** Revert a sale back to In Stock (#62). */
export function applySaleRevert(items: InventoryItem[], itemId: string): InventoryItem[] {
  return items.map((i) => {
    if (i.id !== itemId) return i;
    if (!isRestockableSale(i)) return i;
    return restockItemFields(i, { comment2: appendReturnedNote(i.comment2) });
  });
}

function cycleMetaFromOrder(
  orderId: string | undefined,
  orders: EbayOrderRecord[] | undefined
): {
  cycleReason: ItemSaleCycleReason;
  leftoverLossEur?: number;
  refundEur?: number;
  refundKind?: 'full' | 'partial';
} {
  if (!orderId) return { cycleReason: 'manual_unsold' };
  const order = (orders || []).find((o) => o.orderId === orderId);
  if (!order) return { cycleReason: 'manual_unsold' };
  const refund = hubRefundDisplay(order);
  if (refund.kind === 'full') {
    return { cycleReason: 'erstattet', refundEur: refund.refundEur, refundKind: 'full' };
  }
  if (refund.kind === 'partial') {
    return { cycleReason: 'return', refundEur: refund.refundEur, refundKind: 'partial' };
  }
  return { cycleReason: 'manual_unsold' };
}

function originalIdFromSplitSold(id: string): string | null {
  const m = String(id || '').match(SPLIT_SOLD_ID_RE);
  return m ? m[1] : null;
}

/**
 * Full unsold/restock: selected rows plus sold PC/bundle children, detach from a
 * still-sold parent so the item shows in Active inventory, merge batch split qty.
 */
export function applyUnsoldRestock(
  items: InventoryItem[],
  targetIds: string[],
  options?: { patches?: InventoryItem[]; refundOrders?: EbayOrderRecord[] }
): { updates: InventoryItem[]; deleteIds: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const patchById = new Map((options?.patches || []).map((p) => [p.id, p]));
  const targets = new Set(targetIds.filter(Boolean));
  const changed = new Map<string, InventoryItem>();
  const deleteIds: string[] = [];
  const lossById = allocateFullRefundRestockLoss({
    items,
    restockIds: [...targets],
    orders: options?.refundOrders || [],
  });

  const write = (item: InventoryItem) => {
    byId.set(item.id, item);
    changed.set(item.id, item);
  };

  for (const id of targets) {
    const current = byId.get(id);
    if (!current) continue;
    const patch = patchById.get(id);
    const base = patch ? { ...current, ...patch } : current;
    const orderId = (current.ebayOrderId || '').trim() || undefined;
    const cycleMeta = cycleMetaFromOrder(orderId, options?.refundOrders);
    const leftover = lossById.get(id) || 0;
    // ReturnModal (and similar) may raise buyPrice for cancellation/return fees before confirm.
    // Keep the original EK for the sale archive, then record the fee as its own buy-price history row.
    const manualFee = round2(Math.max(0, (Number(base.buyPrice) || 0) - (Number(current.buyPrice) || 0)));
    const snapshotBase = { ...current, comment2: base.comment2 };
    let restocked = restockItemFields(snapshotBase, {
      status: ItemStatus.IN_STOCK,
      comment2: appendReturnedNote(base.comment2),
      cycleReason: cycleMeta.cycleReason,
      leftoverLossEur: leftover,
      refundEur: cycleMeta.refundEur,
      refundKind: cycleMeta.refundKind,
    });
    if (manualFee >= 0.01) {
      const buyBefore = round2(restocked.buyPrice);
      restocked = appendBuyPriceChange(restocked, {
        buyBefore,
        buyAfter: round2(buyBefore + manualFee),
        reason: 'restock_loss',
        reasonLabel: `Return / cancellation fee +€${manualFee.toFixed(2)} EK`,
        orderId,
      });
    }
    restocked = applyBuyPriceLoss(restocked, leftover, orderId);
    write(restocked);

    if (restocked.isPC || restocked.isBundle) {
      for (const child of getChildren(current, items)) {
        if (child.isPC || child.isBundle) continue;
        const childOrig = byId.get(child.id) || child;
        const childOrderId = (childOrig.ebayOrderId || orderId || '').trim() || undefined;
        const childMeta = cycleMetaFromOrder(childOrderId, options?.refundOrders);
        const childLeftover = lossById.get(child.id) || 0;
        let nextChild = restockItemFields(childOrig, {
          status: ItemStatus.IN_COMPOSITION,
          comment2: appendReturnedNote(childOrig.comment2),
          cycleReason: childMeta.cycleReason,
          leftoverLossEur: childLeftover,
          refundEur: childMeta.refundEur,
          refundKind: childMeta.refundKind,
        });
        nextChild = applyBuyPriceLoss(nextChild, childLeftover, childOrderId);
        // Always re-nest under the restocked PC so Active list doesn't also show a standalone.
        nextChild = {
          ...nextChild,
          parentContainerId: restocked.id,
          status: ItemStatus.IN_COMPOSITION,
        };
        write(nextChild);
      }
      const childIds = getChildren(current, items)
        .filter((c) => !c.isPC && !c.isBundle)
        .map((c) => c.id);
      if (childIds.length) {
        write({
          ...byId.get(restocked.id)!,
          componentIds: Array.from(new Set([...(restocked.componentIds || []), ...childIds])),
        });
      }
    }
  }

  for (const id of [...changed.keys()]) {
    const item = byId.get(id);
    if (!item || item.isPC || item.isBundle) continue;
    const parent = getParentContainer(item, [...byId.values()]);
    if (!parent || (!parent.isPC && !parent.isBundle)) continue;
    if (targets.has(parent.id)) continue;
    if (!isRealizedDisposal(parent)) continue;

    write({
      ...item,
      parentContainerId: undefined,
      status: ItemStatus.IN_STOCK,
    });
    const nextParent: InventoryItem = {
      ...parent,
      componentIds: (parent.componentIds || []).filter((cid) => cid !== item.id),
    };
    write(nextParent);
  }

  for (const id of [...changed.keys()]) {
    const item = byId.get(id);
    if (!item) continue;
    const originalId = originalIdFromSplitSold(item.id);
    if (!originalId || originalId === item.id) continue;
    const original = byId.get(originalId);
    if (!original || original.id === item.id) continue;
    if (isRealizedDisposal(original)) continue;

    const addQty = Number(item.quantity) || 1;
    const baseQty = Number(original.quantity);
    const nextQty = (Number.isFinite(baseQty) ? baseQty : 1) + addQty;
    write({
      ...original,
      quantity: nextQty,
    });
    deleteIds.push(item.id);
    changed.delete(item.id);
    byId.delete(item.id);
  }

  const merged = items.map((i) => byId.get(i.id) || i).filter((i) => !deleteIds.includes(i.id));
  const synced = syncContainerBuyTotalsFromComponents(merged, [...changed.keys()]);
  for (const row of synced) {
    const prev = byId.get(row.id);
    if (!prev) continue;
    if (Math.abs((prev.buyPrice || 0) - (row.buyPrice || 0)) >= 0.01) {
      byId.set(row.id, row);
      changed.set(row.id, row);
    }
  }

  return { updates: [...changed.values()], deleteIds };
}
