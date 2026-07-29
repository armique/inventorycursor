/**
 * Subscription to the local AI action log.
 *
 * Reads from localStorage and re-renders on the `ai-actions-updated` event, so nav
 * counters and list badges stay in sync without adding Firestore reads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiAction } from '../types';
import {
  AI_ACTIONS_EVENT,
  buildItemAiStateMap,
  getUnreviewedAiActionCount,
  loadAiActions,
  type ItemAiState,
} from '../services/aiActionLog';
import { AI_SESSION_EVENT, getAiSession, type AiSessionState } from '../services/aiSession';

/** All recorded AI actions, newest first, kept in sync with the log. */
export function useAiActions(): { actions: AiAction[]; refresh: () => void } {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener(AI_ACTIONS_EVENT, refresh);
    return () => window.removeEventListener(AI_ACTIONS_EVENT, refresh);
  }, [refresh]);

  const actions = useMemo(
    () => [...loadAiActions()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the refresh trigger
    [version]
  );

  return { actions, refresh };
}

/** Per-item AI state for badges and the unreviewed stripe. */
export function useItemAiStates(): Map<string, ItemAiState> {
  const { actions } = useAiActions();
  return useMemo(() => buildItemAiStateMap(actions), [actions]);
}

/** Count of unreviewed AI actions — drives the sidebar counter. */
export function useUnreviewedAiCount(): number {
  const { actions } = useAiActions();
  return useMemo(() => getUnreviewedAiActionCount(actions), [actions]);
}

/** Live AI session state — drives the "AI mode" banner. */
export function useAiSession(): AiSessionState | null {
  const [session, setSession] = useState<AiSessionState | null>(() => getAiSession());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setSession(getAiSession());
    window.addEventListener(AI_SESSION_EVENT, sync);
    // The session can also lapse on its own (idle expiry) — re-check periodically.
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(AI_SESSION_EVENT, sync);
      window.clearInterval(timer);
    };
  }, []);

  return session;
}
