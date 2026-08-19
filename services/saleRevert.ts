import type { ActionHistoryEntry, InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { getChildren, getParentContainer } from './financialAggregation';
import { isRealizedDisposal } from '../utils/itemDisposition';

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

export function appendReturnedNote(comment2?: string): string {
  const current = comment2 || '';
  if (RETURNED_NOTE_RE.test(current)) return current;
  return `${current} [Returned ${new Date().toLocaleDateString()}]`;
}

export function hasReturnedNote(comment2?: string): boolean {
  return RETURNED_NOTE_RE.test(comment2 || '');
}

/** Clear sale/gift fields and put the row back in stock. */
export function restockItemFields(
  item: InventoryItem,
  options?: { status?: ItemStatus; comment2?: string }
): InventoryItem {
  return {
    ...item,
    status: options?.status ?? ItemStatus.IN_STOCK,
    comment2: options?.comment2 ?? item.comment2,
    sellPrice: undefined,
    sellDate: undefined,
    profit: undefined,
    platformSold: undefined,
    paymentType: undefined,
    feeAmount: undefined,
    hasFee: false,
    sellerPaidShipping: false,
    sellerShippingAmount: undefined,
    saleProceeds: undefined,
    invoiceNumber: undefined,
    customer: undefined,
    giftRecipient: undefined,
    giftRelation: undefined,
    ebayOrderId: undefined,
    ebayOrderLineKey: undefined,
    originalSellPrice: undefined,
    ebaySaleAdjustments: undefined,
    containerSoldDate: undefined,
    ebayUsername: undefined,
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
  options?: { patches?: InventoryItem[] }
): { updates: InventoryItem[]; deleteIds: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const patchById = new Map((options?.patches || []).map((p) => [p.id, p]));
  const targets = new Set(targetIds.filter(Boolean));
  const changed = new Map<string, InventoryItem>();
  const deleteIds: string[] = [];

  const write = (item: InventoryItem) => {
    byId.set(item.id, item);
    changed.set(item.id, item);
  };

  for (const id of targets) {
    const current = byId.get(id);
    if (!current) continue;
    const patch = patchById.get(id);
    const base = patch ? { ...current, ...patch } : current;
    const restocked = restockItemFields(base, {
      status: ItemStatus.IN_STOCK,
      comment2: appendReturnedNote(base.comment2),
    });
    write(restocked);

    if (restocked.isPC || restocked.isBundle) {
      for (const child of getChildren(restocked, items)) {
        if (child.isPC || child.isBundle) continue;
        const childBase = byId.get(child.id) || child;
        write(
          restockItemFields(childBase, {
            status: ItemStatus.IN_COMPOSITION,
            comment2: appendReturnedNote(childBase.comment2),
          })
        );
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

  return { updates: [...changed.values()], deleteIds };
}
