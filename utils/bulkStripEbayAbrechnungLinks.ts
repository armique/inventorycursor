/**
 * Strip eBay order links from sold inventory — clears sell cells, order ids, proceeds.
 * Supports Abrechnung-only or all eBay-linked sold rows.
 */
import { ItemStatus, type InventoryItem } from '../types';
import { getChildren } from '../services/financialAggregation';
import { isSoldOrTradedOnly } from './itemDisposition';
import { hasEbaySaleSignals, resolveSalePlatform } from './salePlatform';
import {
  clearLiveSaleWithoutArchive,
  stripMistakenAbrechnungCycles,
} from './itemSaleCycle';

const SOLD_QTY_NAME_RE = /\s*\(\d+\s*×\s*sold\)\s*$/i;
const EBAY_PROCEEDS = new Set(['ebay_order', 'ebay_seller_hub', 'ebay_screenshot']);

function orderIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  return Boolean(left && right && left === right);
}

/** Item row tied to an eBay Abrechnung CSV order. */
export function isEbayAbrechnungLinkedItem(
  item: InventoryItem,
  allItems?: InventoryItem[]
): boolean {
  if (item.saleProceeds?.source === 'ebay_order') return true;
  if (!allItems?.length || !item.parentContainerId) return false;
  const parent = allItems.find((row) => row.id === item.parentContainerId);
  return parent?.saleProceeds?.source === 'ebay_order';
}

/** Sold/traded row with any eBay order / platform linkage. */
export function isEbayLinkedSoldItem(item: InventoryItem, allItems?: InventoryItem[]): boolean {
  if (isSoldOrTradedOnly(item)) {
    if (resolveSalePlatform(item) === 'ebay.de') return true;
    if (hasEbaySaleSignals(item)) return true;
    const src = item.saleProceeds?.source;
    if (src && EBAY_PROCEEDS.has(src)) return true;
    return false;
  }
  if (!allItems?.length || !item.parentContainerId) return false;
  const parent = allItems.find((row) => row.id === item.parentContainerId);
  if (!parent || !isSoldOrTradedOnly(parent)) return false;
  return isEbayLinkedSoldItem(parent, allItems);
}

function stripEbaySoldLink(item: InventoryItem, orderId?: string, wipeAllEbayOrderCycles = false): InventoryItem {
  const oid = (orderId || item.ebayOrderId || '').trim();
  let cycles = [...(item.ebaySaleCycles || [])];
  if (wipeAllEbayOrderCycles) {
    cycles = cycles.filter((cycle) => !(cycle.ebayOrderId || '').trim());
  } else if (oid) {
    cycles = stripMistakenAbrechnungCycles(cycles, oid);
  }

  const sold = isSoldOrTradedOnly(item);
  const base = sold ? item : clearLiveSaleWithoutArchive(item, { status: ItemStatus.IN_STOCK });
  const name = item.name.replace(SOLD_QTY_NAME_RE, '').trim() || item.name;
  const saleProceeds =
    base.saleProceeds?.source && EBAY_PROCEEDS.has(base.saleProceeds.source) ? undefined : base.saleProceeds;

  return {
    ...base,
    name,
    parentContainerId: undefined,
    ebayOrderId: undefined,
    ebayOrderLineKey: undefined,
    ebayUsername: undefined,
    ebayListingId: undefined,
    ebaySku: undefined,
    ebayOrderScreenshotUrl: undefined,
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebaySaleAdjustments: undefined,
    ebaySaleCycles: cycles.length ? cycles : undefined,
    platformSold: base.platformSold === 'ebay.de' ? undefined : base.platformSold,
    paymentType: base.paymentType === 'ebay.de' ? undefined : base.paymentType,
    saleProceeds,
    feeAmount: saleProceeds ? base.feeAmount : sold ? base.feeAmount : undefined,
  };
}

/** @deprecated Abrechnung-only unlink resets sell cells entirely. */
function stripOne(item: InventoryItem, orderId?: string, wipeAllEbayOrderCycles = false): InventoryItem {
  return stripEbaySoldLink(item, orderId, wipeAllEbayOrderCycles);
}

function itemsForOrder(allItems: InventoryItem[], orderId: string): InventoryItem[] {
  const target = orderId.trim();
  if (!target) return [];
  const direct = allItems.filter((item) => orderIdsMatch(item.ebayOrderId, target));
  const childIds = new Set<string>();
  for (const item of direct) {
    if (!(item.isBundle || item.isPC)) continue;
    for (const child of getChildren(item, allItems)) {
      if (orderIdsMatch(child.ebayOrderId, target) || child.parentContainerId === item.id) {
        childIds.add(child.id);
      }
    }
    for (const id of item.componentIds || []) childIds.add(id);
  }
  for (const item of allItems) {
    if (!item.parentContainerId) continue;
    const parent = allItems.find((row) => row.id === item.parentContainerId);
    if (parent && orderIdsMatch(parent.ebayOrderId, target)) childIds.add(item.id);
  }
  const extras = allItems.filter((item) => childIds.has(item.id));
  const seen = new Set<string>();
  return [...direct, ...extras].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function pickBundleRoot(linked: InventoryItem[], allItems: InventoryItem[]): InventoryItem | null {
  return (
    linked.find((item) => (item.isBundle || item.isPC) && !item.parentContainerId) ||
    linked.find((item) => !item.parentContainerId) ||
    linked[0] ||
    null
  );
}

export type BulkStripEbayLinksResult = {
  updates: InventoryItem[];
  deleteIds: string[];
  strippedItemCount: number;
  orderIds: string[];
};

type LinkPredicate = (item: InventoryItem, allItems: InventoryItem[]) => boolean;

function bulkStripEbayLinks(
  allItems: InventoryItem[],
  isLinked: LinkPredicate,
  deleteEbayBundleShells: boolean,
  wipeAllEbayOrderCycles = false
): BulkStripEbayLinksResult {
  const orderIds = new Set<string>();
  for (const item of allItems) {
    if (!isLinked(item, allItems)) continue;
    const oid = (item.ebayOrderId || '').trim();
    if (oid) orderIds.add(oid);
    else if (item.parentContainerId) {
      const parent = allItems.find((row) => row.id === item.parentContainerId);
      const parentOrder = (parent?.ebayOrderId || '').trim();
      if (parentOrder) orderIds.add(parentOrder);
    }
  }

  const updates: InventoryItem[] = [];
  const deleteIds: string[] = [];
  const seen = new Set<string>();
  const push = (item: InventoryItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    updates.push(item);
  };

  for (const orderId of orderIds) {
    const linked = itemsForOrder(allItems, orderId).filter((item) => isLinked(item, allItems));
    if (!linked.length) continue;
    const root = pickBundleRoot(linked, allItems);
    const isSoldBundleRoot =
      root &&
      (root.isBundle || root.isPC) &&
      (Boolean(root.componentIds?.length) || linked.some((item) => item.parentContainerId === root.id));

    if (isSoldBundleRoot && root) {
      const childIds = new Set(root.componentIds || []);
      for (const item of linked) {
        if (item.parentContainerId === root.id) childIds.add(item.id);
      }
      for (const child of getChildren(root, allItems)) {
        if (orderIdsMatch(child.ebayOrderId, orderId) || child.parentContainerId === root.id) {
          childIds.add(child.id);
        }
      }
      for (const childId of childIds) {
        const child = allItems.find((item) => item.id === childId);
        if (!child) continue;
        push(stripEbaySoldLink(child, orderId, wipeAllEbayOrderCycles));
      }
      const shellComment = (root.comment2 || '').toLowerCase();
      const ebayShell =
        deleteEbayBundleShells &&
        (root.isBundle || root.isPC) &&
        (isLinked(root, allItems) ||
          shellComment.includes('abrechnung') ||
          shellComment.includes('ebay order') ||
          shellComment.includes('sold bundle'));
      if (ebayShell) {
        deleteIds.push(root.id);
      } else {
        push(stripEbaySoldLink(root, orderId, wipeAllEbayOrderCycles));
      }
      continue;
    }

    for (const item of linked) {
      push(stripEbaySoldLink(item, orderId, wipeAllEbayOrderCycles));
    }
  }

  for (const item of allItems) {
    if (seen.has(item.id)) continue;
    if (!isLinked(item, allItems)) continue;
    if ((item.ebayOrderId || '').trim()) continue;
    push(stripOne(item, undefined, wipeAllEbayOrderCycles));
  }

  return {
    updates,
    deleteIds: [...new Set(deleteIds)],
    strippedItemCount: updates.length,
    orderIds: [...orderIds],
  };
}

/** Remove Abrechnung CSV order bindings only. */
export function bulkStripAllEbayAbrechnungLinks(allItems: InventoryItem[]): BulkStripEbayLinksResult {
  return bulkStripEbayLinks(allItems, isEbayAbrechnungLinkedItem, true, false);
}

/** Sold/traded rows that still carry eBay order fields — hard scrub pass. */
export function planSoldItemEbayOrderFieldScrub(allItems: InventoryItem[]): InventoryItem[] {
  const updates: InventoryItem[] = [];
  for (const item of allItems) {
    if (!isSoldOrTradedOnly(item)) continue;
    const hasOrder =
      (item.ebayOrderId || '').trim() ||
      (item.ebayUsername || '').trim() ||
      item.platformSold === 'ebay.de' ||
      item.paymentType === 'ebay.de' ||
      (item.saleProceeds?.source && EBAY_PROCEEDS.has(item.saleProceeds.source)) ||
      (item.ebaySaleCycles || []).some((c) => (c.ebayOrderId || '').trim());
    if (!hasOrder) continue;
    updates.push(stripEbaySoldLink(item, item.ebayOrderId, true));
  }
  return updates;
}

/** Remove all eBay order links from sold/traded inventory rows. */
export function bulkStripAllEbaySoldLinks(allItems: InventoryItem[]): BulkStripEbayLinksResult {
  const first = bulkStripEbayLinks(allItems, isEbayLinkedSoldItem, true, true);
  const byId = new Map(allItems.map((item) => [item.id, item]));
  for (const patch of first.updates) byId.set(patch.id, patch);
  for (const id of first.deleteIds) byId.delete(id);

  let merged = [...byId.values()];
  let allUpdates = [...first.updates];
  let allDeleteIds = [...first.deleteIds];

  for (let pass = 0; pass < 2; pass += 1) {
    const scrub = planSoldItemEbayOrderFieldScrub(merged);
    if (!scrub.length) break;
    const seen = new Set(allUpdates.map((u) => u.id));
    for (const patch of scrub) {
      byId.set(patch.id, patch);
      if (!seen.has(patch.id)) {
        seen.add(patch.id);
        allUpdates.push(patch);
      } else {
        const idx = allUpdates.findIndex((u) => u.id === patch.id);
        if (idx >= 0) allUpdates[idx] = patch;
      }
    }
    merged = [...byId.values()];
  }

  return {
    updates: allUpdates,
    deleteIds: [...new Set(allDeleteIds)],
    strippedItemCount: allUpdates.length,
    orderIds: first.orderIds,
  };
}

/** Sold/traded (or recently unlinked) rows that still carry eBay order fields. */
export function countItemsWithEbayOrderData(allItems: InventoryItem[]): {
  withOrderId: number;
  withUsername: number;
  withEbayProceeds: number;
  withOrderCycle: number;
  soldWithAnyOrderData: number;
  sampleOrderIds: string[];
} {
  let withOrderId = 0;
  let withUsername = 0;
  let withEbayProceeds = 0;
  let withOrderCycle = 0;
  let soldWithAnyOrderData = 0;
  const sampleOrderIds: string[] = [];
  for (const item of allItems) {
    const oid = (item.ebayOrderId || '').trim();
    const user = (item.ebayUsername || '').trim();
    const proceeds = item.saleProceeds?.source;
    const ebayProceeds = Boolean(proceeds && EBAY_PROCEEDS.has(proceeds));
    const cycleOid = (item.ebaySaleCycles || []).some((c) => (c.ebayOrderId || '').trim());
    if (oid) {
      withOrderId += 1;
      if (sampleOrderIds.length < 8) sampleOrderIds.push(oid);
    }
    if (user) withUsername += 1;
    if (ebayProceeds) withEbayProceeds += 1;
    if (cycleOid) withOrderCycle += 1;
    if (isSoldOrTradedOnly(item) && (oid || user || ebayProceeds || cycleOid || hasEbaySaleSignals(item))) {
      soldWithAnyOrderData += 1;
    }
  }
  return {
    withOrderId,
    withUsername,
    withEbayProceeds,
    withOrderCycle,
    soldWithAnyOrderData,
    sampleOrderIds,
  };
}

export type BulkStripEbayAbrechnungResult = BulkStripEbayLinksResult;

export function countEbayAbrechnungLinkedItems(allItems: InventoryItem[]): number {
  const ids = new Set<string>();
  for (const item of allItems) {
    if (isEbayAbrechnungLinkedItem(item, allItems)) ids.add(item.id);
  }
  return ids.size;
}

export function countEbayLinkedSoldItems(allItems: InventoryItem[]): number {
  const ids = new Set<string>();
  for (const item of allItems) {
    if (isEbayLinkedSoldItem(item, allItems)) ids.add(item.id);
  }
  return ids.size;
}

/** Split large inventory patches so the UI thread stays responsive. */
export async function applyInventoryUpdatesInChunks(
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: import('../types').ItemUpdateOptions) => void,
  updates: InventoryItem[],
  deleteIds: string[] | undefined,
  options: import('../types').ItemUpdateOptions,
  chunkSize = 35
): Promise<void> {
  if (!updates.length) {
    if (deleteIds?.length) onUpdate([], deleteIds, options);
    return;
  }
  const batches: InventoryItem[][] = [];
  for (let i = 0; i < updates.length; i += chunkSize) {
    batches.push(updates.slice(i, i + chunkSize));
  }
  for (let i = 0; i < batches.length; i += 1) {
    const isLast = i === batches.length - 1;
    onUpdate(batches[i], i === 0 ? deleteIds : undefined, {
      ...options,
      skipActionLog: i > 0 ? true : options.skipActionLog,
      flushCloud: isLast ? options.flushCloud : false,
      actionNote:
        i === 0
          ? options.actionNote
          : options.actionNote
            ? { ...options.actionNote, details: `${options.actionNote.details || ''} (batch ${i + 1}/${batches.length})` }
            : undefined,
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
}
