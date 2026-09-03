/**
 * Operation-grouped action history helpers (Part B).
 *
 * ArmikTech verbs stay as free-string `action` / ItemHistoryActionType.
 * This module adds: immutable diffs, operation grouping, and undo guards.
 */
import type { ActionHistoryEntry, InventoryItem, ItemStatus } from '../types';
import { ItemStatus as Status } from '../types';

export type HistoryActionType =
  | 'created'
  | 'item_deleted'
  | 'buy_price_changed'
  | 'sell_price_changed'
  | 'status_changed'
  | 'bundle_created'
  | 'bundle_split'
  | 'added_to_bundle'
  | 'removed_from_bundle'
  | 'ebay_linked'
  | 'ebay_unlinked'
  | 'customer_set'
  | 'condition_changed'
  | 'photos_updated'
  | 'general_edit'
  | 'rollback';

type OpContext = {
  operationId: string;
  operationLabel: string;
};

let activeOp: OpContext | null = null;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Group every history entry created inside `fn` under one operation_id. Nested calls join the outer op. */
export function runOperation<T>(label: string, fn: () => T): T {
  if (activeOp) return fn();
  activeOp = { operationId: newId('op'), operationLabel: label };
  try {
    return fn();
  } finally {
    activeOp = null;
  }
}

export function getActiveOperation(): OpContext | null {
  return activeOp;
}

/** Changed fields only. Always skips updated_at. Creation/deletion callers pass full snapshots. */
export function diffStates(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts?: { fullSnapshot?: boolean }
): { previous_state: Record<string, unknown>; new_state: Record<string, unknown> } {
  if (opts?.fullSnapshot) {
    return {
      previous_state: before ? stripUpdatedAt({ ...before }) : {},
      new_state: after ? stripUpdatedAt({ ...after }) : {},
    };
  }
  const previous_state: Record<string, unknown> = {};
  const new_state: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (key === 'updated_at' || key === 'updatedAt') continue;
    const a = before?.[key];
    const b = after?.[key];
    if (stableJson(a) === stableJson(b)) continue;
    previous_state[key] = a === undefined ? null : a;
    new_state[key] = b === undefined ? null : b;
  }
  return { previous_state, new_state };
}

function stripUpdatedAt(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  delete out.updated_at;
  delete out.updatedAt;
  return out;
}

function stableJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? 'undefined';
  } catch {
    return String(v);
  }
}

export function stampOperationFields<T extends ActionHistoryEntry>(entry: T): T {
  const op = activeOp;
  if (!op) return entry;
  return {
    ...entry,
    operationId: entry.operationId || op.operationId,
    operationLabel: entry.operationLabel || op.operationLabel,
  };
}

export function makeHistoryEntry(input: {
  action: string;
  actionType?: HistoryActionType;
  itemId?: string;
  itemName?: string;
  details?: string;
  notes?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  relatedItemIds?: string[];
  tradeReceivedIds?: string[];
  timestamp?: string;
}): ActionHistoryEntry {
  const stamped = stampOperationFields({
    id: newId('act'),
    timestamp: input.timestamp || new Date().toISOString(),
    action: input.action,
    actionType: input.actionType,
    itemId: input.itemId,
    itemName: input.itemName,
    details: input.details,
    notes: input.notes ?? input.details,
    previousState: input.previousState || {},
    newState: input.newState || {},
    relatedItemIds: input.relatedItemIds || [],
    tradeReceivedIds: input.tradeReceivedIds,
  });
  return stamped;
}

/** Merge by id — immutable entries need no field conflict resolution. */
export function mergeActionHistoryById(
  remote: ActionHistoryEntry[],
  local: ActionHistoryEntry[]
): ActionHistoryEntry[] {
  const byId = new Map<string, ActionHistoryEntry>();
  for (const e of remote) if (e?.id) byId.set(e.id, e);
  for (const e of local) if (e?.id) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp))
  );
}

export type UndoCheck = { ok: true } | { ok: false; reason: string };

/**
 * Refuse unsafe undos before the click. Evaluated when rendering the button.
 * Checks the whole operation group when operationId is set.
 */
export function canUndo(
  entry: ActionHistoryEntry,
  allEntries: ActionHistoryEntry[],
  items: InventoryItem[]
): UndoCheck {
  const group = entry.operationId
    ? allEntries.filter((e) => e.operationId === entry.operationId)
    : [entry];
  // Newest first — same order undo must apply.
  const ordered = [...group].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  for (const e of ordered) {
    const check = canUndoSingle(e, items);
    if (!check.ok) return check;
  }
  return { ok: true };
}

function canUndoSingle(entry: ActionHistoryEntry, items: InventoryItem[]): UndoCheck {
  const id = entry.itemId;
  if (!id) return { ok: true };
  const item = items.find((i) => i.id === id);
  const action = `${entry.action} ${entry.actionType || ''}`.toLowerCase();

  if (action.includes('deleted') || entry.actionType === 'item_deleted') {
    return { ok: true };
  }

  if (!item) {
    return {
      ok: false,
      reason: 'This item is gone. Restore it from a backup first, or undo the deletion entry if one exists.',
    };
  }

  if (item.status === Status.SOLD || item.status === Status.TRADED || item.status === Status.GIFTED) {
    if (
      entry.actionType === 'bundle_split' ||
      entry.actionType === 'added_to_bundle' ||
      entry.actionType === 'removed_from_bundle' ||
      entry.actionType === 'bundle_created' ||
      action.includes('split') ||
      action.includes('bundle') ||
      action.includes('buy price')
    ) {
      return {
        ok: false,
        reason: `"${item.name}" has already been sold. Undo the sale first.`,
      };
    }
  }

  if (entry.actionType === 'bundle_split' || action.includes('split')) {
    const related = entry.relatedItemIds || [];
    for (const rid of related) {
      const child = items.find((i) => i.id === rid);
      if (!child) continue;
      if (child.status === Status.SOLD || child.status === Status.TRADED) {
        return {
          ok: false,
          reason: `"${child.name}" has already been sold. Undo the sale first.`,
        };
      }
    }
  }

  return { ok: true };
}

/** Entries for one operation, newest first (required undo order). */
export function entriesForOperationNewestFirst(
  operationId: string,
  allEntries: ActionHistoryEntry[]
): ActionHistoryEntry[] {
  return allEntries
    .filter((e) => e.operationId === operationId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

export function pickMoneyFields(item: InventoryItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    buyPrice: item.buyPrice,
    sellPrice: item.sellPrice,
    status: item.status,
    parentContainerId: item.parentContainerId ?? null,
    componentIds: item.componentIds || [],
    isBundle: Boolean(item.isBundle),
    isPC: Boolean(item.isPC),
    isDefective: Boolean(item.isDefective),
  };
}
