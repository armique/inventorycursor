import type { ActionHistoryEntry, InventoryItem } from '../types';
import { ItemStatus } from '../types';

function makeActionEntry(
  action: string,
  item?: InventoryItem,
  details?: string,
  timestampIso?: string
): ActionHistoryEntry {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: timestampIso || new Date().toISOString(),
    action,
    itemId: item?.id,
    itemName: item?.name,
    details,
  };
}

/** One clear history row for trades; drop redundant status + per-line "created" noise from the same batch. */
export function mergeTradeActionEntries(
  entries: ActionHistoryEntry[],
  updatedItems: InventoryItem[]
): ActionHistoryEntry[] {
  const traded = updatedItems.find(
    (u) => u.status === ItemStatus.TRADED && Array.isArray(u.tradedForIds) && u.tradedForIds.length > 0
  );
  if (!traded) return entries;

  const receivedInBatch = updatedItems.filter((u) => u.tradedFromId === traded.id);
  if (receivedInBatch.length === 0) return entries;

  const cash = traded.cashOnTop != null ? Number(traded.cashOnTop) : 0;
  const cashBit =
    cash > 0 ? `cash in €${cash.toFixed(2)}` : cash < 0 ? `cash out €${Math.abs(cash).toFixed(2)}` : '';
  const names = receivedInBatch.map((i) => i.name).slice(0, 3);
  const nameExtra = receivedInBatch.length > 3 ? ` +${receivedInBatch.length - 3} more` : '';
  const details = [
    `Deal €${(Number(traded.sellPrice) || 0).toFixed(2)}`,
    `${receivedInBatch.length} received: ${names.join(', ')}${nameExtra}`,
    cashBit,
  ]
    .filter(Boolean)
    .join(' · ');

  const tradeTime =
    traded.sellDate && !Number.isNaN(new Date(traded.sellDate).getTime())
      ? new Date(traded.sellDate).toISOString()
      : undefined;

  const summary: ActionHistoryEntry = {
    ...makeActionEntry('Trade completed', traded, details, tradeTime),
    tradeReceivedIds: receivedInBatch.map((r) => r.id),
  };

  const receivedIds = new Set(receivedInBatch.map((r) => r.id));
  const filtered = entries.filter((e) => {
    if (e.itemId === traded.id && e.action.startsWith('Status changed:') && e.action.includes(String(ItemStatus.TRADED))) {
      return false;
    }
    if (e.itemId && receivedIds.has(e.itemId) && e.action === 'Item created') return false;
    return true;
  });

  return [summary, ...filtered];
}
