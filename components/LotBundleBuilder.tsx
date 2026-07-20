import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Package, Plus, Save, Search, Trash2, X, AlertTriangle } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import ItemThumbnail, { getCategoryImageUrl } from './ItemThumbnail';
import BuildItemPhotosPanel from './BuildItemPhotosPanel';
import ListingKitModal from './ListingKitModal';
import { getItemUserPhotoUrls, prepareInventoryImagesForStorage } from '../utils/imageImport';
import {
  getBuilderPickerBlockReason,
  isEligibleForBuilderPicker,
  itemMatchesBuilderSearch,
} from '../utils/builderSlotMatch';
import { buildContainerTitle } from '../utils/buildTitle';
import { todayLocalDateKey } from '../utils/calendarDate';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
}

/**
 * Mixed Bundle screen (formerly Lot Bundle) — flat part bag, no PC slots.
 * Defective parts are allowed (unlike PC / Bundle).
 */
const LotBundleBuilder: React.FC<Props> = ({ items, onSave }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('editId');
  const editingContainer = editId ? items.find((i) => i.id === editId) : undefined;

  const photoItemIdRef = useRef(editId || `bundle-lot-draft-${Date.now()}`);
  const [bundleName, setBundleName] = useState('Mixed Bundle');
  const [selected, setSelected] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const [listingDraft, setListingDraft] = useState<{
    parent: InventoryItem;
    parts: InventoryItem[];
  } | null>(null);

  useEffect(() => {
    if (editId && editingContainer) {
      setBundleName(editingContainer.name);
      setNameTouched(true);
      const components = items.filter(
        (i) =>
          (editingContainer.componentIds && editingContainer.componentIds.includes(i.id)) ||
          i.parentContainerId === editingContainer.id
      );
      setSelected(components);
      setPhotos(getItemUserPhotoUrls(editingContainer));
      return;
    }
    const initial: InventoryItem[] | undefined = location.state?.initialParts;
    if (initial?.length) {
      setSelected(initial);
      setBundleName(buildContainerTitle('mixed', initial));
    }
  }, [editId, editingContainer, items, location.state]);

  useEffect(() => {
    if (editId || nameTouched) return;
    if (!selected.length) {
      setBundleName('Mixed Bundle');
      return;
    }
    setBundleName(buildContainerTitle('mixed', selected));
  }, [selected, editId, nameTouched]);

  const containersById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const i of items) {
      if (i.isBundle || i.isPC) map.set(i.id, i);
    }
    return map;
  }, [items]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const picker = useMemo(() => {
    const available: InventoryItem[] = [];
    const blocked: { item: InventoryItem; reason: string }[] = [];
    for (const item of items) {
      if (selectedIds.has(item.id)) continue;
      if (!itemMatchesBuilderSearch(item, searchQuery)) continue;
      if (item.isPC || item.isBundle) continue;

      const blockReason = getBuilderPickerBlockReason(item, {
        editId,
        bundleMode: true,
        isLotBundle: true,
        containersById,
      });
      if (blockReason) {
        blocked.push({ item, reason: blockReason });
        continue;
      }
      if (!isEligibleForBuilderPicker(item, { editId, bundleMode: true, isLotBundle: true })) {
        continue;
      }
      available.push(item);
    }
    return { available, blocked };
  }, [items, searchQuery, selectedIds, editId, containersById]);

  const total = useMemo(
    () => selected.reduce((sum, i) => sum + Number(i.buyPrice || 0), 0),
    [selected]
  );
  const defectiveCount = selected.filter((i) => i.isDefective).length;

  const addItem = (item: InventoryItem) => {
    setSelected((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item]));
  };
  const removeItem = (id: string) => {
    setSelected((prev) => prev.filter((i) => i.id !== id));
  };

  const finalizeSave = useCallback(
    async (parentOverride?: InventoryItem) => {
      if (!bundleName.trim()) return alert('Enter a lot name.');
      if (selected.length === 0) return alert('Add at least one part.');

      const parentId = editId || `bundle-lot-${Date.now()}`;
      let userPhotos = photos.length ? photos : getItemUserPhotoUrls(editingContainer || {});
      if (userPhotos.length) {
        try {
          userPhotos = await prepareInventoryImagesForStorage(userPhotos, { itemId: parentId });
        } catch {
          /* keep */
        }
      }

      const title = bundleName.trim() || buildContainerTitle('mixed', selected);
      const baseParent: InventoryItem = {
        ...(editingContainer || {}),
        id: parentId,
        name: title,
        category: 'Mixed Bundle',
        status: ItemStatus.IN_STOCK,
        buyPrice: Math.round(total * 100) / 100,
        buyDate: editingContainer?.buyDate || todayLocalDateKey(),
        isPC: false,
        isBundle: true,
        componentIds: selected.map((i) => i.id),
        comment1: `Mixed Bundle (${selected.length} items)${defectiveCount ? ` · ${defectiveCount} defekt` : ''}.`,
        comment2: selected
          .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
          .join('\n')
          .slice(0, 2000),
        vendor: 'Mixed Bundle',
        marketTitle: title,
        imageUrl: userPhotos[0] || selected[0]?.imageUrl || getCategoryImageUrl({ category: 'Components' }) || undefined,
        imageUrls: userPhotos.length ? userPhotos : undefined,
      };

      const parentItem = parentOverride
        ? { ...baseParent, ...parentOverride, id: parentId, componentIds: baseParent.componentIds }
        : baseParent;

      const updatedComponents = selected.map((comp) => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: parentId,
      }));

      let removedComponents: InventoryItem[] = [];
      if (editId) {
        const previous = items.filter((i) => i.parentContainerId === editId);
        const currentIds = new Set(selected.map((i) => i.id));
        removedComponents = previous
          .filter((i) => !currentIds.has(i.id))
          .map((i) => ({
            ...i,
            status: ItemStatus.IN_STOCK,
            parentContainerId: undefined,
          }));
      }

      onSave([parentItem, ...updatedComponents, ...removedComponents]);
      navigate('/panel/inventory');
    },
    [
      bundleName,
      selected,
      editId,
      photos,
      editingContainer,
      total,
      defectiveCount,
      items,
      onSave,
      navigate,
    ]
  );

  const handleSave = async () => {
    if (!bundleName.trim()) return alert('Enter a lot name.');
    if (selected.length === 0) return alert('Add at least one part.');

    const parentId = editId || `bundle-lot-${Date.now()}`;
    const title = bundleName.trim() || buildContainerTitle('mixed', selected);
    const draftParent: InventoryItem = {
      ...(editingContainer || {}),
      id: parentId,
      name: title,
      category: 'Mixed Bundle',
      status: ItemStatus.IN_STOCK,
      buyPrice: Math.round(total * 100) / 100,
      buyDate: editingContainer?.buyDate || todayLocalDateKey(),
      comment1: '',
      comment2: '',
      isPC: false,
      isBundle: true,
      componentIds: selected.map((i) => i.id),
      marketTitle: title,
      imageUrl: photos[0] || selected[0]?.imageUrl,
      imageUrls: photos.length ? photos : undefined,
    };
    setListingDraft({ parent: draftParent, parts: selected });
  };

  return (
    <div className="w-full h-[calc(100vh-88px)] flex flex-col animate-in fade-in px-4 pb-4">
      <header className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 mb-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Package size={22} className="text-amber-600" />
                {editId ? 'Edit Mixed Bundle' : 'Mixed Bundle'}
              </h1>
              <p className="text-sm text-slate-500 font-bold">
                Any parts & qty · no slots · defective allowed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-5 py-2 rounded-2xl bg-slate-900 text-white text-right">
              <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
              <p className="text-xl font-black">€{formatEUR(total)}</p>
            </div>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-700"
            >
              <Save size={16} /> Save Lot
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
        <div className="w-[340px] flex flex-col gap-3 shrink-0 overflow-y-auto">
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Mixed name</label>
            <input
              className="w-full mt-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-base outline-none"
              value={bundleName}
              onChange={(e) => {
                setNameTouched(true);
                setBundleName(e.target.value);
              }}
            />
            <p className="text-[10px] text-slate-400 font-bold mt-1">Auto title ≤65 chars (eBay / Kleinanzeigen)</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex gap-2 text-[11px] font-bold text-amber-900">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            Defective parts allowed here. PC and Bundle builds block them.
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex-1 min-h-0 flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                In lot ({selected.length})
              </p>
              {defectiveCount > 0 && (
                <span className="text-[9px] font-black uppercase bg-red-100 text-red-700 px-2 py-0.5 rounded">
                  {defectiveCount} defekt
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {selected.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold text-center py-8">Add parts from the list →</p>
              ) : (
                selected.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-2 rounded-xl border border-slate-100 bg-slate-50"
                  >
                    <ItemThumbnail item={item} className="w-10 h-10 rounded-lg shrink-0" size={40} useCategoryImage />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{item.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">
                        {item.isDefective ? 'Defekt · ' : ''}€{formatEUR(Number(item.buyPrice))}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <BuildItemPhotosPanel
            name={bundleName}
            photos={photos}
            onChange={setPhotos}
            itemId={photoItemIdRef.current}
          />
        </div>

        <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none"
                placeholder="Search stock to add…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {picker.available.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-100 hover:border-amber-300 hover:bg-amber-50/40 text-left"
              >
                <ItemThumbnail item={item} className="w-12 h-12 rounded-lg shrink-0" size={48} useCategoryImage />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-slate-900 truncate">{item.name}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">
                    {item.subCategory || item.category}
                    {item.isDefective ? ' · Defekt' : ''} · €{formatEUR(Number(item.buyPrice))}
                  </p>
                </div>
                <Plus size={18} className="text-amber-600 shrink-0" />
              </button>
            ))}
            {picker.blocked.length > 0 && (
              <div className="pt-3 mt-2 border-t border-slate-200 space-y-2">
                <p className="text-[10px] font-black uppercase text-amber-700">Cannot add</p>
                {picker.blocked.slice(0, 12).map(({ item, reason }) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-2xl border border-amber-200/80 bg-amber-50/50 opacity-80"
                  >
                    <ItemThumbnail item={item} className="w-10 h-10 rounded-lg grayscale shrink-0" size={40} useCategoryImage />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800 truncate">{item.name}</p>
                      <p className="text-[10px] font-bold text-amber-900 mt-0.5">{reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {picker.available.length === 0 && picker.blocked.length === 0 && (
              <div className="text-center py-16 opacity-40">
                <X size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-bold text-slate-400">No matching stock</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {listingDraft && (
        <ListingKitModal
          parent={listingDraft.parent}
          parts={listingDraft.parts}
          onSkip={() => {
            setListingDraft(null);
            void finalizeSave();
          }}
          onApply={(updated) => {
            setListingDraft(null);
            void finalizeSave(updated);
          }}
        />
      )}
    </div>
  );
};

export default LotBundleBuilder;
