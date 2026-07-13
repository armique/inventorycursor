import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Loader2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { InventoryItem } from '../types';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';
import { mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';

const BATCH_SIZE = 12;
const DELAY_BETWEEN_BATCHES_MS = 60_000;
const RETRY_AFTER_RATE_LIMIT_MS = 120_000;

interface Props {
  items: InventoryItem[];
  selectedIds: string[];
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  open: boolean;
  onClose: () => void;
}

const EMPTY_ITEMS: InventoryItem[] = [];

const InventoryAISpecsPanelInner: React.FC<Props> = ({
  items,
  selectedIds,
  categoryFields,
  onUpdate,
  open,
  onClose,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [rateLimitWaiting, setRateLimitWaiting] = useState(false);
  const [waitSecondsLeft, setWaitSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = getSpecsAIProvider();
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedItems = useMemo(() => {
    if (selectedIds.length === 0) return EMPTY_ITEMS;
    const out: InventoryItem[] = [];
    for (const id of selectedIds) {
      const item = itemsById.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [selectedIds, itemsById]);
  const canParseCount = selectedItems.length;
  const selectedAllDefective = selectedItems.length > 0 && selectedItems.every((i) => i.isDefective);
  const defectiveLabel = selectedAllDefective ? 'Mark OK' : 'Mark defective';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !analyzing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, analyzing, onClose]);

  const toggleDefective = useCallback(() => {
    if (selectedItems.length === 0) return;
    const newValue = !selectedAllDefective;
    onUpdate(selectedItems.map((i) => ({ ...i, isDefective: newValue })));
  }, [selectedItems, selectedAllDefective, onUpdate]);

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
      const newSpecs = mergeAiSpecsIntoEssential(
        item.specs,
        result.specs,
        item.category || '',
        item.subCategory,
        categoryFields
      );
      const updates: Partial<InventoryItem> = {
        specs: newSpecs,
        specsAiSuggested: Object.keys(newSpecs).length ? { ...newSpecs } : undefined,
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
      setError('Select items in the table, then click Parse specs.');
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
                const knownKeys = resolveEssentialSpecKeys(
                  latest.category || '',
                  latest.subCategory,
                  categoryFields
                );
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
        } catch {
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

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={() => !analyzing && onClose()}
    >
      <div
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/80">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={16} className="text-amber-500 shrink-0" />
            <h2 className="text-sm font-black text-slate-900 truncate">Parse specs with AI</h2>
            {provider && (
              <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">{provider}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={analyzing}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[min(70vh,420px)] overflow-y-auto">
          {!provider && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <p className="font-bold">No AI configured</p>
                <p className="mt-0.5 text-amber-800">
                  Add <code className="bg-amber-100 px-1 rounded">VITE_GROQ_API_KEY</code> to{' '}
                  <code className="bg-amber-100 px-1 rounded">.env</code>.
                </p>
              </div>
            </div>
          )}

          {provider && (
            <>
              <div className="flex items-start gap-2 text-[11px] text-slate-600">
                <Info size={13} className="shrink-0 mt-0.5" />
                <p>Select rows in the table, then run. Batches pause 1 min between groups for rate limits.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={runParse}
                  disabled={analyzing || canParseCount === 0}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-50"
                >
                  {analyzing ? (
                    <>
                      <Loader2 size={14} className={rateLimitWaiting ? '' : 'animate-spin'} />
                      {rateLimitWaiting && waitSecondsLeft != null
                        ? `Wait ${Math.floor(waitSecondsLeft / 60)}:${String(waitSecondsLeft % 60).padStart(2, '0')}`
                        : rateLimitWaiting
                          ? `Waiting… ${progress.current}/${progress.total}`
                          : `${progress.current}/${progress.total}`}
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Parse {canParseCount} selected
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleDefective}
                  disabled={canParseCount === 0}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 ${selectedAllDefective ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-red-100 text-red-800 hover:bg-red-200'}`}
                >
                  <AlertTriangle size={14} />
                  {defectiveLabel}
                </button>
              </div>
              {canParseCount === 0 && (
                <p className="text-[11px] text-slate-500">Select items in the inventory table first.</p>
              )}
            </>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <p className="font-bold">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export const InventoryAISpecsPanel = React.memo(InventoryAISpecsPanelInner);

export default InventoryAISpecsPanel;
