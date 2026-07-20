import React, { Suspense } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Package, PlusCircle, Settings, RefreshCw, Trash2, CloudUpload, LayoutDashboard,
  Layers, Loader2, Cloud, CheckCircle2, X, Receipt, History, Globe,
  Printer, LayoutTemplate, PackageSearch, Monitor, Boxes, ChevronDown, Plus, Images,
} from 'lucide-react';
import PanelBreadcrumbs from './PanelBreadcrumbs';
import { usePanelLocale } from '../context/PanelLocaleContext';
import { usePanelKeyboardShortcuts } from '../hooks/usePanelKeyboardShortcuts';
import { signInWithGoogle, logOut, completeGoogleRedirectSignIn, getAuthErrorMessage } from '../services/firebaseService';
import QuotaMonitor from './QuotaMonitor';
import GlobalSearch from './GlobalSearch';
import EbaySoldReminderWidget from './EbaySoldReminderWidget';
import OnboardingWizard, { isOnboardingComplete } from './OnboardingWizard';
import { useEbayListingReminder } from '../hooks/useEbayListingReminder';
import { InventoryItem, Expense, BusinessSettings } from '../types';

interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
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
}

const PanelLayout: React.FC<PanelLayoutProps> = ({ isCloudEnabled, authUser, authReady = false, isAdmin = false, syncState = { status: 'idle', lastSynced: null }, onForcePush, backupBannerDismissed = true, onDismissBackupBanner, items = [], expenses = [], businessSettings = { companyName: '', ownerName: '', address: '', taxMode: 'SmallBusiness' }, onUpdateItems }) => {
  const location = useLocation();
  const { locale, setLocale } = usePanelLocale();
  usePanelKeyboardShortcuts();
  const [signingIn, setSigningIn] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(() => !isOnboardingComplete());
  const [addMenuOpen, setAddMenuOpen] = React.useState(true);
  const [moreNavOpen, setMoreNavOpen] = React.useState(false);
  const { reminder: ebayReminder, dismiss: dismissEbayReminder, checksRemaining } = useEbayListingReminder();

  React.useEffect(() => {
    void completeGoogleRedirectSignIn().catch(() => {});
  }, []);
  /** Inventory/trash use internal scroll + docked bulk bar; eBay tools use full-width workspace layout. */
  const isDockedPanelPage =
    /^\/panel\/(inventory|trash|ebay-store-pull)(\/|$)/.test(location.pathname);

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
                  window.location.reload();
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
              try {
                await signInWithGoogle();
              } catch (e) {
                console.error(e);
                alert(getAuthErrorMessage(e));
              } finally {
                setSigningIn(false);
              }
            }}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {signingIn ? <Loader2 size={18} className="animate-spin" /> : null}
            Sign in with Google
          </button>
          <a href="/" className="block mt-4 text-sm text-slate-500 hover:text-slate-700">← Back to store</a>
        </div>
      </div>
    );
  }

  const primaryNav = [
    { to: '/panel/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
    { to: '/panel/inventory', icon: <Package size={18} />, label: 'Inventory' },
    { to: '/panel/ebay-store-pull', icon: <PackageSearch size={18} />, label: 'eBay Tools', alert: !!ebayReminder },
    {
      to: '/panel/ebay-store-pull?tab=bundles',
      icon: <Boxes size={18} />,
      label: 'Parse Bundles',
    },
    { to: '/panel/card-gallery', icon: <Images size={18} />, label: 'Card gallery' },
    { to: '/panel/settings', icon: <Settings size={18} />, label: 'Settings', alert: !isCloudEnabled },
  ];

  const moreNav = [
    { to: '/panel/add-bulk', icon: <Layers size={16} />, label: 'Bulk Entry' },
    { to: '/panel/bulk-imports', icon: <PackageSearch size={16} />, label: 'Bulk imports' },
    { to: '/panel/3d-print', icon: <Printer size={16} />, label: '3D Print' },
    { to: '/panel/invoices', icon: <Receipt size={16} />, label: 'Invoices' },
    { to: '/panel/action-history', icon: <History size={16} />, label: 'Action history' },
    { to: '/panel/expenses', icon: <RefreshCw size={16} />, label: 'Expenses' },
    { to: '/panel/import', icon: <CloudUpload size={16} />, label: 'Import CSV' },
    { to: '/panel/trash', icon: <Trash2 size={16} />, label: 'Trash' },
    { to: '/panel/store-management', icon: <Globe size={16} />, label: 'Store' },
    { to: '/panel/storefront-configurator', icon: <LayoutTemplate size={16} />, label: 'Storefront config' },
  ];

  const addOptions = [
    { to: '/panel/add', icon: <PlusCircle size={16} />, label: 'Single item', hint: 'One product' },
    { to: '/panel/builder?mode=pc', icon: <Monitor size={16} />, label: 'PC Build', hint: 'Slots · no defekt' },
    { to: '/panel/builder?mode=bundle', icon: <Package size={16} />, label: 'Bundle', hint: 'PC Bundle / Aufrustkit' },
    { to: '/panel/builder?mode=mixed', icon: <Boxes size={16} />, label: 'Mixed Bundle', hint: 'Any parts · defekt OK' },
  ];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {/* DESKTOP SIDEBAR */}
      <aside className="w-[17.5rem] bg-slate-950 text-white flex flex-col hidden md:flex border-r border-white/5">
        <div className="p-5 space-y-3">
          <Link to="/panel/dashboard" className="text-lg font-display font-black tracking-tight flex items-center gap-2 text-white">
            <span className="w-8 h-8 rounded-lg bg-brand-500/20 text-brand-300 flex items-center justify-center">
              <Package size={18} />
            </span>
            DeInventory
          </Link>
          <GlobalSearch items={items} expenses={expenses} businessSettings={businessSettings} />
        </div>

        {/* ADD MENU — primary create actions */}
        <div className="px-4 mb-3">
          <button
            type="button"
            onClick={() => setAddMenuOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-black text-xs uppercase tracking-widest transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={16} /> Add item
            </span>
            <ChevronDown size={14} className={`transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {addMenuOpen && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 space-y-0.5">
              {addOptions.map((opt) => {
                const active =
                  location.pathname + (location.search || '') === opt.to ||
                  (opt.to.includes('mode=') && location.pathname === '/panel/builder' && location.search.includes(opt.to.split('?')[1] || ''));
                return (
                  <Link
                    key={opt.to}
                    to={opt.to}
                    className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition-colors ${
                      active ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className={`mt-0.5 ${active ? 'text-brand-600' : 'text-brand-300'}`}>{opt.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold leading-tight">{opt.label}</span>
                      <span className={`block text-[10px] font-semibold ${active ? 'text-slate-500' : 'text-slate-500'}`}>
                        {opt.hint}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto scrollbar-hide pb-4">
          <p className="px-3 pt-1 pb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Navigate</p>
          {primaryNav.map(({ to, icon, label, alert }) => {
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
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold text-sm transition-all relative ${
                  isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {icon} {label}
                {alert && <span className="absolute right-3 top-3 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreNavOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 text-xs font-black uppercase tracking-widest mt-2"
          >
            More
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
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                    }`}
                  >
                    {icon} {label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
        <div className="p-4 border-t border-white/5">
          {ebayReminder && (
            <EbaySoldReminderWidget
              reminder={ebayReminder}
              onDismiss={dismissEbayReminder}
              variant="sidebar"
            />
          )}
          <QuotaMonitor />
        </div>
      </aside>
      {/* MAIN AREA */}
      <main
        className={`flex-1 flex flex-col min-h-0 overflow-hidden relative ${
          isDockedPanelPage
            ? 'p-1.5 md:p-2 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-2'
            : 'p-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:p-8 lg:p-8 xl:p-10 2xl:p-12 md:pb-8'
        }`}
      >
        {ebayReminder && (
          <div className="md:hidden">
            <EbaySoldReminderWidget
              reminder={ebayReminder}
              onDismiss={dismissEbayReminder}
              variant="float"
              checksRemaining={checksRemaining}
            />
          </div>
        )}
        {/* Mobile global search (sidebar search hidden on mobile) */}
        <div className="md:hidden mb-4">
          <GlobalSearch items={items} expenses={expenses} businessSettings={businessSettings} />
        </div>
        {isCloudEnabled && authUser && syncState.status !== 'idle' && (
          <div className="fixed bottom-4 left-4 z-[100]">
            <button
              type="button"
              onClick={() => syncState.status === 'error' && onForcePush?.()}
              disabled={syncState.status === 'syncing'}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border shadow-lg transition-all ${
                syncState.status === 'syncing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                syncState.status === 'error' ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 cursor-pointer' :
                'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
              title={syncState.status === 'error' && syncState.message ? syncState.message : (syncState.lastSynced ? `Last saved ${syncState.lastSynced.toLocaleTimeString()}` : undefined)}
            >
              {syncState.status === 'syncing' && <Loader2 size={12} className="animate-spin shrink-0" />}
              {syncState.status === 'success' && <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />}
              {syncState.status === 'error' && <RefreshCw size={12} className="shrink-0" />}
              <span>
                {syncState.status === 'syncing' ? (syncState.message || 'Saving…') :
                 syncState.status === 'success' ? (syncState.lastSynced ? `Saved ${syncState.lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live') :
                 (syncState.message || 'Sync failed — click to retry')}
              </span>
            </button>
          </div>
        )}
        {!isCloudEnabled && !backupBannerDismissed && onDismissBackupBanner && (
          <div className="mb-6 flex items-start gap-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
            <Cloud className="shrink-0 mt-0.5 text-amber-600" size={20}/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Set up Cloud Backup so your inventory is stored on the web.</p>
              <Link to="/panel/settings" className="inline-block mt-2 text-xs font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 underline">Settings → Cloud Sync</Link>
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
            <PanelBreadcrumbs />
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px] font-black uppercase">
              <button type="button" onClick={() => setLocale('en')} className={`px-2 py-1 rounded ${locale === 'en' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>EN</button>
              <button type="button" onClick={() => setLocale('de')} className={`px-2 py-1 rounded ${locale === 'de' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>DE</button>
            </div>
          </div>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-[300px] flex-1">
              <Loader2 size={32} className="animate-spin text-slate-400" />
            </div>
          }>
            <Outlet />
          </Suspense>
        </div>
        {syncState.status !== 'idle' && (
          <button
            onClick={() => onForcePush?.()}
            disabled={syncState.status === 'syncing'}
            className={`md:hidden fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-4 z-[110] px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-black uppercase tracking-widest border ${
              syncState.status === 'error' ? 'bg-red-600 text-white border-red-500' :
              syncState.status === 'success' ? 'bg-emerald-600 text-white border-emerald-500' :
              'bg-slate-900 text-white border-slate-800'
            }`}
          >
            {syncState.status === 'syncing' && <Loader2 size={14} className="animate-spin text-blue-400"/>}
            {syncState.status === 'success' && <CloudUpload size={14} className="text-emerald-300"/>}
            {syncState.status === 'error' && <RefreshCw size={14} className="text-white"/>}
            <span>{syncState.status === 'syncing' ? (syncState.message || 'Syncing...') : syncState.status === 'success' ? 'Saved' : (syncState.message || 'Retry')}</span>
          </button>
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[120] border-t border-slate-200 bg-white/95 backdrop-blur-sm pb-safe">
        <div className="flex justify-around items-stretch py-1 min-h-[56px]">
          {[
            { to: '/panel/dashboard', icon: <LayoutDashboard size={18} />, label: 'Home' },
            { to: '/panel/inventory', icon: <Package size={18} />, label: 'Stock' },
            { to: '/panel/add', icon: <Plus size={18} />, label: 'Add' },
            { to: '/panel/settings', icon: <Settings size={18} />, label: 'Settings' },
          ].map(({ to, icon, label }) => {
              const isActive = location.pathname === to || (to === '/panel/add' && location.pathname.startsWith('/panel/builder'));
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
    </div>
  );
};

export default PanelLayout;
