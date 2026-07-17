import { InventoryItem, ItemStatus } from '../types';
import { isMixedBundleContainer } from './containerTaxonomy';

export type ContainerKind = 'mixed' | 'bundle' | 'pc';

/** @deprecated use 'mixed' — kept for call sites during transition */
export type LegacyLotKind = 'lot';

export function isInventoryContainer(item: InventoryItem): boolean {
  return Boolean(
    item.isPC ||
      item.isBundle ||
      item.category === 'Bundle' ||
      item.category === 'Mixed Bundle' ||
      item.category === 'PC'
  );
}

export function getContainerKind(container: InventoryItem | undefined | null): ContainerKind | null {
  if (!container) return null;
  if (container.isPC || container.category === 'PC') return 'pc';
  if (isMixedBundleContainer(container)) return 'mixed';
  if (container.isBundle || container.category === 'Bundle') return 'bundle';
  return null;
}

export function getContainerKindLabel(kind: ContainerKind): string {
  switch (kind) {
    case 'mixed':
      return 'Mixed Bundle';
    case 'bundle':
      return 'Bundle';
    case 'pc':
      return 'PC build';
  }
}

export function getContainerKindShortLabel(kind: ContainerKind): string {
  switch (kind) {
    case 'mixed':
      return 'Mixed';
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

/** Reverse index: child item id → parent PC/bundle/mixed container. */
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
    case 'mixed':
      return { badge: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
    case 'bundle':
      return { badge: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' };
    case 'pc':
      return { badge: 'bg-teal-100 text-teal-800 border-teal-200', dot: 'bg-teal-500' };
  }
}
