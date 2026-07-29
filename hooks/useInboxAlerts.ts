/**
 * Daily check for deals that have gone quiet.
 *
 * Runs in the app rather than on a server: the inbox lives in per-user local stores plus a
 * Firestore mirror, so a cron would need admin credentials and a separate read path. The
 * rules themselves are in `utils/staleDeals.ts` as a pure function, so moving this to a
 * scheduled job later is a call-site change, not a rewrite.
 *
 * The result is cached per calendar day so opening the panel repeatedly doesn't recompute
 * (and, later, won't re-send notifications).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadEbayPurchaseIndex } from '../services/ebayPurchaseIndex';
import { loadPendingTransactions, PENDING_TX_EVENT } from '../services/pendingTransactions';
import { findStaleDeals, type StaleDeal } from '../utils/staleDeals';

const LAST_RUN_KEY = 'inbox_stale_check_last_run';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True the first time this is called on a new calendar day. */
export function shouldRunDailyStaleCheck(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(LAST_RUN_KEY) !== todayKey();
  } catch {
    return true;
  }
}

export function markDailyStaleCheckDone(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_RUN_KEY, todayKey());
  } catch {
    /* ignore */
  }
}

/** Stale deals across both inbox sources, refreshed when the stores change. */
export function useStaleDeals(): { deals: StaleDeal[]; refresh: () => void } {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = () => refresh();
    window.addEventListener(PENDING_TX_EVENT, onChange);
    window.addEventListener('ebay-purchase-index-updated', onChange);
    return () => {
      window.removeEventListener(PENDING_TX_EVENT, onChange);
      window.removeEventListener('ebay-purchase-index-updated', onChange);
    };
  }, [refresh]);

  // Re-check on the day boundary so a badge does not sit stale in a tab left open overnight.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (shouldRunDailyStaleCheck()) {
        markDailyStaleCheckDone();
        refresh();
      }
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const deals = useMemo(() => {
    markDailyStaleCheckDone();
    return findStaleDeals(loadPendingTransactions(), loadEbayPurchaseIndex().purchases);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the refresh trigger
  }, [version]);

  return { deals, refresh };
}

/** Just the count — for the navigation badge. */
export function useStaleDealCount(): number {
  return useStaleDeals().deals.length;
}
