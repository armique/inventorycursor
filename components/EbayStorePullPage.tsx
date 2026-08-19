import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { InventoryItem, ItemUpdateOptions, TaxMode } from '../types';
import type { Expense } from '../types';

const EbayStorePullHubArchiveTab = lazy(() => import('./EbayStorePullHubArchiveTab'));

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
  onPublishCatalog?: () => void | Promise<void>;
  onAddExpense: (expense: Expense) => void;
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm font-bold">
      <Loader2 size={18} className="animate-spin" /> Loading Hub ledger…
    </div>
  );
}

const EbayStorePullPage: React.FC<Props> = ({ items, taxMode, onUpdate }) => {
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full h-full overflow-hidden animate-in fade-in">
      <Suspense fallback={<TabFallback />}>
        <EbayStorePullHubArchiveTab items={items} taxMode={taxMode} onUpdate={onUpdate} />
      </Suspense>
    </div>
  );
};

export default EbayStorePullPage;
