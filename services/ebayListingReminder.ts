import type { InventoryItem } from '../types';
import { fetchMyEbayListings, getEbayUsername } from './ebayService';
import {
  commitEbayListingBaselineFromEntries,
  recordEbayListingCheck,
  type EbayListingSnapshotEntry,
} from './ebayListingSnapshot';
import {
  buildEbaySoldDetectionPlan,
  type EbaySoldDetectionMatch,
  type EbaySoldMatchKind,
} from '../utils/ebaySoldDetectionPlan';

const DAILY_CHECKS_KEY = 'ebay_reminder_daily_checks_v1';
const REMINDER_KEY = 'ebay_reminder_pending_v1';

const MAX_CHECKS_PER_DAY = 3;

export interface EbaySoldDetectionMatchPersisted {
  itemId: string;
  lastKnownListing: EbayListingSnapshotEntry;
  matchKind: EbaySoldMatchKind;
  matchScore: number;
  warning?: string;
}

export interface EbayReminderPending {
  detectedAt: string;
  disappearedCount: number;
  appearedCount: number;
  matchCount: number;
  unmatchedCount: number;
  dismissed: boolean;
  checkId?: string;
  previousSnapshotAt?: string;
  /** Ended eBay listings from the saved snapshot (real titles/IDs). */
  disappeared?: EbayListingSnapshotEntry[];
  /** New eBay listings vs saved snapshot. */
  appeared?: EbayListingSnapshotEntry[];
  matches?: EbaySoldDetectionMatchPersisted[];
  unmatchedDisappeared?: EbayListingSnapshotEntry[];
  /** Live store fetch — committed to baseline when dismissed or applied. */
  pendingCurrentEntries?: EbayListingSnapshotEntry[];
}

export type EbayReminderCheckReason =
  | 'rate_limit'
  | 'baseline_saved'
  | 'no_changes'
  | 'detected'
  | 'error';

export interface EbayReminderCheckResult {
  ran: boolean;
  reason: EbayReminderCheckReason;
  message?: string;
  pending?: EbayReminderPending | null;
}

export type EbayReminderProgress = {
  label: string;
  done: number;
  total: number;
  detail?: string;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTodayReminderCheckCount(): number {
  try {
    const raw = localStorage.getItem(DAILY_CHECKS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    if (parsed.date !== todayKey()) return 0;
    return typeof parsed.count === 'number' ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export function canRunAutoReminderCheck(): boolean {
  return getTodayReminderCheckCount() < MAX_CHECKS_PER_DAY;
}

function incrementTodayReminderCheckCount(): number {
  const count = getTodayReminderCheckCount() + 1;
  localStorage.setItem(DAILY_CHECKS_KEY, JSON.stringify({ date: todayKey(), count }));
  return count;
}

export function loadPendingReminder(): EbayReminderPending | null {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EbayReminderPending;
    if (!parsed?.detectedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingReminder(reminder: EbayReminderPending | null): void {
  if (!reminder) {
    localStorage.removeItem(REMINDER_KEY);
    return;
  }
  localStorage.setItem(REMINDER_KEY, JSON.stringify(reminder));
}

export function cancelPendingReminder(): void {
  savePendingReminder(null);
  notifyReminderUpdated();
}

export function commitPendingEbayBaseline(): void {
  const pending = loadPendingReminder();
  if (!pending?.pendingCurrentEntries?.length) return;
  commitEbayListingBaselineFromEntries(
    pending.pendingCurrentEntries,
    getEbayUsername(),
    pending.detectedAt
  );
}

export function dismissPendingReminder(): void {
  const current = loadPendingReminder();
  if (!current) return;
  commitPendingEbayBaseline();
  savePendingReminder({ ...current, dismissed: true });
  notifyReminderUpdated();
}

export function clearPendingReminder(): void {
  commitPendingEbayBaseline();
  savePendingReminder(null);
  notifyReminderUpdated();
}

function notifyReminderUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ebay-reminder-updated'));
  }
}

export function soldDetectionPlanToPending(
  plan: ReturnType<typeof buildEbaySoldDetectionPlan>,
  disappeared: EbayListingSnapshotEntry[],
  appeared: EbayListingSnapshotEntry[],
  pendingCurrentEntries: EbayListingSnapshotEntry[],
  previousSnapshotAt: string,
  checkId: string
): EbayReminderPending {
  return {
    detectedAt: new Date().toISOString(),
    disappearedCount: disappeared.length,
    appearedCount: appeared.length,
    matchCount: plan.matches.length,
    unmatchedCount: plan.unmatchedDisappeared.length,
    dismissed: false,
    checkId,
    previousSnapshotAt,
    disappeared,
    appeared,
    pendingCurrentEntries,
    matches: plan.matches.map((m) => ({
      itemId: m.item.id,
      lastKnownListing: m.lastKnownListing,
      matchKind: m.matchKind,
      matchScore: m.matchScore,
      warning: m.warning,
    })),
    unmatchedDisappeared: plan.unmatchedDisappeared,
  };
}

export function hydrateSoldDetectionFromPending(
  items: InventoryItem[],
  pending: EbayReminderPending
): {
  matches: EbaySoldDetectionMatch[];
  unmatched: EbayListingSnapshotEntry[];
  appeared: EbayListingSnapshotEntry[];
} {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const matches: EbaySoldDetectionMatch[] = [];

  for (const row of pending.matches || []) {
    const item = itemsById.get(row.itemId);
    if (!item) continue;
    matches.push({
      item,
      lastKnownListing: row.lastKnownListing,
      matchKind: row.matchKind,
      matchScore: row.matchScore,
      warning: row.warning,
    });
  }

  return {
    matches,
    unmatched: pending.unmatchedDisappeared ?? [],
    appeared: pending.appeared ?? [],
  };
}

export function getActiveReminderForDisplay(): EbayReminderPending | null {
  const pending = loadPendingReminder();
  if (!pending || pending.dismissed) return null;
  const appeared = pending.appearedCount ?? pending.appeared?.length ?? 0;
  if (pending.disappearedCount <= 0 && appeared <= 0) return null;
  return pending;
}

/** Manual sold-detection check (eBay Store Pull → Detect sold). Auto daily checks are disabled. */
export async function runAutoEbayListingReminderCheck(
  items: InventoryItem[],
  onProgress?: (p: EbayReminderProgress) => void
): Promise<EbayReminderCheckResult> {
  if (!canRunAutoReminderCheck()) {
    const pending = loadPendingReminder();
    return {
      ran: false,
      reason: 'rate_limit',
      message: `Auto-check limit reached (${MAX_CHECKS_PER_DAY}/day). Open eBay Store Pull → Detect sold manually.`,
      pending: pending && !pending.dismissed ? pending : null,
    };
  }

  incrementTodayReminderCheckCount();

  try {
    onProgress?.({ label: 'Fetching active eBay listings…', done: 0, total: 4 });
    const listings = await fetchMyEbayListings();
    onProgress?.({
      label: 'Fetching active eBay listings…',
      done: 1,
      total: 4,
      detail: `${listings.length} listing${listings.length === 1 ? '' : 's'}`,
    });

    if (!loadEbayListingSnapshot()) {
      onProgress?.({ label: 'Saving baseline snapshot…', done: 3, total: 4 });
      recordEbayListingCheck(listings, getEbayUsername(), { commitBaseline: true });
      onProgress?.({ label: 'Baseline saved', done: 4, total: 4 });
      return {
        ran: true,
        reason: 'baseline_saved',
        message: `Saved ${listings.length} eBay listing titles & IDs as today's baseline.`,
        pending: null,
      };
    }

    onProgress?.({ label: 'Comparing to last snapshot…', done: 2, total: 4 });
    const check = recordEbayListingCheck(listings, getEbayUsername());

    if (!check.disappeared.length && !check.appeared.length) {
      clearPendingReminder();
      onProgress?.({ label: 'No listing changes', done: 4, total: 4 });
      return {
        ran: true,
        reason: 'no_changes',
        pending: null,
      };
    }

    onProgress?.({
      label: 'Matching ended listings to inventory…',
      done: 3,
      total: 4,
      detail: `${check.disappeared.length} ended · ${check.appeared.length} new`,
    });
    const plan = buildEbaySoldDetectionPlan(items, check.disappeared);

    const pending = soldDetectionPlanToPending(
      plan,
      check.disappeared,
      check.checkRecord!.appeared,
      check.currentEntries,
      check.previous!.meta.capturedAt,
      check.checkRecord!.checkId
    );

    savePendingReminder(pending);

    notifyReminderUpdated();
    onProgress?.({ label: 'Check complete', done: 4, total: 4 });

    const parts: string[] = [];
    if (check.disappeared.length) {
      parts.push(
        `${check.disappeared.length} listing${check.disappeared.length === 1 ? '' : 's'} removed from eBay`
      );
    }
    if (check.appeared.length) {
      parts.push(`${check.appeared.length} new on eBay`);
    }

    return {
      ran: true,
      reason: 'detected',
      pending,
      message: parts.join(' · '),
    };
  } catch (e: unknown) {
    return {
      ran: true,
      reason: 'error',
      message: (e as Error)?.message || 'Could not check eBay listings.',
      pending: loadPendingReminder(),
    };
  }
}

export { MAX_CHECKS_PER_DAY };
