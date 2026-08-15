import { ItemStatus, type InventoryItem, type PrintStage } from '../types';

export const PRINT_STAGES: PrintStage[] = ['queued', 'printing', 'ready', 'sold'];

export const PRINT_STAGE_LABEL: Record<PrintStage, string> = {
  queued: 'Job',
  printing: 'Printing',
  ready: 'Ready',
  sold: 'Sold',
};

export function isThreeDPrintItem(item: InventoryItem): boolean {
  const method = String(item.specs?.['Production Method'] || '');
  if (method === '3D Printed') return true;
  if (item.subCategory === '3D Printed') return true;
  return Boolean(item.specs?.['Filament Weight'] || item.specs?.['Print Time']);
}

export function resolvePrintStage(item: InventoryItem): PrintStage {
  if (item.printStage) return item.printStage;
  if (
    item.status === ItemStatus.SOLD ||
    item.status === ItemStatus.TRADED ||
    item.status === ItemStatus.GIFTED
  ) {
    return 'sold';
  }
  return 'queued';
}

export function nextPrintStage(stage: PrintStage): PrintStage | null {
  const i = PRINT_STAGES.indexOf(stage);
  if (i < 0 || i >= PRINT_STAGES.length - 1) return null;
  return PRINT_STAGES[i + 1];
}

export function applyPrintStage(item: InventoryItem, stage: PrintStage): InventoryItem {
  const today = new Date().toISOString().split('T')[0];
  if (stage === 'sold') {
    return {
      ...item,
      printStage: 'sold',
      status: ItemStatus.SOLD,
      sellDate: item.sellDate || today,
      storeVisible: false,
    };
  }
  return {
    ...item,
    printStage: stage,
    status: item.status === ItemStatus.SOLD ? ItemStatus.IN_STOCK : item.status,
  };
}

export function groupPrintQueue(items: InventoryItem[]): Record<PrintStage, InventoryItem[]> {
  const groups: Record<PrintStage, InventoryItem[]> = {
    queued: [],
    printing: [],
    ready: [],
    sold: [],
  };
  for (const item of items) {
    if (!isThreeDPrintItem(item)) continue;
    groups[resolvePrintStage(item)].push(item);
  }
  return groups;
}
