/**
 * Container membership invariants:
 * - A part has at most one parent PC/bundle (`parentContainerId` is authoritative).
 * - Each container's `componentIds` matches exactly the parts that point at it.
 * - Stale multi-listings are healed; emptied sold shells can be deleted.
 */

import { ItemStatus, type InventoryItem } from '../types';
import { isInventoryContainer, normalizeExclusiveContainerFlags } from './containerMembership';
import { isSoldOrTradedOnly } from './itemDisposition';

export type MembershipEnforceResult = {
  nextItems: InventoryItem[];
  deleteIds: string[];
  changed: boolean;
};

function isContainerRow(item: InventoryItem): boolean {
  return isInventoryContainer(item) || Boolean(item.isPC || item.isBundle);
}

function pickOwnerParentId(
  parentIds: string[],
  byId: Map<string, InventoryItem>,
  child: InventoryItem
): string {
  const parents = parentIds
    .map((id) => byId.get(id))
    .filter((p): p is InventoryItem => Boolean(p && isContainerRow(p)));
  if (parents.length <= 1) return (parents[0] || byId.get(parentIds[0]!))!.id;

  const scored = parents.map((p) => {
    let score = 0;
    if (p.isPC) score += 8;
    if (!isSoldOrTradedOnly(p)) score += 4;
    if (child.sellDate && p.sellDate && child.sellDate.slice(0, 10) === p.sellDate.slice(0, 10)) {
      score += 6;
    }
    if (child.status === ItemStatus.IN_COMPOSITION) score += 2;
    return { id: p.id, score };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored[0]!.id;
}

/**
 * Enforce one-parent ownership and sync componentIds ↔ parentContainerId.
 * Idempotent when already consistent (returns the same array reference).
 */
export function enforceContainerMembershipInvariants(items: InventoryItem[]): MembershipEnforceResult {
  if (items.length === 0) {
    return { nextItems: items, deleteIds: [], changed: false };
  }

  let changed = false;
  const working = items.map((i) => {
    const normalized = normalizeExclusiveContainerFlags(i);
    if (normalized !== i) changed = true;
    return { ...normalized };
  });
  const byId = new Map(working.map((i) => [i.id, i]));

  const touch = (item: InventoryItem, patch: Partial<InventoryItem>) => {
    const next = { ...item, ...patch };
    byId.set(item.id, next);
    const idx = working.findIndex((w) => w.id === item.id);
    if (idx >= 0) working[idx] = next;
    changed = true;
    return next;
  };

  // 1) Clear invalid parent pointers
  for (const item of [...working]) {
    if (isContainerRow(item)) continue;
    const current = byId.get(item.id)!;
    const pid = current.parentContainerId;
    if (!pid) continue;
    const parent = byId.get(pid);
    if (!parent || !isContainerRow(parent)) {
      touch(current, { parentContainerId: undefined });
    }
  }

  // 2) Map: which containers currently list each part
  const listedIn = new Map<string, string[]>();
  for (const container of working) {
    const c = byId.get(container.id)!;
    if (!isContainerRow(c)) continue;
    for (const id of c.componentIds || []) {
      if (!id || !byId.has(id)) continue;
      const child = byId.get(id)!;
      if (isContainerRow(child)) continue;
      const list = listedIn.get(id) || [];
      list.push(c.id);
      listedIn.set(id, list);
    }
  }

  // 3) Resolve owner per part (parentContainerId wins; else heal from listings)
  const ownerOf = new Map<string, string>();
  for (const item of working) {
    if (isContainerRow(item)) continue;
    const current = byId.get(item.id)!;
    if (current.parentContainerId && byId.has(current.parentContainerId)) {
      ownerOf.set(current.id, current.parentContainerId);
      continue;
    }
    const listed = [...new Set(listedIn.get(current.id) || [])].filter((pid) => {
      const p = byId.get(pid);
      return Boolean(p && isContainerRow(p));
    });
    if (listed.length === 0) continue;
    const winner = pickOwnerParentId(listed, byId, current);
    ownerOf.set(current.id, winner);
    if (current.parentContainerId !== winner) {
      touch(current, { parentContainerId: winner });
    }
  }

  // 4) Rewrite componentIds from ownership (preserve prior order when possible)
  const childrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of ownerOf) {
    const list = childrenOf.get(parentId) || [];
    list.push(childId);
    childrenOf.set(parentId, list);
  }

  const deleteIds: string[] = [];
  for (const container of [...working]) {
    if (!isContainerRow(container)) continue;
    const current = byId.get(container.id)!;
    const inputSnapshot = items.find((i) => i.id === current.id);
    const prev = current.componentIds || [];
    const owned = childrenOf.get(current.id) || [];
    const ownedSet = new Set(owned);
    const nextIds = [
      ...prev.filter((id) => ownedSet.has(id)),
      ...owned.filter((id) => !prev.includes(id)),
    ];
    const same = prev.length === nextIds.length && prev.every((id, i) => id === nextIds[i]);
    if (!same) {
      touch(current, { componentIds: nextIds });
    }

    const finalContainer = byId.get(container.id)!;
    if (
      isSoldOrTradedOnly(finalContainer) &&
      (finalContainer.componentIds || []).length === 0 &&
      (inputSnapshot?.componentIds || []).length > 0
    ) {
      deleteIds.push(finalContainer.id);
    }
  }

  const uniqueDelete = [...new Set(deleteIds)];
  let nextItems = working.map((w) => byId.get(w.id) || w);
  if (uniqueDelete.length > 0) {
    nextItems = nextItems.filter((i) => !uniqueDelete.includes(i.id));
    changed = true;
  }

  if (!changed) {
    return { nextItems: items, deleteIds: [], changed: false };
  }
  return { nextItems, deleteIds: uniqueDelete, changed: true };
}

/** Parts that already belong to another container (cannot join a new compose). */
export function findPartsOwnedByOtherContainer(
  partIds: string[],
  items: InventoryItem[],
  allowContainerId?: string
): InventoryItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const blocked: InventoryItem[] = [];
  const seen = new Set<string>();

  const push = (part: InventoryItem) => {
    if (seen.has(part.id)) return;
    seen.add(part.id);
    blocked.push(part);
  };

  for (const id of partIds) {
    const part = byId.get(id);
    if (!part || isContainerRow(part)) continue;

    if (part.parentContainerId && part.parentContainerId !== allowContainerId) {
      push(part);
      continue;
    }

    const otherOwner = items.find(
      (c) =>
        isContainerRow(c) &&
        c.id !== allowContainerId &&
        (c.componentIds || []).includes(part.id)
    );
    if (!otherOwner) continue;

    // Listed on another container: block unless this part explicitly belongs to allowContainerId.
    if (!part.parentContainerId || part.parentContainerId === otherOwner.id) {
      push(part);
    }
  }

  return blocked;
}

/** Keep only parts free to join `allowContainerId` (or any new container if omitted). */
export function filterPartsAvailableForCompose(
  parts: InventoryItem[],
  items: InventoryItem[],
  allowContainerId?: string
): { available: InventoryItem[]; blocked: InventoryItem[] } {
  const blocked = findPartsOwnedByOtherContainer(
    parts.map((p) => p.id),
    items,
    allowContainerId
  );
  const blockedIds = new Set(blocked.map((b) => b.id));
  return {
    available: parts.filter((p) => !blockedIds.has(p.id) && !isContainerRow(p)),
    blocked,
  };
}
