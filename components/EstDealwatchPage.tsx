import React, { useEffect, useRef, useState } from 'react';

type DealwatchStorePayload = {
  searches?: unknown[];
  activeId?: string;
  [key: string]: unknown;
};

/**
 * Panel route /panel/dealwatch — embeds the full Dealwatch runtime UI and
 * hydrates it with the live store (saved searches) from /api/dealwatch/store.
 */
const EstDealwatchPage: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bootError, setBootError] = useState('');
  const [searchCount, setSearchCount] = useState<number | null>(null);
  const [store, setStore] = useState<DealwatchStorePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dealwatch/store', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Dealwatch API HTTP ${res.status}`);
        }
        const next = (await res.json()) as DealwatchStorePayload;
        if (cancelled) return;
        const count = Array.isArray(next.searches) ? next.searches.length : 0;
        setStore(next);
        setSearchCount(count);
        if (!count) {
          setBootError('Dealwatch API is up, but store.json has no saved searches.');
        } else {
          setBootError('');
        }
      } catch (err) {
        if (!cancelled) {
          setStore(null);
          setSearchCount(null);
          setBootError(
            err instanceof Error
              ? err.message
              : 'Dealwatch API unavailable. Restart with npm run dev (needs dealwatch-runtime/.env).',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const postHydrate = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !store) return;
    win.postMessage({ type: 'dealwatch-hydrate', store }, window.location.origin);
  };

  useEffect(() => {
    if (!store) return;
    postHydrate();
  }, [store]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {bootError ? (
        <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-900 text-xs font-semibold">
          {bootError}
        </div>
      ) : searchCount != null ? (
        <div className="shrink-0 px-4 py-1.5 bg-emerald-50 border-b border-emerald-100 text-emerald-900 text-[11px] font-semibold">
          Dealwatch store connected · {searchCount} saved search{searchCount === 1 ? '' : 'es'}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title="Dealwatch"
        src="/dealwatch/index.html?hydrate=1"
        className="flex-1 min-h-0 w-full border-0 bg-white"
        allow="clipboard-read; clipboard-write"
        onLoad={postHydrate}
      />
    </div>
  );
};

export default EstDealwatchPage;
