import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Cloud, Building2, Layers, Wrench, ShoppingBag, Sparkles, Shield,
  CheckCircle2, AlertTriangle, ArrowUp, RefreshCw, Save, LogIn, LogOut, User as UserIcon, Download, Upload, FileText, Github, History, ArchiveRestore, Rocket, Copy, ExternalLink, Plus, FolderPlus, FileSpreadsheet, Images, Loader2
} from 'lucide-react';
import { fixItemsEncoding } from '../services/encodingFix';
import { InventoryItem, BusinessSettings, Expense, ItemStatus, DashboardPreferences, ActionHistoryEntry, BulkImportRecord } from '../types';
import { loadAISettings, saveAISettings, type AISettings, type AIModelTier } from '../services/aiSettings';
import { buildElsterChecklist } from '../services/elsterChecklist';
import { buildSteuerberaterBundle, downloadSteuerberaterBundle } from '../services/steuerberaterExport';
import { buildGdprExportBlob, downloadGdprExport } from '../services/gdprExport';
import { encryptBackupJson } from '../services/encryptedBackup';
import { isCloudEnabled, saveFirebaseConfig, getFirebaseConfig, signInWithGoogle, logOut, onAuthChange, getAuthErrorMessage } from '../services/firebaseService';
import {
  analyzeInventoryPhotoArchive,
  archiveSinglePhotoUrl,
  bulkArchiveInventoryPhotos,
  canArchivePhotosToCloud,
  listUnarchivedPhotoEntries,
  type PhotoArchiveFailure,
  type PhotoArchiveProgress,
  type PhotoArchiveResult,
} from '../services/inventoryImageStorage';
import {
  getStoredConfig,
  getStoredToken,
  getStoredLogin,
  saveConfig as saveGitHubConfig,
  clearOAuth,
  getOAuthAuthorizeUrl,
  pushBackup,
  listBackupCommits,
  getBackupAtCommit,
  listUserRepos,
  createRepo,
  type BackupCommit,
  type GitHubRepoItem,
} from '../services/githubBackupService';
import CategoryEditor from './CategoryEditor';
import type { DateBounds, FinanzamtExportRangePreset } from '../utils/exportDateRange';
import {
  filterExpensesForRange,
  filterInventoryForFinanzamtRange,
  formatBoundsGerman,
  resolveFinanzamtDateBounds,
} from '../utils/exportDateRange';

export interface BackupData {
  inventory: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  settings: BusinessSettings;
  goals: { monthly: number };
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  /** Dashboard widgets, tasks, time filter (optional in older backups). */
  dashboard?: DashboardPreferences;
  actionHistory?: ActionHistoryEntry[];
  bulkImports?: BulkImportRecord[];
  exportedAt: string;
}

interface Props {
  items: InventoryItem[];
  trash?: InventoryItem[];
  expenses?: Expense[];
  monthlyGoal?: number;
  onForcePush?: () => Promise<boolean>;
  onRestoreItems: (items: InventoryItem[]) => void;
  onRestoreBackup?: (data: Partial<BackupData>) => void;
  onFixEncoding?: (fixedItems: InventoryItem[], fixedTrash: InventoryItem[]) => void;
  businessSettings: BusinessSettings;
  onBusinessSettingsChange: (settings: BusinessSettings) => void;
  categories?: Record<string, string[]>;
  categoryFields?: Record<string, string[]>;
  onUpdateCategoryStructure?: (newCats: Record<string, string[]>) => void;
  onUpdateCategoryFields?: (newFields: Record<string, string[]>) => void;
  onRenameCategory?: (oldName: string, newName: string) => void;
  onRenameSubCategory?: (category: string, oldSubName: string, newSubName: string) => void;
  dashboardPreferences?: DashboardPreferences;
  actionHistory?: ActionHistoryEntry[];
  bulkImports?: BulkImportRecord[];
  onApplyArchivedPhotos?: (items: InventoryItem[], trash: InventoryItem[]) => void;
}

const SETTINGS_TABS = [
  { id: 'BUSINESS', label: 'Business', icon: <Building2 size={18}/> },
  { id: 'EBAY', label: 'eBay API', icon: <ShoppingBag size={18}/> },
  { id: 'CLOUD', label: 'Cloud Sync', icon: <Cloud size={18}/> },
  { id: 'AI', label: 'AI', icon: <Sparkles size={18}/> },
  { id: 'FINANZAMT', label: 'Finanzamt', icon: <FileSpreadsheet size={18}/> },
  { id: 'DEPLOY', label: 'Deploy to Vercel', icon: <Rocket size={18}/> },
  { id: 'CATEGORIES', label: 'Categories', icon: <Layers size={18}/> },
  { id: 'SYSTEM', label: 'System', icon: <Wrench size={18}/> },
] as const;

const getEbayConfig = () => {
  try {
    const saved = localStorage.getItem('ebay_config');
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return { token: '', username: 'rm4ik' };
};

const saveEbayConfigLocal = (updates: { token?: string; username?: string }) => {
  const prev = getEbayConfig();
  localStorage.setItem(
    'ebay_config',
    JSON.stringify({
      token: updates.token !== undefined ? updates.token.trim() : prev.token || '',
      username:
        updates.username !== undefined
          ? updates.username.trim().replace(/^@/, '') || 'rm4ik'
          : prev.username || 'rm4ik',
    })
  );
  window.dispatchEvent(new Event('ebay-config-updated'));
};

const GITHUB_APP_REPO_URL = 'https://github.com/armique/inventorycursor';

function getInventoryFromBackup(data: any): InventoryItem[] {
  if (Array.isArray(data.inventory)) return data.inventory;
  if (Array.isArray(data.Inventory)) return data.Inventory;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

const SettingsPage: React.FC<Props> = ({ 
  items, 
  trash = [],
  expenses = [],
  monthlyGoal = 1000,
  dashboardPreferences,
  onForcePush, 
  onRestoreItems, 
  onRestoreBackup,
  onFixEncoding,
  businessSettings,
  onBusinessSettingsChange,
  categories = {},
  categoryFields = {},
  onUpdateCategoryStructure,
  onUpdateCategoryFields
  ,
  actionHistory = [],
  bulkImports = [],
  onApplyArchivedPhotos,
}) => {
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab')?.toUpperCase();
  const initialTab =
    tabFromUrl === 'EBAY' || tabFromUrl === 'EBAY API'
      ? 'EBAY'
      : (SETTINGS_TABS.find((t) => t.id === tabFromUrl)?.id ?? 'BUSINESS');
  const [activeTab, setActiveTab] = useState<typeof SETTINGS_TABS[number]['id']>(initialTab);
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings());
  const [backupEncrypt, setBackupEncrypt] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [firebaseConfig, setFirebaseConfig] = useState(getFirebaseConfig() || { apiKey: '', authDomain: '', projectId: '' });
  const [user, setUser] = useState<any>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [isSigningInPopup, setIsSigningInPopup] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [photoArchiveRunning, setPhotoArchiveRunning] = useState(false);
  const [photoArchiveProgress, setPhotoArchiveProgress] = useState<PhotoArchiveProgress | null>(null);
  const [photoArchiveResult, setPhotoArchiveResult] = useState<PhotoArchiveResult | null>(null);
  const [photoArchiveFailures, setPhotoArchiveFailures] = useState<PhotoArchiveFailure[]>([]);
  const [retryingPhotoUrl, setRetryingPhotoUrl] = useState<string | null>(null);

  const photoArchiveAnalysis = useMemo(
    () => analyzeInventoryPhotoArchive(items, trash),
    [items, trash]
  );

  const unarchivedPhotoEntries = useMemo(
    () => listUnarchivedPhotoEntries(items, trash),
    [items, trash]
  );

  const [githubRepo, setGitHubRepo] = useState(() => getStoredConfig()?.repo || 'armique/inventorycursor');
  const [githubTokenInput, setGitHubTokenInput] = useState('');
  const [ebayTokenInput, setEbayTokenInput] = useState('');
  const [ebayUsernameInput, setEbayUsernameInput] = useState(() => getEbayConfig()?.username || 'rm4ik');
  const [ebayConfigVersion, setEbayConfigVersion] = useState(0);

  useEffect(() => {
    const tab = searchParams.get('tab')?.toUpperCase();
    if (tab === 'EBAY' || tab === 'EBAY API') setActiveTab('EBAY');
  }, [searchParams]);
  const [githubSyncLoading, setGitHubSyncLoading] = useState(false);
  const [githubCommits, setGitHubCommits] = useState<BackupCommit[]>([]);
  const [githubCommitsLoading, setGitHubCommitsLoading] = useState(false);
  const [githubRestoreLoading, setGitHubRestoreLoading] = useState<string | null>(null);
  const [ghAuthRefresh, setGhAuthRefresh] = useState(0);
  const hasGhClientId = !!(import.meta.env.VITE_GITHUB_CLIENT_ID as string)?.trim();
  const ghToken = getStoredToken();
  const ghLogin = getStoredLogin();
  const [ghRepos, setGhRepos] = useState<GitHubRepoItem[]>([]);
  const [ghReposLoading, setGhReposLoading] = useState(false);
  const [createBackupRepoName, setCreateBackupRepoName] = useState('');
  const [createBackupRepoLoading, setCreateBackupRepoLoading] = useState(false);
  const [createAppRepoName, setCreateAppRepoName] = useState('inventory-pro');
  const [createAppRepoLoading, setCreateAppRepoLoading] = useState(false);
  const [createdAppRepoUrl, setCreatedAppRepoUrl] = useState<string | null>(null);

  const [finanzRangePreset, setFinanzRangePreset] = useState<FinanzamtExportRangePreset>('all');
  const [finanzCustomYear, setFinanzCustomYear] = useState(() => new Date().getFullYear());
  const [finanzCustomFrom, setFinanzCustomFrom] = useState('');
  const [finanzCustomTo, setFinanzCustomTo] = useState('');

  const finanzExportResolution = useMemo(() => {
    if (finanzRangePreset === 'all') return { bounds: null as DateBounds | null, valid: true };
    if (finanzRangePreset === 'custom_range') {
      if (!finanzCustomFrom.trim() || !finanzCustomTo.trim()) return { bounds: null, valid: false };
      const b = resolveFinanzamtDateBounds('custom_range', {
        customStart: finanzCustomFrom,
        customEnd: finanzCustomTo,
      });
      return b ? { bounds: b, valid: true } : { bounds: null, valid: false };
    }
    const b = resolveFinanzamtDateBounds(finanzRangePreset, { customYear: finanzCustomYear });
    return { bounds: b, valid: true };
  }, [finanzRangePreset, finanzCustomYear, finanzCustomFrom, finanzCustomTo]);

  const finanzExportCounts = useMemo(() => {
    const { bounds, valid } = finanzExportResolution;
    if (!valid) return { items: 0, expenses: 0 };
    if (!bounds) {
      return {
        items: items.filter((i) => !i.isDraft).length,
        expenses: expenses.length,
      };
    }
    return {
      items: filterInventoryForFinanzamtRange(items, bounds).length,
      expenses: filterExpensesForRange(expenses, bounds).length,
    };
  }, [items, expenses, finanzExportResolution]);

  const elsterChecklist = useMemo(
    () =>
      buildElsterChecklist({
        hasFinanzamtExport: items.some((i) => i.status === ItemStatus.SOLD),
        hasInvoices: items.some((i) => i.invoiceNumber || i.customer?.name),
        hasExpenseReceipts: expenses.some((e) => !!e.attachmentUrl),
        taxMode: businessSettings.taxMode,
        differentialItems: items.filter((i) => i.usesDifferentialVat).length,
      }),
    [items, expenses, businessSettings.taxMode]
  );

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => setUser(u));
    return () => unsubscribe();
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleBulkArchivePhotos = async () => {
    if (!canArchivePhotosToCloud()) {
      showToast('Sign in with Google and save Firebase config first.', 'error');
      return;
    }
    if (photoArchiveAnalysis.uniquePhotosToArchive === 0) {
      showToast('No remote photos to archive — everything is already on Firebase Storage.', 'success');
      return;
    }
    const ok = window.confirm(
      `Archive ${photoArchiveAnalysis.uniquePhotosToArchive} unique photo${photoArchiveAnalysis.uniquePhotosToArchive === 1 ? '' : 's'} ` +
        `from ${photoArchiveAnalysis.itemsAffected} item${photoArchiveAnalysis.itemsAffected === 1 ? '' : 's'} to Firebase Storage?\n\n` +
        'This downloads each linked image once, compresses it, and saves your own copy. Original eBay/search links will be replaced.'
    );
    if (!ok) return;

    setPhotoArchiveRunning(true);
    setPhotoArchiveResult(null);
    setPhotoArchiveProgress({ done: 0, total: photoArchiveAnalysis.uniquePhotosToArchive });
    try {
      const { items: archivedItems, trash: archivedTrash, result } = await bulkArchiveInventoryPhotos(items, {
        trash,
        onProgress: setPhotoArchiveProgress,
      });
      onApplyArchivedPhotos?.(archivedItems, archivedTrash);
      setPhotoArchiveResult(result);
      setPhotoArchiveFailures(result.failures || []);
      showToast(
        `Archived ${result.photosArchived} photo${result.photosArchived === 1 ? '' : 's'} to Firebase Storage` +
          (result.photosFailed ? ` (${result.photosFailed} failed)` : ''),
        result.photosArchived > 0 ? 'success' : 'error'
      );
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Photo archive failed.', 'error');
    } finally {
      setPhotoArchiveRunning(false);
      setPhotoArchiveProgress(null);
    }
  };

  const handleRetrySinglePhoto = async (url: string) => {
    if (!canArchivePhotosToCloud()) {
      showToast('Sign in with Google first.', 'error');
      return;
    }
    setRetryingPhotoUrl(url);
    try {
      const result = await archiveSinglePhotoUrl(url, items, trash);
      if (result.success) {
        onApplyArchivedPhotos?.(result.items, result.trash);
        setPhotoArchiveFailures((prev) => prev.filter((f) => f.url !== url));
        showToast('Photo archived to Firebase Storage.', 'success');
      } else {
        showToast(result.error || 'Retry failed.', 'error');
      }
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Retry failed.', 'error');
    } finally {
      setRetryingPhotoUrl(null);
    }
  };

  const handleSaveFirebase = () => {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      showToast("Missing API Key or Project ID", "error");
      return;
    }
    saveFirebaseConfig(firebaseConfig);
  };

  const handleSignInPopup = async () => {
    setIsSigningInPopup(true);
    try {
      const user = await signInWithGoogle();
      if (user) {
        showToast("Signed in successfully", "success");
      } else {
        showToast("Redirecting to Google sign-in…", "success");
      }
    } catch (e: unknown) {
      showToast(getAuthErrorMessage(e), "error");
    } finally {
      setIsSigningInPopup(false);
    }
  };

  const handleSignOut = async () => {
    await logOut();
    showToast("Signed out", "success");
  };

  const handleManualPush = async () => {
    if (!user && isCloudEnabled()) {
       showToast("Please sign in first", "error");
       return;
    }
    setIsPushing(true);
    try {
      if (onForcePush) await onForcePush();
      showToast('Saved to Cloud', 'success');
    } catch(e) {
      showToast('Failed to save', 'error');
    } finally {
      setIsPushing(false);
    }
  };

  const handleExportBackup = () => {
    const backup: BackupData = {
      inventory: items,
      trash,
      expenses: expenses || [],
      settings: businessSettings,
      goals: { monthly: monthlyGoal },
      categories,
      categoryFields,
      ...(dashboardPreferences ? { dashboard: dashboardPreferences } : {}),
      ...(actionHistory.length ? { actionHistory } : {}),
      ...(bulkImports.length ? { bulkImports } : {}),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deinventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded', 'success');
  };

  const handleFixEncoding = () => {
    if (!onFixEncoding) return;
    const fixedItems = fixItemsEncoding(items);
    const fixedTrash = fixItemsEncoding(trash);
    onFixEncoding(fixedItems, fixedTrash);
    const total = fixedItems.length + fixedTrash.length;
    showToast(`Encoding fixed for ${total} items. Names and text fields updated.`, 'success');
  };

  const handleBackfillContainerSoldDates = () => {
    // Migration: Backfill containerSoldDate for components of already-sold PCs/bundles
    const allItems = [...items, ...trash];
    const soldContainers = allItems.filter(
      i => (i.isPC || i.isBundle) && i.status === ItemStatus.SOLD && i.sellDate
    );
    
    if (soldContainers.length === 0) {
      showToast('No sold PCs or bundles found to migrate.', 'error');
      return;
    }

    const updates: InventoryItem[] = [];
    let totalComponentsUpdated = 0;

    soldContainers.forEach(container => {
      const soldAt = container.sellDate!;
      const componentIds = container.componentIds || [];
      
      // Find components by componentIds or parentContainerId
      const components = allItems.filter(i => 
        (componentIds.includes(i.id) || i.parentContainerId === container.id) &&
        !i.containerSoldDate // Only update if not already set
      );

      components.forEach(comp => {
        updates.push({
          ...comp,
          containerSoldDate: soldAt,
        });
        totalComponentsUpdated++;
      });
    });

    if (updates.length === 0) {
      showToast('All components already have containerSoldDate set.', 'error');
      return;
    }

    // Split updates back into items and trash
    const updatedItems = items.map(i => {
      const update = updates.find(u => u.id === i.id);
      return update || i;
    });
    const updatedTrash = trash.map(i => {
      const update = updates.find(u => u.id === i.id);
      return update || i;
    });

    onRestoreItems(updatedItems);
    if (onRestoreBackup) {
      onRestoreBackup({
        inventory: updatedItems,
        trash: updatedTrash,
      });
    }
    showToast(`Backfilled containerSoldDate for ${totalComponentsUpdated} components from ${soldContainers.length} sold PCs/bundles.`, 'success');
  };

  const handleRetroactiveProportionalPrices = () => {
    // Migration: Apply proportional sell prices to child items of already-sold bundles/PCs
    const allItems = [...items, ...trash];
    const soldContainers = allItems.filter(
      i => (i.isPC || i.isBundle) && i.status === ItemStatus.SOLD && i.sellDate && i.sellPrice && i.sellPrice > 0
    );
    
    if (soldContainers.length === 0) {
      showToast('No sold PCs or bundles with sell prices found.', 'error');
      return;
    }

    const updates: InventoryItem[] = [];
    let totalComponentsUpdated = 0;

    soldContainers.forEach(container => {
      const soldAt = container.sellDate!;
      const bundleSellPrice = container.sellPrice || 0;
      const bundleFee = container.feeAmount || 0;
      const componentIds = container.componentIds || [];
      
      // Find child components
      const childComponents = allItems.filter(i => 
        (componentIds.includes(i.id) || i.parentContainerId === container.id)
      );

      if (childComponents.length === 0) return;

      // Calculate total buy price of all children
      const totalChildBuyPrice = childComponents.reduce((sum, i) => sum + (i.buyPrice || 0), 0);
      
      // Allocate proportional sell prices
      childComponents.forEach(child => {
        const childBuyPrice = child.buyPrice || 0;
        
        // Calculate proportional sell price: (item buy price / total buy price) * bundle sell price
        // Fallback to equal split if no buy prices
        const proportionalSellPrice = totalChildBuyPrice > 0
          ? (childBuyPrice / totalChildBuyPrice) * bundleSellPrice
          : bundleSellPrice / childComponents.length;
        
        // Allocate fee proportionally
        const proportionalFee = totalChildBuyPrice > 0
          ? (childBuyPrice / totalChildBuyPrice) * bundleFee
          : bundleFee / childComponents.length;
        
        // Calculate profit
        const childProfit = proportionalSellPrice - childBuyPrice - proportionalFee;
        
        updates.push({
          ...child,
          sellDate: soldAt,
          sellPrice: Math.round(proportionalSellPrice * 100) / 100,
          feeAmount: Math.round(proportionalFee * 100) / 100,
          hasFee: proportionalFee > 0,
          profit: Math.round(childProfit * 100) / 100,
          status: ItemStatus.SOLD,
          containerSoldDate: soldAt,
          platformSold: container.platformSold,
          paymentType: container.paymentType,
          // Keep original buyDate - don't overwrite it
        });
        totalComponentsUpdated++;
      });
    });

    if (updates.length === 0) {
      showToast('No child components found to update.', 'error');
      return;
    }

    // Also set bundle/PC profit to 0 (profit only exists in child items)
    soldContainers.forEach(container => {
      const existingUpdate = updates.find(u => u.id === container.id);
      if (!existingUpdate) {
        // Find container in items or trash
        const containerInItems = items.find(i => i.id === container.id) || trash.find(i => i.id === container.id);
        if (containerInItems) {
          updates.push({
            ...containerInItems,
            profit: 0, // No profit on container - only child items have profit
          });
        }
      } else {
        // Update existing update to set profit to 0
        const idx = updates.findIndex(u => u.id === container.id);
        if (idx >= 0) {
          updates[idx] = {
            ...updates[idx],
            profit: 0,
          };
        }
      }
    });

    // Merge updates with existing items
    const updatedItems = items.map(i => {
      const update = updates.find(u => u.id === i.id);
      return update || i;
    });
    const updatedTrash = trash.map(i => {
      const update = updates.find(u => u.id === i.id);
      return update || i;
    });

    onRestoreItems(updatedItems);
    if (onRestoreBackup) {
      onRestoreBackup({
        inventory: updatedItems,
        trash: updatedTrash,
      });
    }
    showToast(`Applied proportional sell prices to ${totalComponentsUpdated} components from ${soldContainers.length} sold bundles/PCs.`, 'success');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onRestoreBackup) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = reader.result as string;
        let data = JSON.parse(raw);
        if (!data) throw new Error('Invalid file');
        if (Array.isArray(data)) data = { inventory: data };
        else if (!data.inventory && (data.items || data.Inventory)) data = { ...data, inventory: data.items || data.Inventory };
        const inv = getInventoryFromBackup(data);
        const keys = Object.keys(data).join(', ');
        await Promise.resolve(onRestoreBackup(data));
        if (inv.length > 0) {
          showToast(`Restored ${inv.length} items. Go to Inventory to see them.`, 'success');
        } else {
          showToast(`File had 0 items (keys in file: ${keys}). Use a backup that was saved when you had data.`, 'error');
        }
      } catch (err: any) {
        showToast(err?.message || 'Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const buildBackupPayload = useCallback(() => ({
    inventory: items,
    trash,
    expenses: expenses || [],
    settings: businessSettings,
    goals: { monthly: monthlyGoal },
    categories,
    categoryFields,
    ...(dashboardPreferences ? { dashboard: dashboardPreferences } : {}),
    ...(actionHistory.length ? { actionHistory } : {}),
    ...(bulkImports.length ? { bulkImports } : {}),
    exportedAt: new Date().toISOString(),
  }), [items, trash, expenses, businessSettings, monthlyGoal, categories, categoryFields, dashboardPreferences, actionHistory, bulkImports]);

  const handleSaveGitHubConfig = () => {
    const config = getStoredConfig();
    const token = githubTokenInput.trim() || getStoredToken() || config?.token || '';
    if (!githubRepo.trim()) {
      showToast('Enter repository (owner/repo)', 'error');
      return;
    }
    if (!token) {
      showToast('Sign in with GitHub or enter a Personal Access Token', 'error');
      return;
    }
    saveGitHubConfig(githubRepo.trim(), token);
    setGitHubTokenInput('');
    showToast('GitHub backup settings saved', 'success');
  };

  const handleSyncToGitHub = async () => {
    const config = getStoredConfig();
    if (!config) {
      showToast('Save repo and token first', 'error');
      return;
    }
    if (backupEncrypt && !backupPassphrase.trim()) {
      showToast('Enter a passphrase for encrypted backup', 'error');
      return;
    }
    setGitHubSyncLoading(true);
    try {
      const payload = buildBackupPayload();
      let toPush: object = payload;
      if (backupEncrypt && backupPassphrase.trim()) {
        const enc = await encryptBackupJson(JSON.stringify(payload), backupPassphrase.trim());
        toPush = { encrypted: true, v: 2, data: enc, exportedAt: new Date().toISOString() };
      }
      await pushBackup(config, toPush);
      showToast('Backup pushed to GitHub', 'success');
      const commits = await listBackupCommits(config, 20);
      setGitHubCommits(commits);
    } catch (err: any) {
      showToast(err?.message || 'Sync failed', 'error');
    } finally {
      setGitHubSyncLoading(false);
    }
  };

  const loadGitHubCommits = useCallback(async () => {
    const config = getStoredConfig();
    if (!config) return;
    setGitHubCommitsLoading(true);
    try {
      const commits = await listBackupCommits(config, 20);
      setGitHubCommits(commits);
    } catch {
      setGitHubCommits([]);
    } finally {
      setGitHubCommitsLoading(false);
    }
  }, []);

  const handleRestoreFromGitHub = async (commitSha: string) => {
    const config = getStoredConfig();
    if (!config || !onRestoreBackup) return;
    setGitHubRestoreLoading(commitSha);
    try {
      const raw = await getBackupAtCommit(config, commitSha);
      let data = JSON.parse(raw);
      if (data?.encrypted && typeof data.data === 'string') {
        const pass = window.prompt('This backup is encrypted. Enter passphrase:');
        if (!pass) throw new Error('Passphrase required');
        const { decryptBackupJson } = await import('../services/encryptedBackup');
        const plain = await decryptBackupJson(data.data, pass);
        data = JSON.parse(plain);
      }
      await Promise.resolve(onRestoreBackup(data));
      const inv = getInventoryFromBackup(data);
      showToast(`Restored ${inv.length} items from this version`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Restore failed', 'error');
    } finally {
      setGitHubRestoreLoading(null);
    }
  };

  const loadGhRepos = useCallback(async () => {
    if (!ghToken) return;
    setGhReposLoading(true);
    try {
      const list = await listUserRepos(ghToken);
      setGhRepos(list);
    } catch {
      setGhRepos([]);
    } finally {
      setGhReposLoading(false);
    }
  }, [ghToken]);

  useEffect(() => {
    if (activeTab === 'CLOUD' && ghToken) loadGhRepos();
  }, [activeTab, ghToken, loadGhRepos]);

  useEffect(() => {
    if (activeTab === 'CLOUD' && getStoredConfig()) loadGitHubCommits();
  }, [activeTab, loadGitHubCommits]);

  const handleCreateBackupRepo = async () => {
    const name = createBackupRepoName.trim() || 'inventory-backups';
    if (!ghToken) return;
    setCreateBackupRepoLoading(true);
    try {
      const { full_name, html_url } = await createRepo(ghToken, name, { private: false, description: 'Inventory backup (backup.json)' });
      saveGitHubConfig(full_name, ghToken);
      setGitHubRepo(full_name);
      setCreateBackupRepoName('');
      await loadGhRepos();
      showToast(`Created ${full_name}. You can push backup now.`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to create repo', 'error');
    } finally {
      setCreateBackupRepoLoading(false);
    }
  };

  const handleCreateAppRepo = async () => {
    const name = createAppRepoName.trim() || 'inventory-pro';
    if (!ghToken) return;
    setCreateAppRepoLoading(true);
    setCreatedAppRepoUrl(null);
    try {
      const { full_name, html_url } = await createRepo(ghToken, name, { private: false, description: 'Inventory app' });
      setCreatedAppRepoUrl(html_url || `https://github.com/${full_name}`);
      showToast(`Repo ${full_name} created. Push your code from your computer (see below).`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to create repo', 'error');
    } finally {
      setCreateAppRepoLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard', 'success')).catch(() => showToast('Copy failed', 'error'));
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-20 px-4 md:px-8 animate-in fade-in duration-500">
      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 border ${toast.type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-red-600 border-red-500 text-white'}`}>
           {toast.type === 'success' ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>}
           <p className="text-xs font-black uppercase tracking-widest">{toast.message}</p>
        </div>
      )}

      <header className="mb-8 pt-6">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">System Control</h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <nav className="w-full lg:w-72 shrink-0">
          <div className="bg-white p-2 rounded-3xl border border-slate-200">
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 px-2 lg:px-0">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-4 px-6 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <span className={`${activeTab === tab.id ? 'text-blue-400' : 'text-slate-400'}`}>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="flex-1 min-w-0 w-full space-y-6">
          {activeTab === 'BUSINESS' && (
             <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-xl font-black text-slate-900">Business Profile</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <InputField label="Company Name" value={businessSettings.companyName} onChange={v => onBusinessSettingsChange({...businessSettings, companyName: v})} placeholder="My Company" />
                   <InputField label="Owner Name" value={businessSettings.ownerName} onChange={v => onBusinessSettingsChange({...businessSettings, ownerName: v})} placeholder="John Doe" />
                   <InputField label="Address" value={businessSettings.address} onChange={v => onBusinessSettingsChange({...businessSettings, address: v})} placeholder="123 Street, City" />
                   <InputField label="Phone" value={businessSettings.phone} onChange={v => onBusinessSettingsChange({...businessSettings, phone: v})} placeholder="+1 234 567" />
                </div>
             </div>
          )}

          {activeTab === 'EBAY' && (
             <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2"><ShoppingBag size={24}/> eBay sync (optional)</h3>
                <p className="text-sm text-slate-500">
                   Import photos from your public eBay seller store (Browse API). Order sync still uses an optional OAuth token. Most sellers mark sales with the eBay order screenshot parser in the sale dialog instead — no API setup required.
                </p>
                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Seller username</label>
                   <input
                      type="text"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm outline-none focus:border-slate-900"
                      placeholder="rm4ik"
                      value={ebayUsernameInput}
                      onChange={e => setEbayUsernameInput(e.target.value.replace(/^@/, ''))}
                   />
                   <p className="text-xs text-slate-500">
                      Listings are loaded from your public seller page, e.g.{' '}
                      <a
                         href={`https://www.ebay.de/usr/${ebayUsernameInput.trim() || 'rm4ik'}`}
                         target="_blank"
                         rel="noopener noreferrer"
                         className="text-indigo-600 hover:underline"
                      >
                         ebay.de/usr/{ebayUsernameInput.trim() || 'rm4ik'}
                      </a>
                      . Default: <code className="bg-slate-100 px-1 rounded">rm4ik</code>.
                   </p>
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">OAuth Access Token (optional)</label>
                   <input
                      type="password"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm outline-none focus:border-slate-900"
                      placeholder={getEbayConfig()?.token ? '••••••••••••••••' : 'v^1.1#... (eBay OAuth token)'}
                      value={ebayTokenInput}
                      onChange={e => setEbayTokenInput(e.target.value)}
                   />
                   <p className="text-xs text-slate-500">
                      eBay Developer Account → OAuth User Token. Scopes: <code className="bg-slate-100 px-1 rounded">sell.fulfillment.readonly</code> (seller order sync) and{' '}
                      <code className="bg-slate-100 px-1 rounded">sell.inventory.readonly</code> (private listings). Buyer purchases use the same user token via Trading API.
                   </p>
                   <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      Tokens expire regularly (~2 h for OAuth access tokens). If Live order refresh or order sync shows &quot;token expired&quot;, generate a new User Token on{' '}
                      <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener noreferrer" className="text-indigo-700 font-bold hover:underline">
                         developer.ebay.com
                      </a>
                      , paste it here, and Save. Stored in this browser only — not synced with cloud login.
                   </p>
                </div>
                <div className="flex items-center gap-3">
                   <button
                      type="button"
                      onClick={() => {
                         saveEbayConfigLocal({
                            token: ebayTokenInput || getEbayConfig()?.token || '',
                            username: ebayUsernameInput,
                         });
                         setEbayTokenInput('');
                         setEbayConfigVersion((v) => v + 1);
                         showToast('eBay settings saved', 'success');
                      }}
                      className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-slate-800 flex items-center gap-2"
                   >
                      <Save size={16}/> Save eBay settings
                   </button>
                   {(() => {
                      void ebayConfigVersion;
                      const cfg = getEbayConfig();
                      const hasToken = Boolean(cfg?.token?.trim());
                      const hasUsername = Boolean(cfg?.username?.trim());
                      if (!hasToken && !hasUsername) return null;
                      return (
                         <div className="flex flex-wrap items-center gap-2">
                            {hasUsername && (
                               <span className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold">
                                  Store: {cfg?.username || 'rm4ik'}
                               </span>
                            )}
                            {hasToken ? (
                               <span className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-800 rounded-xl text-sm font-bold">
                                  <CheckCircle2 size={16}/> OAuth token saved — order API ready
                               </span>
                            ) : (
                               <span className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-900 rounded-xl text-sm font-bold">
                                  <AlertTriangle size={16}/> No OAuth token — order backfill needs one (CSV import does not)
                               </span>
                            )}
                         </div>
                      );
                   })()}
                </div>
             </div>
          )}

          {activeTab === 'CLOUD' && (
             <div className="space-y-6">
                <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-[2rem]">
                   <h3 className="text-lg font-black text-emerald-900 flex items-center gap-2 mb-2"><Cloud size={22}/> Cloud database (Firestore)</h3>
                   <p className="text-sm text-emerald-800 leading-relaxed">
                      Your inventory is stored in Firestore and syncs in real time. When you edit a price here, the change is written to the database immediately and anyone with the app open (another tab or device) sees the update. No request limits for normal daily use.
                   </p>
                   <p className="text-xs text-emerald-600 mt-2 font-bold uppercase tracking-wider">Status: {isCloudEnabled() && user ? 'Live' : isCloudEnabled() ? 'Sign in required' : 'Not configured'}</p>
                </div>

                {/* Photo archive → Firebase Storage */}
                <div className="bg-white p-6 rounded-[3rem] border border-slate-200 shadow-sm space-y-4">
                   <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      <Images size={22} className="text-blue-600" /> Photo archive (Firebase Storage)
                   </h3>
                   <p className="text-sm text-slate-500 leading-relaxed">
                      Turn existing eBay, search, and pasted image links into permanent copies in Firebase Storage.
                      You do <strong>not</strong> need to refetch from eBay — the app downloads from the URL already on each item.
                   </p>

                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">To archive</p>
                         <p className="text-2xl font-black text-slate-900">{photoArchiveAnalysis.uniquePhotosToArchive}</p>
                         <p className="text-xs text-slate-500">unique photos</p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Items affected</p>
                         <p className="text-2xl font-black text-slate-900">{photoArchiveAnalysis.itemsAffected}</p>
                         <p className="text-xs text-slate-500">inventory + trash</p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Already archived</p>
                         <p className="text-2xl font-black text-emerald-700">{photoArchiveAnalysis.alreadyArchivedSlots}</p>
                         <p className="text-xs text-slate-500">on Storage</p>
                      </div>
                   </div>

                   {photoArchiveRunning && photoArchiveProgress && (
                      <div className="space-y-2">
                         <div className="flex justify-between text-xs font-bold text-slate-600">
                            <span>Archiving photos…</span>
                            <span>{photoArchiveProgress.done} / {photoArchiveProgress.total}</span>
                         </div>
                         <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                               className="h-full bg-blue-600 transition-all duration-300"
                               style={{
                                  width: photoArchiveProgress.total
                                    ? `${Math.round((photoArchiveProgress.done / photoArchiveProgress.total) * 100)}%`
                                    : '0%',
                               }}
                            />
                         </div>
                         {photoArchiveProgress.currentUrl && (
                            <p className="text-[10px] text-slate-400 truncate font-mono">{photoArchiveProgress.currentUrl}</p>
                         )}
                      </div>
                   )}

                   {photoArchiveResult && !photoArchiveRunning && (
                      <p className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">
                         Last run: {photoArchiveResult.photosArchived} archived, {photoArchiveResult.photosFailed} failed, {photoArchiveResult.itemsUpdated} items updated.
                      </p>
                   )}

                   {(unarchivedPhotoEntries.length > 0 || photoArchiveFailures.length > 0) && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 space-y-3">
                         <div className="flex items-start gap-2">
                            <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
                            <div>
                               <p className="text-sm font-black text-amber-900">
                                  {unarchivedPhotoEntries.length} photo{unarchivedPhotoEntries.length === 1 ? '' : 's'} still not on Firebase Storage
                               </p>
                               <p className="text-xs text-amber-800 mt-1">
                                  These items still use eBay/search links or local data URLs. Retry below, or edit the item and re-import from eBay.
                               </p>
                            </div>
                         </div>
                         <ul className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {(unarchivedPhotoEntries.length ? unarchivedPhotoEntries : photoArchiveFailures.map((f) => ({ url: f.url, items: f.items }))).map((entry) => {
                               const failure = photoArchiveFailures.find((f) => f.url === entry.url);
                               return (
                                  <li key={entry.url} className="bg-white border border-amber-100 rounded-xl p-3 space-y-2">
                                     <div className="flex gap-3">
                                        <img
                                           src={entry.url}
                                           alt=""
                                           className="w-14 h-14 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0"
                                           onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                        <div className="min-w-0 flex-1">
                                           <p className="text-sm font-bold text-slate-900 truncate">
                                              {entry.items.map((i) => i.name).join(' · ')}
                                           </p>
                                           <p className="text-[10px] text-slate-500 font-mono truncate mt-1" title={entry.url}>{entry.url}</p>
                                           {failure?.error && (
                                              <p className="text-[10px] text-red-700 font-bold mt-1">{failure.error}</p>
                                           )}
                                           <p className="text-[10px] text-slate-400 mt-1">
                                              {entry.items.map((i) => `${i.name}${i.inTrash ? ' (trash)' : ''}`).join(', ')}
                                           </p>
                                        </div>
                                     </div>
                                     <div className="flex flex-wrap gap-2">
                                        <button
                                           type="button"
                                           onClick={() => handleRetrySinglePhoto(entry.url)}
                                           disabled={photoArchiveRunning || retryingPhotoUrl === entry.url || !canArchivePhotosToCloud()}
                                           className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-blue-700 disabled:opacity-50"
                                        >
                                           {retryingPhotoUrl === entry.url ? 'Retrying…' : 'Retry archive'}
                                        </button>
                                        <a
                                           href={entry.url}
                                           target="_blank"
                                           rel="noopener noreferrer"
                                           className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-slate-50"
                                        >
                                           Open URL
                                        </a>
                                     </div>
                                  </li>
                               );
                            })}
                         </ul>
                      </div>
                   )}

                   <button
                      type="button"
                      onClick={handleBulkArchivePhotos}
                      disabled={photoArchiveRunning || !canArchivePhotosToCloud() || photoArchiveAnalysis.uniquePhotosToArchive === 0}
                      className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                      {photoArchiveRunning ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} />}
                      Archive all photos to Storage
                   </button>

                   {!isCloudEnabled() && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                         Add Firebase config below and sign in before archiving.
                      </p>
                   )}
                   {isCloudEnabled() && !user && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                         Sign in with Google (below) to upload photos to your Storage bucket.
                      </p>
                   )}

                   <details className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-600">
                      <summary className="font-black text-slate-800 cursor-pointer text-xs uppercase tracking-wider">
                         How to check if Firebase Storage is enabled
                      </summary>
                      <ol className="mt-3 space-y-2 list-decimal list-inside text-xs leading-relaxed">
                         <li>Open <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">Firebase Console</a> → your project (<code className="bg-slate-200 px-1 rounded">{firebaseConfig.projectId || 'project-id'}</code>).</li>
                         <li>Go to <strong>Build → Storage</strong> in the left menu.</li>
                         <li>If you see <strong>Get started</strong>, click it and choose a bucket location (EU if you are in Germany). That enables Storage.</li>
                         <li>Under <strong>Rules</strong>, allow signed-in uploads, e.g. <code className="bg-slate-200 px-1 rounded text-[10px]">allow read, write: if request.auth != null;</code> for paths under <code className="bg-slate-200 px-1 rounded text-[10px]">items/&#123;userId&#125;/</code>. Deploy rules with <code className="bg-slate-200 px-1 rounded text-[10px]">firebase deploy --only storage</code> if you use the CLI.</li>
                         <li>Back in this app: sign in, then import or archive one photo. If it works, thumbnails switch to <code className="bg-slate-200 px-1 rounded text-[10px]">firebasestorage.googleapis.com</code> URLs.</li>
                         <li>In Firebase Console → Storage → <strong>Files</strong>, you should see folders like <code className="bg-slate-200 px-1 rounded text-[10px]">items/your-uid/…</code>.</li>
                      </ol>
                   </details>
                </div>

                {/* Backup & restore */}
                <div className="bg-white p-6 rounded-[3rem] border border-slate-200 shadow-sm">
                   <h3 className="text-lg font-black text-slate-900 mb-2">Backup &amp; restore</h3>
                   <p className="text-sm text-slate-500 mb-4">Download a JSON backup of all data (inventory, trash, expenses, settings, categories). Restore it anytime if you lose data.</p>
                   <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={handleExportBackup} className="px-4 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-black transition-all flex items-center gap-2">
                         <Download size={16}/> Download backup
                      </button>
                      <label className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs uppercase hover:bg-slate-200 transition-all flex items-center gap-2 cursor-pointer border border-slate-200">
                         <Upload size={16}/> Restore from backup
                         <input type="file" accept=".json,application/json" onChange={handleImportBackup} className="hidden" />
                      </label>
                   </div>
                </div>

                {/* GitHub: sign in → choose/create repo → push (AI Studio style) */}
                <div className="bg-white p-6 rounded-[3rem] border border-slate-200 shadow-sm space-y-6" key={ghAuthRefresh}>
                   <h3 className="text-lg font-black text-slate-900 flex items-center gap-2"><Github size={22}/> Backup to GitHub</h3>
                   <p className="text-sm text-slate-500">
                      Sign in with your GitHub account, pick or create a repo, then push your backup with one click. Every push creates a new version you can roll back to.
                   </p>
                   {ghToken ? (
                      <>
                         <div className="flex flex-wrap items-center gap-3 py-2">
                            <span className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-xl text-sm font-bold text-slate-700">
                               <UserIcon size={16}/> Signed in{ghLogin ? ` as @${ghLogin}` : ' with GitHub'}
                            </span>
                            <button
                               type="button"
                               onClick={() => { clearOAuth(); setGhAuthRefresh(r => r + 1); showToast('Signed out from GitHub', 'success'); }}
                               className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase hover:bg-slate-50"
                            >
                               <LogOut size={14}/> Sign out
                            </button>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Repository for backup</label>
                            <div className="flex flex-wrap gap-2 items-center">
                               <select
                                  className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-900 min-w-[200px]"
                                  value={githubRepo}
                                  onChange={e => { const v = e.target.value; setGitHubRepo(v); if (v && ghToken) saveGitHubConfig(v, ghToken); }}
                                  disabled={ghReposLoading}
                               >
                                  <option value="">Choose a repo…</option>
                                  {githubRepo && !ghRepos.some((r) => r.full_name === githubRepo) && (
                                     <option value={githubRepo}>{githubRepo}</option>
                                  )}
                                  {ghRepos.map((r) => (
                                     <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>
                                  ))}
                               </select>
                               {ghReposLoading && <RefreshCw size={18} className="animate-spin text-slate-400"/>}
                               <span className="text-slate-400 text-sm">or</span>
                               <div className="flex flex-wrap gap-2 items-center">
                                  <input
                                     type="text"
                                     className="w-44 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-900"
                                     placeholder="New repo name"
                                     value={createBackupRepoName}
                                     onChange={e => setCreateBackupRepoName(e.target.value)}
                                  />
                                  <button
                                     type="button"
                                     onClick={handleCreateBackupRepo}
                                     disabled={createBackupRepoLoading}
                                     className="px-4 py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs uppercase hover:bg-slate-900 flex items-center gap-1.5 disabled:opacity-50"
                                  >
                                     {createBackupRepoLoading ? <RefreshCw size={14} className="animate-spin"/> : <Plus size={14}/>}
                                     Create repo
                                  </button>
                               </div>
                            </div>
                         </div>
                         <div className="flex flex-wrap gap-3 items-end">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 w-full sm:w-auto">
                              <input type="checkbox" checked={backupEncrypt} onChange={(e) => setBackupEncrypt(e.target.checked)} className="accent-slate-900" />
                              Encrypt backup (passphrase)
                            </label>
                            {backupEncrypt && (
                              <input
                                type="password"
                                className="w-full sm:w-48 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                                placeholder="Passphrase"
                                value={backupPassphrase}
                                onChange={(e) => setBackupPassphrase(e.target.value)}
                              />
                            )}
                            <button
                               type="button"
                               onClick={handleSyncToGitHub}
                               disabled={githubSyncLoading || !getStoredConfig()}
                               className="px-5 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-black transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                               {githubSyncLoading ? <RefreshCw size={16} className="animate-spin"/> : <ArrowUp size={16}/>}
                               Push backup to GitHub
                            </button>
                            {getStoredConfig() && (
                               <button type="button" onClick={loadGitHubCommits} disabled={githubCommitsLoading} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs uppercase hover:bg-slate-200 transition-all flex items-center gap-2 disabled:opacity-50">
                                  {githubCommitsLoading ? <RefreshCw size={16} className="animate-spin"/> : <History size={16}/>}
                                  Version history
                               </button>
                            )}
                         </div>
                      </>
                   ) : (
                      <>
                         <div>
                            <button
                               type="button"
                               onClick={() => {
                                  if (hasGhClientId) {
                                     try { window.location.href = getOAuthAuthorizeUrl(); } catch (e: any) { showToast(e?.message || 'OAuth not configured', 'error'); }
                                  } else {
                                     showToast('Add VITE_GITHUB_CLIENT_ID to .env and deploy the app to use Sign in with GitHub. See .env.example.', 'error');
                                  }
                               }}
                               className="px-5 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-black transition-all flex items-center gap-2"
                            >
                               <Github size={18}/> Sign in with GitHub
                            </button>
                            <p className="text-xs text-slate-500 mt-2">
                               {hasGhClientId ? 'Sign in to choose a repo and push backup with one click.' : 'Not configured yet: set VITE_GITHUB_CLIENT_ID in .env (and GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET on Vercel) for OAuth.'}
                            </p>
                         </div>
                         <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                            <strong>Or use a token:</strong> Repository (owner/repo) and Personal Access Token below. GitHub → Settings → Developer settings → Personal access tokens (<code className="bg-amber-100 px-1 rounded">repo</code> scope).
                         </p>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                               <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Repository (owner/repo)</label>
                               <input
                                  type="text"
                                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-900"
                                  placeholder="myusername/inventory-backups"
                                  value={githubRepo}
                                  onChange={e => setGitHubRepo(e.target.value)}
                               />
                            </div>
                            <div className="space-y-1">
                               <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Personal Access Token</label>
                               <input
                                  type="password"
                                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-900"
                                  placeholder="ghp_..."
                                  value={githubTokenInput}
                                  onChange={e => setGitHubTokenInput(e.target.value)}
                               />
                            </div>
                         </div>
                         <div className="flex flex-wrap gap-3">
                            <button type="button" onClick={handleSaveGitHubConfig} className="px-4 py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs uppercase hover:bg-slate-900 flex items-center gap-2">
                               <Save size={16}/> Save
                            </button>
                            <button
                               type="button"
                               onClick={handleSyncToGitHub}
                               disabled={githubSyncLoading || !getStoredConfig()}
                               className="px-4 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-black flex items-center gap-2 disabled:opacity-50"
                            >
                               {githubSyncLoading ? <RefreshCw size={16} className="animate-spin"/> : <ArrowUp size={16}/>}
                               Push backup to GitHub
                            </button>
                         </div>
                      </>
                   )}
                   {githubCommits.length > 0 && (
                      <div className="pt-4 border-t border-slate-100">
                         <h4 className="text-sm font-black text-slate-700 mb-3 flex items-center gap-2"><ArchiveRestore size={16}/> Version history (rollback)</h4>
                         <ul className="space-y-2 max-h-60 overflow-y-auto">
                            {githubCommits.map((c) => (
                               <li key={c.sha} className="flex items-center justify-between gap-3 py-2 px-3 bg-slate-50 rounded-xl border border-slate-100">
                                  <div className="min-w-0">
                                     <p className="text-xs font-bold text-slate-800 truncate">{c.message || 'Backup'}</p>
                                     <p className="text-[10px] text-slate-500">
                                        {new Date(c.date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                                        {c.author ? ` · ${c.author}` : ''}
                                     </p>
                                  </div>
                                  <button
                                     type="button"
                                     onClick={() => handleRestoreFromGitHub(c.sha)}
                                     disabled={githubRestoreLoading === c.sha}
                                     className="shrink-0 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
                                  >
                                     {githubRestoreLoading === c.sha ? <RefreshCw size={12} className="animate-spin"/> : <ArchiveRestore size={12}/>}
                                     Restore
                                  </button>
                               </li>
                                   ))}
                         </ul>
                      </div>
                   )}

                   {/* Push this app (source code) to GitHub — armique/inventorycursor */}
                   <div className="pt-6 border-t border-slate-100">
                      <h4 className="text-sm font-black text-slate-800 mb-2 flex items-center gap-2"><FolderPlus size={18}/> Push this app to GitHub</h4>
                      <p className="text-xs text-slate-500 mb-3">From your project folder, run these commands to push to <strong>armique/inventorycursor</strong>:</p>
                      <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 font-mono text-xs overflow-x-auto space-y-2">
                         <div className="flex items-center justify-between gap-2">
                            <span className="select-all">git remote add origin https://github.com/armique/inventorycursor.git</span>
                            <button type="button" onClick={() => copyToClipboard('git remote add origin https://github.com/armique/inventorycursor.git')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                         </div>
                         <div className="flex items-center justify-between gap-2">
                            <span className="select-all">git branch -M main</span>
                            <button type="button" onClick={() => copyToClipboard('git branch -M main')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                         </div>
                         <div className="flex items-center justify-between gap-2">
                            <span className="select-all">git push -u origin main</span>
                            <button type="button" onClick={() => copyToClipboard('git push -u origin main')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                         </div>
                      </div>
                      <a href={GITHUB_APP_REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline mt-2">
                         <ExternalLink size={12}/> Open armique/inventorycursor on GitHub
                      </a>
                   </div>

                   {ghToken && (
                      <div className="pt-4 border-t border-slate-100">
                         <h4 className="text-sm font-black text-slate-800 mb-2">Or create a new repo</h4>
                         <div className="flex flex-wrap gap-2 items-center mb-3">
                            <input
                               type="text"
                               className="w-48 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-900"
                               placeholder="inventory-pro"
                               value={createAppRepoName}
                               onChange={e => setCreateAppRepoName(e.target.value)}
                            />
                            <button
                               type="button"
                               onClick={handleCreateAppRepo}
                               disabled={createAppRepoLoading}
                               className="px-4 py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs uppercase hover:bg-slate-900 flex items-center gap-1.5 disabled:opacity-50"
                            >
                               {createAppRepoLoading ? <RefreshCw size={14} className="animate-spin"/> : <Plus size={14}/>}
                               Create repo
                            </button>
                         </div>
                         {createdAppRepoUrl && (
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                               <p className="text-xs font-bold text-slate-700">Repo created. From your project folder run:</p>
                               <div className="bg-slate-900 text-slate-100 rounded-xl p-3 font-mono text-xs overflow-x-auto space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                     <span className="select-all">git init</span>
                                     <button type="button" onClick={() => copyToClipboard('git init')} className="p-1 rounded hover:bg-slate-700 text-slate-300"><Copy size={12}/></button>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                     <span className="select-all">git add .</span>
                                     <button type="button" onClick={() => copyToClipboard('git add .')} className="p-1 rounded hover:bg-slate-700 text-slate-300"><Copy size={12}/></button>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                     <span className="select-all">git commit -m "Initial commit"</span>
                                     <button type="button" onClick={() => copyToClipboard('git commit -m "Initial commit"')} className="p-1 rounded hover:bg-slate-700 text-slate-300"><Copy size={12}/></button>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                     <span className="select-all">git remote add origin {createdAppRepoUrl}.git</span>
                                     <button type="button" onClick={() => copyToClipboard(`git remote add origin ${createdAppRepoUrl}.git`)} className="p-1 rounded hover:bg-slate-700 text-slate-300"><Copy size={12}/></button>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                     <span className="select-all">git branch -M main && git push -u origin main</span>
                                     <button type="button" onClick={() => copyToClipboard('git branch -M main && git push -u origin main')} className="p-1 rounded hover:bg-slate-700 text-slate-300"><Copy size={12}/></button>
                                  </div>
                               </div>
                               <a href={createdAppRepoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                                  <ExternalLink size={12}/> Open repo on GitHub
                               </a>
                            </div>
                         )}
                      </div>
                   )}
                </div>

                <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                   <div className="flex justify-between items-center">
                      <div>
                         <h3 className="text-xl font-black text-slate-900 flex items-center gap-2"><Cloud className="text-orange-500" size={24}/> Firebase config</h3>
                         <p className="text-sm text-slate-500 mt-1">Firestore + Google sign-in. Add your project credentials below.</p>
                      </div>
                      <button onClick={handleSaveFirebase} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase hover:bg-black transition-all flex items-center gap-2">
                         <Save size={16}/> Save Config
                      </button>
                   </div>

                   <div className="bg-slate-50 p-6 rounded-[2rem] space-y-4">
                      <p className="text-xs text-slate-500 font-medium">
                         Copy these values from your <b>Firebase Console</b> &rarr; Project Settings &rarr; General &rarr; Your Apps &rarr; SDK Setup (Config).
                      </p>
                      <div className="grid grid-cols-1 gap-4">
                         <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">API Key</label>
                            <input type="password" className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-orange-500" value={firebaseConfig.apiKey} onChange={e => setFirebaseConfig({...firebaseConfig, apiKey: e.target.value})} placeholder="AIzaSy..." />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Auth Domain</label>
                            <input type="text" className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-orange-500" value={firebaseConfig.authDomain} onChange={e => setFirebaseConfig({...firebaseConfig, authDomain: e.target.value})} placeholder="project-id.firebaseapp.com" />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Project ID</label>
                            <input type="text" className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-orange-500" value={firebaseConfig.projectId} onChange={e => setFirebaseConfig({...firebaseConfig, projectId: e.target.value})} placeholder="project-id" />
                         </div>
                      </div>
                   </div>

                   {/* AUTH SECTION */}
                   {isCloudEnabled() && (
                      <div className="bg-white border-2 border-slate-100 p-6 rounded-3xl flex flex-col items-center justify-between gap-4">
                         <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${user ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                               <UserIcon size={24}/>
                            </div>
                            <div className="flex-1">
                               <p className="text-sm font-black text-slate-900">{user ? user.email : 'Not Signed In'}</p>
                               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{user ? 'Authenticated' : 'Authentication Required'}</p>
                            </div>
                            {user ? (
                                <button onClick={handleSignOut} className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase hover:bg-slate-50 transition-all flex items-center gap-2">
                                <LogOut size={16}/> Sign Out
                                </button>
                            ) : (
                                <button onClick={handleSignInPopup} disabled={isSigningInPopup} className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200 disabled:opacity-70">
                                   {isSigningInPopup ? <RefreshCw size={14} className="animate-spin"/> : <LogIn size={16}/>} Sign in with Google
                                </button>
                            )}
                         </div>
                      </div>
                   )}

                   {isCloudEnabled() && user && (
                      <div>
                         <button onClick={handleManualPush} disabled={isPushing} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
                            {isPushing ? <RefreshCw size={16} className="animate-spin"/> : <ArrowUp size={16}/>} Save now
                         </button>
                         <p className="text-[10px] text-slate-400 mt-2 text-center">Data also saves automatically as you edit (real-time sync).</p>
                      </div>
                   )}
                </div>
             </div>
          )}

          {activeTab === 'DEPLOY' && (
             <div className="space-y-6">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                   <h3 className="text-xl font-black text-slate-900 flex items-center gap-2"><Rocket size={24}/> Push app to GitHub &amp; deploy on Vercel</h3>
                   <p className="text-sm text-slate-600">
                      Sync this entire project to a GitHub repo so you can deploy it on Vercel. The repo will contain the full app (source code). <strong>Do not commit <code className="bg-slate-100 px-1 rounded">.env</code></strong> — add secrets in Vercel after deploying.
                   </p>

                   <div className="space-y-6">
                      <div>
                         <h4 className="text-sm font-black text-slate-800 mb-2 flex items-center gap-2">Step 1 — Create a GitHub repo</h4>
                         <p className="text-sm text-slate-600 mb-2">Create a new repository on GitHub (e.g. <code className="bg-slate-100 px-1 rounded">inventory-pro</code>). Leave it empty (no README).</p>
                         <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline">
                            <ExternalLink size={14}/> github.com/new
                         </a>
                      </div>

                      <div>
                         <h4 className="text-sm font-black text-slate-800 mb-2 flex items-center gap-2">Step 2 — Push this project to GitHub</h4>
                         <p className="text-sm text-slate-600 mb-3">In a terminal, open this project folder and run (replace <code className="bg-slate-100 px-1 rounded">YOUR_USERNAME/YOUR_REPO</code> with your repo):</p>
                         <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 font-mono text-xs overflow-x-auto space-y-2">
                            <div className="flex items-center justify-between gap-2">
                               <span className="text-slate-400 select-all">git init</span>
                               <button type="button" onClick={() => copyToClipboard('git init')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                               <span className="text-slate-400 select-all">git add .</span>
                               <button type="button" onClick={() => copyToClipboard('git add .')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                               <span className="text-slate-400 select-all">git commit -m "Initial commit"</span>
                               <button type="button" onClick={() => copyToClipboard('git commit -m "Initial commit"')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                               <span className="text-slate-400 select-all">git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git</span>
                               <button type="button" onClick={() => copyToClipboard('git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                               <span className="text-slate-400 select-all">git branch -M main</span>
                               <button type="button" onClick={() => copyToClipboard('git branch -M main')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                               <span className="text-slate-400 select-all">git push -u origin main</span>
                               <button type="button" onClick={() => copyToClipboard('git push -u origin main')} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"><Copy size={14}/></button>
                            </div>
                         </div>
                         <p className="text-xs text-slate-500 mt-2">Requires Git installed. <code className="bg-slate-100 px-1 rounded">.env</code> is in <code className="bg-slate-100 px-1 rounded">.gitignore</code> and will not be pushed.</p>
                      </div>

                      <div>
                         <h4 className="text-sm font-black text-slate-800 mb-2 flex items-center gap-2">Step 3 — Deploy on Vercel</h4>
                         <p className="text-sm text-slate-600 mb-2">Import your GitHub repo on Vercel. Vercel will detect Vite and use the project&apos;s <code className="bg-slate-100 px-1 rounded">vercel.json</code>.</p>
                         <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline">
                            <ExternalLink size={14}/> vercel.com/new
                         </a>
                         <p className="text-xs text-slate-500 mt-2">After import, add your environment variables (e.g. Firebase / API keys) in Vercel → Project → Settings → Environment Variables.</p>
                      </div>
                   </div>
                </div>
             </div>
          )}

          {activeTab === 'AI' && (
             <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2"><Sparkles size={22} className="text-amber-500"/> AI settings (#92–93)</h3>
                <p className="text-sm text-slate-600 max-w-2xl">
                   Control provider priority and model tiers. Keys stay in <code className="bg-slate-100 px-1 rounded">.env</code> / Vercel — this panel only stores preferences.
                </p>
                <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
                   <div>
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Specs fill tier</label>
                      <select
                         value={aiSettings.specsModelTier}
                         onChange={(e) => {
                            const next = { ...aiSettings, specsModelTier: e.target.value as AIModelTier };
                            setAiSettings(next);
                            saveAISettings(next);
                         }}
                         className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm"
                      >
                         <option value="fast">Fast (Groq)</option>
                         <option value="balanced">Balanced</option>
                         <option value="quality">Quality (Gemini)</option>
                      </select>
                   </div>
                   <div>
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Deal search tier</label>
                      <select
                         value={aiSettings.dealSearchModelTier}
                         onChange={(e) => {
                            const next = { ...aiSettings, dealSearchModelTier: e.target.value as AIModelTier };
                            setAiSettings(next);
                            saveAISettings(next);
                         }}
                         className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm"
                      >
                         <option value="fast">Fast</option>
                         <option value="balanced">Balanced</option>
                         <option value="quality">Quality</option>
                      </select>
                   </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                   <input
                      type="checkbox"
                      checked={aiSettings.preferGroqForSpecs}
                      onChange={(e) => {
                         const next = { ...aiSettings, preferGroqForSpecs: e.target.checked };
                         setAiSettings(next);
                         saveAISettings(next);
                      }}
                      className="accent-amber-500"
                   />
                   Prefer Groq for spec fill when available
                </label>
                <p className="text-xs text-slate-500">
                   Provider order: {aiSettings.providerPriority.join(' → ')}. Add keys in Health check.
                </p>
             </div>
          )}

          {activeTab === 'FINANZAMT' && (
             <div className="space-y-6">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                   <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                      <FileSpreadsheet size={24} className="text-emerald-600" />
                      Export für Finanzamt &amp; Steuerberater (Google Tabellen / Excel)
                   </h3>
                   <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                      Erzeugt eine <strong>.xlsx</strong>-Datei mit mehreren Blättern, die Sie direkt in{' '}
                      <strong>Google Drive</strong> hochladen und mit <strong>Google Tabellen</strong> öffnen können — ohne OAuth oder API-Schlüssel in der App.
                      Enthalten sind: aktive Inventarpositionen (Bestand und verkauft), erklärtes Paket-/PC-Verhalten, und Ihre{' '}
                      <strong>Betriebsausgaben</strong>. Optional schränken Sie den Export auf einen <strong>Zeitraum</strong> ein (siehe unten).
                   </p>

                   <div className="grid gap-4 md:grid-cols-2">
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                         <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Blatt „Ware_Buchungen“</h4>
                         <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
                            <li>
                               <strong>Bezeichnung</strong>, <strong>Einkaufsdatum</strong>, <strong>Verkaufsdatum</strong>,{' '}
                               <strong>Einkaufspreis_EUR</strong>, <strong>Verkaufspreis_EUR</strong>, <strong>Gewinn_EUR</strong> (und Gebühren)
                            </li>
                            <li>Spalten <strong>Paket_oder_PC</strong>, <strong>Rolle_im_Paket</strong> und <strong>Stückliste_Komponenten</strong> erklären Bundles und PCs</li>
                            <li>Entwürfe (<code className="bg-slate-200 px-1 rounded text-xs">isDraft</code>) und Papierkorb sind nicht enthalten</li>
                         </ul>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                         <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Pakete &amp; Doppelzählung</h4>
                         <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
                            <li>
                               <strong>Verkauf über den Verkaufsdialog:</strong> Verkaufspreis und Gewinn stehen auf den <strong>Komponentenzeilen</strong> (anteilig nach Einkaufspreis). Die leere Paket-Hülle erscheint nicht — damit summieren Sie den Umsatz nicht zweimal.
                            </li>
                            <li>
                               <strong>Retro-Paket / ein Paketpreis:</strong> Umsatz steht auf der <strong>Paketzeile</strong>; Komponenten nur als Stückliste.
                            </li>
                            <li>Blatt <strong>Pakete_Uebersicht</strong>: je Paket/PC eine Zeile mit Stückliste und Buchungshinweis</li>
                         </ul>
                      </div>
                   </div>

                   <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2">
                      <h4 className="text-sm font-black text-emerald-900">So öffnen Sie die Datei in Google Tabellen</h4>
                      <ol className="text-sm text-emerald-900/90 list-decimal pl-5 space-y-1">
                         <li>Export hier unten herunterladen.</li>
                         <li>Google Drive → <strong>Neu</strong> → <strong>Datei hochladen</strong> → die .xlsx wählen.</li>
                         <li>Rechtsklick auf die Datei → <strong>Öffnen mit</strong> → <strong>Google Tabellen</strong>.</li>
                      </ol>
                   </div>

                   <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 space-y-4 max-w-3xl">
                      <div>
                         <label htmlFor="finanz-range-preset" className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">
                            Export-Zeitraum
                         </label>
                         <select
                            id="finanz-range-preset"
                            value={finanzRangePreset}
                            onChange={(e) => setFinanzRangePreset(e.target.value as FinanzamtExportRangePreset)}
                            className="w-full max-w-md px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                         >
                            <option value="all">Alle Daten (kein Datumsfilter)</option>
                            <option value="last_month">Letzter Kalendermonat</option>
                            <option value="last_3_months">Letzte drei Monate (laufend: seit 1. des drittletzten Monats bis heute)</option>
                            <option value="this_year">Dieses Jahr (1. Jan. bis heute)</option>
                            <option value="last_year">Letztes Kalenderjahr</option>
                            <option value="custom_year">Beliebiges Kalenderjahr</option>
                            <option value="custom_range">Eigener Zeitraum (Von / Bis)</option>
                         </select>
                      </div>
                      {finanzRangePreset === 'custom_year' && (
                         <div className="flex flex-wrap items-end gap-3">
                            <div>
                               <label htmlFor="finanz-custom-year" className="block text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">
                                  Jahr
                               </label>
                               <input
                                  id="finanz-custom-year"
                                  type="number"
                                  min={1990}
                                  max={new Date().getFullYear() + 1}
                                  value={finanzCustomYear}
                                  onChange={(e) => setFinanzCustomYear(Number(e.target.value) || new Date().getFullYear())}
                                  className="w-32 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:border-emerald-600"
                               />
                            </div>
                            <p className="text-xs text-slate-500 pb-1">1. Jan. bis 31. Dez. dieses Jahres</p>
                         </div>
                      )}
                      {finanzRangePreset === 'custom_range' && (
                         <div className="flex flex-wrap items-end gap-3">
                            <div>
                               <label htmlFor="finanz-from" className="block text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">
                                  Von
                               </label>
                               <input
                                  id="finanz-from"
                                  type="date"
                                  value={finanzCustomFrom}
                                  onChange={(e) => setFinanzCustomFrom(e.target.value)}
                                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold outline-none focus:border-emerald-600"
                               />
                            </div>
                            <div>
                               <label htmlFor="finanz-to" className="block text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">
                                  Bis
                               </label>
                               <input
                                  id="finanz-to"
                                  type="date"
                                  value={finanzCustomTo}
                                  onChange={(e) => setFinanzCustomTo(e.target.value)}
                                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold outline-none focus:border-emerald-600"
                               />
                            </div>
                         </div>
                      )}
                      {finanzRangePreset === 'custom_range' && !finanzExportResolution.valid && (
                         <p className="text-xs text-amber-700 font-semibold">Bitte Von- und Bis-Datum wählen (Format JJJJ-MM-TT).</p>
                      )}
                      {finanzExportResolution.valid && finanzExportResolution.bounds && (
                         <p className="text-xs text-slate-600">
                            Zeitraum: <strong>{formatBoundsGerman(finanzExportResolution.bounds)}</strong> — im Export erscheinen nur Positionen mit Einkaufs-, Verkaufs- oder Container-Verkaufsdatum in diesem Bereich (Pakete/PCs inkl. aller Komponenten, wenn mindestens eine Position passt) sowie Ausgaben mit Buchungsdatum im Bereich.
                         </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                         <button
                            type="button"
                            disabled={!finanzExportResolution.valid}
                            onClick={() => {
                               if (!finanzExportResolution.valid) {
                                  showToast('Bitte gültigen Zeitraum wählen.', 'error');
                                  return;
                               }
                               void (async () => {
                                  try {
                                     const { exportFinanzamtWorkbook } = await import('../services/finanzamtExportService');
                                     const { bounds } = finanzExportResolution;
                                     await exportFinanzamtWorkbook(items, expenses, {
                                        companyName: businessSettings.companyName,
                                        dateRange: bounds,
                                        dateRangeDescription: bounds
                                           ? `${formatBoundsGerman(bounds)} — Inventar: Positionen mit Einkaufs-, Verkaufs- oder Container-Verkaufsdatum im Zeitraum (Pakete vollständig, wenn eine Position passt). Ausgaben: Buchungsdatum im Zeitraum.`
                                           : undefined,
                                     });
                                     showToast('Finanzamt-Export heruntergeladen', 'success');
                                  } catch {
                                     showToast('Export fehlgeschlagen — bitte erneut versuchen.', 'error');
                                  }
                               })();
                            }}
                            className="px-6 py-3 bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-800 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:pointer-events-none"
                         >
                            <Download size={18} />
                            Finanzamt-Export (.xlsx) herunterladen
                         </button>
                         <span className="text-xs text-slate-500">
                            {finanzExportCounts.items} Positionen · {finanzExportCounts.expenses} Ausgaben
                            {finanzExportResolution.bounds ? ' (gefiltert)' : ''}
                         </span>
                      </div>
                   </div>

                   <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-4">
                      <h4 className="text-sm font-black text-indigo-900 flex items-center gap-2">
                         <FileText size={18} /> Steuerberater-Paket (JSON)
                      </h4>
                      <p className="text-xs text-indigo-900/80">
                         Ein ZIP-freies JSON-Bundle mit Inventar, Ausgaben und Einstellungen — zum Weitergeben an Ihren Steuerberater (#70).
                      </p>
                      <button
                         type="button"
                         onClick={() => {
                            void (async () => {
                               const blob = await buildSteuerberaterBundle({
                                  items,
                                  expenses,
                                  businessSettings,
                                  actionHistory,
                                  rangeLabel: finanzExportResolution.bounds ? formatBoundsGerman(finanzExportResolution.bounds) : 'Alle Daten',
                               });
                               downloadSteuerberaterBundle(blob, `steuerberater-${new Date().toISOString().slice(0, 10)}.json`);
                               showToast('Steuerberater-Paket heruntergeladen', 'success');
                            })();
                         }}
                         className="px-5 py-2.5 bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase hover:bg-indigo-800 flex items-center gap-2"
                      >
                         <Download size={16} /> Steuerberater-Paket (.json)
                      </button>
                   </div>

                   <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                      <h4 className="text-sm font-black text-slate-900">ELSTER-Vorbereitung (#64)</h4>
                      <p className="text-xs text-slate-500">Checkliste — ersetzt keine ELSTER-Übermittlung.</p>
                      <ul className="space-y-2">
                         {elsterChecklist.map((row) => (
                            <li key={row.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                               {row.done ? (
                                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                               ) : (
                                  <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                               )}
                               <div>
                                  <p className="text-sm font-bold text-slate-800">{row.label}</p>
                                  <p className="text-[10px] text-slate-500">{row.hint}</p>
                               </div>
                            </li>
                         ))}
                      </ul>
                   </div>

                   <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                      Keine Rechtsberatung: Die Datei spiegelt Ihre App-Daten wider. Bewertung für Umsatzsteuer, EÜR oder Gewinnermittlung bleibt Sache von Ihnen und ggf. Ihrem Steuerberater.
                   </p>
                </div>
             </div>
          )}

          {activeTab === 'CATEGORIES' && onUpdateCategoryStructure && onUpdateCategoryFields && (
             <CategoryEditor
                categories={categories}
                categoryFields={categoryFields}
                onUpdateCategoryStructure={onUpdateCategoryStructure}
                onUpdateCategoryFields={onUpdateCategoryFields}
             />
          )}

          {activeTab === 'SYSTEM' && (
             <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2"><Wrench size={22}/> System</h3>
                <div className="bg-violet-50 border border-violet-200 p-6 rounded-2xl">
                   <h4 className="text-sm font-black text-violet-900 flex items-center gap-2 mb-2"><Shield size={18}/> GDPR buyer data export (#146)</h4>
                   <p className="text-sm text-violet-800 leading-relaxed mb-4">
                      Export buyer names and linked sales from inventory for data-subject requests.
                   </p>
                   <button
                      type="button"
                      onClick={() => {
                         const blob = buildGdprExportBlob({ items, expenses, businessSettings });
                         downloadGdprExport(blob);
                         showToast('GDPR export downloaded', 'success');
                      }}
                      className="px-5 py-2.5 bg-violet-700 text-white rounded-xl font-bold text-xs uppercase hover:bg-violet-800 flex items-center gap-2"
                   >
                      <Download size={16}/> Export buyer data (.json)
                   </button>
                </div>
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl">
                   <h4 className="text-sm font-black text-amber-900 flex items-center gap-2 mb-2"><FileText size={18}/> Fix broken text encoding</h4>
                   <p className="text-sm text-amber-800 leading-relaxed mb-4">
                      If some item names or notes show garbled characters (e.g. &quot;Ð¢Ð¾Ñ‚Ð°Ð»&quot; instead of &quot;Тотал&quot;), the text was saved with the wrong encoding. This fixes UTF-8 text that was misinterpreted as Latin-1. It updates names, vendor, notes, and spec text on all inventory and trash items.
                   </p>
                   <button
                      type="button"
                      onClick={handleFixEncoding}
                      disabled={!onFixEncoding}
                      className="px-5 py-2.5 bg-amber-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-amber-700 transition-all flex items-center gap-2 disabled:opacity-50"
                   >
                      <FileText size={16}/> Fix encoding in all items
                   </button>
                </div>
                <div className="bg-blue-50 border border-blue-200 p-6 rounded-2xl">
                   <h4 className="text-sm font-black text-blue-900 flex items-center gap-2 mb-2"><ArchiveRestore size={18}/> Backfill component sell dates</h4>
                   <p className="text-sm text-blue-800 leading-relaxed mb-4">
                      For PCs and bundles that were already sold before this feature was added, this migration sets <code className="bg-blue-100 px-1 rounded">containerSoldDate</code> on all their components. This lets you measure &quot;days in stock&quot; per component even if they were sold as part of a build. Only updates components that don&apos;t already have this field set.
                   </p>
                   <button
                      type="button"
                      onClick={handleBackfillContainerSoldDates}
                      className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-blue-700 transition-all flex items-center gap-2"
                   >
                      <ArchiveRestore size={16}/> Backfill historical data
                   </button>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl">
                   <h4 className="text-sm font-black text-emerald-900 flex items-center gap-2 mb-2"><RefreshCw size={18}/> Apply proportional sell prices to sold bundles/PCs</h4>
                   <p className="text-sm text-emerald-800 leading-relaxed mb-4">
                      For bundles and PC builds that were already sold before proportional price allocation was implemented, this migration calculates and applies proportional <code className="bg-emerald-100 px-1 rounded">sellPrice</code>, <code className="bg-emerald-100 px-1 rounded">feeAmount</code>, and <code className="bg-emerald-100 px-1 rounded">profit</code> to all child components based on their buy price ratios. Each component receives a share of the bundle&apos;s total sell price proportional to its buy price.
                   </p>
                   <button
                      type="button"
                      onClick={handleRetroactiveProportionalPrices}
                      className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-700 transition-all flex items-center gap-2"
                   >
                      <RefreshCw size={16}/> Apply proportional prices
                   </button>
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};

const InputField = ({ label, value, onChange, placeholder }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black uppercase text-slate-400 ml-1">{label}</label>
    <input className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-slate-900" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

export default SettingsPage;
