import { useCallback, useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '../types';
import {
  dismissPendingReminder,
  getActiveReminderForDisplay,
  getTodayReminderCheckCount,
  MAX_CHECKS_PER_DAY,
  runAutoEbayListingReminderCheck,
  type EbayReminderPending,
} from '../services/ebayListingReminder';

export function useEbayListingReminder(items: InventoryItem[], enabled: boolean) {
  const [reminder, setReminder] = useState<EbayReminderPending | null>(() => getActiveReminderForDisplay());
  const [checking, setChecking] = useState(false);
  const hasAutoRun = useRef(false);

  const refreshReminder = useCallback(() => {
    setReminder(getActiveReminderForDisplay());
  }, []);

  const dismiss = useCallback(() => {
    dismissPendingReminder();
    setReminder(null);
  }, []);

  useEffect(() => {
    const onUpdate = () => setReminder(getActiveReminderForDisplay());
    window.addEventListener('ebay-reminder-updated', onUpdate);
    return () => window.removeEventListener('ebay-reminder-updated', onUpdate);
  }, []);

  useEffect(() => {
    if (!enabled || hasAutoRun.current) return;
    if (!items.length) return;

    hasAutoRun.current = true;
    let cancelled = false;

    (async () => {
      setChecking(true);
      try {
        await runAutoEbayListingReminderCheck(items);
        if (!cancelled) {
          setReminder(getActiveReminderForDisplay());
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ebay-reminder-updated'));
          }
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, items.length]);

  const checksRemaining = MAX_CHECKS_PER_DAY - getTodayReminderCheckCount();

  return {
    reminder,
    checking,
    dismiss,
    refreshReminder,
    checksRemaining: Math.max(0, checksRemaining),
  };
}
