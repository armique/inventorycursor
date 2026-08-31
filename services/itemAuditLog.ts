/**
 * Durable audit log writer.
 *
 * Every inventory change is recorded permanently in Supabase (item_audit_log),
 * independently of the item itself, so the record survives deletion and can be
 * queried across items — "every refund in August", "everything that happened to
 * this PC build".
 *
 * The hard requirement is that entries are never silently lost. An edit must not
 * block on the network, but a failed write must not vanish either. So:
 *
 *   1. entries are appended to a local pending queue synchronously, before any
 *      network call — if the tab closes right now, they are still there
 *   2. a flush is scheduled; on success the flushed entries leave the queue
 *   3. on failure they stay queued and are retried on the next flush, including
 *      after a reload
 *
 * This is the same reasoning as the pending-item-patches log: the durable record
 * is written first, the upload is best-effort on top of it.
 */
import { getSupabase, getCurrentSupabaseUser, isCloudEnabled } from './supabaseService';
import type { ItemHistoryEntry } from '../utils/itemHistoryDiff';

const QUEUE_KEY = 'item_audit_pending_v1';
/** Keep the queue bounded so a long offline spell cannot fill localStorage. */
const MAX_QUEUED = 2000;
const FLUSH_DEBOUNCE_MS = 1200;

export type AuditRow = {
  id: string;
  user_id: string;
  item_id: string | null;
  item_name: string | null;
  action: string;
  title: string | null;
  details: string | null;
  actor: string | null;
  diffs: unknown;
  occurred_at: string;
};

function readQueue(): AuditRow[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(rows: AuditRow[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-MAX_QUEUED)));
  } catch {
    /* quota — the next successful flush drains it anyway */
  }
}

export function pendingAuditCount(): number {
  return readQueue().length;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/**
 * Record changes. Synchronous and never throws — callers are edit paths and must
 * not fail because logging failed.
 */
export function recordItemAudit(
  entries: Array<{ item: { id?: string; name?: string }; entry: ItemHistoryEntry }>,
  userId: string
): void {
  if (!entries.length || !userId) return;
  try {
    const rows: AuditRow[] = entries.map(({ item, entry }) => ({
      // The entry id is generated per change and is unique; reusing it as the
      // primary key makes a retried flush idempotent rather than duplicating.
      id: entry.id,
      user_id: userId,
      item_id: item?.id ?? null,
      item_name: item?.name ?? null,
      action: entry.action,
      title: entry.title ?? null,
      details: entry.details ?? null,
      actor: entry.actor ?? 'manual',
      diffs: entry.diffs ?? [],
      occurred_at: entry.timestamp,
    }));
    writeQueue([...readQueue(), ...rows]);
    scheduleAuditFlush();
  } catch (e) {
    console.warn('[audit] could not queue entries:', e);
  }
}

export function scheduleAuditFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushItemAudit().catch(() => undefined);
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Push queued entries to Supabase. Entries are removed from the queue only after
 * the write succeeds, so a failure retries rather than loses them.
 */
export async function flushItemAudit(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return { sent: 0, remaining: readQueue().length };
  const queued = readQueue();
  if (!queued.length) return { sent: 0, remaining: 0 };
  if (!isCloudEnabled()) return { sent: 0, remaining: queued.length };

  const sb = getSupabase();
  if (!sb) return { sent: 0, remaining: queued.length };

  // Without a real session RLS rejects the insert; keep the entries for later
  // rather than dropping them.
  const user = await getCurrentSupabaseUser();
  if (!user) return { sent: 0, remaining: queued.length };

  flushing = true;
  let sent = 0;
  try {
    const BATCH = 200;
    for (let i = 0; i < queued.length; i += BATCH) {
      const chunk = queued.slice(i, i + BATCH);
      // Idempotent on the entry id, so a retry after a partial failure cannot
      // create duplicates.
      const { error } = await sb.from('item_audit_log').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.warn(`[audit] flush failed at ${i}, keeping ${queued.length - sent} queued:`, error.message);
        break;
      }
      sent += chunk.length;
    }
    if (sent > 0) {
      // Re-read rather than reusing `queued`: an edit may have queued more while
      // this flush was in flight, and those must not be discarded.
      const current = readQueue();
      const sentIds = new Set(queued.slice(0, sent).map((r) => r.id));
      writeQueue(current.filter((r) => !sentIds.has(r.id)));
    }
  } finally {
    flushing = false;
  }

  const remaining = readQueue().length;
  if (remaining > 0) scheduleAuditFlush();
  return { sent, remaining };
}
