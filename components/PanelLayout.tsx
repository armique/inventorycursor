import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Package, PlusCircle, Settings, RefreshCw, Briefcase, Trash2, CloudUpload, LayoutDashboard, BarChart3, Sparkles,
  Tag, Layers, Store, Loader2, Cloud, CheckCircle2, X,
} from 'lucide-react';
import { signInWithGooglePopup } from '../services/firebaseService';
import QuotaMonitor from './QuotaMonitor';

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
}

const PanelLayout: React.FC<PanelLayoutProps> = ({ isCloudEnabled, authUser, authReady = false, isAdmin = false, syncState = { status: 'idle', lastSynced: null }, onForcePush, backupBannerDismissed = true, onDismissBackupBanner }) => {
  const location = useLocation();
  const [signingIn, setSigningIn] = React.useState(false);

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
                  // simple redirect to Google account chooser flow by clearing session
                  window.location.reload();
                } finally {
                  setSigningIn(false);
                }
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {signingIn ? 'Reloading…' : 'Switch account'}
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
                await signInWithGooglePopup();
              } catch (e) {
                console.error(e);
                alert('Sign-in failed.');
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

  const nav = [
    { to: '/panel/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/panel/analytics', icon: <BarChart3 size={20} />, label: 'Category analytics' },
    { to: '/panel/category-suggestions', icon: <Sparkles size={20} />, label: 'Category suggestions' },
    { to: '/panel/inventory', icon: <Package size={20} />, label: 'Inventory' },
    { to: '/panel/add', icon: <PlusCircle size={20} />, label: 'Add Item' },
    { to: '/panel/add-bulk', icon: <Layers size={20} />, label: 'Bulk Entry' },
    { to: '/panel/pricing', icon: <Tag size={20} />, label: 'Price Check' },
    { to: '/panel/builder', icon: <Briefcase size={20} />, label: 'PC Builder' },
    { to: '/panel/expenses', icon: <RefreshCw size={20} />, label: 'Expenses' },
    { to: '/panel/import', icon: <CloudUpload size={20} />, label: 'Import CSV' },
    { to: '/panel/trash', icon: <Trash2 size={20} />, label: 'Trash' },
    { to: '/panel/store-management', icon: <Store size={20} />, label: 'Store management' },
    { to: '/panel/settings', icon: <Settings size={20} />, label: 'Settings', alert: !isCloudEnabled },
  ];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <aside className="w-64 bg-slate-900 text-white flex flex-col hidden md:flex">
        <div className="p-6">
          <Link to="/panel/dashboard" className="text-xl font-black tracking-tighter flex items-center gap-2">
            <Package className="text-blue-500" /> DeInventory
          </Link>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto scrollbar-hide">
          {nav.map(({ to, icon, label, alert }) => {
            const isActive = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all relative ${isActive ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                {icon} {label}
                {alert && <span className="absolute right-3 top-3 w-2 h-2 bg-red-500 rounded-full animate-pulse border-2 border-slate-900" />}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <QuotaMonitor />
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-4 md:p-8 relative">
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
        <Outlet />
        {syncState.status !== 'idle' && (
          <button
            onClick={() => onForcePush?.()}
            disabled={syncState.status === 'syncing'}
            className={`md:hidden fixed bottom-20 right-6 z-[200] px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-black uppercase tracking-widest border ${
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
    </div>
  );
};

export default PanelLayout;
