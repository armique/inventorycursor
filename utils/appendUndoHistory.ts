import { InventoryItem } from '../types';

export const UNDO_HISTORY_MAX = 30;

/** Inventory + trash so delete/restore (and trade revert) can undo both sides. */
export type UndoSnapshot = {
  items: InventoryItem[];
  trash: InventoryItem[];
};

export function makeUndoSnapshot(
  items: InventoryItem[],
  trash: InventoryItem[] = []
): UndoSnapshot {
  return { items, trash };
}

/** Append a new inventory+trash snapshot for undo/redo without unbounded growth. */
export function appendUndoHistory(
  prev: UndoSnapshot[],
  historyIndex: number,
  current: UndoSnapshot,
  next: UndoSnapshot
): { base: UndoSnapshot[]; nextIdx: number } {
  let base = prev.slice(0, Math.max(0, historyIndex + 1));
  if (base.length === 0) base = [current];
  const last = base[base.length - 1];
  if (last !== next) {
    base.push(next);
  }
  if (base.length > UNDO_HISTORY_MAX) {
    const drop = base.length - UNDO_HISTORY_MAX;
    base = base.slice(drop);
  }
  return { base, nextIdx: base.length - 1 };
}
