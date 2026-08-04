import React, { Suspense } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Package, Settings, RefreshCw, Trash2, CloudUpload, LayoutDashboard,
  Loader2, Cloud, CheckCircle2, X, Receipt, History, Globe, Layers,
  Printer, LayoutTemplate, PackageSearch, Boxes, ChevronDown, ChevronLeft, ChevronRight, Plus, Images,
  Target, Activity, CircuitBoard, Radar, Coins, Bot, TrendingDown, Upload,
} from 'lucide-react';
import PanelBreadcrumbs from './PanelBreadcrumbs';
import { usePanelLocale } from '../context/PanelLocaleContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import { usePanelKeyboardShortcuts } from '../hooks/usePanelKeyboardShortcuts';
import {
  signInWithGoogle,
  logOut,
  getAuthErrorMessage,
  isUsingFirebaseEmulator,
  signInEmulatorWithEmail,
  prefersRedirectSignIn,
} from '../services/firebaseService';
import QuotaMonitor from './QuotaMonitor';
import FirestoreQuotaWidget from './FirestoreQuotaWidget';
import GlobalSearch from './GlobalSearch';
import { InventoryItem, Expense, BusinessSettings } from '../types';
import { cloudSyncBadgeLabel, cloudSyncBadgeTitle } from '../utils/cloudSyncStatus';
import { defaultGamificationState, type GamificationState } from '../utils/gamification';
import { useGamificationEvents } from '../hooks/useGamificationEvents';
import GamificationEventLayer from './gamification/GamificationEventLayer';
import { useAiSession, useUnreviewedAiCount } from '../hooks/useAiActions';
import { useStaleDealCount } from '../hooks/useInboxAlerts';
import { endAiSession } from '../services/aiSession';

interface SyncState {
  status: 'idle' | 'pending' | 'syncing' | 'success' | 'error';
  lastSynced: Date | null;
  message?: string;
}

interface PanelLayoutProps {
  isCloudEnabled: boolean;
  authUser: any;
  /** True once Firebase auth has completed initial check (so we don't flash login before session restore). */
  authReady?: boolean;
  /** Whether the current user is allowed to access the admin panel. */
  isAdmin?: boolean;
  syncState?: SyncState;
  onForcePush?: () => void;
  backupBannerDismissed?: boolean;
  onDismissBackupBanner?: () => void;
  items?: InventoryItem[];
  expenses?: Expense[];
  businessSettings?: BusinessSettings;
  onUpdateItems?: (items: InventoryItem[], deleteIds?: string[]) => void;
  gamification?: GamificationState;
  updateGamification?: (updater: (prev: GamificationState) => GamificationState) => void;
}

const PanelLayout: React.FC<PanelLayoutProps> = ({ isCloudEnabled, authUser, authReady = false, isAdmin = false, syncState = { status: 'idle', lastSynced: null }, onForcePush, backupBannerDismissed = true, onDismissBackupBanner, items = [], expenses = [], businessSettings = { companyName: '', ownerName: '', address: '', taxMode: 'SmallBusiness' }, onUpdateItems, gamification, updateGamification }) => {
  const location = useLocation();
  const { locale, setLocale } = usePanelLocale();
  const { openSettings } = useSettingsModal();
  usePanelKeyboardShortcuts();
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const [emulatorEmail, setEmulatorEmail] = React.useState('abelyanarmen@gmail.com');
  const [moreNavOpen, setMoreNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('panel_sidebar_collapsed_v1') === '1';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('panel_sidebar_collapsed_v1', sidebarCollapsed ? '1' : '0');
    } catch {
      /* Browser storage unavailable — keep the preference for this session. */
    }
  }, [sidebarCollapsed]);
  const unreviewedAiCount = useUnreviewedAiCount();
  const aiSession = useAiSession();
  /** Deals unresolved for 3+ days — flagged on Inventory, since the Inbox lives there. */
  const staleDealCount = useStaleDealCount();
  const mobileRedirectSignIn = prefersRedirectSignIn();

  // Lock document scroll while the panel shell owns nested scroll regions (esp. inventory on mobile).
  React.useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehaviorY;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehaviorY = 'none';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      body.style.overscrollBehaviorY = prevOverscroll;
    };
  }, []);

  const gamificationState = gamification ?? defaultGamificationState();
  const updateGamificationState = updateGamification ?? (() => {});
  // Wait for cloud download (or a failed sync) before celebrating sales — otherwise every
  // already-sold item looks "new" on an empty phone and pops the deal toast over Inventory.
  const gamificationEventsArmed =
    !isCloudEnabled || syncState.status === 'success' || syncState.status === 'error';
  const {
    current: gamificationEvent,
    dismiss: dismissGamificationEvent,
    resolveDealClosed: resolveGamificationDealClosed,
  } = useGamificationEvents({
    items,
    expenses,
    taxMode: businessSettings.taxMode,
    gamification: gamificationState,
    updateGamification: updateGamificationState,
    eventsArmed: gamificationEventsArmed,
    allowProactiveEvents: !mobileRedirectSignIn,
  });

  /** Inventory/trash use internal scroll + docked bulk bar; eBay tools / EST / bulk entry use full-width workspace layout. */
  const isDockedPanelPage =
    /^\/panel\/(inventory|trash|ebay-store-pull|est|dealwatch|add-bulk)(\/|$)/.test(location.pathname);

  const requireAuth = isCloudEnabled && authReady && !authUser;

  if (isCloudEnabled && authReady && authUser && !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access denied</h2>
          <p className="text-slate-600 text-sm mb-4">This admin panel is only available to the owner.</p>
          <p className="text-xs text-slate-400 mb-6 break-all">{authUser.email}</p>
          <div className="flex gap-3">
            <a href="/" className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200">
              Back to store
            </a>
            <button
              type="button"
              onClick={async () => {
                setSigningIn(true);
                try {
                  await logOut();
                } catch {
                  // ignore
                } finally {
                  setSigningIn(false);
                }
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {signingIn ? 'Signing out…' : 'Switch account'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (requireAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Admin Panel</h2>
          <p className="text-slate-600 text-sm mb-6">Sign in to access the panel.</p>
          <button
            type="button"
            disabled={signingIn}
            onClick={async () => {
              setSigningIn(true);
              setSignInError(null);
              try {
                const user = await signInWithGoogle({
                  returnPath: `${window.location.pathname}${window.location.search}`,
                });
                if (!user) return;
              } catch (e) {
                console.error(e);
                setSignInError(getAuthErrorMessage(e));
              } finally {
                setSigningIn(false);
              }
            }}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {signingIn ? <Loader2 size={18} className="animate-spin" /> : null}
            {signingIn ? 'Waiting for Google…' : 'Sign in with Google'}
          </button>
          {signInError && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-left text-xs font-semibold leading-relaxed text-red-700"
            >
              {signInError}
            </p>
          )}
          {mobileRedirectSignIn && (
            <p className="text-xs text-slate-500 mt-3">
              A Google account window will open. After you approve, your inventory downloads from the cloud onto this phone.
            </p>
          )}
          {isUsingFirebaseEmulator() && (
            <div className="mt-4 pt-4 border-t border-dashed border-slate-200 text-left">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">
                Emulator dev sign-in — not present in production builds
              </p>
              <div className="flex gap-2">
                <input
                  value={emulatorEmail}
                  onChange={(e) => setEmulatorEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold"
                />
                <button
                  type="button"
                  disabled={signingIn || !emulatorEmail.trim()}
                  onClick={async () => {
                    setSigningIn(true);
                    try {
                      await signInEmulatorWithEmail(emulatorEmail.trim());
                    } catch (e) {
                      console.error(e);
                      alert(getAuthErrorMessage(e));
                    } finally {
                      setSigningIn(false);
                    }
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-600 disabled:opacity-50"
                >
                  Emulator sign-in
                </button>
              </div>
            </div>
          )}
          <a href="/" className="block mt-4 text-sm text-slate-500 hover:text-slate-700">← Back to store</a>
        </div>
      </div>
    );
  }

  const primaryNav = [
    { to: '/panel/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
    {
      to: '/panel/inventory',
      icon: <Package size={18} />,
      label: 'Inventory',
      warnCount: staleDealCount,
    },
    { to: '/panel/flip-coach', icon: <Target size={18} />, label: 'Flip Coach' },
    { to: '/panel/sold-pulse', icon: <Activity size={18} />, label: 'Buy Helper' },
    { to: '/panel/dealwatch', icon: <Radar size={18} />, label: 'Dealwatch' },
    { to: '/panel/ebay-hunt', icon: <Target size={18} />, label: 'Lot Hunt' },
    { to: '/panel/reinvest', icon: <Coins size={18} />, label: 'Reinvest' },
    { to: '/panel/price-drop', icon: <TrendingDown size={18} />, label: 'Price Drop' },
    { to: '/panel/list-ready', icon: <Upload size={18} />, label: 'List Ready' },
    { to: '/panel/automations', icon: <Bot size={18} />, label: 'Automations' },
    { to: '/panel/combo-lab', icon: <CircuitBoard size={18} />, label: 'Combo Lab' },
    { to: '/panel/bulk-imports', icon: <History size={18} />, label: 'Bulk imports' },
    { to: '/panel/ebay-store-pull', icon: <PackageSearch size={18} />, label: 'eBay Tools' },
    {
      to: '/panel/ebay-store-pull?tab=bundles',
      icon: <Boxes size={18} />,
      label: 'Parse Bundles',
    },
    { to: '/panel/card-gallery', icon: <Images size={18} />, label: 'Card gallery' },
    { to: '/panel/ai-actions', icon: <Bot size={18} />, label: 'Done by AI', count: unreviewedAiCount },
    { action: 'settings', icon: <Settings size={18} />, label: 'Settings', alert: !isCloudEnabled },
  ];

  const moreNav = [
    { to: '/panel/3d-print', icon: <Printer size={16} />, label: '3D Print' },
    { to: '/panel/add-bulk', icon: <Layers size={16} />, label: 'Bulk entry' },
    { to: '/panel/invoices', icon: <Receipt size={16} />, label: 'Invoices' },
    { to: '/panel/action-history', icon: <History size={16} />, label: 'Action history' },
    { to: '/panel/expenses', icon: <RefreshCw size={16} />, label: 'Expenses' },
    { to: '/panel/import', icon: <CloudUpload size={16} />, label: 'Import CSV' },
    { to: '/panel/trash', icon: <Trash2 size={16} />, label: 'Trash' },
    { to: '/panel/store-management', icon: <Globe size={16} />, label: 'Store' },
    { to: '/panel/storefront-configurator', icon: <LayoutTemplate size={16} />, label: 'Storefront config' },
  ];

  const addHubActive =
    location.pathname === '/panel/add' ||
    location.pathname.startsWith('/panel/add/') ||
    location.pathname.startsWith('/panel/builder') ||
    location.pathname === '/panel/add-bulk' ||
    location.pathname === '/panel/3d-print' ||
    location.pathname === '/panel/import' ||
    (location.pathname === '/panel/ebay-store-pull' && location.search.includes('tab=import'));

  return (
    <div className="flex h-screen h-dvh max-h-dvh bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* DESKTOP SIDEBAR */}
      <aside
        className={`shrink-0 overflow-hidden bg-slate-950 text-white flex-col hidden md:flex border-r border-white/5 transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'w-[4.5rem]' : 'w-[17.5rem]'
        }`}
      >
        <div className={sidebarCollapsed ? 'p-3 space-y-3' : 'p-5 space-y-3'}>
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
            <Link
              to="/panel/dashboard"
              className="min-w-0 text-lg font-display font-black tracking-tight flex items-center gap-2 text-white"
              title={sidebarCollapsed ? 'Dashboard' : undefined}
            >
            <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-500/20 text-brand-300 flex items-center justify-center">
              <Package size={18} />
            </span>
              {!sidebarCollapsed && <span className="truncate">DeInventory</span>}
            </Link>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {!sidebarCollapsed && (
            <GlobalSearch items={items} expenses={expenses} businessSettings={businessSettings} />
          )}
        </div>

        {/* ADD — opens icon hub (step 1) */}
        <div className={`${sidebarCollapsed ? 'px-2' : 'px-4'} mb-3`}>
          <Link
            to="/panel/add"
            title={sidebarCollapsed ? 'Add inventory' : undefined}
            aria-label={sidebarCollapsed ? 'Add inventory' : undefined}
            className={`w-full flex items-center rounded-xl font-black text-xs uppercase tracking-widest transition-colors ${
              sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between gap-2 px-3 py-2.5'
            } ${
              addHubActive
                ? 'bg-white text-slate-900'
                : 'bg-brand-600 hover:bg-brand-500 text-white'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={16} /> {!sidebarCollapsed && 'Add'}
            </span>
          </Link>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto scrollbar-hide pb-4 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}>
          {!sidebarCollapsed && (
            <p className="px-3 pt-1 pb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Navigate</p>
          )}
          {primaryNav.map((item) => {
            if ('action' in item && item.action === 'settings') {
              return (
                <button
                  key="settings"
                  type="button"
                  onClick={() => openSettings()}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`flex items-center rounded-xl font-bold text-sm transition-all relative w-full text-slate-400 hover:bg-white/5 hover:text-white ${
                    sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5 text-left'
                  }`}
                >
                  {item.icon} {!sidebarCollapsed && item.label}
                  {item.alert && (
                    <span className={`absolute w-2 h-2 bg-red-500 rounded-full animate-pulse ${
                      sidebarCollapsed ? 'right-2 top-2' : 'right-3 top-3'
                    }`} />
                  )}
                </button>
              );
            }
            const { to, icon, label, alert, count, warnCount } = item as {
              to: string;
              icon: React.ReactNode;
              label: string;
              alert?: boolean;
              count?: number;
              warnCount?: number;
            };
            const [navPath, navQuery] = to.split('?');
            const isActive = navQuery
              ? location.pathname === navPath && location.search.includes(navQuery)
              : navPath === '/panel/ebay-store-pull' && location.search.includes('tab=bundles')
                ? false
                : location.pathname === navPath ||
                  (navPath !== '/panel/dashboard' && location.pathname.startsWith(navPath));
            return (
              <Link
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                aria-label={sidebarCollapsed ? label : undefined}
                className={`flex items-center rounded-xl font-bold text-sm transition-all relative ${
                  sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {icon} {!sidebarCollapsed && label}
                {!sidebarCollapsed && typeof warnCount === 'number' && warnCount > 0 && (
                  <span
                    className="ml-auto inline-flex items-center gap-0.5 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-black tabular-nums"
                    title={`${warnCount} deal${warnCount === 1 ? '' : 's'} unresolved for 3+ days — open the Inbox tab`}
                  >
                    ⚠ {warnCount > 99 ? '99+' : warnCount}
                  </span>
                )}
                {!sidebarCollapsed && typeof count === 'number' && count > 0 && (
                  <span
                    className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-violet-500 text-white text-[10px] font-black flex items-center justify-center tabular-nums"
                    title={`${count} AI change${count === 1 ? '' : 's'} awaiting review`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                {sidebarCollapsed &&
                  ((typeof warnCount === 'number' && warnCount > 0) ||
                    (typeof count === 'number' && count > 0) ||
                    alert) && (
                    <span className="absolute right-2 top-2 w-2 h-2 bg-amber-400 rounded-full" />
                  )}
                {!sidebarCollapsed && alert && <span className="absolute right-3 top-3 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreNavOpen((v) => !v)}
            title={sidebarCollapsed ? 'More navigation' : undefined}
            aria-label={sidebarCollapsed ? 'More navigation' : undefined}
            className={`w-full flex items-center rounded-xl text-slate-500 hover:text-slate-300 text-xs font-black uppercase tracking-widest mt-2 ${
              sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'
            }`}
          >
            {!sidebarCollapsed && 'More'}
            <ChevronDown size={14} className={`transition-transform ${moreNavOpen ? 'rotate-180' : ''}`} />
          </button>
          {moreNavOpen && (
            <div className="space-y-0.5 pb-2">
              {moreNav.map(({ to, icon, label }) => {
                const isActive = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    title={sidebarCollapsed ? label : undefined}
                    aria-label={sidebarCollapsed ? label : undefined}
                    className={`flex items-center rounded-lg text-xs font-bold transition-colors ${
                      sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2'
                    } ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                    }`}
                  >
                    {icon} {!sidebarCollapsed && label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
        {!sidebarCollapsed && (
          <div className="p-4 border-t border-white/5">
            <QuotaMonitor />
          </div>
        )}
      </aside>
      {/* MAIN AREA */}
      <main
        className={`flex-1 flex flex-col min-h-0 overflow-hidden relative ${
          isDockedPanelPage
            ? 'p-1.5 md:p-2 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-2'
            : 'p-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:p-8 lg:p-8 xl:p-10 2xl:p-12 md:pb-8'
        }`}
      >
        {/* Mobile global search — skip on Stock (has its own search) */}
        {!location.pathname.startsWith('/panel/inventory') &&
          !location.pathname.startsWith('/panel/edit') &&
          !location.pathname.startsWith('/panel/dealwatch') && (
          <div className="md:hidden mb-4">
            <GlobalSearch items={items} expenses={expenses} businessSettings={businessSettings} />
          </div>
        )}
        {isCloudEnabled && authUser && (
          <div className="fixed bottom-3 left-3 z-[80] flex flex-col gap-1.5 items-start pointer-events-none max-w-[min(18rem,calc(100vw-1.5rem))]">
            <div className="pointer-events-auto">
              <div className="hidden md:block">
                <FirestoreQuotaWidget
                  items={items}
                  compact={location.pathname.startsWith('/panel/inventory')}
                />
              </div>
            </div>
            {syncState.status !== 'idle' && (
              <button
                type="button"
                onClick={() => syncState.status === 'error' && onForcePush?.()}
                disabled={syncState.status === 'syncing' || syncState.status === 'pending'}
                className={`pointer-events-auto hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border shadow-lg transition-all ${
                  syncState.status === 'pending' ? 'bg-sky-50 text-sky-800 border-sky-200' :
                  syncState.status === 'syncing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  syncState.status === 'error' ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 cursor-pointer' :
                  'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
                title={cloudSyncBadgeTitle(syncState)}
              >
                {(syncState.status === 'syncing' || syncState.status === 'pending') && (
                  <Loader2 size={12} className="animate-spin shrink-0" />
                )}
                {syncState.status === 'success' && <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />}
                {syncState.status === 'error' && <RefreshCw size={12} className="shrink-0" />}
                <span>{cloudSyncBadgeLabel(syncState)}</span>
              </button>
            )}
          </div>
        )}
        {aiSession && (
          <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/20">
            <Bot size={18} className="shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-widest">AI mode on</p>
              <p className="text-[11px] font-semibold text-violet-100 truncate">
                Every change is tagged and logged to Done by AI
                {aiSession.context ? ` · ${aiSession.context}` : ''}
                {aiSession.actionCount > 0 ? ` · ${aiSession.actionCount} logged` : ''}
              </p>
            </div>
            <Link
              to="/panel/ai-actions"
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-[10px] font-black uppercase tracking-wider"
            >
              Review
            </Link>
            <button
              type="button"
              onClick={() => endAiSession()}
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white text-violet-700 text-[10px] font-black uppercase tracking-wider hover:bg-violet-50"
            >
              Turn off
            </button>
          </div>
        )}
        {!isCloudEnabled && !backupBannerDismissed && onDismissBackupBanner && (
          <div className="mb-6 flex items-start gap-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
            <Cloud className="shrink-0 mt-0.5 text-amber-600" size={20}/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Set up Cloud Backup so your inventory is stored on the web.</p>
              <button type="button" onClick={() => openSettings('CLOUD')} className="inline-block mt-2 text-xs font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 underline">Settings → Account</button>
            </div>
            <button type="button" onClick={onDismissBackupBanner} className="shrink-0 p-1 rounded-lg hover:bg-amber-100 text-amber-600" aria-label="Dismiss">
              <X size={18}/>
            </button>
          </div>
        )}
        <div
          className={`flex-1 min-h-0 flex flex-col ${isDockedPanelPage ? 'overflow-hidden' : 'overflow-y-auto'}`}
        >
          <div
            className={`shrink-0 flex items-center justify-between gap-2 ${
              isDockedPanelPage ? 'py-0 mb-0.5' : 'px-4 md:px-8 pt-4'
            }`}
          >
            <div className={isDockedPanelPage ? 'hidden md:block min-w-0' : 'min-w-0'}>
              <PanelBreadcrumbs />
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px] font-black uppercase">
              <button type="button" onClick={() => setLocale('en')} className={`px-2 py-1 rounded ${locale === 'en' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>EN</button>
              <button type="button" onClick={() => setLocale('de')} className={`px-2 py-1 rounded ${locale === 'de' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>DE</button>
                          </div>
              <button
                type="button"
                onClick={() => openSettings()}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                title="Settings"
                aria-label="Open settings"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
          <div
            className={
              isDockedPanelPage
                ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
                : 'flex flex-col min-w-0'
            }
          >
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-[300px] flex-1">
                <Loader2 size={32} className="animate-spin text-slate-400" />
              </div>
            }>
              <Outlet />
            </Suspense>
          </div>
        </div>
        {/* Mobile sync: pending / uploading / error — never cover the stock list */}
        {(syncState.status === 'pending' || syncState.status === 'syncing' || syncState.status === 'error') && (
          <button
            type="button"
            onClick={() => syncState.status === 'error' && onForcePush?.()}
            disabled={syncState.status === 'syncing' || syncState.status === 'pending'}
            className={`md:hidden fixed top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-3 z-[110] px-3 py-2 rounded-full shadow-lg flex items-center gap-2 text-[10px] font-bold tracking-wide border max-w-[min(70vw,16rem)] ${
              syncState.status === 'error'
                ? 'bg-red-600 text-white border-red-500'
                : syncState.status === 'pending'
                  ? 'bg-sky-900 text-white border-sky-800'
                  : 'bg-slate-900 text-white border-slate-800'
            }`}
            title={cloudSyncBadgeTitle(syncState)}
          >
            {(syncState.status === 'syncing' || syncState.status === 'pending') && (
              <Loader2 size={14} className="animate-spin text-blue-300 shrink-0" />
            )}
            {syncState.status === 'error' && <RefreshCw size={14} className="text-white shrink-0" />}
            <span className="truncate">{cloudSyncBadgeLabel(syncState)}</span>
          </button>
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[120] border-t border-slate-200 bg-white/95 backdrop-blur-sm pb-safe">
        <div className="flex justify-around items-stretch py-1 min-h-[56px]">
          {[
            { to: '/panel/dashboard', icon: <LayoutDashboard size={18} />, label: 'Home' },
            { to: '/panel/inventory', icon: <Package size={18} />, label: 'Stock' },
            { to: '/panel/flip-coach', icon: <Target size={18} />, label: 'Flip' },
            { to: '/panel/add', icon: <Plus size={18} />, label: 'Add' },
            { action: 'settings' as const, icon: <Settings size={18} />, label: 'Settings' },
          ].map((item) => {
              if ('action' in item && item.action === 'settings') {
                return (
                  <button
                    key="settings"
                    type="button"
                    onClick={() => openSettings()}
                    className="flex flex-col items-center justify-center flex-1 px-1 py-1.5 text-[11px] font-semibold transition-colors text-slate-400"
                  >
                    <span className="mb-0.5 inline-flex items-center justify-center rounded-full p-1.5 bg-slate-100 text-slate-500">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              }
              const { to, icon, label } = item as { to: string; icon: React.ReactNode; label: string };
              const isActive =
                to === '/panel/add'
                  ? addHubActive
                  : location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex flex-col items-center justify-center flex-1 px-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  <span
                    className={`mb-0.5 inline-flex items-center justify-center rounded-full p-1.5 ${
                      isActive ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {icon}
                  </span>
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
        </div>
      </nav>

      <GamificationEventLayer
        event={gamificationEvent}
        onDismiss={dismissGamificationEvent}
        onResolveDealClosed={resolveGamificationDealClosed}
      />
    </div>
  );
};

export default PanelLayout;
