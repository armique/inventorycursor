import { InventoryItem, ItemStatus } from '../types';

export type ContainerKind = 'lot' | 'bundle' | 'pc';

export function isInventoryContainer(item: InventoryItem): boolean {
  return Boolean(item.isPC || item.isBundle || item.category === 'Bundle');
}

export function getContainerKind(container: InventoryItem | undefined | null): ContainerKind | null {
  if (!container) return null;
  if (container.isPC) return 'pc';
  if (container.subCategory === 'Lot Bundle') return 'lot';
  if (container.isBundle || container.category === 'Bundle') return 'bundle';
  return null;
}

export function getContainerKindLabel(kind: ContainerKind): string {
  switch (kind) {
    case 'lot':
      return 'Lot bundle';
    case 'bundle':
      return 'Bundle';
    case 'pc':
      return 'PC build';
  }
}

export function getContainerKindShortLabel(kind: ContainerKind): string {
  switch (kind) {
    case 'lot':
      return 'Lot';
    case 'bundle':
      return 'Bundle';
    case 'pc':
      return 'PC';
  }
}

export function buildContainersById(items: InventoryItem[]): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  for (const item of items) {
    if (isInventoryContainer(item)) map.set(item.id, item);
  }
  return map;
}

/** Reverse index: child item id → parent PC/bundle/lot container. */
export function buildContainerByChildId(items: InventoryItem[]): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  for (const container of items) {
    if (!isInventoryContainer(container)) continue;
    for (const childId of container.componentIds || []) {
      if (!childId || map.has(childId)) continue;
      map.set(childId, container);
    }
  }
  return map;
}

export function resolveParentContainer(
  item: InventoryItem,
  containersById: Map<string, InventoryItem>,
  containerByChildId?: Map<string, InventoryItem>
): InventoryItem | undefined {
  if (item.parentContainerId) {
    const direct = containersById.get(item.parentContainerId);
    if (direct) return direct;
  }
  return containerByChildId?.get(item.id);
}

export function isContainerMember(item: InventoryItem): boolean {
  return Boolean(item.parentContainerId) || item.status === ItemStatus.IN_COMPOSITION;
}

export function containerMembershipStyles(kind: ContainerKind): {
  badge: string;
  dot: string;
} {
  switch (kind) {
    case 'lot':
      return {
        badge: 'bg-amber-100 text-amber-800 border-amber-200/80',
        dot: 'bg-amber-500',
      };
    case 'bundle':
      return {
        badge: 'bg-purple-100 text-purple-700 border-purple-200/80',
        dot: 'bg-purple-500',
      };
    case 'pc':
      return {
        badge: 'bg-indigo-100 text-indigo-700 border-indigo-200/80',
        dot: 'bg-indigo-500',
      };
  }
}
