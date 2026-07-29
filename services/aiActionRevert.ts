/**
 * Reverting one AI action.
 *
 * Revert is field-level, not row-level: each entry in the action's diff is written back
 * to `oldValue` only when the record still holds the `newValue` the AI wrote. If the
 * user edited that field by hand afterwards, the field is reported as a conflict and
 * left alone unless the caller explicitly forces it — never silently overwritten.
 */

import type { AiAction, InventoryItem } from '../types';
import { formatDiffValue, formatFieldLabel, readItemField, writeItemField } from '../utils/aiDiff';

export interface RevertFieldConflict {
  field: string;
  label: string;
  /** What the AI wrote (and what revert expected to still find). */
  expected: unknown;
  /** What the record holds now, after a later manual edit. */
  current: unknown;
  /** What revert would restore. */
  restoreTo: unknown;
}

export interface RevertPlan {
  action: AiAction;
  /** Fields that can be restored cleanly. */
  cleanFields: string[];
  /** Fields a later manual edit changed — need the user's decision. */
  conflicts: RevertFieldConflict[];
  /** The item as it would look after applying the clean fields only. */
  preview: InventoryItem | null;
  /** Set when the action cannot be reverted at all. */
  blockedReason?: string;
}

/**
 * Work out what reverting an action would do, without applying anything.
 * `item` is undefined when the record no longer exists (deleted or never created).
 */
export function planRevert(action: AiAction, item: InventoryItem | undefined): RevertPlan {
  const base: RevertPlan = { action, cleanFields: [], conflicts: [], preview: null };

  if (!action.reversible) {
    return { ...base, blockedReason: 'This action was recorded as not reversible.' };
  }
  if (action.reviewStatus === 'reverted') {
    return { ...base, blockedReason: 'Already reverted.' };
  }
  if (action.actionType === 'item_deleted') {
    return {
      ...base,
      blockedReason: 'The item was moved to Trash — restore it from the Trash page.',
    };
  }
  if (!item) {
    return {
      ...base,
      blockedReason: 'The item no longer exists — nothing to revert on.',
    };
  }
  if (action.actionType === 'item_created') {
    // Undoing a creation means deleting the row; handled by the caller (goes to Trash).
    return { ...base, preview: item };
  }
  if (!action.diff.length) {
    return { ...base, blockedReason: 'This action recorded no field changes.' };
  }

  let preview = item;
  for (const entry of action.diff) {
    const current = readItemField(item, entry.field);
    const aiWrote = entry.newValue;
    const bothEmpty = (current === null || current === '') && (aiWrote === null || aiWrote === '');
    if (current === aiWrote || bothEmpty) {
      base.cleanFields.push(entry.field);
      preview = writeItemField(preview, entry.field, entry.oldValue);
    } else {
      base.conflicts.push({
        field: entry.field,
        label: formatFieldLabel(entry.field),
        expected: aiWrote,
        current,
        restoreTo: entry.oldValue,
      });
    }
  }

  return { ...base, preview };
}

export interface ApplyRevertOptions {
  /** Field paths from `plan.conflicts` the user chose to overwrite anyway. */
  forceFields?: string[];
}

export interface RevertResult {
  /** The item to save, or null when nothing changed. */
  item: InventoryItem | null;
  restoredFields: string[];
  skippedFields: string[];
  /** Short summary suitable for the action-history note. */
  note: string;
}

/** Apply a plan, optionally forcing specific conflicted fields. */
export function applyRevert(
  plan: RevertPlan,
  item: InventoryItem,
  options?: ApplyRevertOptions
): RevertResult {
  const force = new Set(options?.forceFields || []);
  const byField = new Map(plan.action.diff.map((d) => [d.field, d]));

  let next = item;
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const field of plan.cleanFields) {
    const entry = byField.get(field);
    if (!entry) continue;
    next = writeItemField(next, field, entry.oldValue);
    restored.push(field);
  }
  for (const conflict of plan.conflicts) {
    const entry = byField.get(conflict.field);
    if (!entry) continue;
    if (force.has(conflict.field)) {
      next = writeItemField(next, conflict.field, entry.oldValue);
      restored.push(conflict.field);
    } else {
      skipped.push(conflict.field);
    }
  }

  const noteParts: string[] = [];
  if (restored.length) noteParts.push(`restored ${restored.map(formatFieldLabel).join(', ')}`);
  if (skipped.length) noteParts.push(`kept manual ${skipped.map(formatFieldLabel).join(', ')}`);

  return {
    item: restored.length ? { ...next, lastModifiedBy: 'manual', aiReviewStatus: 'reverted' } : null,
    restoredFields: restored,
    skippedFields: skipped,
    note: noteParts.join(' · ') || 'no fields changed',
  };
}

/** One-line description of a conflict, for the confirmation dialog. */
export function describeConflict(conflict: RevertFieldConflict): string {
  return `${conflict.label}: AI set “${formatDiffValue(conflict.expected)}”, now “${formatDiffValue(
    conflict.current
  )}” — revert would write “${formatDiffValue(conflict.restoreTo)}”`;
}
