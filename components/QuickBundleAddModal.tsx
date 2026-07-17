import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, Check, Layers, Package, Monitor } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { buildContainerTitle } from '../utils/buildTitle';
import { isMixedBundleContainer } from '../utils/containerTaxonomy';
import { isInventoryContainer } from '../utils/containerMembership';
import ItemThumbnail from './ItemThumbnail';
import { itemMatchesBuilderSearch } from '../utils/builderSlotMatch';

export type QuickBundleKind = 'bundle' | 'mixed' | 'pc';

interface Props {
  seed: InventoryItem;
  items: InventoryItem[];
  onClose: () => void;
  onApply: (updates: InventoryItem[]) => void;
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedIds.length > 0) {
        if (!window.confirm('Discard selected parts and close?')) return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selectedIds.length]);

  const alreadyInSeed = useMemo(() => {
    if (!seedIsContainer) return new Set<string>();
    const ids = new Set(seed.componentIds || []);
    for (const i of items) {
      if (i.parentContainerId === seed.id) ids.add(i.id);
    }
    return ids;
  }, [seed, seedIsContainer, items]);

  const candidates = useMemo(() => {
    const q = query.trim();
    const out: InventoryItem[] = [];
    const allowDefective = kind === 'mixed';
    for (const item of items) {
      if (item.id === seed.id) continue;
      if (item.isDraft) continue;
      if (item.isPC || item.isBundle || isInventoryContainer(item)) continue;
      if (item.parentContainerId && item.parentContainerId !== seed.id) continue;
      if (alreadyInSeed.has(item.id)) continue;
      if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) continue;
      if (!allowDefective && item.isDefective) continue;
      if (q && !itemMatchesBuilderSearch(item, q)) continue;
      out.push(item);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 60);
  }, [items, seed.id, alreadyInSeed, kind, query]);

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

    // Add into existing PC / Bundle / Mixed
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

      let parent: InventoryItem = {
        ...seed,
        componentIds: allParts.map((p) => p.id),
        buyPrice: buyTotal,
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
          vendor: isMixed ? 'Mixed Bundle' : seed.vendor === 'Mixed Bundle' ? 'Bundle' : seed.vendor || 'Bundle',
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
      onClose();
      return;
    }

    // Create new Bundle / Mixed from any category seed
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
      buyDate: '',
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
      vendor: isMixed ? 'Mixed Bundle' : 'Bundle',
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
    onClose();
  };

  const requestClose = () => {
    if (selectedIds.length > 0) {
      if (!window.confirm('Discard selected parts and close?')) return;
    }
    onClose();
  };

  /** Inline panel under the asset name — no backdrop; does not close on outside click. */
  return (
    <div
      className="mt-2 w-full max-w-xl rounded-xl border border-violet-200 bg-white shadow-lg shadow-violet-500/10 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
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
            Stays open until Cancel / Add — click outside won&apos;t close it
          </p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          className="p-1 rounded-md text-violet-400 hover:bg-violet-100 hover:text-violet-800"
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

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            className="w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-violet-400 focus:bg-white"
            placeholder="Search any category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                requestClose();
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
                  <ItemThumbnail item={item} className="w-7 h-7 rounded object-cover border border-slate-100 shrink-0" size={28} />
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
          onClick={requestClose}
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
