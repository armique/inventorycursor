/**
 * Local daily Firestore op counters (Pacific day). Used when Cloud Monitoring isn't configured.
 */

import { FIRESTORE_FREE, pacificDayKey } from '../utils/firestoreFreeQuota';

const OPS_KEY = 'deinv_firestore_ops_v1';

export type DayOps = { day: string; reads: number; writes: number; deletes: number };

/**
 * Per-device budgets deliberately stay below half of Spark's daily allowance.
 * The owner commonly uses a PC and a phone, while some small writes are not
 * represented in this local counter. The remaining headroom keeps both devices
 * below the project-wide free tier in normal use.
 */
export const FIRESTORE_CLIENT_DAILY_BUDGET = {
  reads: Math.floor(FIRESTORE_FREE.readsPerDay * 0.4),
  writes: Math.floor(FIRESTORE_FREE.writesPerDay * 0.4),
  deletes: Math.floor(FIRESTORE_FREE.deletesPerDay * 0.4),
} as const;

export function assertFirestoreDailyBudget(estimate: {
  reads?: number;
  writes?: number;
  deletes?: number;
}): void {
  const current = readOps();
  const requested = {
    reads: Math.max(0, Math.floor(estimate.reads || 0)),
    writes: Math.max(0, Math.floor(estimate.writes || 0)),
    deletes: Math.max(0, Math.floor(estimate.deletes || 0)),
  };
  const exceeded = (['reads', 'writes', 'deletes'] as const).find(
    (kind) => current[kind] + requested[kind] > FIRESTORE_CLIENT_DAILY_BUDGET[kind]
  );
  if (!exceeded) return;

  const error = new Error(
    `Firebase free-tier safety limit reached for ${exceeded} on this device. ` +
      'Cloud changes are paused until the daily quota resets around midnight Pacific time.'
  ) as Error & { code?: string };
  error.code = 'firestore/client-free-tier-budget';
  throw error;
}

function readOps(): DayOps {
  const day = pacificDayKey();
  try {
    const raw = localStorage.getItem(OPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayOps;
      if (parsed?.day === day) {
        return {
          day,
          reads: Number(parsed.reads) || 0,
          writes: Number(parsed.writes) || 0,
          deletes: Number(parsed.deletes) || 0,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { day, reads: 0, writes: 0, deletes: 0 };
}

function writeOps(ops: DayOps): void {
  try {
    localStorage.setItem(OPS_KEY, JSON.stringify(ops));
  } catch {
    /* ignore */
  }
}

export function recordFirestoreReads(n: number): void {
  if (!n || typeof localStorage === 'undefined') return;
  const ops = readOps();
  ops.reads += Math.max(0, Math.floor(n));
  writeOps(ops);
}

export function recordFirestoreWrites(n: number): void {
  if (!n || typeof localStorage === 'undefined') return;
  const ops = readOps();
  ops.writes += Math.max(0, Math.floor(n));
  writeOps(ops);
}

export function recordFirestoreDeletes(n: number): void {
  if (!n || typeof localStorage === 'undefined') return;
  const ops = readOps();
  ops.deletes += Math.max(0, Math.floor(n));
  writeOps(ops);
}

export function getLocalFirestoreOpsToday(): DayOps {
  if (typeof localStorage === 'undefined') {
    return { day: pacificDayKey(), reads: 0, writes: 0, deletes: 0 };
  }
  return readOps();
}
