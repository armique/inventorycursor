import { useEffect, useState } from 'react';

const DESKTOP_MQ = '(min-width: 1024px)';

/** True at lg+ — use to skip mounting the mobile card list on desktop (CSS hidden still mounts React). */
export function useDesktopInventoryViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia(DESKTOP_MQ).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return isDesktop;
}

/** Run after first paint / when the browser is idle — avoids blocking initial inventory load. */
export function useIdleReady(fallbackMs = 1200): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mark = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(mark, { timeout: fallbackMs });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(mark, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [fallbackMs]);

  return ready;
}
