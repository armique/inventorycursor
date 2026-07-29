import React, { useMemo, useState } from 'react';
import { Boxes, Check, Layers, Monitor, Package, Sparkles, Trash2, X } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { buildContainerTitle } from '../utils/buildTitle';
import { buildRetroContainerAndComponents } from '../utils/retroSoldCompose';
import {
  suggestEqualSplitSoldGroups,
  type EqualSplitSoldGroup,
} from '../utils/suggestEqualSplitSoldGroups';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { toLocalCalendarDateKey } from '../utils/calendarDate';

type DraftGroup = {
  id: string;
  sellDate: string;
  equalSellPrice: number;
  itemIds: string[];
  kind: 'bundle' | 'pc';
  name: string;
  nameTouched: boolean;
  useSmartDistribution: boolean;
  dismissed?: boolean;
};

type Props = {
  items: InventoryItem[];
  onApply: (updates: InventoryItem[]) => void;
  onClose: () => void;
};

function toDraft(g: EqualSplitSoldGroup, byId: Map<string, InventoryItem>): DraftGroup {
  const parts = g.itemIds.map((id) => byId.get(id)).filter(Boolean) as InventoryItem[];
  const kind: 'bundle' | 'pc' = g.suggestedKind === 'pc' ? 'pc' : 'bundle';
  return {
    id: g.id,
    sellDate: g.sellDate,
    equalSellPrice: g.equalSellPrice,
    itemIds: [...g.itemIds],
    kind,
    name: buildContainerTitle(kind, parts),
    nameTouched: false,
    useSmartDistribution: true,
  };
}

const SoldEqualSplitGroupsModal: React.FC<Props> = ({ items, onApply, onClose }) => {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const seedGroups = useMemo(() => suggestEqualSplitSoldGroups(items), [items]);

  const [drafts, setDrafts] = useState<DraftGroup[]>(() => seedGroups.map((g) => toDraft(g, byId)));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [confirmedMemberIds, setConfirmedMemberIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(() => seedGroups[0]?.id ?? null);

  const visibleDrafts = useMemo(() => {
    return drafts
      .filter((d) => !dismissedIds.has(d.id))
      .map((d) => ({
        ...d,
        itemIds: d.itemIds.filter((id) => byId.has(id) && !confirmedMemberIds.has(id)),
      }))
      .filter((d) => d.itemIds.length >= 2);
  }, [drafts, dismissedIds, confirmedMemberIds, byId]);

  const active = visibleDrafts.find((d) => d.id === activeId) ?? visibleDrafts[0] ?? null;

  const activeParts = useMemo(() => {
    if (!active) return [];
    return active.itemIds.map((id) => byId.get(id)).filter(Boolean) as InventoryItem[];
  }, [active, byId]);

  const autoName = useMemo(() => {
    if (!active) return '';
    return buildContainerTitle(active.kind, activeParts);
  }, [active, activeParts]);

  const patchDraft = (id: string, patch: Partial<DraftGroup>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const dismissActive = () => {
    if (!active) return;
    setDismissedIds((prev) => new Set(prev).add(active.id));
    const rest = visibleDrafts.filter((d) => d.id !== active.id);
    setActiveId(rest[0]?.id ?? null);
  };

  const removePart = (itemId: string) => {
    if (!active) return;
    const itemIds = active.itemIds.filter((id) => id !== itemId);
    if (itemIds.length < 2) {
      dismissActive();
      return;
    }
    const parts = itemIds.map((id) => byId.get(id)).filter(Boolean) as InventoryItem[];
    patchDraft(active.id, {
      itemIds,
      name: active.nameTouched ? active.name : buildContainerTitle(active.kind, parts),
    });
  };

  const addPart = (itemId: string) => {
    if (!active || active.itemIds.includes(itemId)) return;
    const itemIds = [...active.itemIds, itemId];
    const parts = itemIds.map((id) => byId.get(id)).filter(Boolean) as InventoryItem[];
    patchDraft(active.id, {
      itemIds,
      name: active.nameTouched ? active.name : buildContainerTitle(active.kind, parts),
    });
  };

  const confirmActive = () => {
    if (!active || activeParts.length < 2) return;
    const name = active.name.trim() || autoName;
    const { bundle, updatedComponents } = buildRetroContainerAndComponents({
      items: activeParts,
      allItems: items,
      kind: active.kind,
      bundleName: name,
      sellDate: active.sellDate,
      useSmartDistribution: active.useSmartDistribution,
    });
    onApply([bundle, ...updatedComponents]);
    setConfirmedMemberIds((prev) => {
      const next = new Set(prev);
      for (const id of active.itemIds) next.add(id);
      return next;
    });
    setDismissedIds((prev) => new Set(prev).add(active.id));
    const rest = visibleDrafts.filter((d) => d.id !== active.id);
    setActiveId(rest[0]?.id ?? null);
  };

  const orphanPool = useMemo(() => {
    if (!active) return [];
    const used = new Set(visibleDrafts.flatMap((d) => d.itemIds));
    for (const id of confirmedMemberIds) used.add(id);
    const dayKey = toLocalCalendarDateKey(active.sellDate) || active.sellDate.slice(0, 10);
    return items.filter((i) => {
      if (used.has(i.id)) return false;
      if (!isRealizedDisposal(i) || i.isBundle || i.isPC || i.parentContainerId) return false;
      const sell = Number(i.sellPrice);
      if (!Number.isFinite(sell) || Math.abs(sell - active.equalSellPrice) >= 0.005) return false;
      const d = toLocalCalendarDateKey(i.sellDate || '') || String(i.sellDate || '').slice(0, 10);
      return d === dayKey;
    });
  }, [active, visibleDrafts, confirmedMemberIds, items]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-4xl rounded-2xl sm:rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
        <header className="px-5 sm:px-7 py-4 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <Layers size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Historical equal-split sales
              </h2>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Same sell date + same sell price → likely an old PC/bundle split evenly. Pick Bundle or
                Gaming PC, edit parts/name, confirm — same rules as manual sold compose.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </header>

        {visibleDrafts.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Boxes size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="font-bold text-slate-700">No equal-split groups left</p>
            <p className="text-sm mt-1">All suggestions confirmed or skipped.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_1fr]">
            <aside className="border-b lg:border-b-0 lg:border-r border-slate-100 overflow-y-auto max-h-40 lg:max-h-none">
              <ul className="p-2 space-y-1">
                {visibleDrafts.map((d) => {
                  const selected = d.id === (active?.id ?? '');
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(d.id)}
                        className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
                          selected
                            ? 'bg-indigo-50 border border-indigo-200'
                            : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <p className="text-[11px] font-black text-slate-800 truncate">
                          {new Date(d.sellDate).toLocaleDateString()} · {d.itemIds.length} parts
                        </p>
                        <p className="text-[10px] text-slate-500 font-semibold tabular-nums">
                          €{formatEUR(d.equalSellPrice)} each · €
                          {formatEUR(d.equalSellPrice * d.itemIds.length)} total
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="flex flex-col min-h-0 overflow-hidden">
              {active && (
                <>
                  <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          {
                            id: 'bundle' as const,
                            label: 'Bundle / Aufrustkit',
                            icon: <Package size={16} />,
                          },
                          { id: 'pc' as const, label: 'Gaming PC', icon: <Monitor size={16} /> },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const parts = active.itemIds
                              .map((id) => byId.get(id))
                              .filter(Boolean) as InventoryItem[];
                            patchDraft(active.id, {
                              kind: opt.id,
                              name: active.nameTouched
                                ? active.name
                                : buildContainerTitle(opt.id, parts),
                            });
                          }}
                          className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-bold ${
                            active.kind === opt.id
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Name
                        </label>
                        {active.nameTouched && active.name !== autoName && (
                          <button
                            type="button"
                            className="text-[10px] font-bold text-indigo-600"
                            onClick={() =>
                              patchDraft(active.id, { nameTouched: false, name: autoName })
                            }
                          >
                            Reset to auto
                          </button>
                        )}
                      </div>
                      <input
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:border-indigo-500"
                        value={active.name}
                        onChange={(e) =>
                          patchDraft(active.id, { nameTouched: true, name: e.target.value })
                        }
                      />
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-emerald-300"
                        checked={active.useSmartDistribution}
                        onChange={(e) =>
                          patchDraft(active.id, { useSmartDistribution: e.target.checked })
                        }
                      />
                      <Sparkles size={13} />
                      Smart redistribute sell prices (recommended — undoes even split)
                    </label>

                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        Parts ({activeParts.length})
                      </p>
                      <ul className="space-y-1 max-h-56 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-1">
                        {activeParts.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white border border-slate-100"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-bold text-slate-800 truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-500 tabular-nums">
                                buy €{formatEUR(p.buyPrice || 0)} · sell €
                                {formatEUR(p.sellPrice || 0)}
                                {p.subCategory ? ` · ${p.subCategory}` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removePart(p.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Remove from this group"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {orphanPool.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                          Same day + price — add
                        </p>
                        <ul className="space-y-1 max-h-32 overflow-y-auto">
                          {orphanPool.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => addPart(p.id)}
                                className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50"
                              >
                                + {p.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <footer className="shrink-0 border-t border-slate-100 px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 bg-white">
                    <button
                      type="button"
                      onClick={dismissActive}
                      className="px-3 py-2.5 rounded-xl text-[12px] font-bold text-slate-500 hover:bg-slate-50"
                    >
                      Skip group
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      disabled={activeParts.length < 2}
                      onClick={confirmActive}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[12px] font-black hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Check size={16} />
                      Confirm as {active.kind === 'pc' ? 'Gaming PC' : 'Bundle'}
                    </button>
                  </footer>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SoldEqualSplitGroupsModal;
