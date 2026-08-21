import {
  InventoryItem,
  PriceHistoryEntry,
  type BuyPriceChangeReason,
} from '../types';

const BUY_REASON_LABEL: Record<BuyPriceChangeReason, string> = {
  manual: 'Manual buy price edit',
  restock_loss: 'Unsold / return — loss added to EK',
  hub_erstattet: 'Erstattet — fees/shipping added to EK',
  refund_capitalize: 'Full refund — order loss capitalized into EK',
  container_resplit: 'PC/bundle cost resplit',
  other: 'Buy price change',
};

export function buyPriceChangeReasonLabel(
  reason: BuyPriceChangeReason | undefined,
  delta?: number
): string {
  const base = BUY_REASON_LABEL[reason || 'other'];
  if (delta != null && Math.abs(delta) >= 0.01) {
    const sign = delta > 0 ? '+' : '−';
    return `${base} (${sign}€${Math.abs(delta).toFixed(2)})`;
  }
  return base;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Append a documented buy-price change (restock loss, manual edit, etc.). */
export function appendBuyPriceChange(
  item: InventoryItem,
  options: {
    buyBefore: number;
    buyAfter: number;
    reason: BuyPriceChangeReason;
    reasonLabel?: string;
    orderId?: string;
    date?: string;
  }
): InventoryItem {
  const buyBefore = round2(options.buyBefore);
  const buyAfter = round2(options.buyAfter);
  const delta = round2(buyAfter - buyBefore);
  if (Math.abs(delta) < 0.005) return item;

  const entry: PriceHistoryEntry = {
    date: options.date || new Date().toISOString(),
    type: 'buy',
    price: buyAfter,
    previousPrice: buyBefore,
    delta,
    reason: options.reason,
    reasonLabel:
      options.reasonLabel ||
      buyPriceChangeReasonLabel(options.reason, delta) +
        (options.orderId ? ` · #${options.orderId}` : ''),
    orderId: options.orderId,
  };

  return {
    ...item,
    buyPrice: buyAfter,
    priceHistory: [...(item.priceHistory || []), entry].slice(-80),
  };
}

/**
 * If buy or sell price changed, append an entry to priceHistory and return the updated item.
 * Call this when merging an updated item into the list (save from form or inline edit).
 */
export function appendPriceHistoryIfChanged(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem
): InventoryItem {
  if (!oldItem || oldItem.id !== newItem.id) return newItem;

  const now = new Date().toISOString();
  let entries: PriceHistoryEntry[] = [...(newItem.priceHistory || [])];
  let next = newItem;

  const oldBuy = Number(oldItem.buyPrice);
  const newBuy = Number(newItem.buyPrice);
  if (oldBuy !== newBuy && !Number.isNaN(newBuy)) {
    // Prefer an entry already stamped by restock/refund helpers (same after-price).
    const alreadyDocumented = entries.some(
      (e) =>
        e.type === 'buy' &&
        round2(e.price) === round2(newBuy) &&
        e.reason &&
        e.reason !== 'manual' &&
        Math.abs(new Date(e.date).getTime() - Date.now()) < 60_000
    );
    if (!alreadyDocumented) {
      const withBuy = appendBuyPriceChange(
        { ...newItem, priceHistory: entries },
        {
          buyBefore: Number.isNaN(oldBuy) ? 0 : oldBuy,
          buyAfter: newBuy,
          reason: 'manual',
          date: now,
        }
      );
      entries = withBuy.priceHistory || entries;
      next = { ...next, priceHistory: entries };
    }
  }

  const oldSell = oldItem.sellPrice != null ? Number(oldItem.sellPrice) : undefined;
  const newSell = newItem.sellPrice != null ? Number(newItem.sellPrice) : undefined;
  if (oldSell !== newSell && (newSell != null || oldSell != null)) {
    entries = [
      ...entries,
      {
        date: now,
        type: 'sell',
        price: newSell ?? 0,
        previousPrice: oldSell,
        delta:
          oldSell != null && newSell != null ? round2(newSell - oldSell) : undefined,
      },
    ];
    next = { ...next, priceHistory: entries };
  }

  const oldStore = oldItem.storePrice != null ? Number(oldItem.storePrice) : undefined;
  const newStore = newItem.storePrice != null ? Number(newItem.storePrice) : undefined;
  if (oldStore !== newStore && (newStore != null || oldStore != null)) {
    entries = [
      ...entries,
      {
        date: now,
        type: 'storePrice',
        price: newStore ?? 0,
        previousPrice: oldStore,
        delta:
          oldStore != null && newStore != null ? round2(newStore - oldStore) : undefined,
      },
    ];
    next = { ...next, priceHistory: entries };
  }

  if (entries.length === (newItem.priceHistory || []).length && next === newItem) return newItem;
  return { ...next, priceHistory: entries };
}

export function listBuyPriceHistory(item: InventoryItem): PriceHistoryEntry[] {
  return (item.priceHistory || []).filter((e) => e.type === 'buy');
}

export type LatestBuyPriceIncrease = {
  delta: number;
  price: number;
  previousPrice: number;
  date: string;
  reason?: BuyPriceChangeReason;
  reasonLabel: string;
  orderId?: string;
};

/** Most recent buy-price increase (e.g. restock loss), if any. */
export function latestBuyPriceIncrease(item: InventoryItem): LatestBuyPriceIncrease | null {
  const buys = listBuyPriceHistory(item);
  for (let i = buys.length - 1; i >= 0; i--) {
    const e = buys[i];
    const prev = e.previousPrice;
    if (prev == null) continue;
    const delta = e.delta != null ? round2(e.delta) : round2(e.price - prev);
    if (delta < 0.01) continue;
    return {
      delta,
      price: round2(e.price),
      previousPrice: round2(prev),
      date: e.date,
      reason: e.reason,
      reasonLabel: e.reasonLabel || buyPriceChangeReasonLabel(e.reason, delta),
      orderId: e.orderId,
    };
  }
  return null;
}

/** True when the latest buy change was a restock / refund capitalization. */
export function hasRestockBuyPriceBump(item: InventoryItem): boolean {
  const latest = latestBuyPriceIncrease(item);
  if (!latest) return false;
  return (
    latest.reason === 'restock_loss' ||
    latest.reason === 'hub_erstattet' ||
    latest.reason === 'refund_capitalize'
  );
}


const PRICE_HISTORY_MAX = 80;

/** Keep the richest buy/sell history when syncing local vs cloud. */
export function mergePriceHistory(
  a: PriceHistoryEntry[] | undefined,
  b: PriceHistoryEntry[] | undefined
): PriceHistoryEntry[] | undefined {
  const left = a || [];
  const right = b || [];
  if (!left.length && !right.length) return undefined;
  const keyOf = (e: PriceHistoryEntry) =>
    [e.type, e.date, String(e.price), String(e.previousPrice ?? ""), e.reason || "", e.orderId || ""].join("|");
  const byKey = new Map<string, PriceHistoryEntry>();
  for (const e of [...left, ...right]) {
    if (!e || e.price == null) continue;
    const k = keyOf(e);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, e);
      continue;
    }
    // Prefer the entry that has reason / delta documentation.
    const score = (x: PriceHistoryEntry) =>
      (x.reason ? 2 : 0) + (x.reasonLabel ? 1 : 0) + (x.delta != null ? 1 : 0) + (x.orderId ? 1 : 0);
    if (score(e) > score(prev)) byKey.set(k, e);
  }
  const merged = Array.from(byKey.values()).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return merged.length > PRICE_HISTORY_MAX ? merged.slice(-PRICE_HISTORY_MAX) : merged;
}

function mergeByIdField<T extends { id?: string }>(
  a: T[] | undefined,
  b: T[] | undefined
): T[] | undefined {
  const left = a || [];
  const right = b || [];
  if (!left.length && !right.length) return undefined;
  const byId = new Map<string, T>();
  let anon = 0;
  for (const row of [...left, ...right]) {
    if (!row) continue;
    const id = (row.id || "").trim() || `anon-${anon++}`;
    if (!byId.has(id)) byId.set(id, row);
  }
  return Array.from(byId.values());
}

/** Merge per-item audit trails so cloud sync never drops local restock / trade history. */
export function mergeItemAuditFields(primary: InventoryItem, secondary: InventoryItem): InventoryItem {
  const priceHistory = mergePriceHistory(primary.priceHistory, secondary.priceHistory);
  const ebaySaleCycles = mergeByIdField(primary.ebaySaleCycles, secondary.ebaySaleCycles);
  const ebaySaleAdjustments = mergeByIdField(primary.ebaySaleAdjustments, secondary.ebaySaleAdjustments);
  let next = primary;
  if (priceHistory !== primary.priceHistory) next = { ...next, priceHistory };
  if (ebaySaleCycles !== primary.ebaySaleCycles) next = { ...next, ebaySaleCycles };
  if (ebaySaleAdjustments !== primary.ebaySaleAdjustments) next = { ...next, ebaySaleAdjustments };
  return next;
}
