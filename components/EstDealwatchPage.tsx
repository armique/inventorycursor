import React, { useEffect, useState } from 'react';

/**
 * Panel route /panel/dealwatch — embeds the full Dealwatch runtime UI
 * (dealwatch-runtime, served at /dealwatch/) with the user's saved searches.
 */
const EstDealwatchPage: React.FC = () => {
  const [bootError, setBootError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dealwatch/store', { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Dealwatch API HTTP ${res.status}`);
        }
        const store = await res.json();
        if (!cancelled && !(store?.searches?.length > 0)) {
          setBootError('Dealwatch API is up, but no saved searches were found in store.json.');
        }
      } catch (err) {
        if (!cancelled) {
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

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {bootError ? (
        <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-900 text-xs font-semibold">
          {bootError}
        </div>
      ) : null}
      <iframe
        title="Dealwatch"
        src="/dealwatch/index.html"
        className="flex-1 min-h-0 w-full border-0 bg-white"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
};

export default EstDealwatchPage;
