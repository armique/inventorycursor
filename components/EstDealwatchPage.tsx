import React, { useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '../types';
import DealwatchVerdictBar from './DealwatchVerdictBar';
import MaxBuyPanel from './MaxBuyPanel';

type DealwatchStorePayload = {
  searches?: unknown[];
  activeId?: string;
  [key: string]: unknown;
};

/**
 * Panel route /panel/dealwatch — embeds the full Dealwatch runtime UI and
 * hydrates it with the live store (saved searches) from /api/dealwatch/store.
 */
const EstDealwatchPage: React.FC<{ items?: InventoryItem[] }> = ({ items = [] }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bootError, setBootError] = useState('');
  const [searchCount, setSearchCount] = useState<number | null>(null);
  const [store, setStore] = useState<DealwatchStorePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let next: DealwatchStorePayload | null = null;
        const res = await fetch('/api/dealwatch/store', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) {
          next = (await res.json()) as DealwatchStorePayload;
        } else {
          // Production without serverless wiring yet — fall back to static seed.
          const seed = await fetch('/dealwatch/store.json', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (!seed.ok) {
            const body = await res.json().catch(() => ({} as { error?: unknown }));
            const raw = body?.error;
            const message = typeof raw === 'string'
              ? raw
              : raw && typeof raw === 'object' && 'message' in raw && typeof (raw as { message: unknown }).message === 'string'
                ? String((raw as { message: string }).message)
                : `Dealwatch API HTTP ${res.status}`;
            throw new Error(message);
          }
          next = (await seed.json()) as DealwatchStorePayload;
        }
        if (cancelled || !next) return;
        const count = Array.isArray(next.searches) ? next.searches.length : 0;
        setStore(next);
        setSearchCount(count);
        if (!count) {
          setBootError('Dealwatch store has no saved searches.');
        } else {
          setBootError('');
        }
      } catch (err) {
        if (!cancelled) {
          setStore(null);
          setSearchCount(null);
          setBootError(
            err instanceof Error
              ? (err.message && err.message !== '[object Object]'
                ? err.message
                : 'Dealwatch API unavailable.')
              : 'Dealwatch API unavailable.',
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
      <div className="shrink-0 p-2 border-b border-slate-100">
        <MaxBuyPanel items={items} compact />
      </div>
      <DealwatchVerdictBar />
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
        src={`/dealwatch/index.html?v=${encodeURIComponent('2026-07-30-searches')}`}
        className="flex-1 min-h-0 w-full border-0 bg-white"
        allow="clipboard-read; clipboard-write"
        onLoad={postHydrate}
      />
    </div>
  );
};

export default EstDealwatchPage;
