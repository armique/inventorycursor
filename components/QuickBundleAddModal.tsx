import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X, Check, Layers, Package } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { buildContainerTitle } from '../utils/buildTitle';
import { isMixedBundleContainer } from '../utils/containerTaxonomy';
import { isInventoryContainer } from '../utils/containerMembership';
import ItemThumbnail from './ItemThumbnail';
import { itemMatchesBuilderSearch } from '../utils/builderSlotMatch';

export type QuickBundleKind = 'bundle' | 'mixed';

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
  if (isMixedBundleContainer(seed) || seed.isDefective) return 'mixed';
  if (seed.isBundle || seed.category === 'Bundle') return 'bundle';
  return 'bundle';
}

/**
 * Flags-column “+” flow: pick Bundle / Mixed Bundle, search active inventory,
 * attach parts — creating a container or expanding an existing one.
 */
const QuickBundleAddModal: React.FC<Props> = ({ seed, items, onClose, onApply }) => {
  const seedIsContainer = isInventoryContainer(seed) && !seed.isPC;
  const [kind, setKind] = useState<QuickBundleKind>(() => defaultKind(seed));
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    for (const item of items) {
      if (item.id === seed.id) continue;
      if (item.isDraft) continue;
      if (item.isPC || item.isBundle || isInventoryContainer(item)) continue;
      if (item.parentContainerId && item.parentContainerId !== seed.id) continue;
      if (alreadyInSeed.has(item.id)) continue;
      if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) continue;
      if (kind === 'bundle' && item.isDefective) continue;
      if (q && !itemMatchesBuilderSearch(item, q)) continue;
      out.push(item);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 40);
  }, [items, seed.id, alreadyInSeed, kind, query]);

  const selectedItems = useMemo(
    () => selectedIds.map((id) => items.find((i) => i.id === id)).filter(Boolean) as InventoryItem[],
    [selectedIds, items]
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useEffect(() => {
    if (kind !== 'bundle') return;
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

    if (kind === 'bundle') {
      const defective = selectedItems.filter((i) => i.isDefective);
      if (defective.length || (!seedIsContainer && seed.isDefective)) {
        alert('Bundle cannot include defective parts — switch to Mixed Bundle or deselect them.');
        return;
      }
    }

    const isMixed = kind === 'mixed';

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
      const parent: InventoryItem = {
        ...seed,
        category: isMixed ? 'Mixed Bundle' : 'Bundle',
        isBundle: true,
        isPC: false,
        vendor: isMixed ? 'Mixed Bundle' : seed.vendor === 'Mixed Bundle' ? 'Bundle' : seed.vendor || 'Bundle',
        componentIds: allParts.map((p) => p.id),
        buyPrice: buyTotal,
        comment1: isMixed
          ? `Mixed Bundle (${allParts.length} items)${defectiveCount ? ` · ${defectiveCount} defekt` : ''}.`
          : `Bundle (${allParts.length} items).`,
        comment2: allParts
          .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
          .join('\n')
          .slice(0, 2000),
      };
      delete (parent as { subCategory?: string }).subCategory;

      const updatedNew = selectedItems.map((comp) => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: seed.id,
      }));
      onApply([parent, ...updatedNew]);
      onClose();
      return;
    }

    // Create new container; seed + selected become children
    const parts = [seed, ...selectedItems];
    const parentId = `bundle-quick-${Date.now()}`;
    const title = buildContainerTitle(kind, parts);
    const buyTotal = roundMoney(parts.reduce((s, i) => s + Number(i.buyPrice || 0), 0));
    const defectiveCount = parts.filter((i) => i.isDefective).length;

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

  const modal = (
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 tracking-tight">
              {seedIsContainer ? 'Add parts to container' : 'Make Bundle / Mixed Bundle'}
            </h3>
            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5" title={seed.name}>
              Seed: {seed.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Becomes</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setKind('bundle')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black border transition-colors ${
                  kind === 'bundle'
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Layers size={12} /> Bundle
              </button>
              <button
                type="button"
                onClick={() => setKind('mixed')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black border transition-colors ${
                  kind === 'mixed'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Package size={12} /> Mixed Bundle
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              {kind === 'bundle'
                ? 'No defective parts · slot-style Bundle.'
                : 'Defective parts allowed · flat Mixed Bundle.'}
            </p>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-violet-400 focus:bg-white"
              placeholder="Search active inventory…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-[10px] font-bold text-violet-900 max-w-full"
                  title="Click to remove"
                >
                  <ItemThumbnail item={item} className="w-4 h-4 rounded object-cover" size={16} />
                  <span className="truncate max-w-[9rem]">{item.name}</span>
                  <X size={10} className="shrink-0 opacity-60" />
                </button>
              ))}
            </div>
          )}

          <ul className="space-y-1 max-h-64 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-1">
            {candidates.length === 0 && (
              <li className="px-3 py-6 text-center text-xs font-bold text-slate-400">
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
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      on ? 'bg-violet-100/80 border border-violet-200' : 'hover:bg-white border border-transparent'
                    }`}
                  >
                    <ItemThumbnail item={item} className="w-8 h-8 rounded-md object-cover border border-slate-100 shrink-0" size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {item.subCategory || item.category}
                        {item.isDefective ? ' · defekt' : ''}
                        {' · '}€{formatEUR(Number(item.buyPrice || 0))}
                      </p>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                        on ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {on && <Check size={12} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedItems.length === 0}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black disabled:opacity-40"
          >
            <Plus size={14} />
            {seedIsContainer
              ? `Add ${selectedItems.length || ''}`.trim()
              : `Create ${kind === 'mixed' ? 'Mixed Bundle' : 'Bundle'} (+${selectedItems.length})`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default QuickBundleAddModal;
