import { useCallback, useEffect, useState } from 'react';
import {
  dismissPendingReminder,
  getActiveReminderForDisplay,
  getTodayReminderCheckCount,
  MAX_CHECKS_PER_DAY,
  type EbayReminderPending,
} from '../services/ebayListingReminder';

/** Pending sold-detection reminders only — no automatic daily API listing fetch. */
export function useEbayListingReminder() {
  const [reminder, setReminder] = useState<EbayReminderPending | null>(() => getActiveReminderForDisplay());

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

  return {
    reminder,
    checking: false,
    checkProgress: null,
    dismiss,
    refreshReminder,
    checksRemaining: Math.max(0, MAX_CHECKS_PER_DAY - getTodayReminderCheckCount()),
  };
}
