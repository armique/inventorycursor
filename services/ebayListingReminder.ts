import type { InventoryItem } from '../types';
import { fetchMyEbayListings, getEbayUsername } from './ebayService';
import {
  compareEbayListingSnapshots,
  loadEbayListingSnapshot,
  saveEbayListingSnapshot,
} from './ebayListingSnapshot';
import { buildEbaySoldDetectionPlan } from '../utils/ebaySoldDetectionPlan';

const DAILY_CHECKS_KEY = 'ebay_reminder_daily_checks_v1';
const REMINDER_KEY = 'ebay_reminder_pending_v1';

const MAX_CHECKS_PER_DAY = 3;

export interface EbayReminderPending {
  detectedAt: string;
  disappearedCount: number;
  matchCount: number;
  unmatchedCount: number;
  dismissed: boolean;
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

/** Auto-check eBay listings vs last snapshot (max 3× per calendar day). */
export async function runAutoEbayListingReminderCheck(
  items: InventoryItem[]
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
    const listings = await fetchMyEbayListings();
    const prev = loadEbayListingSnapshot();

    if (!prev) {
      saveEbayListingSnapshot(listings, getEbayUsername());
      return {
        ran: true,
        reason: 'baseline_saved',
        message: `Saved ${listings.length} eBay listings as baseline for future sold detection.`,
        pending: null,
      };
    }

    const { disappeared } = compareEbayListingSnapshots(prev.entries, listings);
    saveEbayListingSnapshot(listings, getEbayUsername());

    if (!disappeared.length) {
      clearPendingReminder();
      return {
        ran: true,
        reason: 'no_changes',
        pending: null,
      };
    }

    const plan = buildEbaySoldDetectionPlan(items, disappeared);

    if (plan.matches.length === 0 && disappeared.length === 0) {
      clearPendingReminder();
      return { ran: true, reason: 'no_changes', pending: null };
    }

    const pending: EbayReminderPending = {
      detectedAt: new Date().toISOString(),
      disappearedCount: disappeared.length,
      matchCount: plan.matches.length,
      unmatchedCount: plan.unmatchedDisappeared.length,
      dismissed: false,
    };

    savePendingReminder(pending);

    notifyReminderUpdated();

    return {
      ran: true,
      reason: 'detected',
      pending,
      message:
        plan.matches.length > 0
          ? `${plan.matches.length} inventory item${plan.matches.length === 1 ? '' : 's'} may have sold on eBay.`
          : `${disappeared.length} eBay listing${disappeared.length === 1 ? '' : 's'} ended — review your inventory.`,
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

export function getActiveReminderForDisplay(): EbayReminderPending | null {
  const pending = loadPendingReminder();
  if (!pending || pending.dismissed) return null;
  if (pending.matchCount <= 0 && pending.disappearedCount <= 0) return null;
  return pending;
}

export { MAX_CHECKS_PER_DAY };
