import { useCallback, useEffect, useState } from 'react';
import { hydrateHubArchiveIndex } from '../services/ebayHubArchiveIndex';

let hydrateBootstrapped = false;

/**
 * Shared Hub archive cache version for components that read `loadOrdersForSalesSync()`.
 * Hydrates once per page load; all listeners share the same bump on index updates.
 */
export function useHubArchiveCacheTick(): number {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const onIndex = () => bump();
    window.addEventListener('ebay-order-index-updated', onIndex);
    window.addEventListener('ebay-hub-archive-updated', onIndex);
    if (!hydrateBootstrapped) {
      hydrateBootstrapped = true;
      void hydrateHubArchiveIndex().then(() => bump());
    }
    return () => {
      window.removeEventListener('ebay-order-index-updated', onIndex);
      window.removeEventListener('ebay-hub-archive-updated', onIndex);
    };
  }, [bump]);

  return tick;
}
