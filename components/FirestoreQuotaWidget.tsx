import React, { useCallback, useEffect, useState } from 'react';
import { Database, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import {
  collectFirestoreFreeQuotaSnapshot,
} from '../services/firestoreQuotaService';
import {
  formatBytes,
  formatOps,
  type FirestoreFreeQuotaSnapshot,
  type QuotaMeter,
} from '../utils/firestoreFreeQuota';

function MeterBar({ meter, tone }: { meter: QuotaMeter; tone: 'emerald' | 'sky' | 'amber' }) {
  const fill =
    meter.pctUsed > 90 ? 'bg-red-500' : meter.pctUsed > 70 ? 'bg-amber-500' : tone === 'sky' ? 'bg-sky-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1 w-full rounded-full bg-slate-200 overflow-hidden">
      <div className={`h-full transition-all ${fill}`} style={{ width: `${Math.min(100, meter.pctUsed)}%` }} />
    </div>
  );
}

const FirestoreQuotaWidget: React.FC = () => {
  const [snap, setSnap] = useState<FirestoreFreeQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await collectFirestoreFreeQuotaSnapshot({ force, includeStorage: true, includeMonitoring: true });
      setSnap(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load quota');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!snap && loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/95 border border-slate-200 shadow-lg text-[10px] font-bold text-slate-500">
        <Loader2 size={12} className="animate-spin" /> Quota…
      </div>
    );
  }

  if (!snap) return null;

  const fs = snap.firestore.stored;
  const st = snap.storage.stored;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-[min(18rem,calc(100vw-2rem))] text-left rounded-xl bg-white/95 border border-slate-200 shadow-lg px-3 py-2 hover:border-slate-300 transition-colors"
        title="Firestore & Storage free-tier usage"
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 inline-flex items-center gap-1">
            <Database size={11} className="text-sky-600" />
            Free quota
          </span>
          <span className="text-[9px] font-mono text-slate-400">
            {loading ? <Loader2 size={10} className="animate-spin inline" /> : `${Math.round(fs.pctFree)}% free`}
          </span>
        </div>
        <MeterBar meter={fs} tone="emerald" />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-600">
          <span className="truncate">
            FS {formatBytes(fs.used)} / {formatBytes(fs.limit)}
          </span>
          <span className="shrink-0 text-slate-400 font-mono">
            R {formatOps(snap.firestore.readsToday.used)}/{formatOps(snap.firestore.readsToday.limit)}
          </span>
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-[120]">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-800">Spark free tier</p>
              <p className="text-[9px] text-slate-400 font-medium mt-0.5 truncate" title={snap.projectId}>
                {snap.projectId} · {snap.source}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh(true)}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
                <span className="inline-flex items-center gap-1">
                  <Database size={11} /> Firestore storage
                </span>
                <span className="font-mono text-slate-500">
                  {formatBytes(fs.remaining)} left
                </span>
              </div>
              <MeterBar meter={fs} tone="emerald" />
              <p className="text-[9px] text-slate-400 mt-1 font-medium">
                {formatBytes(fs.used)} used of {formatBytes(fs.limit)}
                {snap.firestore.syncDocs != null ? ` · ${snap.firestore.syncDocs} docs` : ''}
              </p>
              {snap.firestore.note && (
                <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">{snap.firestore.note}</p>
              )}
            </div>

            <div>
              <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
                <span className="inline-flex items-center gap-1">
                  <HardDrive size={11} /> Storage files
                </span>
                <span className="font-mono text-slate-500">
                  {formatBytes(st.remaining)} left
                </span>
              </div>
              <MeterBar meter={st} tone="sky" />
              <p className="text-[9px] text-slate-400 mt-1 font-medium">
                {formatBytes(st.used)} used of {formatBytes(st.limit)}
                {snap.storage.files != null ? ` · ${snap.storage.files} files` : ''}
              </p>
              {snap.storage.note && (
                <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">{snap.storage.note}</p>
              )}
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
                  <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">{label}/day</p>
                  <p className="text-[10px] font-bold text-slate-700 font-mono mt-0.5">
                    {formatOps(meter.used)}
                    <span className="text-slate-400">/{formatOps(meter.limit)}</span>
                  </p>
                  <MeterBar meter={meter} tone="amber" />
                </div>
              ))}
            </div>

            {snap.monitoring?.error && !snap.monitoring.available && (
              <p className="text-[9px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 leading-snug">
                Live project ops: {snap.monitoring.error}
              </p>
            )}
            {error && (
              <p className="text-[9px] text-red-600">{error}</p>
            )}
            <p className="text-[8px] text-slate-400 font-medium">
              Daily ops reset ~midnight Pacific. Storage size is scanned from your folders; ops use Monitoring when configured, else local session counters.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FirestoreQuotaWidget;
