/**
 * Local daily Firestore op counters (Pacific day). Used when Cloud Monitoring isn't configured.
 */

import { pacificDayKey } from '../utils/firestoreFreeQuota';

const OPS_KEY = 'deinv_firestore_ops_v1';

export type DayOps = { day: string; reads: number; writes: number; deletes: number };

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
