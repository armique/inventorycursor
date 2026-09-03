/**
 * Surgical inventory restore — merge bundle/PC structure + child sell prices from a
 * reference backup into the CURRENT inventory, WITHOUT touching eBay / Abrechnung state.
 */
import { ItemStatus, type InventoryItem } from '../types';

/** Hard blocklist — never copied from backup. */
const NEVER_PATCH: ReadonlySet<keyof InventoryItem> = new Set<keyof InventoryItem>([
  'ebayOrderId',
  'ebayOrderLineKey',
  'ebayListingId',
  'ebayOfferId',
  'ebaySku',
  'ebayUsername',
  'ebayOrderScreenshotUrl',
  'saleProceeds',
  'ebaySaleAdjustments',
  'ebaySaleCycles',
  'pendingRefundFeeOrderIds',
  'feeAmount',
  'hasFee',
  'sellerPaidShipping',
  'sellerShippingAmount',
  'originalSellPrice',
  'customer',
  'invoiceNumber',
  'paymentType',
  'platformSold',
]);

const CONTAINER_STRUCTURE_FIELDS: (keyof InventoryItem)[] = [
  'isBundle',
  'isPC',
  'componentIds',
  'splitOrigin',
];

const CHILD_STRUCTURE_FIELDS: (keyof InventoryItem)[] = [
  'parentContainerId',
  'splitOrigin',
  'isSplitRemainder',
];

const PRICE_DATE_FIELDS: (keyof InventoryItem)[] = [
  'sellPrice',
  'buyPrice',
  'profit',
  'sellDate',
  'buyDate',
  'containerSoldDate',
];

const BUNDLE_MEMBER_PRICE_FIELDS: (keyof InventoryItem)[] = [
  'sellPrice',
  'buyPrice',
  'profit',
  'sellDate',
  'containerSoldDate',
];

export function hasAbrechnungLinkage(it: InventoryItem): boolean {
  return Boolean(
    it.ebayOrderId ||
      it.ebayOrderLineKey ||
      it.ebayListingId ||
      it.ebayOfferId ||
      it.ebaySku ||
      it.saleProceeds ||
      (it.ebaySaleAdjustments && it.ebaySaleAdjustments.length) ||
      (it.ebaySaleCycles && it.ebaySaleCycles.length) ||
      (it.pendingRefundFeeOrderIds && it.pendingRefundFeeOrderIds.length),
  );
}

function isContainerRow(it: InventoryItem): boolean {
  return Boolean(it.isBundle || it.isPC || (it.componentIds && it.componentIds.length));
}

function arraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return arraysEqual(a, b);
  return a === b;
}

function containerChildOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  let shared = 0;
  for (const id of a) if (setB.has(id)) shared++;
  return shared;
}

/** Strip live sale linkage fields from a container row copied out of a reference backup. */
export function sanitizeContainerFromBackup(
  bak: InventoryItem,
  componentIds: string[],
): InventoryItem {
  const row: InventoryItem = { ...bak, componentIds };
  for (const field of NEVER_PATCH) {
    delete (row as Record<string, unknown>)[field as string];
  }
  return row;
}

export interface MergeOptions {
  patchNames?: boolean;
  forcePrices?: boolean;
  patchChildStatus?: boolean;
  /** Re-add sold bundle/PC shells from backup when >=2 of their parts still exist. Default true. */
  restoreMissingContainers?: boolean;
  /** Drop current-only duplicate shells that overlap a reference container. Default true. */
  removeDuplicateContainers?: boolean;
  /**
   * Patch child sell prices from backup when re-linking bundle membership — composition
   * splits, not Abrechnung order totals. Keeps ebayOrderId etc. Default true.
   */
  forceBundleMemberPrices?: boolean;
}

export interface FieldChange {
  id: string;
  name: string;
  field: string;
  from: unknown;
  to: unknown;
  category: 'structure' | 'price' | 'status' | 'name' | 'restore' | 'remove';
}

export interface MergeReport {
  currentCount: number;
  backupCount: number;
  matchedById: number;
  itemsChanged: number;
  fieldChanges: number;
  changesByField: Record<string, number>;
  changesByCategory: Record<string, number>;
  skippedAbrechnungPrice: number;
  skippedAbrechnungStatus: number;
  backupOnlySkipped: number;
  currentOnlyUntouched: number;
  containersRestored: number;
  containersRemoved: number;
  changes: FieldChange[];
}

export function mergeInventoryFromBackup(
  current: InventoryItem[],
  backup: InventoryItem[],
  opts: MergeOptions = {},
): { merged: InventoryItem[]; report: MergeReport } {
  const patchNames = opts.patchNames ?? false;
  const forcePrices = opts.forcePrices ?? false;
  const patchChildStatus = opts.patchChildStatus ?? true;
  const restoreMissingContainers = opts.restoreMissingContainers ?? true;
  const removeDuplicateContainers = opts.removeDuplicateContainers ?? restoreMissingContainers;
  const forceBundleMemberPrices = opts.forceBundleMemberPrices ?? true;

  const originalCurrentIds = new Set(current.map((i) => i.id));
  const backupById = new Map(backup.map((i) => [i.id, i]));

  const report: MergeReport = {
    currentCount: current.length,
    backupCount: backup.length,
    matchedById: 0,
    itemsChanged: 0,
    fieldChanges: 0,
    changesByField: {},
    changesByCategory: { structure: 0, price: 0, status: 0, name: 0, restore: 0, remove: 0 },
    skippedAbrechnungPrice: 0,
    skippedAbrechnungStatus: 0,
    backupOnlySkipped: 0,
    currentOnlyUntouched: 0,
    containersRestored: 0,
    containersRemoved: 0,
    changes: [],
  };

  const restoredContainers: InventoryItem[] = [];
  const removedContainerIds = new Set<string>();

  if (restoreMissingContainers) {
    for (const bak of backup) {
      if (!isContainerRow(bak) || originalCurrentIds.has(bak.id)) continue;
      const childIds = (bak.componentIds || []).filter((id) => originalCurrentIds.has(id));
      if (childIds.length < 2) continue;
      restoredContainers.push(sanitizeContainerFromBackup(bak, childIds));
    }

    if (removeDuplicateContainers && restoredContainers.length) {
      for (const restored of restoredContainers) {
        const restoredChildIds = restored.componentIds || [];
        for (const cur of current) {
          if (!isContainerRow(cur) || cur.id === restored.id) continue;
          const curChildIds = cur.componentIds || [];
          if (curChildIds.length < 2) continue;
          const overlap = containerChildOverlap(curChildIds, restoredChildIds);
          const minSize = Math.min(curChildIds.length, restoredChildIds.length);
          if (minSize >= 2 && overlap >= Math.ceil(minSize * 0.75)) {
            removedContainerIds.add(cur.id);
          }
        }
      }
    }
  }

  report.containersRestored = restoredContainers.length;
  report.containersRemoved = removedContainerIds.size;
  for (const c of restoredContainers) {
    report.changes.push({
      id: c.id,
      name: c.name,
      field: '(restored container)',
      from: undefined,
      to: `${c.componentIds?.length ?? 0} parts`,
      category: 'restore',
    });
  }
  for (const id of removedContainerIds) {
    const cur = current.find((i) => i.id === id);
    report.changes.push({
      id,
      name: cur?.name || id,
      field: '(removed duplicate container)',
      from: cur?.componentIds?.length,
      to: undefined,
      category: 'remove',
    });
  }

  let baseItems = current.filter((i) => !removedContainerIds.has(i.id));
  baseItems = [...baseItems, ...restoredContainers];
  const workingIds = new Set(baseItems.map((i) => i.id));

  const merged: InventoryItem[] = baseItems.map((cur) => {
    const bak = backupById.get(cur.id);
    const isRestoredContainer = restoredContainers.some((c) => c.id === cur.id);

    if (!bak) {
      if (originalCurrentIds.has(cur.id)) report.currentOnlyUntouched++;
      return cur;
    }
    if (originalCurrentIds.has(cur.id)) report.matchedById++;

    const next: InventoryItem = { ...cur };
    let itemChanged = isRestoredContainer;

    const setField = (
      field: keyof InventoryItem,
      value: unknown,
      category: FieldChange['category'],
    ) => {
      if (NEVER_PATCH.has(field)) return;
      if (valuesEqual(cur[field], value)) return;
      (next as Record<string, unknown>)[field as string] = value;
      itemChanged = true;
      report.fieldChanges++;
      report.changesByField[field as string] =
        (report.changesByField[field as string] || 0) + 1;
      report.changesByCategory[category] = (report.changesByCategory[category] || 0) + 1;
      report.changes.push({
        id: cur.id,
        name: cur.name,
        field: field as string,
        from: cur[field],
        to: value,
        category,
      });
    };

    const backupIsContainer = isContainerRow(bak);
    const backupParentId = (bak.parentContainerId || '').trim();
    const backupIsChild = Boolean(backupParentId);
    const parentResolvable = backupParentId && workingIds.has(backupParentId);

    if (backupIsContainer) {
      for (const field of CONTAINER_STRUCTURE_FIELDS) {
        if (field === 'componentIds') {
          const ids = Array.isArray(bak.componentIds)
            ? bak.componentIds.filter((id) => workingIds.has(id))
            : undefined;
          if (ids && ids.length) setField('componentIds', ids, 'structure');
          continue;
        }
        if (bak[field] !== undefined) setField(field, bak[field], 'structure');
      }
    }

    if (backupIsChild && parentResolvable) {
      for (const field of CHILD_STRUCTURE_FIELDS) {
        if (field === 'parentContainerId') {
          setField('parentContainerId', backupParentId, 'structure');
          continue;
        }
        if (bak[field] !== undefined) setField(field, bak[field], 'structure');
      }
    }

    const abrechnungLocked = hasAbrechnungLinkage(cur);
    const bundleMemberRestore = backupIsChild && parentResolvable && forceBundleMemberPrices;

    if (bundleMemberRestore) {
      for (const field of BUNDLE_MEMBER_PRICE_FIELDS) {
        if (bak[field] !== undefined) setField(field, bak[field], 'price');
      }
      if (patchChildStatus && bak.status === ItemStatus.IN_COMPOSITION) {
        if (cur.status !== ItemStatus.IN_COMPOSITION) {
          setField('status', ItemStatus.IN_COMPOSITION, 'status');
        }
      }
    } else if (abrechnungLocked && !forcePrices) {
      report.skippedAbrechnungPrice++;
      if (patchChildStatus && bak.status === ItemStatus.IN_COMPOSITION && cur.status !== ItemStatus.IN_COMPOSITION) {
        report.skippedAbrechnungStatus++;
      }
    } else {
      for (const field of PRICE_DATE_FIELDS) {
        if (bak[field] !== undefined) setField(field, bak[field], 'price');
      }
      if (patchChildStatus && bak.status === ItemStatus.IN_COMPOSITION) {
        if (cur.status !== ItemStatus.IN_COMPOSITION) {
          setField('status', ItemStatus.IN_COMPOSITION, 'status');
        }
      }
    }

    if (patchNames && backupIsContainer && bak.name) {
      setField('name', bak.name, 'name');
    }

    if (itemChanged) report.itemsChanged++;
    return itemChanged ? next : cur;
  });

  for (const bak of backup) {
    if (!originalCurrentIds.has(bak.id) && !restoredContainers.some((c) => c.id === bak.id)) {
      report.backupOnlySkipped++;
    }
  }

  return { merged, report };
}

export function formatMergeReportSummary(report: MergeReport): string {
  const lines = [
    `${report.itemsChanged} items would change (${report.fieldChanges} fields)`,
    `containers restored: ${report.containersRestored} · duplicate shells removed: ${report.containersRemoved}`,
    `matched: ${report.matchedById} · backup-only skipped: ${report.backupOnlySkipped}`,
    `structure: ${report.changesByCategory.structure ?? 0} · price: ${report.changesByCategory.price ?? 0} · status: ${report.changesByCategory.status ?? 0}`,
    `Abrechnung guard kept current prices on ${report.skippedAbrechnungPrice} standalone rows`,
  ];
  return lines.join('\n');
}
