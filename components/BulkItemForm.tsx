
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Save, Plus, Trash2, Calendar, Globe, CreditCard, 
  ShoppingBag, Calculator, Layers, Box, ChevronDown, 
  MessageCircle, Link as LinkIcon, Upload, Search, Database, 
  Cpu, Monitor, HardDrive, Zap, Wind, AlertCircle, CheckCircle2, Copy,
  Fan, Lightbulb, Keyboard, Mouse, Tv, MoreHorizontal, Cable, Laptop as LaptopIcon, Wrench,
  Sparkles, Loader2, Package
} from 'lucide-react';
import { InventoryItem, ItemStatus, Platform, PaymentType } from '../types';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { CATEGORY_IMAGES, searchAllHardware, HardwareMetadata } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';

interface Props {
  onSave: (newItems: InventoryItem[]) => void;
  categoryFields?: Record<string, string[]>;
}

const PAYMENT_METHODS: PaymentType[] = [
  'ebay.de',
  'Kleinanzeigen (Cash)',
  'Kleinanzeigen (Direkt Kaufen)',
  'Kleinanzeigen (Paypal)',
  'Kleinanzeigen (Wire Transfer)',
  'Paypal',
  'Cash',
  'Bank Transfer',
  'Other'
];

const GamepadIcon = ({size}: {size:number}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>
);

// Quick Access Categories for the Grid
const QUICK_CATS = [
  { label: 'GPU', icon: <Monitor size={20}/>, cat: 'Components', sub: 'Graphics Cards' },
  { label: 'CPU', icon: <Cpu size={20}/>, cat: 'Components', sub: 'Processors' },
  { label: 'Mobo', icon: <Box size={20}/>, cat: 'Components', sub: 'Motherboards' },
  { label: 'RAM', icon: <Layers size={20}/>, cat: 'Components', sub: 'RAM' },
  { label: 'Storage', icon: <HardDrive size={20}/>, cat: 'Components', sub: 'Storage (SSD/HDD)' },
  { label: 'PSU', icon: <Zap size={20}/>, cat: 'Components', sub: 'Power Supplies' },
  { label: 'Case', icon: <Box size={20}/>, cat: 'Components', sub: 'Cases' },
  { label: 'Cooling', icon: <Wind size={20}/>, cat: 'Components', sub: 'Cooling' },
  { label: 'Fans', icon: <Fan size={20}/>, cat: 'Components', sub: 'Cooling' },
  { label: 'RGB/Mod', icon: <Lightbulb size={20}/>, cat: 'Misc', sub: 'Spare Parts' },
  { label: 'Cables', icon: <Cable size={20}/>, cat: 'Misc', sub: 'Cables' },
  { label: 'Laptop', icon: <LaptopIcon size={20}/>, cat: 'Laptops', sub: 'Gaming Laptop' },
  { label: 'Console', icon: <GamepadIcon size={20}/>, cat: 'Gadgets', sub: 'Consoles' },
  { label: 'Monitor', icon: <Tv size={20}/>, cat: 'Peripherals', sub: 'Monitors' },
  { label: 'Keyboard', icon: <Keyboard size={20}/>, cat: 'Peripherals', sub: 'Keyboards' },
  { label: 'Mouse', icon: <Mouse size={20}/>, cat: 'Peripherals', sub: 'Mice' },
  { label: 'Misc', icon: <MoreHorizontal size={20}/>, cat: 'Misc', sub: 'Spare Parts' },
];

interface DraftItem {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  note: string;
  manualCost?: number; // If set, overrides auto-split
  specs?: Record<string, string | number>;
  vendor?: string;
  isDefective?: boolean;
}

const BulkItemForm: React.FC<Props> = ({ onSave, categoryFields = {} }) => {
  const navigate = useNavigate();
  const aiAvailable = !!getSpecsAIProvider();

  // Shared State
  const [totalCost, setTotalCost] = useState<number>(0);
  const [buyDate, setBuyDate] = useState(new Date().toISOString().split('T')[0]);
  const [platform, setPlatform] = useState<Platform>('kleinanzeigen.de');
  const [payment, setPayment] = useState<PaymentType>('Cash');
  
  // Shared Evidence
  const [chatUrl, setChatUrl] = useState('');
  const [chatImage, setChatImage] = useState('');

  // Items List
  const [items, setItems] = useState<DraftItem[]>([]);
  
  // Entry Form State
  const [mode, setMode] = useState<'SEARCH' | 'MANUAL'>('MANUAL');
  const [parseSpecsBeforeImport, setParseSpecsBeforeImport] = useState(true);
  const [parsingSpecs, setParsingSpecs] = useState(false);
  const [parseProgress, setParseProgress] = useState<string | null>(null);
  const [addAsBundle, setAddAsBundle] = useState(false);
  const [bundleName, setBundleName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HardwareMetadata[]>([]);
  
  // Manual Inputs
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>('Components');
  const [newSubCategory, setNewSubCategory] = useState<string>('Graphics Cards');
  const [newNote, setNewNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [newDefective, setNewDefective] = useState(false);

  // Search Logic
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2 && mode === 'SEARCH') {
        const results = searchAllHardware(searchQuery);
        setSearchResults(results);
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, mode]);

  // Calculations
  const allocatedSum = items.reduce((sum, item) => sum + (item.manualCost !== undefined ? item.manualCost : 0), 0);
  const unallocatedCost = Math.max(0, totalCost - allocatedSum);
  const itemsWithoutManualCost = items.filter(i => i.manualCost === undefined).length;
  
  // The logic: 
  // 1. Sum up all items with manualCost.
  // 2. Subtract that from totalCost.
  // 3. Divide remainder by count of items WITHOUT manualCost.
  const autoSplitValue = itemsWithoutManualCost > 0 ? (unallocatedCost / itemsWithoutManualCost) : 0;

  const handleAddManual = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newName) return;

    const newItems: DraftItem[] = [];
    for(let i=0; i<quantity; i++) {
        newItems.push({
            id: `draft-${Date.now()}-${i}`,
            name: newName,
            category: newCategory,
            subCategory: newSubCategory,
            note: newNote,
            isDefective: newDefective
        });
    }

    setItems(prev => [...prev, ...newItems]);
    setNewName('');
    setNewNote('');
    setQuantity(1);
    setNewDefective(false);
  };

  const handleAddFromSearch = (hw: HardwareMetadata) => {
    // Map DB type to category
    let cat = 'Components';
    let sub = 'Misc';
    
    // Try to find a match in QUICK_CATS first
    const quickMatch = QUICK_CATS.find(q => q.label === hw.type || q.sub === hw.type);
    if (quickMatch) {
        cat = quickMatch.cat;
        sub = quickMatch.sub;
    } else {
        // Fallback Mapping
        if (hw.type === 'GPU') sub = 'Graphics Cards';
        if (hw.type === 'CPU') sub = 'Processors';
        if (hw.type === 'Motherboard') sub = 'Motherboards';
        if (hw.type === 'RAM') sub = 'RAM';
        if (hw.type === 'Storage') sub = 'Storage (SSD/HDD)';
    }

    setItems(prev => [...prev, {
        id: `draft-${Date.now()}`,
        name: `${hw.vendor} ${hw.model}`,
        category: cat,
        subCategory: sub,
        note: '',
        specs: hw.specs,
        vendor: hw.vendor,
        isDefective: false
    }]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const updateItemCost = (id: string, val: string) => {
    const num = parseFloat(val);
    setItems(prev => prev.map(i => i.id === id ? { ...i, manualCost: isNaN(num) ? undefined : num } : i));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setChatImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const distributeEvenly = () => {
     // Remove manual costs from everything so auto-calc takes over
     setItems(prev => prev.map(i => ({ ...i, manualCost: undefined })));
  };

  const handleSubmit = async () => {
    if (items.length === 0) return;

    // Check consistency
    const totalAllocated = items.reduce((sum, item) => sum + (item.manualCost !== undefined ? item.manualCost : autoSplitValue), 0);
    if (Math.abs(totalAllocated - totalCost) > 0.1) {
        if (!window.confirm(`Warning: The sum of item costs (€${totalAllocated.toFixed(2)}) does not match Total Paid (€${totalCost}). Continue anyway?`)) {
            return;
        }
    }

    let itemsToImport = [...items];

    // Parse tech specs with AI for items that don't have specs yet
    if (parseSpecsBeforeImport && aiAvailable) {
      const needSpecs = itemsToImport.filter(
        (d) => !d.specs || Object.keys(d.specs).length === 0
      );
      if (needSpecs.length > 0) {
        setParsingSpecs(true);
        const updated = [...itemsToImport];
        for (let i = 0; i < needSpecs.length; i++) {
          const draft = needSpecs[i];
          setParseProgress(`Parsing specs… ${i + 1} / ${needSpecs.length}`);
          try {
            const categoryContext = `${draft.category}${draft.subCategory ? ` / ${draft.subCategory}` : ''}`;
            const activeKey = `${draft.category}:${draft.subCategory || ''}`;
            const knownKeys = categoryFields[activeKey] || categoryFields[draft.category] || [];
            const result = await generateItemSpecs(draft.name, categoryContext, knownKeys);
            const idx = updated.findIndex((x) => x.id === draft.id);
            if (idx >= 0 && result.specs && Object.keys(result.specs).length > 0) {
              updated[idx] = {
                ...updated[idx],
                specs: result.specs,
                ...(result.standardizedName && { name: result.standardizedName }),
                ...(result.vendor && { vendor: result.vendor }),
              };
            }
          } catch (e) {
            console.warn('AI specs parse failed for', draft.name, e);
            // Keep original item, don't block import
          }
        }
        itemsToImport = updated;
        setParseProgress(null);
        setParsingSpecs(false);
      }
    }

    const timestamp = Date.now();
    const childItems: InventoryItem[] = itemsToImport.map((draft, index) => {
      const finalCost = draft.manualCost !== undefined ? draft.manualCost : autoSplitValue;
      return {
        id: `bulk-${timestamp}-${index}`,
        name: draft.name,
        buyPrice: parseFloat(finalCost.toFixed(2)),
        buyDate: buyDate,
        category: draft.category,
        subCategory: draft.subCategory,
        status: addAsBundle ? ItemStatus.IN_COMPOSITION : ItemStatus.IN_STOCK,
        comment1: draft.note,
        comment2: `Bulk Import (${itemsToImport.length} items). Source total: €${totalCost}.`,
        vendor: draft.vendor || 'Unknown',
        specs: draft.specs,
        isDefective: draft.isDefective,
        parentContainerId: addAsBundle ? `bundle-${timestamp}` : undefined,
        platformBought: platform,
        buyPaymentType: payment,
        kleinanzeigenBuyChatUrl: chatUrl,
        kleinanzeigenBuyChatImage: chatImage,
        imageUrl: CATEGORY_IMAGES[draft.subCategory || draft.category] || CATEGORY_IMAGES[draft.category]
      };
    });

    const inventoryItems: InventoryItem[] = addAsBundle && childItems.length > 0
      ? (() => {
          const bundleId = `bundle-${timestamp}`;
          const totalBuy = childItems.reduce((sum, i) => sum + i.buyPrice, 0);
          const nameToUse = bundleName.trim() || `Bundle: ${itemsToImport[0].name}${itemsToImport.length > 1 ? ` + ${itemsToImport.length - 1} more` : ''}`;
          const parentBundle: InventoryItem = {
            id: bundleId,
            name: nameToUse,
            category: 'Bundle',
            subCategory: 'Component Set',
            status: ItemStatus.IN_STOCK,
            buyPrice: totalBuy,
            isBundle: true,
            componentIds: childItems.map(i => i.id),
            comment1: `Bulk Import Bundle. Contents:\n${childItems.map(i => `- ${i.name}`).join('\n')}`,
            comment2: `Bulk Import (${itemsToImport.length} items). Source total: €${totalCost}.`,
            vendor: 'Combined',
            platformBought: platform,
            buyPaymentType: payment,
            kleinanzeigenBuyChatUrl: chatUrl,
            kleinanzeigenBuyChatImage: chatImage,
            imageUrl: childItems[0]?.imageUrl || CATEGORY_IMAGES['Components']
          };
          return [parentBundle, ...childItems];
        })()
      : childItems;

    onSave(inventoryItems);
    navigate('/panel/inventory');
  };

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100vh-100px)] flex flex-col animate-in fade-in">
      {/* HEADER */}
      <header className="flex justify-between items-center mb-6 shrink-0 px-4">
        <div className="flex items-center gap-4">
           <button onClick={() => navigate(-1)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={24}/></button>
           <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Bulk Entry</h1>
              <p className="text-sm text-slate-500 font-bold">Add Multiple Items • One Transaction</p>
           </div>
        </div>
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
           <div className="px-4 border-r border-slate-100">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Total Paid</label>
              <div className="flex items-center gap-1">
                 <span className="text-slate-400 font-bold">€</span>
                 <input 
                    type="number" 
                    className="w-24 font-black text-xl outline-none text-slate-900 placeholder:text-slate-200" 
                    placeholder="0.00"
                    value={totalCost || ''}
                    onChange={e => setTotalCost(parseFloat(e.target.value) || 0)}
                 />
              </div>
           </div>
           <div className="px-4">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Date</label>
              <input 
                 type="date" 
                 className="font-bold text-sm outline-none text-slate-700 bg-transparent"
                 value={buyDate}
                 onChange={e => setBuyDate(e.target.value)}
              />
           </div>
        </div>
      </header>

      <div className="flex flex-1 gap-6 overflow-hidden px-4">
         
         {/* LEFT: ITEM BUILDER */}
         <div className="w-[450px] flex flex-col gap-6 shrink-0 overflow-y-auto pb-20 scrollbar-hide">
            
            {/* INPUT MODE TABS */}
            <div className="bg-slate-200 p-1 rounded-2xl flex font-bold text-xs">
               <button onClick={() => setMode('MANUAL')} className={`flex-1 py-3 rounded-xl transition-all ${mode === 'MANUAL' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Manual Entry</button>
               <button onClick={() => setMode('SEARCH')} className={`flex-1 py-3 rounded-xl transition-all ${mode === 'SEARCH' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Database Search</button>
            </div>

            {mode === 'MANUAL' ? (
               <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Category Quick Select</label>
                     <div className="flex flex-wrap gap-2">
                        {QUICK_CATS.map(cat => (
                           <button 
                              key={cat.label}
                              onClick={() => { setNewCategory(cat.cat); setNewSubCategory(cat.sub); }}
                              className={`
                                 flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black uppercase transition-all
                                 ${newSubCategory === cat.sub ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300'}
                              `}
                           >
                              {cat.icon} {cat.label}
                           </button>
                        ))}
                     </div>
                  </div>

                  <div className="space-y-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Item Name</label>
                        <input 
                           autoFocus
                           className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-slate-100 transition-all"
                           placeholder="e.g. Corsair RM850x"
                           value={newName}
                           onChange={e => setNewName(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                        />
                     </div>
                     
                     <div className="flex gap-4 items-center">
                        <div className="flex-1 space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Details (Optional)</label>
                           <input 
                              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-xs outline-none focus:border-slate-300"
                              placeholder="Condition, Specs..."
                              value={newNote}
                              onChange={e => setNewNote(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                           />
                        </div>
                        <div className="w-24 space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Count</label>
                           <input 
                              type="number"
                              min="1"
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-center outline-none focus:border-slate-300"
                              value={quantity}
                              onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                           />
                        </div>
                     </div>

                     {/* Defekt Checkbox */}
                     <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer border border-transparent hover:border-slate-200">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${newDefective ? 'bg-red-500 text-white' : 'bg-white border text-slate-300'}`}>
                           <Wrench size={16}/>
                        </div>
                        <div className="flex-1">
                           <span className="text-xs font-bold text-slate-700 block">Mark as Defective</span>
                           <span className="text-[9px] text-slate-400">Item needs repair / for parts</span>
                        </div>
                        <input type="checkbox" checked={newDefective} onChange={e => setNewDefective(e.target.checked)} className="hidden"/>
                        {newDefective && <CheckCircle2 size={16} className="text-red-500"/>}
                     </label>
                  </div>

                  <button 
                     onClick={handleAddManual}
                     disabled={!newName}
                     className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                     <Plus size={16}/> Add to List
                  </button>
               </div>
            ) : (
               <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex-1 flex flex-col min-h-0">
                  <div className="relative mb-4">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                     <input 
                        autoFocus
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-blue-50 transition-all"
                        placeholder="Search model (e.g. 3060 Ti)..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                     />
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                     {searchResults.map((res, idx) => (
                        <button 
                           key={idx}
                           onClick={() => handleAddFromSearch(res)}
                           className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                        >
                           <div className="flex justify-between items-center">
                              <p className="font-black text-xs text-slate-900 group-hover:text-blue-700">{res.vendor} {res.model}</p>
                              <Plus size={14} className="opacity-0 group-hover:opacity-100 text-blue-600"/>
                           </div>
                           <div className="flex gap-2 mt-1">
                              <span className="text-[9px] font-bold uppercase text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{res.type || 'Part'}</span>
                           </div>
                        </button>
                     ))}
                     {searchResults.length === 0 && searchQuery.length > 2 && (
                        <p className="text-center text-xs text-slate-400 mt-4">No results found.</p>
                     )}
                  </div>
               </div>
            )}

            {/* SHARED INFO CARD */}
            <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-200 space-y-4">
               <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2"><Globe size={12}/> Purchase Context</h3>
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[9px] font-bold text-slate-400">Source</label>
                     <select 
                        className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                        value={platform}
                        onChange={e => setPlatform(e.target.value as Platform)}
                     >
                        <option value="kleinanzeigen.de">Kleinanzeigen</option>
                        <option value="ebay.de">eBay</option>
                        <option value="Other">Other</option>
                     </select>
                  </div>
                  <div className="space-y-1">
                     <label className="text-[9px] font-bold text-slate-400">Payment</label>
                     <select 
                        className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                        value={payment}
                        onChange={e => setPayment(e.target.value as PaymentType)}
                     >
                        {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                     </select>
                  </div>
               </div>
               
               {platform === 'kleinanzeigen.de' && (
                  <div className="pt-2 border-t border-slate-200/50 space-y-3">
                     <div className="flex gap-2">
                        <input 
                           placeholder="Chat URL..."
                           className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                           value={chatUrl}
                           onChange={e => setChatUrl(e.target.value)}
                        />
                        <label className="p-2 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100">
                           <Upload size={14} className="text-slate-400"/>
                           <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload}/>
                        </label>
                     </div>
                     {chatImage && (
                        <div className="flex items-center gap-2 text-[10px] text-emerald-600 bg-emerald-50 p-2 rounded-xl border border-emerald-100">
                           <CheckCircle2 size={12}/> Screenshot Attached
                        </div>
                     )}
                  </div>
               )}
            </div>
         </div>

         {/* RIGHT: DRAFT LIST */}
         <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
               <div className="flex items-center gap-3">
                  <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
                     <Layers size={20}/>
                  </div>
                  <div>
                     <h3 className="text-lg font-black text-slate-900">Items to Import</h3>
                     <p className="text-xs text-slate-500 font-bold">{items.length} items added</p>
                  </div>
               </div>
               <button onClick={distributeEvenly} className="text-[10px] font-black uppercase text-blue-500 hover:bg-blue-50 px-3 py-2 rounded-xl transition-all flex items-center gap-2">
                  <Calculator size={14}/> Reset Split
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
               {items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                     <ShoppingBag size={48} className="mb-4 text-slate-300"/>
                     <p className="font-black text-slate-400 text-sm uppercase tracking-widest">List is empty</p>
                     <p className="text-xs text-slate-400 mt-2 max-w-xs">Use the panel on the left to build your inventory list.</p>
                  </div>
               ) : (
                  items.map((item, idx) => (
                     <div key={item.id} className="flex items-center gap-4 p-3 bg-white border border-slate-100 rounded-2xl shadow-sm group hover:border-blue-200 transition-all relative">
                        {item.isDefective && <div className="absolute top-0 right-0 p-1 bg-red-100 text-red-600 text-[8px] font-black uppercase rounded-bl-lg rounded-tr-2xl">Defekt</div>}
                        <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 flex items-center justify-center font-black text-xs shrink-0">
                           {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2">
                              <p className="font-black text-slate-900 text-sm truncate">{item.name}</p>
                              <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[9px] font-bold uppercase">{item.subCategory || item.category}</span>
                           </div>
                           {item.note && <p className="text-[10px] text-slate-400 truncate">{item.note}</p>}
                        </div>
                        
                        <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 pr-3 border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-50 transition-all">
                           <span className="text-[10px] font-bold text-slate-400 pl-2">€</span>
                           <input 
                              type="number"
                              className="w-16 bg-transparent text-right font-black text-sm outline-none text-slate-900"
                              placeholder={autoSplitValue.toFixed(2)}
                              value={item.manualCost !== undefined ? item.manualCost : ''}
                              onChange={e => updateItemCost(item.id, e.target.value)}
                           />
                        </div>

                        <button 
                           onClick={() => handleRemoveItem(item.id)}
                           className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                           <Trash2 size={16}/>
                        </button>
                     </div>
                  ))
               )}
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-200">
               {items.length >= 2 && (
                  <label className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${addAsBundle ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-400'}`}>
                        <Package size={16}/>
                     </div>
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">Add as bundle?</span>
                        <span className="text-[10px] text-slate-400">Creates one bundle item with child components, margin calculated from children</span>
                     </div>
                     <input type="checkbox" checked={addAsBundle} onChange={e => setAddAsBundle(e.target.checked)} className="hidden"/>
                     {addAsBundle && <CheckCircle2 size={16} className="text-purple-500"/>}
                  </label>
               )}
               {addAsBundle && items.length >= 2 && (
                  <div className="mb-4">
                     <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest block mb-1">Bundle name</label>
                     <input 
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                        placeholder={`Bundle: ${items[0]?.name || 'Item 1'} + ${items.length - 1} more`}
                        value={bundleName}
                        onChange={e => setBundleName(e.target.value)}
                     />
                  </div>
               )}
               {aiAvailable && (
                  <label className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${parseSpecsBeforeImport ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                        <Sparkles size={16}/>
                     </div>
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">Parse tech specs with AI before import</span>
                        <span className="text-[10px] text-slate-400">Fills specs from product knowledge so you don't need to edit later</span>
                     </div>
                     <input type="checkbox" checked={parseSpecsBeforeImport} onChange={e => setParseSpecsBeforeImport(e.target.checked)} className="hidden"/>
                     {parseSpecsBeforeImport && <CheckCircle2 size={16} className="text-amber-500"/>}
                  </label>
               )}
               <div className="flex justify-between items-center mb-6 text-xs font-bold text-slate-500">
                  <span>Total Paid: <span className="text-slate-900">€{totalCost.toFixed(2)}</span></span>
                  <span>Allocated: <span className={Math.abs(allocatedSum + (itemsWithoutManualCost * autoSplitValue) - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-500'}>€{(allocatedSum + (itemsWithoutManualCost * autoSplitValue)).toFixed(2)}</span></span>
               </div>
               <button 
                  onClick={handleSubmit}
                  disabled={items.length === 0 || parsingSpecs}
                  className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-3"
               >
                  {parsingSpecs ? (
                     <>
                        <Loader2 size={18} className="animate-spin"/> {parseProgress || 'Parsing…'}
                     </>
                  ) : (
                     <>
                        <Save size={18}/> {addAsBundle && items.length >= 2 ? `Confirm Import as Bundle (${items.length} items)` : `Confirm Import (${items.length})`}
                     </>
                  )}
               </button>
            </div>
         </div>
      </div>
    </div>
  );
};

export default BulkItemForm;
