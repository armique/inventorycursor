import React, { useEffect, useMemo, useState } from 'react';
import { X, Scissors, Plus, Minus, Check, AlertTriangle, Copy } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR, parseLocaleMoney } from '../utils/formatMoney';
import {
  CABLE_TYPE_OPTIONS,
  SPLIT_PART_PRESETS,
  buildIdenticalCopyDrafts,
  buildSplitApplyItems,
  buildSplitDrafts,
  defaultSplitSelection,
  resolveIdenticalLotQty,
  stripIdenticalQtyFromName,
  withConditionSuffix,
  type CableLine,
  type CableTypeId,
  type SplitMode,
  type SplitPartDraft,
  type SplitPartPresetId,
  type SplitPriceMode,
  type SplitSelection,
} from '../utils/splitParts';

interface Props {
  item: InventoryItem;
  items: InventoryItem[];
  onClose: () => void;
  onApply: (updates: InventoryItem[], deleteIds?: string[]) => void;
}

const SplitPartsModal: React.FC<Props> = ({ item, items, onClose, onApply }) => {
  const qtyHint = useMemo(() => resolveIdenticalLotQty(item), [item]);
  const unitName = useMemo(
    () => stripIdenticalQtyFromName(item.name || '') || item.name || 'Item',
    [item.name]
  );
  // Default to identical copies — most multi-buy lots need this; AIO users switch to Different parts.
  const [mode, setMode] = useState<SplitMode>('identical');
  const [identicalQty, setIdenticalQty] = useState(() => qtyHint || 2);
  // Nested (default): parts stay grouped under this item, which becomes a container.
  // Standalone: parts appear directly as their own rows; this item just keeps whatever
  // value wasn't carved out.
  const [standalone, setStandalone] = useState(false);
  // Equal: every part gets the same share of the buy price. Smart: a part marked
  // faulty gets a smaller share instead of splitting the cost dead even.
  const [priceMode, setPriceMode] = useState<SplitPriceMode>('equal');
  const [selection, setSelection] = useState<SplitSelection>(() => defaultSplitSelection(item));
  const [drafts, setDrafts] = useState<SplitPartDraft[]>(() =>
    buildIdenticalCopyDrafts(item, qtyHint || 2)
  );

  useEffect(() => {
    if (mode === 'identical') {
      setDrafts((prev) => buildIdenticalCopyDrafts(item, identicalQty, prev, priceMode));
    } else {
      setDrafts((prev) => buildSplitDrafts(item, selection, prev));
    }
  }, [item, mode, identicalQty, selection, priceMode]);

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
      // Turning Cable on with no rows yet (e.g. it was cleared out) pre-loads every cable
      // type at qty 0 — same as defaultSplitSelection — so the user just bumps the ones
      // they have instead of adding each type by hand.
      cables:
        id === 'cable' && !prev.enabled.cable && prev.cables.length === 0
          ? CABLE_TYPE_OPTIONS.map((opt, i) => ({ id: `c${Date.now()}-${i}`, type: opt.id, qty: 0 }))
          : prev.cables,
    }));
  };

  const setFanQty = (qty: number) => {
    setSelection((prev) => ({
      ...prev,
      fanQty: Math.min(6, Math.max(1, qty)),
      enabled: { ...prev.enabled, fans: true },
    }));
  };

  const addCableLine = () => {
    setSelection((prev) => ({
      ...prev,
      enabled: { ...prev.enabled, cable: true },
      cables: [...prev.cables, { id: `c${Date.now()}`, type: 'other', qty: 1 }],
    }));
  };

  const removeCableLine = (id: string) => {
    setSelection((prev) => {
      const cables = prev.cables.filter((c) => c.id !== id);
      return { ...prev, cables, enabled: { ...prev.enabled, cable: cables.length > 0 } };
    });
  };

  const updateCableLine = (id: string, patch: Partial<CableLine>) => {
    setSelection((prev) => ({
      ...prev,
      cables: prev.cables.map((c) => (c.id === id ? { ...c, ...patch } : c)),
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
    const { parent, children } = buildSplitApplyItems(item, drafts, items, { standalone });
    if (!children.length) return;
    // No parent means every bit of the source's value was carved into the new standalone
    // parts — nothing is left for it to be, so it's deleted instead of saved back as a
    // stale €0 row.
    if (parent) onApply([parent, ...children]);
    else onApply(children, [item.id]);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md max-h-[85vh] overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Split into parts"
      >
        <div className="shrink-0 px-3.5 py-2 border-b border-slate-100 bg-violet-50/80 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-black text-violet-950 uppercase tracking-tight flex items-center gap-1.5">
                <Scissors size={14} className="shrink-0 text-violet-700" />
                Split lot
              </h3>
              <p className="text-xs font-semibold text-slate-700 truncate mt-0.5" title={item.name}>
                {item.name}
              </p>
              {qtyHint != null && (
                <p className="text-[10px] font-bold text-violet-700 mt-0.5">
                  Detected lot ×{qtyHint} → splits into “{unitName}”
                </p>
              )}
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                Buy €{formatEUR(totalBuy)}
                {mode === 'identical' && perItem != null
                  ? ` · ≈ €${formatEUR(perItem)} each ×${identicalQty}`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex rounded-xl border border-violet-200 p-0.5 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setMode('identical')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                mode === 'identical'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Copy size={11} /> Identical ×N
            </button>
            <button
              type="button"
              onClick={() => setMode('parts')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                mode === 'parts'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Scissors size={11} /> Different parts
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-2">

          {mode === 'identical' ? (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-medium">
                {qtyHint != null
                  ? `This looks like a ×${qtyHint} lot (“${unitName}”). Confirm quantity, then split into separate rows with equal buy cost.`
                  : 'Split a multi-buy lot into separate rows with the same name. Buy cost is divided equally (e.g. x8/SSD for €200 → 8 items at €25).'}
              </p>
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2 flex items-center justify-between gap-3">
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
                    className="h-7 w-7 rounded-md border border-violet-200 bg-white flex items-center justify-center text-slate-700 disabled:opacity-40"
                  >
                    <Minus size={13} />
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={48}
                    value={identicalQty}
                    onChange={(e) => setCopyQty(Number(e.target.value) || 2)}
                    className="w-14 text-center text-sm font-black tabular-nums bg-white border border-violet-200 rounded-md py-1 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  <button
                    type="button"
                    disabled={identicalQty >= 48}
                    onClick={() => setCopyQty(identicalQty + 1)}
                    className="h-7 w-7 rounded-md border border-violet-200 bg-white flex items-center justify-center text-slate-700 disabled:opacity-40"
                  >
                    <Plus size={13} />
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
              <p className="text-[10px] text-slate-500 font-medium">
                Pick parts. Fans stay one row with qty. Mark each part faulty if needed.
              </p>

              <div className="space-y-1.5">
                {SPLIT_PART_PRESETS.map((preset) => {
                  const on = selection.enabled[preset.id];
                  return (
                    <div
                      key={preset.id}
                      className={`rounded-xl border px-2.5 py-1.5 transition-colors ${
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
                      {preset.id === 'cable' && on && (
                        <div className="mt-2 space-y-1.5 pl-7">
                          {selection.cables.map((line) => (
                            <div key={line.id} className="flex items-center gap-1.5">
                              <select
                                value={line.type}
                                onChange={(e) =>
                                  updateCableLine(line.id, { type: e.target.value as CableTypeId })
                                }
                                className="flex-1 min-w-0 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                              >
                                {CABLE_TYPE_OPTIONS.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={line.qty <= 0}
                                  onClick={() => updateCableLine(line.id, { qty: line.qty - 1 })}
                                  className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 disabled:opacity-40"
                                >
                                  <Minus size={13} />
                                </button>
                                <span className={`text-xs font-black tabular-nums w-5 text-center ${line.qty <= 0 ? 'text-slate-300' : ''}`}>
                                  {line.qty}
                                </span>
                                <button
                                  type="button"
                                  disabled={line.qty >= 20}
                                  onClick={() => updateCableLine(line.id, { qty: line.qty + 1 })}
                                  className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 disabled:opacity-40"
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCableLine(line.id)}
                                className="h-7 w-7 shrink-0 rounded-md border border-slate-200 flex items-center justify-center text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                                aria-label="Remove cable type"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addCableLine}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 hover:underline"
                          >
                            <Plus size={12} /> Add cable type
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {drafts.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                {mode === 'identical' ? `Items to create (${drafts.length})` : `Parts to create (${drafts.length})`}
              </p>
              {drafts.map((d, idx) => {
                const isRemainder = d.presetId === 'remainder';
                return (
                <div
                  key={d.key}
                  className={`rounded-lg border px-2 py-1 space-y-1 ${
                    isRemainder
                      ? 'border-violet-300 bg-violet-50/70 ring-1 ring-violet-200'
                      : d.isDefective
                        ? 'border-amber-300 bg-amber-50/70'
                        : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {mode === 'identical' && (
                      <span className="text-[10px] font-black text-slate-400 tabular-nums shrink-0 w-4">
                        {idx + 1}.
                      </span>
                    )}
                    {isRemainder && (
                      <span className="shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-600 text-white">
                        Main
                      </span>
                    )}
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (mode === 'identical') {
                          // Keep all copies in sync when editing the shared base name,
                          // but each copy keeps its own Working/Faulty tag.
                          setDrafts((prev) =>
                            prev.map((x) => ({ ...x, name: withConditionSuffix(name, Boolean(x.isDefective)) }))
                          );
                        } else {
                          patchDraft(d.key, { name, nameLocked: true });
                        }
                      }}
                      className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold uppercase text-slate-400 shrink-0">
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
                            ? buildIdenticalCopyDrafts(item, identicalQty, next, priceMode)
                            : buildSplitDrafts(item, selection, next);
                        });
                      }}
                      className="w-20 text-xs font-bold tabular-nums bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-300"
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
                              ? buildIdenticalCopyDrafts(item, identicalQty, unlocked, priceMode)
                              : buildSplitDrafts(item, selection, unlocked);
                          });
                        }}
                        className="text-[10px] font-bold text-violet-700 hover:underline shrink-0"
                      >
                        Auto
                      </button>
                    )}
                    {!isRemainder && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = !d.isDefective;
                          setDrafts((prev) => {
                            const updated = prev.map((x) =>
                              x.key === d.key
                                ? { ...x, isDefective: next, name: withConditionSuffix(x.name, next) }
                                : x
                            );
                            // Smart mode's weights depend on isDefective — recompute the
                            // split now so flipping the flag actually moves the money.
                            return mode === 'identical'
                              ? buildIdenticalCopyDrafts(item, identicalQty, updated, priceMode)
                              : updated;
                          });
                        }}
                        className={`ml-auto inline-flex items-center gap-1 text-[10px] font-black uppercase px-1.5 py-0.5 rounded-md border transition-colors ${
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
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {drafts.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-1 flex gap-1">
              <button
                type="button"
                onClick={() => setStandalone(false)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                  !standalone
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title="Parts stay grouped under this item, which becomes a bundle"
              >
                As bundle
              </button>
              <button
                type="button"
                onClick={() => setStandalone(true)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                  standalone
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title="Parts appear as their own standalone rows right away"
              >
                As standalone
              </button>
            </div>
          )}

          {mode === 'identical' && drafts.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-1 flex gap-1">
              <button
                type="button"
                onClick={() => setPriceMode('equal')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                  priceMode === 'equal'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title="Split the buy price evenly across every part"
              >
                Equal split
              </button>
              <button
                type="button"
                onClick={() => setPriceMode('smart')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                  priceMode === 'smart'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title="Parts marked Faulty get a smaller share of the buy price"
              >
                Smart split
              </button>
            </div>
          )}
        </div>

        <div className="shrink-0 px-3.5 py-2 border-t border-slate-100 bg-white space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-500">Same as you paid</span>
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
              className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-sm font-black hover:bg-violet-700 disabled:opacity-40 disabled:pointer-events-none"
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
