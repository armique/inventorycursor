import React, { Suspense, lazy, useEffect } from 'react';
import { useSettingsModal } from '../context/SettingsModalContext';
import type { InventoryItem, Expense, BusinessSettings, DashboardPreferences, ActionHistoryEntry, BulkImportRecord } from '../types';

const SettingsPage = lazy(() => import('./SettingsPage'));

type Props = {
  items: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  monthlyGoal: number;
  dashboardPreferences: DashboardPreferences;
  actionHistory: ActionHistoryEntry[];
  bulkImports: BulkImportRecord[];
  onForcePush: () => void | Promise<void>;
  onRestoreItems: (items: InventoryItem[]) => void | Promise<void>;
  onRestoreBackup: (data: unknown) => void | Promise<void>;
  onFixEncoding: () => void | Promise<void>;
  businessSettings: BusinessSettings;
  onBusinessSettingsChange: (next: BusinessSettings) => void;
  categories: Record<string, string[]>;
  categoryFields: Record<string, unknown>;
  onUpdateCategoryStructure: (...args: any[]) => void;
  onUpdateCategoryFields: (...args: any[]) => void;
  onApplyArchivedPhotos: (archivedItems: InventoryItem[], archivedTrash: InventoryItem[]) => void;
};

const SettingsModalHost: React.FC<Props> = (props) => {
  const { open, tab, closeSettings } = useSettingsModal();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closeSettings]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Settings">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        aria-label="Close settings"
        onClick={closeSettings}
      />
      <div className="relative z-10 w-full max-w-5xl h-[min(92vh,920px)] bg-slate-50 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-sm font-bold text-slate-500">
              Loading settings…
            </div>
          }
        >
          <SettingsPage
            {...(props as any)}
            variant="modal"
            initialTabProp={tab}
            onClose={closeSettings}
            onRenameCategory={() => {}}
            onRenameSubCategory={() => {}}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default SettingsModalHost;
