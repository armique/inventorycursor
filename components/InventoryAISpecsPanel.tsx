import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { InventoryItem } from '../types';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';

const BATCH_SIZE = 12;
const DELAY_BETWEEN_BATCHES_MS = 60_000;
const RETRY_AFTER_RATE_LIMIT_MS = 120_000;

interface Props {
  items: InventoryItem[];
  selectedIds: string[];
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
}

export const InventoryAISpecsPanel: React.FC<Props> = ({
  items,
  selectedIds,
  categoryFields,
  onUpdate,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [rateLimitWaiting, setRateLimitWaiting] = useState(false);
  const [waitSecondsLeft, setWaitSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = getSpecsAIProvider();
  const selectedItems = items.filter((i) => selectedIds.includes(i.id));
  const canParseCount = selectedItems.length;
  const selectedAllDefective = selectedItems.length > 0 && selectedItems.every((i) => i.isDefective);
  const defectiveLabel = selectedAllDefective ? 'Mark OK' : 'Mark defective';
  const toggleDefective = useCallback(() => {
    if (selectedItems.length === 0) return;
    const newValue = !selectedAllDefective;
    onUpdate(items.map((i) => (selectedIds.includes(i.id) ? { ...i, isDefective: newValue } : i)));
  }, [selectedItems.length, selectedAllDefective, items, selectedIds, onUpdate]);

  const waitWithCountdown = useCallback(async (totalMs: number) => {
    const totalSec = Math.ceil(totalMs / 1000);
    for (let s = totalSec; s > 0; s--) {
      setWaitSecondsLeft(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setWaitSecondsLeft(null);
  }, []);

  const mergeSpecsResult = useCallback(
    (item: InventoryItem, result: Awaited<ReturnType<typeof generateItemSpecs>>): InventoryItem => {
      const activeKey = `${item.category}:${item.subCategory}`;
      const definedFields = categoryFields[activeKey] || categoryFields[item.category || ''] || [];
      let newSpecs = { ...(item.specs || {}) };
      const returnedSpecs = result.specs || {};
      Object.entries(returnedSpecs).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        const keyToUse =
          definedFields.length > 0
            ? (definedFields.find((df) => df.toLowerCase() === k.toLowerCase()) || k)
            : k;
        newSpecs[keyToUse] = v;
      });
      const updates: Partial<InventoryItem> = {
        specs: newSpecs as Record<string, string | number>,
      };
      if (result.standardizedName) updates.name = result.standardizedName;
      if (result.vendor) updates.vendor = result.vendor;
      return { ...item, ...updates };
    },
    [categoryFields]
  );

  const runParse = useCallback(async () => {
    const toParse = selectedItems;
    if (toParse.length === 0) {
      setError('Select items in the table above, then click Parse specs.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setRateLimitWaiting(false);
    setWaitSecondsLeft(null);
    setProgress({ current: 0, total: toParse.length });

    const isRateLimitError = (e: unknown) => {
      const msg = (e as Error)?.message?.toLowerCase() ?? '';
      return /rate|limit|429|quota|too many|overloaded/i.test(msg);
    };

    let currentItems = [...items];

    for (let i = 0; i < toParse.length; i += BATCH_SIZE) {
      const batch = toParse.slice(i, i + BATCH_SIZE);
      let batchDone = false;
      let retryCount = 0;
      while (!batchDone) {
        try {
          const batchUpdates: InventoryItem[] = [];
          await Promise.all(
            batch.map(async (item) => {
              const latest = currentItems.find((it) => it.id === item.id) || item;
              try {
                const categoryContext = `${latest.category || 'Unknown'}${latest.subCategory ? ' / ' + latest.subCategory : ''}`;
                const activeKey = `${latest.category}:${latest.subCategory}`;
                const knownKeys = categoryFields[activeKey] || categoryFields[latest.category || ''] || [];
                const result = await generateItemSpecs(latest.name, categoryContext, knownKeys);
                const merged = mergeSpecsResult(latest, result);
                batchUpdates.push(merged);
              } catch (e) {
                if (isRateLimitError(e)) throw e;
                console.warn(`Parse specs failed for ${latest.name}:`, e);
              }
            })
          );
          const byId = new Map(batchUpdates.map((u) => [u.id, u]));
          currentItems = currentItems.map((it) => byId.get(it.id) || it);
          onUpdate(currentItems);
          setProgress((p) => ({ ...p, current: Math.min(i + BATCH_SIZE, toParse.length) }));
          setRateLimitWaiting(false);
          batchDone = true;
        } catch (e) {
          retryCount += 1;
          setRateLimitWaiting(true);
          setError(`Rate limit hit. Waiting 2 min then retry #${retryCount}…`);
          await waitWithCountdown(RETRY_AFTER_RATE_LIMIT_MS);
        }
      }
      if (i + BATCH_SIZE < toParse.length) {
        setRateLimitWaiting(true);
        setError('Pausing 1 min before next batch…');
        await waitWithCountdown(DELAY_BETWEEN_BATCHES_MS);
        setError(null);
        setRateLimitWaiting(false);
      }
    }

    setAnalyzing(false);
    setProgress({ current: 0, total: 0 });
    setRateLimitWaiting(false);
    setWaitSecondsLeft(null);
    setError(null);
  }, [selectedItems, items, categoryFields, onUpdate, mergeSpecsResult, waitWithCountdown]);

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <Sparkles size={18} className="text-amber-500" />
          Parse specs with AI
        </h2>
        {provider && (
          <span className="text-[10px] font-bold text-slate-500 uppercase">
            {provider}
          </span>
        )}
      </div>

      {!provider && (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
          <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-900 text-sm">No AI configured</p>
            <p className="text-xs text-amber-800 mt-0.5">
              Add <code className="bg-amber-100 px-1 rounded">VITE_GROQ_API_KEY</code> or another key to <code className="bg-amber-100 px-1 rounded">.env</code> (same as Category suggestions). Groq free tier is generous.
            </p>
          </div>
        </div>
      )}

      {provider && (
        <>
          <div className="mt-2 flex items-start gap-2 text-xs text-slate-600">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              Select items in the table, then run. One request per item; batches with 1 min pause to respect rate limits. Same API keys and fallback order as Category suggestions.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runParse}
              disabled={analyzing || canParseCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <Loader2 size={16} className={rateLimitWaiting ? '' : 'animate-spin'} />
                  {rateLimitWaiting && waitSecondsLeft != null
                    ? `Waiting ${Math.floor(waitSecondsLeft / 60)}:${String(waitSecondsLeft % 60).padStart(2, '0')}…`
                    : rateLimitWaiting
                      ? `Waiting… ${progress.current}/${progress.total}`
                      : `Parsing ${progress.current}/${progress.total}…`}
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Parse specs for {canParseCount} selected
                </>
              )}
            </button>
            {canParseCount === 0 && (
              <span className="text-xs text-slate-500">Select items above first</span>
            )}
            <button
              type="button"
              onClick={toggleDefective}
              disabled={canParseCount === 0}
              title={selectedAllDefective ? 'Clear defective flag (item is OK)' : 'Mark selected as defective (excluded from PC/bundle builds)'}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${selectedAllDefective ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-red-100 text-red-800 hover:bg-red-200'}`}
            >
              <AlertTriangle size={16} />
              {defectiveLabel}
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <div>
            <p className="font-bold">{error}</p>
            {waitSecondsLeft != null && (
              <p className="mt-0.5 font-mono text-xs text-amber-700">
                Time remaining: {Math.floor(waitSecondsLeft / 60)}:{String(waitSecondsLeft % 60).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryAISpecsPanel;
