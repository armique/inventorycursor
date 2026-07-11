import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { formatEUR } from '../utils/formatMoney';

import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { 
  Cpu, Monitor, HardDrive, Zap, Box, Wind, 
  Save, ArrowLeft, Plus, X, Search, CheckCircle2,
  AlertTriangle, Hammer, Info
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { estimatePCPerformance, PerformanceEstimate } from '../services/geminiService';
import ItemThumbnail, { getCategoryImageUrl } from './ItemThumbnail';
import { isCompatibleWithBuild } from '../services/compatibility';
import BuildItemPhotosPanel from './BuildItemPhotosPanel';
import { getItemUserPhotoUrls, prepareInventoryImagesForStorage } from '../utils/imageImport';
import {
  findBuilderSlotForComponent,
  isEligibleForBuilderPicker,
  itemMatchesBuilderSearch,
  itemMatchesBuilderSlot,
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

/** PC builds keep single-item slots; bundles allow any number per slot (e.g. lot of motherboards). */
function slotAllowsMultiple(slot: (typeof SLOTS)[number], mode: 'pc' | 'bundle'): boolean {
  return Boolean(slot.multiple) || mode === 'bundle';
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
  const photoItemIdRef = useRef(
    editId || `${searchParams.get('mode') === 'bundle' ? 'bundle' : 'pc'}-draft-${Date.now()}`
  );
  const photoStorageItemId = editId || photoItemIdRef.current;

  const [mode, setMode] = useState<'pc' | 'bundle'>(() => {
    if (searchParams.get('mode') === 'bundle') return 'bundle';
    return 'pc';
  });
  /** When editing, always follow the container type — avoids PC compatibility rules on lot bundles. */
  const resolvedMode: 'pc' | 'bundle' =
    editingContainer != null ? (editingContainer.isBundle ? 'bundle' : 'pc') : mode;
  const isLotBundle = editingContainer?.subCategory === 'Lot Bundle';
  const [buildName, setBuildName] = useState('New Gaming PC');
  const [parts, setParts] = useState<Record<string, InventoryItem[]>>({});
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [buildPhotos, setBuildPhotos] = useState<string[]>([]);
  
  const isCompactEdit = Boolean(editId);
  const [performance, setPerformance] = useState<PerformanceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  // Initialize
  useEffect(() => {
    if (editId) {
      const pc = items.find(i => i.id === editId);
      if (pc) {
        setMode(pc.isBundle ? 'bundle' : 'pc');
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

  // Keep build/bundle name in sync with key parts
  useEffect(() => {
    setBuildName(getBuildNameFromParts(parts));
  }, [parts]);

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

  const handleSave = async () => {
     if (!buildName) return alert("Enter a name for the build.");
     
     const allParts = Object.values(parts).flat() as InventoryItem[];
     if (allParts.length === 0) return alert("Build is empty.");

     const existingParent = editId ? items.find((i) => i.id === editId) : undefined;
     const isLotBundle = existingParent?.subCategory === 'Lot Bundle';

     if (resolvedMode === 'bundle' && !isLotBundle && allParts.length > 12) {
       return alert("Bundles in this builder are limited to 12 items. Remove some parts or use a full PC build instead.");
     }

     const totalCost = allParts.reduce((sum, i) => sum + i.buyPrice, 0);
     
     const parentId = editId || (resolvedMode === 'bundle' ? `bundle-${Date.now()}` : `pc-${Date.now()}`);
     
     const autoImageUrl =
       resolvedMode === 'bundle'
         ? allParts[0]?.imageUrl || getCategoryImageUrl({ category: allParts[0]?.category || 'Components' }) || undefined
         : parts['CASE']?.[0]?.imageUrl || getCategoryImageUrl({ category: 'Cases' }) || undefined;
     let userPhotos = buildPhotos.length > 0 ? buildPhotos : getItemUserPhotoUrls(existingParent || {});
     if (userPhotos.length) {
       try {
         userPhotos = await prepareInventoryImagesForStorage(userPhotos, { itemId: parentId });
       } catch {
         /* keep existing URLs */
       }
     }
     const imageUrl = userPhotos[0] || autoImageUrl || existingParent?.imageUrl;
     const imageUrls = userPhotos.length ? userPhotos : existingParent?.imageUrls;

     // Parent Item (PC or Bundle)
     const parentItem: InventoryItem = {
        ...(existingParent || {}),
        id: parentId,
        name: buildName,
        category: resolvedMode === 'bundle' ? 'Bundle' : 'PC',
        subCategory: resolvedMode === 'bundle' ? (existingParent?.subCategory || 'Custom Bundle') : 'Custom Built PC',
        status: ItemStatus.IN_STOCK,
        buyPrice: totalCost,
        // No buyDate - containers don't have buy dates, only their components do
        isPC: resolvedMode !== 'bundle',
        isBundle: resolvedMode === 'bundle',
        componentIds: allParts.map(i => i.id),
        comment1: `${resolvedMode === 'bundle' ? 'Bundle Contents' : 'Custom Build Specs'}:\n${allParts.map(i => `- ${i.name}`).join('\n')}`,
        comment2: !resolvedMode && performance ? `AI Performance Estimate:\n${performance.summary}` : performance && resolvedMode !== 'bundle' ? `AI Performance Estimate:\n${performance.summary}` : '',
        vendor: resolvedMode === 'bundle' ? 'Custom Bundle' : 'Custom Build',
        imageUrl,
        imageUrls: imageUrls?.length ? imageUrls : undefined,
     };

     // Update Components
     const updatedComponents = allParts.map(comp => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: parentId
     }));

     // Handle Removed Components (if editing)
     let removedComponents: InventoryItem[] = [];
     if (editId) {
        const previousComponents = items.filter(i => i.parentContainerId === editId);
        const currentIds = new Set(allParts.map(i => i.id));
        removedComponents = previousComponents
           .filter(i => !currentIds.has(i.id))
           .map(i => ({
              ...i,
              status: ItemStatus.IN_STOCK,
              parentContainerId: undefined
           } as InventoryItem));
     }

     onSave([parentItem, ...updatedComponents, ...removedComponents]);
     navigate('/panel/inventory');
  };

  const availableItems = useMemo(() => {
     if (!selectedSlot) return [];
     const slotDef = SLOTS.find(s => s.id === selectedSlot);
     if (!slotDef) return [];
     const bundleMode = resolvedMode === 'bundle';

     return items.filter(i => {
        if (!isEligibleForBuilderPicker(i, { editId, bundleMode })) return false;

        if (!itemMatchesBuilderSlot(i, slotDef, {
          bundleMode,
          assignedInSlot: parts[selectedSlot],
        })) {
          return false;
        }

        return itemMatchesBuilderSearch(i, searchQuery);
     });
  }, [items, selectedSlot, searchQuery, editId, resolvedMode, parts]);

  // Only show items compatible with current build (e.g. Intel CPU → only Intel motherboards)
  const availableWithCompatibility = useMemo(() => {
    if (!selectedSlot) return [];
    if (resolvedMode === 'bundle') {
      return availableItems.map((item) => ({ item, compatible: true as const }));
    }
    return availableItems
      .map(item => ({ item, ...isCompatibleWithBuild(item, selectedSlot, parts) }))
      .filter(x => x.compatible)
      .map(x => ({ item: x.item, compatible: true as const }));
  }, [availableItems, selectedSlot, parts, resolvedMode]);
  const hiddenIncompatibleCount = useMemo(() => {
    if (!selectedSlot || resolvedMode === 'bundle') return 0;
    return availableItems.filter(item => !isCompatibleWithBuild(item, selectedSlot, parts).compatible).length;
  }, [availableItems, selectedSlot, parts, resolvedMode]);

  const togglePart = (item: InventoryItem) => {
     if (!selectedSlot) return;
     const slotDef = SLOTS.find(s => s.id === selectedSlot);
     if (!slotDef) return;

     setParts(prev => {
        const current = prev[selectedSlot] || [];
        const isSelected = current.find(i => i.id === item.id);
        
        if (isSelected) {
           // Remove
           return { ...prev, [selectedSlot]: current.filter(i => i.id !== item.id) };
        } else {
           // Add — bundles allow multiple items per slot (e.g. lot of motherboards)
           if (slotAllowsMultiple(slotDef, resolvedMode)) {
              return { ...prev, [selectedSlot]: [...current, item] };
           } else {
              // Replace single slot (PC build only)
              return { ...prev, [selectedSlot]: [item] };
           }
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
            {React.cloneElement(slot.icon as React.ReactElement, { size: compact ? 23 : 20 })}
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
              {resolvedMode === 'bundle'
                ? 'Click to add or remove items'
                : 'Click ✓ to remove · compatible items only'}
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
          {availableItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8">
              <Box size={32} className="mb-2 text-slate-300"/>
              <p className="font-bold text-slate-400 text-xs">No items found</p>
            </div>
          ) : (
            <>
              {hiddenIncompatibleCount > 0 && (
                <p className="text-[9px] text-slate-500 font-bold mb-1 px-1">{hiddenIncompatibleCount} incompatible hidden</p>
              )}
              {availableWithCompatibility.map(({ item }) => {
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
                      <p className={`text-slate-400 font-bold uppercase ${compact ? 'text-xs' : 'text-[9px]'}`}>{item.category} • €{formatEUR(Number(item.buyPrice))}</p>
                    </div>
                    {isSelected ? (
                      <CheckCircle2 size={compact ? 26 : 24} className="text-blue-600 shrink-0" />
                    ) : (
                      <div className={`${compact ? 'w-7 h-7' : 'w-6 h-6'} rounded-full border-2 border-slate-200 shrink-0`}/>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  };

  const currentTotal = (Object.values(parts).flat() as InventoryItem[]).reduce((sum, i) => sum + i.buyPrice, 0);

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0">
      {!isCompactEdit && (
        <div className="flex items-center bg-slate-100 rounded-2xl p-1 text-[10px] font-black uppercase tracking-widest">
          <button
            type="button"
            onClick={() => setMode('pc')}
            className={`px-3 py-1.5 rounded-xl transition-colors ${
              mode === 'pc' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            PC Build
          </button>
          <button
            type="button"
            onClick={() => setMode('bundle')}
            className={`px-3 py-1.5 rounded-xl transition-colors ${
              mode === 'bundle' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Bundle
          </button>
        </div>
      )}
      <div className={`text-right ${isCompactEdit ? 'px-5 py-2.5 rounded-xl' : 'px-6 py-2 rounded-2xl shadow-lg'} bg-slate-900 text-white`}>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total</p>
        <p className={`font-black ${isCompactEdit ? 'text-2xl' : 'text-2xl'}`}>€{formatEUR(currentTotal)}</p>
      </div>
      <button
        onClick={handleSave}
        className={`flex items-center gap-2 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all ${
          isCompactEdit ? 'px-6 py-3 text-sm' : 'px-8 py-4 rounded-2xl shadow-xl text-xs'
        }`}
      >
        <Save size={isCompactEdit ? 18 : 18}/> Save
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
                <h1 className="text-2xl font-black text-slate-900 truncate">
                  {resolvedMode === 'bundle' ? 'Edit Bundle' : 'Edit Build'}
                </h1>
                <p className="text-sm text-slate-500 font-bold truncate">Photos + parts in one place</p>
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
                  onChange={(e) => setBuildName(e.target.value)}
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
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-100px)] flex flex-col animate-in fade-in">
       {/* HEADER */}
       <header className="flex justify-between items-center mb-6 shrink-0 px-4">
          <div className="flex items-center gap-4">
             <button onClick={() => navigate(-1)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={24}/></button>
             <div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                  {editId
                    ? resolvedMode === 'bundle'
                      ? 'Edit Bundle'
                      : 'Edit Build'
                    : resolvedMode === 'bundle'
                      ? 'Bundle Builder'
                      : 'PC Builder'}
                </h1>
                <p className="text-sm text-slate-500 font-bold">
                  {resolvedMode === 'bundle'
                    ? isLotBundle
                      ? 'Lot bundle — add as many items as you need per slot'
                      : 'Group parts into a sellable bundle — add as many items as you need per slot'
                    : 'Assemble & Track Custom PCs'}
                </p>
             </div>
          </div>
          <div className="flex items-center gap-4">
             {headerActions}
          </div>
       </header>

       <div className="flex flex-1 gap-6 overflow-hidden px-4">
          
          {/* LEFT: SLOTS */}
          <div className="w-[400px] flex flex-col gap-4 shrink-0 overflow-y-auto pb-20 scrollbar-hide">
             <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm mb-4">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Build Name</label>
                <input 
                   className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-slate-100 transition-all mt-2"
                   value={buildName}
                   onChange={e => setBuildName(e.target.value)}
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
          <div className="w-[300px] flex flex-col gap-4 shrink-0">
             <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm h-full flex flex-col">
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
                         disabled={estimating}
                         className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs shadow-lg hover:bg-black transition-all disabled:opacity-50"
                      >
                         {estimating ? 'Analyzing...' : 'Run AI Analysis'}
                      </button>
                   </div>
                )}
             </div>
          </div>

       </div>
    </div>
  );
};

export default PCBuilderWizard;