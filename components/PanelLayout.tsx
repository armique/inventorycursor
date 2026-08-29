import React, { Suspense } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Package, Settings, RefreshCw, Trash2, CloudUpload, LayoutDashboard,
  Loader2, Cloud, CheckCircle2, X, Receipt, History, Globe, Layers,
  Printer, LayoutTemplate, ChevronDown, ChevronLeft, ChevronRight, Plus, Images,
  CircuitBoard, Radar, Coins, ShoppingBag, FileSpreadsheet, MoreHorizontal, Zap,
} from 'lucide-react';
import PanelBreadcrumbs from './PanelBreadcrumbs';
import { usePanelLocale } from '../context/PanelLocaleContext';
import { useSettingsModal } from '../context/SettingsModalContext';
import { usePanelKeyboardShortcuts } from '../hooks/usePanelKeyboardShortcuts';
import {
  signInWithGoogle,
  signInWithEmailOtp,
  signInWithDevAdmin,
  logOut,
  getAuthErrorMessage,
  prefersRedirectSignIn,
  prewarmGoogleSignIn,
  OWNER_ADMIN_EMAIL,
  isLocalOrDevEnvironment,
} from '../services/supabaseService';
import GlobalSearch from './GlobalSearch';
import { panelSuspenseFallback } from './RouteSkeletons';
import { InventoryItem, Expense, BusinessSettings } from '../types';
import { cloudSyncBadgeLabel, cloudSyncBadgeTitle } from '../utils/cloudSyncStatus';
import { useStaleDealCount } from '../hooks/useInboxAlerts';

interface SyncState {
  status: 'idle' | 'pending' | 'syncing' | 'success' | 'error';
  lastSynced: Date | null;
  message?: string;
}

interface PanelLayoutProps {
  isCloudEnabled: boolean;
  authUser: any;
  /** True once Supabase auth has completed initial check (so we don't flash login before session restore). */
  authReady?: boolean;
  /** Whether the current user is allowed to access the admin panel. */
  isAdmin?: boolean;
  syncState?: SyncState;
  onForcePush?: () => void;
  backupBannerDismissed?: boolean;
  onDismissBackupBanner?: () => void;
  tabDataStale?: boolean;
  items?: InventoryItem[];
  expenses?: Expense[];
  businessSettings?: BusinessSettings;
  onUpdateItems?: (items: InventoryItem[], deleteIds?: string[]) => void;
}

const PanelLayout: React.FC<PanelLayoutProps> = ({ isCloudEnabled, authUser, authReady = false, isAdmin = false, syncState = { status: 'idle', lastSynced: null }, onForcePush, backupBannerDismissed = true, onDismissBackupBanner, tabDataStale = false, items = [], expenses = [], businessSettings = { companyName: '', ownerName: '', address: '', phone: '', taxId: '', iban: '', bic: '', bankName: '', taxMode: 'SmallBusiness' }, onUpdateItems }) => {
  const location = useLocation();
  const { locale, setLocale } = usePanelLocale();
  const { openSettings } = useSettingsModal();
  usePanelKeyboardShortcuts();
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const [authTab, setAuthTab] = React.useState<'google' | 'email' | 'dev'>('google');
  const [emailInput, setEmailInput] = React.useState(OWNER_ADMIN_EMAIL);
  const [emailOtpSent, setEmailOtpSent] = React.useState(false);
  const [moreNavOpen, setMoreNavOpen] = React.useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false);
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

  // eBay order sync now runs from the Abrechnung page itself (where new orders are
  // reviewed and linked), not as a global banner on every page — see
  // components/EbayAbrechnungPage.tsx.

  /** Inventory/trash use internal scroll + docked bulk bar; EST / bulk entry use full-width workspace layout. */
  const isDockedPanelPage =
    /^\/panel\/(inventory|trash|ebay-abrechnung|est|dealwatch|add-bulk|3d-print)(\/|$)/.test(location.pathname);
  /** Stock list: no breadcrumb / locale / settings strip — ACTIVE|SOLD|INBOX is the first row. */
  const hidePanelChrome = location.pathname.startsWith('/panel/inventory');

  const isLocalDev = isLocalOrDevEnvironment();
  const requireAuth = !authUser;

  // Same fix as SettingsPage's sign-in button: warm the Google Identity Services script
  // ahead of the tap so mobile Safari doesn't silently block the popup.
  React.useEffect(() => {
    if (requireAuth) prewarmGoogleSignIn();
  }, [requireAuth]);

  if (authReady && authUser && !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 font-black text-xl">
            ✕
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600 text-sm mb-4">This admin panel is strictly reserved for the owner ({OWNER_ADMIN_EMAIL}).</p>
          <p className="text-xs text-slate-400 mb-6 break-all">Signed in as: {authUser.email}</p>
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
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-6 sm:p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-4 font-black text-xl shadow-md">
            D
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">DeInventory Admin</h2>
          <p className="text-slate-500 text-xs sm:text-sm mb-6">Owner access only ({OWNER_ADMIN_EMAIL}).</p>

          <div className="flex p-1 bg-slate-100 rounded-xl mb-5 text-xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => { setAuthTab('google'); setSignInError(null); }}
              className={`flex-1 py-1.5 rounded-lg transition-colors ${authTab === 'google' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'}`}
            >
              Google
            </button>
            <button
              type="button"
              onClick={() => { setAuthTab('email'); setSignInError(null); }}
              className={`flex-1 py-1.5 rounded-lg transition-colors ${authTab === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'}`}
            >
              Email OTP
            </button>
            {isLocalDev && (
              <button
                type="button"
                onClick={() => { setAuthTab('dev'); setSignInError(null); }}
                className={`flex-1 py-1.5 rounded-lg transition-colors ${authTab === 'dev' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'}`}
              >
                Local Dev
              </button>
            )}
          </div>

          {authTab === 'google' && (
            <div>
              <button
                type="button"
                disabled={signingIn}
                onClick={async () => {
                  setSigningIn(true);
                  setSignInError(null);
                  try {
                    const res = await signInWithGoogle({
                      returnPath: `${window.location.pathname}${window.location.search}`,
                    });
                    if (res?.error) setSignInError(getAuthErrorMessage(res.error));
                  } catch (e) {
                    console.error(e);
                    setSignInError(getAuthErrorMessage(e));
                  } finally {
                    setSigningIn(false);
                  }
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99]"
              >
                {signingIn ? <Loader2 size={18} className="animate-spin" /> : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                )}
                {signingIn ? 'Connecting to Google…' : 'Sign in with Google'}
              </button>
              {mobileRedirectSignIn && (
                <p className="text-xs text-slate-500 mt-3">
                  A Google account window will open. After you approve, your inventory syncs securely.
                </p>
              )}
            </div>
          )}

          {authTab === 'email' && (
            <div className="space-y-3 text-left">
              {emailOtpSent ? (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-center">
                  <p className="font-bold text-sm mb-1">Check your email!</p>
                  <p className="text-xs text-emerald-700">A magic sign-in link was sent to <strong className="break-all">{emailInput}</strong>. Click the link to access your dashboard.</p>
                  <button
                    type="button"
                    onClick={() => setEmailOtpSent(false)}
                    className="mt-3 text-xs font-bold text-emerald-900 underline"
                  >
                    Use different email or resend
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!emailInput) return;
                    setSigningIn(true);
                    setSignInError(null);
                    try {
                      const res = await signInWithEmailOtp(emailInput);
                      if (res?.error) {
                        setSignInError(getAuthErrorMessage(res.error));
                      } else {
                        setEmailOtpSent(true);
                      }
                    } catch (err) {
                      setSignInError(getAuthErrorMessage(err));
                    } finally {
                      setSigningIn(false);
                    }
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Email address</label>
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="owner@example.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={signingIn || !emailInput}
                    className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm"
                  >
                    {signingIn ? <Loader2 size={18} className="animate-spin" /> : null}
                    {signingIn ? 'Sending magic link…' : 'Send Magic Sign-in Link'}
                  </button>
                </form>
              )}
            </div>
          )}

          {authTab === 'dev' && (
            <div className="space-y-3 text-left">
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs text-slate-600 space-y-1">
                <p className="font-bold text-slate-900">Direct Owner / Dev Session</p>
                <p>Instantly authorizes this browser session as <strong className="text-slate-900">{OWNER_ADMIN_EMAIL}</strong> for debugging, local testing, and agent verification without external popups.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  signInWithDevAdmin(OWNER_ADMIN_EMAIL);
                }}
                className="w-full py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Zap size={16} /> Enter Dashboard as Owner
              </button>
            </div>
          )}

          {signInError && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-left text-xs font-semibold leading-relaxed text-red-700"
            >
              {signInError}
            </p>
          )}

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <a href="/" className="hover:text-slate-800 font-medium">← Back to store</a>
            <span className="text-[11px] text-slate-400">DeInventory Pro</span>
          </div>
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
    { to: '/panel/sell-today', icon: <ShoppingBag size={18} />, label: 'Sell today' },
    { to: '/panel/ebay-abrechnung', icon: <FileSpreadsheet size={18} />, label: 'eBay Abrechnung' },
    { to: '/panel/3d-print', icon: <Printer size={18} />, label: '3D Print' },
    { to: '/panel/dealwatch', icon: <Radar size={18} />, label: 'Dealwatch' },
    { to: '/panel/reinvest', icon: <Coins size={18} />, label: 'Reinvest' },
    { to: '/panel/combo-lab', icon: <CircuitBoard size={18} />, label: 'Combo Lab' },
    { to: '/panel/bulk-imports', icon: <History size={18} />, label: 'Bulk imports' },
    { to: '/panel/card-gallery', icon: <Images size={18} />, label: 'Card gallery' },
    { action: 'settings', icon: <Settings size={18} />, label: 'Settings', alert: !isCloudEnabled },
  ];

  const moreNav = [
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
    location.pathname === '/panel/import';

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
            const { to, icon, label, alert, count, warnCount, countTitle } = item as {
              to: string;
              icon: React.ReactNode;
              label: string;
              alert?: boolean;
              count?: number;
              warnCount?: number;
              countTitle?: string;
            };
            const [navPath, navQuery] = to.split('?');
            const isActive = navQuery
              ? location.pathname === navPath && location.search.includes(navQuery)
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
                    title={countTitle || `${count} AI change${count === 1 ? '' : 's'} awaiting review`}
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
          !location.pathname.startsWith('/panel/dealwatch') &&
          !location.pathname.startsWith('/panel/3d-print') &&
          !location.pathname.startsWith('/panel/ebay-abrechnung') && (
          <div className="md:hidden mb-4">
            <GlobalSearch items={items} expenses={expenses} businessSettings={businessSettings} />
          </div>
        )}
        {tabDataStale && (
          <div className="mb-6 flex items-start gap-4 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900">
            <RefreshCw className="shrink-0 mt-0.5 text-red-600" size={20}/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Newer data was saved in another tab or window.</p>
              <p className="text-xs mt-1">This tab has stopped saving to avoid overwriting it. Reload this tab to pick up the latest data before making more changes here.</p>
              <button type="button" onClick={() => window.location.reload()} className="inline-block mt-2 text-xs font-black uppercase tracking-widest text-red-700 hover:text-red-900 underline">Reload now</button>
            </div>
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
          {!hidePanelChrome && (
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
          )}
          <div
            className={
              isDockedPanelPage
                ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
                : 'flex flex-col min-w-0'
            }
          >
            <Suspense fallback={panelSuspenseFallback(location.pathname)}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </main>

      {/* MOBILE BOTTOM NAVIGATION — iPhone 13 Pro Max & Mobile Screens */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[120] border-t border-slate-800 bg-slate-950/95 backdrop-blur-xl pb-safe shadow-2xl">
        <div className="flex justify-around items-center py-1.5 px-2 min-h-[58px]">
          {[
            { to: '/panel/dashboard', icon: <LayoutDashboard size={20} />, label: 'Home' },
            { to: '/panel/inventory', icon: <Package size={20} />, label: 'Stock' },
            { to: '/panel/add', isPrimary: true, icon: <Plus size={22} />, label: 'Add' },
            { to: '/panel/ebay-abrechnung', icon: <Zap size={20} />, label: 'eBay' },
            { action: 'more' as const, icon: <MoreHorizontal size={20} />, label: 'More' },
          ].map((item) => {
            if ('action' in item && item.action === 'more') {
              return (
                <button
                  key="more"
                  type="button"
                  onClick={() => setMobileMoreOpen(true)}
                  className="flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold text-slate-400 active:scale-95 transition-all"
                >
                  <span className="mb-0.5 inline-flex items-center justify-center p-1 text-slate-400">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            }

            const { to, icon, label, isPrimary } = item as {
              to: string;
              icon: React.ReactNode;
              label: string;
              isPrimary?: boolean;
            };
            const isActive = to === '/panel/add' ? addHubActive : location.pathname === to;

            if (isPrimary) {
              return (
                <Link
                  key={to}
                  to={to}
                  className="flex flex-col items-center justify-center -mt-4 active:scale-90 transition-all"
                >
                  <span className="w-12 h-12 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/40 border-2 border-slate-950 font-black">
                    {icon}
                  </span>
                  <span className="text-[10px] font-black text-emerald-400 mt-0.5">{label}</span>
                </Link>
              );
            }

            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold active:scale-95 transition-all ${
                  isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`mb-0.5 inline-flex items-center justify-center p-1 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {icon}
                </span>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* MOBILE "MORE" SHEET — everything not pinned to the bottom bar */}
      {mobileMoreOpen && (
        <div className="md:hidden fixed inset-0 z-[130] flex items-end" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileMoreOpen(false)}
          />
          <div className="relative w-full max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white pb-safe">
            <div className="sticky top-0 bg-white flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-100">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">More</p>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-2">
              {[...primaryNav.filter((item) => 'to' in item && item.to !== '/panel/dashboard' && item.to !== '/panel/inventory'), ...moreNav].map(
                (item) => {
                  if ('action' in item && item.action === 'settings') {
                    return (
                      <button
                        key="settings"
                        type="button"
                        onClick={() => {
                          setMobileMoreOpen(false);
                          openSettings();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50"
                      >
                        {item.icon} {item.label}
                        {item.alert && <span className="ml-auto w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                      </button>
                    );
                  }
                  const { to, icon, label } = item as { to: string; icon: React.ReactNode; label: string };
                  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMobileMoreOpen(false)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold ${
                        isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {icon} {label}
                    </Link>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(PanelLayout);
