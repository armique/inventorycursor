import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, startTransition } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { Cloud, CheckCircle2, Loader2, WifiOff, RefreshCw, X } from 'lucide-react';

import PanelLayout from './components/PanelLayout';
import { SettingsModalProvider } from './context/SettingsModalContext';
import SettingsModalHost from './components/SettingsModalHost';
import OpenSettingsFromRoute from './components/OpenSettingsFromRoute';
import { StorefrontPageSkeleton } from './components/RouteSkeletons';

const StorefrontPage = lazy(() => import('./components/StorefrontPage'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const InventoryList = lazy(() => import('./components/InventoryList'));
const ItemForm = lazy(() => import('./components/ItemForm'));
const BulkItemForm = lazy(() => import('./components/BulkItemForm'));
const SheetsImport = lazy(() => import('./components/SheetsImport'));
const ExpenseManager = lazy(() => import('./components/ExpenseManager'));
const TrashPage = lazy(() => import('./components/TrashPage'));
const BuilderEntry = lazy(() => import('./components/BuilderEntry'));
const StoreManagementPage = lazy(() => import('./components/StoreManagementPage'));
const StorefrontConfiguratorPage = lazy(() => import('./components/StorefrontConfiguratorPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const InvoiceManager = lazy(() => import('./components/InvoiceManager'));
const ActionHistoryPage = lazy(() => import('./components/ActionHistoryPage'));
const ThreeDPrintPage = lazy(() => import('./components/ThreeDPrintPage'));
const ProductCardGalleryPage = lazy(() => import('./components/ProductCardGalleryPage'));
const BulkImportHistoryPage = lazy(() => import('./components/BulkImportHistoryPage'));
const SellTodayPage = lazy(() => import('./components/SellTodayPage'));
const EbayAbrechnungPage = lazy(() => import('./components/EbayAbrechnungPage'));
const EditItemRoute = lazy(() => import('./components/EditItemRoute'));
const AddHubPage = lazy(() => import('./components/AddHubPage'));
const AddItemRoute = lazy(() => import('./components/AddItemRoute'));
const PhonePhotoUploadPage = lazy(() => import('./components/PhonePhotoUploadPage'));
const EstDealwatchPage = lazy(() => import('./components/EstDealwatchPage'));
const ReinvestAssistantPage = lazy(() => import('./components/ReinvestAssistantPage'));
const ComboLabPage = lazy(() => import('./components/ComboLabPage'));
import { InventoryItem, Expense, ItemStatus, BusinessSettings, RecurringExpense, DashboardPreferences, ActionHistoryEntry, TaxMode, ItemUpdateOptions, BulkImportRecord } from './types';
import {
  loadDashboardPreferencesFromLocalStorage,
  persistDashboardPreferencesToLocalStorage,
  normalizeDashboardPreferences,
  getDefaultDashboardPreferences,
} from './services/dashboardPreferences';
import {
  composeThreeDPrintCloudFromLocal,
  mergeThreeDPrintCloud,
  persistThreeDPrintCloudState,
  snapshotThreeDPrintCloudNow,
  type ThreeDPrintCloudState,
} from './services/threeDPrintCloud';
import { isCloudEnabled, onAuthChange, subscribeToData, writeToCloud, writeStoreCatalog, getSyncErrorMessage, CLOUD_OMITTED_PLACEHOLDER, fetchGamificationState, writeGamificationState, completeGoogleRedirectSignIn, consumeAuthReturnPath, consumeRedirectPending, getAuthErrorMessage } from './services/firebaseService';
import {
  saveItemChangesToSupabase,
  isSupabaseConfigured,
  fetchSupabaseSnapshotDirect,
  subscribeToSupabaseRealtime,
  writeFullAppStateToSupabase
} from './services/supabaseService';
import { runWeeklyPhotoPruneIfDue } from './services/photoPruneService';
import { computeItemHistoryDiff, appendItemHistoryEntry } from './utils/itemHistoryDiff';
import { withTimeout } from './utils/withTimeout';
import {
  defaultGamificationState,
  ensureFreshDay,
  ensureFreshMonth,
  loadGamificationStateLocal,
  saveGamificationStateLocal,
  type GamificationState,
} from './utils/gamification';
import { runDailyBackupIfDue } from './services/backupService';
import { pullOrderIndexFromCloud } from './services/ebayOrderIndex';
import { pullPurchaseIndexFromCloud } from './services/ebayPurchaseIndex';
import { ensureEbayListings, pullListingIndexFromCloud } from './services/ebayListingIndex';
import { runEbayTxCloudSyncOnce } from './services/ebayTransactionReportSync';
import { syncNewEbayOrdersOnAppVisit } from './services/ebayApiOrderSync';
import { runEbayTxDailyCsvExport } from './services/ebayTxDailyExport';
import { ensureKaListings } from './services/kleinanzeigenListingIndex';
import { DEFAULT_CATEGORIES } from './services/constants';
import { migrateCategoriesRecord, migrateContainerItem } from './utils/containerTaxonomy';
import { todayLocalDateKey } from './utils/calendarDate';
import { buildFullBackupPayload, downloadFullBackupJson } from './utils/fullBackupExport';
import { loadEbayOrderIndex, upsertEbayOrders, type EbayOrderRecord } from './services/ebayOrderIndex';
import {
  loadEbayTransactionLibrary,
  loadEbayTxLabelOverrides,
  upsertEbayTransactionReport,
  saveEbayTxLabelOverrides,
  type EbayTxLabelOverride,
} from './services/ebayTransactionReportStore';
import { notifyEbayTxReportUpdated } from './services/ebayTransactionReportSync';
import type { EbayTxReport } from './utils/ebayTransactionReport';
import {
  loadInventoryItemsForBoot,
  writeInventoryItemsToDB,
  appendPendingItemPatches,
  readPendingItemPatches,
  clearPendingItemPatches,
  setInventoryItemsStaleListener,
} from './services/inventoryItemsStore';
import {
  migrateLegacyGpuSubcategoryNames,
  renameCategoryInCatalog,
  renameSubcategoryInCatalog,
} from './utils/categoryRename';
import { appendPriceHistoryIfChanged, mergeItemAuditFields } from './services/priceHistory';
import { withSyncedRealizedProfit, healRealizedProfitsFromSaleProceeds } from './services/financialAggregation';
import { syncContainerBuyTotalsFromComponents } from './services/containerAggregates';
import { syncContainerSaleMetaToChildren } from './utils/containerSaleCascade';
import { planAbrechnungMistakenLinkHeals } from './utils/itemSaleCycle';
import { enforceContainerMembershipInvariants, findEmptyContainerShellIds } from './utils/containerMembershipInvariants';
import { applyTradeRevert } from './services/tradeRevert';
import { mergeTradeActionEntries } from './services/tradeActionHistory';
import { applyUnsoldRestock, loadRefundOrdersForRestock, pruneActionHistory } from './services/saleRevert';
import { saveOAuthResult, getStoredConfig as getStoredGitHubBackupConfig, runDailyGitHubBackupIfDue } from './services/githubBackupService';
import { exchangeEbayAuthorizationCode } from './services/ebayService';
import { generateExpensesFromRecurring } from './services/recurringExpenseService';
import { Analytics } from '@vercel/analytics/react';
import { PanelLocaleProvider } from './context/PanelLocaleContext';
import {
  hydrateMarketplaceCredentialsFromSettings,
  mergeLocalMarketplaceCredentialsIntoSettings,
  withLocalEbayOAuthOnSettings,
} from './utils/marketplaceCredentialsSync';
import { UndoToastProvider, useUndoToastContext } from './context/UndoToastContext';
import { appendUndoHistory, makeUndoSnapshot, type UndoSnapshot } from './utils/appendUndoHistory';
import {
  persistSnapshotToLocalStorage,
  scheduleBackgroundWork,
  yieldToMain,
} from './services/backgroundPersistence';
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
  countBlankContainerBuyDates,
  preferFilledContainerBuyDate,
} from './utils/backfillContainerBuyDates';
import { applyHealthInsuranceLedger } from './utils/healthInsuranceLedger';
import { applyCrucialRamInvoiceSaleFix } from './utils/crucialRamInvoiceSaleFix';
import { applyAsusGtx1080RogStrixHubSaleFix } from './utils/asusGtx1080RogStrixHubSaleFix';
import { applyRx6500XtHubSellSync } from './utils/rx6500XtHubSellSync';
import { restoreIntegralRamKit, INTEGRAL_RAM_KIT_ID } from './utils/restoreIntegralRamKit';
import { restoreAsusA320mPcSale } from './utils/restoreAsusA320mPcSale';
import { applySamsungEvo840RefundResale } from './utils/applySamsungEvo840RefundResale';
import { healActiveContainerPartMembership } from './utils/healActiveContainerPartMembership';
import { localInventoryAheadOfRemote, inventoryLooksUnchanged, expenseListLooksUnchanged, mergeItemsPreservingReferences } from './utils/inventoryCloudPush';
import { addRecentItemId } from './services/recentItemsService';
import { mergeBusinessSettings } from './utils/mergeBusinessSettings';
import { maxAssetTagNumber, formatAssetTag } from './utils/assetTag';
import { recordMembershipChangeIfAny } from './utils/itemMovementHistory';
import {
  markInvoiceBusinessProfileDone,
  stampInvoiceBusinessProfile,
} from './utils/invoiceBusinessProfile';
import {
  WRITE_DEBOUNCE_MS,
  FAST_CLOUD_FLUSH_MS,
  LOCAL_PERSIST_DEBOUNCE_MS,
  STORE_CATALOG_DEBOUNCE_MS,
  REMOTE_APPLY_SUPPRESS_MS,
  REMOTE_ECHO_TOLERANCE_MS,
  BULK_IMPORT_SYNC_FLUSH_MS,
  inventoryCloudDebounceMs,
  resolveCloudFlushDelay,
  shouldFlushCloudSoon,
  shouldAcceptRemoteSnapshot,
} from './utils/cloudSyncTiming';
import {
  SYNC_MSG_PENDING,
  SYNC_MSG_UPLOADING,
  SYNC_MSG_SYNCED,
  SYNC_MSG_RETRYING,
} from './utils/cloudSyncStatus';

const ACTION_HISTORY_LIMIT = 400;

const ALL_INVENTORY_STATUSES = [
  ItemStatus.IN_STOCK,
  ItemStatus.SOLD,
  ItemStatus.TRADED,
  ItemStatus.GIFTED,
  ItemStatus.ORDERED,
  ItemStatus.IN_COMPOSITION,
];

function smallJsonLooksUnchanged(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function actionHistoryLooksUnchanged(
  a: ActionHistoryEntry[],
  b: ActionHistoryEntry[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id || a[i]?.timestamp !== b[i]?.timestamp) return false;
  }
  return true;
}

function recurringLooksUnchanged(a: RecurringExpense[], b: RecurringExpense[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || x.id !== y.id) return false;
    if (x.monthlyAmount !== y.monthlyAmount || (x.lastGeneratedDate || '') !== (y.lastGeneratedDate || '')) {
      return false;
    }
  }
  return true;
}

function bulkImportIdsLookUnchanged(a: BulkImportRecord[], b: BulkImportRecord[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

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
  threeDPrint: ThreeDPrintCloudState;
};

/** When merging an update into an existing item, preserve these from the old item if the update
 * doesn't provide them (so renames/edits from inventory don't wipe store data). Deliberately
 * excludes sellPrice/storePrice — those are actively user-editable numeric fields with real
 * "clear to remove" semantics (e.g. clearing a price in the inline table editor); restoring the
 * old value whenever the new one is undefined made it impossible to ever actually clear them. */
const PRESERVE_FROM_OLD_IF_UPDATE_MISSING: (keyof InventoryItem)[] = [
  'imageUrl', 'imageUrls', 'storeGalleryUrls', 'storeDescription', 'storeVisible', 'storeOnSale', 'storeSalePrice',
  'specs', 'componentIds', 'comment1', 'comment2', 'vendor', 'aiDescriptionNote',
  'platformBought', 'buyPaymentType', 'kleinanzeigenBuyChatUrl', 'kleinanzeigenBuyChatImage',
  'kleinanzeigenSellerProfileUrl',
  'bulkImportId',
  'costOrigin',
  'priceHistory',
  'ebaySaleCycles',
  'ebaySaleAdjustments',
  'source', 'lastModifiedBy', 'aiReviewStatus',
  'printStage', 'reserved', 'photosReady',
];

/**
 * Accessory flags: when the update object includes the key (even as undefined), treat it as an
 * intentional clear — otherwise cycling OVP/IO to “unspecified” was restored by preserve and
 * rapid clicks flooded undo + re-renders with no UI change.
 */
const ACCESSORY_EXPLICIT_CLEAR_KEYS: (keyof InventoryItem)[] = [
  'hasOVP',
  'hasIOShield',
  'hasReceipt',
];
const EBAY_LISTINGS_DAILY_BOOT_REFRESH_KEY = 'ebay_listings_daily_boot_refresh_v1';
const KA_LISTINGS_DAILY_BOOT_REFRESH_KEY = 'ka_listings_daily_boot_refresh_v1';

/**
 * Re-apply fields the caller left out (forms often submit a partial item).
 * Shared so AI diffing sees exactly the item that will be stored.
 */
function applyPreservedFields(oldItem: InventoryItem | undefined, merged: InventoryItem): InventoryItem {
  if (!oldItem) return merged;
  const final = { ...merged } as unknown as Record<string, unknown>;
  const oldRecord = oldItem as unknown as Record<string, unknown>;
  const mergedRecord = merged as unknown as Record<string, unknown>;
  for (const k of ACCESSORY_EXPLICIT_CLEAR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(mergedRecord, k as string)) {
      const newVal = mergedRecord[k as string];
      if (newVal === undefined || newVal === null) {
        delete final[k as string];
      }
    }
  }
  for (const k of PRESERVE_FROM_OLD_IF_UPDATE_MISSING) {
    const oldVal = oldRecord[k as string];
    const newVal = mergedRecord[k as string];
    if (oldVal !== undefined && oldVal !== null && (newVal === undefined || newVal === null)) {
      final[k as string] = oldVal;
    }
  }
  // Always union audit trails — a partial save must not wipe restock / trade history.
  return mergeItemAuditFields(final as unknown as InventoryItem, oldItem);
}

function EbayOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const err = searchParams.get('error');
    const errDesc = searchParams.get('error_description');
    if (err) {
      setStatus('error');
      setMessage(errDesc || err);
      return;
    }
    const code = searchParams.get('code');
    if (!code) {
      setStatus('error');
      setMessage('Missing authorization code from eBay.');
      return;
    }
    exchangeEbayAuthorizationCode(code)
      .then(() => {
        setStatus('ok');
        navigate('/panel/settings?tab=EBAY&ebay_connected=1', { replace: true });
      })
      .catch((e: unknown) => {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'eBay Connect failed');
      });
  }, [searchParams, navigate]);

  if (status === 'ok') return null;
  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 items-center justify-center flex-col space-y-4 p-4">
      {status === 'loading' && <Loader2 size={48} className="animate-spin text-slate-400" />}
      {status === 'error' && (
        <>
          <p className="text-sm font-bold text-red-600 text-center max-w-md">{message}</p>
          <button
            type="button"
            onClick={() => navigate('/panel/settings?tab=EBAY')}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold"
          >
            Back to Settings
          </button>
        </>
      )}
      <p className="text-slate-500 text-sm">
        {status === 'loading' ? 'Connecting eBay account…' : ''}
      </p>
    </div>
  );
}

/**
 * Finish Google redirect OAuth on every route (including `/`), then send the user
 * back to the panel/upload URL they started from.
 */
function GoogleAuthRedirectBootstrap() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isCloudEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const pending = consumeRedirectPending();
        const user = await completeGoogleRedirectSignIn();
        if (cancelled) return;
        // Only touch the saved return path when we actually came back from a redirect
        // (or successfully finished one). GIS / popup sign-in must not clear it mid-flow.
        if (!pending && !user) return;
        const returnPath = consumeAuthReturnPath();
        const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (user && returnPath && returnPath !== here) {
          navigate(returnPath, { replace: true });
        } else if (
          user &&
          !window.location.pathname.startsWith('/panel') &&
          !window.location.pathname.startsWith('/upload/')
        ) {
          navigate(returnPath || '/panel/dashboard', { replace: true });
        } else if (pending && !user) {
          const origin = window.location.origin;
          console.error('[auth] Redirect returned without a session', { origin });
          alert(
            `Google sign-in did not complete on this device.\n\n` +
              `Confirm Firebase Authorized domains includes ${window.location.hostname}, then try again.`
          );
        }
      } catch (err) {
        console.error('Google redirect bootstrap failed', err);
        // Avoid alarming popups after GIS/popup sign-in; only surface redirect failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return null;
}

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

function recomputeRealizedProfit(item: InventoryItem): InventoryItem {
  return withSyncedRealizedProfit(item);
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

  const handleRenameSubCategory = useCallback(
    (category: string, oldSubName: string, newSubName: string) => {
      const next = renameSubcategoryInCatalog(
        { categories, categoryFields, items },
        category,
        oldSubName,
        newSubName
      );
      setCategories(next.categories);
      setCategoryFields(next.categoryFields);
      if (next.movedCount > 0) {
        setItems(next.items);
        hasUnsavedChanges.current = true;
      }
    },
    [categories, categoryFields, items]
  );

  const handleRenameCategory = useCallback(
    (oldName: string, newName: string) => {
      const next = renameCategoryInCatalog(
        { categories, categoryFields, items },
        oldName,
        newName
      );
      setCategories(next.categories);
      setCategoryFields(next.categoryFields);
      if (next.movedCount > 0) {
        setItems(next.items);
        hasUnsavedChanges.current = true;
      }
    },
    [categories, categoryFields, items]
  );

  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(() => {
    const saved = localStorage.getItem('business_settings');
    const base: BusinessSettings = saved
      ? JSON.parse(saved)
      : {
          companyName: '',
          ownerName: '',
          address: '',
          phone: '',
          taxId: '',
          vatId: '',
          iban: '',
          bic: '',
          bankName: '',
          taxMode: 'SmallBusiness',
        };
    const stamped = stampInvoiceBusinessProfile(base);
    if (stamped.changed) {
      try {
        localStorage.setItem('business_settings', JSON.stringify(stamped.settings));
      } catch {
        /* ignore quota */
      }
    }
    return mergeLocalMarketplaceCredentialsIntoSettings(stamped.settings);
  });

  // Keep this browser’s eBay/KA local keys in sync when cloud settings arrive / change.
  useEffect(() => {
    hydrateMarketplaceCredentialsFromSettings(businessSettings);
  }, [
    businessSettings.ebaySellerUsername,
    businessSettings.ebayOAuthToken,
    businessSettings.ebayOAuthRefreshToken,
    businessSettings.ebayOAuthExpiresAt,
    businessSettings.ebayOAuthRefreshExpiresAt,
    businessSettings.kleinanzeigenProfileUrl,
  ]);

  // When Connect eBay / refresh updates localStorage, mirror into cloud business settings.
  useEffect(() => {
    const sync = () => {
      setBusinessSettings((prev) => {
        const next = withLocalEbayOAuthOnSettings(prev);
        if (next === prev) return prev;
        hasUnsavedChanges.current = true;
        return next;
      });
    };
    window.addEventListener('ebay-config-updated', sync);
    return () => window.removeEventListener('ebay-config-updated', sync);
  }, []);
  
  const [monthlyGoal, setMonthlyGoal] = useState<number>(() => {
    const saved = localStorage.getItem('monthly_profit_goal');
    return saved ? parseInt(saved) : 1000;
  });

  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPreferences>(() => loadDashboardPreferencesFromLocalStorage());

  const handleDownloadInventoryBackup = useCallback(async () => {
    const [txLibrary, txLabelOverrides] = await Promise.all([
      loadEbayTransactionLibrary(),
      loadEbayTxLabelOverrides(),
    ]);
    downloadFullBackupJson(
      buildFullBackupPayload({
        items,
        trash,
        expenses,
        businessSettings,
        monthlyGoal,
        categories,
        categoryFields,
        dashboardPreferences: dashboardPrefs,
        actionHistory,
        bulkImports,
        ebayOrders: loadEbayOrderIndex().orders,
        ebayTxReports: txLibrary.reports,
        ebayTxLabelOverrides: txLabelOverrides,
      })
    );
  }, [items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields, dashboardPrefs, actionHistory, bulkImports]);

  const [threeDPrintCloud, setThreeDPrintCloud] = useState<ThreeDPrintCloudState>(() => composeThreeDPrintCloudFromLocal());
  const applyingRemote3dRef = useRef(false);
  const [gamification, setGamificationState] = useState<GamificationState>(() =>
    ensureFreshMonth(ensureFreshDay(loadGamificationStateLocal())),
  );
  const gamificationPulledRef = useRef(false);
  const dailyBackupRanRef = useRef(false);
  const dailyGitHubBackupRanRef = useRef(false);
  const githubBackupInFlightRef = useRef(false);
  const ebayTxDailyExportRanRef = useRef(false);
  const gamificationWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateGamification = useCallback((updater: (prev: GamificationState) => GamificationState) => {
    setGamificationState((prev) => {
      const next = ensureFreshMonth(ensureFreshDay(updater(ensureFreshDay(prev))));
      saveGamificationStateLocal(next);
      if (isCloudEnabled()) {
        if (gamificationWriteTimer.current) clearTimeout(gamificationWriteTimer.current);
        gamificationWriteTimer.current = setTimeout(() => {
          writeGamificationState(next as unknown as Record<string, unknown>).catch((e) =>
            console.warn('Gamification cloud write failed:', e),
          );
        }, 1500);
      }
      return next;
    });
  }, []);
  const dashboardPrefsRef = useRef(dashboardPrefs);
  const threeDPrintCloudRef = useRef(threeDPrintCloud);
  const threeDPrintCloudSeededRef = useRef(false);
  const actionHistoryRef = useRef<ActionHistoryEntry[]>(loadActionHistoryFromStorage());
  const bulkImportsRef = useRef<BulkImportRecord[]>(loadBulkImportsFromStorage());
  useEffect(() => {
    dashboardPrefsRef.current = dashboardPrefs;
  }, [dashboardPrefs]);
  useEffect(() => {
    threeDPrintCloudRef.current = threeDPrintCloud;
  }, [threeDPrintCloud]);
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
  /** Set when another tab/window has saved newer inventory data than this tab has — this
   *  tab has stopped autosaving to avoid overwriting it. Reload to pick up the latest. */
  const [tabDataStale, setTabDataStale] = useState(false);
  const abrechnungHealDoneRef = useRef(false);
  /** One-shot historical item heals — must not rescan inventory on every edit (freezes scroll/UI). */
  const inventoryBootHealsDoneRef = useRef(false);
  const containerMembershipBootHealDoneRef = useRef(false);
  const bulkImportCrossLinkDoneRef = useRef(false);
  const healthInsuranceLedgerDoneRef = useRef(false);
  
  const [authUser, setAuthUser] = useState<any>(null);
  // Tracks when Firebase auth has completed its initial check (so we don't flash the login screen before session restore).
  const [authReady, setAuthReady] = useState<boolean>(!isCloudEnabled());
  const isRemoteUpdate = useRef(false);
  const hasUnsavedChanges = useRef(false);

  // One-shot: if this device had credentials only in localStorage, push them into cloud settings.
  useEffect(() => {
    setBusinessSettings((prev) => {
      const merged = mergeLocalMarketplaceCredentialsIntoSettings(prev);
      if (merged !== prev) {
        hasUnsavedChanges.current = true;
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- migrate once on boot
  }, []);

  /** After remote merge, push if this device had bulk-import history cloud lacked. */
  const pendingCloudPushAfterRemoteRef = useRef(false);
  const writeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardCloudDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSilentCloudSyncRef = useRef<(() => Promise<void>) | null>(null);
  const localPersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Next cloud write delay; discrete actions set FAST_CLOUD_FLUSH_MS before setState. */
  const preferredCloudFlushMsRef = useRef(WRITE_DEBOUNCE_MS);
  const pendingCloudFlushRef = useRef(false);
  const initialWriteDoneRef = useRef(false);
  /** Blocks cloud uploads until the first pull finishes (prevents empty-phone wipe). */
  const cloudHydratedRef = useRef(!isCloudEnabled());
  const [cloudHydrated, setCloudHydrated] = useState(!isCloudEnabled());
  const markCloudHydrated = useCallback(() => {
    cloudHydratedRef.current = true;
    setCloudHydrated(true);
  }, []);
  const ebayOrderIndexPulledRef = useRef(false);
  const ebayTxReportsPulledRef = useRef(false);
  const ebayApiOrderSyncTriedRef = useRef(false);
  const ebayListingDailyRefreshTriedRef = useRef(false);
  const kaListingDailyRefreshTriedRef = useRef(false);
  const storeCatalogPublishDoneRef = useRef(false);
  const catalogPublishDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudSyncInFlightRef = useRef(false);
  const suppressRemoteApplyUntilRef = useRef(0);
  /** Timestamp (ms) of our last successful Firestore push — used to accept newer remote snapshots. */
  const lastLocalPushAtRef = useRef(0);
  const remoteSnapshotSeenRef = useRef(false);
  const itemsRef = useRef(items);
  const trashRef = useRef(trash);
  /** After cloud/remote apply, drop session undo so redo doesn't resurrect stale pre-sync snapshots. */
  const clearUndoStackRef = useRef(false);
  const historyRef = useRef<UndoSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
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
    threeDPrint: threeDPrintCloudRef.current,
  }), []);

  const requestFastCloudFlush = useCallback(() => {
    preferredCloudFlushMsRef.current = Math.min(
      preferredCloudFlushMsRef.current,
      FAST_CLOUD_FLUSH_MS
    );
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const api = {
      suppressCloudPull: (ms = REMOTE_APPLY_SUPPRESS_MS * 3) => {
        suppressRemoteApplyUntilRef.current = Date.now() + ms;
      },
      flushCloudNow: async () => {
        hasUnsavedChanges.current = true;
        requestFastCloudFlush();
        if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
        await runSilentCloudSyncRef.current?.();
      },
    };
    (window as unknown as { __inventoryDev?: typeof api }).__inventoryDev = api;
    return () => {
      delete (window as unknown as { __inventoryDev?: typeof api }).__inventoryDev;
    };
  }, [requestFastCloudFlush]);

  const markCloudDirty = useCallback(() => {
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [requestFastCloudFlush]);

  useEffect(() => {
    const syncLocal3d = () => {
      if (applyingRemote3dRef.current) return;
      const next = snapshotThreeDPrintCloudNow();
      setThreeDPrintCloud(next);
      threeDPrintCloudRef.current = next;
      hasUnsavedChanges.current = true;
      requestFastCloudFlush();
    };
    window.addEventListener('filament-stock-updated', syncLocal3d);
    window.addEventListener('three-d-print-settings-updated', syncLocal3d);
    return () => {
      window.removeEventListener('filament-stock-updated', syncLocal3d);
      window.removeEventListener('three-d-print-settings-updated', syncLocal3d);
    };
  }, [requestFastCloudFlush]);

  const shouldApplyRemoteSnapshot = useCallback((data: { updatedAt?: string } | null) => {
    return shouldAcceptRemoteSnapshot({
      data,
      remoteSnapshotSeen: remoteSnapshotSeenRef.current,
      lastLocalPushAt: lastLocalPushAtRef.current,
      suppressRemoteApplyUntil: suppressRemoteApplyUntilRef.current,
      cloudSyncInFlight: cloudSyncInFlightRef.current,
      hasUnsavedChanges: hasUnsavedChanges.current,
    });
  }, []);

  // Public storefront catalog is rebuilt from inventory via debounced publishStoreCatalog / writeStoreCatalog.

  const saveToLocalStorage = async (
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
    try {
      await writeInventoryItemsToDB(newItems);
      clearPendingItemPatches();
    } catch (e) {
      console.warn('[persist] saveToLocalStorage: IndexedDB items write failed:', e);
    }
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

  /**
   * Merge remote inventory with local. Remote wins on conflicts, but local-only items (e.g.
   * newly added via bulk) are preserved until synced.
   *
   * `localTrashIds` (optional): item ids this device has already moved to trash. Without it,
   * a remote snapshot that hasn't caught up to a just-deleted item yet resurrects it straight
   * back into active inventory on the next merge pass — the delete equivalent of the restock
   * bug above, caught the same way (a just-trashed item reappearing on reload).
   */
  const mergeInventoryWithLocal = useCallback((
    remoteList: InventoryItem[],
    localList: InventoryItem[],
    localTrashIds?: Set<string>
  ): InventoryItem[] => {
    const largeFields = ['imageUrl', 'receiptUrl', 'kleinanzeigenChatImage', 'kleinanzeigenBuyChatImage', 'marketDescription'] as const;
    const localById = new Map(localList.map((i) => [i.id, i]));
    const byId = new Map<string, InventoryItem>();
    const isDisposed = (s: ItemStatus | undefined) =>
      s === ItemStatus.SOLD || s === ItemStatus.TRADED || s === ItemStatus.GIFTED;

    const applyLargeFieldPlaceholders = (base: InventoryItem, fromRemote: InventoryItem): InventoryItem => {
      let changed = false;
      const out = { ...base };
      for (const key of largeFields) {
        const rv = (fromRemote as unknown as Record<string, unknown>)[key];
        const lv = (base as unknown as Record<string, unknown>)[key];
        if (rv === CLOUD_OMITTED_PLACEHOLDER && lv && typeof lv === 'string' && lv.length > 0) {
          (out as unknown as Record<string, unknown>)[key] = lv;
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
      if (localTrashIds?.has(r.id)) return;
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
        let next =
          localBid && !(kept.bulkImportId || '').trim()
            ? { ...kept, bulkImportId: localBid }
            : kept;
        next = mergeItemAuditFields(next, r);
        byId.set(r.id, next);
        return;
      }

      // A lagging sold shard must not put the item back in Sold — from ANY source, not just
      // this same device/tab. Caught live: some other session kept re-pushing a stale "Sold"
      // snapshot, and whenever it landed here without the exact [Returned …] tag or a
      // pending-edit flag already set locally, this fell through to the generic "remote wins"
      // path below and silently re-sold a just-restocked item — a real item, repeatedly,
      // undoing the restock within minutes each time, no matter how many times it was redone.
      //
      // The old exact-tag check isn't reliable across devices/tabs, each with their own timing
      // — so this compares which side's data is actually NEWER instead, using each side's most
      // recent price-history entry (every sale and every restock appends one). That correctly
      // protects a just-done restock from a lagging stale write, while still letting a
      // genuinely later sale on another device come through — the old code, by contrast, could
      // only protect the narrow "this exact tab's own edit" case.
      // Exception: an intentional sale restore (clears [Returned], stamps [Sale restored …])
      // always wins over a local Active restock copy regardless of timestamps — it's a
      // deliberate correction, not a race.
      if (!localDisposed && remoteDisposed) {
        const remoteRestored = /\[Sale restored /i.test(String(r.comment2 || ''));
        if (remoteRestored) {
          byId.set(r.id, mergeItemAuditFields(applyLargeFieldPlaceholders(r, local), local));
          return;
        }
        const lastHistoryDate = (it: InventoryItem): string => {
          const hist = it.priceHistory || [];
          return hist.length ? String(hist[hist.length - 1]?.date || '') : '';
        };
        const localTs = lastHistoryDate(local);
        const remoteTs = lastHistoryDate(r);
        if (hasUnsavedChanges.current || !remoteTs || (localTs && localTs >= remoteTs)) {
          const kept = applyLargeFieldPlaceholders(local, r);
          byId.set(r.id, mergeItemAuditFields(kept, r));
          return;
        }
        // Remote's own sale is genuinely newer than anything local knows about — let it
        // through the normal remote-wins path below instead of returning here.
      }

      let changed = false;
      const out = { ...r };
      for (const key of largeFields) {
        const rv = (r as unknown as Record<string, unknown>)[key];
        const lv = (local as unknown as Record<string, unknown>)[key];
        if (rv === CLOUD_OMITTED_PLACEHOLDER && lv && typeof lv === 'string' && lv.length > 0) {
          (out as unknown as Record<string, unknown>)[key] = lv;
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
      // Never drop buy-price / sale-cycle history when either side has richer audit data.
      const withHistory = mergeItemAuditFields(changed ? withBuyDate : r, local);
      byId.set(r.id, withHistory);
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
    const remoteInv = (data.inventory || []) as InventoryItem[];
    const remoteTrash = (data.trash || []) as InventoryItem[];
    const localItems = itemsRef.current;
    const localTrash = trashRef.current;
    const ahead =
      localInventoryAheadOfRemote(remoteInv, localItems) ||
      localInventoryAheadOfRemote(remoteTrash, localTrash);
    if (ahead) {
      pendingCloudPushAfterRemoteRef.current = true;
      hasUnsavedChanges.current = true;
      requestFastCloudFlush();
    }
    const inventoryMatchesRemote =
      inventoryLooksUnchanged(localItems, remoteInv) &&
      inventoryLooksUnchanged(localTrash, remoteTrash);

    const localExpenses = expensesRef.current;
    const remoteExpenses = (data.expenses || []) as Expense[];
    const exp = mergeExpensesFromLocal(remoteExpenses, localExpenses);
    const remoteRecurring = (data.recurringExpenses || []) as RecurringExpense[];
    const localRecurring = recurringExpensesRef.current;
    const recurringMap = new Map<string, RecurringExpense>();
    localRecurring.forEach((r) => {
      if (r && r.id) recurringMap.set(r.id, r);
    });
    remoteRecurring.forEach((r) => {
      if (r && r.id) recurringMap.set(r.id, r);
    });
    const recurring = Array.from(recurringMap.values());
    const sets = data.settings || {};
    const goal = data.goals?.monthly ?? monthlyGoalRef.current;
    const cats = data.categories || categoriesRef.current;
    const fields = data.categoryFields || categoryFieldsRef.current;
    let dashToSave: DashboardPreferences = dashboardPrefsRef.current;
    if (data.dashboard != null) {
      dashToSave = normalizeDashboardPreferences(data.dashboard);
    }
    const localAH = actionHistoryRef.current;
    const remoteAH = Array.isArray(data.actionHistory) ? (data.actionHistory as ActionHistoryEntry[]) : [];
    const mergedAH = mergeActionHistoryFromLocal(remoteAH, localAH).slice(-ACTION_HISTORY_LIMIT);
    const localBI = bulkImportsRef.current;
    const remoteBI = Array.isArray(data.bulkImports) ? (data.bulkImports as BulkImportRecord[]) : [];
    const mergedBI = mergeBulkImportsFromLocal(remoteBI, localBI).slice(0, BULK_IMPORTS_LIMIT);
    if (localBulkImportsNeedCloudPush(mergedBI, remoteBI) && !inventoryMatchesRemote) {
      pendingCloudPushAfterRemoteRef.current = true;
      hasUnsavedChanges.current = true;
    }

    if (data.threeDPrint != null) {
      const merged3d = mergeThreeDPrintCloud(data.threeDPrint, threeDPrintCloudRef.current);
      applyingRemote3dRef.current = true;
      const saved3d = persistThreeDPrintCloudState(merged3d.state);
      applyingRemote3dRef.current = false;
      if (saved3d !== threeDPrintCloudRef.current) {
        setThreeDPrintCloud(saved3d);
        threeDPrintCloudRef.current = saved3d;
      }
      if (merged3d.localNewer) {
        pendingCloudPushAfterRemoteRef.current = true;
        hasUnsavedChanges.current = true;
      }
    } else if (!inventoryMatchesRemote && threeDPrintCloudRef.current && !threeDPrintCloudSeededRef.current) {
      threeDPrintCloudSeededRef.current = true;
      pendingCloudPushAfterRemoteRef.current = true;
      hasUnsavedChanges.current = true;
    }

    const applyCheapSlices = (flushSettingsDiff: boolean): BusinessSettings => {
      if (!expenseListLooksUnchanged(localExpenses, exp)) setExpenses(exp);
      if (!recurringLooksUnchanged(localRecurring, recurring)) setRecurringExpenses(recurring);
      if (data.dashboard != null && !smallJsonLooksUnchanged(dashboardPrefsRef.current, dashToSave)) {
        setDashboardPrefs(dashToSave);
      }
      if (!actionHistoryLooksUnchanged(localAH, mergedAH)) {
        setActionHistory(mergedAH);
        actionHistoryRef.current = mergedAH;
      }
      if (!bulkImportIdsLookUnchanged(localBI, mergedBI)) {
        setBulkImports(mergedBI);
        bulkImportsRef.current = mergedBI;
      }
      const { settings: mergedSettings, keptLocalFilled } = mergeBusinessSettings(
        businessSettingsRef.current,
        sets
      );
      const stampedSettings = stampInvoiceBusinessProfile(mergedSettings);
      const nextSettings = stampedSettings.settings;
      if (!smallJsonLooksUnchanged(businessSettingsRef.current, nextSettings)) {
        businessSettingsRef.current = nextSettings;
        setBusinessSettings(nextSettings);
      }
      if (!stampedSettings.changed) {
        markInvoiceBusinessProfileDone();
      }
      if (flushSettingsDiff && (keptLocalFilled || stampedSettings.changed)) {
        pendingCloudPushAfterRemoteRef.current = true;
        hasUnsavedChanges.current = true;
        requestFastCloudFlush();
      }
      if (goal !== monthlyGoalRef.current) setMonthlyGoal(goal);
      const nextCats = migrateCategoriesRecord(cats);
      if (!smallJsonLooksUnchanged(categoriesRef.current, nextCats)) setCategories(nextCats);
      if (!smallJsonLooksUnchanged(categoryFieldsRef.current, fields)) setCategoryFields(fields);
      return nextSettings;
    };

    if (inventoryMatchesRemote) {
      applyCheapSlices(false);
      return;
    }

    isRemoteUpdate.current = true;
    const localTrashIds = new Set(localTrash.map((i) => i.id).filter(Boolean));
    const inv = mergeInventoryWithLocal(remoteInv, localItems, localTrashIds);
    const tr = mergeInventoryWithLocal(remoteTrash, localTrash);
    if (
      inventoryLooksUnchanged(localItems, inv) &&
      inventoryLooksUnchanged(localTrash, tr)
    ) {
      applyCheapSlices(false);
      return;
    }

    const migratedInv = inv.map(migrateContainerItem);
    const { items: filledInv, updatedCount: filledCount } = backfillContainerBuyDates(migratedInv);
    const ramFix = applyCrucialRamInvoiceSaleFix(filledInv, businessSettingsRef.current.taxMode);
    const integralKit = restoreIntegralRamKit(ramFix.changed ? ramFix.items : filledInv, tr);
    const asusPc = restoreAsusA320mPcSale(integralKit.items);
    const healedParts = healActiveContainerPartMembership(asusPc.items);
    if (filledCount > 0 || ramFix.changed || integralKit.changed || asusPc.changed || healedParts.changed) {
      requestFastCloudFlush();
      hasUnsavedChanges.current = true;
      if (ramFix.changed || integralKit.changed || asusPc.changed || healedParts.changed) {
        pendingCloudPushAfterRemoteRef.current = true;
      }
    }
    let nextTrash = integralKit.trash.map(migrateContainerItem);
    if (healedParts.toTrash.length) {
      for (const row of healedParts.toTrash.map(migrateContainerItem)) {
        if (!nextTrash.some((t) => t.id === row.id)) nextTrash.push(row);
      }
    }
    if (
      inventoryLooksUnchanged(localItems, healedParts.items) &&
      inventoryLooksUnchanged(localTrash, nextTrash)
    ) {
      applyCheapSlices(false);
      return;
    }
    const nextSettings = applyCheapSlices(true);
    startTransition(() => {
      setItems(healedParts.items);
      setTrash(nextTrash);
    });
    clearUndoStackRef.current = true;
    const persistItems = healedParts.items;
    scheduleBackgroundWork(async () => {
      await persistSnapshotToLocalStorage({
        items: persistItems,
        trashJson: JSON.stringify(nextTrash),
        expensesJson: JSON.stringify(exp),
        settingsJson: JSON.stringify(nextSettings),
        monthlyGoal: goal.toString(),
        categoriesJson: JSON.stringify(cats),
        categoryFieldsJson: JSON.stringify(fields),
        recurringExpensesJson: JSON.stringify(recurring),
        dashboardPrefs: dashToSave,
        actionHistoryJson: JSON.stringify(mergedAH),
        bulkImportsJson: JSON.stringify(mergedBI),
      });
    });
  }, [mergeActionHistoryFromLocal, mergeExpensesFromLocal, mergeInventoryWithLocal, requestFastCloudFlush]);

  // Another tab/window (same browser) saved newer local inventory data than this tab has —
  // this is a narrow race between two tabs' local IndexedDB writes, not a real conflict; the
  // Firestore live listener above already keeps `items` current across devices/tabs on its
  // own. Reload automatically to pick up that newer local save, exactly as if this tab had
  // just now caught up live — but only when nothing here is unsaved yet, so a silent reload
  // can never discard an in-flight edit. If something IS unsaved, fall back to the banner
  // instead of autosaving here and silently overwriting the newer save.
  useEffect(() => {
    setInventoryItemsStaleListener(() => {
      if (hasUnsavedChanges.current) {
        setTabDataStale(true);
        return;
      }
      window.location.reload();
    });
    return () => setInventoryItemsStaleListener(null);
  }, []);

  // 1. BOOT: load local data and show app immediately; sync with Firestore in background
  useEffect(() => {
    try {
      if (localStorage.getItem('deinventory_local_only') !== '0') {
        localStorage.setItem('deinventory_local_only', '1');
      }
    } catch {
      /* ignore */
    }
    void loadLocalData(true).then(() => setAppState('READY'));
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
        threeDPrintCloudSeededRef.current = false;
        cloudHydratedRef.current = !isCloudEnabled();
        setCloudHydrated(!isCloudEnabled());
        ebayOrderIndexPulledRef.current = false;
        ebayTxReportsPulledRef.current = false;
        ebayListingDailyRefreshTriedRef.current = false;
        kaListingDailyRefreshTriedRef.current = false;
        setSyncState(prev => ({ ...prev, status: 'idle', message: undefined }));
        return;
      }
      setSyncState({ status: 'syncing', lastSynced: null, message: 'Downloading from Supabase…' });
      cloudHydratedRef.current = false;

      if (isSupabaseConfigured()) {
        void (async () => {
          try {
            const sbSnapshot = await fetchSupabaseSnapshotDirect(user.uid);
            if (sbSnapshot) {
              const payload = {
                inventory: sbSnapshot.items,
                trash: sbSnapshot.trash,
                expenses: sbSnapshot.expenses,
                recurringExpenses: sbSnapshot.recurringExpenses,
                categories: sbSnapshot.categories,
                categoryFields: sbSnapshot.categoryFields,
                settings: sbSnapshot.businessSettings,
                goals: { monthly: sbSnapshot.monthlyGoal },
                dashboard: sbSnapshot.dashboardPrefs,
                actionHistory: sbSnapshot.actionHistory,
                bulkImports: sbSnapshot.bulkImports,
                updatedAt: new Date().toISOString()
              };
              applyRemoteData(payload as any);
              markCloudHydrated();
              pendingCloudFlushRef.current = false;
              initialWriteDoneRef.current = true;
              setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
            } else {
              markCloudHydrated();
              pendingCloudFlushRef.current = false;
              initialWriteDoneRef.current = true;
              setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
            }
          } catch (err) {
            console.error('[supabase] Initial fetch failed:', err);
            markCloudHydrated();
            setSyncState({ status: 'error', message: 'Supabase sync error' });
          }
        })();

        unsubSnapshot = subscribeToSupabaseRealtime(() => {
          void (async () => {
            const updated = await fetchSupabaseSnapshotDirect(user.uid);
            if (updated) {
              applyRemoteData({
                inventory: updated.items,
                trash: updated.trash,
                expenses: updated.expenses,
                recurringExpenses: updated.recurringExpenses,
                categories: updated.categories,
                categoryFields: updated.categoryFields,
                settings: updated.businessSettings,
                goals: { monthly: updated.monthlyGoal },
                dashboard: updated.dashboardPrefs,
                actionHistory: updated.actionHistory,
                bulkImports: updated.bulkImports,
                updatedAt: new Date().toISOString()
              } as any);
            }
          })();
        });
      } else {
        unsubSnapshot = subscribeToData(user.uid, (data) => {
        scheduleBackgroundWork(async () => {
          await yieldToMain();
          if (data && shouldApplyRemoteSnapshot(data)) {
            const remoteTs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
            if (
              Number.isFinite(remoteTs) &&
              remoteTs > lastLocalPushAtRef.current + REMOTE_ECHO_TOLERANCE_MS
            ) {
              hasUnsavedChanges.current = false;
            }
            applyRemoteData(data);
          }
          if (data) {
            markCloudHydrated();
            pendingCloudFlushRef.current = false;
            initialWriteDoneRef.current = true;
          } else if (!initialWriteDoneRef.current) {
            initialWriteDoneRef.current = true;
            const localHasData =
              itemsRef.current.length > 0 ||
              trashRef.current.length > 0 ||
              expensesRef.current.length > 0;
            if (!localHasData) {
              markCloudHydrated();
              pendingCloudFlushRef.current = false;
            } else {
              try {
                const snap = getSyncSnapshot();
                await writeToCloud({
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
                });
                hasUnsavedChanges.current = false;
                lastLocalPushAtRef.current = Date.now();
                markCloudHydrated();
                pendingCloudFlushRef.current = false;
                suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
              } catch (err) {
                initialWriteDoneRef.current = false;
                cloudHydratedRef.current = false;
                setSyncState((prev) => ({ ...prev, status: 'error', message: getSyncErrorMessage(err) }));
                return;
              }
            }
          }
          remoteSnapshotSeenRef.current = true;
          setSyncState((prev) => {
            if (prev.status === 'success' && prev.message === SYNC_MSG_SYNCED) return prev;
            return { status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED };
          });
        });
      });
      }
    });
    return () => {
      if (unsubSnapshot) unsubSnapshot();
      if (unsubAuth) unsubAuth();
    };
  }, [applyRemoteData, getSyncSnapshot, shouldApplyRemoteSnapshot]);

  /**
   * `applyPendingPatches` (boot only): the tiny synchronous localStorage log written by
   * every edit (see handleUpdate) may hold changes newer than the last successful
   * IndexedDB write, e.g. after a crash between two debounced saves. Merge them in and
   * mark unsaved so the normal save path immediately re-persists the merged result.
   */
  const loadLocalData = async (applyPendingPatches = false) => {
    const baseItems = await loadInventoryItemsForBoot();
    let effectiveItems = baseItems;
    if (applyPendingPatches) {
      const pending = readPendingItemPatches();
      if (pending.length) {
        const byId = new Map(baseItems.map((i) => [i.id, i]));
        for (const patch of pending) byId.set(patch.id, patch);
        effectiveItems = Array.from(byId.values());
        hasUnsavedChanges.current = true;
      }
    }
    const migrated = effectiveItems.map(migrateContainerItem);
    // Preserve object identity for rows nothing actually changed — see
    // mergeItemsPreservingReferences for why a wholesale replace here is expensive.
    setItems(mergeItemsPreservingReferences(itemsRef.current, migrated));
    const localTrash = JSON.parse(localStorage.getItem('inventory_trash') || '[]') as InventoryItem[];
    setTrash(localTrash.map(migrateContainerItem));
    setExpenses(JSON.parse(localStorage.getItem('inventory_expenses') || '[]'));
    setRecurringExpenses(JSON.parse(localStorage.getItem('recurring_expenses') || '[]'));
    setCategories((prev) => migrateCategoriesRecord(prev));
    setBulkImports(loadBulkImportsFromStorage());
  };

  // Live cross-tab sync via the `storage` event is DISABLED. It worked for the write
  // path itself, but re-running loadLocalData() mid-session put a freshly-merged `items`
  // array in front of this app's many other items-watching effects (container/backfill
  // healers, membership sync, etc.) at a point in the render cycle they weren't written
  // to expect — that's what caused the freeze-then-reload, the flicker, and ultimately a
  // real data loss (a link vanishing again). Each fix here surfaced a new interaction bug
  // with those other effects, which isn't an acceptable trade against real order data.
  // The IndexedDB storage, write-ahead log, and coalescing writes above are unaffected —
  // your edits are still safe against crashes/refreshes, and refreshing a second tab
  // (F5) still reliably picks up whatever another tab last saved.
  //
  // If cross-tab live sync is revisited later, do it as a pure read-side effect that
  // never calls setItems() outside the normal boot path — e.g. a lightweight banner
  // ("newer data available — click to reload") — rather than merging into live state.

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
  // Re-run only while blanks exist — skip the full scan when every container already has a date.
  useEffect(() => {
    if (appState !== 'READY' || items.length === 0) return;
    if (isCloudEnabled() && authUser && !cloudHydrated) return;
    if (countBlankContainerBuyDates(items) === 0) return;
    const { items: next, updatedCount } = backfillContainerBuyDates(items);
    if (updatedCount === 0) return;
    requestFastCloudFlush();
    setItems(next);
    hasUnsavedChanges.current = true;
  }, [appState, authUser, cloudHydrated, items, requestFastCloudFlush]);

  // Replace DAK Gesundheit history with bank-accurate rows + start AOK Bayern on the 17th.
  useEffect(() => {
    if (appState !== 'READY') return;
    if (healthInsuranceLedgerDoneRef.current) return;
    const next = applyHealthInsuranceLedger(expenses, recurringExpenses);
    healthInsuranceLedgerDoneRef.current = true;
    if (!next.changed) return;
    setExpenses(next.expenses);
    setRecurringExpenses(next.recurring);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [appState, expenses, recurringExpenses, requestFastCloudFlush]);

  // Historical sale/heal patches — once after cloud hydrate (remote apply runs its own copy).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (isCloudEnabled() && authUser && !cloudHydrated) return;
    if (inventoryBootHealsDoneRef.current) return;

    const taxMode = businessSettingsRef.current.taxMode || 'SmallBusiness';
    let nextItems = itemsRef.current;
    if (!nextItems.length) return;
    inventoryBootHealsDoneRef.current = true;
    let nextTrash = trashRef.current;
    let changed = false;
    let clearUndo = false;

    const applyItems = (result: { items: InventoryItem[]; changed: boolean }, opts?: { clearUndo?: boolean }) => {
      if (!result.changed) return;
      nextItems = result.items;
      changed = true;
      if (opts?.clearUndo) clearUndo = true;
    };

    applyItems(applyCrucialRamInvoiceSaleFix(nextItems, taxMode));
    applyItems(applyAsusGtx1080RogStrixHubSaleFix(nextItems, taxMode));
    applyItems(applyRx6500XtHubSellSync(nextItems, taxMode));
    applyItems(applySamsungEvo840RefundResale(nextItems, taxMode), { clearUndo: true });

    const integralKit = restoreIntegralRamKit(nextItems, nextTrash);
    if (integralKit.changed) {
      nextItems = integralKit.items;
      nextTrash = integralKit.trash;
      changed = true;
      addRecentItemId(INTEGRAL_RAM_KIT_ID);
    }

    applyItems(restoreAsusA320mPcSale(nextItems), { clearUndo: true });

    if (!changed) return;
    if (clearUndo) clearUndoStackRef.current = true;
    setItems(nextItems);
    if (nextTrash !== trashRef.current) setTrash(nextTrash);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [appState, authUser, cloudHydrated, items.length, requestFastCloudFlush]);

  // After return/restock: nest Active PC parts and drop ghost standalone duplicates (boot + remote apply only).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (isCloudEnabled() && authUser && !cloudHydrated) return;
    if (containerMembershipBootHealDoneRef.current) return;

    const current = itemsRef.current;
    if (!current.length) return;
    containerMembershipBootHealDoneRef.current = true;
    const next = healActiveContainerPartMembership(current);
    if (!next.changed) return;
    clearUndoStackRef.current = true;
    setItems(next.items);
    if (next.toTrash.length) {
      setTrash((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        return [...prev, ...next.toTrash.filter((t) => !ids.has(t.id))];
      });
    }
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [appState, authUser, cloudHydrated, items.length, requestFastCloudFlush]);

  // Bulk-import chat proof + bulkImportId stamp — once after hydrate (not on every item edit).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (isCloudEnabled() && authUser && !cloudHydrated) return;
    if (bulkImportCrossLinkDoneRef.current) return;

    const currentItems = itemsRef.current;
    const currentBulk = bulkImportsRef.current;
    if (!currentBulk.length || !currentItems.length) return;
    bulkImportCrossLinkDoneRef.current = true;

    const enriched = enrichBulkImportsWithChatProof(currentBulk, currentItems);
    if (enriched.changed) {
      setBulkImports(enriched.records);
      bulkImportsRef.current = enriched.records;
      localStorage.setItem('bulk_imports', JSON.stringify(enriched.records));
      hasUnsavedChanges.current = true;
    }

    const stamped = stampItemsFromBulkImportRecords(currentItems, enriched.records);
    if (!stamped.changed) return;
    setItems(stamped.items);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [appState, authUser, cloudHydrated, items.length, bulkImports.length, requestFastCloudFlush]);

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
    void saveToLocalStorage(newItems, trash, expenses, businessSettings, monthlyGoal, newCategories, newFields, recurringExpenses);
    localStorage.setItem(OPTICAL_DRIVES_MIGRATION_KEY, '1');
  }, [appState, items, categories, categoryFields, trash, expenses, businessSettings, monthlyGoal, recurringExpenses]);

  // One-time: after renaming Components > Graphics Cards → GPU in Settings, remap stale item.subCategory values.
  const GPU_SUBCATEGORY_MIGRATION_KEY = 'migration_graphics_cards_to_gpu_v1';
  useEffect(() => {
    if (appState !== 'READY') return;
    if (localStorage.getItem(GPU_SUBCATEGORY_MIGRATION_KEY) === '1') return;
    const next = migrateLegacyGpuSubcategoryNames({ categories, categoryFields, items });
    if (!next.changed) {
      // Only mark done when Components already has GPU (rename already happened) or there is nothing to do.
      if ((categories.Components || []).includes('GPU') || items.length === 0) {
        localStorage.setItem(GPU_SUBCATEGORY_MIGRATION_KEY, '1');
      }
      return;
    }
    setItems(next.items);
    setCategories(next.categories);
    setCategoryFields(next.categoryFields);
    hasUnsavedChanges.current = true;
    localStorage.setItem(GPU_SUBCATEGORY_MIGRATION_KEY, '1');
  }, [appState, items, categories, categoryFields]);

  // First Firestore snapshot (from subscribeToData) hydrates or seeds cloud.
  // A second getDocs pull used to download the same ~1.5MiB pack and freeze the tab.

  // Re-hydrate eBay caches after the UI is quiet so this never freezes scrolling.
  useEffect(() => {
    if (!authUser || !isCloudEnabled() || ebayOrderIndexPulledRef.current) return;
    ebayOrderIndexPulledRef.current = true;
    scheduleBackgroundWork(() => {
      void pullOrderIndexFromCloud().catch((e) => console.warn('eBay order index cloud pull failed:', e));
      void pullPurchaseIndexFromCloud().catch((e) => console.warn('eBay purchase index cloud pull failed:', e));
      void pullListingIndexFromCloud().catch((e) => console.warn('eBay listing index cloud pull failed:', e));
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !isCloudEnabled() || ebayTxReportsPulledRef.current) return;
    ebayTxReportsPulledRef.current = true;
    scheduleBackgroundWork(() => {
      void runEbayTxCloudSyncOnce();
    });
  }, [authUser]);

  // Pull new eBay orders via the API on every visit, not just when the Abrechnung page
  // happens to be open — used to require actually going there first. Runs once per
  // session, fully silently (no banner — that was tried before and was distracting on
  // every panel page); Abrechnung's own "Sync eBay orders" button still force-refreshes
  // on demand. Safe to call runEbayTxCloudSyncOnce() again here even though the effect
  // above already does — it's memoized and everyone just awaits the same in-flight pull.
  useEffect(() => {
    if (appState !== 'READY' || ebayApiOrderSyncTriedRef.current) return;
    ebayApiOrderSyncTriedRef.current = true;
    scheduleBackgroundWork(async () => {
      try {
        await runEbayTxCloudSyncOnce();
        const outcome = await syncNewEbayOrdersOnAppVisit();
        if (outcome.status === 'ok' && outcome.added > 0) {
          console.info(`[ebay-order-sync] ${outcome.added} new order(s) pulled in the background.`);
        }
      } catch (e) {
        // Never surface as a blocking error — Abrechnung's own Sync button retries on demand.
        console.warn('[ebay-order-sync] Background sync failed:', e);
      }
    });
  }, [appState]);

  // Keep eBay active-listing cache fresh for photo import:
  // once per local calendar day on app boot, run one forced refresh.
  useEffect(() => {
    if (appState !== 'READY' || ebayListingDailyRefreshTriedRef.current) return;
    ebayListingDailyRefreshTriedRef.current = true;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const lastRunKey = localStorage.getItem(EBAY_LISTINGS_DAILY_BOOT_REFRESH_KEY) || '';
    if (lastRunKey === todayKey) return;
    void ensureEbayListings({ force: true })
      .then(() => {
        localStorage.setItem(EBAY_LISTINGS_DAILY_BOOT_REFRESH_KEY, todayKey);
      })
      .catch((e) => {
        // Non-blocking: user can still work, and retry happens on next launch/day.
        console.warn('eBay daily listing refresh failed:', e);
      });
  }, [appState]);

  // Keep Kleinanzeigen profile listing cache fresh for photo import:
  // once per local calendar day on app boot, run one forced refresh.
  useEffect(() => {
    if (appState !== 'READY' || kaListingDailyRefreshTriedRef.current) return;
    kaListingDailyRefreshTriedRef.current = true;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const lastRunKey = localStorage.getItem(KA_LISTINGS_DAILY_BOOT_REFRESH_KEY) || '';
    if (lastRunKey === todayKey) return;
    void ensureKaListings({ force: true })
      .then((result) => {
        if (!result.fromCache || result.listings.length > 0) {
          localStorage.setItem(KA_LISTINGS_DAILY_BOOT_REFRESH_KEY, todayKey);
        }
      })
      .catch((e) => {
        console.warn('Kleinanzeigen daily listing refresh failed:', e);
      });
  }, [appState]);

  // Weekly background photo storage optimization for items sold > 30 days
  useEffect(() => {
    if (appState !== 'READY' || !items.length) return;
    const t = setTimeout(() => {
      scheduleBackgroundWork(async () => {
        await runWeeklyPhotoPruneIfDue(itemsRef.current, (updatedItems) => {
          setItems(updatedItems);
        });
      });
    }, 35000);
    return () => clearTimeout(t);
  }, [appState]);

  // Hydrate Reinvest gamification state (bank, quests, achievements) from its own doc — same
  // pull-on-boot pattern as the eBay indexes above, kept out of the main syncPack blob.
  useEffect(() => {
    if (!authUser || !isCloudEnabled() || gamificationPulledRef.current) return;
    gamificationPulledRef.current = true;
    void fetchGamificationState()
      .then((remote) => {
        if (!remote) return;
        setGamificationState(
          ensureFreshMonth(ensureFreshDay({ ...defaultGamificationState(), ...remote } as GamificationState)),
        );
      })
      .catch((e) => console.warn('Gamification cloud pull failed:', e));
  }, [authUser]);

  // Daily off-site snapshot to Firebase Storage. Runs once per local calendar day, built from
  // the already-loaded app state (zero extra Firestore reads) and deferred well past first paint
  // so it never competes with boot or the initial cloud sync.
  useEffect(() => {
    if (!isCloudEnabled() || !authUser || appState !== 'READY') return;
    if (dailyBackupRanRef.current || items.length === 0) return;
    dailyBackupRanRef.current = true;
    const t = setTimeout(() => {
      const snap = getSyncSnapshot();
      scheduleBackgroundWork(async () => {
        try {
          const result = await runDailyBackupIfDue({
            inventory: snap.items,
            trash: snap.trash,
            expenses: snap.expenses,
            recurringExpenses: snap.recurringExpenses,
            categories: snap.categories,
            categoryFields: snap.categoryFields,
            settings: snap.businessSettings,
            goals: { monthly: snap.monthlyGoal },
            dashboard: snap.dashboardPrefs,
            actionHistory: snap.actionHistory,
            bulkImports: snap.bulkImports,
          });
          if (result.ran) {
            console.info(
              `[backup] Saved ${result.fileName} (${Math.round(result.bytes / 1024)} KB)` +
                (result.deleted.length ? `, pruned ${result.deleted.length} old snapshot(s)` : ''),
            );
          }
        } catch (e) {
          // Never surface as a blocking error — the next boot retries.
          console.warn('[backup] Daily snapshot failed:', e);
        }
      });
    }, 25000);
    return () => clearTimeout(t);
  }, [authUser, appState, items.length, getSyncSnapshot]);

  // Shared by both triggers below: the on-open timer and the tab-close/hide listener.
  // runDailyGitHubBackupIfDue's own localStorage-dated gate ("already pushed today") is
  // the real throttle — whichever trigger fires first each day wins, the other is a no-op.
  // The in-flight ref only prevents two overlapping pushes racing (e.g. rapid tab-switching)
  // before that gate's write actually lands.
  const runGithubBackupIfDue = useCallback(async () => {
    if (githubBackupInFlightRef.current) return;
    if (!getStoredGitHubBackupConfig()) return;
    const snap = getSyncSnapshot();
    if (!snap.items.length) return;
    githubBackupInFlightRef.current = true;
    try {
      const [txLibrary, txLabelOverrides] = await Promise.all([
        loadEbayTransactionLibrary(),
        loadEbayTxLabelOverrides(),
      ]);
      const result = await runDailyGitHubBackupIfDue(
        {
          inventory: snap.items,
          trash: snap.trash,
          expenses: snap.expenses,
          recurringExpenses: snap.recurringExpenses,
          categories: snap.categories,
          categoryFields: snap.categoryFields,
          settings: snap.businessSettings,
          goals: { monthly: snap.monthlyGoal },
          dashboard: snap.dashboardPrefs,
          actionHistory: snap.actionHistory,
          bulkImports: snap.bulkImports,
          ebayOrders: loadEbayOrderIndex().orders,
          ebayTxReports: txLibrary.reports,
          ebayTxLabelOverrides: txLabelOverrides,
        },
        todayLocalDateKey(),
      );
      if (result.ran) {
        console.info(`[github-backup] Pushed snapshot (${result.sha.slice(0, 7)})`);
      }
    } catch (e) {
      // Never surface as a blocking error — the next open/close (or manual sync) retries.
      console.warn('[github-backup] Snapshot push failed:', e);
    } finally {
      githubBackupInFlightRef.current = false;
    }
  }, [getSyncSnapshot]);

  // Daily GitHub snapshot on open — independent of Firestore/cloud sync, works from any
  // device (phone, PC, deployed site, local dev) as long as this browser has a saved
  // repo/token (Settings > Backup). Each push is its own commit, so git history is the
  // retention. Belt-and-suspenders alongside the close/hide trigger below — most days,
  // that one fires first and this is a no-op.
  useEffect(() => {
    if (appState !== 'READY') return;
    if (dailyGitHubBackupRanRef.current || items.length === 0) return;
    if (!getStoredGitHubBackupConfig()) return;
    dailyGitHubBackupRanRef.current = true;
    const t = setTimeout(() => {
      scheduleBackgroundWork(runGithubBackupIfDue);
    }, 30000);
    return () => clearTimeout(t);
  }, [appState, items.length, runGithubBackupIfDue]);

  // Same GitHub snapshot, triggered by leaving the app instead of opening it — covers the
  // common case of never keeping the tab open for 30s straight. `visibilitychange` (tab
  // switched away, phone backgrounded, or the tab closing) is the reliable signal here;
  // `beforeunload`/`unload` are increasingly restricted and unreliable on mobile Safari.
  // `pagehide` is a second safety net for the actual-close case. Both funnel into the same
  // once-per-day gate above, so switching tabs repeatedly never triggers more than one push.
  useEffect(() => {
    if (appState !== 'READY') return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      void runGithubBackupIfDue();
    };
    // pagehide fires unconditionally on actual close/navigation — no visibility check needed.
    const onPageHide = () => void runGithubBackupIfDue();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [appState, runGithubBackupIfDue]);

  // Daily CSV copy of the Abrechnung table into data/ebay-abrechnung/ (local dev server only).
  useEffect(() => {
    if (appState !== 'READY') return;
    if (ebayTxDailyExportRanRef.current) return;
    ebayTxDailyExportRanRef.current = true;
    const t = setTimeout(() => {
      scheduleBackgroundWork(async () => {
        try {
          const result = await runEbayTxDailyCsvExport();
          if (result.ran) {
            console.info(
              `[ebay-abrechnung] Saved ${result.fileName} (${result.rowCount} rows, ${Math.round(result.bytes / 1024)} KB)` +
                (result.coverage ? ` · ${result.coverage}` : ''),
            );
          }
        } catch (e) {
          console.warn('[ebay-abrechnung] Daily CSV export failed:', e);
        }
      });
    }, 26000);
    return () => clearTimeout(t);
  }, [appState]);

  // Publish store catalog once when panel has items and auth (ensures storefront gets data)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser || items.length === 0 || storeCatalogPublishDoneRef.current) return;
    storeCatalogPublishDoneRef.current = true;
    const t = setTimeout(() => {
      const snapItems = itemsRef.current;
      const snapFields = categoryFieldsRef.current;
      scheduleBackgroundWork(async () => {
        await writeStoreCatalog(buildStoreCatalog(snapItems, snapFields)).catch(() => {});
      });
    }, 4000);
    return () => clearTimeout(t);
  }, [authUser, items.length, isCloudEnabled(), items, categoryFields]);

  // Publish store catalog soon after real local edits (long debounce, idle work)
  useEffect(() => {
    if (!isCloudEnabled() || !authUser) return;
    if (!hasUnsavedChanges.current) return;
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
    const signature = recurringExpenses
      .map((r) => `${r.id}:${r.startDate}:${r.monthlyAmount}:${r.category}:${r.description}:${r.lastGeneratedDate || ''}`)
      .join('|');
    if (signature === recurringGenRef.current) return; // Already processed this state
    
    let hasNewExpenses = false;
    const newExpenses: Expense[] = [];
    const updatedRecurring: RecurringExpense[] = [];
    
    const toDateOnlyLocal = (date: Date): string => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const plusOneDay = (dateStr: string): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
      if (!m) return dateStr;
      const shifted = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
      return toDateOnlyLocal(shifted);
    };

    // Use current expenses state to check for duplicates and to self-heal legacy UTC-shifted recurring dates.
    setExpenses(currentExpenses => {
      let workingExpenses = currentExpenses.map((expense) => {
        if (!expense.recurringExpenseId || !expense.date) return expense;
        const shifted = plusOneDay(expense.date);
        // Legacy bug wrote recurring rows as last day of previous month (UTC shift from local 1st).
        if (!shifted.endsWith('-01')) return expense;
        return { ...expense, date: shifted };
      });

      // De-duplicate possible collisions after date normalization.
      const normalizedDedup = new Set<string>();
      workingExpenses = workingExpenses.filter((expense) => {
        if (!expense.recurringExpenseId) return true;
        const key = `${expense.recurringExpenseId}:${expense.date}:${expense.description}:${Number(expense.amount) || 0}`;
        if (normalizedDedup.has(key)) return false;
        normalizedDedup.add(key);
        return true;
      });

      for (const recurring of recurringExpenses) {
        const { expenses: generated, lastGeneratedDate } = generateExpensesFromRecurring(recurring, workingExpenses);
        if (generated.length > 0) {
          hasNewExpenses = true;
          newExpenses.push(...generated);
          updatedRecurring.push({ ...recurring, lastGeneratedDate });
        } else {
          updatedRecurring.push(recurring);
        }
      }

      // Keep already generated rows in sync when recurring details are edited.
      workingExpenses = workingExpenses.map((expense) => {
        if (!expense.recurringExpenseId) return expense;
        const recurring = recurringExpenses.find((r) => r.id === expense.recurringExpenseId);
        if (!recurring) return expense;
        if (
          expense.amount === recurring.monthlyAmount &&
          expense.description === recurring.description &&
          expense.category === recurring.category
        ) {
          return expense;
        }
        return {
          ...expense,
          amount: recurring.monthlyAmount,
          description: recurring.description,
          category: recurring.category,
        };
      });
      
      if (hasNewExpenses) {
        // Update recurring expenses with new lastGeneratedDate values
        setRecurringExpenses(updatedRecurring);
        recurringGenRef.current = updatedRecurring
          .map((r) => `${r.id}:${r.startDate}:${r.monthlyAmount}:${r.category}:${r.description}:${r.lastGeneratedDate || ''}`)
          .join('|');
        
        // Add new generated expenses
        const existingIds = new Set(workingExpenses.map(e => e.id));
        const uniqueNew = newExpenses.filter(e => !existingIds.has(e.id));
        hasUnsavedChanges.current = true;
        requestFastCloudFlush();
        return [...workingExpenses, ...uniqueNew];
      }
      
      return workingExpenses;
    });
  }, [appState, recurringExpenses, requestFastCloudFlush]);

  const runSilentCloudSync = useCallback(async () => {
    if (!isCloudEnabled() || !authUser) return;
    // Wait until the first cloud pull finishes — never upload a blank phone cache first.
    if (!cloudHydratedRef.current) {
      pendingCloudFlushRef.current = true;
      return;
    }
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
      threeDPrint: snap.threeDPrint,
    };
    try {
      if (isSupabaseConfigured()) {
        await writeFullAppStateToSupabase({
          items: snap.items,
          trash: snap.trash,
          expenses: snap.expenses,
          recurringExpenses: snap.recurringExpenses,
          categories: snap.categories,
          categoryFields: snap.categoryFields,
          businessSettings: snap.businessSettings,
          monthlyGoal: snap.monthlyGoal,
          dashboardPrefs: snap.dashboardPrefs,
          actionHistory: snap.actionHistory,
          bulkImports: snap.bulkImports,
        });
      } else {
        const cloudSyncTimeoutMs = Math.min(60000, Math.max(20000, snap.items.length * 20));
        await withTimeout(writeToCloud(payload), cloudSyncTimeoutMs, 'Cloud sync');
      }
      hasUnsavedChanges.current = false;
      lastLocalPushAtRef.current = Date.now();
      suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
      setSyncState({ status: 'success', lastSynced: new Date(), message: SYNC_MSG_SYNCED });
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

  // When remote merge kept local-only rows (sold ahead of cloud, bulk history), push immediately.
  useEffect(() => {
    if (!pendingCloudPushAfterRemoteRef.current) return;
    if (!authUser || !isCloudEnabled() || !cloudHydratedRef.current) return;
    pendingCloudPushAfterRemoteRef.current = false;
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    writeDebounceRef.current = setTimeout(() => {
      writeDebounceRef.current = null;
      void runSilentCloudSync();
    }, FAST_CLOUD_FLUSH_MS);
  }, [bulkImports, items, trash, authUser, requestFastCloudFlush, runSilentCloudSync]);

  useEffect(() => {
    runSilentCloudSyncRef.current = runSilentCloudSync;
  }, [runSilentCloudSync]);

  /** Dashboard filters/widgets — local save immediately; cloud uses a slow debounce (never re-stringify inventory). */
  const handleDashboardPreferencesChange = useCallback(
    (next: DashboardPreferences) => {
      setDashboardPrefs((prev) => {
        if (smallJsonLooksUnchanged(prev, next)) return prev;
        dashboardPrefsRef.current = next;
        persistDashboardPreferencesToLocalStorage(next);
        hasUnsavedChanges.current = true;
        if (dashboardCloudDebounceRef.current) clearTimeout(dashboardCloudDebounceRef.current);
        dashboardCloudDebounceRef.current = setTimeout(() => {
          dashboardCloudDebounceRef.current = null;
          if (!isCloudEnabled() || !authUser || !cloudHydratedRef.current) return;
          if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
          writeDebounceRef.current = setTimeout(() => {
            writeDebounceRef.current = null;
            void runSilentCloudSyncRef.current?.();
          }, 400);
        }, 2500);
        return next;
      });
    },
    [authUser]
  );

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
    const remoteApply = isRemoteUpdate.current;
    if (remoteApply) {
      isRemoteUpdate.current = false;
      // Remote merge can keep local sold rows ahead of cloud — still upload in that case.
      if (!hasUnsavedChanges.current) return;
    }
    if (localPersistDebounceRef.current) clearTimeout(localPersistDebounceRef.current);
    localPersistDebounceRef.current = setTimeout(() => {
      localPersistDebounceRef.current = null;
      const snap = getSyncSnapshot();
      scheduleBackgroundWork(async () => {
        await persistSnapshotToLocalStorage({
          items: snap.items,
          trashJson: JSON.stringify(snap.trash),
          expensesJson: JSON.stringify(snap.expenses),
          settingsJson: JSON.stringify(snap.businessSettings),
          monthlyGoal: snap.monthlyGoal.toString(),
          categoriesJson: JSON.stringify(snap.categories),
          categoryFieldsJson: JSON.stringify(snap.categoryFields),
          recurringExpensesJson: JSON.stringify(snap.recurringExpenses),
          dashboardPrefs: snap.dashboardPrefs,
          // action_history / bulk_imports are NOT written here — the dedicated
          // 1.2s-debounced effects below own those two keys, so an ordinary
          // item edit doesn't re-stringify+write them twice on every save.
        });
        // Cloud users: the cloud-sync success path is what clears this flag, tracking
        // "still needs a cloud push" independently of the local save completing. Local-only
        // mode has no such second consumer — nothing else was ever going to clear it, which
        // left it stuck true forever after the first edit and permanently blocked the
        // cross-tab storage listener's "don't clobber my pending edit" guard.
        if (!isCloudEnabled()) {
          hasUnsavedChanges.current = false;
        }
      });
    }, LOCAL_PERSIST_DEBOUNCE_MS);

    if (!isCloudEnabled() || !authUser || !cloudHydratedRef.current || !hasUnsavedChanges.current) {
      return () => {
        if (localPersistDebounceRef.current) clearTimeout(localPersistDebounceRef.current);
      };
    }
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    const delay = resolveCloudFlushDelay(
      preferredCloudFlushMsRef.current,
      inventoryCloudDebounceMs(itemsRef.current.length)
    );
    preferredCloudFlushMsRef.current = inventoryCloudDebounceMs(itemsRef.current.length);
    setSyncState((prev) => {
      if (prev.status === 'syncing' || prev.status === 'pending') return prev;
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
  }, [appState, authUser, items, trash, expenses, recurringExpenses, businessSettings, monthlyGoal, categories, categoryFields, getSyncSnapshot, runSilentCloudSync]);

  // Emergency synchronous local save on tab hide/close — independent of cloud. Items
  // themselves don't need handling here: handleUpdate writes each edit synchronously to
  // the tiny pending-patches log (see inventoryItemsStore.ts) the instant it happens, so
  // they're already durable before any unload event could fire. This just covers the
  // smaller trash/expenses lists, which still live directly in localStorage.
  useEffect(() => {
    const flushLocalNow = () => {
      if (!hasUnsavedChanges.current) return;
      if (localPersistDebounceRef.current) {
        clearTimeout(localPersistDebounceRef.current);
        localPersistDebounceRef.current = null;
      }
      try {
        const snap = getSyncSnapshot();
        localStorage.setItem('inventory_trash', JSON.stringify(snap.trash));
        localStorage.setItem('inventory_expenses', JSON.stringify(snap.expenses));
      } catch (e) {
        console.warn('[persist] Emergency local flush failed:', e);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushLocalNow();
    };
    window.addEventListener('beforeunload', flushLocalNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushLocalNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [getSyncSnapshot]);

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

  const handleBusinessSettingsChange = useCallback((next: BusinessSettings) => {
    businessSettingsRef.current = next;
    setBusinessSettings(next);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    try {
      localStorage.setItem('business_settings', JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }, [requestFastCloudFlush]);

  // Stamp seller name + N26 bank details for invoices (once; later Settings edits stick).
  useEffect(() => {
    if (appState !== 'READY') return;
    const next = stampInvoiceBusinessProfile(businessSettings);
    if (next.changed) {
      handleBusinessSettingsChange(next.settings);
    }
    if (!isCloudEnabled()) markInvoiceBusinessProfileDone();
  }, [appState, businessSettings, handleBusinessSettingsChange]);

  const handleForcePush = async () => {
    if (!isCloudEnabled() || !authUser) return false;
    setSyncState(prev => ({ ...prev, status: 'syncing', message: SYNC_MSG_UPLOADING }));
    const snap = getSyncSnapshot();
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
      threeDPrint: snap.threeDPrint,
    };
    try {
      cloudSyncInFlightRef.current = true;
      const forcePushTimeoutMs = Math.min(60000, Math.max(20000, snap.items.length * 20));
      await withTimeout(writeToCloud(payload, { allowEmptyOverwrite: true }), forcePushTimeoutMs, 'Cloud sync');
      hasUnsavedChanges.current = false;
      lastLocalPushAtRef.current = Date.now();
      suppressRemoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
      scheduleBackgroundWork(async () => {
        await persistSnapshotToLocalStorage({
          items: snap.items,
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
        });
      });
      scheduleBackgroundWork(async () => {
        await writeStoreCatalog(buildStoreCatalog(snap.items, snap.categoryFields)).catch((e) => console.warn('Store catalog update failed', e));
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

  // Undo stack lives in refs so a single-item edit does not extra-render App.
  const pushUndoSnapshot = useCallback(
    (
      currentItems: InventoryItem[],
      nextItems: InventoryItem[],
      currentTrash?: InventoryItem[],
      nextTrash?: InventoryItem[]
    ) => {
      const fromTrash = currentTrash ?? trashRef.current;
      const toTrash = nextTrash ?? trashRef.current;
      const { base, nextIdx } = appendUndoHistory(
        historyRef.current,
        historyIndexRef.current,
        makeUndoSnapshot(currentItems, fromTrash),
        makeUndoSnapshot(nextItems, toTrash)
      );
      historyRef.current = base;
      historyIndexRef.current = nextIdx;
    },
    []
  );

  // Cloud remounted inventory — start a fresh undo baseline from the applied snapshot.
  useEffect(() => {
    if (!clearUndoStackRef.current) return;
    clearUndoStackRef.current = false;
    const snap = makeUndoSnapshot(items, trashRef.current);
    historyRef.current = [snap];
    historyIndexRef.current = 0;
  }, [items]);

  const addActionEntries = useCallback((entries: ActionHistoryEntry[]) => {
    if (!entries.length) return;
    setActionHistory((prev) => [...prev, ...entries].slice(-ACTION_HISTORY_LIMIT));
  }, []);
  
  const handleUpdate = useCallback((updatedItems: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => {
    // Synchronous and tiny — durable the instant this call returns, before React has even
    // committed the state update. This is what makes a refresh mid-edit safe: the debounced
    // IndexedDB write below can lag by a few seconds, but this can't.
    appendPendingItemPatches(updatedItems);
    if (isSupabaseConfigured()) {
      void saveItemChangesToSupabase(updatedItems, deleteIds).catch(err => {
        console.warn('[supabase] Incremental item push failed (non-fatal, will retry):', err);
      });
    }
    const recordAction = !options?.skipActionLog;
    const recordUndo = !options?.skipUndo;
    const disposed = (s: ItemStatus | undefined) =>
      s === ItemStatus.SOLD || s === ItemStatus.TRADED || s === ItemStatus.GIFTED;
    const current = itemsRef.current;
    const currentById = new Map(current.map((i) => [i.id, i]));
    let createdContainers = false;
    let statusTransition = false;
    for (const u of updatedItems) {
      const oldItem = currentById.get(u.id);
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

    const preserveMissingFields = !options?.skipFieldPreserve;
    const itemsToApply = updatedItems;

    setItems(currentItems => {
        let nextItems = currentItems.slice();
        const indexById = new Map<string, number>();
        for (let i = 0; i < nextItems.length; i++) indexById.set(nextItems[i].id, i);
        const actionEntries: ActionHistoryEntry[] = [];
        const trashBefore = trashRef.current;
        let nextTrash = trashBefore;
        let nextAssetTagNum = maxAssetTagNumber(nextItems, trashBefore);
        const addToTrash = (rows: InventoryItem[]) => {
          if (!rows.length) return;
          const existing = new Set(nextTrash.map((t) => t.id));
          nextTrash = [...nextTrash, ...rows.filter((r) => !existing.has(r.id))];
        };
        itemsToApply.forEach(u => {
          const idx = indexById.has(u.id) ? indexById.get(u.id)! : -1;
          const oldItem = idx >= 0 ? nextItems[idx] : undefined;
          const merged = options?.skipPriceHistory
            ? u
            : appendPriceHistoryIfChanged(oldItem, u);
          // Preserve store and other fields from old item when update doesn't provide them (e.g. rename in inventory form)
          const final0 =
            oldItem && idx >= 0 && preserveMissingFields ? applyPreservedFields(oldItem, merged) : merged;
          let final = final0;
          if (oldItem?.costOrigin) {
            final = { ...final, costOrigin: oldItem.costOrigin };
          }
          final = recomputeRealizedProfit(final);
          final = recordMembershipChangeIfAny(oldItem, final, (bundleId) => {
            const bundleIdx = indexById.get(bundleId);
            if (bundleIdx != null && nextItems[bundleIdx]) return nextItems[bundleIdx].name;
            return currentById.get(bundleId)?.name;
          });
          if (final.status === ItemStatus.SOLD || final.status === ItemStatus.TRADED || final.status === ItemStatus.GIFTED) {
            final = { ...final, storeVisible: false };
          }
          // Compute rich structured diff for item timeline and global action history
          const { historyEntry, actionEntry } = computeItemHistoryDiff(oldItem, final, options?.actionNote);
          final = appendItemHistoryEntry(final, historyEntry);

          if (idx >= 0) {
            nextItems[idx] = final;
            if (recordAction) {
              actionEntries.push(actionEntry);
            }
          } else {
            if (!final.assetTag) {
              final = { ...final, assetTag: formatAssetTag(++nextAssetTagNum) };
            }
            indexById.set(final.id, nextItems.length);
            nextItems.push(final);
            if (recordAction) {
              actionEntries.push(actionEntry);
            }
          }
        });

        // Bundle/PC rows are React.memo'd by parent object identity. When only a nested
        // child changes (e.g. rename), clone the parent so the inventory nested list refreshes.
        {
          const updatedIdSet = new Set(itemsToApply.map((u) => u.id));
          const parentsToRefresh = new Set<string>();
          for (const u of itemsToApply) {
            const curIdx = indexById.get(u.id);
            const cur = curIdx !== undefined ? nextItems[curIdx] : undefined;
            if (cur?.parentContainerId) parentsToRefresh.add(cur.parentContainerId);
            const prevIdx = indexById.get(u.id);
            const prev = prevIdx !== undefined ? currentItems[prevIdx] : undefined;
            if (prev?.parentContainerId) parentsToRefresh.add(prev.parentContainerId);
          }
          for (const p of nextItems) {
            if (!(p.isPC || p.isBundle) || !p.componentIds?.length) continue;
            for (const cid of p.componentIds) {
              if (updatedIdSet.has(cid)) {
                parentsToRefresh.add(p.id);
                break;
              }
            }
          }
          if (parentsToRefresh.size > 0) {
            for (let i = 0; i < nextItems.length; i++) {
              const row = nextItems[i];
              if (parentsToRefresh.has(row.id)) nextItems[i] = { ...row };
            }
          }
        }
        
        if (deleteIds && deleteIds.length > 0) {
           const toTrash = nextItems.filter(i => deleteIds.includes(i.id));
           if (toTrash.length > 0) {
              addToTrash(toTrash);
              if (recordAction) toTrash.forEach((i) => actionEntries.push(makeActionEntry('Item moved to trash', i)));
           }
           nextItems = nextItems.filter(i => !deleteIds.includes(i.id));
        }

        // One parent per part; sync componentIds ↔ parentContainerId; drop emptied sold shells.
        if (!options?.skipMembershipSync) {
          const enforced = enforceContainerMembershipInvariants(nextItems);
          if (enforced.changed) {
            if (enforced.deleteIds.length > 0) {
              const removed = nextItems.filter((i) => enforced.deleteIds.includes(i.id));
              if (removed.length > 0) {
                addToTrash(removed);
                if (recordAction) {
                  removed.forEach((i) => actionEntries.push(makeActionEntry('Item moved to trash', i)));
                }
              }
            }
            nextItems = enforced.nextItems;
          }
        }

        // After parts leave a PC/bundle (sold one-by-one or removed), drop the empty shell
        // so it disappears from Active inventory.
        if (!options?.skipMembershipSync) {
          const emptyShellIds = findEmptyContainerShellIds(nextItems);
          if (emptyShellIds.length > 0) {
            const removed = nextItems.filter((i) => emptyShellIds.includes(i.id));
            if (removed.length > 0) {
              addToTrash(removed);
              if (recordAction) {
                removed.forEach((i) =>
                  actionEntries.push(makeActionEntry('Empty container removed', i)),
                );
              }
            }
            nextItems = nextItems.filter((i) => !emptyShellIds.includes(i.id));
          }
        }

        const actionEntriesMerged = recordAction ? mergeTradeActionEntries(actionEntries, updatedItems) : [];
        const touchedIds = [
          ...updatedItems.map((u) => u.id),
          ...(deleteIds ?? []),
        ];
        if (!options?.skipContainerSync) {
          nextItems = syncContainerBuyTotalsFromComponents(nextItems, touchedIds);
        }
        if (!options?.skipContainerSaleMetaSync) {
          nextItems = syncContainerSaleMetaToChildren(nextItems, touchedIds);
        }
        if (nextTrash !== trashBefore) {
          trashRef.current = nextTrash;
          setTrash(nextTrash);
        }
        if (recordUndo) {
          pushUndoSnapshot(currentItems, nextItems, trashBefore, nextTrash);
        }
        hasUnsavedChanges.current = true;
        if (actionEntriesMerged.length > 0) addActionEntries(actionEntriesMerged);
        return nextItems;
    });
  }, [addActionEntries, businessSettings.taxMode, pushUndoSnapshot, requestFastCloudFlush]);

  /** Strip false Abrechnung link sale history (e.g. mistaken unlink archives). */
  useEffect(() => {
    if (appState !== 'READY' || !items.length || abrechnungHealDoneRef.current) return;
    if (isCloudEnabled() && authUser && !cloudHydrated) return;
    abrechnungHealDoneRef.current = true;
    const patches = planAbrechnungMistakenLinkHeals(items);
    if (!patches.length) return;
    handleUpdate(patches, undefined, {
      skipFieldPreserve: true,
      skipMembershipSync: true,
      skipContainerSync: true,
      skipContainerSaleMetaSync: true,
      skipUndo: true,
      skipActionLog: true,
      flushCloud: true,
    });
  }, [appState, authUser, cloudHydrated, handleUpdate, items]);

  const handleRestoreItems = useCallback((updatedItems: InventoryItem[]) => {
    setItems(updatedItems);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [requestFastCloudFlush]);

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
      // Prefer stack undo so trash + inventory stay consistent and redo still works.
      const tip = historyRef.current[historyIndexRef.current];
      const prev = historyRef.current[historyIndexRef.current - 1];
      if (
        tip &&
        prev &&
        !tip.items.some((i) => i.id === id) &&
        prev.items.some((i) => i.id === id)
      ) {
        const newIndex = historyIndexRef.current - 1;
        historyIndexRef.current = newIndex;
        setItems(prev.items);
        trashRef.current = prev.trash;
        setTrash(prev.trash);
        hasUnsavedChanges.current = true;
        requestFastCloudFlush();
        addActionEntries([makeActionEntry('Restored from trash', item, 'Undid delete')]);
        return;
      }
      setTrash((prevTrash) => prevTrash.filter((i) => i.id !== id));
      handleUpdate([item], undefined, {
        skipUndo: true,
        flushCloud: true,
        actionNote: { action: 'Restored from trash', details: 'Undid delete' },
      });
    });
  }, [items, handleUpdate, addActionEntries, requestFastCloudFlush]);
  const handleUndo = () => {
    const idx = historyIndexRef.current;
    if (idx <= 0) return;
    const newIndex = idx - 1;
    const snapshot = historyRef.current[newIndex];
    if (!snapshot) return;
    historyIndexRef.current = newIndex;
    setItems(snapshot.items);
    trashRef.current = snapshot.trash;
    setTrash(snapshot.trash);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    addActionEntries([makeActionEntry('Undo action')]);
  };
  const handleRedo = () => {
    const idx = historyIndexRef.current;
    if (idx >= historyRef.current.length - 1) return;
    const newIndex = idx + 1;
    const snapshot = historyRef.current[newIndex];
    if (!snapshot) return;
    historyIndexRef.current = newIndex;
    setItems(snapshot.items);
    trashRef.current = snapshot.trash;
    setTrash(snapshot.trash);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    addActionEntries([makeActionEntry('Redo action')]);
  };
  const handleAddExpense = (expense: Expense) => {
    setExpenses(prev => [...prev, expense]);
    markCloudDirty();
    addActionEntries([makeActionEntry('Expense added', undefined, `${expense.description} (€${expense.amount})`)]);
  };
  const handleUpdateExpense = (expense: Expense) => {
    setExpenses(prev => prev.map(e => (e.id === expense.id ? expense : e)));
    markCloudDirty();
    addActionEntries([makeActionEntry('Expense updated', undefined, `${expense.description} (€${expense.amount})`)]);
  };
  const handleDeleteExpense = (id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
    markCloudDirty();
    addActionEntries([makeActionEntry('Expense deleted', undefined, id)]);
  };
  
  const handleAddRecurringExpense = (recurring: RecurringExpense) => {
    setRecurringExpenses(prev => [...prev, recurring]);
    markCloudDirty();
    addActionEntries([makeActionEntry('Recurring expense added', undefined, recurring.description)]);
  };
  const handleDeleteRecurringExpense = (id: string) => {
    setRecurringExpenses(prev => prev.filter(r => r.id !== id));
    // Also delete all generated expenses from this recurring expense
    setExpenses(prev => prev.filter(e => e.recurringExpenseId !== id));
    markCloudDirty();
    addActionEntries([makeActionEntry('Recurring expense deleted', undefined, id)]);
  };
  const handleUpdateRecurringExpense = (recurring: RecurringExpense) => {
    setRecurringExpenses(prev => prev.map(r => r.id === recurring.id ? recurring : r));
    markCloudDirty();
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
    historyRef.current = [];
    historyIndexRef.current = -1;
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

    void saveToLocalStorage(emptyInventory, emptyTrash, emptyExpenses, businessSettings, defaultGoal, categories, categoryFields, emptyRecurring, wipedDash);

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
          threeDPrint: threeDPrintCloudRef.current,
        });
        await writeStoreCatalog(buildStoreCatalog(emptyInventory, categoryFields)).catch(() => {});
      } catch (_) {}
    }

    setRefreshKey(prev => prev + 1);
  };

  const handleRestoreFromTrash = (ids: string[]) => {
    const trashBefore = trashRef.current;
    const toRestore = trashBefore.filter((i) => ids.includes(i.id));
    if (!toRestore.length) return;
    const nextTrash = trashBefore.filter((i) => !ids.includes(i.id));
    setItems((currentItems) => {
      const nextItems = [...currentItems];
      for (const item of toRestore) {
        if (!nextItems.some((i) => i.id === item.id)) nextItems.push(item);
      }
      trashRef.current = nextTrash;
      setTrash(nextTrash);
      pushUndoSnapshot(currentItems, nextItems, trashBefore, nextTrash);
      addActionEntries(toRestore.map((i) => makeActionEntry('Restored from trash', i)));
      hasUnsavedChanges.current = true;
      return nextItems;
    });
    requestFastCloudFlush();
  };
  const handlePermanentDelete = (ids: string[]) => {
    const trashBefore = trashRef.current;
    const removed = trashBefore.filter((i) => ids.includes(i.id));
    if (!removed.length) return;
    const nextTrash = trashBefore.filter((i) => !ids.includes(i.id));
    pushUndoSnapshot(itemsRef.current, itemsRef.current, trashBefore, nextTrash);
    trashRef.current = nextTrash;
    setTrash(nextTrash);
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
    addActionEntries(
      removed.map((i) =>
        makeActionEntry('Permanently deleted', i, 'Removed from trash (undo restores to trash)')
      )
    );
  };

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
    ebayOrders?: EbayOrderRecord[];
    ebayTxReports?: EbayTxReport[];
    ebayTxLabelOverrides?: Record<string, EbayTxLabelOverride>;
  }) => {
    const inv = Array.isArray(data.inventory) ? data.inventory : (Array.isArray((data as any).Inventory) ? (data as any).Inventory : []);
    const tr = Array.isArray(data.trash) ? data.trash : [];
    const exp = Array.isArray(data.expenses) ? data.expenses : [];
    const goal = data.goals?.monthly ?? monthlyGoal;
    const cats = data.categories && typeof data.categories === 'object' ? data.categories : categories;
    const fields = data.categoryFields && typeof data.categoryFields === 'object' ? data.categoryFields : categoryFields;
    const sets = data.settings && typeof data.settings === 'object' ? data.settings : businessSettings;
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
    clearUndoStackRef.current = true;
    setTrash(tr);
    setExpenses(exp);
    setMonthlyGoal(goal);
    setCategories(cats);
    setCategoryFields(fields);
    setBusinessSettings(sets);
    if (Array.isArray(data.ebayOrders) && data.ebayOrders.length) {
      // Upsert by orderId, not a blind replace — matches how the API/CSV sync already merges,
      // so restoring a backup only fills gaps rather than overwriting anything newer.
      upsertEbayOrders(data.ebayOrders);
    }
    if (Array.isArray(data.ebayTxReports) && data.ebayTxReports.length) {
      // Same reasoning as ebayOrders above — upsert per report (by meta.id) rather than a
      // blind replace, so a restore only fills in what's missing/older, same as a normal CSV
      // re-import would. Fires the same cloud-push + UI-refresh path a real import does.
      void (async () => {
        for (const report of data.ebayTxReports!) {
          await upsertEbayTransactionReport(report);
        }
        if (data.ebayTxLabelOverrides && Object.keys(data.ebayTxLabelOverrides).length) {
          const current = await loadEbayTxLabelOverrides();
          await saveEbayTxLabelOverrides({ ...data.ebayTxLabelOverrides, ...current });
        }
        notifyEbayTxReportUpdated();
      })();
    }
    void saveToLocalStorage(inv, tr, exp, sets, goal, cats, fields, undefined, restoredDash, mergedAH, mergedBI);
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
          threeDPrint: threeDPrintCloudRef.current,
        });
        await writeStoreCatalog(buildStoreCatalog(inv, fields)).catch(() => {});
      } catch (_) {}
    }
    setRefreshKey((k) => k + 1);
  }, [monthlyGoal, categories, categoryFields, businessSettings, authUser, dashboardPrefs, mergeActionHistoryFromLocal]);

  const handleFixEncoding = useCallback((fixedItems: InventoryItem[], fixedTrash: InventoryItem[]) => {
    setItems(fixedItems);
    setTrash(fixedTrash);
    void saveToLocalStorage(fixedItems, fixedTrash, expenses, businessSettings, monthlyGoal, categories, categoryFields);
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
        threeDPrint: threeDPrintCloudRef.current,
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

  const handleUpdateBulkImport = useCallback((record: BulkImportRecord) => {
    setBulkImports((prev) => {
      const next = mergeBulkImportsFromLocal(
        prev.filter((r) => r.id !== record.id),
        [record]
      ).slice(0, BULK_IMPORTS_LIMIT);
      bulkImportsRef.current = next;
      localStorage.setItem('bulk_imports', JSON.stringify(next));
      return next;
    });
    hasUnsavedChanges.current = true;
    requestFastCloudFlush();
  }, [requestFastCloudFlush]);

  const handleDeleteBulkImport = useCallback(
    (importId: string) => {
      setBulkImports((prev) => {
        const next = prev.filter((r) => r.id !== importId);
        bulkImportsRef.current = next;
        localStorage.setItem('bulk_imports', JSON.stringify(next));
        return next;
      });
      const stamped = items.filter((i) => i.bulkImportId === importId);
      if (stamped.length > 0) {
        handleUpdate(
          // Use '' (not omit) so PRESERVE_FROM_OLD_IF_UPDATE_MISSING does not restore the stamp.
          stamped.map((i) => ({ ...i, bulkImportId: '' })),
          undefined,
          { skipActionLog: true, flushCloud: true }
        );
      } else {
        hasUnsavedChanges.current = true;
        requestFastCloudFlush();
      }
    },
    [items, handleUpdate, requestFastCloudFlush]
  );

  const handleRevertSale = useCallback(
    (entry: ActionHistoryEntry) => {
      if (!entry.itemId || !entry.action.includes('Sold')) return;
      const item = items.find((i) => i.id === entry.itemId);
      if (!item || (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.GIFTED)) {
        alert('Item is not sold anymore or was removed.');
        return;
      }
      if (!window.confirm(`Revert sale for "${item.name}"? Item returns to In Stock; sale data is cleared.`)) return;
      const { updates, deleteIds } = applyUnsoldRestock(items, [entry.itemId], {
        refundOrders: loadRefundOrdersForRestock(),
      });
      handleUpdate(updates, deleteIds.length ? deleteIds : undefined, {
        flushCloud: true,
        skipFieldPreserve: true,
        actionNote: {
          action: 'Sale reverted',
          details: 'Restored to In Stock from action history.',
        },
      });
    },
    [items, handleUpdate]
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
        const trashBefore = trashRef.current;
        const res = applyTradeRevert(
          currentItems,
          entry.itemId!,
          entry.tradeReceivedIds,
          businessSettings.taxMode || 'SmallBusiness'
        );
        if (res.ok === false) {
          alert(res.message);
          return currentItems;
        }
        const nextItems = syncContainerBuyTotalsFromComponents(res.nextItems, [
          entry.itemId!,
          ...(entry.tradeReceivedIds ?? []),
          ...res.removedIds,
        ]);

        // Received trade lines leave inventory; keep them out of trash so undo restores from snapshot only.
        const nextTrash = trashBefore.filter((t) => !res.removedIds.includes(t.id));
        trashRef.current = nextTrash;
        setTrash(nextTrash);

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

        pushUndoSnapshot(currentItems, nextItems, trashBefore, nextTrash);
        hasUnsavedChanges.current = true;
        return nextItems;
      });
    },
    [items, businessSettings.taxMode, pushUndoSnapshot]
  );

  const isConfigured = isCloudEnabled();
  const ownerEmail = 'abelyanarmen@gmail.com';
  const authEmails = [
    authUser?.email,
    ...((authUser?.providerData || []).map((p: { email?: string | null }) => p?.email) || []),
  ]
    .filter(Boolean)
    .map((e) => String(e).toLowerCase());
  const isAdminUser = authEmails.includes(ownerEmail);

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

  return (
    <Router>
      <Analytics />
      <GoogleAuthRedirectBootstrap />
      <UndoToastProvider>
      <UndoToastBridge showUndoRef={showUndoRef} />
      <PanelLocaleProvider>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<StorefrontPageSkeleton />}>
              <StorefrontPage />
            </Suspense>
          }
        />
        <Route
          path="/item/:id"
          element={
            <Suspense fallback={<StorefrontPageSkeleton />}>
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
            <SettingsModalProvider>
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
                tabDataStale={tabDataStale}
                items={items}
                expenses={expenses}
                businessSettings={businessSettings}
                onUpdateItems={handleUpdate}
                gamification={gamification}
                updateGamification={updateGamification}
              />
              <SettingsModalHost
                items={items}
                trash={trash}
                expenses={expenses}
                monthlyGoal={monthlyGoal}
                dashboardPreferences={dashboardPrefs}
                actionHistory={actionHistory}
                bulkImports={bulkImports}
                onForcePush={handleForcePush}
                onRestoreItems={handleRestoreItems}
                onRestoreBackup={handleRestoreBackup}
                onFixEncoding={handleFixEncoding}
                businessSettings={businessSettings}
                onBusinessSettingsChange={handleBusinessSettingsChange}
                categories={categories}
                categoryFields={categoryFields}
                onUpdateCategoryStructure={handleUpdateCategoryStructure}
                onUpdateCategoryFields={handleUpdateCategoryFields}
                onRenameCategory={handleRenameCategory}
                onRenameSubCategory={handleRenameSubCategory}
                onApplyArchivedPhotos={(archivedItems, archivedTrash) => {
                  setItems(archivedItems);
                  setTrash(archivedTrash);
                }}
              />
            </SettingsModalProvider>
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
                onDashboardPreferencesChange={handleDashboardPreferencesChange}
                onUpdateItems={handleUpdate}
                onBusinessSettingsChange={handleBusinessSettingsChange}
              />
            }
          />
          <Route path="inventory" element={<InventoryList key="inventory-main" items={items} totalCount={items.length} onUpdate={handleUpdate} onDelete={handleDelete} onUndo={handleUndo} onRedo={handleRedo} canUndo={historyIndexRef.current > 0} canRedo={historyIndexRef.current < historyRef.current.length - 1} pageTitle="Inventory" allowedStatuses={ALL_INVENTORY_STATUSES} businessSettings={businessSettings} onBusinessSettingsChange={handleBusinessSettingsChange} categories={categories} categoryFields={categoryFields} persistenceKey="inventory_main" onPublishStoreCatalog={publishStoreCatalogNow} bulkImports={bulkImports} onUpdateBulkImport={handleUpdateBulkImport} onDeleteBulkImport={handleDeleteBulkImport} onDownloadBackup={handleDownloadInventoryBackup} />} />
          <Route path="dealwatch" element={<EstDealwatchPage items={items} />} />
          <Route path="est" element={<Navigate to="/panel/dealwatch" replace />} />
          <Route
            path="reinvest"
            element={
              <ReinvestAssistantPage
                items={items}
                expenses={expenses}
                taxMode={businessSettings.taxMode}
                gamification={gamification}
                updateGamification={updateGamification}
              />
            }
          />
          <Route
            path="combo-lab"
            element={
              <ComboLabPage
                items={items}
                businessSettings={businessSettings}
                onUpdate={handleUpdate}
              />
            }
          />
          <Route path="add" element={<AddHubPage />} />
          <Route
            path="add/item"
            element={
              <AddItemRoute
                onSave={handleUpdate}
                items={items}
                categories={categories}
                onAddCategory={handleAddCategory}
                categoryFields={categoryFields}
              />
            }
          />
          <Route path="add-bulk" element={<BulkItemForm onSave={handleUpdate} onBulkImportComplete={handleBulkImportComplete} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="edit/:id" element={<EditItemRoute onSave={handleUpdate} items={items} categories={categories} onAddCategory={handleAddCategory} categoryFields={categoryFields} />} />
          <Route path="builder" element={<BuilderEntry items={items} onSave={handleUpdate} />} />
          <Route path="3d-print" element={<ThreeDPrintPage items={items} onSave={handleUpdate} onRemoveItems={(ids) => handleUpdate([], ids)} categories={categories} onAddExpense={handleAddExpense} isAdmin={isAdminUser} />} />
          <Route path="sell-today" element={<SellTodayPage items={items} onUpdate={handleUpdate} />} />
          <Route
            path="ebay-abrechnung"
            element={
              <EbayAbrechnungPage
                items={items}
                taxMode={businessSettings.taxMode}
                onUpdate={handleUpdate}
                actionHistory={actionHistory}
              />
            }
          />
          <Route
            path="card-gallery"
            element={<ProductCardGalleryPage items={items} onUpdate={handleUpdate} />}
          />
          <Route
            path="bulk-imports"
            element={
              <BulkImportHistoryPage
                records={bulkImports}
                items={items}
                categories={categories}
                onUpdateItems={handleUpdate}
                onUpdateBulkImport={handleUpdateBulkImport}
                onDeleteBulkImport={handleDeleteBulkImport}
              />
            }
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
          <Route path="settings" element={<OpenSettingsFromRoute />} />
        </Route>
        <Route path="/auth/github/callback" element={<GitHubOAuthCallback />} />
        <Route path="/auth/ebay/callback" element={<EbayOAuthCallback />} />
        {/* If /dealwatch/* somehow hits the React SPA (static UI missing), never dump users on the storefront. */}
        <Route
          path="/dealwatch/*"
          element={
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6 text-center">
              <div className="max-w-md space-y-2">
                <p className="text-lg font-black">Dealwatch UI failed to load</p>
                <p className="text-sm text-slate-400">
                  Restart the app with <code className="text-emerald-300">npm run dev</code> so `/dealwatch` is served from
                  dealwatch-runtime. Then open <a className="underline text-white" href="/panel/dealwatch">/panel/dealwatch</a>.
                </p>
              </div>
            </div>
          }
        />
        <Route path="/market/*" element={<Navigate to="/panel/dealwatch" replace />} />
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

