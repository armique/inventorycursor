import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
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
      ? 'border-[var(--rx-warn)]/30 bg-[var(--rx-warn-soft)]'
      : mode === 'over'
        ? 'border-[var(--rx-bad)]/25 bg-[var(--rx-bad-soft)]'
        : 'border-[var(--rx-line)] bg-[var(--rx-soft)]';

  return (
    <div className={`relative rounded-xl border px-2.5 py-2 min-w-[6.5rem] ${tone}`}>
      <button
        type="button"
        title="Remove"
        onClick={() => onRemove(row.id)}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-[var(--rx-line)] text-[var(--rx-muted)] hover:text-[var(--rx-bad)] inline-flex items-center justify-center"
      >
        <X size={9} strokeWidth={2.5} />
      </button>
      <p className="text-[11px] font-semibold text-[var(--rx-ink)] leading-tight pr-2 truncate" title={row.label}>
        {row.label}
      </p>
      <div className="flex items-center gap-1 mt-1.5">
        <span className="rx-num text-[13px] font-semibold tabular-nums">
          {row.current}/
        </span>
        <input
          type="number"
          min={0}
          max={99}
          value={row.target}
          title="Target"
          onChange={(e) => onTargetChange(row.id, Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
          className="w-8 px-0.5 py-0.5 rounded-md border border-[var(--rx-line)] bg-white text-[12px] font-semibold rx-num text-center"
        />
      </div>
      {mode === 'need' && row.need > 0 && (
        <p className="text-[10px] font-semibold text-[var(--rx-warn)] mt-0.5">−{row.need}</p>
      )}
      {mode === 'over' && row.excess > 0 && (
        <p className="text-[10px] font-semibold text-[var(--rx-bad)] mt-0.5">+{row.excess}</p>
      )}
    </div>
  );
}

const ReinvestStockGaps: React.FC<Props> = ({ items, restockHints = [] }) => {
  const [entries, setEntries] = useState<StockWatchEntry[]>(() => loadStockWatchEntries());
  const [open, setOpen] = useState(false);
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
    () => restockHints.filter((h) => h.kind === 'bundle').slice(0, 3),
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

  const summary =
    need.length || over.length
      ? `${need.length ? `${need.length} low` : ''}${need.length && over.length ? ' · ' : ''}${
          over.length ? `${over.length} over` : ''
        }`
      : entries.length
        ? 'on target'
        : 'empty';

  return (
    <section className="rx-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight">Shelf</h2>
          <span className="text-[12px] text-[var(--rx-muted)] truncate">{summary}</span>
        </div>
        <ChevronDown
          size={15}
          className={`text-[var(--rx-muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--rx-line)] pt-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                addOpen
                  ? 'border-[var(--rx-ink)] bg-[var(--rx-ink)] text-white'
                  : 'border-[var(--rx-line)] text-[var(--rx-muted)]'
              }`}
            >
              <Plus size={12} strokeWidth={2.5} /> Add
            </button>
          </div>

          {kitHints.length > 0 && (
            <div className="rounded-xl bg-[var(--rx-soft)] px-3 py-2">
              <p className="text-[11px] font-medium text-[var(--rx-muted)] mb-1">Kits to complete</p>
              <ul className="space-y-0.5">
                {kitHints.map((h) => (
                  <li key={h.key} className="text-[12px] font-semibold truncate">
                    {h.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {addOpen && (
            <div className="rounded-xl border border-[var(--rx-line)] bg-[var(--rx-soft)] p-2 space-y-1.5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="RTX 3060, SSD 1TB…"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--rx-line)] bg-white text-[12px] font-medium"
              />
              {query.trim().length >= 2 && (
                <div className="max-h-36 overflow-y-auto space-y-0.5">
                  {suggestions.length === 0 ? (
                    <p className="text-[11px] text-[var(--rx-muted)] px-1 py-1">No matches</p>
                  ) : (
                    suggestions.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => addSuggestion(s)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white text-left"
                      >
                        <span className="text-[12px] font-semibold truncate">{s.label}</span>
                        <span className="rx-pill shrink-0">{s.categoryLabel}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {need.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-[var(--rx-warn)] mb-1.5">Low</p>
              <div className="flex flex-wrap gap-1.5">
                {need.map((row) => (
                  <StockChip key={row.id} row={row} mode="need" onTargetChange={setTarget} onRemove={removeEntry} />
                ))}
              </div>
            </div>
          )}

          {over.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-[var(--rx-bad)] mb-1.5">Over</p>
              <div className="flex flex-wrap gap-1.5">
                {over.map((row) => (
                  <StockChip key={row.id} row={row} mode="over" onTargetChange={setTarget} onRemove={removeEntry} />
                ))}
              </div>
            </div>
          )}

          {ok.length > 0 && (
            <details>
              <summary className="text-[11px] font-medium text-[var(--rx-ok)] cursor-pointer">
                OK · {ok.length}
              </summary>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {ok.map((row) => (
                  <StockChip key={row.id} row={row} mode="ok" onTargetChange={setTarget} onRemove={removeEntry} />
                ))}
              </div>
            </details>
          )}

          {!entries.length && !kitHints.length && (
            <p className="text-[12px] text-[var(--rx-muted)] font-medium">Add SKUs to watch stock vs target.</p>
          )}
        </div>
      )}
    </section>
  );
};

export default ReinvestStockGaps;
