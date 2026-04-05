import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { computeItemProfitBeforeOverhead } from './financialAggregation';

/** Strip suffix appended by TradeModal when a trade note was entered. */
export function stripTradeContextFromComment2(comment2: string): string {
  return comment2.replace(/\n\n\[Trade Context\]:[\s\S]*$/, '').trimEnd();
}

function recomputeRealizedProfit(item: InventoryItem, taxMode: TaxMode): InventoryItem {
  if (item.isBundle || item.isPC) return item;
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return { ...item, profit: undefined };
  if (item.sellPrice == null || Number.isNaN(Number(item.sellPrice))) return { ...item, profit: undefined };
  if (Number.isNaN(Number(item.buyPrice))) return { ...item, profit: undefined };
  const profit = computeItemProfitBeforeOverhead(item, taxMode);
  return { ...item, profit };
}

export type TradeRevertResult =
  | { ok: true; nextItems: InventoryItem[]; outgoingRestored: InventoryItem; removedIds: string[] }
  | { ok: false; message: string };

/**
 * Undo a completed trade: restore the outgoing line to In Stock (no sale/trade fields)
 * and remove all items received in that trade (by tradedFromId and/or history ids).
 */
export function applyTradeRevert(
  items: InventoryItem[],
  outgoingId: string,
  historyReceivedIds: string[] | undefined,
  taxMode: TaxMode
): TradeRevertResult {
  const outgoing = items.find((i) => i.id === outgoingId);
  if (!outgoing) return { ok: false, message: 'That item is no longer in your inventory.' };
  if (outgoing.status !== ItemStatus.TRADED) {
    return { ok: false, message: 'This trade was already reverted or the item is no longer marked Traded.' };
  }

  const toRemove = new Set<string>();
  const histIds = historyReceivedIds ?? [];
  const idHints = new Set<string>([...histIds, ...(outgoing.tradedForIds ?? [])]);
  for (const id of idHints) {
    if (!id || id === outgoingId) continue;
    const rec = items.find((i) => i.id === id);
    if (!rec) continue;
    if (rec.tradedFromId === outgoingId || outgoing.tradedForIds?.includes(id) || histIds.includes(id)) {
      toRemove.add(id);
    }
  }
  for (const i of items) {
    if (i.id !== outgoingId && i.tradedFromId === outgoingId) {
      toRemove.add(i.id);
    }
  }

  let restored: InventoryItem = { ...outgoing };
  restored.status = ItemStatus.IN_STOCK;
  delete restored.sellPrice;
  delete restored.sellDate;
  delete restored.tradedForIds;
  delete restored.cashOnTop;
  delete restored.profit;
  if (restored.paymentType === 'Trade') delete restored.paymentType;
  restored.comment2 = stripTradeContextFromComment2(restored.comment2 || '');
  restored = recomputeRealizedProfit(restored, taxMode);

  const nextItems = items
    .filter((i) => !toRemove.has(i.id))
    .map((i) => (i.id === outgoingId ? restored : i));

  return {
    ok: true,
    nextItems,
    outgoingRestored: restored,
    removedIds: [...toRemove],
  };
}
