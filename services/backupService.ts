/**
 * Automated daily snapshot backups.
 *
 * Why Storage and not Supabase: a full daily copy of the inventory would consume Supabase
 * document writes and stored bytes against its 1 GiB / 20k-writes-per-day free tier. Supabase
 * Storage has a separate 5 GB allowance that nothing else here comes close to using, and a
 * gzipped snapshot is a few hundred KB — so a year of history costs a rounding error.
 *
 * Snapshots are built from the in-memory app state that is already being synced, so a backup
 * costs ZERO extra Supabase reads.
 */

import {
  deleteBackupSnapshot,
  listBackupSnapshotNames,
  uploadBackupSnapshot,
} from './supabaseService';
import { todayLocalDateKey } from '../utils/calendarDate';

const LAST_RUN_KEY = 'dein_last_backup_day_v1';
const FILE_PREFIX = 'snapshot-';

/** Recent days kept in full, plus one per month beyond that (see pickSnapshotsToDelete). */
export const KEEP_RECENT_DAILY = 14;
export const KEEP_MONTHLY_MONTHS = 12;

export type BackupPayload = {
  inventory: unknown[];
  trash: unknown[];
  expenses: unknown[];
  recurringExpenses?: unknown[];
  categories?: Record<string, string[]>;
  categoryFields?: Record<string, string[]>;
  settings?: unknown;
  goals?: { monthly?: number };
  dashboard?: unknown;
  actionHistory?: unknown[];
  bulkImports?: unknown[];
};

export type BackupRunResult =
  | { ran: false; reason: 'already-today' | 'signed-out' | 'empty' }
  | { ran: true; fileName: string; bytes: number; deleted: string[] };

function fileNameForDay(day: string, compressed: boolean): string {
  return `${FILE_PREFIX}${day}.json${compressed ? '.gz' : ''}`;
}

/** `snapshot-2026-07-28.json.gz` -> `2026-07-28`; null when the name isn't ours. */
export function dayFromFileName(name: string): string | null {
  const m = /^snapshot-(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/.exec(name);
  return m ? m[1] : null;
}

/**
 * Retention: every snapshot from the last KEEP_RECENT_DAILY days is kept, then the OLDEST
 * snapshot of each month for KEEP_MONTHLY_MONTHS months (the oldest survives a month's worth
 * of bad edits rather than being the most recently corrupted one). Everything else is dropped.
 * Pure function so the policy is testable without touching Storage.
 */
export function pickSnapshotsToDelete(fileNames: string[], today: string): string[] {
  const dated = fileNames
    .map((name) => ({ name, day: dayFromFileName(name) }))
    .filter((x): x is { name: string; day: string } => x.day != null)
    .sort((a, b) => a.day.localeCompare(b.day));

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const recentCutoffMs = todayMs - KEEP_RECENT_DAILY * 86400000;
  const monthlyCutoffMs = todayMs - KEEP_MONTHLY_MONTHS * 31 * 86400000;

  const keep = new Set<string>();
  const oldestPerMonth = new Map<string, string>();

  for (const { name, day } of dated) {
    const dayMs = new Date(`${day}T00:00:00Z`).getTime();
    if (dayMs >= recentCutoffMs) {
      keep.add(name);
      continue;
    }
    if (dayMs < monthlyCutoffMs) continue; // beyond the monthly window entirely
    const month = day.slice(0, 7);
    if (!oldestPerMonth.has(month)) oldestPerMonth.set(month, name); // sorted asc -> first seen is oldest
  }
  for (const name of oldestPerMonth.values()) keep.add(name);

  return dated.filter((x) => !keep.has(x.name)).map((x) => x.name);
}

/** gzip via CompressionStream when the browser supports it; plain JSON otherwise. */
async function toBlob(json: string): Promise<{ blob: Blob; compressed: boolean }> {
  const CompressionStreamCtor = (globalThis as { CompressionStream?: typeof CompressionStream })
    .CompressionStream;
  if (!CompressionStreamCtor) {
    return { blob: new Blob([json], { type: 'application/json' }), compressed: false };
  }
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStreamCtor('gzip'));
    const blob = await new Response(stream).blob();
    return { blob: new Blob([blob], { type: 'application/gzip' }), compressed: true };
  } catch {
    return { blob: new Blob([json], { type: 'application/json' }), compressed: false };
  }
}

function alreadyRanToday(day: string): boolean {
  try {
    return localStorage.getItem(LAST_RUN_KEY) === day;
  } catch {
    return false;
  }
}

function markRanToday(day: string): void {
  try {
    localStorage.setItem(LAST_RUN_KEY, day);
  } catch {
    /* best-effort — a re-upload tomorrow is harmless */
  }
}

/** Local calendar day of the most recent successful run, or null. */
export function lastBackupDay(): string | null {
  try {
    return localStorage.getItem(LAST_RUN_KEY);
  } catch {
    return null;
  }
}

/**
 * Upload today's snapshot if one hasn't been made yet, then prune per the retention policy.
 * Safe to call on every boot — the localStorage day marker makes repeat calls no-ops.
 */
export async function runDailyBackupIfDue(
  payload: BackupPayload,
  options?: { force?: boolean },
): Promise<BackupRunResult> {
  const day = todayLocalDateKey();
  if (!options?.force && alreadyRanToday(day)) return { ran: false, reason: 'already-today' };

  // Never overwrite a good snapshot with an empty one (e.g. called before cloud data loaded).
  if (!payload.inventory?.length && !payload.expenses?.length) {
    return { ran: false, reason: 'empty' };
  }

  const json = JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    counts: {
      inventory: payload.inventory?.length ?? 0,
      trash: payload.trash?.length ?? 0,
      expenses: payload.expenses?.length ?? 0,
    },
    payload,
  });

  const { blob, compressed } = await toBlob(json);
  const fileName = fileNameForDay(day, compressed);
  await uploadBackupSnapshot(fileName, blob);
  markRanToday(day);

  const deleted: string[] = [];
  try {
    const names = await listBackupSnapshotNames();
    for (const stale of pickSnapshotsToDelete(names, day)) {
      await deleteBackupSnapshot(stale);
      deleted.push(stale);
    }
  } catch (err) {
    // Pruning is housekeeping — a failure here must not make the backup itself look failed.
    console.warn('Backup prune failed:', err);
  }

  return { ran: true, fileName, bytes: blob.size, deleted };
}
