import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { Cloud, CheckCircle2, Loader2, WifiOff, RefreshCw, X } from 'lucide-react';

import PanelLayout from './components/PanelLayout';
import QuotaMonitor from './components/QuotaMonitor';

const StorefrontPage = lazy(() => import('./components/StorefrontPage'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const InventoryList = lazy(() => import('./components/InventoryList'));
const ItemForm = lazy(() => import('./components/ItemForm'));
const BulkItemForm = lazy(() => import('./components/BulkItemForm'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const SheetsImport = lazy(() => import('./components/SheetsImport'));
const ExpenseManager = lazy(() => import('./components/ExpenseManager'));
const TrashPage = lazy(() => import('./components/TrashPage'));
const BuilderEntry = lazy(() => import('./components/BuilderEntry'));
const StoreManagementPage = lazy(() => import('./components/StoreManagementPage'));
const StorefrontConfiguratorPage = lazy(() => import('./components/StorefrontConfiguratorPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const InvoiceManager = lazy(() => import('./components/InvoiceManager'));
const ActionHistoryPage = lazy(() => import('./components/ActionHistoryPage'));
const EbayStorePullPage = lazy(() => import('./components/EbayStorePullPage'));
const ThreeDPrintPage = lazy(() => import('./components/ThreeDPrintPage'));
const ProductCardGalleryPage = lazy(() => import('./components/ProductCardGalleryPage'));
const BulkImportHistoryPage = lazy(() => import('./components/BulkImportHistoryPage'));
const EditItemRoute = lazy(() => import('./components/EditItemRoute'));
const PhonePhotoUploadPage = lazy(() => import('./components/PhonePhotoUploadPage'));
const FlipCoachPage = lazy(() => import('./components/FlipCoachPage'));
const SoldPulsePage = lazy(() => import('./components/SoldPulsePage'));
import { InventoryItem, Expense, ItemStatus, BusinessSettings, RecurringExpense, DashboardPreferences, ActionHistoryEntry, TaxMode, ItemUpdateOptions, BulkImportRecord } from './types';
import {
  loadDashboardPreferencesFromLocalStorage,
  persistDashboardPreferencesToLocalStorage,
  normalizeDashboardPreferences,
  getDefaultDashboardPreferences,
} from './services/dashboardPreferences';
import { isCloudEnabled, onAuthChange, subscribeToData, writeToCloud, writeStoreCatalog, getSyncErrorMessage, CLOUD_OMITTED_PLACEHOLDER, fetchFromCloud } from './services/firebaseService';
import { pullOrderIndexFromCloud } from './services/ebayOrderIndex';
import { DEFAULT_CATEGORIES } from './services/constants';
import { migrateCategoriesRecord, migrateContainerItem } from './utils/containerTaxonomy';
import { appendPriceHistoryIfChanged } from './services/priceHistory';
import { computeItemProfitBeforeOverhead } from './services/financialAggregation';
import { syncContainerBuyTotalsFromComponents } from './services/containerAggregates';
import { applyTradeRevert } from './services/tradeRevert';
import { mergeTradeActionEntries } from './services/tradeActionHistory';
import { applySaleRevert } from './services/saleRevert';
import { pruneActionHistory } from './services/saleRevert';
import { saveOAuthResult } from './services/githubBackupService';
import { generateExpensesFromRecurring } from './services/recurringExpenseService';
import { Analytics } from '@vercel/analytics/react';
import { PanelLocaleProvider } from './context/PanelLocaleContext';
import { UndoToastProvider, useUndoToastContext } from './context/UndoToastContext';
import { appendUndoHistory } from './utils/appendUndoHistory';
import { persistSnapshotToLocalStorage, scheduleBackgroundWork } from './services/backgroundPersistence';
import { scheduleItemSalesPoolRebuild } from './utils/itemSalesPool';
import { buildStoreCatalog } from './utils/storefrontCatalog';
import {
  BULK_IMPORTS_LIMIT,
  BULK_IMPORT_BACKFILL_KEY,
  backfillBulkImportsFromItems,
  enrichBulkImportsWithChatProof,
  loadBulkImportsFromStorage,
  localBulkImportsNeedCloudPush,
  mergeBulkImportsFromLocal,
  stampItemsFromBulkImportRecords,
} from './utils/bulkImportHistory';
import {
  CONTAINER_BUY_DATE_BACKFILL_KEY,
  backfillContainerBuyDates,
  preferFilledContainerBuyDate,
} from './utils/backfillContainerBuyDates';
import {
  WRITE_DEBOUNCE_MS,
  FAST_CLOUD_FLUSH_MS,
  LOCAL_PERSIST_DEBOUNCE_MS,
  STORE_CATALOG_DEBOUNCE_MS,
  REMOTE_APPLY_SUPPRESS_MS,
  BULK_IMPORT_SYNC_FLUSH_MS,
  resolveCloudFlushDelay,
  shouldFlushCloudSoon,
} from './utils/cloudSyncTiming';
import {
  SYNC_MSG_PENDING,
  SYNC_MSG_UPLOADING,
  SYNC_MSG_SYNCED,
  SYNC_MSG_RETRYING,
} from './utils/cloudSyncStatus';

const ACTION_HISTORY_LIMIT = 400;

type AppSyncSnapshot = {
  items: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  businessSettings: BusinessSettings;
  monthlyGoal: number;
  dashboardPrefs: DashboardPreferences;
  actionHistory: ActionHistoryEntry[];
  bulkImports: BulkImportRecord[];
};

/** When merging an update into an existing item, preserve these from the old item if the update
 * doesn't provide them (so renames/edits from inventory don't wipe store data). Deliberately
 * excludes sellPrice/storePrice — those are actively user-editable numeric fields with real
 * "clear to remove" semantics (e.g. clearing a price in the inline table editor); restoring the
 * old value whenever the new one is undefined made it impossible to ever actually clear them. */
const PRESERVE_FROM_OLD_IF_UPDATE_MISSING: (keyof InventoryItem)[] = [
  'imageUrl', 'imageUrls', 'storeGalleryUrls', 'storeDescription', 'storeVisible', 'storeOnSale', 'storeSalePrice',
  'specs', 'componentIds', 'comment1', 'comment2', 'vendor', 'hasOVP', 'hasIOShield', 'hasReceipt', 'aiDescriptionNote',
  'platformBought', 'buyPaymentType', 'kleinanzeigenBuyChatUrl', 'kleinanzeigenBuyChatImage',
  'kleinanzeigenSellerProfileUrl',
  'bulkImportId',
];

function GitHubOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setStatus('error');
      setMessage('Missing code');
      return;
    }
    const redirectUri = `${window.location.origin}/auth/github/callback`;
    const apiUrl = `${window.location.origin}/api/github-oauth?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus('error');
          setMessage(data.error);
          return;
        }
        saveOAuthResult(data.access_token || '', data.login || null);
        setStatus('ok');
        navigate('/panel/settings', { replace: true });
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err?.message || 'Request failed');
      });
  }, [searchParams, navigate]);

  if (status === 'ok') return null;
  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 items-center justify-center flex-col space-y-4 p-4">
      {status === 'loading' && <Loader2 size={48} className="animate-spin text-slate-400" />}
      {status === 'error' && (
        <>
          <p className="text-sm font-bold text-red-600">{message}</p>
          <button type="button" onClick={() => navigate('/panel/settings')} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold">Go to Settings</button>
        </>
      )}
      <p className="text-slate-500 text-sm">{status === 'loading' ? 'Signing in with GitHub…' : ''}</p>
    </div>
  );
}

export { DEFAULT_CATEGORIES, HIERARCHY_CATEGORIES } from './services/constants';

function recomputeRealizedProfit(item: InventoryItem, taxMode: TaxMode): InventoryItem {
  // Keep container-style bookkeeping untouched; their profit is handled separately.
  if (item.isBundle || item.isPC) return item;
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED && item.status !== ItemStatus.GIFTED) return item;
  if (item.sellPrice == null || Number.isNaN(Number(item.sellPrice))) return { ...item, profit: undefined };
  if (Number.isNaN(Number(item.buyPrice))) return { ...item, profit: undefined };
  const profit = computeItemProfitBeforeOverhead(item, taxMode);
  return { ...item, profit };
}

function makeActionEntry(action: string, item?: InventoryItem, details?: string, timestampIso?: string): ActionHistoryEntry {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: timestampIso || new Date().toISOString(),
    action,
    itemId: item?.id,
    itemName: item?.name,
    details,
  };
}

interface SyncState {
  status: 'idle' | 'pending' | 'syncing' | 'success' | 'error';
  lastSynced: Date | null;
  message?: string;
}

type AppState = 'BOOTING' | 'READY' | 'ERROR_SYNC' | 'OFFLINE_MODE';

function loadActionHistoryFromStorage(): ActionHistoryEntry[] {
  try {
    const raw = localStorage.getItem('action_history');
    const parsed = raw ? (JSON.parse(raw) as ActionHistoryEntry[]) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    return pruneActionHistory(list).active;
  } catch {
    return [];
  }
}

const App: React.FC = () => {
  // State for Data
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>(() => loadActionHistoryFromStorage());
  const [bulkImports, setBulkImports] = useState<BulkImportRecord[]>(() => loadBulkImportsFromStorage());
  const [trash, setTrash] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  
  // Dynamic Categories
  const [categories, setCategories] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem('custom_categories');
    const base = saved ? JSON.parse(saved) : { ...DEFAULT_CATEGORIES };
    // PC / Bundle / Mixed Bundle — no subcategories
    base.PC = [];
    base.Bundle = [];
    base['Mixed Bundle'] = [];
    return base;
  });

  const [categoryFields, setCategoryFields] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem('custom_category_fields');
    return saved ? JSON.parse(saved) : {};
  });


  const handleAddCategory = (category: string, subcategory?: string) => {
    setCategories(prev => {
      const next = { ...prev };
      if (!next[category]) next[category] = [];
      if (subcategory && !next[category].includes(subcategory)) next[category] = [...next[category], subcategory];
      return next;
    });
  };
  const handleUpdateCategoryStructure = (newCategories: Record<string, string[]>) => setCategories(newCategories);
  const handleUpdateCategoryFields = (newFields: Record<string, string[]>) => setCategoryFields(newFields);
  
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(() => {
    const saved = localStorage.getItem('business_settings');
    return saved ? JSON.parse(saved) : { 
      companyName: '', ownerName: '', address: '', phone: '', taxId: '', vatId: '', iban: '', bic: '', bankName: '', taxMode: 'SmallBusiness' 
    };
  });
  
  const [monthlyGoal, setMonthlyGoal] = useState<number>(() => {
    const saved = localStorage.getItem('monthly_profit_goal');
    return saved ? parseInt(saved) : 1000;
  });

  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPreferences>(() => loadDashboardPreferencesFromLocalStorage());
  const dashboardPrefsRef = useRef(dashboardPrefs);
  const actionHistoryRef = useRef<ActionHistoryEntry[]>(loadActionHistoryFromStorage());
  const bulkImportsRef = useRef<BulkImportRecord[]>(loadBulkImportsFromStorage());
  useEffect(() => {
    dashboardPrefsRef.current = dashboardPrefs;
  }, [dashboardPrefs]);
  useEffect(() => {
    actionHistoryRef.current = actionHistory;
  }, [actionHistory]);
  useEffect(() => {
    bulkImportsRef.current = bulkImports;
  }, [bulkImports]);

  // One-time storefront reset requested by user: hide all currently visible items.
  useEffect(() => {
    if (items.length === 0) return;
    const resetKey = 'storefront_reset_applied_v1';
    if (localStorage.getItem(resetKey) === '1') return;
    if (items.some((i) => i.storeVisible === true)) {
      setItems((prev) => prev.map((i) => (i.storeVisible === true ? { ...i, storeVisible: false } : i)));
      hasUnsavedChanges.current = true;
    }
    localStorage.setItem(resetKey, '1');
  }, [items.length]);

  const [appState, setAppState] = useState<AppState>('BOOTING');
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', lastSynced: null });
  const [bootError, setBootError] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(() => localStorage.getItem('cloud_backup_banner_dismissed') === '1');
  
  const [authUser, setAuthUser] = useState<any>(null);
  // Tracks when Firebase auth has completed its initial check (so we don't flash the login screen before session restore).
  const [authReady, setAuthReady] = useState<boolean>(!isCloudEnabled());
  const isRemoteUpdate = useRef(false);
  const hasUnsavedChanges = useRef(false);
  /** After remote merge, push if this device had bulk-import history cloud lacked. */
  const pendingCloudPushAfterRemoteRef = useRef(false);
  const writeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localPersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Next cloud write delay; discrete actions set FAST_CLOUD_FLUSH_MS before setState. */
  const preferredCloudFlushMsRef = useRef(WRITE_DEBOUNCE_MS);
  const pendingCloudFlushRef = useRef(false);
  const initialWriteDoneRef = useRef(false);
  const ebayOrderIndexPulledRef = useRef(false);
  const storeCatalogPublishDoneRef = useRef(false);
  const catalogPublishDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudSyncInFlightRef = useRef(false);
  const suppressRemoteApplyUntilRef = useRef(0);
  const remoteSnapshotSeenRef = useRef(false);
  const itemsRef = useRef(items);
  const trashRef = useRef(trash);
  const expensesRef = useRef(expenses);
  const recurringExpensesRef = useRef(recurringExpenses);
  const categoriesRef = useRef(categories);
  const categoryFieldsRef = useRef(categoryFields);
  const businessSettingsRef = useRef(businessSettings);
  const monthlyGoalRef = useRef(monthlyGoal);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { trashRef.current = trash; }, [trash]);
  useEffect(() => { expensesRef.current = expenses; }, [expenses]);
  useEffect(() => { recurringExpensesRef.current = recurringExpenses; }, [recurringExpenses]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { categoryFieldsRef.current = categoryFields; }, [categoryFields]);
  useEffect(() => { businessSettingsRef.current = businessSettings; }, [businessSettings]);
  useEffect(() => { monthlyGoalRef.current = monthlyGoal; }, [monthlyGoal]);

  const getSyncSnapshot = useCallback((): AppSyncSnapshot => ({
    items: itemsRef.current,
    trash: trashRef.current,
    expenses: expensesRef.current,
    recurringExpenses: recurringExpensesRef.current,
    categories: categoriesRef.current,
    categoryFields: categoryFieldsRef.current,
    businessSettings: businessSettingsRef.current,
    monthlyGoal: monthlyGoalRef.current,
    dashboardPrefs: dashboardPrefsRef.current,
    actionHistory: actionHistoryRef.current,
    bulkImports: bulkImportsRef.current,
  }), []);

  const requestFastCloudFlush = useCallback(() => {
    preferredCloudFlushMsRef.current = Math.min(
      preferredCloudFlushMsRef.current,
      FAST_CLOUD_FLUSH_MS
    );
  }, []);

  const shouldApplyRemoteSnapshot = useCallback((data: { updatedAt?: string } | null) => {
    if (!data) return false;
    if (!remoteSnapshotSeenRef.current) return true;
    if (Date.now() < suppressRemoteApplyUntilRef.current) return false;
    if (cloudSyncInFlightRef.current) return false;
    if (hasUnsavedChanges.current) return false;
    return true;
  }, []);

  // Public storefront catalog is rebuilt from inventory via debounced publishStoreCatalog / writeStoreCatalog.

  const saveToLocalStorage = (
    newItems: InventoryItem[],
    newTrash: InventoryItem[],
    newExpenses: Expense[],
    newSettings: BusinessSettings,
    newGoal: number,
    newCategories: Record<string, string[]>,
    newFields: Record<string, string[]>,
    newRecurringExpenses?: RecurringExpense[],
    dashOverride?: DashboardPreferences,
    actionHistorySnapshot?: ActionHistoryEntry[],
    bulkImportsSnapshot?: BulkImportRecord[]
  ) => {
    const dash = dashOverride ?? dashboardPrefsRef.current;
    const ah = (actionHistorySnapshot ?? actionHistoryRef.current).slice(-ACTION_HISTORY_LIMIT);
    actionHistoryRef.current = ah;
    const bi = (bulkImportsSnapshot ?? bulkImportsRef.current).slice(0, BULK_IMPORTS_LIMIT);
    bulkImportsRef.current = bi;
    localStorage.setItem('action_history', JSON.stringify(ah));
    localStorage.setItem('bulk_imports', JSON.stringify(bi));
    localStorage.setItem('inventory_items', JSON.stringify(newItems));
    localStorage.setItem('inventory_trash', JSON.stringify(newTrash));
    localStorage.setItem('inventory_expenses', JSON.stringify(newExpenses));
    localStorage.setItem('business_settings', JSON.stringify(newSettings));
    localStorage.setItem('monthly_profit_goal', newGoal.toString());
    localStorage.setItem('custom_categories', JSON.stringify(newCategories));
    localStorage.setItem('custom_category_fields', JSON.stringify(newFields));
    if (newRecurringExpenses !== undefined) {
      localStorage.setItem('recurring_expenses', JSON.stringify(newRecurringExpenses));
    }
    persistDashboardPreferencesToLocalStorage(dash);
    // Debounced — only when sold-set changes; never block clicks.
    try {
      scheduleItemSalesPoolRebuild(newItems);
    } catch {
      /* ignore */
    }
  };

  /** Merge remote inventory with local. Remote wins on conflicts, but local-only items (e.g. newly added via bulk) are preserved until synced. */
  const mergeInventoryWithLocal = useCallback((remoteList: InventoryItem[], localList: InventoryItem[]): InventoryItem[] => {
    const largeFields = ['imageUrl', 'receiptUrl', 'kleinanzeigenChatImage', 'kleinanzeigenBuyChatImage', 'marketDescription'] as const;
    const localById = new Map(localList.map((i) => [i.id, i]));
    const byId = new Map<string, InventoryItem>();
    const isDisposed = (s: ItemStatus | undefined) =>
      s === ItemStatus.SOLD || s === ItemStatus.TRADED || s === ItemStatus.GIFTED;

    const applyLargeFieldPlaceholders = (base: InventoryItem, fromRemote: InventoryItem): InventoryItem => {
      let changed = false;
      const out = { ...base };
      for (const key of largeFields) {
        const rv = (fromRemote as Record<string, unknown>)[key];
        const lv = (base as Record<string, unknown>)[key];
        if (rv === CLOUD_OMITTED_PLACEHOLDER && lv && typeof lv === 'string' && lv.length > 0) {
          (out as Record<string, unknown>)[key] = lv;
          changed = true;
        }
      }
      return changed ? out : base;
    };

    // Start with local (preserves items only in local – e.g. newly added bulk items not yet in cloud)
    localList.forEach((i) => {
      if (i?.id) byId.set(i.id, i);
    });
    // Overlay remote when ID matches — default remote wins, except stale cloud must not undo a local sale/trade
    remoteList.forEach((r) => {
      if (!r?.id) return;
      const local = localById.get(r.id);
      if (!local) {
        byId.set(r.id, r);
        return;
      }

      const localDisposed = isDisposed(local.status);
      const remoteDisposed = isDisposed(r.status);

      if (localDisposed && !remoteDisposed) {
        const kept = applyLargeFieldPlaceholders(local, r);
        const localBid = (local.bulkImportId || '').trim();
        if (localBid && !(kept.bulkImportId || '').trim()) {
          byId.set(r.id, { ...kept, bulkImportId: localBid });
        } else {
          byId.set(r.id, kept);
        }
        return;
      }

      let changed = false;
      const out = { ...r };
      for (const key of largeFields) {
        const rv = (r as Record<string, unknown>)[key];
        const lv = (local as Record<string, unknown>)[key];
        if (rv === CLOUD_OMITTED_PLACEHOLDER && lv && typeof lv === 'string' && lv.length > 0) {
          (out as Record<string, unknown>)[key] = lv;
          changed = true;
        }
      }
      // bulkImportId stamps must survive remote-wins — otherwise a lagging phone wipe clears Flags.
      const localBid = (local.bulkImportId || '').trim();
      const remoteBid = (r.bulkImportId || '').trim();
      if (localBid && !remoteBid) {
        out.bulkImportId = localBid;
        changed = true;
      }
      // Keep local container Acquired when cloud still has a blank buyDate.
      const withBuyDate = preferFilledContainerBuyDate(out, local);
      if (withBuyDate.buyDate !== out.buyDate) {
        changed = true;
      }
      byId.set(r.id, changed ? withBuyDate : r);
    });
    return Array.from(byId.values());
  }, []);

  // Merge expenses from cloud with locally stored expenses.
  // - Uses expense.id as the stable key.
  // - Remote (cloud) wins on conflicts (same id), but any purely local
  //   expenses that haven't been pushed yet are preserved instead of being
  //   overwritten when the first snapshot arrives.
  const mergeExpensesFromLocal = useCallback((remoteList: Expense[], localList: Expense[]): Expense[] => {
    if (!localList?.length) return remoteList || [];
    if (!remoteList?.length) return localList || [];

    const byId = new Map<string, Expense>();
    // start with local (so we keep anything only-in-local)
    localList.forEach((e) => {
      if (e && e.id) byId.set(e.id, e);
    });
    // overlay remote (server truth wins when IDs match)
    remoteList.forEach((e) => {
      if (e && e.id) byId.set(e.id, e);
    });
    return Array.from(byId.values());
  }, []);

  const mergeActionHistoryFromLocal = useCallback((remoteList: ActionHistoryEntry[], localList: ActionHistoryEntry[]): ActionHistoryEntry[] => {
    if (!localList?.length) return [...(remoteList || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!remoteList?.length) return [...(localList || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const byId = new Map<string, ActionHistoryEntry>();
    localList.forEach((e) => {
      if (e?.id) byId.set(e.id, e);
    });
    remoteList.forEach((e) => {
      if (e?.id) byId.set(e.id, e);
    });
    return Array.from(byId.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, []);

  const applyRemoteData = useCallback((data: any) => {
    if (!data) return;
    isRemoteUpdate.current = true;
    const remoteInv = (data.inventory || []) as InventoryItem[];
    const remoteTrash = (data.trash || []) as InventoryItem[];
    const localItems = itemsRef.current;
    const localTrash = trashRef.current;
    const inv = mergeInventoryWithLocal(remoteInv, localItems);
    const tr = mergeInventoryWithLocal(remoteTrash, localTrash);
    const localExpenses = expensesRef.current;
    const remoteExpenses = (data.expenses || []) as Expense[];
    const exp = mergeExpensesFromLocal(remoteExpenses, localExpenses);
    const remoteRecurring = (data.recurringExpenses || []) as RecurringExpense[];
    const localRecurring = recurringExpensesRef.current;
    // Merge recurring expenses by ID (remote wins on conflicts)
    const recurringMap = new Map<string, RecurringExpense>();
    localRecurring.forEach(r => { if (r && r.id) recurringMap.set(r.id, r); });
    remoteRecurring.forEach(r => { if (r && r.id) recurringMap.set(r.id, r); });
    const recurring = Array.from(recurringMap.values());
    const sets = data.settings || {};
    const goal = data.goals?.monthly ?? monthlyGoalRef.current;
    const cats = data.categories || categoriesRef.current;
    const fields = data.categoryFields || categoryFieldsRef.current;
    let dashToSave: DashboardPreferences;
    if (data.dashboard != null) {
      dashToSave = normalizeDashboardPreferences(data.dashboard);
      setDashboardPrefs(dashToSave);
    } else {
      dashToSave = dashboardPrefsRef.current;
    }
    const localAH = actionHistoryRef.current;
    const remoteAH = Array.isArray(data.actionHistory) ? (data.actionHistory as ActionHistoryEntry[]) : [];
    const mergedAH = mergeActionHistoryFromLocal(remoteAH, localAH).slice(-ACTION_HISTORY_LIMIT);
    setActionHistory(mergedAH);
    actionHistoryRef.current = mergedAH;
    const localBI = bulkImportsRef.current;
    const remoteBI = Array.isArray(data.bulkImports) ? (data.bulkImports as BulkImportRecord[]) : [];
    const mergedBI = mergeBulkImportsFromLocal(remoteBI, localBI).slice(0, BULK_IMPORTS_LIMIT);
    setBulkImports(mergedBI);
    bulkImportsRef.current = mergedBI;
    // If this device had history (or richer rows) the cloud snapshot lacked, push after apply.
    if (localBulkImportsNeedCloudPush(mergedBI, remoteBI)) {
      pendingCloudPushAfterRemoteRef.current = true;
      hasUnsavedChanges.current = true;
    }
    const migratedInv = inv.map(migrateContainerItem);
    const { items: filledInv, updatedCount: filledCount } = backfillContainerBuyDates(migratedInv);
    if (filledCount > 0) {
      requestFastCloudFlush();
      hasUnsavedChanges.current = true;
    }
    setItems(filledInv);
    setTrash(tr.map(migrateContainerItem));
    setExpenses(exp);
    setRecurringExpenses(recurring);
    setBusinessSettings(prev => ({ ...prev, ...sets }));
    setMonthlyGoal(goal);
    setCategories(migrateCategoriesRecord(cats));
    setCategoryFields(fields);
    scheduleBackgroundWork(() =>
      persistSnapshotToLocalStorage({
        itemsJson: JSON.stringify(inv),
        trashJson: JSON.stringify(tr),
        expensesJson: JSON.stringify(exp),
        settingsJson: JSON.stringify({ ...businessSettingsRef.current, ...sets }),
        monthlyGoal: goal.toString(),
        categoriesJson: JSON.stringify(cats),
        categoryFieldsJson: JSON.stringify(fields),
        recurringExpensesJson: JSON.stringify(recurring),
        dashboardPrefs: dashToSave,
        actionHistoryJson: JSON.stringify(mergedAH),
        bulkImportsJson: JSON.stringify(mergedBI),
      })
    );
  }, [mergeActionHistoryFromLocal, mergeExpensesFromLocal, mergeInventoryWithLocal, requestFastCloudFlush]);

  // 1. BOOT: load local data and show app immediately; sync with Firestore in background
  useEffect(() => {
    loadLocalData();
    setAppState('READY');
    if (!isCloudEnabled()) return;
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthChange((user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
      if (!user) {
        initialWriteDoneRef.current = false;
        ebayOrderIndexPulledRef.current = false;
        setSyncState(prev => ({ ...prev, status: 'idle', message: undefined }));
        return;
      }
      setSyncState({ status: 'syncing', lastSynced: null, message: 'Connecting…' });
      unsubSnapshot = subscribeToData(user.uid, (data) => {
        if (data && shouldApplyRemoteSnapshot(data)) {
          applyRemoteData(data);
        }
        remoteSnapshotSeenRef.current = true;
        setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
      });
    });
    return () => {
      if (unsubSnapshot) unsubSnapshot();
      if (unsubAuth) unsubAuth();
    };
  }, [applyRemoteData, shouldApplyRemoteSnapshot]);

  const loadLocalData = () => {
    const localItems = JSON.parse(localStorage.getItem('inventory_items') || '[]') as InventoryItem[];
    setItems(localItems.map(migrateContainerItem));
    const localTrash = JSON.parse(localStorage.getItem('inventory_trash') || '[]') as InventoryItem[];
    setTrash(localTrash.map(migrateContainerItem));
    setExpenses(JSON.parse(localStorage.getItem('inventory_expenses') || '[]'));
    setRecurringExpenses(JSON.parse(localStorage.getItem('recurring_expenses') || '[]'));
    setCategories((prev) => migrateCategoriesRecord(prev));
    setBulkImports(loadBulkImportsFromStorage());
  };

  // One-time backfill: stamp bulkImportId on legacy bulk-{ts}-{n} items and seed history.
  useEffect(() => {
    if (appState !== 'READY' || items.length === 0) return;
    if (localStorage.getItem(BULK_IMPORT_BACKFILL_KEY) === '1') return;
    const beforeIds = new Set(bulkImportsRef.current.map((r) => r.id));
    const result = backfillBulkImportsFromItems(items, bulkImportsRef.current);
    localStorage.setItem(BULK_IMPORT_BACKFILL_KEY, '1');
    const added = result.records.some((r) => !beforeIds.has(r.id));
    if (added || result.records.length !== beforeIds.size) {
      setBulkImports(result.records);
      bulkImportsRef.current = result.records;
      localStorage.setItem('bulk_imports', JSON.stringify(result.records));
      hasUnsavedChanges.current = true;
    }
    if (result.changedItems) {
      setItems(result.items);
      hasUnsavedChanges.current = true;
    }
  }, [appState, items.length]);

  // Fill empty Acquired on PC / Bundle / Mixed whenever blanks remain.
  // Not one-shot: cloud snapshots can wipe local fills, so re-apply until every container has a date.
  useEffect(() => {
    if (appState !== 'READY' || items.length === 0) return;
    const { items: next, updatedCount } = backfillContainerBuyDates(items);
    if (updatedCount === 0) return;
    requestFastCloudFlush();
    setItems(next);
    hasUnsavedChanges.current = true;
  }, [appState, items, requestFastCloudFlush]);

  // Enrich history rows with chat URL / screenshot from member items (legacy sessions).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (bulkImportsRef.current.length === 0 || items.length === 0) return;
    const { records, changed } = enrichBulkImportsWithChatProof(bulkImportsRef.current, items);
    if (!changed) return;
    setBulkImports(records);
    bulkImportsRef.current = records;
    localStorage.setItem('bulk_imports', JSON.stringify(records));
    hasUnsavedChanges.current = true;
  }, [appState, items, bulkImports]);

  // Cross-device: stamp bulkImportId onto members listed in history (Flags icon on every device).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (bulkImports.length === 0 || items.length === 0) return;
    const { items: stamped, changed } = stampItemsFromBulkImportRecords(items, bulkImports);
    if (!changed) return;
    setItems(stamped);
    hasUnsavedChanges.current = true;
  }, [appState, bulkImports, items]);

  // One-time migration: merge Peripherals > Optical Drives into Components > Optical Drives, then remove Optical Drives from Peripherals
  const OPTICAL_DRIVES_MIGRATION_KEY = 'migration_optical_drives_to_components';
  useEffect(() => {
    if (appState !== 'READY' || items.length === 0) return;
    if (localStorage.getItem(OPTICAL_DRIVES_MIGRATION_KEY) === '1') return;
    const fromCat = 'Peripherals';
    const fromSub = 'Optical Drives';
    const toCat = 'Components';
    const toSub = 'Optical Drives';
    const toMove = items.filter((i) => i.category === fromCat && i.subCategory === fromSub);
    const peripheralsHasOptical = categories[fromCat]?.includes(fromSub);
    if (toMove.length === 0 && !peripheralsHasOptical) {
      localStorage.setItem(OPTICAL_DRIVES_MIGRATION_KEY, '1');
      return;
    }
    const newItems = items.map((i) =>
      i.category === fromCat && i.subCategory === fromSub ? { ...i, category: toCat, subCategory: toSub } : i
    );
    const newCategories = { ...categories };
    if (newCategories[fromCat]) {
      newCategories[fromCat] = newCategories[fromCat].filter((s) => s !== fromSub);
      if (newCategories[fromCat].length === 0) delete newCategories[fromCat];
    }
    if (!newCategories[toCat]) newCategories[toCat] = [];
    if (!newCategories[toCat].includes(toSub)) newCategories[toCat] = [...newCategories[toCat], toSub].sort();
    const newFields = { ...categoryFields };
    delete newFields[`${fromCat}:${fromSub}`];
    setItems(newItems);
    setCategories(newCategories);
    setCategoryFields(newFields);
    saveToLocalStorage(newItems, trash, expenses, businessSettings, monthlyGoal, newCategories, newFields, recurringExpenses);
    localStorage.setItem(OPTICAL_DRIVES_MIGRATION_KEY, '1');
  }, [appState, items, categories, categoryFields, trash, expenses, businessSettings, monthlyGoal, recurringExpenses]);

  // Initial cloud sync when user signs in:
  // - FIRST try to pull existing data from Firestore so a new device never overwrites cloud with an empty local state.
  // - ONLY if there is no remote document yet do we push the local snapshot once.
  useEffect(() => {
    if (!authUser || !isCloudEnabled() || initialWriteDoneRef.current) return;
    initialWriteDoneRef.current = true;

    (async () => {
      try {
        // 1) Try to read existing cloud data for this user.
        const remote = await fetchFromCloud();
        if (remote) {
          applyRemoteData(remote as any);
          setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
          // Ensure storefront catalog is up to date with remote data.
          await writeStoreCatalog(buildStoreCatalog((remote.inventory || []) as InventoryItem[], remote.categoryFields || {})).catch((e) =>
            console.warn('Store catalog update failed', e)
          );
          return;
        }

        // 2) No remote doc yet: push current local state once to initialize cloud.
        const payload = {
          inventory: items,
          trash,
          expenses,
          recurringExpenses,
          categories,
          categoryFields,
          settings: businessSettings,
          goals: { monthly: monthlyGoal },
          dashboard: dashboardPrefs,
          actionHistory: actionHistory.slice(-ACTION_HISTORY_LIMIT),
          bulkImports: bulkImports.slice(0, BULK_IMPORTS_LIMIT),
        };
        await writeToCloud(payload);
        hasUnsavedChanges.current = false;
        suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
        setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
        scheduleBackgroundWork(async () => {
          await writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) =>
            console.warn('Store catalog update failed', e)
          );
        });
      } catch (err) {
        initialWriteDoneRef.current = false;
        setSyncState((prev) => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) }));
      }
    })();
  }, [authUser, items, trash, expenses, recurringExpenses, categories, categoryFields, businessSettings, monthlyGoal, dashboardPrefs, actionHistory, bulkImports, applyRemoteData]);

  // Re-hydrate the cached eBay order history (Order lookup button in Flags column) from the
  // cloud mirror as soon as we're signed in — so a cleared browser or brand-new PC has the
  // order cache ready before the user ever opens the eBay Store Pull → Order history tab.
  useEffect(() => {
    if (!authUser || !isCloudEnabled() || ebayOrderIndexPulledRef.current) return;
    ebayOrderIndexPulledRef.current = true;
    void pullOrderIndexFromCloud().catch((e) => console.warn('eBay order index cloud pull failed:', e));
  }, [authUser]);

  // Publish store catalog once when panel has items and auth (ensures storefront gets data)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser || items.length === 0 || storeCatalogPublishDoneRef.current) return;
    storeCatalogPublishDoneRef.current = true;
    const t = setTimeout(() => {
      writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [authUser, items.length, isCloudEnabled(), items, categoryFields]);

  // Publish store catalog soon after store-visible items change (long debounce, idle work)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser) return;
    if (catalogPublishDebounceRef.current) clearTimeout(catalogPublishDebounceRef.current);
    catalogPublishDebounceRef.current = setTimeout(() => {
      catalogPublishDebounceRef.current = null;
      const snap = getSyncSnapshot();
      scheduleBackgroundWork(async () => {
        const catalog = buildStoreCatalog(snap.items, snap.categoryFields);
        await writeStoreCatalog(catalog).catch((e) => console.warn('Store catalog update failed', e));
      });
    }, STORE_CATALOG_DEBOUNCE_MS);
    return () => {
      if (catalogPublishDebounceRef.current) clearTimeout(catalogPublishDebounceRef.current);
    };
  }, [items, categoryFields, authUser, getSyncSnapshot]);

  // Generate expenses from recurring expenses
  const recurringGenRef = useRef<string>(''); // Track last generation to avoid loops
  useEffect(() => {
    if (appState !== 'READY' || recurringExpenses.length === 0) return;
    
    // Create a signature of current recurring expenses to detect changes
    const signature = recurringExpenses.map(r => `${r.id}:${r.startDate}:${r.lastGeneratedDate || ''}`).join('|');
    if (signature === recurringGenRef.current) return; // Already processed this state
    
    let hasNewExpenses = false;
    const newExpenses: Expense[] = [];
    const updatedRecurring: RecurringExpense[] = [];
    
    // Use current expenses state to check for duplicates
    setExpenses(currentExpenses => {
      for (const recurring of recurringExpenses) {
        const { expenses: generated, lastGeneratedDate } = generateExpensesFromRecurring(recurring, currentExpenses);
        if (generated.length > 0) {
          hasNewExpenses = true;
          newExpenses.push(...generated);
          updatedRecurring.push({ ...recurring, lastGeneratedDate });
        } else {
          updatedRecurring.push(recurring);
        }
      }
      
      if (hasNewExpenses) {
        // Update recurring expenses with new lastGeneratedDate values
        setRecurringExpenses(updatedRecurring);
        recurringGenRef.current = updatedRecurring.map(r => `${r.id}:${r.startDate}:${r.lastGeneratedDate || ''}`).join('|');
        
        // Add new generated expenses
        const existingIds = new Set(currentExpenses.map(e => e.id));
        const uniqueNew = newExpenses.filter(e => !existingIds.has(e.id));
        return [...currentExpenses, ...uniqueNew];
      }
      
      return currentExpenses;
    });
  }, [appState, recurringExpenses]); // Only depend on recurringExpenses, use functional setState for expenses

  const runSilentCloudSync = useCallback(async () => {
    if (!isCloudEnabled() || !authUser) return;
    if (cloudSyncInFlightRef.current) {
      pendingCloudFlushRef.current = true;
      return;
    }
    const snap = getSyncSnapshot();
    cloudSyncInFlightRef.current = true;
    setSyncState((prev) => ({
      ...prev,
      status: 'syncing',
      message: prev.status === 'error' ? prev.message : SYNC_MSG_UPLOADING,
    }));
    const payload = {
      inventory: snap.items,
      trash: snap.trash,
      expenses: snap.expenses,
      recurringExpenses: snap.recurringExpenses,
      categories: snap.categories,
      categoryFields: snap.categoryFields,
      settings: snap.businessSettings,
      goals: { monthly: snap.monthlyGoal },
      dashboard: snap.dashboardPrefs,
      actionHistory: snap.actionHistory.slice(-ACTION_HISTORY_LIMIT),
      bulkImports: snap.bulkImports.slice(0, BULK_IMPORTS_LIMIT),
    };
    try {
      await writeToCloud(payload);
      hasUnsavedChanges.current = false;
      suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
      setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
      scheduleBackgroundWork(async () => {
        const catalog = buildStoreCatalog(snap.items, snap.categoryFields);
        await writeStoreCatalog(catalog).catch((e) => console.warn('Store catalog update failed', e));
      });
    } catch (err) {
      setSyncState((prev) => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) }));
    } finally {
      cloudSyncInFlightRef.current = false;
      if (pendingCloudFlushRef.current || hasUnsavedChanges.current) {
        pendingCloudFlushRef.current = false;
        if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
        writeDebounceRef.current = setTimeout(() => {
          writeDebounceRef.current = null;
          void runSilentCloudSync();
        }, FAST_CLOUD_FLUSH_MS);
      }
    }
  }, [authUser, getSyncSnapshot]);

  // When remote merge kept local-only bulk history, push so other devices get it.
  useEffect(() => {
    if (!pendingCloudPushAfterRemoteRef.current) return;
    if (!authUser || !isCloudEnabled()) return;
    pendingCloudPushAfterRemoteRef.current = false;
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    writeDebounceRef.current = setTimeout(() => {
      writeDebounceRef.current = null;
      void runSilentCloudSync();
    }, BULK_IMPORT_SYNC_FLUSH_MS);
  }, [bulkImports, authUser, requestFastCloudFlush, runSilentCloudSync]);

  const publishStoreCatalogNow = useCallback(async () => {
    if (!isCloudEnabled() || !authUser) return;
    const snap = getSyncSnapshot();
    await writeStoreCatalog(buildStoreCatalog(snap.items, snap.categoryFields)).catch((e) =>
      console.warn('Store catalog update failed', e)
    );
  }, [authUser, getSyncSnapshot]);

  // 2. Local persistence (debounced, chunked) + silent background Firestore write
  useEffect(() => {
    if (appState !== 'READY') return;
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    if (localPersistDebounceRef.current) clearTimeout(localPersistDebounceRef.current);
    localPersistDebounceRef.current = setTimeout(() => {
      localPersistDebounceRef.current = null;
      const snap = getSyncSnapshot();
      scheduleBackgroundWork(() =>
        persistSnapshotToLocalStorage({
          itemsJson: JSON.stringify(snap.items),
          trashJson: JSON.stringify(snap.trash),
          expensesJson: JSON.stringify(snap.expenses),
          settingsJson: JSON.stringify(snap.businessSettings),
          monthlyGoal: snap.monthlyGoal.toString(),
          categoriesJson: JSON.stringify(snap.categories),
          categoryFieldsJson: JSON.stringify(snap.categoryFields),
          recurringExpensesJson: JSON.stringify(snap.recurringExpenses),
          dashboardPrefs: snap.dashboardPrefs,
          actionHistoryJson: JSON.stringify(snap.actionHistory.slice(-ACTION_HISTORY_LIMIT)),
          bulkImportsJson: JSON.stringify(snap.bulkImports.slice(0, BULK_IMPORTS_LIMIT)),
        })
      );
    }, LOCAL_PERSIST_DEBOUNCE_MS);

    if (!isCloudEnabled() || !authUser) return;
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    const delay = resolveCloudFlushDelay(preferredCloudFlushMsRef.current);
    preferredCloudFlushMsRef.current = WRITE_DEBOUNCE_MS;
    setSyncState((prev) => {
      if (prev.status === 'syncing') return prev;
      if (prev.status === 'error') {
        return { ...prev, status: 'pending', message: SYNC_MSG_RETRYING };
      }
      return {
        ...prev,
        status: 'pending',
        message: SYNC_MSG_PENDING,
      };
    });
    writeDebounceRef.current = setTimeout(() => {
      writeDebounceRef.current = null;
      void runSilentCloudSync();
    }, delay);
    return () => {
      if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
      if (localPersistDebounceRef.current) clearTimeout(localPersistDebounceRef.current);
    };
  }, [appState, authUser, items, trash, expenses, recurringExpenses, businessSettings, monthlyGoal, categories, categoryFields, dashboardPrefs, actionHistory, bulkImports, getSyncSnapshot, runSilentCloudSync]);

  // Flush pending cloud writes when leaving the tab / unloading so other devices see changes sooner.
  useEffect(() => {
    if (!isCloudEnabled()) return;
    const flushNow = () => {
      if (!hasUnsavedChanges.current && !pendingCloudFlushRef.current) return;
      if (writeDebounceRef.current) {
        clearTimeout(writeDebounceRef.current);
        writeDebounceRef.current = null;
      }
      void runSilentCloudSync();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runSilentCloudSync]);

  // Action history can be large — persist separately so item edits don't always stringify it with inventory.
  useEffect(() => {
    if (appState !== 'READY') return;
    const t = setTimeout(() => {
      const ah = actionHistoryRef.current.slice(-ACTION_HISTORY_LIMIT);
      scheduleBackgroundWork(() => {
        localStorage.setItem('action_history', JSON.stringify(ah));
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [appState, actionHistory]);

  useEffect(() => {
    if (appState !== 'READY') return;
    const t = setTimeout(() => {
      const bi = bulkImportsRef.current.slice(0, BULK_IMPORTS_LIMIT);
      scheduleBackgroundWork(() => {
        localStorage.setItem('bulk_imports', JSON.stringify(bi));
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [appState, bulkImports]);

  const handleForcePush = async () => {
    if (!isCloudEnabled() || !authUser) return false;
    setSyncState(prev => ({ ...prev, status: 'syncing', message: SYNC_MSG_UPLOADING }));
    const payload = {
      inventory: items,
      trash,
      expenses,
      recurringExpenses,
      categories,
      categoryFields,
      settings: businessSettings,
      goals: { monthly: monthlyGoal },
      dashboard: dashboardPrefs,
      actionHistory: actionHistory.slice(-ACTION_HISTORY_LIMIT),
      bulkImports: bulkImports.slice(0, BULK_IMPORTS_LIMIT),
    };
    try {
      cloudSyncInFlightRef.current = true;
      await writeToCloud(payload);
      hasUnsavedChanges.current = false;
      suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
      scheduleBackgroundWork(() =>
        persistSnapshotToLocalStorage({
          itemsJson: JSON.stringify(items),
          trashJson: JSON.stringify(trash),
          expensesJson: JSON.stringify(expenses),
          settingsJson: JSON.stringify(businessSettings),
          monthlyGoal: monthlyGoal.toString(),
          categoriesJson: JSON.stringify(categories),
          categoryFieldsJson: JSON.stringify(categoryFields),
          recurringExpensesJson: JSON.stringify(recurringExpenses),
          dashboardPrefs: dashboardPrefsRef.current,
          actionHistoryJson: JSON.stringify(actionHistory.slice(-ACTION_HISTORY_LIMIT)),
          bulkImportsJson: JSON.stringify(bulkImports.slice(0, BULK_IMPORTS_LIMIT)),
        })
      );
      scheduleBackgroundWork(async () => {
        await writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) => console.warn('Store catalog update failed', e));
      });
      setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
      return true;
    } catch (err) {
      setSyncState(prev => ({ ...prev, status: 'error', lastSynced: null, message: getSyncErrorMessage(err) }));
      return false;
    } finally {
      cloudSyncInFlightRef.current = false;
    }
  };

  // ... Data Modifiers ...
  const [history, setHistory] = useState<InventoryItem[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const addActionEntries = useCallback((entries: ActionHistoryEntry[]) => {
    if (!entries.length) return;
    setActionHistory((prev) => [...prev, ...entries].slice(-ACTION_HISTORY_LIMIT));
  }, []);
  
  const handleUpdate = useCallback((updatedItems: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => {
    const recordAction = !options?.skipActionLog;
    const recordUndo = !options?.skipUndo;
    const disposed = (s: ItemStatus | undefined) =>
      s === ItemStatus.SOLD || s === ItemStatus.TRADED || s === ItemStatus.GIFTED;
    const current = itemsRef.current;
    let createdContainers = false;
    let statusTransition = false;
    for (const u of updatedItems) {
      const oldItem = current.find((i) => i.id === u.id);
      if (!oldItem && (u.isPC || u.isBundle)) createdContainers = true;
      if (oldItem && oldItem.status !== u.status && (disposed(u.status) || disposed(oldItem.status))) {
        statusTransition = true;
      }
    }
    if (
      shouldFlushCloudSoon({
        flushCloud: options?.flushCloud,
        deleteIds,
        createdContainers,
        statusTransition,
      })
    ) {
      requestFastCloudFlush();
    }
    setItems(currentItems => {
        let nextItems = [...currentItems];
        const actionEntries: ActionHistoryEntry[] = [];
        updatedItems.forEach(u => {
          const idx = nextItems.findIndex(i => i.id === u.id);
          const oldItem = idx >= 0 ? nextItems[idx] : undefined;
          const merged = appendPriceHistoryIfChanged(oldItem, u);
          // Preserve store and other fields from old item when update doesn't provide them (e.g. rename in inventory form)
          let final = merged;
          if (oldItem && idx >= 0) {
            final = { ...merged } as InventoryItem;
            for (const k of PRESERVE_FROM_OLD_IF_UPDATE_MISSING) {
              const oldVal = (oldItem as Record<string, unknown>)[k as string];
              const newVal = (merged as Record<string, unknown>)[k as string];
              if (oldVal !== undefined && oldVal !== null && (newVal === undefined || newVal === null))
                (final as Record<string, unknown>)[k as string] = oldVal;
            }
          }
          const taxMode = businessSettings.taxMode || 'SmallBusiness';
          final = recomputeRealizedProfit(final, taxMode);
          if (final.status === ItemStatus.SOLD || final.status === ItemStatus.TRADED || final.status === ItemStatus.GIFTED) {
            final = { ...final, storeVisible: false };
          }
          if (idx >= 0) {
            nextItems[idx] = final;
            if (recordAction) {
              if (oldItem?.status !== final.status) {
                actionEntries.push(makeActionEntry(`Status changed: ${oldItem?.status || '-'} -> ${final.status}`, final));
              } else {
                actionEntries.push(makeActionEntry('Item updated', final));
              }
            }
          } else {
            nextItems.push(final);
            if (recordAction) actionEntries.push(makeActionEntry('Item created', final));
          }
        });
        
        if (deleteIds && deleteIds.length > 0) {
           const toTrash = nextItems.filter(i => deleteIds.includes(i.id));
           if (toTrash.length > 0) {
              setTrash(prev => [...prev, ...toTrash]);
              if (recordAction) toTrash.forEach((i) => actionEntries.push(makeActionEntry('Item moved to trash', i)));
           }
           nextItems = nextItems.filter(i => !deleteIds.includes(i.id));
        }
        const actionEntriesMerged = recordAction ? mergeTradeActionEntries(actionEntries, updatedItems) : [];
        const touchedIds = [
          ...updatedItems.map((u) => u.id),
          ...(deleteIds ?? []),
        ];
        if (!options?.skipContainerSync) {
          nextItems = syncContainerBuyTotalsFromComponents(nextItems, touchedIds);
        }
        if (recordUndo) {
          let nextIdx = historyIndexRef.current;
          setHistory((prev) => {
            const { base, nextIdx: idx } = appendUndoHistory(prev, historyIndexRef.current, currentItems, nextItems);
            nextIdx = idx;
            return base;
          });
          historyIndexRef.current = nextIdx;
          setHistoryIndex(nextIdx);
        }
        hasUnsavedChanges.current = true;
        if (actionEntriesMerged.length > 0) addActionEntries(actionEntriesMerged);
        return nextItems;
    });
  }, [addActionEntries, businessSettings.taxMode, requestFastCloudFlush]);

  const handleImportBatch = useCallback((newItems: InventoryItem[], replace: boolean) => {
    if (replace) {
       requestFastCloudFlush();
       setItems(newItems);
       hasUnsavedChanges.current = true;
    } else {
       handleUpdate(newItems, undefined, { flushCloud: true });
    }
  }, [handleUpdate, requestFastCloudFlush]);

  const showUndoRef = useRef<(msg: string, onUndo: () => void) => void>(() => {});
  const handleDelete = useCallback((id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    handleUpdate([], [id]);
    showUndoRef.current('Moved to trash', () => {
      setTrash((prev) => prev.filter((i) => i.id !== id));
      handleUpdate([item], undefined, { skipActionLog: true, skipUndo: true });
    });
  }, [items, handleUpdate]);
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      setItems(history[newIndex]);
      addActionEntries([makeActionEntry('Undo action')]);
    }
  };
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      setItems(history[newIndex]);
      addActionEntries([makeActionEntry('Redo action')]);
    }
  };
  const handleAddExpense = (expense: Expense) => {
    setExpenses(prev => [...prev, expense]);
    addActionEntries([makeActionEntry('Expense added', undefined, `${expense.description} (€${expense.amount})`)]);
  };
  const handleUpdateExpense = (expense: Expense) => {
    setExpenses(prev => prev.map(e => (e.id === expense.id ? expense : e)));
    addActionEntries([makeActionEntry('Expense updated', undefined, `${expense.description} (€${expense.amount})`)]);
  };
  const handleDeleteExpense = (id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
    addActionEntries([makeActionEntry('Expense deleted', undefined, id)]);
  };
  
  const handleAddRecurringExpense = (recurring: RecurringExpense) => {
    setRecurringExpenses(prev => [...prev, recurring]);
    addActionEntries([makeActionEntry('Recurring expense added', undefined, recurring.description)]);
  };
  const handleDeleteRecurringExpense = (id: string) => {
    setRecurringExpenses(prev => prev.filter(r => r.id !== id));
    // Also delete all generated expenses from this recurring expense
    setExpenses(prev => prev.filter(e => e.recurringExpenseId !== id));
    addActionEntries([makeActionEntry('Recurring expense deleted', undefined, id)]);
  };
  const handleUpdateRecurringExpense = (recurring: RecurringExpense) => {
    setRecurringExpenses(prev => prev.map(r => r.id === recurring.id ? recurring : r));
    addActionEntries([makeActionEntry('Recurring expense updated', undefined, recurring.description)]);
  };
  
  const handleWipeData = async () => {
    const emptyInventory: InventoryItem[] = [];
    const emptyExpenses: Expense[] = [];
    const emptyTrash: InventoryItem[] = [];
    const emptyRecurring: RecurringExpense[] = [];
    const defaultGoal = 1000;

    setItems(emptyInventory);
    setExpenses(emptyExpenses);
    setTrash(emptyTrash);
    setRecurringExpenses(emptyRecurring);
    setHistory([]);
    setHistoryIndex(-1);
    setMonthlyGoal(defaultGoal);
    const wipedDash = getDefaultDashboardPreferences();
    setDashboardPrefs(wipedDash);

    localStorage.removeItem('price_check_history');
    localStorage.removeItem('ai_sourcing_history');
    localStorage.removeItem('action_history');
    localStorage.removeItem('bulk_imports');
    localStorage.removeItem(BULK_IMPORT_BACKFILL_KEY);
    localStorage.removeItem(CONTAINER_BUY_DATE_BACKFILL_KEY);
    setActionHistory([]);
    setBulkImports([]);
    bulkImportsRef.current = [];

    saveToLocalStorage(emptyInventory, emptyTrash, emptyExpenses, businessSettings, defaultGoal, categories, categoryFields, emptyRecurring, wipedDash);

    if (isCloudEnabled() && authUser) {
      try {
        await writeToCloud({
          inventory: emptyInventory,
          recurringExpenses: emptyRecurring,
          trash: emptyTrash,
          expenses: emptyExpenses,
          settings: businessSettings,
          goals: { monthly: defaultGoal },
          categories,
          categoryFields,
          dashboard: wipedDash,
          actionHistory: [],
          bulkImports: [],
        });
        await writeStoreCatalog(buildStoreCatalog(emptyInventory, categoryFields)).catch(() => {});
      } catch (_) {}
    }

    setRefreshKey(prev => prev + 1);
  };

  const handleRestoreFromTrash = (ids: string[]) => {
    const toRestore = trash.filter(i => ids.includes(i.id));
    setTrash(prev => prev.filter(i => !ids.includes(i.id)));
    setItems(prev => [...prev, ...toRestore]);
  };
  const handlePermanentDelete = (ids: string[]) => { setTrash(prev => prev.filter(i => !ids.includes(i.id))); };

  const handleRestoreBackup = useCallback(async (data: {
    inventory?: InventoryItem[];
    trash?: InventoryItem[];
    expenses?: Expense[];
    settings?: BusinessSettings;
    goals?: { monthly?: number };
    categories?: Record<string, string[]>;
    categoryFields?: Record<string, string[]>;
    dashboard?: unknown;
    actionHistory?: ActionHistoryEntry[];
    bulkImports?: BulkImportRecord[];
  }) => {
    const inv = Array.isArray(data.inventory) ? data.inventory : (Array.isArray((data as any).Inventory) ? (data as any).Inventory : []);
    const tr = Array.isArray(data.trash) ? data.trash : [];
    const exp = Array.isArray(data.expenses) ? data.expenses : [];
    const goal = data.goals?.monthly ?? monthlyGoal;
    const cats = data.categories && typeof data.categories === 'object' ? data.categories : categories;
    const fields = data.categoryFields && typeof data.categoryFields === 'object' ? data.categoryFields : categoryFields;
    const sets = data.settings && typeof data.settings === 'object' ? { ...businessSettings, ...data.settings } : businessSettings;
    const restoredDash =
      data.dashboard != null ? normalizeDashboardPreferences(data.dashboard) : dashboardPrefsRef.current;
    if (data.dashboard != null) setDashboardPrefs(restoredDash);
    const localAH = JSON.parse(localStorage.getItem('action_history') || '[]') as ActionHistoryEntry[];
    const backupAH = Array.isArray(data.actionHistory) ? data.actionHistory : [];
    const mergedAH = mergeActionHistoryFromLocal(backupAH, localAH).slice(-ACTION_HISTORY_LIMIT);
    setActionHistory(mergedAH);
    actionHistoryRef.current = mergedAH;
    const localBI = loadBulkImportsFromStorage();
    const backupBI = Array.isArray(data.bulkImports) ? data.bulkImports : [];
    const mergedBI = mergeBulkImportsFromLocal(backupBI, localBI).slice(0, BULK_IMPORTS_LIMIT);
    setBulkImports(mergedBI);
    bulkImportsRef.current = mergedBI;
    isRemoteUpdate.current = true;
    setItems(inv);
    setTrash(tr);
    setExpenses(exp);
    setMonthlyGoal(goal);
    setCategories(cats);
    setCategoryFields(fields);
    setBusinessSettings(sets);
    saveToLocalStorage(inv, tr, exp, sets, goal, cats, fields, undefined, restoredDash, mergedAH, mergedBI);
    if (isCloudEnabled() && authUser) {
      try {
        await writeToCloud({
          inventory: inv,
          trash: tr,
          expenses: exp,
          settings: sets,
          goals: { monthly: goal },
          categories: cats,
          categoryFields: fields,
          dashboard: restoredDash,
          actionHistory: mergedAH,
          bulkImports: mergedBI,
        });
        await writeStoreCatalog(buildStoreCatalog(inv, fields)).catch(() => {});
      } catch (_) {}
    }
    setRefreshKey((k) => k + 1);
  }, [monthlyGoal, categories, categoryFields, businessSettings, authUser, dashboardPrefs, mergeActionHistoryFromLocal]);

  const handleFixEncoding = useCallback((fixedItems: InventoryItem[], fixedTrash: InventoryItem[]) => {
    setItems(fixedItems);
    setTrash(fixedTrash);
    saveToLocalStorage(fixedItems, fixedTrash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
    if (isCloudEnabled() && authUser) {
      writeToCloud({
        inventory: fixedItems,
        trash: fixedTrash,
        expenses,
        settings: businessSettings,
        goals: { monthly: monthlyGoal },
        categories,
        categoryFields,
        dashboard: dashboardPrefs,
        actionHistory: actionHistoryRef.current.slice(-ACTION_HISTORY_LIMIT),
        bulkImports: bulkImportsRef.current.slice(0, BULK_IMPORTS_LIMIT),
      }).catch(() => {});
    }
    setRefreshKey((k) => k + 1);
  }, [expenses, businessSettings, monthlyGoal, categories, categoryFields, authUser, dashboardPrefs]);

  const handleClearActionHistory = useCallback(() => {
    setActionHistory([]);
    localStorage.removeItem('action_history');
  }, []);

  const handleBulkImportComplete = useCallback((record: BulkImportRecord) => {
    setBulkImports((prev) => {
      const next = mergeBulkImportsFromLocal(prev, [record]).slice(0, BULK_IMPORTS_LIMIT);
      bulkImportsRef.current = next;
      localStorage.setItem('bulk_imports', JSON.stringify(next));
      return next;
    });
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [requestFastCloudFlush]);

  const handleRevertSale = useCallback(
    (entry: ActionHistoryEntry) => {
      if (!entry.itemId || !entry.action.includes('Sold')) return;
      const item = items.find((i) => i.id === entry.itemId);
      if (!item || item.status !== ItemStatus.SOLD) {
        alert('Item is not sold anymore or was removed.');
        return;
      }
      if (!window.confirm(`Revert sale for "${item.name}"? Item returns to In Stock; sale data is cleared.`)) return;
      const nextItems = applySaleRevert(items, entry.itemId);
      const updated = nextItems.find((i) => i.id === entry.itemId);
      if (updated) handleUpdate([updated], undefined, { skipActionLog: true });
      addActionEntries([makeActionEntry('Sale reverted', item, 'Restored to In Stock from action history.')]);
    },
    [items, handleUpdate, addActionEntries]
  );

  const handleRevertTrade = useCallback(
    (entry: ActionHistoryEntry) => {
      if (entry.action !== 'Trade completed' || !entry.itemId) return;
      const outgoing = items.find((i) => i.id === entry.itemId);
      const receivedLabel =
        (entry.tradeReceivedIds ?? [])
          .map((id) => items.find((x) => x.id === id)?.name)
          .filter(Boolean)
          .join(', ') || 'linked received items';
      const msg =
        `Revert this trade?\n\n"${outgoing?.name ?? entry.itemName ?? 'Outgoing item'}" will return to In Stock. ` +
        `Received items (${receivedLabel}) will be removed from inventory. Any cash recorded on the trade will be cleared.`;
      if (!window.confirm(msg)) return;

      setItems((currentItems) => {
        const res = applyTradeRevert(
          currentItems,
          entry.itemId!,
          entry.tradeReceivedIds,
          businessSettings.taxMode || 'SmallBusiness'
        );
        if (!res.ok) {
          alert(res.message);
          return currentItems;
        }
        const nextItems = syncContainerBuyTotalsFromComponents(res.nextItems, [
          entry.itemId!,
          ...(entry.tradeReceivedIds ?? []),
          ...res.removedIds,
        ]);

        setTrash((prev) => prev.filter((t) => !res.removedIds.includes(t.id)));

        setActionHistory((prev) =>
          [
            ...prev.filter((e) => e.id !== entry.id),
            makeActionEntry(
              'Trade reverted',
              res.outgoingRestored,
              `${res.removedIds.length} received item(s) removed; outgoing restored to In Stock.`
            ),
          ].slice(-ACTION_HISTORY_LIMIT)
        );

        let nextIdx = historyIndexRef.current;
        setHistory((prev) => {
          const { base, nextIdx: idx } = appendUndoHistory(prev, historyIndexRef.current, currentItems, nextItems);
          nextIdx = idx;
          return base;
        });
        historyIndexRef.current = nextIdx;
        setHistoryIndex(nextIdx);
        hasUnsavedChanges.current = true;
        return nextItems;
      });
    },
    [items, businessSettings.taxMode]
  );

  const isConfigured = isCloudEnabled();
  const isAdminUser = authUser?.email === 'abelyanarmen@gmail.com';

  if (appState === 'BOOTING') {
     return (
        <div className="flex h-screen w-screen bg-slate-900 text-white items-center justify-center flex-col space-y-6 animate-in fade-in">
           <div className="relative">
              <Loader2 size={64} className="animate-spin text-blue-500" />
              <div className="absolute inset-0 flex items-center justify-center">
                 <Cloud size={24} className="text-white"/>
              </div>
           </div>
           <div className="text-center space-y-2">
              <h2 className="text-2xl font-black tracking-tight">DeInventory</h2>
              <p className="text-slate-400 font-medium">Connecting to Firestore…</p>
           </div>
        </div>
     );
  }

  // Error UI
  if (appState === 'ERROR_SYNC') {
     return (
        <div className="flex h-screen w-screen bg-slate-50 text-slate-900 items-center justify-center flex-col space-y-8 animate-in zoom-in-95 p-4">
           <div className="w-24 h-24 bg-red-100 text-red-500 rounded-full flex items-center justify-center shadow-xl">
              <WifiOff size={48}/>
           </div>
           <div className="text-center max-w-md space-y-3">
              <h2 className="text-3xl font-black tracking-tight">Sync Failed</h2>
              <p className="text-slate-500 font-medium">Could not download inventory. Check internet.</p>
              {bootError && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs font-mono border border-red-100">{bootError}</div>}
           </div>
           <div className="flex gap-4 w-full max-w-sm">
              <button onClick={() => setAppState('READY')} className="flex-1 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-50 transition-all shadow-sm">
                 Work Offline
              </button>
              <button onClick={() => window.location.reload()} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-black transition-all shadow-xl">
                 Retry Sync
              </button>
           </div>
        </div>
     );
  }

  const ALL_STATUSES = [
    ItemStatus.IN_STOCK, 
    ItemStatus.SOLD, 
    ItemStatus.TRADED,
    ItemStatus.GIFTED,
    ItemStatus.ORDERED,
    ItemStatus.IN_COMPOSITION
  ];

  return (
    <Router>
      <Analytics />
      <UndoToastProvider>
      <UndoToastBridge showUndoRef={showUndoRef} />
      <PanelLocaleProvider>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
              <StorefrontPage />
            </Suspense>
          }
        />
        <Route
          path="/item/:id"
          element={
            <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
              <StorefrontPage />
            </Suspense>
          }
        />
        <Route path="/upload/:token" element={<PhonePhotoUploadPage />} />
        <Route path="/impressum" element={<LegalPage />} />
        <Route path="/datenschutz" element={<LegalPage />} />
        <Route path="/agb" element={<LegalPage />} />
        <Route
          path="/panel"
          element={
            <PanelLayout
              isCloudEnabled={isConfigured}
              authUser={authUser}
              authReady={authReady}
              isAdmin={isAdminUser}
              syncState={syncState}
              onForcePush={handleForcePush}
              backupBannerDismissed={backupBannerDismissed}
              onDismissBackupBanner={() => {
                localStorage.setItem('cloud_backup_banner_dismissed', '1');
                setBackupBannerDismissed(true);
              }}
              items={items}
              expenses={expenses}
              businessSettings={businessSettings}
              onUpdateItems={handleUpdate}
            />
          }
        >
          <Route index element={<Navigate to="/panel/dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              <Dashboard
                items={items}
                expenses={expenses}
                monthlyGoal={monthlyGoal}
                onGoalChange={setMonthlyGoal}
                businessSettings={businessSettings}
                categoryFields={categoryFields}
                dashboardPreferences={dashboardPrefs}
                onDashboardPreferencesChange={setDashboardPrefs}
                onUpdateItems={handleUpdate}
              />
            }
          />
          <Route path="inventory" element={<InventoryList key="inventory-main" items={items} totalCount={items.length} onUpdate={handleUpdate} onDelete={handleDelete} onUndo={handleUndo} onRedo={handleRedo} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1} pageTitle="Inventory" allowedStatuses={ALL_STATUSES} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} persistenceKey="inventory_main" onPublishStoreCatalog={publishStoreCatalogNow} bulkImports={bulkImports} />} />
          <Route path="flip-coach" element={<FlipCoachPage items={items} />} />
          <Route path="sold-pulse" element={<SoldPulsePage items={items} />} />
          <Route path="add" element={<ItemForm onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="add-bulk" element={<BulkItemForm onSave={handleUpdate} onBulkImportComplete={handleBulkImportComplete} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="edit/:id" element={<EditItemRoute onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="builder" element={<BuilderEntry items={items} onSave={handleUpdate} />} />
          <Route path="3d-print" element={<ThreeDPrintPage items={items} onSave={handleUpdate} categories={categories} onAddExpense={handleAddExpense} />} />
          <Route path="ebay-store-pull" element={<EbayStorePullPage items={items} categories={categories} categoryFields={categoryFields} taxMode={businessSettings.taxMode} onUpdate={handleUpdate} onPublishCatalog={publishStoreCatalogNow} onAddExpense={handleAddExpense} />} />
          <Route
            path="card-gallery"
            element={<ProductCardGalleryPage items={items} onUpdate={handleUpdate} />}
          />
          <Route
            path="bulk-imports"
            element={<BulkImportHistoryPage records={bulkImports} items={items} />}
          />
          <Route path="invoices" element={<InvoiceManager items={items} businessSettings={businessSettings} />} />
          <Route
            path="action-history"
            element={
              <ActionHistoryPage
                entries={actionHistory}
                items={items}
                onClear={handleClearActionHistory}
                onRevertTrade={handleRevertTrade}
                onRevertSale={handleRevertSale}
              />
            }
          />
          <Route
            path="expenses"
            element={
              <ExpenseManager
                expenses={expenses}
                recurringExpenses={recurringExpenses}
                onAddExpense={handleAddExpense}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onAddRecurringExpense={handleAddRecurringExpense}
                onDeleteRecurringExpense={handleDeleteRecurringExpense}
                onUpdateRecurringExpense={handleUpdateRecurringExpense}
              />
            }
          />
          <Route path="import" element={<SheetsImport onImport={handleImportBatch} onClearData={handleWipeData} />} />
          <Route path="trash" element={<TrashPage items={trash} onRestore={handleRestoreFromTrash} onPermanentDelete={handlePermanentDelete} />} />
          <Route path="store-management" element={<StoreManagementPage items={items} categories={categories} categoryFields={categoryFields} onUpdate={handleUpdate} onPublishCatalog={publishStoreCatalogNow} />} />
          <Route path="storefront-configurator" element={<StorefrontConfiguratorPage />} />
          <Route path="settings" element={<SettingsPage items={items} trash={trash} expenses={expenses} monthlyGoal={monthlyGoal} dashboardPreferences={dashboardPrefs} actionHistory={actionHistory} bulkImports={bulkImports} onForcePush={handleForcePush} onRestoreItems={setItems} onRestoreBackup={handleRestoreBackup} onFixEncoding={handleFixEncoding} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} onUpdateCategoryStructure={handleUpdateCategoryStructure} onUpdateCategoryFields={handleUpdateCategoryFields} onRenameCategory={() => {}} onRenameSubCategory={() => {}} onApplyArchivedPhotos={(archivedItems, archivedTrash) => { setItems(archivedItems); setTrash(archivedTrash); }} />} />
        </Route>
        <Route path="/auth/github/callback" element={<GitHubOAuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </PanelLocaleProvider>
      </UndoToastProvider>
    </Router>
  );
};

function UndoToastBridge({ showUndoRef }: { showUndoRef: React.MutableRefObject<(msg: string, onUndo: () => void) => void> }) {
  const { showUndo } = useUndoToastContext();
  useEffect(() => {
    showUndoRef.current = showUndo;
  }, [showUndo, showUndoRef]);
  return null;
}

export default App;
