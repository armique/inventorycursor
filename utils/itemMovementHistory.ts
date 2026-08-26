/**
 * Item movement history — standalone ↔ bundle/PC membership changes, with dates. An audit
 * trail so a bundle losing a child link (as happened before) is diagnosable/reversible
 * after the fact: you can see exactly when and which bundle an item was added to or pulled
 * from. Recorded centrally in App.tsx's handleUpdate whenever parentContainerId changes —
 * no individual UI action (QuickBundleAdd, SplitParts, drag-in, etc.) needs to know about
 * this file.
 */
import type { InventoryItem, MovementEvent, MovementEventType } from '../types';

function makeMovementEventId(): string {
  return `mv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendMovementEvent(
  item: InventoryItem,
  type: MovementEventType,
  bundle?: { id?: string; name?: string }
): InventoryItem {
  const event: MovementEvent = {
    id: makeMovementEventId(),
    date: new Date().toISOString(),
    type,
    bundleId: bundle?.id,
    bundleName: bundle?.name,
  };
  return { ...item, movementHistory: [...(item.movementHistory || []), event] };
}

/**
 * Compares an item's parentContainerId before/after an update and appends the right
 * movement event if membership actually changed. `resolveBundleName` looks up a
 * container's current name (or last-known name if it's since been removed) — pass a
 * function backed by the in-progress items array so a same-batch bundle creation resolves
 * correctly.
 */
export function recordMembershipChangeIfAny(
  before: InventoryItem | undefined,
  after: InventoryItem,
  resolveBundleName: (id: string) => string | undefined
): InventoryItem {
  const prevParent = (before?.parentContainerId || '').trim();
  const nextParent = (after.parentContainerId || '').trim();
  if (prevParent === nextParent) return after;

  if (nextParent) {
    return appendMovementEvent(after, 'added_to_bundle', {
      id: nextParent,
      name: resolveBundleName(nextParent),
    });
  }
  return appendMovementEvent(after, 'removed_from_bundle', {
    id: prevParent,
    name: resolveBundleName(prevParent),
  });
}

export const MOVEMENT_EVENT_LABEL: Record<MovementEventType, string> = {
  added_to_bundle: 'Added to bundle/PC',
  removed_from_bundle: 'Removed from bundle/PC',
};
