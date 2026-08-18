/**
 * Frozen cost provenance for inventory rows.
 * Explains how an item was added and why its first buy price was that amount.
 */

import type {
  CostAllocationMethod,
  CostOriginKind,
  CostOriginSibling,
  InventoryItem,
  ItemCostOrigin,
} from '../types';

export type BuildCostOriginInput = {
  kind: CostOriginKind;
  capturedAt?: string;
  addedAs?: string;
  bundleName?: string;
  bundleId?: string;
  sourceItemId?: string;
  sourceItemName?: string;
  bulkImportId?: string;
  lotTotalEur: number;
  allocatedEur: number;
  allocationMethod: CostAllocationMethod;
  allocationMode?: ItemCostOrigin['allocationMode'];
  weight?: number;
  manualLocked?: boolean;
  siblings?: CostOriginSibling[];
  notes?: string;
};

const KIND_LABEL: Record<CostOriginKind, string> = {
  single_add: 'Single add',
  bulk_import: 'Bulk entry',
  compose_pc: 'PC compose',
  compose_bundle: 'Bundle compose',
  compose_mixed: 'Mixed lot compose',
  split_identical: 'Identical split',
  split_parts: 'Part split',
  trade_in: 'Trade in',
  ebay_purchase: 'eBay purchase',
  inbox_purchase: 'Inbox purchase',
  ebay_listing_import: 'eBay listing import',
  csv_import: 'Spreadsheet import',
  print_3d: '3D print',
  reinvest_prefill: 'Reinvest add',
  quick_bundle_add: 'Quick bundle add',
};

const METHOD_LABEL: Record<CostAllocationMethod, string> = {
  manual: 'manual lock',
  equal: 'equal split',
  smart: 'SMART split',
  weighted: 'weighted split',
  sum_parts: 'sum of parts',
  trade_equal: 'trade equal split',
  trade_smart: 'trade SMART split',
  calculator_3d: '3D calculator',
  import_zero: 'imported at €0',
  unknown: 'unknown',
};

function roundEur(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((Number(value) || 0) * 10) / 10;
}

export function costOriginKindLabel(kind: CostOriginKind | string | undefined): string {
  if (!kind) return 'Unknown';
  return KIND_LABEL[kind as CostOriginKind] || String(kind);
}

export function costAllocationMethodLabel(method: CostAllocationMethod | string | undefined): string {
  if (!method) return '';
  return METHOD_LABEL[method as CostAllocationMethod] || String(method);
}

function defaultAddedAs(kind: CostOriginKind): string {
  switch (kind) {
    case 'bulk_import':
      return 'Bulk entry';
    case 'split_identical':
      return 'Split identical copies from a lot';
    case 'split_parts':
      return 'Split into different parts';
    case 'trade_in':
      return 'Received in a trade';
    case 'compose_pc':
      return 'PC built from existing parts';
    case 'compose_bundle':
      return 'Bundle composed from existing parts';
    case 'compose_mixed':
      return 'Mixed lot composed from existing parts';
    case 'ebay_purchase':
      return 'Confirmed eBay purchase';
    case 'inbox_purchase':
      return 'Confirmed inbox purchase';
    case 'ebay_listing_import':
      return 'Imported from your eBay listing';
    case 'csv_import':
      return 'Imported from a spreadsheet';
    case 'print_3d':
      return '3D print production';
    case 'reinvest_prefill':
      return 'Added from Reinvest';
    case 'quick_bundle_add':
      return 'Added into an existing PC / bundle';
    default:
      return 'Single item add';
  }
}

function composeLabel(input: BuildCostOriginInput, partCount: number, sharePct: number): string {
  const kind = costOriginKindLabel(input.kind);
  const method = costAllocationMethodLabel(input.allocationMethod);
  const lot = roundEur(input.lotTotalEur);
  const share = roundEur(input.allocatedEur);
  if (partCount <= 1) {
    return method && method !== 'unknown'
      ? `${kind} · ${method} · €${share.toFixed(2)}`
      : `${kind} · €${share.toFixed(2)}`;
  }
  const methodBit = method ? ` · ${method}` : '';
  return `${kind}${methodBit} · €${lot.toFixed(2)} ÷ ${partCount} → €${share.toFixed(2)} (${sharePct}%)`;
}

export function buildCostOrigin(input: BuildCostOriginInput): ItemCostOrigin {
  const siblings = (input.siblings || [])
    .map((row) => ({
      id: row.id,
      name: String(row.name || 'Part').trim() || 'Part',
      allocatedEur: roundEur(row.allocatedEur),
      weight: Number.isFinite(Number(row.weight)) ? Number(row.weight) : undefined,
      locked: Boolean(row.locked),
    }))
    .filter((row) => row.name);
  const partCount = Math.max(1, siblings.length || 1);
  const lotTotalEur = roundEur(input.lotTotalEur);
  const allocatedEur = roundEur(input.allocatedEur);
  const weightSum = siblings.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const weightSharePct = Number.isFinite(Number(input.weight)) && weightSum > 0
    ? roundPct((Number(input.weight) / weightSum) * 100)
    : lotTotalEur > 0
      ? roundPct((allocatedEur / lotTotalEur) * 100)
      : partCount > 1
        ? roundPct(100 / partCount)
        : 100;

  return {
    kind: input.kind,
    capturedAt: input.capturedAt || new Date().toISOString(),
    label: composeLabel(input, partCount, weightSharePct),
    addedAs: (input.addedAs || defaultAddedAs(input.kind)).trim(),
    bundleName: input.bundleName?.trim() || undefined,
    bundleId: input.bundleId || undefined,
    sourceItemId: input.sourceItemId || undefined,
    sourceItemName: input.sourceItemName?.trim() || undefined,
    bulkImportId: input.bulkImportId || undefined,
    partCount,
    lotTotalEur,
    allocatedEur,
    allocationMethod: input.allocationMethod,
    allocationMode: input.allocationMode,
    weight: Number.isFinite(Number(input.weight)) ? Number(input.weight) : undefined,
    weightSharePct,
    manualLocked: Boolean(input.manualLocked),
    siblings: siblings.length ? siblings : undefined,
    notes: input.notes?.trim() || undefined,
  };
}

/** First write wins. Later saves must not rewrite origin. */
export function freezeCostOrigin(
  existing: ItemCostOrigin | undefined,
  next: ItemCostOrigin | undefined
): ItemCostOrigin | undefined {
  return existing || next;
}

export function withFrozenCostOrigin(item: InventoryItem, origin: ItemCostOrigin | undefined): InventoryItem {
  if (item.costOrigin) return item;
  if (!origin) return item;
  return { ...item, costOrigin: origin };
}

function siblingSnapshot(items: InventoryItem[]): CostOriginSibling[] {
  return items.map((row) => ({
    id: row.id,
    name: row.name,
    allocatedEur: Number(row.buyPrice) || 0,
  }));
}

/**
 * Best-effort origin for older rows that never stored costOrigin.
 * Live sibling prices are a reconstruction, not the frozen snapshot.
 */
export function inferCostOrigin(item: InventoryItem, allItems: InventoryItem[] = []): ItemCostOrigin | null {
  if (item.costOrigin) return item.costOrigin;

  const allocatedEur = Number(item.buyPrice) || 0;
  const bulkPeers = item.bulkImportId
    ? allItems.filter((row) => row.bulkImportId === item.bulkImportId && !row.isBundle && !row.isPC)
    : [];
  if (item.bulkImportId && bulkPeers.length) {
    const lotTotalEur = bulkPeers.reduce((sum, row) => sum + (Number(row.buyPrice) || 0), 0);
    const parent = allItems.find((row) => row.id === item.parentContainerId)
      || allItems.find((row) => row.bulkImportId === item.bulkImportId && (row.isBundle || row.isPC));
    return buildCostOrigin({
      kind: 'bulk_import',
      addedAs: parent ? 'Bulk entry (reconstructed from batch)' : 'Bulk entry (reconstructed)',
      bundleName: parent?.name,
      bundleId: parent?.id || item.parentContainerId,
      bulkImportId: item.bulkImportId,
      lotTotalEur: lotTotalEur || allocatedEur,
      allocatedEur,
      allocationMethod: 'unknown',
      siblings: siblingSnapshot(bulkPeers),
      notes: 'Reconstructed from current batch prices — original split snapshot was not stored.',
    });
  }

  if (/^split from /i.test(item.comment1 || '') || /identical split /i.test(item.comment1 || '')) {
    const parent = allItems.find((row) => row.id === item.parentContainerId);
    const peers = parent
      ? allItems.filter((row) => row.parentContainerId === parent.id)
      : [];
    const lotTotalEur = peers.reduce((sum, row) => sum + (Number(row.buyPrice) || 0), 0)
      || Number(parent?.buyPrice)
      || allocatedEur;
    const identical = /identical split /i.test(item.comment1 || '');
    return buildCostOrigin({
      kind: identical ? 'split_identical' : 'split_parts',
      sourceItemId: parent?.id,
      sourceItemName: parent?.name,
      bundleName: parent?.name,
      bundleId: parent?.id,
      lotTotalEur,
      allocatedEur,
      allocationMethod: identical ? 'equal' : 'weighted',
      siblings: siblingSnapshot(peers.length ? peers : [item]),
      notes: 'Reconstructed from split comments — original weights were not stored.',
    });
  }

  if (item.tradedFromId) {
    const source = allItems.find((row) => row.id === item.tradedFromId);
    const peers = allItems.filter((row) => row.tradedFromId === item.tradedFromId);
    const lotTotalEur = peers.reduce((sum, row) => sum + (Number(row.buyPrice) || 0), 0) || allocatedEur;
    return buildCostOrigin({
      kind: 'trade_in',
      sourceItemId: item.tradedFromId,
      sourceItemName: source?.name,
      lotTotalEur,
      allocatedEur,
      allocationMethod: 'unknown',
      siblings: siblingSnapshot(peers.length ? peers : [item]),
      notes: 'Reconstructed from trade link.',
    });
  }

  if (item.parentContainerId) {
    const parent = allItems.find((row) => row.id === item.parentContainerId);
    const peers = allItems.filter((row) => row.parentContainerId === item.parentContainerId);
    if (parent && peers.length > 1) {
      const lotTotalEur = peers.reduce((sum, row) => sum + (Number(row.buyPrice) || 0), 0)
        || Number(parent.buyPrice)
        || allocatedEur;
      return buildCostOrigin({
        kind: parent.isPC ? 'compose_pc' : parent.category === 'Mixed Bundle' ? 'compose_mixed' : 'compose_bundle',
        addedAs: 'Part of a PC / bundle (reconstructed)',
        bundleName: parent.name,
        bundleId: parent.id,
        lotTotalEur,
        allocatedEur,
        allocationMethod: 'sum_parts',
        siblings: siblingSnapshot(peers),
        notes: 'This part kept its own buy price when composed. Snapshot reconstructed from current members.',
      });
    }
  }

  if (item.printStage || /3d printed/i.test(item.comment1 || '')) {
    return buildCostOrigin({
      kind: 'print_3d',
      lotTotalEur: allocatedEur,
      allocatedEur,
      allocationMethod: 'calculator_3d',
      siblings: [{ name: item.name, allocatedEur }],
      notes: item.comment2 || undefined,
    });
  }

  return buildCostOrigin({
    kind: 'single_add',
    lotTotalEur: allocatedEur,
    allocatedEur,
    allocationMethod: 'manual',
    siblings: [{ id: item.id, name: item.name, allocatedEur }],
  });
}

export function resolveCostOrigin(item: InventoryItem, allItems: InventoryItem[] = []): ItemCostOrigin {
  return item.costOrigin || inferCostOrigin(item, allItems) || buildCostOrigin({
    kind: 'single_add',
    lotTotalEur: Number(item.buyPrice) || 0,
    allocatedEur: Number(item.buyPrice) || 0,
    allocationMethod: 'unknown',
  });
}
