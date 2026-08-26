import type {
  InventoryItem,
  ItemSaleCycle,
  ItemSaleCycleReason,
  ItemStatus,
} from '../types';
import { ItemStatus as Status } from '../types';

const CYCLE_REASON_LABEL: Record<ItemSaleCycleReason, string> = {
  erstattet: 'Erstattet — full refund, returned to stock',
  return: 'Buyer return — returned to stock',
  cancelled: 'Order cancelled — returned to stock',
  manual_unsold: 'Marked unsold — returned to stock',
};

export function saleCycleReasonLabel(reason: ItemSaleCycleReason): string {
  return CYCLE_REASON_LABEL[reason];
}

export function itemHasActiveSaleSnapshot(item: InventoryItem): boolean {
  return Boolean(
    item.ebayOrderId?.trim() ||
      item.ebayOrderLineKey?.trim() ||
      item.sellDate ||
      item.sellPrice != null ||
      item.customer?.name ||
      item.saleProceeds ||
      item.originalSellPrice != null
  );
}

export function itemClosedSaleOrderIds(item: InventoryItem): Set<string> {
  const ids = new Set<string>();
  for (const cycle of item.ebaySaleCycles || []) {
    const id = cycle.ebayOrderId?.trim();
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

export function itemAlreadyClosedSaleOrder(item: InventoryItem, orderId: string | undefined | null): boolean {
  const key = String(orderId || '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  return itemClosedSaleOrderIds(item).has(key);
}

export function claimedLineKeysFromSaleCycles(items: InventoryItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    for (const cycle of item.ebaySaleCycles || []) {
      const line = cycle.ebayOrderLineKey?.trim();
      if (line) keys.add(line);
    }
  }
  return keys;
}

export function snapshotSaleCycle(
  item: InventoryItem,
  reason: ItemSaleCycleReason,
  extras?: {
    leftoverLossEur?: number;
    refundEur?: number;
    refundKind?: 'full' | 'partial';
    buyPriceAtClose?: number;
  }
): ItemSaleCycle {
  const leftover = extras?.leftoverLossEur != null && extras.leftoverLossEur >= 0.01 ? extras.leftoverLossEur : undefined;
  return {
    id: `cycle-${item.id}-${item.ebayOrderId || item.sellDate || 'na'}-${item.ebaySaleCycles?.length || 0}`,
    closedAt: new Date().toISOString(),
    reason,
    reasonLabel: saleCycleReasonLabel(reason),
    sellDate: item.sellDate,
    sellPrice: item.sellPrice,
    originalSellPrice: item.originalSellPrice,
    profit: item.profit,
    platformSold: item.platformSold,
    paymentType: item.paymentType,
    ebayOrderId: item.ebayOrderId,
    ebayOrderLineKey: item.ebayOrderLineKey,
    ebayUsername: item.ebayUsername,
    ebayListingId: item.ebayListingId,
    ebaySku: item.ebaySku,
    customer: item.customer,
    saleProceeds: item.saleProceeds,
    ebaySaleAdjustments: item.ebaySaleAdjustments,
    feeAmount: item.feeAmount,
    hasFee: item.hasFee,
    sellerPaidShipping: item.sellerPaidShipping,
    sellerShippingAmount: item.sellerShippingAmount,
    invoiceNumber: item.invoiceNumber,
    buyPriceAtClose: extras?.buyPriceAtClose ?? item.buyPrice,
    leftoverLossEur: leftover,
    refundEur: extras?.refundEur,
    refundKind: extras?.refundKind,
  };
}

function alreadyHasCycleForOrder(item: InventoryItem, orderId: string | undefined): boolean {
  const key = (orderId || '').trim().toLowerCase();
  if (!key) return false;
  return (item.ebaySaleCycles || []).some((c) => (c.ebayOrderId || '').trim().toLowerCase() === key);
}

/**
 * Freeze the live sale into ebaySaleCycles, then clear live buyer/order/proceeds
 * so a later eBay sale can bind a new order. Listing ids / specs stay.
 */
export function archiveActiveSaleAndClear(
  item: InventoryItem,
  reason: ItemSaleCycleReason,
  extras?: {
    leftoverLossEur?: number;
    refundEur?: number;
    refundKind?: 'full' | 'partial';
    buyPriceAfter?: number;
    status?: ItemStatus;
    comment2?: string;
  }
): InventoryItem {
  const cycles = [...(item.ebaySaleCycles || [])];
  if (itemHasActiveSaleSnapshot(item) && !alreadyHasCycleForOrder(item, item.ebayOrderId)) {
    cycles.push(
      snapshotSaleCycle(item, reason, {
        leftoverLossEur: extras?.leftoverLossEur,
        refundEur: extras?.refundEur,
        refundKind: extras?.refundKind,
        buyPriceAtClose: item.buyPrice,
      })
    );
  }

  return {
    ...item,
    status: extras?.status ?? Status.IN_STOCK,
    comment2: extras?.comment2 ?? item.comment2,
    buyPrice: extras?.buyPriceAfter ?? item.buyPrice,
    ebaySaleCycles: cycles.length ? cycles : item.ebaySaleCycles,
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
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebayOrderScreenshotUrl: undefined,
  };
}

/** Drop live sale fields without recording a sale cycle (mistaken Abrechnung link). */
export function clearLiveSaleWithoutArchive(
  item: InventoryItem,
  extras?: {
    status?: ItemStatus;
    comment2?: string;
    buyPriceAfter?: number;
  }
): InventoryItem {
  return {
    ...item,
    status: extras?.status ?? Status.IN_STOCK,
    comment2: extras?.comment2 ?? item.comment2,
    buyPrice: extras?.buyPriceAfter ?? item.buyPrice,
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
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebayOrderScreenshotUrl: undefined,
  };
}

/** Remove sale cycles created from a mistaken Abrechnung link (never a real sale). */
export function stripMistakenAbrechnungCycles(
  cycles: ItemSaleCycle[],
  wrongOrderId: string
): ItemSaleCycle[] {
  const wrong = wrongOrderId.trim().toLowerCase();
  if (!wrong) return cycles;
  const next = cycles.filter(
    (cycle) => (cycle.ebayOrderId || '').trim().toLowerCase() !== wrong
  );
  return next;
}

export function formatSaleCycleSummary(cycle: ItemSaleCycle): string {
  const date = cycle.sellDate || cycle.closedAt.slice(0, 10);
  const order = cycle.ebayOrderId ? `#${cycle.ebayOrderId}` : 'no order id';
  const buyer = cycle.customer?.name || cycle.ebayUsername || 'buyer unknown';
  const price = cycle.sellPrice != null ? `€${cycle.sellPrice.toFixed(2)}` : '—';
  const loss =
    cycle.leftoverLossEur != null && cycle.leftoverLossEur >= 0.01
      ? ` · leftover +€${cycle.leftoverLossEur.toFixed(2)} EK`
      : '';
  return `${date} · ${order} · ${buyer} · ${price} · ${cycle.reasonLabel}${loss}`;
}

/** Most recent archived sale to restore after undoing a wrong Abrechnung link. */
export function pickSaleCycleToRestore(
  cycles: ItemSaleCycle[],
  excludeOrderId: string
): ItemSaleCycle | undefined {
  const exclude = excludeOrderId.trim().toLowerCase();
  const candidates = cycles.filter((cycle) => {
    const orderKey = (cycle.ebayOrderId || '').trim().toLowerCase();
    if (orderKey && orderKey === exclude) return false;
    return cycle.sellPrice != null || Boolean(cycle.saleProceeds) || Boolean(orderKey);
  });
  if (!candidates.length) return undefined;
  return [...candidates].sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
}

function moneyClose(a: number | null | undefined, b: number | null | undefined): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.02;
}

function inferSellDateFromPriceHistory(item: InventoryItem, sellPrice: number): string | undefined {
  const entries = (item.priceHistory || []).filter((entry) => entry.type === 'sell');
  const direct = entries.find((entry) => moneyClose(entry.price, sellPrice));
  if (direct) return direct.date.slice(0, 10);
  const viaPrevious = entries.find((entry) => moneyClose(entry.previousPrice, sellPrice));
  return viaPrevious?.date.slice(0, 10);
}

function findArchivedCycleBySellPrice(
  cycles: ItemSaleCycle[],
  sellPrice: number,
  excludeOrderId: string
): ItemSaleCycle | undefined {
  const exclude = excludeOrderId.trim().toLowerCase();
  return cycles.find(
    (cycle) =>
      cycle.sellPrice != null &&
      moneyClose(cycle.sellPrice, sellPrice) &&
      (cycle.ebayOrderId || '').trim().toLowerCase() !== exclude
  );
}

/**
 * Recover a prior sell from priceHistory when a wrong Abrechnung link overwrote live
 * sale fields without archiving ebaySaleCycles first.
 */
export function pickPriorSaleFromPriceHistory(
  item: InventoryItem,
  excludeOrderId: string,
  cycles: ItemSaleCycle[] = item.ebaySaleCycles || []
): ItemSaleCycle | undefined {
  const exclude = excludeOrderId.trim().toLowerCase();
  const activeWrongSell = item.sellPrice != null ? Number(item.sellPrice) : undefined;
  const sellEntries = [...(item.priceHistory || [])]
    .filter((entry) => entry.type === 'sell' && entry.previousPrice != null && entry.previousPrice > 0)
    .reverse();

  for (const entry of sellEntries) {
    const previousPrice = Number(entry.previousPrice);
    if (!Number.isFinite(previousPrice) || previousPrice <= 0) continue;
    if (activeWrongSell != null && !moneyClose(entry.price, activeWrongSell)) continue;

    const archived = findArchivedCycleBySellPrice(cycles, previousPrice, excludeOrderId);
    if (archived) return archived;

    const sellDate = inferSellDateFromPriceHistory(item, previousPrice);
    return {
      id: `cycle-ph-${item.id}-${previousPrice.toFixed(2)}`,
      closedAt: entry.date,
      reason: 'manual_unsold',
      reasonLabel: 'Prior sale recovered from price history',
      sellPrice: previousPrice,
      sellDate,
      platformSold: item.platformSold || 'ebay.de',
      paymentType: item.paymentType || 'ebay.de',
      buyPriceAtClose: item.buyPrice,
    };
  }

  return undefined;
}

/**
 * Freeze live sale fields before Abrechnung overwrites them onto another Bestellung.
 * Only archives when a *different* live eBay order id is being replaced. Bare sell
 * fields (sold/KA/etc. with no order id) are the sale being matched — archiving
 * them falsely marks the item as "Resold" and later heals wipe the new link.
 */
export function archiveLiveSaleBeforeAbrechnungLink(
  item: InventoryItem,
  nextOrderId: string
): InventoryItem {
  const currentOrder = (item.ebayOrderId || '').trim();
  const nextOrder = nextOrderId.trim();
  if (!nextOrder || !currentOrder) return item;
  if (currentOrder.toLowerCase() === nextOrder.toLowerCase()) return item;
  if (!itemHasActiveSaleSnapshot(item)) return item;
  if (alreadyHasCycleForOrder(item, currentOrder)) return item;

  const cycles = [...(item.ebaySaleCycles || [])];
  cycles.push(
    snapshotSaleCycle(item, 'manual_unsold', {
      buyPriceAtClose: item.buyPrice,
    })
  );
  return { ...item, ebaySaleCycles: cycles };
}

const ABRECHNUNG_UNLINK_TAG_RE = /\[Abrechnung unlink\s+([0-9-]+)/i;

export function inferWrongAbrechnungOrderId(item: InventoryItem): string | undefined {
  const tagged = item.comment2?.match(ABRECHNUNG_UNLINK_TAG_RE);
  if (tagged?.[1]) return tagged[1].trim();
  const recentWrong = [...(item.ebaySaleCycles || [])]
    .filter((cycle) => cycle.reason === 'manual_unsold')
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
  return recentWrong?.ebayOrderId?.trim() || undefined;
}

export function hasMistakenAbrechnungHistory(item: InventoryItem): boolean {
  const wrong = inferWrongAbrechnungOrderId(item);
  if (!wrong) return false;
  const key = wrong.toLowerCase();
  return (item.ebaySaleCycles || []).some(
    (cycle) => (cycle.ebayOrderId || '').trim().toLowerCase() === key
  );
}

/** Fix an item already unlinked to stock but still missing its real prior sale. */
export function recoverPriorAbrechnungSale(
  item: InventoryItem,
  wrongOrderId?: string
): UnlinkAbrechnungSaleResult | null {
  const wrongOrder = (wrongOrderId || inferWrongAbrechnungOrderId(item) || '').trim();
  const cycles = stripMistakenAbrechnungCycles([...(item.ebaySaleCycles || [])], wrongOrder);
  const restoreCycle =
    pickSaleCycleToRestore(cycles, wrongOrder) ||
    pickPriorSaleFromPriceHistory(item, wrongOrder, cycles);

  if (restoreCycle) {
    const remainingCycles = cycles.filter((cycle) => cycle.id !== restoreCycle.id);
    return {
      item: applySaleCycleToLiveItem(
        {
          ...item,
          ebaySaleCycles: remainingCycles.length ? remainingCycles : undefined,
        },
        restoreCycle
      ),
      restoredPreviousSale: true,
      restoredOrderId: restoreCycle.ebayOrderId,
      restoredSellPrice: restoreCycle.sellPrice,
    };
  }

  if (cycles.length !== (item.ebaySaleCycles || []).length) {
    return {
      item: { ...item, ebaySaleCycles: cycles.length ? cycles : undefined },
      restoredPreviousSale: false,
    };
  }

  return null;
}

export function getRecoverablePriorAbrechnungSale(
  item: InventoryItem,
  wrongOrderId?: string
): ItemSaleCycle | null {
  const wrongOrder = (wrongOrderId || inferWrongAbrechnungOrderId(item) || '').trim();
  const cycles = stripMistakenAbrechnungCycles([...(item.ebaySaleCycles || [])], wrongOrder);
  if (!(item.ebayOrderId || '').trim()) {
    const restore =
      pickSaleCycleToRestore(cycles, wrongOrder) ||
      pickPriorSaleFromPriceHistory(item, wrongOrder, cycles);
    if (restore) return restore;
  }
  if (hasMistakenAbrechnungHistory(item)) {
    return {
      id: `cleanup-${item.id}`,
      closedAt: new Date().toISOString(),
      reason: 'manual_unsold',
      reasonLabel: 'Remove false Abrechnung link history',
      buyPriceAtClose: item.buyPrice,
    };
  }
  return null;
}

function scrubAbrechnungUnlinkTag(item: InventoryItem): InventoryItem {
  const next = (item.comment2 || '').replace(/\s*\[Abrechnung unlink[^\]]+\]/gi, '').trim();
  if (next === (item.comment2 || '')) return item;
  return { ...item, comment2: next || undefined };
}

/** Remove false Abrechnung link history and restore the real prior sale when possible. */
export function healAbrechnungMistakenLinkItem(item: InventoryItem): InventoryItem | null {
  const wrong = inferWrongAbrechnungOrderId(item);
  const liveOrder = (item.ebayOrderId || '').trim().toLowerCase();

  // Live order is the mistaken link → unlink and restore prior sale when possible.
  if (wrong && liveOrder && liveOrder === wrong.toLowerCase()) {
    const unlinked = unlinkAbrechnungSaleAndRestorePrevious(item, wrong);
    if (unlinked) return scrubAbrechnungUnlinkTag(unlinked.item);
  }

  // Already unlinked (no live order) but missing the real prior sale → recover.
  // Never rewrite a live Abrechnung / inventory order that is not the mistaken id —
  // that was wiping fresh matches after refresh.
  if (!liveOrder) {
    const recovered = recoverPriorAbrechnungSale(item, wrong);
    if (recovered) return scrubAbrechnungUnlinkTag(recovered.item);
  }

  if (hasMistakenAbrechnungHistory(item) && wrong) {
    const cycles = stripMistakenAbrechnungCycles(item.ebaySaleCycles || [], wrong);
    if (cycles.length !== (item.ebaySaleCycles || []).length) {
      return scrubAbrechnungUnlinkTag({
        ...item,
        ebaySaleCycles: cycles.length ? cycles : undefined,
      });
    }
  }

  // Drop empty-order "prior sale" archives created by older Abrechnung link bugs.
  // Those cycles have no ebayOrderId and duplicate the live sold snapshot → Resold badge.
  const scrubbedCycles = scrubSpuriousNoOrderSaleCycles(item);
  if (scrubbedCycles) {
    return scrubAbrechnungUnlinkTag(scrubbedCycles);
  }

  if (ABRECHNUNG_UNLINK_TAG_RE.test(item.comment2 || '')) {
    return scrubAbrechnungUnlinkTag(item);
  }

  return null;
}

/**
 * Older Abrechnung link archived bare sell fields (no order id) before binding CSV.
 * That left a fake prior cycle → "Resold" badge. Remove those when live already has
 * a real order id, or when the cycle is empty of order identity.
 */
function scrubSpuriousNoOrderSaleCycles(item: InventoryItem): InventoryItem | null {
  const cycles = item.ebaySaleCycles || [];
  if (!cycles.length) return null;
  const liveOrder = (item.ebayOrderId || '').trim();
  const next = cycles.filter((cycle) => {
    const order = (cycle.ebayOrderId || '').trim();
    if (order) return true;
    // Keep no-order cycles only when the item has no live order (true closed sale w/o id).
    if (!liveOrder) return true;
    return false;
  });
  if (next.length === cycles.length) return null;
  return {
    ...item,
    ebaySaleCycles: next.length ? next : undefined,
  };
}

export function planAbrechnungMistakenLinkHeals(items: InventoryItem[]): InventoryItem[] {
  const patches: InventoryItem[] = [];
  for (const item of items) {
    const next = healAbrechnungMistakenLinkItem(item);
    if (next) patches.push(next);
  }
  return patches;
}

/** Promote a frozen sale cycle back onto the live item row. */
export function applySaleCycleToLiveItem(item: InventoryItem, cycle: ItemSaleCycle): InventoryItem {
  const status = cycle.paymentType === 'Gift' ? Status.GIFTED : Status.SOLD;
  return {
    ...item,
    status,
    sellDate: cycle.sellDate,
    sellPrice: cycle.sellPrice,
    originalSellPrice: cycle.originalSellPrice,
    profit: cycle.profit,
    platformSold: cycle.platformSold,
    paymentType: cycle.paymentType,
    ebayOrderId: cycle.ebayOrderId,
    ebayOrderLineKey: cycle.ebayOrderLineKey,
    ebayUsername: cycle.ebayUsername,
    ebayListingId: cycle.ebayListingId || item.ebayListingId,
    ebaySku: cycle.ebaySku || item.ebaySku,
    customer: cycle.customer,
    saleProceeds: cycle.saleProceeds,
    ebaySaleAdjustments: cycle.ebaySaleAdjustments,
    feeAmount: cycle.feeAmount,
    hasFee: cycle.hasFee ?? Boolean(cycle.feeAmount != null && cycle.feeAmount >= 0.01),
    sellerPaidShipping: cycle.sellerPaidShipping,
    sellerShippingAmount: cycle.sellerShippingAmount,
    invoiceNumber: cycle.invoiceNumber,
    containerSoldDate: undefined,
    giftRecipient: undefined,
    giftRelation: undefined,
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebayOrderScreenshotUrl: undefined,
  };
}

export type UnlinkAbrechnungSaleResult = {
  item: InventoryItem;
  restoredPreviousSale: boolean;
  restoredOrderId?: string;
  restoredSellPrice?: number;
};

/**
 * Undo a mistaken Abrechnung link: restore the latest prior sale when one exists;
 * otherwise return to stock. Never archives the wrong link as a sale cycle.
 */
export function unlinkAbrechnungSaleAndRestorePrevious(
  item: InventoryItem,
  unlinkOrderId: string,
  comment2?: string
): UnlinkAbrechnungSaleResult | null {
  const linkedOrder = (item.ebayOrderId || '').trim();
  const targetOrder = unlinkOrderId.trim();
  if (!linkedOrder || !targetOrder || linkedOrder.toLowerCase() !== targetOrder.toLowerCase()) return null;

  const cycles = stripMistakenAbrechnungCycles([...(item.ebaySaleCycles || [])], targetOrder);
  const restoreCycle =
    pickSaleCycleToRestore(cycles, targetOrder) ||
    pickPriorSaleFromPriceHistory(item, targetOrder, cycles);
  const nextComment2 = comment2 ?? item.comment2;

  if (restoreCycle) {
    const remainingCycles = cycles.filter((cycle) => cycle.id !== restoreCycle.id);
    return {
      item: applySaleCycleToLiveItem(
        {
          ...item,
          ebaySaleCycles: remainingCycles.length ? remainingCycles : undefined,
          comment2: nextComment2,
        },
        restoreCycle
      ),
      restoredPreviousSale: true,
      restoredOrderId: restoreCycle.ebayOrderId,
      restoredSellPrice: restoreCycle.sellPrice,
    };
  }

  return {
    item: clearLiveSaleWithoutArchive(
      { ...item, ebaySaleCycles: cycles.length ? cycles : undefined },
      { comment2: nextComment2 }
    ),
    restoredPreviousSale: false,
  };
}
