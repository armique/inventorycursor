import React, { useEffect, useMemo, useState } from 'react';
import { X, Scissors, Plus, Minus, Check, AlertTriangle } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR, parseLocaleMoney } from '../utils/formatMoney';
import {
  SPLIT_PART_PRESETS,
  buildSplitApplyItems,
  buildSplitDrafts,
  defaultSplitSelection,
  detectAioHints,
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
  const hints = useMemo(() => detectAioHints(item.name || '', item.specs), [item.name, item.specs]);
  const [selection, setSelection] = useState<SplitSelection>(() => defaultSplitSelection(item));
  const [drafts, setDrafts] = useState<SplitPartDraft[]>(() =>
    buildSplitDrafts(item, defaultSplitSelection(item))
  );

  useEffect(() => {
    setDrafts((prev) => buildSplitDrafts(item, selection, prev));
  }, [item, selection]);

  const totalBuy = Number(item.buyPrice) || 0;
  const allocated = useMemo(
    () => round2(drafts.reduce((s, d) => s + (Number(d.buyPrice) || 0), 0)),
    [drafts]
  );
  const delta = round2(totalBuy - allocated);
  const canConfirm = drafts.length > 0 && Math.abs(delta) < 0.009;

  const toggle = (id: SplitPartPresetId) => {
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
              {hints.looksLikeAio
                ? ` · AIO${hints.radiatorMm ? ` ${hints.radiatorMm}mm` : ''}`
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

          {drafts.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Parts to create ({drafts.length})
              </p>
              {drafts.map((d) => (
                <div
                  key={d.key}
                  className={`rounded-xl border px-3 py-2 space-y-1.5 ${
                    d.isDefective
                      ? 'border-amber-300 bg-amber-50/70'
                      : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => patchDraft(d.key, { name: e.target.value })}
                    className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
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
                          return buildSplitDrafts(item, selection, next);
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
                          setDrafts((prev) =>
                            buildSplitDrafts(
                              item,
                              selection,
                              prev.map((x) =>
                                x.key === d.key ? { ...x, buyLocked: false } : x
                              )
                            )
                          );
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
              Split · {drafts.length} parts
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
