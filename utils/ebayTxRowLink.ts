import type { InventoryItem, ItemSaleCycle } from '../types';
import { ebayTxRowLineKey, type EbayTxRow } from './ebayTransactionReport';

/** Live checkout links only — archived ebaySaleCycles must not keep restocked rows "linked". */
function activeLiveOrderIds(item: InventoryItem): string[] {
  const ids = new Set<string>();
  const push = (v?: string | null) => {
    const t = (v || '').trim().toLowerCase();
    if (t) ids.add(t);
  };
  push(item.ebayOrderId);
  push(item.saleProceeds?.externalOrderId);
  return [...ids];
}

const linkScore = (item: InventoryItem) =>
  (item.isBundle || item.isPC ? 4 : 0) + (item.parentContainerId ? 0 : 2);

function isCombinedMultiItemTitle(title: string): boolean {
  return title.includes(' + ');
}

function rowHasConcreteLine(row: EbayTxRow): boolean {
  const listingId = (row.listingId || '').trim();
  const title = (row.title || '').trim();
  return Boolean(listingId || (title && !isCombinedMultiItemTitle(title)));
}

/** True when this inventory row is bound to this specific Bestellung line (not just the order). */
export function itemLinkedToEbayTxRow(item: InventoryItem, row: EbayTxRow): boolean {
  const oid = (row.orderId || '').trim().toLowerCase();
  if (!oid) return false;
  const itemOid = (item.ebayOrderId || '').trim().toLowerCase();
  if (!itemOid || itemOid !== oid) return false;

  const lineKey = ebayTxRowLineKey(row).toLowerCase();
  const itemLineKey = (item.ebayOrderLineKey || '').trim().toLowerCase();
  if (lineKey && itemLineKey && lineKey === itemLineKey) return true;

  const listingId = (row.listingId || '').trim();
  const itemListing = (item.ebayListingId || '').trim();
  if (listingId && itemListing && listingId === itemListing) return true;

  const sku = (row.sku || '').trim().toLowerCase();
  const itemSku = (item.ebaySku || '').trim().toLowerCase();
  if (sku && itemSku && sku === itemSku) return true;

  const title = (row.title || '').trim().toLowerCase();
  const name = (item.name || '').trim().toLowerCase();
  if (title && name && !isCombinedMultiItemTitle(title) && name === title) return true;

  // Order-level link with no line identity — only valid on summary/combined rows.
  if (!rowHasConcreteLine(row)) {
    const hasLineIdentity = Boolean(itemListing || itemLineKey || itemSku);
    if (!hasLineIdentity) return true;
  }

  return false;
}

/**
 * Resolve which inventory item a Bestellung row is linked to.
 * Prefers listing/sku/line-key match so multi-item orders link 1:1 per row.
 */
export function findInventoryLinkedToEbayTxRow(
  items: InventoryItem[],
  row: EbayTxRow
): InventoryItem | null {
  const oid = (row.orderId || '').trim().toLowerCase();
  if (!oid) return null;

  const candidates = items.filter((item) => activeLiveOrderIds(item).includes(oid));
  if (!candidates.length) return null;

  const strict = candidates.filter((item) => itemLinkedToEbayTxRow(item, row));
  if (strict.length === 1) return strict[0];
  if (strict.length > 1) {
    return [...strict].sort((a, b) => linkScore(b) - linkScore(a) || a.id.localeCompare(b.id))[0] || null;
  }

  // Single linked item on a non-concrete row (legacy order-only link).
  if (candidates.length === 1 && !rowHasConcreteLine(row)) return candidates[0];

  const shells = candidates.filter((i) => i.isBundle || i.isPC);
  if (shells.length === 1 && !rowHasConcreteLine(row)) return shells[0];

  // Combined/summary row — pick best representative when several lines are linked.
  if (!rowHasConcreteLine(row)) {
    return [...candidates].sort((a, b) => linkScore(b) - linkScore(a) || a.id.localeCompare(b.id))[0] || null;
  }

  return null;
}

function cycleLinkedToEbayTxRow(cycle: ItemSaleCycle, row: EbayTxRow): boolean {
  const pseudo: InventoryItem = {
    id: 'cycle-pseudo',
    name: '',
    buyPrice: 0,
    category: '',
    status: 'Sold',
    ebayOrderId: cycle.ebayOrderId,
    ebayOrderLineKey: cycle.ebayOrderLineKey,
    ebayListingId: cycle.ebayListingId,
    ebaySku: cycle.ebaySku,
  };
  return itemLinkedToEbayTxRow(pseudo, row);
}

/** In-stock item whose archived ebaySaleCycles already closed this Bestellung line. */
export function findInventoryClosedSaleForEbayTxRow(
  items: InventoryItem[],
  row: EbayTxRow
): InventoryItem | null {
  const oid = (row.orderId || '').trim().toLowerCase();
  if (!oid) return null;

  const candidates: InventoryItem[] = [];
  for (const item of items) {
    for (const cycle of item.ebaySaleCycles || []) {
      if ((cycle.ebayOrderId || '').trim().toLowerCase() !== oid) continue;
      if (cycleLinkedToEbayTxRow(cycle, row)) candidates.push(item);
    }
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return [...candidates].sort((a, b) => linkScore(b) - linkScore(a) || a.id.localeCompare(b.id))[0] || null;
}

/** Map of orderId → preferred linked item (bundle/PC preferred). Used for fee rows & sorting. */
export function buildLinkedByOrderMap(items: InventoryItem[]): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  for (const item of items) {
    for (const oid of activeLiveOrderIds(item)) {
      const existing = map.get(oid);
      if (
        !existing ||
        linkScore(item) > linkScore(existing) ||
        (linkScore(item) === linkScore(existing) && item.id.localeCompare(existing.id) < 0)
      ) {
        map.set(oid, item);
      }
    }
  }
  return map;
}
