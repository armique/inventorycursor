import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Database, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import type { InventoryItem } from '../types';
import { collectFirestoreFreeQuotaSnapshot } from '../services/firestoreQuotaService';
import {
  formatBytes,
  formatOps,
  type FirestoreFreeQuotaSnapshot,
  type QuotaMeter,
} from '../utils/firestoreFreeQuota';

const COLLAPSED_KEY = 'firestore_quota_widget_expanded_v1';

function MeterBar({ meter, tone }: { meter: QuotaMeter; tone: 'emerald' | 'sky' | 'amber' }) {
  const fill =
    meter.pctUsed > 90
      ? 'bg-red-500'
      : meter.pctUsed > 70
        ? 'bg-amber-500'
        : tone === 'sky'
          ? 'bg-sky-500'
          : tone === 'amber'
            ? 'bg-amber-500'
            : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
      <div className={`h-full transition-all ${fill}`} style={{ width: `${Math.min(100, meter.pctUsed)}%` }} />
    </div>
  );
}

function friendlyMonitoringHint(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes('google_service_account') || t.includes('monitoring viewer') || t.includes('not configured')) {
    return 'Live daily reads/writes need Monitoring setup on the server. Storage & doc size still work.';
  }
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

type Props = {
  items?: InventoryItem[];
  /** Slightly narrower panel when inventory list needs the corner. */
  compact?: boolean;
};

const FirestoreQuotaWidget: React.FC<Props> = ({ items = [], compact }) => {
  const [snap, setSnap] = useState<FirestoreFreeQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const setExpandedPersist = (next: boolean) => {
    setExpanded(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const next = await collectFirestoreFreeQuotaSnapshot({
          force,
          includeStorage: true,
          includeMonitoring: true,
          items,
        });
        setSnap(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load quota');
      } finally {
        setLoading(false);
      }
    },
    [items]
  );

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!snap && loading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-white/95 border border-slate-200 shadow-lg px-3 py-2 text-xs font-bold text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Quota…
      </div>
    );
  }

  if (!snap) return null;

  const fs = snap.firestore.stored;
  const st = snap.storage.stored;
  const monitoringHint = friendlyMonitoringHint(snap.monitoring?.error);

  // Collapsed chip — does not cover Flip Coach / page content
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpandedPersist(true)}
        className="inline-flex items-center gap-2 rounded-full bg-white/95 border border-slate-200 shadow-lg px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 max-w-[14rem]"
        title="Show Spark free-tier usage"
      >
        <Database size={13} className="text-emerald-600 shrink-0" />
        <span className="truncate">
          Docs {Math.round(fs.pctFree)}% · Photos {Math.round(st.pctFree)}%
        </span>
        <ChevronUp size={13} className="text-slate-400 shrink-0" />
      </button>
    );
  }

  return (
    <div
      className={`rounded-xl bg-white/95 border border-slate-200 shadow-lg max-h-[min(70vh,28rem)] overflow-y-auto ${
        compact ? 'w-[15rem] p-3' : 'w-[17rem] p-3.5'
      }`}
      title="Free-tier usage — photos are Firebase Storage (5 GB), not the 1 GiB Firestore docs quota"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => setExpandedPersist(false)}
          className="min-w-0 text-left group"
          title="Collapse"
        >
          <p className="text-xs font-black uppercase tracking-widest text-slate-800 inline-flex items-center gap-1">
            Spark free tier
            <ChevronDown size={13} className="text-slate-400 group-hover:text-slate-600" />
          </p>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate" title={snap.projectId}>
            {snap.projectId}
          </p>
        </button>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between items-center text-xs font-bold text-slate-700 mb-1 gap-2">
            <span className="inline-flex items-center gap-1.5">
              <HardDrive size={13} className="text-sky-600 shrink-0" />
              Storage photos
            </span>
            <span className="font-mono text-slate-500 text-[11px] shrink-0">
              {formatBytes(st.remaining)} left
            </span>
          </div>
          <MeterBar meter={st} tone="sky" />
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {formatBytes(st.used)} / {formatBytes(st.limit)}
            {snap.storage.files != null ? ` · ${snap.storage.files} files` : ''}
            {' · '}
            {Math.round(st.pctFree)}% free
          </p>
          {snap.storage.note && (
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{snap.storage.note}</p>
          )}
        </div>

        <div>
          <div className="flex justify-between items-center text-xs font-bold text-slate-700 mb-1 gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Database size={13} className="text-emerald-600 shrink-0" />
              Firestore docs
            </span>
            <span className="font-mono text-slate-500 text-[11px] shrink-0">
              {formatBytes(fs.remaining)} left
            </span>
          </div>
          <MeterBar meter={fs} tone="emerald" />
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {formatBytes(fs.used)} / {formatBytes(fs.limit)}
            {snap.firestore.syncDocs != null ? ` · ${snap.firestore.syncDocs} docs` : ''}
            {' · '}
            {Math.round(fs.pctFree)}% free
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            Inventory JSON only — images are not in this 1 GiB quota.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-100">
          {(
            [
              ['Reads', snap.firestore.readsToday],
              ['Writes', snap.firestore.writesToday],
              ['Deletes', snap.firestore.deletesToday],
            ] as const
          ).map(([label, meter]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-1.5 py-1.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
              <p className="text-xs font-bold text-slate-700 font-mono mt-0.5">
                {formatOps(meter.used)}
                <span className="text-slate-400">/{formatOps(meter.limit)}</span>
              </p>
            </div>
          ))}
        </div>

        {monitoringHint && !snap.monitoring?.available && (
          <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 leading-snug">
            {monitoringHint}
          </p>
        )}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
};

export default FirestoreQuotaWidget;
