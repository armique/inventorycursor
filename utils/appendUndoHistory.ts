import { InventoryItem } from '../types';

export const UNDO_HISTORY_MAX = 30;

/** Append a new inventory snapshot for undo/redo without unbounded growth. */
export function appendUndoHistory(
  prev: InventoryItem[][],
  historyIndex: number,
  currentItems: InventoryItem[],
  nextItems: InventoryItem[]
): { base: InventoryItem[][]; nextIdx: number } {
  let base = prev.slice(0, Math.max(0, historyIndex + 1));
  if (base.length === 0) base = [currentItems];
  const last = base[base.length - 1];
  if (last !== nextItems) {
    base.push(nextItems);
  }
  if (base.length > UNDO_HISTORY_MAX) {
    const drop = base.length - UNDO_HISTORY_MAX;
    base = base.slice(drop);
  }
  return { base, nextIdx: base.length - 1 };
}
