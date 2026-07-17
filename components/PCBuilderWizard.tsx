import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { formatEUR } from '../utils/formatMoney';

import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { 
  Cpu, Monitor, HardDrive, Zap, Box, Wind, 
  Save, ArrowLeft, Plus, X, Search, CheckCircle2,
  AlertTriangle, Hammer, Info, Lock
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { estimatePCPerformance, PerformanceEstimate } from '../services/geminiService';
import ItemThumbnail, { getCategoryImageUrl } from './ItemThumbnail';
import { isCompatibleWithBuild } from '../services/compatibility';
import BuildItemPhotosPanel from './BuildItemPhotosPanel';
import ListingKitModal from './ListingKitModal';
import { getItemUserPhotoUrls, prepareInventoryImagesForStorage } from '../utils/imageImport';
import {
  findBuilderSlotForComponent,
  getBuilderPickerBlockReason,
  isEligibleForBuilderPicker,
  itemMatchesBuilderSearch,
  itemRelevantToBuilderSlot,
} from '../utils/builderSlotMatch';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
}

const SLOTS = [
  { id: 'CPU', label: 'Processor', category: 'Processors', icon: <Cpu size={20}/>, required: true },
  { id: 'GPU', label: 'Graphics Card', category: 'Graphics Cards', icon: <Monitor size={20}/>, required: true },
  { id: 'MOBO', label: 'Motherboard', category: 'Motherboards', icon: <Box size={20}/>, required: true },
  /** Multiple sticks/modules (e.g. 2×16GB). Compatibility still follows motherboard/CPU (e.g. DDR5 board → DDR5 only). */
  { id: 'RAM', label: 'Memory (RAM)', category: 'RAM', icon: <Box size={20}/>, required: true, multiple: true },
  /** Multiple drives (e.g. NVMe + SATA, or two HDDs). */
  { id: 'STORAGE', label: 'Storage', category: 'Storage (SSD/HDD)', icon: <HardDrive size={20}/>, required: true, multiple: true },
  { id: 'PSU', label: 'Power Supply', category: 'Power Supplies', icon: <Zap size={20}/>, required: true },
  { id: 'CASE', label: 'Case', category: 'Cases', icon: <Box size={20}/>, required: true },
  { id: 'COOLING', label: 'CPU Cooler', category: 'Cooling', icon: <Wind size={20}/>, required: false },
  { id: 'FANS', label: 'Case Fans', category: 'Fans', icon: <Wind size={20}/>, required: false, multiple: true },
  { id: 'MISC', label: 'Accessories', category: 'Misc', icon: <Plus size={20}/>, required: false, multiple: true },
];

/** PC builds: only RAM / Storage / Fans / Misc allow multiple. */
function slotAllowsMultiple(slot: (typeof SLOTS)[number]): boolean {
  return Boolean(slot.multiple);
}

const MAX_NAME_LENGTH = 52;

/** Shorten a part name for the build/bundle title. */
function shortPartName(name: string, slotId: string): string {
  const n = (name || '').trim();
  if (!n) return '';
  if (slotId === 'CPU') {
    const withoutBrand = n.replace(/^(AMD|Intel)\s+/i, '').trim();
    return withoutBrand.slice(0, 18).trim();
  }
  if (slotId === 'GPU') {
    const match = n.match(/(RTX|GTX|RX)\s*\d+\s*\w*/i) || n.match(/\d{4}\s*(XT|Gaming|OC)?/i);
    if (match) return match[0].trim().slice(0, 14);
    return n.replace(/^(MSI|ASUS|Gigabyte|EVGA|Sapphire|XFX|PowerColor)\s+/i, '').trim().slice(0, 14);
  }
  if (slotId === 'RAM') {
    const match = n.match(/\d+\s*GB\s*(DDR\d*)?/i);
    return (match ? match[0] : n.slice(0, 12)).trim();
  }
  if (slotId === 'STORAGE') {
    const match = n.match(/\d+\s*(TB|GB)\s*(NVMe|SSD|HDD)?/i);
    return (match ? match[0] : n.slice(0, 12)).trim();
  }
  if (slotId === 'MOBO') {
    // Try to keep chipset + short model, e.g. "B550 Tomahawk"
    const match = n.match(/(B\d{3}|Z\d{3}|H\d{3}|X\d{3}|A\d{3}|B550|B450|X570|Z690|Z790)[^,]*/i);
    if (match) return match[0].trim().slice(0, 20);
    return n.replace(/^(MSI|ASUS|Gigabyte|ASRock|NZXT)\s+/i, '').trim().slice(0, 20);
  }
  return n.slice(0, 14).trim();
}

/** Generate a concise build/bundle name from key parts. */
function joinMultiShortNames(items: InventoryItem[] | undefined, slotId: string, label: string): string {
  if (!items?.length) return '';
  if (items.length === 1) return shortPartName(items[0].name, slotId);
  const bits = items.map((i) => shortPartName(i.name, slotId)).filter(Boolean);
  if (bits.length <= 2) return bits.join(' + ');
  return `${items.length}× ${label}`;
}

function getBuildNameFromParts(parts: Record<string, InventoryItem[]>): string {
  const cpu = parts.CPU?.[0];
  const gpu = parts.GPU?.[0];
  const mobo = parts.MOBO?.[0];
  const ram = parts.RAM;
  const storage = parts.STORAGE;
  const segments: string[] = [];
  if (cpu) segments.push(shortPartName(cpu.name, 'CPU'));
  if (mobo) segments.push(shortPartName(mobo.name, 'MOBO'));
  if (gpu) segments.push(shortPartName(gpu.name, 'GPU'));
  if (ram?.length) segments.push(joinMultiShortNames(ram, 'RAM', 'RAM'));
  if (storage?.length) segments.push(joinMultiShortNames(storage, 'STORAGE', 'Storage'));
  if (segments.length === 0) return 'New Gaming PC';
  const name = segments.join(' · ');
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 2) + '…' : name;
}

const PCBuilderWizard: React.FC<Props> = ({ items, onSave }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('editId');
  const editingContainer = editId ? items.find((i) => i.id === editId) : undefined;
  const photoItemIdRef = useRef(editId || `pc-draft-${Date.now()}`);
  const photoStorageItemId = editId || photoItemIdRef.current;

  /** PC Builder screen only — lot/bundle edits go through LotBundleBuilder via BuilderEntry. */
  const resolvedMode = 'pc' as const;
  const isLotBundle = false;
  const [buildName, setBuildName] = useState('New Gaming PC');
  const [parts, setParts] = useState<Record<string, InventoryItem[]>>({});
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [buildPhotos, setBuildPhotos] = useState<string[]>([]);
  const [showIncompatible, setShowIncompatible] = useState(true);
  const [listingDraft, setListingDraft] = useState<{
    parent: InventoryItem;
    parts: InventoryItem[];
  } | null>(null);
  
  const isCompactEdit = Boolean(editId);
  const [performance, setPerformance] = useState<PerformanceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  /** User typed a custom name — don't overwrite when parts change (PC builder only). */
  const userEditedNameRef = useRef(false);

  // Initialize
  useEffect(() => {
    if (editId) {
      const pc = items.find(i => i.id === editId);
      if (pc) {
        setBuildName(pc.name);
        const existingParts: Record<string, InventoryItem[]> = {};
        
        // Find components linked to this PC
        const components = items.filter(i => 
          (pc.componentIds && pc.componentIds.includes(i.id)) || 
          i.parentContainerId === pc.id
        );

        components.forEach(comp => {
           const slot = findBuilderSlotForComponent(comp, SLOTS);
           if (slot) {
              if (!existingParts[slot.id]) existingParts[slot.id] = [];
              existingParts[slot.id].push(comp);
           } else {
              if (!existingParts['MISC']) existingParts['MISC'] = [];
              existingParts['MISC'].push(comp);
           }
        });
        setParts(existingParts);
        setBuildPhotos(getItemUserPhotoUrls(pc));
      }
    } else if (location.state?.initialParts) {
       // Similar logic for initial selection
       const initial: InventoryItem[] = location.state.initialParts;
       const newParts: Record<string, InventoryItem[]> = {};
       initial.forEach(comp => {
           const slot = findBuilderSlotForComponent(comp, SLOTS);
           if (slot) {
              if (!newParts[slot.id]) newParts[slot.id] = [];
              newParts[slot.id].push(comp);
           } else {
              if (!newParts['MISC']) newParts['MISC'] = [];
              newParts['MISC'].push(comp);
           }
       });
       setParts(newParts);
    }
  }, [editId, location.state, items]);

  // Auto-name from parts for new PC builds only
  useEffect(() => {
    if (editId || userEditedNameRef.current) return;
    setBuildName(getBuildNameFromParts(parts));
  }, [parts, editId]);

  const handleRunEstimate = async () => {
     const allParts = Object.values(parts).flat() as InventoryItem[];
     const componentNames = allParts.map(i => i.name);
     if (componentNames.length < 3) return alert("Add more components first.");
     
     setEstimating(true);
     try {
        const result = await estimatePCPerformance(componentNames);
        setPerformance(result);
     } catch (e) {
        console.error(e);
     } finally {
        setEstimating(false);
     }
  };

  const buildParentDraft = (allParts: InventoryItem[], userPhotos: string[]): InventoryItem => {
     const existingParent = editId ? items.find((i) => i.id === editId) : undefined;
     const totalCost = allParts.reduce((sum, i) => sum + i.buyPrice, 0);
     const parentId = editId || `pc-${Date.now()}`;
     const autoImageUrl =
       parts['CASE']?.[0]?.imageUrl || getCategoryImageUrl({ category: 'Cases' }) || undefined;
     const imageUrl = userPhotos[0] || autoImageUrl || existingParent?.imageUrl;
     const imageUrls = userPhotos.length ? userPhotos : existingParent?.imageUrls;
     return {
        ...(existingParent || {}),
        id: parentId,
        name: buildName,
        category: 'PC',
        subCategory: 'Custom Built PC',
        status: ItemStatus.IN_STOCK,
        buyPrice: totalCost,
        buyDate: existingParent?.buyDate || '',
        isPC: true,
        isBundle: false,
        componentIds: allParts.map((i) => i.id),
        comment1: `Custom Build Specs:\n${allParts.map((i) => `- ${i.name}`).join('\n')}`,
        comment2: performance ? `AI Performance Estimate:\n${performance.summary}` : '',
        vendor: 'Custom Build',
        imageUrl,
        imageUrls: imageUrls?.length ? imageUrls : undefined,
     };
  };

  const commitPcSave = async (parentOverride?: InventoryItem) => {
     const allParts = Object.values(parts).flat() as InventoryItem[];
     const existingParent = editId ? items.find((i) => i.id === editId) : undefined;
     const parentId = parentOverride?.id || editId || `pc-${Date.now()}`;

     let userPhotos = buildPhotos.length > 0 ? buildPhotos : getItemUserPhotoUrls(existingParent || {});
     if (userPhotos.length) {
       try {
         userPhotos = await prepareInventoryImagesForStorage(userPhotos, { itemId: parentId });
       } catch {
         /* keep existing URLs */
       }
     }

     const parentItem = parentOverride
       ? {
           ...buildParentDraft(allParts, userPhotos),
           ...parentOverride,
           id: parentId,
           componentIds: allParts.map((i) => i.id),
           isPC: true,
           isBundle: false,
           category: 'PC',
           subCategory: 'Custom Built PC',
         }
       : buildParentDraft(allParts, userPhotos);

     const updatedComponents = allParts.map((comp) => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: parentItem.id,
     }));

     let removedComponents: InventoryItem[] = [];
     if (editId) {
        const previousComponents = items.filter((i) => i.parentContainerId === editId);
        const currentIds = new Set(allParts.map((i) => i.id));
        removedComponents = previousComponents
           .filter((i) => !currentIds.has(i.id))
           .map((i) => ({
              ...i,
              status: ItemStatus.IN_STOCK,
              parentContainerId: undefined,
           } as InventoryItem));
     }

     onSave([parentItem, ...updatedComponents, ...removedComponents]);
     navigate('/panel/inventory');
  };

  const handleSave = async () => {
     if (!buildName) return alert('Enter a name for the build.');

     const allParts = Object.values(parts).flat() as InventoryItem[];
     if (allParts.length === 0) return alert('Build is empty.');

     const defective = allParts.filter((p) => p.isDefective);
     if (defective.length > 0) {
       return alert(
         `PC builds cannot include defective parts (${defective.length}). Remove them or use Compose → Lot Bundle.`
       );
     }

     const existingParent = editId ? items.find((i) => i.id === editId) : undefined;
     let userPhotos = buildPhotos.length > 0 ? buildPhotos : getItemUserPhotoUrls(existingParent || {});
     const draft = buildParentDraft(allParts, userPhotos);
     setListingDraft({ parent: draft, parts: allParts });
  };

  const containersById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const i of items) {
      if (i.isBundle || i.isPC) map.set(i.id, i);
    }
    return map;
  }, [items]);

  const pickerResults = useMemo(() => {
    if (!selectedSlot) return { available: [] as InventoryItem[], blocked: [] as { item: InventoryItem; reason: string }[] };
    const slotDef = SLOTS.find((s) => s.id === selectedSlot);
    if (!slotDef) return { available: [], blocked: [] };

    const bundleMode = false;
    const searching = searchQuery.trim().length > 0;
    const available: InventoryItem[] = [];
    const blocked: { item: InventoryItem; reason: string }[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      if ((item.category === 'Bundle' && item.subCategory === 'PC Bundle') || item.category === 'PC Bundle') {
        continue;
      }

      if (!itemMatchesBuilderSearch(item, searchQuery)) continue;

      const relevant = itemRelevantToBuilderSlot(item, slotDef, {
        bundleMode,
        isLotBundle,
        searching,
        assignedInSlot: parts[selectedSlot],
        slotId: selectedSlot,
      });
      if (!relevant) continue;

      const blockReason = getBuilderPickerBlockReason(item, { editId, bundleMode, isLotBundle, containersById });
      if (blockReason) {
        if (!seen.has(item.id)) {
          blocked.push({ item, reason: blockReason });
          seen.add(item.id);
        }
        continue;
      }

      if (!isEligibleForBuilderPicker(item, { editId, bundleMode, isLotBundle })) {
        if (!seen.has(item.id)) {
          blocked.push({ item, reason: getBuilderPickerBlockReason(item, { editId, bundleMode, isLotBundle, containersById }) || 'Not available' });
          seen.add(item.id);
        }
        continue;
      }

      if (!seen.has(item.id)) {
        available.push(item);
        seen.add(item.id);
      }
    }

    return { available, blocked };
  }, [items, selectedSlot, searchQuery, editId, resolvedMode, parts, isLotBundle, containersById]);

  const availableItems = pickerResults.available;
  const blockedPickerItems = pickerResults.blocked;

  /** Compatible + incompatible with human-readable reasons (PC only). */
  const pickerCompatibility = useMemo(() => {
    if (!selectedSlot) {
      return {
        compatible: [] as { item: InventoryItem; compatible: true }[],
        incompatible: [] as { item: InventoryItem; compatible: false; reason: string }[],
      };
    }
    const compatible: { item: InventoryItem; compatible: true }[] = [];
    const incompatible: { item: InventoryItem; compatible: false; reason: string }[] = [];
    for (const item of availableItems) {
      const result = isCompatibleWithBuild(item, selectedSlot, parts);
      if (result.compatible) {
        compatible.push({ item, compatible: true });
      } else {
        incompatible.push({
          item,
          compatible: false,
          reason: result.reason || 'Not compatible with current build',
        });
      }
    }
    return { compatible, incompatible };
  }, [availableItems, selectedSlot, parts]);

  const togglePart = (item: InventoryItem) => {
     if (!selectedSlot) return;
     if (item.isDefective) {
       alert('Defective parts are blocked in PC builds. Use Compose → Lot Bundle.');
       return;
     }
     const slotDef = SLOTS.find(s => s.id === selectedSlot);
     if (!slotDef) return;

     const compat = isCompatibleWithBuild(item, selectedSlot, parts);
     const already = parts[selectedSlot]?.some((p) => p.id === item.id);
     if (!already && !compat.compatible) {
       alert(compat.reason || 'Not compatible with current build');
       return;
     }

     setParts(prev => {
        const current = prev[selectedSlot] || [];
        const isSelected = current.find(i => i.id === item.id);
        
        if (isSelected) {
           return { ...prev, [selectedSlot]: current.filter(i => i.id !== item.id) };
        } else if (slotAllowsMultiple(slotDef)) {
           return { ...prev, [selectedSlot]: [...current, item] };
        } else {
           return { ...prev, [selectedSlot]: [item] };
        }
     });
  };

  const clearSlot = useCallback((slotId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setParts((prev) => ({ ...prev, [slotId]: [] }));
    if (selectedSlot === slotId) setSelectedSlot(null);
  }, [selectedSlot]);

  const removePartFromSlot = useCallback((slotId: string, itemId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setParts((prev) => ({
      ...prev,
      [slotId]: (prev[slotId] || []).filter((i) => i.id !== itemId),
    }));
  }, []);

  const renderSlotRow = (slot: typeof SLOTS[number], compact = false) => {
    const assigned = parts[slot.id] || [];
    const hasItems = assigned.length > 0;

    return (
      <div
        key={slot.id}
        onClick={() => { setSelectedSlot(slot.id); setSearchQuery(''); }}
        className={`${compact ? 'p-4 rounded-xl' : 'p-4 rounded-[2rem]'} border-2 cursor-pointer transition-all ${
          selectedSlot === slot.id
            ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200'
            : 'bg-white border-slate-100 hover:border-indigo-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <div className={`${compact ? 'p-1.5 rounded-lg' : 'p-2 rounded-xl'} ${hasItems ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-50 text-slate-400'}`}>
            {React.cloneElement(slot.icon as React.ReactElement<{ size?: number }>, {
              size: compact ? 23 : 20,
            })}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-black text-slate-900 truncate ${compact ? 'text-base' : 'text-sm'}`}>{slot.label}</p>
            <p className={`text-slate-400 font-bold uppercase ${compact ? 'text-xs' : 'text-[9px]'}`}>
              {assigned.length} selected {slot.required && !hasItems && <span className="text-red-400">*Req</span>}
            </p>
          </div>
          {hasItems ? (
            <button
              type="button"
              onClick={(e) => clearSlot(slot.id, e)}
              title="Remove all parts from this slot"
              className="p-0.5 rounded-full hover:bg-emerald-100 transition-colors"
            >
              <CheckCircle2 size={compact ? 23 : 20} className="text-emerald-500 hover:text-emerald-700" />
            </button>
          ) : (
            <Plus size={compact ? 23 : 20} className="text-slate-300 shrink-0" />
          )}
        </div>

        {hasItems && (
          <div className={`space-y-0.5 ${compact ? 'pl-9' : 'pl-12'}`}>
            {assigned.map((item) => (
              <div key={item.id} className={`font-bold text-slate-600 truncate flex justify-between items-center gap-1 group/part ${compact ? 'text-sm' : 'text-[10px]'}`}>
                <span className="truncate">{item.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-slate-400">€{formatEUR(Number(item.buyPrice))}</span>
                  <button
                    type="button"
                    onClick={(e) => removePartFromSlot(slot.id, item.id, e)}
                    className="p-0.5 rounded opacity-0 group-hover/part:opacity-100 hover:bg-red-100 text-red-500 transition-all"
                    title="Remove from build"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPartPicker = (compact = false) => {
    if (!selectedSlot) {
      return (
        <div className={`flex-1 bg-slate-50 border border-dashed border-slate-300 flex flex-col items-center justify-center text-center opacity-60 ${compact ? 'rounded-xl min-h-[260px]' : 'rounded-[2.5rem]'}`}>
          <Hammer size={compact ? 52 : 64} className="mb-3 text-slate-300"/>
          <h3 className={`font-black text-slate-400 ${compact ? 'text-lg' : 'text-2xl'}`}>Select a slot</h3>
          <p className={`font-bold text-slate-400 max-w-xs mt-1 px-4 ${compact ? 'text-sm' : 'text-[10px]'}`}>Pick a component slot to add or remove parts.</p>
        </div>
      );
    }

    return (
      <div className={`flex-1 bg-white border border-slate-200 shadow-sm flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ${compact ? 'rounded-xl' : 'rounded-[2.5rem] shadow-lg'}`}>
        <div className={`${compact ? 'p-5' : 'p-6'} border-b border-slate-100 bg-slate-50/50 flex justify-between items-center gap-2`}>
          <div className="min-w-0">
            <h3 className={`font-black text-slate-900 truncate ${compact ? 'text-lg' : 'text-xl'}`}>
              {SLOTS.find(s => s.id === selectedSlot)?.label}
            </h3>
            <p className={`text-slate-500 font-bold ${compact ? 'text-sm' : 'text-[10px]'}`}>
              Compatible items first · defective blocked · reasons shown below
            </p>
          </div>
          <button type="button" onClick={() => setSelectedSlot(null)} className="p-1.5 hover:bg-slate-200 rounded-full shrink-0"><X size={compact ? 22 : 20}/></button>
        </div>

        <div className={`${compact ? 'p-4' : 'p-4'} border-b border-slate-100`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={compact ? 18 : 14}/>
            <input
              autoFocus
              className={`w-full pl-11 pr-3 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-50 ${compact ? 'py-3 text-base' : 'py-2 text-xs'}`}
              placeholder={`Search ${SLOTS.find(s => s.id === selectedSlot)?.label}…`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto ${compact ? 'p-4 space-y-2' : 'p-4 space-y-2'}`}>
          {availableItems.length === 0 && blockedPickerItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8 px-4">
              <Box size={32} className="mb-2 text-slate-300"/>
              <p className="font-bold text-slate-400 text-xs">No items found</p>
              {searchQuery.trim() && (
                <p className="text-[10px] text-slate-400 mt-2 max-w-xs">
                  Try a shorter search, or check inventory — the item may be sold or in another bundle.
                </p>
              )}
            </div>
          ) : (
            <>
              {pickerCompatibility.compatible.map(({ item }) => {
                const isSelected = parts[selectedSlot!]?.some(p => p.id === item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => togglePart(item)}
                    title={isSelected ? 'Click to remove from build' : 'Click to add to build'}
                    className={`flex items-center gap-3 ${compact ? 'p-3 rounded-xl' : 'p-4 rounded-2xl'} border-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 border-blue-500 shadow-sm'
                        : 'bg-white border-slate-100 hover:border-blue-200'
                    }`}
                  >
                    <ItemThumbnail item={item} className={`${compact ? 'w-14 h-14' : 'w-12 h-12'} rounded-lg object-cover bg-slate-100 shrink-0`} size={compact ? 53 : 48} useCategoryImage />
                    <div className="flex-1 min-w-0">
                      <p className={`font-black truncate text-slate-900 ${compact ? 'text-base' : 'text-xs'}`}>{item.name}</p>
                      <p className={`text-slate-400 font-bold uppercase ${compact ? 'text-xs' : 'text-[9px]'}`}>
                        {item.subCategory || item.category} • {item.status}
                        {item.isDefective ? ' • Defective' : ''} • €{formatEUR(Number(item.buyPrice))}
                      </p>
                    </div>
                    {isSelected ? (
                      <CheckCircle2 size={compact ? 26 : 24} className="text-blue-600 shrink-0" />
                    ) : (
                      <div className={`${compact ? 'w-7 h-7' : 'w-6 h-6'} rounded-full border-2 border-slate-200 shrink-0`}/>
                    )}
                  </div>
                );
              })}

              {pickerCompatibility.incompatible.length > 0 && (
                <div className="pt-3 mt-1 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowIncompatible((v) => !v)}
                    className="w-full flex items-center justify-between px-1 text-[10px] font-black uppercase tracking-widest text-rose-700"
                  >
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle size={12} />
                      Incompatible ({pickerCompatibility.incompatible.length})
                    </span>
                    <span className="text-rose-500">{showIncompatible ? 'Hide' : 'Show'}</span>
                  </button>
                  {showIncompatible &&
                    pickerCompatibility.incompatible.map(({ item, reason }) => (
                      <div
                        key={`incompat-${item.id}`}
                        className={`flex items-start gap-3 ${compact ? 'p-3 rounded-xl' : 'p-4 rounded-2xl'} border border-rose-200 bg-rose-50/70`}
                        title={reason}
                      >
                        <ItemThumbnail
                          item={item}
                          className={`${compact ? 'w-14 h-14' : 'w-12 h-12'} rounded-lg object-cover bg-slate-100 shrink-0 opacity-70`}
                          size={compact ? 53 : 48}
                          useCategoryImage
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`font-black text-slate-800 ${compact ? 'text-base' : 'text-xs'} leading-snug`}>
                            {item.name}
                          </p>
                          <p className={`text-slate-500 font-bold ${compact ? 'text-xs' : 'text-[9px]'} mt-0.5`}>
                            {item.subCategory || item.category} • €{formatEUR(Number(item.buyPrice))}
                          </p>
                          <p className={`inline-flex items-start gap-1 mt-1.5 text-rose-800 font-bold ${compact ? 'text-xs' : 'text-[10px]'}`}>
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                            {reason}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {blockedPickerItems.length > 0 && (
                <div className="pt-3 mt-2 border-t border-slate-200 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 px-1">
                    Cannot add ({blockedPickerItems.length})
                  </p>
                  {blockedPickerItems.map(({ item, reason }) => (
                    <div
                      key={`blocked-${item.id}`}
                      className={`flex items-start gap-3 ${compact ? 'p-3 rounded-xl' : 'p-4 rounded-2xl'} border border-amber-200/80 bg-amber-50/60 opacity-90`}
                      title={reason}
                    >
                      <ItemThumbnail item={item} className={`${compact ? 'w-14 h-14' : 'w-12 h-12'} rounded-lg object-cover bg-slate-100 shrink-0 grayscale`} size={compact ? 53 : 48} useCategoryImage />
                      <div className="flex-1 min-w-0">
                        <p className={`font-black text-slate-800 ${compact ? 'text-base' : 'text-xs'} leading-snug`}>{item.name}</p>
                        <p className={`text-slate-500 font-bold ${compact ? 'text-xs' : 'text-[9px]'} mt-0.5`}>
                          {item.subCategory || item.category} • {item.status}
                        </p>
                        <p className={`inline-flex items-center gap-1 mt-1.5 text-amber-900 font-bold ${compact ? 'text-xs' : 'text-[10px]'}`}>
                          <Lock size={12} className="shrink-0" />
                          {reason}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const currentTotal = (Object.values(parts).flat() as InventoryItem[]).reduce((sum, i) => sum + i.buyPrice, 0);
  const selectedPartsCount = useMemo(() => (Object.values(parts).flat() as InventoryItem[]).length, [parts]);
  const requiredSlotCount = useMemo(() => SLOTS.filter((s) => s.required).length, []);
  const requiredSlotsFilled = useMemo(
    () => SLOTS.filter((s) => s.required).filter((s) => (parts[s.id] || []).length > 0).length,
    [parts]
  );
  const canRunEstimate = selectedPartsCount >= 3;

  const clearAllSlots = useCallback(() => {
    if (!confirm('Clear all selected parts from this build?')) return;
    setParts({});
    setSelectedSlot(null);
  }, []);

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
      {!isCompactEdit && (
        <button
          type="button"
          onClick={() => navigate('/panel/builder?mode=lot')}
          className="px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-black uppercase tracking-widest hover:bg-amber-100"
          title="Open Lot Bundle builder (defective parts allowed)"
        >
          Lot Bundle →
        </button>
      )}
      <div className={`text-right ${isCompactEdit ? 'px-5 py-2.5 rounded-xl' : 'px-6 py-2 rounded-2xl shadow-lg'} bg-slate-900 text-white`}>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total</p>
        <p className={`font-black ${isCompactEdit ? 'text-2xl' : 'text-2xl'}`}>€{formatEUR(currentTotal)}</p>
      </div>
      {!isCompactEdit && (
        <>
          <button
            type="button"
            onClick={clearAllSlots}
            disabled={selectedPartsCount === 0}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={handleRunEstimate}
            disabled={estimating || !canRunEstimate}
            className="px-4 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-black uppercase tracking-widest hover:bg-indigo-100 disabled:opacity-50"
          >
            {estimating ? 'Analyzing…' : 'Run AI check'}
          </button>
        </>
      )}
      <button
        onClick={handleSave}
        className={`flex items-center gap-2 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all ${
          isCompactEdit ? 'px-6 py-3 text-sm' : 'px-6 py-3 rounded-xl shadow-lg text-xs'
        }`}
      >
        <Save size={18}/> Save Build
      </button>
    </div>
  );

  if (isCompactEdit) {
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-2 animate-in fade-in">
        <div className="bg-slate-50 w-full max-w-[1464px] rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-[min(96vh,1094px)]">
          <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-white shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <button
                type="button"
                onClick={() => navigate('/panel/inventory')}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 shrink-0"
              >
                <ArrowLeft size={22}/>
              </button>
              <div className="min-w-0">
                <h1 className="text-2xl font-black text-slate-900 truncate">Edit PC Build</h1>
                <p className="text-sm text-slate-500 font-bold truncate">Photos + parts · defective blocked</p>
              </div>
            </div>
            {headerActions}
          </header>

          <div className="flex-1 grid grid-cols-[320px_1fr] overflow-hidden min-h-0">
            <aside className="border-r border-slate-200 bg-white p-5 flex flex-col gap-4 min-h-0 overflow-hidden">
              <div>
                <label className="text-xs font-black uppercase text-slate-400 tracking-widest">Build name</label>
                <input
                  className="w-full mt-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-slate-100"
                  value={buildName}
                  onChange={(e) => {
                    userEditedNameRef.current = true;
                    setBuildName(e.target.value);
                  }}
                />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <BuildItemPhotosPanel
                  name={buildName}
                  photos={buildPhotos}
                  onChange={setBuildPhotos}
                  itemId={photoStorageItemId}
                />
              </div>
            </aside>

            <div className="flex flex-col min-h-0 overflow-hidden p-5 gap-4">
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 max-h-[42%] overflow-y-auto shrink-0 pr-1">
                {SLOTS.map((slot) => renderSlotRow(slot, true))}
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {renderPartPicker(true)}
              </div>
            </div>
          </div>
        </div>
        {listingDraft && (
          <ListingKitModal
            parent={listingDraft.parent}
            parts={listingDraft.parts}
            onSkip={() => {
              setListingDraft(null);
              void commitPcSave();
            }}
            onApply={(updated) => {
              setListingDraft(null);
              void commitPcSave(updated);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-[calc(100vh-88px)] flex flex-col animate-in fade-in px-4 pb-4">
       {/* HEADER */}
       <header className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 mb-4">
         <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-4 min-w-0">
             <button onClick={() => navigate(-1)} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={22}/></button>
             <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                  {editId ? 'Edit PC Build' : 'PC Builder'}
                </h1>
                <p className="text-sm text-slate-500 font-bold">
                  Slots + compatibility · defective parts blocked (use Lot Bundle for those)
                </p>
             </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
             <div className="hidden lg:flex items-center gap-2">
               <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black">
                 Parts {selectedPartsCount}
               </span>
               <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black">
                 Required {requiredSlotsFilled}/{requiredSlotCount}
               </span>
             </div>
             {headerActions}
          </div>
         </div>
       </header>

       <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          
          {/* LEFT: SLOTS */}
          <div className="w-[360px] xl:w-[390px] flex flex-col gap-3 shrink-0 overflow-y-auto pb-6 scrollbar-hide">
             <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Build Name</label>
                <input 
                   className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-base outline-none focus:ring-2 focus:ring-slate-100 transition-all mt-2"
                   value={buildName}
                   onChange={e => {
                     userEditedNameRef.current = true;
                     setBuildName(e.target.value);
                   }}
                   placeholder="My Gaming PC"
                />
             </div>

             <div className="space-y-3">
                {SLOTS.map(slot => renderSlotRow(slot, false))}
             </div>
          </div>

          {/* CENTER: SELECTION / SEARCH */}
          <div className="flex-1 flex flex-col gap-4 min-h-0">
             {renderPartPicker(false)}
          </div>

          {/* RIGHT: AI ANALYSIS */}
          <div className="w-[300px] xl:w-[330px] flex flex-col gap-4 shrink-0">
             <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
                <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                   <AlertTriangle size={14}/> Performance Check
                </h3>
                
                {performance ? (
                   <div className="space-y-4 animate-in fade-in">
                      <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                         <p className="text-[10px] font-black uppercase text-emerald-600 mb-1">Gaming 1080p</p>
                         <p className="text-sm font-bold text-emerald-900">{performance.gaming[0]?.fps_1080p || '60+'} FPS</p>
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                         <p className="text-[10px] font-black uppercase text-indigo-600 mb-1">Bottleneck</p>
                         <p className="text-xs font-bold text-indigo-900 leading-tight">{performance.bottleneck}</p>
                      </div>
                      <div className="flex-1 overflow-y-auto max-h-40">
                         <p className="text-[10px] text-slate-500 leading-relaxed italic">
                            "{performance.summary}"
                         </p>
                      </div>
                      <button onClick={handleRunEstimate} className="w-full py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-200">
                         Re-Analyze
                      </button>
                   </div>
                ) : (
                   <div className="flex-1 flex flex-col items-center justify-center text-center">
                      <Info size={32} className="text-slate-300 mb-3"/>
                      <p className="text-xs font-bold text-slate-400 mb-4">Add CPU, GPU & RAM to see AI performance estimates.</p>
                      <button 
                         onClick={handleRunEstimate}
                         disabled={estimating || !canRunEstimate}
                         className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs shadow-lg hover:bg-black transition-all disabled:opacity-50"
                      >
                         {estimating ? 'Analyzing...' : 'Run AI Analysis'}
                      </button>
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
             void commitPcSave();
           }}
           onApply={(updated) => {
             setListingDraft(null);
             void commitPcSave(updated);
           }}
         />
       )}
    </div>
  );
};

export default PCBuilderWizard;