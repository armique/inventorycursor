import React, { useEffect, useMemo, useState } from 'react';
import { X, Scissors, Plus, Minus, Check, AlertTriangle, Copy } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR, parseLocaleMoney } from '../utils/formatMoney';
import {
  SPLIT_PART_PRESETS,
  buildIdenticalCopyDrafts,
  buildSplitApplyItems,
  buildSplitDrafts,
  defaultSplitSelection,
  detectIdenticalQtyHint,
  type SplitMode,
  type SplitPartDraft,
  type SplitPartPresetId,
  type SplitSelection,
} from '../utils/splitParts';

interface Props {
  item: InventoryItem;
  items: InventoryItem[];
  onClose: () => void;
  onApply: (updates: InventoryItem[]) => void;
}

const SplitPartsModal: React.FC<Props> = ({ item, items, onClose, onApply }) => {
  const qtyHint = useMemo(() => detectIdenticalQtyHint(item.name || ''), [item.name]);
  const [mode, setMode] = useState<SplitMode>(() => (qtyHint ? 'identical' : 'parts'));
  const [identicalQty, setIdenticalQty] = useState(() => qtyHint || 2);
  const [selection, setSelection] = useState<SplitSelection>(() => defaultSplitSelection(item));
  const [drafts, setDrafts] = useState<SplitPartDraft[]>(() =>
    qtyHint
      ? buildIdenticalCopyDrafts(item, qtyHint || 2)
      : buildSplitDrafts(item, defaultSplitSelection(item))
  );

  useEffect(() => {
    if (mode === 'identical') {
      setDrafts((prev) => buildIdenticalCopyDrafts(item, identicalQty, prev));
    } else {
      setDrafts((prev) => buildSplitDrafts(item, selection, prev));
    }
  }, [item, mode, identicalQty, selection]);

  const totalBuy = Number(item.buyPrice) || 0;
  const allocated = useMemo(
    () => round2(drafts.reduce((s, d) => s + (Number(d.buyPrice) || 0), 0)),
    [drafts]
  );
  const delta = round2(totalBuy - allocated);
  const canConfirm = drafts.length > 0 && Math.abs(delta) < 0.009;
  const perItem =
    mode === 'identical' && drafts.length > 0
      ? round2(totalBuy / drafts.length)
      : null;

  const toggle = (id: SplitPartPresetId) => {
    if (id === 'identical') return;
    setSelection((prev) => ({
      ...prev,
      enabled: { ...prev.enabled, [id]: !prev.enabled[id] },
    }));
  };

  const setFanQty = (qty: number) => {
    setSelection((prev) => ({
      ...prev,
      fanQty: Math.min(6, Math.max(1, qty)),
      enabled: { ...prev.enabled, fans: true },
    }));
  };

  const setCopyQty = (qty: number) => {
    setIdenticalQty(Math.min(48, Math.max(2, qty)));
  };

  const patchDraft = (key: string, patch: Partial<SplitPartDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    const { parent, children } = buildSplitApplyItems(item, drafts, items);
    if (!children.length) return;
    onApply([parent, ...children]);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Split into parts"
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3 bg-violet-50/80">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-violet-950 uppercase tracking-tight flex items-center gap-2">
              <Scissors size={16} className="shrink-0 text-violet-700" />
              Split into parts
            </h3>
            <p className="text-xs font-semibold text-slate-700 truncate mt-0.5" title={item.name}>
              {item.name}
            </p>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              Buy €{formatEUR(totalBuy)}
              {mode === 'identical' && perItem != null
                ? ` · ≈ €${formatEUR(perItem)} each ×${identicalQty}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="flex rounded-xl border border-slate-200 p-0.5 bg-slate-50">
            <button
              type="button"
              onClick={() => setMode('identical')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                mode === 'identical'
                  ? 'bg-white text-violet-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Copy size={12} /> Identical copies
            </button>
            <button
              type="button"
              onClick={() => setMode('parts')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                mode === 'parts'
                  ? 'bg-white text-violet-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Scissors size={12} /> Different parts
            </button>
          </div>

          {mode === 'identical' ? (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500 font-medium">
                Split a multi-buy lot into separate rows with the same name. Buy cost is divided equally
                (e.g. 8× SSD for €200 → 8 items at €25).
              </p>
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-violet-950 uppercase tracking-wide">Quantity</p>
                  <p className="text-[10px] font-semibold text-violet-800/80 mt-0.5">
                    How many identical items to create
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={identicalQty <= 2}
                    onClick={() => setCopyQty(identicalQty - 1)}
                    className="h-8 w-8 rounded-md border border-violet-200 bg-white flex items-center justify-center text-slate-700 disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={48}
                    value={identicalQty}
                    onChange={(e) => setCopyQty(Number(e.target.value) || 2)}
                    className="w-14 text-center text-sm font-black tabular-nums bg-white border border-violet-200 rounded-md py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  <button
                    type="button"
                    disabled={identicalQty >= 48}
                    onClick={() => setCopyQty(identicalQty + 1)}
                    className="h-8 w-8 rounded-md border border-violet-200 bg-white flex items-center justify-center text-slate-700 disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              {[2, 4, 6, 8, 10, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCopyQty(n)}
                  className={`mr-1.5 mb-1 inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                    identicalQty === n
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {n}×
                </button>
              ))}
            </div>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 font-medium">
                Pick parts. Fans stay one row with qty. Mark each part faulty if needed.
              </p>

              <div className="space-y-2">
                {SPLIT_PART_PRESETS.map((preset) => {
                  const on = selection.enabled[preset.id];
                  return (
                    <div
                      key={preset.id}
                      className={`rounded-xl border px-3 py-2.5 transition-colors ${
                        on ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggle(preset.id)}
                          className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                            on
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white border-slate-300 text-transparent'
                          }`}
                          aria-pressed={on}
                          aria-label={preset.label}
                        >
                          <Check size={12} strokeWidth={3} />
                        </button>
                        <span className="text-sm font-bold text-slate-800 flex-1">{preset.label}</span>
                        {preset.hasQty && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={!on || selection.fanQty <= 1}
                              onClick={() => setFanQty(selection.fanQty - 1)}
                              className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 disabled:opacity-40"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="text-xs font-black tabular-nums w-5 text-center">
                              {selection.fanQty}
                            </span>
                            <button
                              type="button"
                              disabled={!on || selection.fanQty >= 6}
                              onClick={() => setFanQty(selection.fanQty + 1)}
                              className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 disabled:opacity-40"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {drafts.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                {mode === 'identical' ? `Items to create (${drafts.length})` : `Parts to create (${drafts.length})`}
              </p>
              {drafts.map((d, idx) => (
                <div
                  key={d.key}
                  className={`rounded-xl border px-3 py-2 space-y-1.5 ${
                    d.isDefective
                      ? 'border-amber-300 bg-amber-50/70'
                      : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {mode === 'identical' && (
                      <span className="text-[10px] font-black text-slate-400 tabular-nums shrink-0 w-5">
                        {idx + 1}.
                      </span>
                    )}
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (mode === 'identical') {
                          // Keep all copies in sync when editing the shared name.
                          setDrafts((prev) => prev.map((x) => ({ ...x, name })));
                        } else {
                          patchDraft(d.key, { name });
                        }
                      }}
                      className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-slate-400 shrink-0">
                      Buy €
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(d.buyPrice)}
                      onChange={(e) => {
                        const n = parseLocaleMoney(e.target.value, 0);
                        setDrafts((prev) => {
                          const next = prev.map((x) =>
                            x.key === d.key ? { ...x, buyPrice: n, buyLocked: true } : x
                          );
                          return mode === 'identical'
                            ? buildIdenticalCopyDrafts(item, identicalQty, next)
                            : buildSplitDrafts(item, selection, next);
                        });
                      }}
                      className="w-24 text-xs font-bold tabular-nums bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                    {d.quantity != null && d.quantity > 1 && (
                      <span className="text-[10px] font-bold text-slate-500">×{d.quantity}</span>
                    )}
                    {d.buyLocked && (
                      <button
                        type="button"
                        onClick={() => {
                          setDrafts((prev) => {
                            const unlocked = prev.map((x) =>
                              x.key === d.key ? { ...x, buyLocked: false } : x
                            );
                            return mode === 'identical'
                              ? buildIdenticalCopyDrafts(item, identicalQty, unlocked)
                              : buildSplitDrafts(item, selection, unlocked);
                          });
                        }}
                        className="text-[10px] font-bold text-violet-700 hover:underline shrink-0"
                      >
                        Auto
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => patchDraft(d.key, { isDefective: !d.isDefective })}
                      className={`ml-auto inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-1 rounded-md border transition-colors ${
                        d.isDefective
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                      aria-pressed={Boolean(d.isDefective)}
                      title={d.isDefective ? 'Marked faulty' : 'Mark as faulty'}
                    >
                      <AlertTriangle size={11} />
                      {d.isDefective ? 'Faulty' : 'OK'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-white space-y-2">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-500">Allocated</span>
            <span
              className={
                Math.abs(delta) < 0.009 ? 'text-emerald-700' : 'text-amber-700'
              }
            >
              €{formatEUR(allocated)} / €{formatEUR(totalBuy)}
              {Math.abs(delta) >= 0.009 ? ` · Δ €${formatEUR(delta)}` : ''}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-black hover:bg-violet-700 disabled:opacity-40 disabled:pointer-events-none"
            >
              Split · {drafts.length} {mode === 'identical' ? 'items' : 'parts'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default SplitPartsModal;
