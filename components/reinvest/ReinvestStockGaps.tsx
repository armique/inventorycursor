import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageSearch, Plus, X, Layers, AlertTriangle } from 'lucide-react';
import type { InventoryItem } from '../../types';
import {
  computeWatchRows,
  DEFAULT_STOCK_TARGET,
  entryFromSuggestion,
  loadStockWatchEntries,
  saveStockWatchEntries,
  suggestStockWatch,
  type StockTargetRow,
  type StockWatchEntry,
  type StockWatchSuggestion,
} from '../../utils/reinvestStockTargets';

type Props = {
  items: InventoryItem[];
  /** Restock groups from Today — surface as “complete this kit” hints. */
  restockHints?: Array<{ key: string; label: string; kind: string }>;
};

function StockChip({
  row,
  mode,
  onTargetChange,
  onRemove,
}: {
  row: StockTargetRow;
  mode: 'need' | 'over' | 'ok';
  onTargetChange: (id: string, target: number) => void;
  onRemove: (id: string) => void;
}) {
  const tone =
    mode === 'need'
      ? row.current === 0
        ? 'border-amber-300 bg-amber-50'
        : 'border-slate-200 bg-slate-50'
      : mode === 'over'
        ? 'border-rose-300 bg-rose-50'
        : 'border-emerald-200 bg-emerald-50/70';

  return (
    <div className={`relative rounded-lg border px-2 py-1.5 min-w-[6.5rem] max-w-[8.5rem] ${tone}`}>
      <button
        type="button"
        title="Remove from watchlist"
        onClick={() => onRemove(row.id)}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300 inline-flex items-center justify-center shadow-sm"
      >
        <X size={9} strokeWidth={2.5} />
      </button>
      <p className="text-[10px] font-black text-slate-900 leading-tight pr-2 truncate" title={row.label}>
        {row.label}
      </p>
      {row.categoryLabel && (
        <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400 truncate">{row.categoryLabel}</p>
      )}
      <div className="flex items-center gap-1 mt-1">
        <span
          className={`text-xs font-black tabular-nums ${
            mode === 'over' ? 'text-rose-700' : mode === 'need' ? 'text-slate-800' : 'text-emerald-700'
          }`}
        >
          {row.current}/
        </span>
        <input
          type="number"
          min={0}
          max={99}
          value={row.target}
          title="Target stock qty"
          onChange={(e) => onTargetChange(row.id, Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
          className="w-8 px-0.5 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-black text-slate-800 tabular-nums text-center"
        />
      </div>
      {mode === 'need' && row.need > 0 && (
        <p className="text-[8px] font-black uppercase tracking-wider text-amber-700 mt-0.5">need {row.need}</p>
      )}
      {mode === 'over' && row.excess > 0 && (
        <p className="text-[8px] font-black uppercase tracking-wider text-rose-700 mt-0.5">+{row.excess} over</p>
      )}
    </div>
  );
}

/**
 * Editable hot-seller watchlist: understock + overstock, add via name search.
 */
const ReinvestStockGaps: React.FC<Props> = ({ items, restockHints = [] }) => {
  const [entries, setEntries] = useState<StockWatchEntry[]>(() => loadStockWatchEntries());
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveStockWatchEntries(entries);
  }, [entries]);

  useEffect(() => {
    if (addOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [addOpen]);

  const rows = useMemo(() => computeWatchRows(entries, items), [entries, items]);
  const need = useMemo(() => rows.filter((r) => r.need > 0), [rows]);
  const over = useMemo(() => rows.filter((r) => r.excess > 0), [rows]);
  const ok = useMemo(() => rows.filter((r) => r.need === 0 && r.excess === 0), [rows]);

  const kitHints = useMemo(
    () => restockHints.filter((h) => h.kind === 'bundle').slice(0, 4),
    [restockHints],
  );
  const suggestions = useMemo(
    () => (addOpen ? suggestStockWatch(query, items, entries) : []),
    [addOpen, query, items, entries],
  );

  const setTarget = (id: string, target: number) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, target } : e)));
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const addSuggestion = (s: StockWatchSuggestion) => {
    setEntries((prev) => {
      const next = entryFromSuggestion(s, DEFAULT_STOCK_TARGET);
      if (prev.some((e) => e.id === next.id)) return prev;
      return [...prev, next];
    });
    setQuery('');
    setAddOpen(false);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <PackageSearch size={13} /> Shelf watch
          </h2>
          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
            Live stock · edit target · complete kits from Today when listed below
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider ${
            addOpen
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Plus size={12} strokeWidth={2.5} /> Add
        </button>
      </div>

      {kitHints.length > 0 && (
        <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-violet-700 mb-1">Complete these kits</p>
          <ul className="space-y-0.5">
            {kitHints.map((h) => (
              <li key={h.key} className="text-[11px] font-bold text-violet-900 truncate">
                {h.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {addOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-1.5">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type name — e.g. RTX 3060, SSD 1TB, Ryzen 5 5600…"
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 placeholder:text-slate-400"
          />
          {query.trim().length >= 2 && (
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {suggestions.length === 0 ? (
                <p className="text-[10px] text-slate-400 font-semibold px-1 py-1">No matches</p>
              ) : (
                suggestions.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => addSuggestion(s)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-left"
                  >
                    <span>
                      <span className="block text-[11px] font-black text-slate-900">{s.label}</span>
                      {s.hint && (
                        <span className="block text-[9px] text-slate-400 font-semibold truncate">{s.hint}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {s.categoryLabel}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {query.trim().length < 2 && (
            <p className="text-[10px] text-slate-400 font-semibold px-0.5">
              Category auto-fills from the name (GPU, SSD, CPU…).
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        <div>
          <h3 className="text-[9px] font-black uppercase tracking-widest text-amber-700/80 mb-1.5 flex items-center gap-1">
            <Layers size={11} /> Need · don’t have enough
          </h3>
          {need.length === 0 ? (
            <p className="text-[10px] text-slate-400 font-semibold">All watched SKUs at target.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {need.map((row) => (
                <StockChip key={row.id} row={row} mode="need" onTargetChange={setTarget} onRemove={removeEntry} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[9px] font-black uppercase tracking-widest text-rose-700/80 mb-1.5 flex items-center gap-1">
            <AlertTriangle size={11} /> Overstock · too many
          </h3>
          {over.length === 0 ? (
            <p className="text-[10px] text-slate-400 font-semibold">No overstock on the watchlist.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {over.map((row) => (
                <StockChip key={row.id} row={row} mode="over" onTargetChange={setTarget} onRemove={removeEntry} />
              ))}
            </div>
          )}
        </div>

        {ok.length > 0 && (
          <details className="group">
            <summary className="text-[9px] font-black uppercase tracking-widest text-emerald-700/70 cursor-pointer list-none flex items-center gap-1">
              On target ({ok.length})
            </summary>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {ok.map((row) => (
                <StockChip key={row.id} row={row} mode="ok" onTargetChange={setTarget} onRemove={removeEntry} />
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
};

export default ReinvestStockGaps;
