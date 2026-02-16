import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { Cloud, CheckCircle2, Loader2, WifiOff, RefreshCw, X } from 'lucide-react';

import StorefrontPage from './components/StorefrontPage';
import PanelLayout from './components/PanelLayout';
import Dashboard from './components/Dashboard';
import CategoryAnalytics from './components/CategoryAnalytics';
import CategorySuggestionsPage from './components/CategorySuggestionsPage';
import InventoryList from './components/InventoryList';
import ItemForm from './components/ItemForm';
import BulkItemForm from './components/BulkItemForm';
import SettingsPage from './components/SettingsPage';
import SheetsImport from './components/SheetsImport';
import ExpenseManager from './components/ExpenseManager';
import TrashPage from './components/TrashPage';
import PCBuilderWizard from './components/PCBuilderWizard';
import PriceCheck from './components/PriceCheck';
import QuotaMonitor from './components/QuotaMonitor';
import StoreManagementPage from './components/StoreManagementPage';
import LegalPage from './components/LegalPage';

import { InventoryItem, Expense, ItemStatus, BusinessSettings } from './types';
import { isCloudEnabled, onAuthChange, subscribeToData, writeToCloud, writeStoreCatalog, getSyncErrorMessage, CLOUD_OMITTED_PLACEHOLDER, fetchFromCloud } from './services/firebaseService';
import { DEFAULT_CATEGORIES } from './services/constants';
import { appendPriceHistoryIfChanged } from './services/priceHistory';
import { saveOAuthResult } from './services/githubBackupService';
import { Analytics } from '@vercel/analytics/react';

const WRITE_DEBOUNCE_MS = 3500;

/** When merging an update into an existing item, preserve these from the old item if the update doesn't provide them (so renames/edits from inventory don't wipe store data). */
const PRESERVE_FROM_OLD_IF_UPDATE_MISSING: (keyof InventoryItem)[] = [
  'imageUrl', 'storeGalleryUrls', 'storeDescription', 'storeVisible', 'storeOnSale', 'storeSalePrice',
  'specs', 'componentIds', 'comment1', 'comment2', 'vendor', 'sellPrice',
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

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PRICE_DROP_DAYS = 30;

/** Derive store badge: New (added in last 7 days), Price reduced (sell price dropped in last 30 days). */
function computeStoreBadge(item: InventoryItem): 'New' | 'Price reduced' | null {
  const override = item.storeBadge;
  if (override === 'none') return null;
  if (override === 'New') return 'New';
  if (override === 'Price reduced') return 'Price reduced';

  const now = Date.now();
  const buyDate = item.buyDate ? new Date(item.buyDate).getTime() : 0;
  if (now - buyDate <= ONE_WEEK_MS) return 'New';

  const currentSell = item.storeOnSale && item.storeSalePrice != null ? item.storeSalePrice : (item.sellPrice ?? 0);
  const history = item.priceHistory || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.type !== 'sell' || e.previousPrice == null) continue;
    const entryDate = new Date(e.date).getTime();
    if (now - entryDate > PRICE_DROP_DAYS * 24 * 60 * 60 * 1000) break;
    if (e.previousPrice > currentSell) return 'Price reduced';
  }
  return null;
}

function buildStoreCatalog(items: InventoryItem[], categoryFields: Record<string, string[]>): { items: { id: string; name: string; category: string; subCategory?: string; sellPrice?: number; storeSalePrice?: number; storeOnSale?: boolean; imageUrl?: string; storeGalleryUrls?: string[]; storeDescription?: string; specs?: Record<string, string | number>; categoryFields?: string[]; badge?: 'New' | 'Price reduced'; storeMetaTitle?: string; storeMetaDescription?: string; storeDescriptionEn?: string }[] } {
  // Only show items that are IN_STOCK and have storeVisible !== false (simple hide/show toggle)
  const list = items.filter((i) => i.status === ItemStatus.IN_STOCK && i.storeVisible !== false);
  return {
    items: list.map((i) => {
      const badge = computeStoreBadge(i);
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        subCategory: i.subCategory,
        sellPrice: i.sellPrice,
        storeSalePrice: i.storeSalePrice,
        storeOnSale: i.storeOnSale,
        imageUrl: i.imageUrl,
        storeGalleryUrls: i.storeGalleryUrls,
        storeDescription: i.storeDescription,
        specs: i.specs,
        categoryFields: categoryFields[`${i.category}:${i.subCategory || ''}`] || [],
        ...(badge ? { badge } : {}),
        ...(i.storeMetaTitle ? { storeMetaTitle: i.storeMetaTitle } : {}),
        ...(i.storeMetaDescription ? { storeMetaDescription: i.storeMetaDescription } : {}),
        ...(i.storeDescriptionEn ? { storeDescriptionEn: i.storeDescriptionEn } : {}),
      };
    }),
  };
}

interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  lastSynced: Date | null;
  message?: string;
}

type AppState = 'BOOTING' | 'READY' | 'ERROR_SYNC' | 'OFFLINE_MODE';

const App: React.FC = () => {
  // State for Data
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [trash, setTrash] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  
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

  const [appState, setAppState] = useState<AppState>('BOOTING');
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', lastSynced: null });
  const [bootError, setBootError] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(() => localStorage.getItem('cloud_backup_banner_dismissed') === '1');
  
  const [authUser, setAuthUser] = useState<any>(null);
  // Tracks when Firebase auth has completed its initial check (so we don't flash the login screen before session restore).
  const [authReady, setAuthReady] = useState<boolean>(!isCloudEnabled());
  const isRemoteUpdate = useRef(false);
  const writeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialWriteDoneRef = useRef(false);
  const storeCatalogPublishDoneRef = useRef(false);
  const catalogPublishDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveToLocalStorage = (
    newItems: InventoryItem[], 
    newTrash: InventoryItem[], 
    newExpenses: Expense[],
    newSettings: BusinessSettings,
    newGoal: number,
    newCategories: Record<string, string[]>,
    newFields: Record<string, string[]>
  ) => {
    localStorage.setItem('inventory_items', JSON.stringify(newItems));
    localStorage.setItem('inventory_trash', JSON.stringify(newTrash));
    localStorage.setItem('inventory_expenses', JSON.stringify(newExpenses));
    localStorage.setItem('business_settings', JSON.stringify(newSettings));
    localStorage.setItem('monthly_profit_goal', newGoal.toString());
    localStorage.setItem('custom_categories', JSON.stringify(newCategories));
    localStorage.setItem('custom_category_fields', JSON.stringify(newFields));
  };

  const mergeLargeFieldsFromLocal = useCallback((remoteList: InventoryItem[], localList: InventoryItem[]): InventoryItem[] => {
    const localById = new Map(localList.map((i) => [i.id, i]));
    const largeFields = ['imageUrl', 'receiptUrl', 'kleinanzeigenChatImage', 'kleinanzeigenBuyChatImage', 'marketDescription'] as const;
    return remoteList.map((r) => {
      const local = localById.get(r.id);
      if (!local) return r;
      let changed = false;
      const out = { ...r };
      for (const key of largeFields) {
        const rv = (r as any)[key];
        const lv = (local as any)[key];
        if (rv === CLOUD_OMITTED_PLACEHOLDER && lv && typeof lv === 'string' && lv.length > 0) {
          (out as any)[key] = lv;
          changed = true;
        }
      }
      return changed ? out : r;
    });
  }, []);

  const applyRemoteData = useCallback((data: any) => {
    if (!data) return;
    isRemoteUpdate.current = true;
    const remoteInv = (data.inventory || []) as InventoryItem[];
    const remoteTrash = (data.trash || []) as InventoryItem[];
    const localItems = JSON.parse(localStorage.getItem('inventory_items') || '[]') as InventoryItem[];
    const localTrash = JSON.parse(localStorage.getItem('inventory_trash') || '[]') as InventoryItem[];
    const inv = mergeLargeFieldsFromLocal(remoteInv, localItems);
    const tr = mergeLargeFieldsFromLocal(remoteTrash, localTrash);
    const exp = (data.expenses || []) as Expense[];
    const sets = data.settings || {};
    const goal = data.goals?.monthly ?? 1000;
    const cats = data.categories || {};
    const fields = data.categoryFields || {};
    setItems(inv);
    setTrash(tr);
    setExpenses(exp);
    setBusinessSettings(prev => ({ ...prev, ...sets }));
    setMonthlyGoal(goal);
    setCategories(cats);
    setCategoryFields(fields);
    saveToLocalStorage(inv, tr, exp, { ...sets } as BusinessSettings, goal, cats, fields);
  }, []);

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
        setSyncState(prev => ({ ...prev, status: 'idle', message: undefined }));
        return;
      }
      setSyncState({ status: 'syncing', lastSynced: null, message: 'Connecting…' });
      unsubSnapshot = subscribeToData(user.uid, (data) => {
        if (data) applyRemoteData(data);
        setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
      });
    });
    return () => {
      if (unsubSnapshot) unsubSnapshot();
      if (unsubAuth) unsubAuth();
    };
  }, [applyRemoteData]);

  const loadLocalData = () => {
    const localItems = JSON.parse(localStorage.getItem('inventory_items') || '[]');
    setItems(localItems);
    setTrash(JSON.parse(localStorage.getItem('inventory_trash') || '[]'));
    setExpenses(JSON.parse(localStorage.getItem('inventory_expenses') || '[]'));
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
    saveToLocalStorage(newItems, trash, expenses, businessSettings, monthlyGoal, newCategories, newFields);
    localStorage.setItem(OPTICAL_DRIVES_MIGRATION_KEY, '1');
  }, [appState, items, categories, categoryFields, trash, expenses, businessSettings, monthlyGoal]);

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
          categories,
          categoryFields,
          settings: businessSettings,
          goals: { monthly: monthlyGoal },
        };
        await writeToCloud(payload);
        saveToLocalStorage(items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
        setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
        await writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) =>
          console.warn('Store catalog update failed', e)
        );
      } catch (err) {
        initialWriteDoneRef.current = false;
        setSyncState((prev) => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) }));
      }
    })();
  }, [authUser, items, trash, expenses, categories, categoryFields, businessSettings, monthlyGoal, applyRemoteData]);

  // Publish store catalog once when panel has items and auth (ensures storefront gets data)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser || items.length === 0 || storeCatalogPublishDoneRef.current) return;
    storeCatalogPublishDoneRef.current = true;
    const t = setTimeout(() => {
      writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [authUser, items.length, isCloudEnabled(), items, categoryFields]);

  // Publish store catalog soon after items change (so visibility toggles show on store within ~1s)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser) return;
    if (catalogPublishDebounceRef.current) clearTimeout(catalogPublishDebounceRef.current);
    catalogPublishDebounceRef.current = setTimeout(() => {
      catalogPublishDebounceRef.current = null;
      writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) => console.warn('Store catalog update failed', e));
    }, 1000);
    return () => {
      if (catalogPublishDebounceRef.current) clearTimeout(catalogPublishDebounceRef.current);
    };
  }, [items, categoryFields, authUser]);

  // 2. Local persistence + debounced Firestore write
  useEffect(() => {
    if (appState !== 'READY') return;
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    saveToLocalStorage(items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields);

    if (!isCloudEnabled() || !authUser) return;
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    writeDebounceRef.current = setTimeout(() => {
      writeDebounceRef.current = null;
      const payload = { inventory: items, trash, expenses, categories, categoryFields, settings: businessSettings, goals: { monthly: monthlyGoal } };
      setSyncState(prev => ({ ...prev, status: 'syncing', message: 'Saving…' }));
      writeToCloud(payload)
        .then(() => {
          saveToLocalStorage(items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
          setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' });
          const catalog = buildStoreCatalog(items, categoryFields);
          return writeStoreCatalog(catalog).catch((e) => console.warn('Store catalog update failed', e));
        })
        .then(() => setSyncState({ status: 'success', lastSynced: new Date(), message: 'Live' }))
        .catch((err) => setSyncState(prev => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) })));
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    };
  }, [appState, authUser, items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields]);

  const handleForcePush = async () => {
    if (!isCloudEnabled() || !authUser) return false;
    setSyncState(prev => ({ ...prev, status: 'syncing', message: 'Saving…' }));
    const payload = { inventory: items, trash, expenses, categories, categoryFields, settings: businessSettings, goals: { monthly: monthlyGoal } };
    try {
      await writeToCloud(payload);
      saveToLocalStorage(items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
        await writeStoreCatalog(buildStoreCatalog(items, categoryFields)).catch((e) => console.warn('Store catalog update failed', e));
      setSyncState({ status: 'success', lastSynced: new Date(), message: 'Saved' });
      return true;
    } catch (err) {
      setSyncState(prev => ({ ...prev, status: 'error', lastSynced: null, message: getSyncErrorMessage(err) }));
      return false;
    }
  };

  // ... Data Modifiers ...
  const [history, setHistory] = useState<InventoryItem[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const handleUpdate = useCallback((updatedItems: InventoryItem[], deleteIds?: string[]) => {
    setItems(currentItems => {
        let nextItems = [...currentItems];
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
          if (idx >= 0) nextItems[idx] = final;
          else nextItems.push(final);
        });
        
        if (deleteIds && deleteIds.length > 0) {
           const toTrash = nextItems.filter(i => deleteIds.includes(i.id));
           if (toTrash.length > 0) {
              setTrash(prev => [...prev, ...toTrash]);
           }
           nextItems = nextItems.filter(i => !deleteIds.includes(i.id));
        }
        return nextItems;
    });
  }, []);

  const handleImportBatch = useCallback((newItems: InventoryItem[], replace: boolean) => {
    if (replace) {
       setItems(newItems);
       hasUnsavedChanges.current = true;
    } else {
       handleUpdate(newItems);
    }
  }, [handleUpdate]);

  const handleDelete = (id: string) => handleUpdate([], [id]);
  const handleUndo = () => { if (historyIndex > 0) { const newIndex = historyIndex - 1; setHistoryIndex(newIndex); setItems(history[newIndex]); } };
  const handleRedo = () => { if (historyIndex < history.length - 1) { const newIndex = historyIndex + 1; setHistoryIndex(newIndex); setItems(history[newIndex]); } };
  const handleAddExpense = (expense: Expense) => setExpenses(prev => [...prev, expense]);
  const handleDeleteExpense = (id: string) => setExpenses(prev => prev.filter(e => e.id !== id));
  
  const handleWipeData = async () => {
    const emptyInventory: InventoryItem[] = [];
    const emptyExpenses: Expense[] = [];
    const emptyTrash: InventoryItem[] = [];
    const defaultGoal = 1000;

    setItems(emptyInventory);
    setExpenses(emptyExpenses);
    setTrash(emptyTrash);
    setHistory([]);
    setHistoryIndex(-1);
    setMonthlyGoal(defaultGoal);
    
    localStorage.removeItem('dashboard_tasks');
    localStorage.removeItem('price_check_history');
    localStorage.removeItem('ai_sourcing_history');

    saveToLocalStorage(emptyInventory, emptyTrash, emptyExpenses, businessSettings, defaultGoal, categories, categoryFields);

    if (isCloudEnabled() && authUser) {
      try {
        await writeToCloud({
          inventory: emptyInventory,
          trash: emptyTrash,
          expenses: emptyExpenses,
          settings: businessSettings,
          goals: { monthly: defaultGoal },
          categories,
          categoryFields,
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

  const handleRestoreBackup = useCallback(async (data: { inventory?: InventoryItem[]; trash?: InventoryItem[]; expenses?: Expense[]; settings?: BusinessSettings; goals?: { monthly?: number }; categories?: Record<string, string[]>; categoryFields?: Record<string, string[]> }) => {
    const inv = Array.isArray(data.inventory) ? data.inventory : (Array.isArray((data as any).Inventory) ? (data as any).Inventory : []);
    const tr = Array.isArray(data.trash) ? data.trash : [];
    const exp = Array.isArray(data.expenses) ? data.expenses : [];
    const goal = data.goals?.monthly ?? monthlyGoal;
    const cats = data.categories && typeof data.categories === 'object' ? data.categories : categories;
    const fields = data.categoryFields && typeof data.categoryFields === 'object' ? data.categoryFields : categoryFields;
    const sets = data.settings && typeof data.settings === 'object' ? { ...businessSettings, ...data.settings } : businessSettings;
    isRemoteUpdate.current = true;
    setItems(inv);
    setTrash(tr);
    setExpenses(exp);
    setMonthlyGoal(goal);
    setCategories(cats);
    setCategoryFields(fields);
    setBusinessSettings(sets);
    saveToLocalStorage(inv, tr, exp, sets, goal, cats, fields);
    if (isCloudEnabled() && authUser) {
      try {
        await writeToCloud({ inventory: inv, trash: tr, expenses: exp, settings: sets, goals: { monthly: goal }, categories: cats, categoryFields: fields });
        await writeStoreCatalog(buildStoreCatalog(inv, fields)).catch(() => {});
      } catch (_) {}
    }
    setRefreshKey((k) => k + 1);
  }, [monthlyGoal, categories, categoryFields, businessSettings, authUser]);

  const handleFixEncoding = useCallback((fixedItems: InventoryItem[], fixedTrash: InventoryItem[]) => {
    setItems(fixedItems);
    setTrash(fixedTrash);
    saveToLocalStorage(fixedItems, fixedTrash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
    if (isCloudEnabled() && authUser) {
      writeToCloud({ inventory: fixedItems, trash: fixedTrash, expenses, settings: businessSettings, goals: { monthly: monthlyGoal }, categories, categoryFields }).catch(() => {});
    }
    setRefreshKey((k) => k + 1);
  }, [expenses, businessSettings, monthlyGoal, categories, categoryFields, authUser]);

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
    ItemStatus.ORDERED,
    ItemStatus.IN_COMPOSITION
  ];

  return (
    <Router>
      <Analytics />
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
            />
          }
        >
          <Route index element={<Navigate to="/panel/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard items={items} expenses={expenses} monthlyGoal={monthlyGoal} onGoalChange={setMonthlyGoal} businessSettings={businessSettings} />} />
          <Route path="analytics" element={<CategoryAnalytics items={items} businessSettings={businessSettings} />} />
          <Route path="category-suggestions" element={<CategorySuggestionsPage items={items} categories={categories} categoryFields={categoryFields} onUpdate={handleUpdate} onUpdateCategoryStructure={handleUpdateCategoryStructure} onUpdateCategoryFields={handleUpdateCategoryFields} onAddCategory={handleAddCategory} />} />
          <Route path="inventory" element={<InventoryList key="inventory-main" items={items} totalCount={items.length} onUpdate={handleUpdate} onDelete={handleDelete} onUndo={handleUndo} onRedo={handleRedo} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1} pageTitle="Inventory" allowedStatuses={ALL_STATUSES} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} persistenceKey="inventory_main"/>} />
          <Route path="add" element={<ItemForm onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="add-bulk" element={<BulkItemForm onSave={handleUpdate} />} />
          <Route path="edit/:id" element={<ItemForm onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="builder" element={<PCBuilderWizard items={items} onSave={handleUpdate} />} />
          <Route path="pricing" element={<PriceCheck />} />
          <Route path="expenses" element={<ExpenseManager expenses={expenses} onAddExpense={handleAddExpense} onDeleteExpense={handleDeleteExpense} />} />
          <Route path="import" element={<SheetsImport onImport={handleImportBatch} onClearData={handleWipeData} />} />
          <Route path="trash" element={<TrashPage items={trash} onRestore={handleRestoreFromTrash} onPermanentDelete={handlePermanentDelete} />} />
          <Route path="store-management" element={<StoreManagementPage items={items} categories={categories} categoryFields={categoryFields} onUpdate={handleUpdate} onPublishCatalog={async () => { await writeStoreCatalog(buildStoreCatalog(items, categoryFields)); }} />} />
          <Route path="settings" element={<SettingsPage items={items} trash={trash} expenses={expenses} monthlyGoal={monthlyGoal} onForcePush={handleForcePush} onRestoreItems={setItems} onRestoreBackup={handleRestoreBackup} onFixEncoding={handleFixEncoding} businessSettings={businessSettings} onBusinessSettingsChange={setBusinessSettings} categories={categories} categoryFields={categoryFields} onUpdateCategoryStructure={handleUpdateCategoryStructure} onUpdateCategoryFields={handleUpdateCategoryFields} onRenameCategory={() => {}} onRenameSubCategory={() => {}} />} />
        </Route>
        <Route path="/auth/github/callback" element={<GitHubOAuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
