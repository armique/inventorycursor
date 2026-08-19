/**
 * Durable log of Hub fee-split approvals (local). The replace queue drops a row
 * once it matches Hub — this is how you still see what was approved.
 */

export type HubBreakdownApplyRecord = {
  at: string;
  itemId: string;
  itemName: string;
  orderId: string;
  sellDate?: string;
  total: number | null;
  net: number | null;
};

const STORAGE_KEY = 'ebay_hub_breakdown_applied_v1';
const LIMIT = 80;

function readLog(): HubBreakdownApplyRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HubBreakdownApplyRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(rows: HubBreakdownApplyRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, LIMIT)));
  } catch (e) {
    console.warn('Failed to persist Hub apply log:', e);
  }
}

export function loadHubBreakdownApplyLog(): HubBreakdownApplyRecord[] {
  return readLog();
}

export function appendHubBreakdownApplyLog(incoming: HubBreakdownApplyRecord[]): HubBreakdownApplyRecord[] {
  if (!incoming.length) return readLog();
  const seen = new Set<string>();
  const next: HubBreakdownApplyRecord[] = [];
  for (const row of [...incoming, ...readLog()]) {
    const key = `${row.itemId}::${row.orderId}::${row.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
    if (next.length >= LIMIT) break;
  }
  writeLog(next);
  return next;
}
