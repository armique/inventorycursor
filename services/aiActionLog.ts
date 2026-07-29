/**
 * Audit trail of everything the AI assistant changed.
 *
 * Stored locally (`ai_actions_v1`) with a Firestore mirror at users/{uid}/aiActions, the
 * same shape as the eBay purchase archive. Kept separate from ActionHistoryEntry because
 * that log is capped tightly and holds no before/after values — revert needs both.
 *
 * The cloud copy is pulled lazily (only when the "Done by AI" page asks for it) so the
 * log never adds reads to normal panel usage.
 */

import type { AiAction, AiActionDiffEntry, AiActionTargetKind, AiActionType, AiReviewStatus } from '../types';
import {
  deleteAiActionsFromCloud,
  fetchAiActionsFromCloud,
  isCloudEnabled,
  writeAiActionsToCloud,
} from './firebaseService';
import { getAiSession, noteAiSessionActivity } from './aiSession';

const STORAGE_KEY = 'ai_actions_v1';

/** Fired on every local change so nav counters / open pages refresh. */
export const AI_ACTIONS_EVENT = 'ai-actions-updated';

/**
 * Hard cap on retained actions. Far above ACTION_HISTORY_LIMIT because these rows carry
 * the data revert depends on; unreviewed rows are never trimmed.
 */
export const AI_ACTIONS_LIMIT = 2000;

let memActions: AiAction[] | null = null;

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AI_ACTIONS_EVENT));
}

function normalizeDiff(raw: unknown): AiActionDiffEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is AiActionDiffEntry => Boolean(d) && typeof (d as AiActionDiffEntry).field === 'string')
    .map((d) => ({ field: d.field, oldValue: d.oldValue ?? null, newValue: d.newValue ?? null }));
}

function normalizeAction(raw: unknown): AiAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<AiAction>;
  if (!a.id || !a.timestamp || !a.itemId) return null;
  const reviewStatus: AiReviewStatus =
    a.reviewStatus === 'approved' || a.reviewStatus === 'reverted' ? a.reviewStatus : 'unreviewed';
  return {
    id: String(a.id),
    timestamp: String(a.timestamp),
    actor: 'ai',
    actionType: (a.actionType as AiActionType) || 'field_changed',
    targetKind: (a.targetKind as AiActionTargetKind) || 'item',
    itemId: String(a.itemId),
    itemName: a.itemName ? String(a.itemName) : undefined,
    diff: normalizeDiff(a.diff),
    reviewStatus,
    reversible: a.reversible !== false,
    sourceContext: a.sourceContext ? String(a.sourceContext) : undefined,
    sessionId: a.sessionId ? String(a.sessionId) : undefined,
    reviewedAt: a.reviewedAt ? String(a.reviewedAt) : undefined,
    reviewNote: a.reviewNote ? String(a.reviewNote) : undefined,
  };
}

export function loadAiActions(): AiAction[] {
  if (memActions) return memActions;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    memActions = Array.isArray(parsed)
      ? parsed.map(normalizeAction).filter((a): a is AiAction => Boolean(a))
      : [];
  } catch {
    memActions = [];
  }
  return memActions;
}

/** Trim oldest reviewed rows once over the cap; unreviewed rows always survive. */
function trim(actions: AiAction[]): { kept: AiAction[]; dropped: AiAction[] } {
  if (actions.length <= AI_ACTIONS_LIMIT) return { kept: actions, dropped: [] };
  const sorted = [...actions].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const kept: AiAction[] = [];
  const dropped: AiAction[] = [];
  for (const a of sorted) {
    if (kept.length < AI_ACTIONS_LIMIT || a.reviewStatus === 'unreviewed') kept.push(a);
    else dropped.push(a);
  }
  return { kept, dropped };
}

function save(actions: AiAction[]): AiAction[] {
  const { kept, dropped } = trim(actions);
  memActions = kept;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    }
  } catch {
    /* ignore quota errors — cloud mirror still holds the log */
  }
  emitChange();
  if (dropped.length) {
    void deleteAiActionsFromCloud(dropped.map((d) => d.id)).catch(() => undefined);
  }
  return kept;
}

export type NewAiAction = {
  actionType: AiActionType;
  targetKind?: AiActionTargetKind;
  itemId: string;
  itemName?: string;
  diff: AiActionDiffEntry[];
  reversible?: boolean;
  /** Overrides the current session context when the caller knows better. */
  sourceContext?: string;
  /** Overrides the timestamp (used when replaying a batch). */
  timestamp?: string;
};

/** Append AI actions to the log and mirror them to the cloud. Returns the created rows. */
export function recordAiActions(entries: NewAiAction[]): AiAction[] {
  if (!entries.length) return [];
  const session = getAiSession();
  const created: AiAction[] = entries.map((e, i) => ({
    id: `ai-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: e.timestamp || new Date().toISOString(),
    actor: 'ai',
    actionType: e.actionType,
    targetKind: e.targetKind || 'item',
    itemId: e.itemId,
    itemName: e.itemName,
    diff: e.diff,
    reviewStatus: 'unreviewed',
    reversible: e.reversible !== false,
    sourceContext: e.sourceContext || session?.context || undefined,
    sessionId: session?.sessionId,
  }));
  save([...loadAiActions(), ...created]);
  noteAiSessionActivity(created.length);
  void pushAiActionsToCloud(created).catch(() => undefined);
  return created;
}

/** Mark one or more actions approved / reverted / unreviewed again. */
export function setAiActionReviewStatus(
  ids: string[],
  reviewStatus: AiReviewStatus,
  reviewNote?: string
): AiAction[] {
  const idSet = new Set(ids);
  if (idSet.size === 0) return [];
  const touched: AiAction[] = [];
  const next = loadAiActions().map((a) => {
    if (!idSet.has(a.id)) return a;
    const updated: AiAction = {
      ...a,
      reviewStatus,
      reviewedAt: new Date().toISOString(),
      reviewNote: reviewNote ?? a.reviewNote,
    };
    touched.push(updated);
    return updated;
  });
  save(next);
  if (touched.length) void pushAiActionsToCloud(touched).catch(() => undefined);
  return touched;
}

export interface ItemAiState {
  /** The AI touched this record at some point. */
  touchedByAi: boolean;
  unreviewedCount: number;
  latest?: AiAction;
}

/** AI state per item id — used by badges and the left stripe in list views. */
export function buildItemAiStateMap(actions?: AiAction[]): Map<string, ItemAiState> {
  const list = actions || loadAiActions();
  const map = new Map<string, ItemAiState>();
  for (const a of list) {
    const prev = map.get(a.itemId);
    const unreviewedCount = (prev?.unreviewedCount || 0) + (a.reviewStatus === 'unreviewed' ? 1 : 0);
    const latest = !prev?.latest || prev.latest.timestamp < a.timestamp ? a : prev.latest;
    map.set(a.itemId, { touchedByAi: true, unreviewedCount, latest });
  }
  return map;
}

export function getUnreviewedAiActionCount(actions?: AiAction[]): number {
  return (actions || loadAiActions()).filter((a) => a.reviewStatus === 'unreviewed').length;
}

/** Newest-first actions for one record. */
export function getAiActionsForItem(itemId: string, actions?: AiAction[]): AiAction[] {
  return (actions || loadAiActions())
    .filter((a) => a.itemId === itemId)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export async function pushAiActionsToCloud(actions: AiAction[]): Promise<void> {
  if (!isCloudEnabled() || !actions.length) return;
  try {
    await writeAiActionsToCloud(actions as unknown as (Record<string, unknown> & { id: string })[]);
  } catch (e) {
    console.warn('Failed to push AI actions to cloud:', e);
  }
}

export interface AiActionsPullResult {
  pulled: number;
  skipped: boolean;
  error?: string;
}

/** Merge the Firestore archive into the local log (local wins on review status conflicts). */
export async function pullAiActionsFromCloud(): Promise<AiActionsPullResult> {
  if (!isCloudEnabled()) return { pulled: 0, skipped: true };
  try {
    const remote = await fetchAiActionsFromCloud();
    if (!remote) return { pulled: 0, skipped: true };
    const rows = remote.map(normalizeAction).filter((a): a is AiAction => Boolean(a));
    const byId = new Map(loadAiActions().map((a) => [a.id, a]));
    let pulled = 0;
    for (const r of rows) {
      const local = byId.get(r.id);
      if (!local) {
        byId.set(r.id, r);
        pulled++;
        continue;
      }
      // Whichever side was reviewed more recently wins.
      const localReviewedAt = local.reviewedAt || '';
      const remoteReviewedAt = r.reviewedAt || '';
      byId.set(r.id, remoteReviewedAt > localReviewedAt ? { ...local, ...r } : local);
    }
    save(Array.from(byId.values()));
    return { pulled, skipped: false };
  } catch (e) {
    return { pulled: 0, skipped: false, error: (e as Error)?.message || 'Cloud pull failed.' };
  }
}

/** Wipe the log locally and in the cloud. */
export async function clearAiActionsEverywhere(): Promise<void> {
  const existing = loadAiActions();
  memActions = [];
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emitChange();
  if (!isCloudEnabled() || !existing.length) return;
  try {
    await deleteAiActionsFromCloud(existing.map((a) => a.id));
  } catch (e) {
    console.warn('Failed to clear cloud AI action log:', e);
  }
}
