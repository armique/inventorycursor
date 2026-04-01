
import React, { useState, useEffect, useMemo } from 'react';
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
import { formatEUR, parseLocaleMoney } from '../utils/formatMoney';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { CATEGORY_IMAGES, searchAllHardware, HardwareMetadata } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider, requestAIJson } from '../services/specsAI';

interface Props {
  onSave: (newItems: InventoryItem[]) => void;
  categories?: Record<string, string[]>;
  onAddCategory?: (category: string, subcategory?: string) => void;
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

type CostSplitMode = 'EQUAL' | 'SMART';
type TextImportMode = 'AS_IS' | 'AI';

interface ParsedTextItem {
  name: string;
  quantity?: number;
  category?: string;
  subCategory?: string;
  note?: string;
  isDefective?: boolean;
  specs?: Record<string, string | number>;
  vendor?: string;
}

const CATEGORY_KEYS = Object.keys(HIERARCHY_CATEGORIES);

function estimateDraftWeight(item: DraftItem): number {
  const sub = (item.subCategory || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  const bySub: Record<string, number> = {
    'graphics cards': 6.0,
    'processors': 4.2,
    'motherboards': 2.6,
    'ram': 1.8,
    'storage (ssd/hdd)': 1.6,
    'power supplies': 1.4,
    'cases': 1.1,
    'cooling': 1.0,
    'monitors': 1.7,
    'gaming laptop': 5.0,
    'consoles': 3.2,
  };
  let w = bySub[sub] ?? 1.0;

  // Lightweight "smart" bumps by model/tier hints in the title.
  if (/(rtx|radeon|rx\s?\d{4,5}|gtx)/i.test(name)) w *= 1.35;
  if (/(i9|i7|ryzen\s?9|ryzen\s?7)/i.test(name)) w *= 1.2;
  if (/(4090|5090|4080|5080|7900\s?xtx)/i.test(name)) w *= 1.35;
  if (/(64gb|48gb|32gb|2tb|4tb)/i.test(name)) w *= 1.1;
  if (item.isDefective) w *= 0.6;

  return Math.max(0.3, w);
}

function normalizeCategory(input?: string): string {
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return 'Components';
  const match = CATEGORY_KEYS.find((c) => c.toLowerCase() === raw);
  return match || 'Components';
}

function normalizeSubCategory(category: string, sub?: string): string {
  const options = HIERARCHY_CATEGORIES[category] || [];
  if (!options.length) return 'Spare Parts';
  const raw = (sub || '').trim().toLowerCase();
  const match = options.find((s) => s.toLowerCase() === raw);
  return match || options[0];
}

function inferCategoryFromName(name: string): { category: string; subCategory: string } {
  const n = name.toLowerCase();
  if (/(rtx|gtx|radeon|rx\s?\d{3,5}|graphics card|grafikkarte)/i.test(n)) return { category: 'Components', subCategory: 'Graphics Cards' };
  if (/(intel core|ryzen|threadripper|cpu|prozessor)/i.test(n)) return { category: 'Components', subCategory: 'Processors' };
  if (/(mainboard|motherboard|b650|b760|x670|z790|socket\s?(am|lga))/i.test(n)) return { category: 'Components', subCategory: 'Motherboards' };
  if (/(ddr4|ddr5|ram|memory|2x|4x\s?\d+gb)/i.test(n)) return { category: 'Components', subCategory: 'RAM' };
  if (/(ssd|hdd|nvme|m\.2|tb\b|gb\b)/i.test(n)) return { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
  if (/(netzteil|power supply|psu|watt|80\+)/i.test(n)) return { category: 'Components', subCategory: 'Power Supplies' };
  if (/(geh[aä]use|case|micro-atx|matx|atx case)/i.test(n)) return { category: 'Components', subCategory: 'Cases' };
  if (/(aio|k[uü]hler|cooler|liquid freezer|fan|l[uü]fter|120mm|140mm)/i.test(n)) return { category: 'Components', subCategory: 'Cooling' };
  if (/(laptop|notebook|macbook)/i.test(n)) return { category: 'Laptops', subCategory: 'Gaming Laptop' };
  if (/(monitor|display|hz|ips|oled)/i.test(n)) return { category: 'Peripherals', subCategory: 'Monitors' };
  return { category: 'Misc', subCategory: 'Spare Parts' };
}

function parseBulkTextLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•▸\-*]+/, '').trim())
    .filter(Boolean);
}

function parseQuantityAndName(rawLine: string): { name: string; quantity: number } {
  const m = rawLine.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (!m) return { name: rawLine, quantity: 1 };
  return { quantity: Math.max(1, parseInt(m[1], 10) || 1), name: m[2].trim() };
}

const BulkItemForm: React.FC<Props> = ({ onSave, categories = HIERARCHY_CATEGORIES, onAddCategory, categoryFields = {} }) => {
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
  const [bundleHasOVP, setBundleHasOVP] = useState(false);
  const [bundleHasIOShield, setBundleHasIOShield] = useState(false);
  const [allItemsHaveOVP, setAllItemsHaveOVP] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HardwareMetadata[]>([]);
  
  // Manual Inputs
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>('Components');
  const [newSubCategory, setNewSubCategory] = useState<string>('Graphics Cards');
  const [newNote, setNewNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [newDefective, setNewDefective] = useState(false);
  const [costSplitMode, setCostSplitMode] = useState<CostSplitMode>('EQUAL');
  const [itemImageUrls, setItemImageUrls] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkTextBusy, setBulkTextBusy] = useState(false);
  const [bulkTextStatus, setBulkTextStatus] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

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
  const autoCostsById = useMemo(() => {
    const withoutManual = items.filter((i) => i.manualCost === undefined);
    if (withoutManual.length === 0 || unallocatedCost <= 0) return {} as Record<string, number>;

    if (costSplitMode === 'EQUAL') {
      const each = unallocatedCost / withoutManual.length;
      return Object.fromEntries(withoutManual.map((i) => [i.id, each]));
    }

    const weighted = withoutManual.map((i) => ({ id: i.id, weight: estimateDraftWeight(i) }));
    const weightSum = weighted.reduce((s, x) => s + x.weight, 0) || 1;
    const totalCents = Math.round(unallocatedCost * 100);
    const withRaw = weighted.map((x) => {
      const rawCents = (totalCents * x.weight) / weightSum;
      const base = Math.floor(rawCents);
      const frac = rawCents - base;
      return { ...x, base, frac };
    });
    let used = withRaw.reduce((s, x) => s + x.base, 0);
    let remain = totalCents - used;
    withRaw.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < withRaw.length && remain > 0; i++, remain--) {
      withRaw[i].base += 1;
    }
    return Object.fromEntries(withRaw.map((x) => [x.id, x.base / 100]));
  }, [items, unallocatedCost, costSplitMode]);
  const allocatedTotal = items.reduce(
    (sum, item) => sum + (item.manualCost !== undefined ? item.manualCost : (autoCostsById[item.id] ?? 0)),
    0
  );

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
    setEditingItemId((curr) => (curr === id ? null : curr));
  };

  const applyParsedItems = (parsed: ParsedTextItem[], importMode: TextImportMode) => {
    const appended: DraftItem[] = [];
    for (const row of parsed) {
      const quantity = Math.max(1, Math.floor(Number(row.quantity || 1) || 1));
      const baseName = (row.name || '').trim();
      if (!baseName) continue;
      const inferred = inferCategoryFromName(baseName);
      const category = importMode === 'AS_IS' ? newCategory : normalizeCategory(row.category || inferred.category);
      const subCategory = importMode === 'AS_IS'
        ? normalizeSubCategory(newCategory, newSubCategory)
        : normalizeSubCategory(category, row.subCategory || inferred.subCategory);
      for (let i = 0; i < quantity; i++) {
        appended.push({
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`,
          name: baseName,
          category,
          subCategory,
          note: row.note || '',
          specs: row.specs,
          vendor: row.vendor,
          isDefective: !!row.isDefective,
        });
      }
    }
    if (!appended.length) return;
    setItems((prev) => [...prev, ...appended]);
    setBulkText('');
    setBulkTextStatus(`Added ${appended.length} item(s) to review list. Edit if needed, then confirm import.`);
  };

  const handleAddBulkTextAsIs = () => {
    const lines = parseBulkTextLines(bulkText);
    if (!lines.length) return;
    const parsed = lines.map((line) => {
      const { name, quantity } = parseQuantityAndName(line);
      return { name, quantity } as ParsedTextItem;
    });
    applyParsedItems(parsed, 'AS_IS');
  };

  const handleAddGlobalCategory = () => {
    if (!onAddCategory) return;
    const category = (window.prompt('New category name (global):') || '').trim();
    if (!category) return;
    const sub = (window.prompt('Optional default subcategory for this category:') || '').trim();
    onAddCategory(category, sub || undefined);
    setNewCategory(category);
    if (sub) setNewSubCategory(sub);
  };

  const handleParseBulkTextWithAI = async () => {
    const lines = parseBulkTextLines(bulkText);
    if (!lines.length) return;
    if (!aiAvailable) {
      const parsed = lines.map((line) => {
        const { name, quantity } = parseQuantityAndName(line);
        const guessed = inferCategoryFromName(name);
        return { name, quantity, category: guessed.category, subCategory: guessed.subCategory } as ParsedTextItem;
      });
      applyParsedItems(parsed, 'AI');
      return;
    }
    setBulkTextBusy(true);
    setBulkTextStatus(`Parsing ${lines.length} line(s) with AI…`);
    try {
      const prompt = `You are parsing bulk inventory item text into structured data for a PC hardware inventory app.
Return JSON only (no markdown) with exact structure:
{"items":[{"name":"string","quantity":1,"category":"PC|Laptops|Components|Gadgets|Peripherals|Network|Software|Bundle|Misc","subCategory":"string","note":"string","isDefective":false,"vendor":"string","specs":{"key":"value"}}]}

Rules:
- Keep categories limited to: ${CATEGORY_KEYS.join(', ')}
- SubCategory should fit the category and be concise.
- Parse quantity from prefixes like "2x ...". If no quantity, use 1.
- Extract useful specs when obvious from the title (e.g. VRAM, capacity, speed, wattage, form factor).
- If uncertain, choose best likely category/subCategory.

Input lines:
${lines.map((l, idx) => `${idx + 1}. ${l}`).join('\n')}`;
      const result = await requestAIJson<{ items?: ParsedTextItem[] }>(prompt);
      const parsed = Array.isArray(result?.items) ? result.items : [];
      if (!parsed.length) {
        throw new Error('AI returned no parse results.');
      }
      applyParsedItems(parsed, 'AI');
    } catch (e) {
      console.warn('Bulk text AI parsing failed, falling back to local heuristic', e);
      const fallback = lines.map((line) => {
        const { name, quantity } = parseQuantityAndName(line);
        const guessed = inferCategoryFromName(name);
        return { name, quantity, category: guessed.category, subCategory: guessed.subCategory } as ParsedTextItem;
      });
      applyParsedItems(fallback, 'AI');
      setBulkTextStatus('AI parse failed, added with local smart detection. Please review before confirm.');
    } finally {
      setBulkTextBusy(false);
    }
  };

  const updateItemCost = (id: string, val: string) => {
    const num = parseLocaleMoney(val, NaN);
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

  const normalizeImageList = (urls: (string | undefined | null)[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urls) {
      const u = (raw || '').trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  };

  const setMainItemImage = (url: string) => {
    setItemImageUrls((prev) => normalizeImageList([url, ...prev.filter((u) => u !== url)]));
  };

  const removeItemImage = (url: string) => {
    setItemImageUrls((prev) => prev.filter((u) => u !== url));
  };

  const handleItemImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const toDataUrl = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });
    try {
      const urls = (await Promise.all(files.map(toDataUrl))).filter(Boolean);
      setItemImageUrls((prev) => normalizeImageList([...prev, ...urls]));
    } catch {
      alert('Could not process one or more item images.');
    } finally {
      e.target.value = '';
    }
  };

  const distributeEvenly = () => {
     // Remove manual costs from everything so auto-calc takes over
     setItems(prev => prev.map(i => ({ ...i, manualCost: undefined })));
  };

  const handleSubmit = async () => {
    if (items.length === 0) return;

    // Check consistency
    const totalAllocated = items.reduce(
      (sum, item) => sum + (item.manualCost !== undefined ? item.manualCost : (autoCostsById[item.id] ?? 0)),
      0
    );
    if (Math.abs(totalAllocated - totalCost) > 0.1) {
        if (!window.confirm(`Warning: The sum of item costs (€${formatEUR(totalAllocated)}) does not match Total Paid (€${formatEUR(totalCost)}). Continue anyway?`)) {
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
      const finalCost = draft.manualCost !== undefined ? draft.manualCost : (autoCostsById[draft.id] ?? 0);
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
        hasOVP: !addAsBundle && allItemsHaveOVP || undefined,
        platformBought: platform,
        buyPaymentType: payment,
        kleinanzeigenBuyChatUrl: chatUrl,
        kleinanzeigenBuyChatImage: chatImage,
        imageUrl: itemImageUrls[0] || CATEGORY_IMAGES[draft.subCategory || draft.category] || CATEGORY_IMAGES[draft.category],
        imageUrls: itemImageUrls.length
          ? itemImageUrls
          : [CATEGORY_IMAGES[draft.subCategory || draft.category] || CATEGORY_IMAGES[draft.category]]
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
            buyDate: buyDate,
            isBundle: true,
            componentIds: childItems.map(i => i.id),
            comment1: `Bulk Import Bundle. Contents:\n${childItems.map(i => `- ${i.name}`).join('\n')}`,
            comment2: `Bulk Import (${itemsToImport.length} items). Source total: €${totalCost}.`,
            vendor: 'Combined',
            hasOVP: bundleHasOVP || undefined,
            hasIOShield: bundleHasIOShield || undefined,
            platformBought: platform,
            buyPaymentType: payment,
            kleinanzeigenBuyChatUrl: chatUrl,
            kleinanzeigenBuyChatImage: chatImage,
            imageUrl: childItems[0]?.imageUrl || CATEGORY_IMAGES['Components'],
            imageUrls: childItems[0]?.imageUrls || [CATEGORY_IMAGES['Components']]
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
                    type="text"
                    inputMode="decimal"
                    className="w-24 font-black text-xl outline-none text-slate-900 placeholder:text-slate-200" 
                    placeholder="0.00"
                    value={totalCost || ''}
                    onChange={e => setTotalCost(parseLocaleMoney(e.target.value, 0))}
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
                     <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Paste Text (Quick Bulk Parse)</label>
                     <textarea
                        className="w-full min-h-28 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-xs outline-none focus:ring-4 focus:ring-slate-100 transition-all"
                        placeholder={'Paste list lines here (one item per line)\nExample: ▸ ASUS TUF Gaming RTX 5070 12GB GDDR7'}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                     />
                     <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleAddBulkTextAsIs}
                          disabled={!bulkText.trim() || bulkTextBusy}
                          className="py-2.5 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-wide hover:bg-slate-200 disabled:opacity-50"
                        >
                          Add As-Is
                        </button>
                        <button
                          type="button"
                          onClick={handleParseBulkTextWithAI}
                          disabled={!bulkText.trim() || bulkTextBusy}
                          className="py-2.5 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {bulkTextBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Parse With AI
                        </button>
                     </div>
                     {bulkTextStatus && <p className="text-[10px] text-slate-500">{bulkTextStatus}</p>}
                  </div>

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

                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                     <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Category</label>
                        <select
                          className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                          value={newCategory}
                          onChange={(e) => {
                            const c = e.target.value;
                            setNewCategory(c);
                            setNewSubCategory((categories[c] || [])[0] || '');
                          }}
                        >
                          {Object.keys(categories).map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest">Subcategory</label>
                        <select
                          className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                          value={newSubCategory}
                          onChange={(e) => setNewSubCategory(e.target.value)}
                        >
                          {(categories[newCategory] || []).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                        </select>
                     </div>
                     <button
                       type="button"
                       onClick={handleAddGlobalCategory}
                       className="h-[42px] w-[42px] rounded-xl bg-emerald-100 text-emerald-700 font-black text-xl leading-none hover:bg-emerald-200"
                       title="Add global category"
                     >
                       +
                     </button>
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
                              type="text"
                              inputMode="decimal"
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

               <div className="pt-2 border-t border-slate-200/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase text-slate-400">Item photos (for all imported items)</p>
                    <label className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg cursor-pointer text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                      <Upload size={12} /> Add
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleItemImageUpload} />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                      placeholder="Paste item image URL and press Enter"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const v = imageUrlInput.trim();
                        if (!v) return;
                        setItemImageUrls((prev) => normalizeImageList([...prev, v]));
                        setImageUrlInput('');
                      }}
                    />
                  </div>
                  {itemImageUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {itemImageUrls.map((url, idx) => (
                        <div key={url} className={`p-1.5 rounded-lg border ${idx === 0 ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white'}`}>
                          <img src={url} alt="" className="w-full h-14 object-cover rounded-md border border-slate-200 bg-slate-100" />
                          <div className="flex justify-between mt-1 gap-1">
                            <button
                              type="button"
                              onClick={() => setMainItemImage(url)}
                              className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${idx === 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                            >
                              {idx === 0 ? 'Main' : 'Main'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItemImage(url)}
                              className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-600"
                            >
                              X
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
               </div>
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
               <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCostSplitMode((m) => (m === 'EQUAL' ? 'SMART' : 'EQUAL'))}
                    className={`text-[10px] font-black uppercase px-3 py-2 rounded-xl transition-all ${
                      costSplitMode === 'SMART' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title="Smart split prioritizes expensive component types (GPU/CPU/etc.)"
                  >
                    {costSplitMode === 'SMART' ? 'Smart Split: On' : 'Smart Split: Off'}
                  </button>
                  <button onClick={distributeEvenly} className="text-[10px] font-black uppercase text-blue-500 hover:bg-blue-50 px-3 py-2 rounded-xl transition-all flex items-center gap-2">
                    <Calculator size={14}/> Reset Split
                  </button>
               </div>
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
                     <div key={item.id} className="p-3 bg-white border border-slate-100 rounded-2xl shadow-sm group hover:border-blue-200 transition-all relative space-y-2">
                        {item.isDefective && <div className="absolute top-0 right-0 p-1 bg-red-100 text-red-600 text-[8px] font-black uppercase rounded-bl-lg rounded-tr-2xl">Defekt</div>}
                        <div className="flex items-center gap-4">
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
                                type="text"
                                inputMode="decimal"
                                className="w-16 bg-transparent text-right font-black text-sm outline-none text-slate-900"
                                placeholder={formatEUR(autoCostsById[item.id] ?? 0)}
                                value={item.manualCost !== undefined ? item.manualCost : ''}
                                onChange={e => updateItemCost(item.id, e.target.value)}
                             />
                          </div>

                          <button
                            type="button"
                            onClick={() => setEditingItemId((curr) => (curr === item.id ? null : item.id))}
                            className="text-[10px] font-black uppercase text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg"
                          >
                            {editingItemId === item.id ? 'Close' : 'Edit'}
                          </button>
                          <button 
                             onClick={() => handleRemoveItem(item.id)}
                             className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                             <Trash2 size={16}/>
                          </button>
                        </div>
                        {editingItemId === item.id && (
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                            <input
                              className="col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                              value={item.name}
                              onChange={(e) => setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, name: e.target.value } : x))}
                              placeholder="Item name"
                            />
                            <select
                              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                              value={item.category}
                              onChange={(e) => {
                                const nextCategory = e.target.value;
                                const nextSub = (categories[nextCategory] || [item.subCategory || ''])[0] || '';
                                setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, category: nextCategory, subCategory: nextSub } : x));
                              }}
                            >
                              {Object.keys(categories).map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                            <select
                              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                              value={item.subCategory || ''}
                              onChange={(e) => setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, subCategory: e.target.value } : x))}
                            >
                              {(categories[item.category] || []).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                            </select>
                            <input
                              className="col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                              value={item.note}
                              onChange={(e) => setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, note: e.target.value } : x))}
                              placeholder="Optional notes"
                            />
                          </div>
                        )}
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
                  <>
                     <div className="mb-4">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest block mb-1">Bundle name</label>
                        <input 
                           className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-200"
                           placeholder={`Bundle: ${items[0]?.name || 'Item 1'} + ${items.length - 1} more`}
                           value={bundleName}
                           onChange={e => setBundleName(e.target.value)}
                        />
                     </div>
                     <div className="flex flex-wrap gap-4 mb-4 p-3 bg-white rounded-xl border border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={bundleHasOVP} onChange={(e) => setBundleHasOVP(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                           <span className="text-sm font-bold text-slate-700">OVP (Original Packaging)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={bundleHasIOShield} onChange={(e) => setBundleHasIOShield(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                           <span className="text-sm font-bold text-slate-700">IO Shield</span>
                        </label>
                     </div>
                  </>
               )}
               {!addAsBundle && items.length > 0 && (
                  <label className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
                     <input type="checkbox" checked={allItemsHaveOVP} onChange={e => setAllItemsHaveOVP(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">OVP (Original Packaging)</span>
                        <span className="text-[10px] text-slate-400">All items come with original packaging</span>
                     </div>
                  </label>
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
                  <span>Total Paid: <span className="text-slate-900">€{formatEUR(totalCost)}</span></span>
                  <span>Allocated: <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-500'}>€{formatEUR(allocatedTotal)}</span></span>
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
