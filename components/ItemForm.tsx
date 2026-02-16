
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, Save, Plus, Trash2, Calendar, Globe, CreditCard, 
  ShoppingBag, Calculator, Layers, Box, ChevronDown, 
  MessageCircle, Link as LinkIcon, Upload, Search, Database, 
  Cpu, Monitor, HardDrive, Zap, Wind, AlertCircle, CheckCircle2, Copy,
  Fan, Lightbulb, Keyboard, Mouse, Tv, MoreHorizontal, Cable, Laptop as LaptopIcon, Wrench,
  Wand2, Sliders, X, History
} from 'lucide-react';
import { InventoryItem, ItemStatus, Platform, PaymentType } from '../types';
import { CATEGORY_IMAGES, getSpecOptions } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';
import { getCompatibleItemsForItem } from '../services/compatibility';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  categories: Record<string, string[]>;
  onAddCategory: (category: string, subcategory?: string) => void;
  categoryFields: Record<string, string[]>;
  initialData?: InventoryItem;
  onClose?: () => void;
  isModal?: boolean;
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
  'Trade',
  'Other'
];

const ItemForm: React.FC<Props> = ({ onSave, items, initialData, categories, onAddCategory, categoryFields = {}, onClose, isModal = false }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPcBuilderMode = searchParams.get('mode') === 'pc_builder';

  const [formData, setFormData] = useState<Partial<InventoryItem>>(initialData || {
    name: '',
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyPrice: 0,
    buyDate: new Date().toISOString().split('T')[0],
    status: ItemStatus.IN_STOCK,
    buyPaymentType: 'Cash',
    platformBought: 'kleinanzeigen.de',
    specs: {},
    vendor: ''
  });

  const [configStep, setConfigStep] = useState<'CATEGORY' | 'DETAILS' | 'DONE'>('CATEGORY');
  const [generatingSpecs, setGeneratingSpecs] = useState(false);
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);

  useEffect(() => {
    // Priority: initialData (Modal/Prop) -> ID (URL) -> Default
    if (initialData) {
       setFormData(initialData);
       setConfigStep('DONE');
    } else if (id) {
      const existing = items.find(i => i.id === id);
      if (existing) {
        setFormData(existing);
        setConfigStep('DONE');
      }
    } else {
       // New item default
       setConfigStep('CATEGORY');
    }
  }, [id, items, initialData]);

  const compatibleGroups = useMemo(() => {
    const current = { ...formData, id: formData.id || 'temp' } as InventoryItem;
    return getCompatibleItemsForItem(current, items);
  }, [formData.category, formData.subCategory, formData.specs, formData.id, items]);

  const nameSuggestions = useMemo(() => {
    const q = (formData.name || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return items
      .filter((i) => i.id !== formData.id && i.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, formData.name, formData.id]);

  const applyItemFromHistory = useCallback((template: InventoryItem) => {
    setFormData((prev) => ({
      ...prev,
      name: template.name,
      category: template.category,
      subCategory: template.subCategory,
      specs: template.specs ? { ...template.specs } : {},
      vendor: template.vendor ?? prev.vendor,
      platformBought: template.platformBought ?? prev.platformBought,
      buyPaymentType: template.buyPaymentType ?? prev.buyPaymentType,
      comment1: template.comment1 ?? prev.comment1,
    }));
    setConfigStep('DONE');
    setNameSuggestionsOpen(false);
  }, []);

  const handleAutoFillSpecs = async () => {
    if (!formData.name) return alert("Please enter an item name.");
    
    // Provide current category as context
    const categoryContext = formData.category || 'Unknown';
    setGeneratingSpecs(true);
    
    // Get currently active fields to instruct AI
    const activeKey = `${formData.category}:${formData.subCategory}`;
    const definedFields = categoryFields[activeKey] || categoryFields[formData.category || ''] || [];
    
    try {
      // AI returns specs from product knowledge; we merge all into the item (existing fields + new ones)
      const result = await generateItemSpecs(formData.name, categoryContext, definedFields);
      
      let newSpecs = { ...(formData.specs || {}) };
      const returnedSpecs = result.specs || {};

      Object.entries(returnedSpecs).forEach(([k, v]) => {
         if (v === undefined || v === null || v === '') return;
         const keyToUse = definedFields.length > 0
            ? (definedFields.find(df => df.toLowerCase() === k.toLowerCase()) || k)
            : k;
         newSpecs[keyToUse] = v;
      });

      const updates: Partial<InventoryItem> = {
         specs: newSpecs as Record<string, string|number>
      };

      if (result.standardizedName) {
         updates.name = result.standardizedName;
      }
      
      if (result.vendor) {
         updates.vendor = result.vendor;
      }

      setFormData(prev => ({ ...prev, ...updates }));
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'Failed to look up specs.';
      alert(msg.includes('API key') ? `${msg}\n\nAdd the key in .env and restart the app.` : msg);
    } finally {
      setGeneratingSpecs(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const newItem: InventoryItem = {
      ...formData as InventoryItem,
      id: formData.id || `item-${Date.now()}`,
      imageUrl: formData.imageUrl || CATEGORY_IMAGES[formData.subCategory || formData.category || 'Components']
    };

    onSave([newItem]);
    
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };

  const renderSpecsEditor = () => {
    const keys = categoryFields[`${formData.category}:${formData.subCategory}`] || categoryFields[formData.category || ''] || [];
    // Always include some default keys if not present
    const defaultKeys = ['Condition', 'Warranty', 'Box Included'];
    const allKeys = Array.from(new Set([...keys, ...defaultKeys, ...Object.keys(formData.specs || {})]));

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allKeys.map(key => {
          const options = getSpecOptions(key);
          const hasOptions = options.length > 0;
          const listId = `list-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;

          return (
            <div key={key} className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-slate-400">{key}</label>
              
              <input 
                list={hasOptions ? listId : undefined}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                value={formData.specs?.[key] || ''}
                onChange={e => setFormData({ ...formData, specs: { ...formData.specs, [key]: e.target.value } })}
                placeholder={hasOptions ? "Select or type..." : "Enter value..."}
              />
              
              {hasOptions && (
                <datalist id={listId}>
                  {options.map((opt, i) => (
                    <option key={i} value={opt} />
                  ))}
                </datalist>
              )}
            </div>
          );
        })}
        <button 
           type="button" 
           onClick={() => {
              const newKey = prompt("New Spec Field Name:");
              if(newKey) setFormData({ ...formData, specs: { ...formData.specs, [newKey]: '' } });
           }}
           className="flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-all"
        >
           <Plus size={14}/> Add Field
        </button>
      </div>
    );
  };

  const renderCategorySelection = () => (
     <div className="space-y-6 animate-in slide-in-from-right-4">
        <h2 className="text-2xl font-black text-slate-900">Select Category</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
           {Object.keys(categories).map(cat => (
              <button 
                 key={cat}
                 onClick={() => setFormData({ ...formData, category: cat })}
                 className={`p-6 rounded-[2rem] border-2 text-left transition-all group relative overflow-hidden ${formData.category === cat ? 'bg-blue-600 border-blue-600 text-white shadow-xl' : 'bg-white border-slate-100 hover:border-blue-200'}`}
              >
                 <span className="relative z-10 font-black text-lg">{cat}</span>
                 {formData.category === cat && <CheckCircle2 className="absolute top-4 right-4 text-white/20" size={40}/>}
              </button>
           ))}
        </div>
        
        {formData.category && (
           <div className="space-y-4 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Subcategory</h3>
              <div className="flex flex-wrap gap-2">
                 {categories[formData.category]?.map(sub => (
                    <button 
                       key={sub}
                       onClick={() => {
                          setFormData({ ...formData, subCategory: sub });
                          setConfigStep('DONE');
                       }}
                       className={`px-5 py-3 rounded-xl font-bold text-xs transition-all ${formData.subCategory === sub ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                       {sub}
                    </button>
                 ))}
                 {!categories[formData.category] && (
                    <p className="text-xs text-red-400 font-bold">Category '{formData.category}' config not found.</p>
                 )}
              </div>
           </div>
        )}
     </div>
  );

  const containerClass = isModal ? "h-full flex flex-col" : "max-w-5xl mx-auto space-y-8 pb-32 animate-in fade-in duration-500";
  const isSold = formData.status === ItemStatus.SOLD || formData.status === ItemStatus.TRADED;

  return (
    <div className={containerClass}>
      {!isModal && (
        <header className="flex items-center gap-4">
           <button onClick={() => navigate(-1)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={24}/></button>
           <h1 className="text-3xl font-black text-slate-900 tracking-tight">{id ? 'Edit Item' : 'New Asset'}</h1>
        </header>
      )}

      {isModal && configStep === 'DONE' && (
         <div className="mb-4 shrink-0">
            <h2 className="text-xl font-black text-slate-900">Editing Asset</h2>
            <p className="text-xs text-slate-500">{formData.name}</p>
         </div>
      )}

      <div className={`flex-1 ${isModal ? 'overflow-y-auto scrollbar-hide -mx-4 px-4' : ''}`}>
        {configStep === 'CATEGORY' ? renderCategorySelection() : (
           <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
              <div className="lg:col-span-8 space-y-6">
                 <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                       <div className="space-y-2 relative">
                          <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Item Name</label>
                          <input 
                             autoFocus={!id && !initialData}
                             className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:border-blue-500 focus:bg-white transition-all"
                             placeholder="e.g. MSI GeForce RTX 3060 Gaming X — type to suggest from history"
                             value={formData.name}
                             onChange={e => setFormData({ ...formData, name: e.target.value })}
                             onFocus={() => setNameSuggestionsOpen(true)}
                             onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 180)}
                          />
                          {nameSuggestionsOpen && nameSuggestions.length > 0 && (
                            <ul className="absolute z-20 left-0 right-0 mt-1 py-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto">
                              <li className="px-4 py-2 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100">
                                Pick from history to copy category, specs & more
                              </li>
                              {nameSuggestions.map((item) => (
                                <li
                                  key={item.id}
                                  className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyItemFromHistory(item);
                                  }}
                                >
                                  <p className="font-bold text-slate-900">{item.name}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {item.category} / {item.subCategory || '—'}
                                    {item.vendor ? ` · ${item.vendor}` : ''}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                       </div>
                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Buy Price (€)</label>
                             <input 
                                type="number"
                                step="0.01"
                                className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:border-blue-500 focus:bg-white transition-all"
                                value={formData.buyPrice}
                                onChange={e => setFormData({ ...formData, buyPrice: parseFloat(e.target.value) })}
                             />
                          </div>
                          <div className="space-y-2">
                             <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Buy Date</label>
                             <input 
                                type="date"
                                className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-blue-500 focus:bg-white transition-all"
                                value={formData.buyDate}
                                onChange={e => setFormData({ ...formData, buyDate: e.target.value })}
                             />
                          </div>
                       </div>
                    </div>

                    {/* Specs & AI */}
                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 space-y-4">
                       <div className="flex justify-between items-center">
                          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><Sliders size={16}/> Tech Specs</h3>
                          <button 
                             type="button"
                             onClick={handleAutoFillSpecs}
                             disabled={generatingSpecs}
                             title="Look up this product (e.g. i7-12700K) and fill in specs from the web — cores, threads, clock, TDP, etc. Adds new spec fields if needed."
                             className="text-[10px] font-black uppercase bg-white border border-blue-100 text-blue-600 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-50 transition-all disabled:opacity-50"
                          >
                             {generatingSpecs ? <Wand2 size={12} className="animate-spin"/> : <Wand2 size={12}/>}
                             {generatingSpecs ? 'Looking up specs…' : `Parse specs from web${getSpecsAIProvider() ? ` (${getSpecsAIProvider()})` : ''}`}
                          </button>
                       </div>
                       {renderSpecsEditor()}
                    </div>

                    {/* Compatible with (CPU / Motherboard / RAM) — beyond PC Builder */}
                    {compatibleGroups.length > 0 && (
                      <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 space-y-4">
                        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                          <LinkIcon size={16} className="text-blue-500" />
                          Compatible with
                        </h3>
                        <p className="text-xs text-slate-500">Other inventory items that match this part’s socket or memory type.</p>
                        <div className="space-y-4">
                          {compatibleGroups.map((group) => (
                            <div key={group.label}>
                              <p className="text-[10px] font-black uppercase text-slate-400 mb-2">{group.label}</p>
                              <ul className="flex flex-wrap gap-2">
                                {group.items.map((i) => (
                                  <li key={i.id}>
                                    <Link
                                      to={`/panel/edit/${i.id}`}
                                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-all"
                                    >
                                      {i.name}
                                      <ChevronDown size={12} className="rotate-[-90deg] text-slate-400" />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Description / Notes */}
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Notes / Condition</label>
                       <textarea 
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-sm outline-none focus:border-blue-500 focus:bg-white transition-all h-32 resize-none"
                          placeholder="e.g. Minor scratches, box included..."
                          value={formData.comment1}
                          onChange={e => setFormData({ ...formData, comment1: e.target.value })}
                       />
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-4 space-y-6">
                 {/* Context Info */}
                 <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-4">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400">Purchase Info</h3>
                    
                    <div className="space-y-1">
                       <label className="text-[10px] font-bold text-slate-400">Category</label>
                       <button type="button" onClick={() => setConfigStep('CATEGORY')} className="w-full text-left px-4 py-3 bg-slate-50 rounded-xl font-bold text-sm flex justify-between items-center group hover:bg-slate-100">
                          <span>{formData.category} / {formData.subCategory}</span>
                          <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600"/>
                       </button>
                    </div>

                    <div className="space-y-1">
                       <label className="text-[10px] font-bold text-slate-400">Source Platform</label>
                       <select 
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold text-xs outline-none"
                          value={formData.platformBought}
                          onChange={e => setFormData({ ...formData, platformBought: e.target.value as Platform })}
                       >
                          <option value="kleinanzeigen.de">Kleinanzeigen</option>
                          <option value="ebay.de">eBay</option>
                          <option value="Other">Other</option>
                       </select>
                    </div>

                    <div className="space-y-1">
                       <label className="text-[10px] font-bold text-slate-400">Payment Sent</label>
                       <select 
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold text-xs outline-none"
                          value={formData.buyPaymentType}
                          onChange={e => setFormData({ ...formData, buyPaymentType: e.target.value as PaymentType })}
                       >
                          {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                       </select>
                    </div>

                    {/* Price & sale history */}
                 <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-4">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <History size={14} /> Price & sale history
                    </h3>
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center gap-2 text-slate-700">
                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                        <span className="font-bold">Acquired</span>
                        <span className="text-slate-500">{formData.buyDate ? new Date(formData.buyDate).toLocaleDateString() : '—'}</span>
                        <span className="font-black text-slate-900">€{Number(formData.buyPrice || 0).toFixed(2)}</span>
                      </div>
                      {(formData.priceHistory || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((entry, i) => (
                        <div key={`${entry.date}-${entry.type}-${i}`} className="flex items-center gap-2 text-slate-600 pl-4 border-l-2 border-slate-200 ml-0.5">
                          <span className="font-medium">{entry.type === 'buy' ? 'Cost' : 'Sell price'} updated</span>
                          <span className="text-slate-400">{new Date(entry.date).toLocaleDateString()}</span>
                          {entry.previousPrice != null && (
                            <span className="text-slate-400">€{entry.previousPrice.toFixed(2)} →</span>
                          )}
                          <span className="font-bold text-slate-800">€{entry.price.toFixed(2)}</span>
                        </div>
                      ))}
                      {(formData.status === ItemStatus.SOLD || formData.status === ItemStatus.TRADED) && formData.sellDate && (
                        <div className="flex items-center gap-2 text-emerald-700 font-bold pt-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span>Sold</span>
                          <span className="text-slate-500 font-medium">{new Date(formData.sellDate).toLocaleDateString()}</span>
                          <span>€{(formData.sellPrice ?? 0).toFixed(2)}</span>
                        </div>
                      )}
                      {!(formData.priceHistory && formData.priceHistory.length > 0) && formData.status !== ItemStatus.SOLD && formData.status !== ItemStatus.TRADED && (
                        <p className="text-slate-400 text-[10px]">Price changes will appear here when you edit buy or sell price.</p>
                      )}
                    </div>
                 </div>

                    {isSold && (
                        <div className="animate-in slide-in-from-bottom-2 fade-in space-y-4 border-t border-slate-100 pt-4 mt-2">
                           <h3 className="font-black text-xs uppercase tracking-widest text-emerald-500">Sales Info</h3>
                           
                           <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400">Sold On</label>
                              <select 
                                 className="w-full px-4 py-3 bg-emerald-50 text-emerald-900 border border-emerald-100 rounded-xl font-bold text-xs outline-none"
                                 value={formData.platformSold}
                                 onChange={e => setFormData({ ...formData, platformSold: e.target.value as Platform })}
                              >
                                 <option value="kleinanzeigen.de">Kleinanzeigen</option>
                                 <option value="ebay.de">eBay</option>
                                 <option value="Other">Other</option>
                              </select>
                           </div>

                           <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400">Payment Received</label>
                              <select 
                                 className="w-full px-4 py-3 bg-emerald-50 text-emerald-900 border border-emerald-100 rounded-xl font-bold text-xs outline-none"
                                 value={formData.paymentType}
                                 onChange={e => setFormData({ ...formData, paymentType: e.target.value as PaymentType })}
                              >
                                 {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                           </div>
                        </div>
                    )}
                 </div>

                 <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black uppercase text-xs tracking-widest shadow-xl hover:bg-black transition-all flex items-center justify-center gap-2">
                    <Save size={18}/> Save Asset
                 </button>
                 
                 {isModal && (
                    <button type="button" onClick={onClose} className="w-full py-4 bg-slate-100 text-slate-500 rounded-[2rem] font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-all">
                       Cancel
                    </button>
                 )}
              </div>
           </form>
        )}
      </div>
    </div>
  );
};

export default ItemForm;
