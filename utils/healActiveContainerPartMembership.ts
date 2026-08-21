/**
 * Keep Active PC/bundle parts nested correctly after restock/return.
 * Prevents the same part appearing both under the PC and as a top-level Active row.
 */
import { InventoryItem, ItemStatus } from '../types';
import { isRealizedDisposal } from './itemDisposition';

function isActiveContainer(item: InventoryItem): boolean {
  if (!(item.isPC || item.isBundle)) return false;
  if (isRealizedDisposal(item)) return false;
  return (
    item.status === ItemStatus.IN_STOCK ||
    item.status === ItemStatus.ORDERED ||
    item.status === ItemStatus.IN_COMPOSITION
  );
}

function normalizeName(name: string | undefined): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[×X]/g, 'X')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1) Parts listed on an Active PC/bundle → IN_COMPOSITION + parentContainerId.
 * 2) Standalone Active "ghost" rows that mirror a nested part after a return/restock
 *    (same normalized name + Returned note, not owned by any container) → trash.
 */
export function healActiveContainerPartMembership(items: InventoryItem[]): {
  items: InventoryItem[];
  toTrash: InventoryItem[];
  changed: boolean;
} {
  if (!items.length) return { items, toTrash: [], changed: false };

  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  let changed = false;
  const nestedIds = new Set<string>();
  const nestedByName = new Map<string, InventoryItem[]>();

  for (const row of items) {
    const container = byId.get(row.id)!;
    if (!isActiveContainer(container)) continue;
    for (const cid of container.componentIds || []) {
      const child = byId.get(cid);
      if (!child || child.isPC || child.isBundle) continue;
      nestedIds.add(cid);
      const patch: Partial<InventoryItem> = {};
      if (child.parentContainerId !== container.id) patch.parentContainerId = container.id;
      if (child.status !== ItemStatus.IN_COMPOSITION) patch.status = ItemStatus.IN_COMPOSITION;
      if (Object.keys(patch).length) {
        byId.set(cid, { ...child, ...patch });
        changed = true;
      }
      const key = normalizeName(byId.get(cid)!.name);
      if (!key) continue;
      const list = nestedByName.get(key) || [];
      list.push(byId.get(cid)!);
      nestedByName.set(key, list);
    }
  }

  const toTrash: InventoryItem[] = [];
  for (const row of [...byId.values()]) {
    if (row.isPC || row.isBundle) continue;
    if (nestedIds.has(row.id)) continue;
    if (row.parentContainerId) continue;
    if (row.status !== ItemStatus.IN_STOCK && row.status !== ItemStatus.ORDERED) continue;
    const returnedNote = /\[Returned /i.test(String(row.comment2 || ''));
    const closedSaleCycle = (row.ebaySaleCycles || []).some(
      (c) =>
        c.reason === 'manual_unsold' ||
        c.reason === 'erstattet' ||
        c.reason === 'return' ||
        c.reason === 'cancelled'
    );
    if (!returnedNote && !closedSaleCycle) continue;
    const twins = nestedByName.get(normalizeName(row.name)) || [];
    if (!twins.length) continue;
    // Same buy cost as the nested twin → almost certainly a restock ghost, not a 2nd card.
    const twinBuy = Number(twins[0]?.buyPrice) || 0;
    const ghostBuy = Number(row.buyPrice) || 0;
    if (Math.abs(twinBuy - ghostBuy) > 0.02) continue;
    // Ghost restock copy of a part that already sits inside a returned Active PC.
    toTrash.push(row);
    byId.delete(row.id);
    changed = true;
  }

  if (!changed) return { items, toTrash: [], changed: false };
  return {
    items: Array.from(byId.values()),
    toTrash,
    changed: true,
  };
}
