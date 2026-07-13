import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { Cloud, CheckCircle2, Loader2, WifiOff, RefreshCw, X } from 'lucide-react';

import StorefrontPage from './components/StorefrontPage';
import PanelLayout from './components/PanelLayout';
import QuotaMonitor from './components/QuotaMonitor';

const Dashboard = lazy(() => import('./components/Dashboard'));
const InventoryList = lazy(() => import('./components/InventoryList'));
const ItemForm = lazy(() => import('./components/ItemForm'));
const BulkItemForm = lazy(() => import('./components/BulkItemForm'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const SheetsImport = lazy(() => import('./components/SheetsImport'));
const ExpenseManager = lazy(() => import('./components/ExpenseManager'));
const TrashPage = lazy(() => import('./components/TrashPage'));
const PCBuilderWizard = lazy(() => import('./components/PCBuilderWizard'));
const StoreManagementPage = lazy(() => import('./components/StoreManagementPage'));
const StorefrontConfiguratorPage = lazy(() => import('./components/StorefrontConfiguratorPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const InvoiceManager = lazy(() => import('./components/InvoiceManager'));
const ActionHistoryPage = lazy(() => import('./components/ActionHistoryPage'));
const EbayStorePullPage = lazy(() => import('./components/EbayStorePullPage'));
const ThreeDPrintPage = lazy(() => import('./components/ThreeDPrintPage'));
const ProductCardStudioPage = lazy(() => import('./components/ProductCardStudioPage'));

import { InventoryItem, Expense, ItemStatus, BusinessSettings, RecurringExpense, DashboardPreferences, ActionHistoryEntry, TaxMode, ItemUpdateOptions } from './types';
import {
  loadDashboardPreferencesFromLocalStorage,
  persistDashboardPreferencesToLocalStorage,
  normalizeDashboardPreferences,
  getDefaultDashboardPreferences,
} from './services/dashboardPreferences';
import { isCloudEnabled, onAuthChange, subscribeToData, writeToCloud, writeStoreCatalog, getSyncErrorMessage, CLOUD_OMITTED_PLACEHOLDER, fetchFromCloud } from './services/firebaseService';
import { pullOrderIndexFromCloud } from './services/ebayOrderIndex';
import { DEFAULT_CATEGORIES } from './services/constants';
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
import { buildStoreCatalog } from './utils/storefrontCatalog';

const WRITE_DEBOUNCE_MS = 5000;
const LOCAL_PERSIST_DEBOUNCE_MS = 900;
const STORE_CATALOG_DEBOUNCE_MS = 1500;
const REMOTE_APPLY_SUPPRESS_MS = 1500;
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
};

/** When merging an update into an existing item, preserve these from the old item if the update
 * doesn't provide them (so renames/edits from inventory don't wipe store data). Deliberately
 * excludes sellPrice/storePrice — those are actively user-editable numeric fields with real
 * "clear to remove" semantics (e.g. clearing a price in the inline table editor); restoring the
 * old value whenever the new one is undefined made it impossible to ever actually clear them. */
const PRESERVE_FROM_OLD_IF_UPDATE_MISSING: (keyof InventoryItem)[] = [
  'imageUrl', 'imageUrls', 'storeGalleryUrls', 'storeDescription', 'storeVisible', 'storeOnSale', 'storeSalePrice',
  'specs', 'componentIds', 'comment1', 'comment2', 'vendor', 'hasOVP', 'hasIOShield',
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
  status: 'idle' | 'syncing' | 'success' | 'error';
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
  const [trash, setTrash] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  
  // Dynamic Categories
  const [categories, setCategories] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem('custom_categories');
    return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
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
  useEffect(() => {
    dashboardPrefsRef.current = dashboardPrefs;
  }, [dashboardPrefs]);
  useEffect(() => {
    actionHistoryRef.current = actionHistory;
  }, [actionHistory]);

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
  const writeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localPersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }), []);

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
    actionHistorySnapshot?: ActionHistoryEntry[]
  ) => {
    const dash = dashOverride ?? dashboardPrefsRef.current;
    const ah = (actionHistorySnapshot ?? actionHistoryRef.current).slice(-ACTION_HISTORY_LIMIT);
    actionHistoryRef.current = ah;
    localStorage.setItem('action_history', JSON.stringify(ah));
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
        byId.set(r.id, applyLargeFieldPlaceholders(local, r));
        return;
      }

      let merged: InventoryItem = r;
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
      merged = changed ? out : r;
      byId.set(r.id, merged);
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
    setItems(inv);
    setTrash(tr);
    setExpenses(exp);
    setRecurringExpenses(recurring);
    setBusinessSettings(prev => ({ ...prev, ...sets }));
    setMonthlyGoal(goal);
    setCategories(cats);
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
      })
    );
  }, [mergeActionHistoryFromLocal, mergeExpensesFromLocal, mergeInventoryWithLocal]);

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
        setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
      });
    });
    return () => {
      if (unsubSnapshot) unsubSnapshot();
      if (unsubAuth) unsubAuth();
    };
  }, [applyRemoteData, shouldApplyRemoteSnapshot]);

  const loadLocalData = () => {
    const localItems = JSON.parse(localStorage.getItem('inventory_items') || '[]');
    setItems(localItems);
    setTrash(JSON.parse(localStorage.getItem('inventory_trash') || '[]'));
    setExpenses(JSON.parse(localStorage.getItem('inventory_expenses') || '[]'));
    setRecurringExpenses(JSON.parse(localStorage.getItem('recurring_expenses') || '[]'));
  };

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
          setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
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
        };
        await writeToCloud(payload);
        hasUnsavedChanges.current = false;
        suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
        setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
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
  }, [authUser, items, trash, expenses, recurringExpenses, categories, categoryFields, businessSettings, monthlyGoal, dashboardPrefs, actionHistory, applyRemoteData]);

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
    if (!isCloudEnabled() || !authUser || cloudSyncInFlightRef.current) return;
    const snap = getSyncSnapshot();
    cloudSyncInFlightRef.current = true;
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
    };
    try {
      await writeToCloud(payload);
      hasUnsavedChanges.current = false;
      suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
      setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
      scheduleBackgroundWork(async () => {
        const catalog = buildStoreCatalog(snap.items, snap.categoryFields);
        await writeStoreCatalog(catalog).catch((e) => console.warn('Store catalog update failed', e));
      });
    } catch (err) {
      setSyncState((prev) => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) }));
    } finally {
      cloudSyncInFlightRef.current = false;
    }
  }, [authUser, getSyncSnapshot]);

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
        })
      );
    }, LOCAL_PERSIST_DEBOUNCE_MS);

    if (!isCloudEnabled() || !authUser) return;
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    writeDebounceRef.current = setTimeout(() => {
      writeDebounceRef.current = null;
      void runSilentCloudSync();
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
      if (localPersistDebounceRef.current) clearTimeout(localPersistDebounceRef.current);
    };
  }, [appState, authUser, items, trash, expenses, recurringExpenses, businessSettings, monthlyGoal, categories, categoryFields, dashboardPrefs, getSyncSnapshot, runSilentCloudSync]);

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

  const handleForcePush = async () => {
    if (!isCloudEnabled() || !authUser) return false;
    setSyncState(prev => ({ ...prev, status: 'syncing', message: 'Saving…' }));
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
        })
      );
      scheduleBackgroundWork(async () => {
        await writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) => console.warn('Store catalog update failed', e));
      });
      setSyncState({ status: 'success', lastSynced: new Date(), message: 'Saved' });
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
  }, [addActionEntries, businessSettings.taxMode]);

  const handleImportBatch = useCallback((newItems: InventoryItem[], replace: boolean) => {
    if (replace) {
       setItems(newItems);
       hasUnsavedChanges.current = true;
    } else {
       handleUpdate(newItems);
    }
  }, [handleUpdate]);

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
    setActionHistory([]);

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
    isRemoteUpdate.current = true;
    setItems(inv);
    setTrash(tr);
    setExpenses(exp);
    setMonthlyGoal(goal);
    setCategories(cats);
    setCategoryFields(fields);
    setBusinessSettings(sets);
    saveToLocalStorage(inv, tr, exp, sets, goal, cats, fields, undefined, restoredDash, mergedAH);
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
      }).catch(() => {});
    }
    setRefreshKey((k) => k + 1);
  }, [expenses, businessSettings, monthlyGoal, categories, categoryFields, authUser, dashboardPrefs]);

  const handleClearActionHistory = useCallback(() => {
    setActionHistory([]);
    localStorage.removeItem('action_history');
  }, []);

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
        <Route path="/" element={<StorefrontPage />} />
        <Route path="/item/:id" element={<StorefrontPage />} />
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
          <Route path="inventory" element={<InventoryList key="inventory-main" items={items} totalCount={items.length} onUpdate={handleUpdate} onDelete={handleDelete} onUndo={handleUndo} onRedo={handleRedo} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1} pageTitle="Inventory" allowedStatuses={ALL_STATUSES} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} persistenceKey="inventory_main" onPublishStoreCatalog={publishStoreCatalogNow} />} />
          <Route path="add" element={<ItemForm onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="add-bulk" element={<BulkItemForm onSave={handleUpdate} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="edit/:id" element={<ItemForm onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="builder" element={<PCBuilderWizard items={items} onSave={handleUpdate} />} />
          <Route path="3d-print" element={<ThreeDPrintPage items={items} onSave={handleUpdate} categories={categories} onAddExpense={handleAddExpense} />} />
          <Route path="ebay-store-pull" element={<EbayStorePullPage items={items} categories={categories} categoryFields={categoryFields} taxMode={businessSettings.taxMode} onUpdate={handleUpdate} onPublishCatalog={publishStoreCatalogNow} onAddExpense={handleAddExpense} />} />
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
          <Route
            path="product-card-generator"
            element={
              <ProductCardStudioPage
                items={items}
                onUpdate={handleUpdate}
                categoryFields={categoryFields}
              />
            }
          />
          <Route path="settings" element={<SettingsPage items={items} trash={trash} expenses={expenses} monthlyGoal={monthlyGoal} dashboardPreferences={dashboardPrefs} actionHistory={actionHistory} onForcePush={handleForcePush} onRestoreItems={setItems} onRestoreBackup={handleRestoreBackup} onFixEncoding={handleFixEncoding} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} onUpdateCategoryStructure={handleUpdateCategoryStructure} onUpdateCategoryFields={handleUpdateCategoryFields} onRenameCategory={() => {}} onRenameSubCategory={() => {}} onApplyArchivedPhotos={(archivedItems, archivedTrash) => { setItems(archivedItems); setTrash(archivedTrash); }} />} />
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
