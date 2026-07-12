import type { InventoryItem } from '../types';
import { fetchMyEbayListings, getEbayUsername } from './ebayService';
import { recordEbayListingCheck } from './ebayListingSnapshot';
import type { EbayListingSnapshotEntry } from './ebayListingSnapshot';
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
  matchCount: number;
  unmatchedCount: number;
  dismissed: boolean;
  checkId?: string;
  previousSnapshotAt?: string;
  disappeared?: EbayListingSnapshotEntry[];
  matches?: EbaySoldDetectionMatchPersisted[];
  unmatchedDisappeared?: EbayListingSnapshotEntry[];
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

export function dismissPendingReminder(): void {
  const current = loadPendingReminder();
  if (!current) return;
  savePendingReminder({ ...current, dismissed: true });
  notifyReminderUpdated();
}

export function clearPendingReminder(): void {
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
  previousSnapshotAt: string,
  checkId: string
): EbayReminderPending {
  return {
    detectedAt: new Date().toISOString(),
    disappearedCount: disappeared.length,
    matchCount: plan.matches.length,
    unmatchedCount: plan.unmatchedDisappeared.length,
    dismissed: false,
    checkId,
    previousSnapshotAt: previousSnapshotAt,
    disappeared,
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
): { matches: EbaySoldDetectionMatch[]; unmatched: EbayListingSnapshotEntry[] } {
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
  };
}

export function getActiveReminderForDisplay(): EbayReminderPending | null {
  const pending = loadPendingReminder();
  if (!pending || pending.dismissed) return null;
  if (pending.disappearedCount <= 0) return null;
  return pending;
}

/** Auto-check eBay listings vs last snapshot (max 3× per calendar day). */
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
      recordEbayListingCheck(listings, getEbayUsername());
      onProgress?.({ label: 'Baseline saved', done: 4, total: 4 });
      return {
        ran: true,
        reason: 'baseline_saved',
        message: `Saved ${listings.length} eBay listings as baseline for future sold detection.`,
        pending: null,
      };
    }

    onProgress?.({ label: 'Comparing to last snapshot…', done: 2, total: 4 });
    const check = recordEbayListingCheck(listings, getEbayUsername());

    if (!check.disappeared.length) {
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
      detail: `${check.disappeared.length} ended`,
    });
    const plan = buildEbaySoldDetectionPlan(items, check.disappeared);

    const pending = soldDetectionPlanToPending(
      plan,
      check.disappeared,
      check.previous!.meta.capturedAt,
      check.checkRecord!.checkId
    );

    savePendingReminder(pending);

    notifyReminderUpdated();
    onProgress?.({ label: 'Check complete', done: 4, total: 4 });

    return {
      ran: true,
      reason: 'detected',
      pending,
      message:
        plan.matches.length > 0
          ? `${plan.matches.length} inventory item${plan.matches.length === 1 ? '' : 's'} may have sold on eBay.`
          : `${check.disappeared.length} eBay listing${check.disappeared.length === 1 ? '' : 's'} ended — review your inventory.`,
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
