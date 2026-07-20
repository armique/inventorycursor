import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, Check, Layers, Package, Monitor } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { buildContainerTitle } from '../utils/buildTitle';
import { isMixedBundleContainer } from '../utils/containerTaxonomy';
import { isInventoryContainer } from '../utils/containerMembership';
import ItemThumbnail from './ItemThumbnail';
import { itemMatchesBuilderSearch } from '../utils/builderSlotMatch';
import { todayLocalDateKey } from '../utils/calendarDate';

export type QuickBundleKind = 'bundle' | 'mixed' | 'pc';

interface Props {
  seed: InventoryItem;
  items: InventoryItem[];
  onClose: () => void;
  onApply: (updates: InventoryItem[]) => void;
}

type PartFilterPin = {
  id: string;
  label: string;
  category: string;
  subCategory?: string;
};

const PINS_STORAGE_KEY = 'deinventory:bundle-add-filter-pins';

const DEFAULT_PART_FILTER_PINS: PartFilterPin[] = [
  { id: 'cpu', label: 'CPU', category: 'Components', subCategory: 'Processors' },
  { id: 'gpu', label: 'GPU', category: 'Components', subCategory: 'Graphics Cards' },
  { id: 'mobo', label: 'Mobo', category: 'Components', subCategory: 'Motherboards' },
  { id: 'ram', label: 'RAM', category: 'Components', subCategory: 'RAM' },
  { id: 'ssd', label: 'SSD/HDD', category: 'Components', subCategory: 'Storage (SSD/HDD)' },
  { id: 'psu', label: 'PSU', category: 'Components', subCategory: 'Power Supplies' },
];

function loadPartFilterPins(): PartFilterPin[] {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    if (!raw) return DEFAULT_PART_FILTER_PINS;
    const parsed = JSON.parse(raw) as PartFilterPin[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PART_FILTER_PINS;
    return parsed.filter((p) => p?.id && p?.label && p?.category);
  } catch {
    return DEFAULT_PART_FILTER_PINS;
  }
}

function savePartFilterPins(pins: PartFilterPin[]) {
  try {
    localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* ignore */
  }
}

function pinId(category: string, subCategory?: string): string {
  return subCategory ? `${category}::${subCategory}` : `${category}::`;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultKind(seed: InventoryItem): QuickBundleKind {
  if (seed.isPC || seed.category === 'PC') return 'pc';
  if (isMixedBundleContainer(seed) || seed.isDefective) return 'mixed';
  if (seed.isBundle || seed.category === 'Bundle') return 'bundle';
  return 'bundle';
}

function itemMatchesPin(item: InventoryItem, pin: PartFilterPin): boolean {
  if (pin.subCategory) {
    return item.subCategory === pin.subCategory || item.category === pin.subCategory;
  }
  return item.category === pin.category;
}

/**
 * Flags-column “+” flow: pick Bundle / Mixed Bundle (or add to PC),
 * search any category in active inventory, attach parts.
 */
const QuickBundleAddModal: React.FC<Props> = ({ seed, items, onClose, onApply }) => {
  const seedIsPc = seed.isPC || seed.category === 'PC';
  const seedIsContainer = isInventoryContainer(seed);
  const [kind, setKind] = useState<QuickBundleKind>(() => defaultKind(seed));
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterPins, setFilterPins] = useState<PartFilterPin[]>(() => loadPartFilterPins());
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [showAddPin, setShowAddPin] = useState(false);
  const [newPinCategory, setNewPinCategory] = useState('Components');
  const [newPinSub, setNewPinSub] = useState('');
  const [newPinLabel, setNewPinLabel] = useState('');

  const discardAndClose = () => {
    setSelectedIds([]);
    setQuery('');
    setActivePinId(null);
    setShowAddPin(false);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        discardAndClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close handler intentionally stable for Escape
  }, [onClose]);

  useEffect(() => {
    savePartFilterPins(filterPins);
  }, [filterPins]);

  const alreadyInSeed = useMemo(() => {
    if (!seedIsContainer) return new Set<string>();
    const ids = new Set(seed.componentIds || []);
    for (const i of items) {
      if (i.parentContainerId === seed.id) ids.add(i.id);
    }
    return ids;
  }, [seed, seedIsContainer, items]);

  const baseEligible = useMemo(() => {
    const allowDefective = kind === 'mixed';
    const out: InventoryItem[] = [];
    for (const item of items) {
      if (item.id === seed.id) continue;
      if (item.isDraft) continue;
      if (item.isPC || item.isBundle || isInventoryContainer(item)) continue;
      if (item.parentContainerId && item.parentContainerId !== seed.id) continue;
      if (alreadyInSeed.has(item.id)) continue;
      if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) continue;
      if (!allowDefective && item.isDefective) continue;
      out.push(item);
    }
    return out;
  }, [items, seed.id, alreadyInSeed, kind]);

  const categoryOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of baseEligible) {
      const cat = item.category || 'Misc';
      if (!map.has(cat)) map.set(cat, new Set());
      if (item.subCategory) map.get(cat)!.add(item.subCategory);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, subs]) => ({
        category,
        subs: Array.from(subs).sort((a, b) => a.localeCompare(b)),
      }));
  }, [baseEligible]);

  const activePin = useMemo(
    () => filterPins.find((p) => p.id === activePinId) ?? null,
    [filterPins, activePinId]
  );

  const candidates = useMemo(() => {
    const q = query.trim();
    let list = baseEligible;
    if (activePin) {
      list = list.filter((item) => itemMatchesPin(item, activePin));
    }
    if (q) {
      list = list.filter((item) => itemMatchesBuilderSearch(item, q));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  }, [baseEligible, activePin, query]);

  const selectedItems = useMemo(
    () => selectedIds.map((id) => items.find((i) => i.id === id)).filter(Boolean) as InventoryItem[],
    [selectedIds, items]
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useEffect(() => {
    if (kind === 'mixed') return;
    setSelectedIds((prev) =>
      prev.filter((id) => {
        const it = items.find((i) => i.id === id);
        return it && !it.isDefective;
      })
    );
  }, [kind, items]);

  const removePin = (id: string) => {
    setFilterPins((prev) => prev.filter((p) => p.id !== id));
    if (activePinId === id) setActivePinId(null);
  };

  const addPin = () => {
    const category = newPinCategory.trim();
    if (!category) return;
    const sub = newPinSub.trim();
    const id = pinId(category, sub || undefined);
    if (filterPins.some((p) => p.id === id)) {
      setActivePinId(id);
      setShowAddPin(false);
      return;
    }
    const label = (newPinLabel.trim() || sub || category).slice(0, 24);
    const pin: PartFilterPin = {
      id,
      label,
      category,
      ...(sub ? { subCategory: sub } : {}),
    };
    setFilterPins((prev) => [...prev, pin]);
    setActivePinId(id);
    setShowAddPin(false);
    setNewPinSub('');
    setNewPinLabel('');
  };

  const handleConfirm = () => {
    if (selectedItems.length === 0) {
      alert('Select at least one item to add.');
      return;
    }

    if (kind !== 'mixed') {
      const defective = selectedItems.filter((i) => i.isDefective);
      if (defective.length || (!seedIsContainer && seed.isDefective && kind === 'bundle')) {
        alert(
          kind === 'pc'
            ? 'PC cannot include defective parts — switch to Mixed Bundle or deselect them.'
            : 'Bundle cannot include defective parts — switch to Mixed Bundle or deselect them.'
        );
        return;
      }
    }

    if (seedIsContainer) {
      const existingParts = items.filter(
        (i) =>
          (seed.componentIds || []).includes(i.id) || i.parentContainerId === seed.id
      );
      const allParts = [...existingParts];
      for (const p of selectedItems) {
        if (!allParts.some((x) => x.id === p.id)) allParts.push(p);
      }
      const buyTotal = roundMoney(allParts.reduce((s, i) => s + Number(i.buyPrice || 0), 0));
      const defectiveCount = allParts.filter((i) => i.isDefective).length;

      const preferAufrustkit = /aufrustkit/i.test(`${seed.name} ${seed.vendor || ''}`);
      const titleKind: 'pc' | 'bundle' | 'mixed' =
        seedIsPc || kind === 'pc' ? 'pc' : kind === 'mixed' ? 'mixed' : 'bundle';
      const autoTitle = buildContainerTitle(titleKind, allParts, { preferAufrustkit });

      let parent: InventoryItem = {
        ...seed,
        componentIds: allParts.map((p) => p.id),
        buyPrice: buyTotal,
        name: autoTitle,
        marketTitle: autoTitle,
      };

      if (seedIsPc || kind === 'pc') {
        parent = {
          ...parent,
          category: 'PC',
          isPC: true,
          isBundle: false,
          comment1: `PC Build (${allParts.length} parts).`,
          comment2: allParts
            .map((i) => `- ${i.name}`)
            .join('\n')
            .slice(0, 2000),
        };
        delete (parent as { subCategory?: string }).subCategory;
      } else {
        const isMixed = kind === 'mixed';
        parent = {
          ...parent,
          category: isMixed ? 'Mixed Bundle' : 'Bundle',
          isBundle: true,
          isPC: false,
          vendor: isMixed
            ? 'Mixed Bundle'
            : preferAufrustkit
              ? 'Aufrustkit'
              : 'PC Bundle',
          comment1: isMixed
            ? `Mixed Bundle (${allParts.length} items)${defectiveCount ? ` · ${defectiveCount} defekt` : ''}.`
            : `Bundle (${allParts.length} items).`,
          comment2: allParts
            .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
            .join('\n')
            .slice(0, 2000),
        };
        delete (parent as { subCategory?: string }).subCategory;
      }

      const updatedNew = selectedItems.map((comp) => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: seed.id,
      }));
      onApply([parent, ...updatedNew]);
      discardAndClose();
      return;
    }

    const createKind: 'bundle' | 'mixed' = kind === 'mixed' ? 'mixed' : 'bundle';
    const parts = [seed, ...selectedItems];
    const parentId = `bundle-quick-${Date.now()}`;
    const title = buildContainerTitle(createKind, parts);
    const buyTotal = roundMoney(parts.reduce((s, i) => s + Number(i.buyPrice || 0), 0));
    const defectiveCount = parts.filter((i) => i.isDefective).length;
    const isMixed = createKind === 'mixed';

    const parent: InventoryItem = {
      id: parentId,
      name: title,
      category: isMixed ? 'Mixed Bundle' : 'Bundle',
      status: ItemStatus.IN_STOCK,
      buyPrice: buyTotal,
      buyDate: todayLocalDateKey(),
      comment1: isMixed
        ? `Mixed Bundle (${parts.length} items)${defectiveCount ? ` · ${defectiveCount} defekt` : ''}.`
        : `Bundle (${parts.length} items).`,
      comment2: parts
        .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
        .join('\n')
        .slice(0, 2000),
      isPC: false,
      isBundle: true,
      componentIds: parts.map((p) => p.id),
      vendor: isMixed ? 'Mixed Bundle' : 'PC Bundle',
      marketTitle: title,
      imageUrl: seed.imageUrl || parts.find((p) => p.imageUrl)?.imageUrl,
      imageUrls: seed.imageUrls,
      presence: 'present',
    };

    const updatedParts = parts.map((comp) => ({
      ...comp,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: parentId,
    }));

    onApply([parent, ...updatedParts]);
    discardAndClose();
  };

  return (
    <div
      className="relative z-[45] mt-2 w-full max-w-xl rounded-xl border border-violet-200 bg-white shadow-lg shadow-violet-500/10 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Add parts to bundle"
    >
      <div className="px-3 py-2 border-b border-violet-100 bg-violet-50/80 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-black text-violet-950 tracking-tight uppercase">
            {seedIsPc
              ? 'Add parts to PC'
              : seedIsContainer
                ? 'Add parts to container'
                : 'Make Bundle / Mixed Bundle'}
          </h3>
          <p className="text-[10px] text-violet-800/70 font-medium truncate mt-0.5">
            Cancel discards selection and closes — stays in inventory
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            discardAndClose();
          }}
          className="relative z-10 shrink-0 p-1 rounded-md text-violet-400 hover:bg-violet-100 hover:text-violet-800"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {!seedIsPc && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setKind('bundle')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black border transition-colors ${
                kind === 'bundle'
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Layers size={11} /> Bundle
            </button>
            <button
              type="button"
              onClick={() => setKind('mixed')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black border transition-colors ${
                kind === 'mixed'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Package size={11} /> Mixed Bundle
            </button>
          </div>
        )}

        {seedIsPc && (
          <p className="text-[10px] text-indigo-700 font-bold bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 inline-flex items-center gap-1.5">
            <Monitor size={11} /> Adding into this PC build
          </p>
        )}

        {/* Quick category filter pills */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 shrink-0">
              Filters
            </span>
            <button
              type="button"
              onClick={() => {
                setActivePinId(null);
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                !activePinId
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All
            </button>
            {filterPins.map((pin) => {
              const active = activePinId === pin.id;
              return (
                <span
                  key={pin.id}
                  className={`inline-flex items-center rounded-full border overflow-hidden ${
                    active
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActivePinId(active ? null : pin.id)}
                    className="px-2.5 py-1 text-[10px] font-bold hover:opacity-90"
                    title={pin.subCategory ? `${pin.category} › ${pin.subCategory}` : pin.category}
                  >
                    {pin.label}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePin(pin.id);
                    }}
                    className={`px-1.5 py-1 border-l ${
                      active
                        ? 'border-violet-500/50 hover:bg-violet-700'
                        : 'border-slate-200 hover:bg-red-50 hover:text-red-600'
                    }`}
                    title="Remove filter"
                    aria-label={`Remove ${pin.label}`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setShowAddPin((v) => !v);
                if (categoryOptions[0]) {
                  setNewPinCategory(categoryOptions[0].category);
                  setNewPinSub('');
                  setNewPinLabel(categoryOptions[0].category);
                }
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
              title="Add filter pill"
              aria-label="Add filter"
            >
              <Plus size={14} />
            </button>
          </div>

          {showAddPin && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2 space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={newPinCategory}
                  onChange={(e) => {
                    setNewPinCategory(e.target.value);
                    setNewPinSub('');
                    setNewPinLabel(e.target.value);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold outline-none"
                >
                  {categoryOptions.length === 0 && <option value="Components">Components</option>}
                  {categoryOptions.map(({ category }) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <select
                  value={newPinSub}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewPinSub(v);
                    setNewPinLabel(v || newPinCategory);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold outline-none"
                >
                  <option value="">All subcategories</option>
                  {(categoryOptions.find((c) => c.category === newPinCategory)?.subs || []).map(
                    (sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={newPinLabel}
                  onChange={(e) => setNewPinLabel(e.target.value)}
                  placeholder="Pill label"
                  className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold outline-none"
                />
                <button
                  type="button"
                  onClick={addPin}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            className="w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-violet-400 focus:bg-white"
            placeholder={
              activePin
                ? `Search in ${activePin.label}…`
                : 'Search any category…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                discardAndClose();
              }
            }}
          />
        </div>

        {selectedItems.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                className="inline-flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-[9px] font-bold text-violet-900 max-w-full"
                title="Click to remove"
              >
                <ItemThumbnail item={item} className="w-3.5 h-3.5 rounded object-cover" size={14} />
                <span className="truncate max-w-[7rem]">{item.name}</span>
                <X size={9} className="shrink-0 opacity-60" />
              </button>
            ))}
          </div>
        )}

        <ul className="space-y-0.5 max-h-44 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-0.5">
          {candidates.length === 0 && (
            <li className="px-2 py-4 text-center text-[10px] font-bold text-slate-400">
              No matching active items
              {activePin ? ` in ${activePin.label}` : ''}
            </li>
          )}
          {candidates.map((item) => {
            const on = selectedIds.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                    on ? 'bg-violet-100/90 border border-violet-200' : 'hover:bg-white border border-transparent'
                  }`}
                >
                  <ItemThumbnail
                    item={item}
                    className="w-7 h-7 rounded object-cover border border-slate-100 shrink-0"
                    size={28}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-900 truncate">{item.name}</p>
                    <p className="text-[9px] text-slate-500 truncate">
                      {item.subCategory || item.category}
                      {item.isDefective ? ' · defekt' : ''}
                      {' · '}€{formatEUR(Number(item.buyPrice || 0))}
                    </p>
                  </div>
                  <span
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      on ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {on && <Check size={10} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-2 bg-white">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            discardAndClose();
          }}
          className="px-3 py-2 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selectedItems.length === 0}
          className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black disabled:opacity-40"
        >
          <Plus size={12} />
          {seedIsContainer
            ? `Add ${selectedItems.length || ''}`.trim()
            : `Create ${kind === 'mixed' ? 'Mixed Bundle' : 'Bundle'} (+${selectedItems.length})`}
        </button>
      </div>
    </div>
  );
};

export default QuickBundleAddModal;
