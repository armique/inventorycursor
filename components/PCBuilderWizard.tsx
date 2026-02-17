import React, { useState, useEffect, useMemo } from 'react';
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

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
}

const SLOTS = [
  { id: 'CPU', label: 'Processor', category: 'Processors', icon: <Cpu size={20}/>, required: true },
  { id: 'GPU', label: 'Graphics Card', category: 'Graphics Cards', icon: <Monitor size={20}/>, required: true },
  { id: 'MOBO', label: 'Motherboard', category: 'Motherboards', icon: <Box size={20}/>, required: true },
  { id: 'RAM', label: 'Memory (RAM)', category: 'RAM', icon: <Box size={20}/>, required: true },
  { id: 'STORAGE', label: 'Storage', category: 'Storage (SSD/HDD)', icon: <HardDrive size={20}/>, required: true },
  { id: 'PSU', label: 'Power Supply', category: 'Power Supplies', icon: <Zap size={20}/>, required: true },
  { id: 'CASE', label: 'Case', category: 'Cases', icon: <Box size={20}/>, required: true },
  { id: 'COOLING', label: 'CPU Cooler', category: 'Cooling', icon: <Wind size={20}/>, required: false },
  { id: 'FANS', label: 'Case Fans', category: 'Fans', icon: <Wind size={20}/>, required: false, multiple: true },
  { id: 'MISC', label: 'Accessories', category: 'Misc', icon: <Plus size={20}/>, required: false, multiple: true },
];

const MAX_NAME_LENGTH = 52;

/** Shorten a part name for the build title. */
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
  return n.slice(0, 14).trim();
}

/** Generate a concise build name from CPU, GPU, RAM, Storage. */
function getBuildNameFromParts(parts: Record<string, InventoryItem[]>): string {
  const cpu = parts.CPU?.[0];
  const gpu = parts.GPU?.[0];
  const ram = parts.RAM?.[0];
  const storage = parts.STORAGE?.[0];
  const segments: string[] = [];
  if (cpu) segments.push(shortPartName(cpu.name, 'CPU'));
  if (gpu) segments.push(shortPartName(gpu.name, 'GPU'));
  if (ram) segments.push(shortPartName(ram.name, 'RAM'));
  if (storage) segments.push(shortPartName(storage.name, 'STORAGE'));
  if (segments.length === 0) return 'New Gaming PC';
  const name = segments.join(' · ');
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 2) + '…' : name;
}

const PCBuilderWizard: React.FC<Props> = ({ items, onSave }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('editId');

  const [buildName, setBuildName] = useState('New Gaming PC');
  const [parts, setParts] = useState<Record<string, InventoryItem[]>>({});
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // AI Estimation
  const [performance, setPerformance] = useState<PerformanceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

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
           // Try to slot them automatically
           const slot = SLOTS.find(s => s.category === comp.category || s.category === comp.subCategory);
           // Special handling for Fans/Misc/Cooling if needed
           if (slot) {
              if (!existingParts[slot.id]) existingParts[slot.id] = [];
              existingParts[slot.id].push(comp);
           } else {
              // Fallback to Misc
              if (!existingParts['MISC']) existingParts['MISC'] = [];
              existingParts['MISC'].push(comp);
           }
        });
        setParts(existingParts);
      }
    } else if (location.state?.initialParts) {
       // Similar logic for initial selection
       const initial: InventoryItem[] = location.state.initialParts;
       const newParts: Record<string, InventoryItem[]> = {};
       initial.forEach(comp => {
           const slot = SLOTS.find(s => s.category === comp.category || s.category === comp.subCategory);
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

  // Keep build name in sync with key parts (CPU, GPU, RAM, Storage)
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

  const handleSave = () => {
     if (!buildName) return alert("Enter a name for the build.");
     
     const allParts = Object.values(parts).flat() as InventoryItem[];
     if (allParts.length === 0) return alert("Build is empty.");

     const totalCost = allParts.reduce((sum, i) => sum + i.buyPrice, 0);
     
     const parentId = editId || `pc-${Date.now()}`;
     
     // Parent Item
     const pcItem: InventoryItem = {
        id: parentId,
        name: buildName,
        category: 'PC',
        subCategory: 'Custom Built PC',
        status: ItemStatus.IN_STOCK,
        buyPrice: totalCost,
        // No buyDate - bundles/PCs don't have buy dates, only their components do
        isPC: true,
        componentIds: allParts.map(i => i.id),
        comment1: `Custom Build Specs:\n${allParts.map(i => `- ${i.name}`).join('\n')}`,
        comment2: performance ? `AI Performance Estimate:\n${performance.summary}` : '',
        vendor: 'Custom Build',
        imageUrl: parts['CASE']?.[0]?.imageUrl || getCategoryImageUrl({ category: 'Cases' }) || undefined
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

     onSave([pcItem, ...updatedComponents, ...removedComponents]);
     navigate('/panel/inventory');
  };

  const availableItems = useMemo(() => {
     if (!selectedSlot) return [];
     const slotDef = SLOTS.find(s => s.id === selectedSlot);
     if (!slotDef) return [];

     return items.filter(i => {
        // PC Bundle items are full builds/bundles, not single parts — exclude from part selection
        if ((i.category === 'Bundle' && i.subCategory === 'PC Bundle') || i.category === 'PC Bundle') return false;
        // Defective items are not eligible for PC builds
        if (i.isDefective) return false;

        // Must be in stock or (if editing) potentially the item itself if already selected
        if (i.status !== ItemStatus.IN_STOCK) {
           // Allow if it belongs to this build
           if (editId && i.parentContainerId === editId) {
              // ok
           } else {
              return false; 
           }
        }

        // Logic from snippet provided by user
        let isCategoryMatch = false;
        if (selectedSlot === 'FANS') {
             // Specific logic for Fans slot
             // Allow items explicitly categorized as 'Fans'
             const isExplicitFan = i.category === 'Fans' || i.subCategory === 'Fans' || i.subCategory === 'Case Fans';
             
             // Also allow ALL items in 'Cooling' category.
             // Previously we filtered by name ('fan'/'lüfter'), but this hid items like "Arctic P12" or "Noctua NF-A12".
             // Showing all cooling items allows the user to decide what is a fan.
             const isCooling = i.category === 'Cooling' || i.subCategory === 'Cooling';
             
             isCategoryMatch = isExplicitFan || isCooling;
        } else if (slotDef.id === 'MISC') {
             isCategoryMatch = true; 
        } else {
             // Standard match for other slots
             isCategoryMatch = i.category === slotDef.category || i.subCategory === slotDef.category;
        }

        if (!isCategoryMatch) return false;

        // Search Query
        if (searchQuery) {
           return i.name.toLowerCase().includes(searchQuery.toLowerCase());
        }
        return true;
     });
  }, [items, selectedSlot, searchQuery, editId]);

  // Only show items compatible with current build (e.g. Intel CPU → only Intel motherboards)
  const availableWithCompatibility = useMemo(() => {
    if (!selectedSlot) return [];
    return availableItems
      .map(item => ({ item, ...isCompatibleWithBuild(item, selectedSlot, parts) }))
      .filter(x => x.compatible)
      .map(x => ({ item: x.item, compatible: true as const }));
  }, [availableItems, selectedSlot, parts]);
  const hiddenIncompatibleCount = useMemo(() => {
    if (!selectedSlot) return 0;
    return availableItems.filter(item => !isCompatibleWithBuild(item, selectedSlot, parts).compatible).length;
  }, [availableItems, selectedSlot, parts]);

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
           // Add
           if (slotDef.multiple) {
              return { ...prev, [selectedSlot]: [...current, item] };
           } else {
              // Replace single slot
              return { ...prev, [selectedSlot]: [item] };
           }
        }
     });
  };

  const currentTotal = (Object.values(parts).flat() as InventoryItem[]).reduce((sum, i) => sum + i.buyPrice, 0);

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-100px)] flex flex-col animate-in fade-in">
       {/* HEADER */}
       <header className="flex justify-between items-center mb-6 shrink-0 px-4">
          <div className="flex items-center gap-4">
             <button onClick={() => navigate(-1)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={24}/></button>
             <div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">{editId ? 'Edit Build' : 'PC Builder'}</h1>
                <p className="text-sm text-slate-500 font-bold">Assemble & Track Custom PCs</p>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-right px-6 py-2 bg-slate-900 text-white rounded-2xl shadow-lg">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Cost</p>
                <p className="text-2xl font-black">€{currentTotal.toFixed(2)}</p>
             </div>
             <button onClick={handleSave} className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl">
                <Save size={18}/> Save Build
             </button>
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
                {SLOTS.map(slot => {
                   const assigned = parts[slot.id] || [];
                   const hasItems = assigned.length > 0;
                   
                   return (
                      <div 
                         key={slot.id}
                         onClick={() => { setSelectedSlot(slot.id); setSearchQuery(''); }}
                         className={`p-4 rounded-[2rem] border-2 cursor-pointer transition-all ${selectedSlot === slot.id ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200' : 'bg-white border-slate-100 hover:border-indigo-200'}`}
                      >
                         <div className="flex items-center gap-3 mb-2">
                            <div className={`p-2 rounded-xl ${hasItems ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-50 text-slate-400'}`}>
                               {slot.icon}
                            </div>
                            <div className="flex-1">
                               <p className="font-black text-sm text-slate-900">{slot.label}</p>
                               <p className="text-[10px] text-slate-400 font-bold uppercase">{assigned.length} selected {slot.required && !hasItems && <span className="text-red-400">*Required</span>}</p>
                            </div>
                            {hasItems ? <CheckCircle2 size={20} className="text-emerald-500"/> : <Plus size={20} className="text-slate-300"/>}
                         </div>
                         
                         {hasItems && (
                            <div className="space-y-1 pl-12">
                               {assigned.map(item => (
                                  <div key={item.id} className="text-xs font-bold text-slate-600 truncate flex justify-between">
                                     <span>{item.name}</span>
                                     <span>€{item.buyPrice}</span>
                                  </div>
                               ))}
                            </div>
                         )}
                      </div>
                   );
                })}
             </div>
          </div>

          {/* CENTER: SELECTION / SEARCH */}
          <div className="flex-1 flex flex-col gap-4">
             {selectedSlot ? (
                <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-200 shadow-lg flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                   <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                      <div>
                         <h3 className="text-xl font-black text-slate-900">Select {SLOTS.find(s => s.id === selectedSlot)?.label}</h3>
                         <p className="text-xs text-slate-500 font-bold">Showing compatible inventory items</p>
                      </div>
                      <button onClick={() => setSelectedSlot(null)} className="p-2 hover:bg-slate-200 rounded-full"><X size={20}/></button>
                   </div>
                   
                   <div className="p-4 border-b border-slate-100">
                      <div className="relative">
                         <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                         <input 
                            autoFocus
                            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-blue-50 transition-all"
                            placeholder={`Search ${SLOTS.find(s => s.id === selectedSlot)?.label}...`}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                         />
                      </div>
                   </div>

                   <div className="flex-1 overflow-y-auto p-4 space-y-2">
                      {availableItems.length === 0 ? (
                         <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                            <Box size={48} className="mb-4 text-slate-300"/>
                            <p className="font-bold text-slate-400">No items found</p>
                            <p className="text-xs text-slate-400">Add items to inventory first</p>
                         </div>
                      ) : (
                         <>
                            {hiddenIncompatibleCount > 0 && (
                               <p className="text-[10px] text-slate-500 font-bold mb-2 px-1">{hiddenIncompatibleCount} incompatible item{hiddenIncompatibleCount === 1 ? '' : 's'} hidden</p>
                            )}
                            {availableWithCompatibility.map(({ item }) => {
                               const isSelected = parts[selectedSlot!]?.some(p => p.id === item.id);
                               return (
                                  <div
                                     key={item.id}
                                     onClick={() => togglePart(item)}
                                     className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                                       isSelected
                                         ? 'bg-blue-50 border-blue-500 shadow-md cursor-pointer hover:scale-[1.01]'
                                         : 'bg-white border-slate-100 hover:border-blue-200 cursor-pointer hover:scale-[1.01]'
                                     }`}
                                  >
                                     <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover bg-slate-100" size={48} useCategoryImage />
                                     <div className="flex-1 min-w-0">
                                        <p className="font-black text-sm truncate text-slate-900">{item.name}</p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase">{item.category} • €{item.buyPrice}</p>
                                     </div>
                                     {isSelected ? <CheckCircle2 size={24} className="text-blue-600"/> : <div className="w-6 h-6 rounded-full border-2 border-slate-200"/>}
                                  </div>
                               );
                            })}
                         </>
                      )}
                   </div>
                </div>
             ) : (
                <div className="flex-1 bg-slate-50 rounded-[2.5rem] border border-dashed border-slate-300 flex flex-col items-center justify-center text-center opacity-60">
                   <Hammer size={64} className="mb-6 text-slate-300"/>
                   <h3 className="text-2xl font-black text-slate-400">Start Building</h3>
                   <p className="text-sm font-bold text-slate-400 max-w-xs mt-2">Select a slot on the left to add components from your inventory.</p>
                </div>
             )}
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