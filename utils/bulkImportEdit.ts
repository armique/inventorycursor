/**
 * Apply SMART (or EQUAL) re-split of a bulk-import total onto live inventory members.
 */

import type { BulkImportRecord, InventoryItem } from '../types';
import { syncContainerBuyTotalsFromComponents } from '../services/containerAggregates';
import { splitBulkImportCosts, type BulkCostSplitMode } from './bulkImportCostSplit';
import { getBulkImportMembers, refreshBulkImportLabel } from './bulkImportHistory';

export function applyBulkImportResplit(params: {
  record: BulkImportRecord;
  items: InventoryItem[];
  totalCost: number;
  mode?: BulkCostSplitMode;
  /** Item ids whose buyPrice is locked (manual). */
  lockedItemIds?: Set<string>;
}): { record: BulkImportRecord; patchedItems: InventoryItem[] } {
  const mode = params.mode || 'SMART';
  const members = getBulkImportMembers(params.record, params.items);
  const totalCost = Math.round(Math.max(0, params.totalCost) * 100) / 100;

  if (members.length === 0) {
    return {
      record: { ...params.record, totalCost },
      patchedItems: [],
    };
  }

  const costs = splitBulkImportCosts(
    members.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      subCategory: m.subCategory,
      isDefective: m.isDefective,
      manualCost: params.lockedItemIds?.has(m.id) ? Number(m.buyPrice) || 0 : undefined,
    })),
    totalCost,
    mode
  );

  const n = members.length;
  const totalNote = `Bulk Import (${n} items). Source total: €${totalCost.toFixed(2)}.`;
  const memberPatches = members.map((m) => ({
    ...m,
    buyPrice: costs[m.id] ?? m.buyPrice,
    bulkImportId: params.record.id,
    comment2: totalNote,
  }));

  const byId = new Map(params.items.map((i) => [i.id, i]));
  for (const p of memberPatches) byId.set(p.id, p);
  let merged = [...byId.values()];

  if (params.record.bundleId) {
    merged = syncContainerBuyTotalsFromComponents(merged, [params.record.bundleId]);
  }

  const patchedIds = new Set(memberPatches.map((m) => m.id));
  if (params.record.bundleId) patchedIds.add(params.record.bundleId);
  const patchedItems = merged.filter((i) => patchedIds.has(i.id));

  const record = refreshBulkImportLabel({ ...params.record, totalCost }, memberPatches);

  return { record, patchedItems };
}
