import React, { useCallback, useState } from 'react';
import { InventoryItem, ItemUpdateOptions, TaxMode } from '../types';
import EbaySalesSyncPanel from './EbaySalesSyncPanel';
import EbayStorePullHubArchiveTab from './EbayStorePullHubArchiveTab';

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
}

const EbayStorePullOrdersTab: React.FC<Props> = ({ items, taxMode, onUpdate }) => {
  const [statsVersion, setStatsVersion] = useState(0);
  const refreshStats = useCallback(() => setStatsVersion((v) => v + 1), []);

  return (
    <div className="flex flex-col gap-4 min-h-[calc(100vh-11rem)]">
      <EbaySalesSyncPanel
        items={items}
        taxMode={taxMode}
        onUpdate={onUpdate}
        onCacheUpdated={refreshStats}
        cacheVersion={statsVersion}
      />
      <EbayStorePullHubArchiveTab
        items={items}
        taxMode={taxMode}
        onUpdate={onUpdate}
        onArchiveUpdated={refreshStats}
      />
    </div>
  );
};

export default EbayStorePullOrdersTab;
