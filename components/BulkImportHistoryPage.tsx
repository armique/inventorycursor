import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  History,
  Layers,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { BulkImportRecord, InventoryItem, ItemUpdateOptions } from '../types';
import { ItemStatus } from '../types';
import {
  appendBulkImportMember,
  bulkImportSourceLabel,
  chatProofFromBulkMembers,
  countBulkImportItems,
  getBulkImportMembers,
  removeBulkImportMember,
} from '../utils/bulkImportHistory';
import { applyBulkImportResplit } from '../utils/bulkImportEdit';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import { HIERARCHY_CATEGORIES } from '../services/constants';

interface Props {
  records: BulkImportRecord[];
  items: InventoryItem[];
  categories?: Record<string, string[]>;
  onUpdateItems: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
  onUpdateBulkImport: (record: BulkImportRecord) => void;
  onDeleteBulkImport: (importId: string) => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isViewableImageUrl(url: string): boolean {
  const s = (url || '').trim();
  return s.startsWith('data:image/') || /^https?:\/\//i.test(s);
}

const BulkImportHistoryPage: React.FC<Props> = ({
  records,
  items,
  categories = HIERARCHY_CATEGORIES,
  onUpdateItems,
  onUpdateBulkImport,
  onDeleteBulkImport,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [totalDraftById, setTotalDraftById] = useState<Record<string, string>>({});
  const [addingForId, setAddingForId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Components');
  const [newSubCategory, setNewSubCategory] = useState('Spare Parts');
  const [newManualCost, setNewManualCost] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const expandId = (location.state as { expandId?: string } | null)?.expandId;
    if (expandId) {
      setExpandedId(expandId);
      setTotalDraftById((prev) => {
        const rec = records.find((r) => r.id === expandId);
        if (!rec) return prev;
        return { ...prev, [expandId]: String(rec.totalCost ?? '') };
      });
    }
  }, [location.state, records]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const catKeys = Object.keys(categories);

  const sorted = useMemo(
    () =>
      [...records].sort(
        (a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
      ),
    [records]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => {
      const fromMembers = chatProofFromBulkMembers(r.itemIds, itemsById);
      const chatUrl = r.kleinanzeigenBuyChatUrl || fromMembers.kleinanzeigenBuyChatUrl || '';
      const hay = [r.label, r.source, r.buyDate, r.platformBought, r.id, chatUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, query, itemsById]);

  const recalc = (record: BulkImportRecord, totalOverride?: number) => {
    const raw =
      totalOverride ??
      parseLocaleNumber(totalDraftById[record.id] ?? String(record.totalCost));
    const total = Number.isFinite(raw) ? Math.max(0, raw) : record.totalCost;
    setBusyId(record.id);
    try {
      const { record: nextRecord, patchedItems } = applyBulkImportResplit({
        record,
        items,
        totalCost: total,
        mode: 'SMART',
      });
      if (patchedItems.length) {
        onUpdateItems(patchedItems, undefined, { flushCloud: true, skipActionLog: true });
      }
      onUpdateBulkImport(nextRecord);
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = (record: BulkImportRecord, itemId: string) => {
    const members = getBulkImportMembers(record, items).filter((m) => m.id !== itemId);
    const nextRecord = removeBulkImportMember(record, itemId, members);
    const item = itemsById.get(itemId);
    if (item) {
      // '' clears stamp; omitting the key would be restored by App merge preserve.
      onUpdateItems([{ ...item, bulkImportId: '' }], undefined, { flushCloud: true, skipActionLog: true });
    }
    onUpdateBulkImport(nextRecord);
    if (members.length > 0 && window.confirm('Re-split remaining items to the batch total?')) {
      recalc(nextRecord, nextRecord.totalCost);
    }
  };

  const addMember = (record: BulkImportRecord) => {
    const name = newName.trim();
    if (!name) return;
    const manual = newManualCost.trim() ? parseLocaleNumber(newManualCost) : undefined;
    const fallbackImage =
      CATEGORY_IMAGES[newSubCategory] ||
      CATEGORY_IMAGES[newCategory] ||
      CATEGORY_IMAGES.Components;
    const id = `bulk-${Date.now()}-extra`;
    const newItem: InventoryItem = {
      id,
      name,
      category: newCategory,
      subCategory: newSubCategory,
      buyPrice: Number.isFinite(manual) ? Number(manual) : 0,
      buyDate: record.buyDate || new Date().toISOString().split('T')[0],
      status: ItemStatus.IN_STOCK,
      vendor: 'Unknown',
      platformBought: record.platformBought,
      bulkImportId: record.id,
      imageUrl: fallbackImage,
      imageUrls: fallbackImage ? [fallbackImage] : [],
      comment1: '',
      comment2: `Bulk Import (added later). Source total: €${record.totalCost}.`,
      kleinanzeigenBuyChatUrl: record.kleinanzeigenBuyChatUrl,
      kleinanzeigenBuyChatImage: record.kleinanzeigenBuyChatImage,
      kleinanzeigenSellerProfileUrl: record.kleinanzeigenSellerProfileUrl,
    };

    const membersAfter = [...getBulkImportMembers(record, items), newItem];
    const nextRecord = appendBulkImportMember(record, newItem, membersAfter);
    onUpdateItems([newItem], undefined, { flushCloud: true });
    onUpdateBulkImport(nextRecord);

    const locked = new Set<string>();
    if (manual !== undefined && Number.isFinite(manual)) locked.add(id);
    const { record: afterSplit, patchedItems } = applyBulkImportResplit({
      record: nextRecord,
      items: [...items, newItem],
      totalCost: nextRecord.totalCost,
      mode: 'SMART',
      lockedItemIds: locked.size ? locked : undefined,
    });
    if (patchedItems.length) {
      onUpdateItems(patchedItems, undefined, { flushCloud: true, skipActionLog: true });
    }
    onUpdateBulkImport(afterSplit);

    setNewName('');
    setNewManualCost('');
    setAddingForId(null);
  };

  const deleteRecord = (record: BulkImportRecord) => {
    if (
      !window.confirm(
        `Remove “${record.label}” from bulk import history?\n\nInventory items stay — only the history link is removed.`
      )
    ) {
      return;
    }
    onDeleteBulkImport(record.id);
    if (expandedId === record.id) setExpandedId(null);
  };

  return (
    <div className="w-full min-w-0 -mx-2 sm:-mx-4 md:-mx-6 lg:-mx-8 px-2 sm:px-4 md:px-6 lg:px-8 pb-10 animate-in fade-in duration-300">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-slate-900 text-white shrink-0 shadow-lg shadow-slate-900/15">
            <Layers size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
              Bulk import history
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Expand a batch to edit total, add forgotten items, recalculate prices, or delete the
              history row.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/panel/add-bulk')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
        >
          <Package size={16} />
          New bulk entry
        </button>
      </header>

      <div className="mb-4 relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search label, source, date, chat URL…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <History size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-slate-500">
            {records.length === 0 ? 'No bulk imports yet' : 'No matches'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record) => {
            const counts = countBulkImportItems(record, itemsById);
            const members = getBulkImportMembers(record, items);
            const expanded = expandedId === record.id;
            const fromMembers = chatProofFromBulkMembers(record.itemIds, itemsById);
            const chatUrl = (
              record.kleinanzeigenBuyChatUrl ||
              fromMembers.kleinanzeigenBuyChatUrl ||
              ''
            ).trim();
            const chatImage = (
              record.kleinanzeigenBuyChatImage ||
              fromMembers.kleinanzeigenBuyChatImage ||
              ''
            ).trim();
            const showImage = isViewableImageUrl(chatImage);
            const totalDraft = totalDraftById[record.id] ?? String(record.totalCost ?? '');

            return (
              <div
                key={record.id}
                className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(expanded ? null : record.id);
                      setTotalDraftById((prev) => ({
                        ...prev,
                        [record.id]: String(record.totalCost ?? ''),
                      }));
                    }}
                    className="px-3 flex items-center text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                  >
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/panel/inventory?bulkImport=${encodeURIComponent(record.id)}`)
                    }
                    className="flex-1 text-left p-4 hover:bg-slate-50/80 transition-colors min-w-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 flex gap-3">
                        {showImage && (
                          <span className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                            <img
                              src={chatImage}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border bg-violet-50 text-violet-800 border-violet-200">
                              {bulkImportSourceLabel(record.source)}
                            </span>
                            <span className="text-xs font-semibold text-slate-400">
                              {formatWhen(record.createdAt)}
                            </span>
                            {(chatUrl || chatImage) && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase border bg-emerald-50 text-emerald-800 border-emerald-200">
                                <MessageCircle size={10} /> Proof
                              </span>
                            )}
                          </div>
                          <p className="font-bold text-slate-900 truncate">{record.label}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Buy date {record.buyDate || '—'}
                            {record.platformBought ? ` · ${record.platformBought}` : ''}
                            {record.bundleId ? ' · Bundle' : ''}
                            {` · ${members.length} children`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <p className="text-sm font-black text-slate-900">
                          €{formatEUR(record.totalCost)}
                        </p>
                        <p className="text-[11px] font-semibold text-slate-500">
                          {counts.inStock} in stock · {counts.sold} sold
                          {counts.missing > 0 ? ` · ${counts.missing} missing` : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-violet-100 bg-violet-50/40 px-4 py-3 space-y-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-500">
                          Purchase total €
                        </span>
                        <input
                          value={totalDraft}
                          onChange={(e) =>
                            setTotalDraftById((prev) => ({ ...prev, [record.id]: e.target.value }))
                          }
                          className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-bold"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busyId === record.id}
                        onClick={() => recalc(record)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 text-white text-[10px] font-black uppercase disabled:opacity-50"
                      >
                        <RefreshCw size={12} /> Recalculate prices
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingForId(addingForId === record.id ? null : record.id);
                          setNewCategory('Components');
                          setNewSubCategory(
                            (categories.Components && categories.Components[0]) || 'Spare Parts'
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-300 bg-white text-violet-900 text-[10px] font-black uppercase"
                      >
                        <Plus size={12} /> Add item
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/panel/inventory?bulkImport=${encodeURIComponent(record.id)}`
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase"
                      >
                        Open in inventory
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecord(record)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-[10px] font-black uppercase ml-auto"
                      >
                        <Trash2 size={12} /> Delete history
                      </button>
                    </div>

                    {addingForId === record.id && (
                      <div className="rounded-xl border border-violet-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <label className="sm:col-span-2 space-y-1">
                          <span className="text-[10px] font-black uppercase text-slate-500">Name</span>
                          <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border text-sm font-bold"
                            placeholder="Forgotten item…"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase text-slate-500">
                            Category
                          </span>
                          <select
                            value={newCategory}
                            onChange={(e) => {
                              setNewCategory(e.target.value);
                              const subs = categories[e.target.value] || [];
                              setNewSubCategory(subs[0] || 'Spare Parts');
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border text-sm font-bold"
                          >
                            {catKeys.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase text-slate-500">
                            Sub
                          </span>
                          <select
                            value={newSubCategory}
                            onChange={(e) => setNewSubCategory(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border text-sm font-bold"
                          >
                            {(categories[newCategory] || ['Spare Parts']).map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase text-slate-500">
                            Manual € (optional)
                          </span>
                          <input
                            value={newManualCost}
                            onChange={(e) => setNewManualCost(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border text-sm font-bold"
                            placeholder="Lock price"
                          />
                        </label>
                        <div className="sm:col-span-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => addMember(record)}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase"
                          >
                            Add &amp; re-split
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingForId(null)}
                            className="px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase text-slate-600"
                          >
                            <X size={12} className="inline" /> Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                        <Layers size={14} className="text-violet-700" />
                        <span className="text-[10px] font-black uppercase text-slate-600">
                          Parent batch · {members.length} children
                        </span>
                      </div>
                      {members.length === 0 ? (
                        <p className="px-3 py-4 text-xs text-slate-400">No live members found.</p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {members.map((m) => (
                            <li
                              key={m.id}
                              className="flex items-center gap-2 px-3 py-2 pl-6 border-l-4 border-violet-300"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-900 truncate">{m.name}</p>
                                <p className="text-[11px] text-slate-500">
                                  {m.status}
                                  {m.subCategory || m.category
                                    ? ` · ${m.subCategory || m.category}`
                                    : ''}
                                </p>
                              </div>
                              <span className="text-sm font-black tabular-nums text-slate-900">
                                €{formatEUR(m.buyPrice)}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeMember(record, m.id)}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200"
                                title="Remove from batch (keeps inventory item)"
                              >
                                <X size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {chatUrl && (
                      <a
                        href={chatUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-700 hover:underline"
                      >
                        <ExternalLink size={12} /> Chat URL
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BulkImportHistoryPage;
