/**
 * Repair inventory rows falsely marked Sold from mistaken Abrechnung links —
 * especially standalone ex-bundle parts with order-id-only bindings (no line match).
 */
import { ItemStatus, type InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { itemLinkedToEbayTxRow } from './ebayTxRowLink';
import { isEbayAbrechnungLinkedItem } from './bulkStripEbayAbrechnungLinks';
import { clearLiveSaleWithoutArchive, stripMistakenAbrechnungCycles } from './itemSaleCycle';
import type { EbayTxRow } from './ebayTransactionReport';
import { toLocalCalendarDateKey } from './calendarDate';

export type FalseAbrechnungSoldSample = {
  id: string;
  name: string;
  sellDate?: string;
  ebayOrderId?: string;
  reason: string;
};

export type FalseAbrechnungSoldRepairPlan = {
  updates: InventoryItem[];
  samples: FalseAbrechnungSoldSample[];
};

function abrechnungRowsByOrderId(rows: EbayTxRow[]): Map<string, EbayTxRow[]> {
  const map = new Map<string, EbayTxRow[]>();
  for (const row of rows) {
    if (row.kind !== 'order') continue;
    const oid = (row.orderId || '').trim().toLowerCase();
    if (!oid) continue;
    const list = map.get(oid) || [];
    list.push(row);
    map.set(oid, list);
  }
  return map;
}

function hasStrictAbrechnungMatch(item: InventoryItem, rowsByOrder: Map<string, EbayTxRow[]>): boolean {
  const oid = (item.ebayOrderId || '').trim().toLowerCase();
  if (!oid) return false;
  const orderRows = rowsByOrder.get(oid) || [];
  if (!orderRows.length) return false;
  return orderRows.some((row) => itemLinkedToEbayTxRow(item, row));
}

function findContainerParents(items: InventoryItem[], childId: string): InventoryItem[] {
  return items.filter(
    (row) =>
      (row.isPC || row.isBundle) &&
      !row.parentContainerId &&
      (row.componentIds || []).includes(childId)
  );
}

function repairTag(): string {
  return `[False Abrechnung link repair ${new Date().toLocaleDateString()}]`;
}

function withRepairTag(item: InventoryItem): InventoryItem {
  const tag = repairTag();
  if ((item.comment2 || '').includes(tag)) return item;
  return {
    ...item,
    comment2: item.comment2?.trim() ? `${item.comment2.trim()} ${tag}` : tag,
  };
}

/** Drop a mistaken Abrechnung sale and return the row to stock (no fake sale archive). */
export function stripMistakenAbrechnungSoldLink(item: InventoryItem): InventoryItem {
  const oid = (item.ebayOrderId || '').trim();
  let cycles = [...(item.ebaySaleCycles || [])];
  if (oid) cycles = stripMistakenAbrechnungCycles(cycles, oid);
  const next = clearLiveSaleWithoutArchive(withRepairTag(item), {
    status: ItemStatus.IN_STOCK,
  });
  return {
    ...next,
    ebayListingId: undefined,
    ebaySku: undefined,
    ebaySaleCycles: cycles.length ? cycles : undefined,
    storeVisible: true,
  };
}

export function planFalseAbrechnungSoldRepairs(
  items: InventoryItem[],
  rows: EbayTxRow[],
  options?: { sellDate?: string; requireAbrechnungSource?: boolean }
): FalseAbrechnungSoldRepairPlan {
  const sellDateFilter = options?.sellDate?.trim().slice(0, 10);
  const requireSource = options?.requireAbrechnungSource ?? true;
  const rowsByOrder = abrechnungRowsByOrderId(rows);
  const hasReports = rows.length > 0;
  const updates: InventoryItem[] = [];
  const samples: FalseAbrechnungSoldSample[] = [];
  const seen = new Set<string>();

  const push = (patched: InventoryItem, reason: string, source: InventoryItem) => {
    if (seen.has(patched.id)) return;
    seen.add(patched.id);
    updates.push(patched);
    if (samples.length < 50) {
      samples.push({
        id: source.id,
        name: source.name,
        sellDate: source.sellDate,
        ebayOrderId: source.ebayOrderId,
        reason,
      });
    }
  };

  for (const item of items) {
    if (item.isPC || item.isBundle || item.isDraft) continue;
    if (!isRealizedDisposal(item)) continue;
    if (sellDateFilter && toLocalCalendarDateKey(item.sellDate) !== sellDateFilter) continue;

    const abrechnungLinked = isEbayAbrechnungLinkedItem(item, items);
    const hasOrderId = Boolean((item.ebayOrderId || '').trim());
    if (requireSource && !abrechnungLinked && !hasOrderId) continue;

    const strictlyMatched =
      hasReports && hasOrderId && hasStrictAbrechnungMatch(item, rowsByOrder);
    if (strictlyMatched) continue;

    const parents = findContainerParents(items, item.id);
    const activeParent = parents.find(
      (p) =>
        !isRealizedDisposal(p) &&
        (p.status === ItemStatus.IN_STOCK ||
          p.status === ItemStatus.ORDERED ||
          p.status === ItemStatus.IN_COMPOSITION)
    );
    const soldParent = parents.find((p) => isRealizedDisposal(p));

    if (!item.parentContainerId && activeParent) {
      push(
        {
          ...stripMistakenAbrechnungSoldLink(item),
          parentContainerId: activeParent.id,
          status: ItemStatus.IN_COMPOSITION,
        },
        `Part still listed on active ${activeParent.isPC ? 'PC' : 'bundle'} “${activeParent.name}”`,
        item
      );
      continue;
    }

    if (!item.parentContainerId && soldParent && (abrechnungLinked || hasOrderId)) {
      push(
        {
          ...stripMistakenAbrechnungSoldLink(item),
          parentContainerId: soldParent.id,
          status: ItemStatus.IN_COMPOSITION,
        },
        `Standalone sale on part of sold ${soldParent.isPC ? 'PC' : 'bundle'} “${soldParent.name}”`,
        item
      );
      continue;
    }

    if (!hasReports || !hasOrderId) continue;

    if (!hasStrictAbrechnungMatch(item, rowsByOrder)) {
      push(
        stripMistakenAbrechnungSoldLink(item),
        `Order ${item.ebayOrderId} — no Abrechnung line matches this item`,
        item
      );
    }
  }

  return { updates, samples };
}

export function countFalseAbrechnungSoldRepairs(
  items: InventoryItem[],
  rows: EbayTxRow[],
  options?: { sellDate?: string }
): number {
  return planFalseAbrechnungSoldRepairs(items, rows, options).updates.length;
}
