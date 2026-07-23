
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Save, Plus, Trash2, Calendar, Globe, CreditCard, 
  ShoppingBag, Calculator, Layers, Box, ChevronDown, 
  MessageCircle, Link as LinkIcon, Upload, Search, Database, 
  Cpu, Monitor, HardDrive, Zap, Wind, AlertCircle, CheckCircle2, Copy,
  Fan, Lightbulb, Keyboard, Mouse, Tv, MoreHorizontal, Cable, Laptop as LaptopIcon, Wrench,
  Sparkles, Loader2, Package, Ban, ScanBarcode
} from 'lucide-react';
import { InventoryItem, ItemStatus, Platform, PaymentType, BulkImportRecord, BulkImportSource } from '../types';
import {
  defaultBuyPaymentForPlatform,
  normalizeBuyPaymentForPlatform,
  paymentAfterPlatformChange,
} from '../utils/purchaseSource';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { CATEGORY_IMAGES, searchAllHardware, HardwareMetadata } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider, requestAIJson } from '../services/specsAI';
import { mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { pickSpecsAiNameVendorUpdates } from '../utils/applySpecsAiResult';
import { correctGpuVramInSpecs, shouldApplyGpuVramCorrection } from '../services/gpuVramCorrection';
import {
  buildRamKitSpecs,
  formatRamKitDisplayName,
  parseBulkLineQuantityAndName,
  resolveRamInventoryQuantity,
  resolveRamKitInfo,
} from '../utils/ramKitParse';
import {
  formatDefectSplitNote,
  lineHasDefectKeyword,
  resolveDefectCounts,
  stripConditionAnnotations,
} from '../utils/bulkTextParse';
import { filesToDataUrls, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { persistSaleProofImage, urlNeedsPhotoArchive } from '../services/inventoryImageStorage';
import {
  buildBulkImportLabel,
  createBulkImportRecord,
  resolveBulkImportSource,
} from '../utils/bulkImportHistory';
import { splitBulkImportCosts, type BulkCostSplitMode } from '../utils/bulkImportCostSplit';
import BarcodeScanPanel from './BarcodeScanPanel';
import type { BarcodeProduct } from '../services/barcodeLookup';

interface Props {
  onSave: (newItems: InventoryItem[]) => void;
  onBulkImportComplete?: (record: BulkImportRecord) => void;
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
  specsAiSuggested?: Record<string, string | number>;
  vendor?: string;
  isDefective?: boolean;
  /** Optional product image from barcode lookup (used when no shared gallery). */
  imageUrl?: string;
  /** When true, Confirm Import skips AI tech-spec parsing for this row. */
  skipAiSpecs?: boolean;
  /** Original paste line — used to re-apply defect flags after specs parse. */
  sourceLine?: string;
  /** How this draft row was added to the review list. */
  draftSource?: BulkImportSource;
}

type CostSplitMode = BulkCostSplitMode;
type TextImportMode = 'AS_IS' | 'AI';
/** How to expand Nx lines into the review list. */
type BulkQtyMode = 'INDIVIDUAL' | 'LOT';

interface ParsedTextItem {
  name: string;
  quantity?: number;
  /** Quantity from line prefix before AI/normalization (e.g. "3x …" → 3). */
  lineQuantity?: number;
  /** Original bulk text line — used when AI strips kit size from the name. */
  sourceLine?: string;
  category?: string;
  subCategory?: string;
  note?: string;
  vendor?: string;
  isDefective?: boolean;
  specs?: Record<string, string | number>;
}

const CATEGORY_KEYS = Object.keys(HIERARCHY_CATEGORIES);
const MOTHERBOARD_PATTERN =
  /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i;

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
  if (/(rtx|gtx|radeon|rx\s?\d{3,5}|quadro|tesla|firepro|nvidia\s+[qkmt]|graphics card|grafikkarte)/i.test(n))
    return { category: 'Components', subCategory: 'Graphics Cards' };
  if (/\b(i[3579]|intel\s*core|ryzen|threadripper|cpu|prozessor)\b/i.test(n) && !/mainboard|motherboard|prodesk|optiplex|elitedesk|business\s*pc/i.test(n))
    return { category: 'Components', subCategory: 'Processors' };
  if (MOTHERBOARD_PATTERN.test(n) || /socket\s?(am|lga)/i.test(n)) return { category: 'Components', subCategory: 'Motherboards' };
  if (/(ddr[2345]|ram\b|memory\b|\d+\s*[x×]\s*\d+\s*gb|12800u|10600u|1333u|2rx8|1rx8|jedec|hynix|samsung m\d|kingston (?:khx|acr)|sk hynix|crucial|mhz)/i.test(n) && !/prodesk|optiplex|elitedesk|business\s*pc|mainboard|motherboard/i.test(n))
    return { category: 'Components', subCategory: 'RAM' };
  if (/(prodesk|optiplex|elitedesk|business\s*pc|desktop\s*pc|mini\s*pc)\b/i.test(n))
    return { category: 'PC', subCategory: 'Pre-Built PC' };
  if (/(dvd|bluray|blu-ray|optical|oddd|gud\d)/i.test(n)) return { category: 'Misc', subCategory: 'Spare Parts' };
  if (/(ssd|hdd|nvme|m\.2|\b\d+\s*tb\b)/i.test(n)) return { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
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
  return parseBulkLineQuantityAndName(rawLine);
}

function reconcileCategory(name: string, category?: string, subCategory?: string): { category: string; subCategory: string } {
  const guessed = inferCategoryFromName(name);
  const aiCategory = normalizeCategory(category || guessed.category);
  const aiSub = normalizeSubCategory(aiCategory, subCategory || guessed.subCategory);

  const n = name.toLowerCase();
  if (/(prodesk|optiplex|elitedesk|business\s*pc|desktop\s*pc|mini\s*pc)\b/i.test(n)) {
    return { category: 'PC', subCategory: 'Pre-Built PC' };
  }
  if (/(dvd|bluray|blu-ray|optical|oddd|gud\d)/i.test(n)) {
    return { category: 'Misc', subCategory: 'Spare Parts' };
  }
  if (/\b(i[3579]|intel\s*core|ryzen|threadripper|cpu|prozessor)\b/i.test(n) && !/mainboard|motherboard|prodesk|optiplex|elitedesk|business\s*pc/i.test(n)) {
    return { category: 'Components', subCategory: 'Processors' };
  }
  if (/(ssd|nvme|m\.2|hdd|sata)/i.test(n)) {
    return { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
  }
  if (/(ddr4|ddr5|ram|memory|\d+\s*[x×]\s*\d+\s*gb|crucial)/i.test(n) && !/mainboard|motherboard|prodesk|business\s*pc/i.test(n)) {
    return { category: 'Components', subCategory: 'RAM' };
  }
  if (MOTHERBOARD_PATTERN.test(n)) {
    return { category: 'Components', subCategory: 'Motherboards' };
  }

  if (aiCategory !== 'Components' && guessed.category === 'Components') {
    return guessed;
  }
  if (aiCategory === 'Components' && aiSub === 'Graphics Cards' && guessed.subCategory !== 'Graphics Cards') {
    return guessed;
  }
  if (guessed.category === 'PC' && aiCategory !== 'PC') {
    return guessed;
  }
  return { category: aiCategory, subCategory: aiSub };
}

const BulkItemForm: React.FC<Props> = ({ onSave, onBulkImportComplete, categories = HIERARCHY_CATEGORIES, onAddCategory, categoryFields = {} }) => {
  const navigate = useNavigate();
  const aiAvailable = !!getSpecsAIProvider();

  // Shared State
  const [totalCost, setTotalCost] = useState<number>(0);
  /** While focused, raw text so decimals like "48," / "48." can be typed before blur. */
  const [totalCostDraft, setTotalCostDraft] = useState<string | null>(null);
  const [rowCostDrafts, setRowCostDrafts] = useState<Record<string, string>>({});
  const [buyDate, setBuyDate] = useState(new Date().toISOString().split('T')[0]);
  const [platform, setPlatform] = useState<Platform>('kleinanzeigen.de');
  const [payment, setPayment] = useState<PaymentType>(() =>
    defaultBuyPaymentForPlatform('kleinanzeigen.de')
  );
  
  // Shared Evidence
  const [chatUrl, setChatUrl] = useState('');
  const [sellerProfileUrl, setSellerProfileUrl] = useState('');
  const [chatImage, setChatImage] = useState('');

  // Items List
  const [items, setItems] = useState<DraftItem[]>([]);
  
  // Entry Form State
  const [mode, setMode] = useState<'SEARCH' | 'MANUAL' | 'SCAN'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
      ? 'SCAN'
      : 'MANUAL'
  );
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
  const [costSplitMode, setCostSplitMode] = useState<CostSplitMode>('SMART');
  const [itemImageUrls, setItemImageUrls] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkTextBusy, setBulkTextBusy] = useState(false);
  const [bulkTextStatus, setBulkTextStatus] = useState<string | null>(null);
  const [bulkQtyMode, setBulkQtyMode] = useState<BulkQtyMode>('INDIVIDUAL');
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
    return splitBulkImportCosts(
      items.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        subCategory: i.subCategory,
        isDefective: i.isDefective,
        manualCost: i.manualCost,
      })),
      totalCost,
      costSplitMode
    );
  }, [items, totalCost, costSplitMode]);
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
            isDefective: newDefective,
            draftSource: 'manual',
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
        isDefective: false,
        draftSource: 'hardware_db',
    }]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAddFromBarcode = (product: BarcodeProduct) => {
    const hwHits = searchAllHardware(product.name);
    if (hwHits[0]) {
      handleAddFromSearch(hwHits[0]);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}`,
        name: product.name,
        category: newCategory,
        subCategory: newSubCategory,
        note: product.barcode ? `EAN ${product.barcode}` : '',
        specs: {},
        vendor: product.brand || '',
        isDefective: false,
        draftSource: 'barcode',
        imageUrl: product.imageUrl,
      },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setEditingItemId((curr) => (curr === id ? null : curr));
  };

  const applyParsedItems = (parsed: ParsedTextItem[], importMode: TextImportMode) => {
    const draftSource: BulkImportSource = importMode === 'AI' ? 'paste_ai' : 'paste_as_is';
    const appended: DraftItem[] = [];
    for (const row of parsed) {
      const rawName = (row.name || '').trim();
      if (!rawName) continue;
      const sourceLine = (row.sourceLine || '').trim();
      const conditionText = `${sourceLine} ${rawName} ${row.note || ''}`;
      // Purchase qty always from leading "Nx" on the paste line — never from AI / model "-8X"
      const fromLine = sourceLine
        ? parseQuantityAndName(sourceLine)
        : { name: rawName, quantity: Math.max(1, Math.floor(Number(row.lineQuantity ?? row.quantity ?? 1) || 1)) };
      const lineQty = Math.max(1, Math.floor(fromLine.quantity || 1));
      const productFromLine = stripConditionAnnotations(fromLine.name) || fromLine.name;
      const baseName = stripConditionAnnotations(rawName) || rawName;
      const rec = importMode === 'AS_IS'
        ? { category: newCategory, subCategory: normalizeSubCategory(newCategory, newSubCategory) }
        : reconcileCategory(productFromLine || baseName, row.category, row.subCategory);
      const ramKit =
        rec.subCategory === 'RAM'
          ? resolveRamKitInfo(productFromLine || baseName, { sourceLine, specs: row.specs })
          : null;
      const inventoryQty = resolveRamInventoryQuantity(lineQty, ramKit, lineQty);
      // Prefer original paste product name so AI can't rename "-8X 8GB" into "64GB (8x8GB)"
      const displayName = ramKit
        ? formatRamKitDisplayName(productFromLine || baseName, ramKit)
        : (productFromLine || baseName);
      const { working, defective } = resolveDefectCounts(
        inventoryQty,
        conditionText,
        row.isDefective
      );
      const splitNote = formatDefectSplitNote(working, defective);

      let mergedSpecs: Record<string, string | number> = { ...(row.specs || {}) };
      if (ramKit) {
        mergedSpecs = { ...mergedSpecs, ...buildRamKitSpecs(ramKit) };
      } else if (rec.subCategory === 'RAM') {
        // Drop AI-invented kit fields when this is a single-stick / non-kit line
        const dropKeys = new Set(['Modules', 'modules', 'Kit', 'kit', 'Kit Capacity', 'Kit capacity']);
        mergedSpecs = Object.fromEntries(
          Object.entries(mergedSpecs).filter(([key]) => !dropKeys.has(key))
        );
      }
      if (shouldApplyGpuVramCorrection(rec.subCategory, displayName)) {
        mergedSpecs = correctGpuVramInSpecs(displayName, undefined, mergedSpecs);
      }

      const pushDraft = (opts: { name: string; isDefective: boolean; note: string }) => {
        appended.push({
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${appended.length}`,
          name: opts.name,
          category: rec.category,
          subCategory: rec.subCategory,
          note: opts.note,
          specs: { ...mergedSpecs },
          vendor: row.vendor,
          isDefective: opts.isDefective,
          sourceLine: sourceLine || undefined,
          draftSource,
        });
      };

      const baseNote = stripConditionAnnotations((row.note || '').trim());
      const mergeNote = (...parts: string[]) => parts.filter(Boolean).join(' · ');

      if (bulkQtyMode === 'LOT' && inventoryQty > 1) {
        const lotName = `${inventoryQty}x ${displayName}`;
        const lotDefective = defective > 0 && working === 0;
        pushDraft({
          name: lotName,
          isDefective: lotDefective || (!!row.isDefective && defective === inventoryQty),
          note: mergeNote(baseNote, splitNote || (lineHasDefectKeyword(conditionText) && !splitNote ? 'defekt' : '')),
        });
        continue;
      }

      for (let i = 0; i < working; i++) {
        pushDraft({
          name: displayName,
          isDefective: false,
          note: baseNote,
        });
      }
      for (let i = 0; i < defective; i++) {
        pushDraft({
          name: displayName,
          isDefective: true,
          note: baseNote,
        });
      }
    }
    if (!appended.length) return;
    setItems((prev) => [...prev, ...appended]);
    setBulkText('');
    const modeLabel = bulkQtyMode === 'LOT' ? 'as lot(s)' : 'individually';
    setBulkTextStatus(
      `Added ${appended.length} item(s) ${modeLabel} to review list. Edit if needed, then confirm import.`
    );
  };

  const handleAddBulkTextAsIs = () => {
    const lines = parseBulkTextLines(bulkText);
    if (!lines.length) return;
    const parsed = lines.map((line) => {
      const { name, quantity } = parseQuantityAndName(line);
      return { name, quantity, lineQuantity: quantity, sourceLine: line } as ParsedTextItem;
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
        return { name, quantity, lineQuantity: quantity, sourceLine: line, category: guessed.category, subCategory: guessed.subCategory } as ParsedTextItem;
      });
      applyParsedItems(parsed, 'AI');
      return;
    }
    setBulkTextBusy(true);
    setBulkTextStatus(`Parsing ${lines.length} line(s) with AI…`);
    try {
      const prompt = `You are parsing bulk inventory item text into structured data for a PC hardware inventory app.
You MUST return one JSON object per input line, in order — same count as lines. ${lines.length} input lines ⇒ exactly ${lines.length} objects in "items".

Return JSON only (no markdown). Keep each item compact (omit empty strings). Prefer this shape:
{"items":[{"name":"string","quantity":1,"category":"PC|Laptops|Components|...","subCategory":"string","note":"","isDefective":false,"vendor":"","specs":{}}]}

Rules:
- Keep categories limited to: ${CATEGORY_KEYS.join(', ')}
- SubCategory should fit the category and be concise.
- Parse quantity from prefixes like "2x ..." or "8x4GB ...". If no quantity, use 1.
- Leading "2x Product" / "4x Product" is a PURCHASE count (how many units bought), not a RAM kit size. Example: "2x Samsung … 4GB" → quantity=2, name without the "2x". Spaced "2x 8GB Samsung" → quantity=2, single 8GB sticks (NOT a 2x8GB kit).
- Model codes like "ACR24D4U1S1ME-8X" or "…-8X 8GB": the "-8X" is part of the part number, NEVER modules=8. Keep the full model string in name.
- IMPORTANT: Do not classify CPUs, SSD/NVMe drives, RAM, or motherboards as Graphics Cards.
- IMPORTANT: Motherboards are often listed only by chipset/model (for example A320M, B450, B550, X570, Z690, Z790, H610) without the word "motherboard". Classify those as category "Components" and subCategory "Motherboards".
- Pre-built desktops (ProDesk, OptiPlex, EliteDesk, "Business PC") → category "PC", subCategory "Pre-Built PC".
- RAM kits (e.g. "Crucial 2x8GB", "8x4GB Hynix"): ONE inventory line per kit with quantity=1 unless the line starts with a purchase count like "3x Crucial 2x8GB" (then quantity=3). Never set quantity to the stick/module count. In specs use Modules (number of sticks), GB per Stick, and Kit Capacity (modules × GB per stick).
- Defective: set isDefective=true if the line mentions defect/defekt/defective/not working/не работает/kaputt/for parts (any language). If the line has a split like "(2 working, 2 defekt)", set isDefective=false and put that text in note (the app expands OK vs Defekt rows). Strip condition parentheses from name.
- Put only essential specs in "specs" (VRAM for GPUs, GB for RAM, wattage for PSUs). Use {} if none.
- Graphics cards: VRAM = GPU memory for that chip (not system RAM).

Input lines:
${lines.map((l, idx) => `${idx + 1}. ${l}`).join('\n')}`;
      const maxTokens = Math.min(8192, 600 + lines.length * 280);
      const result = await requestAIJson<{ items?: ParsedTextItem[] }>(prompt, { maxTokens });
      let parsed = Array.isArray(result?.items) ? result.items : [];
      if (!parsed.length) {
        throw new Error('AI returned no parse results.');
      }
      parsed = parsed.map((item, i) => {
        const line = lines[i];
        const lineQuantity = line ? parseQuantityAndName(line).quantity : 1;
        return { ...item, lineQuantity, sourceLine: line };
      });
      const aiCount = parsed.length;
      if (parsed.length < lines.length) {
        for (let i = parsed.length; i < lines.length; i++) {
          const line = lines[i]!;
          const { name, quantity } = parseQuantityAndName(line);
          const guessed = inferCategoryFromName(name);
          parsed.push({ name, quantity, lineQuantity: quantity, sourceLine: line, category: guessed.category, subCategory: guessed.subCategory });
        }
      }
      applyParsedItems(parsed, 'AI');
      if (aiCount < lines.length) {
        setBulkTextStatus(
          `Added ${parsed.length} item(s). AI returned ${aiCount}/${lines.length} rows (output limit or model); ${lines.length - aiCount} filled with local detection. Review before confirm.`
        );
      }
    } catch (e) {
      console.warn('Bulk text AI parsing failed, falling back to local heuristic', e);
      const fallback = lines.map((line) => {
        const { name, quantity } = parseQuantityAndName(line);
        const guessed = inferCategoryFromName(name);
        return { name, quantity, lineQuantity: quantity, sourceLine: line, category: guessed.category, subCategory: guessed.subCategory } as ParsedTextItem;
      });
      applyParsedItems(fallback, 'AI');
      setBulkTextStatus('AI parse failed, added with local smart detection. Please review before confirm.');
    } finally {
      setBulkTextBusy(false);
    }
  };

  const commitRowCost = (id: string, raw: string) => {
    const t = raw.trim();
    if (!t) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, manualCost: undefined } : i)));
      return;
    }
    const n = parseLocaleNumber(t);
    if (!Number.isFinite(n)) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, manualCost: n } : i)));
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
    try {
      const urls = await filesToDataUrls(files);
      setItemImageUrls((prev) => normalizeImageList([...prev, ...urls]));
    } catch (err) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      alert(localImageReadErrorMessage(err, 'Could not process one or more item images.'));
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

    let galleryUrls = itemImageUrls;
    if (galleryUrls.length > 0) {
      try {
        galleryUrls = await prepareInventoryImagesForStorage(galleryUrls, { itemId: 'shared' });
      } catch {
        galleryUrls = itemImageUrls;
      }
    }

    // Parse tech specs with AI for items that don't have specs yet (skip per-row opt-out)
    if (parseSpecsBeforeImport && aiAvailable) {
      const needSpecs = itemsToImport.filter(
        (d) => !d.skipAiSpecs && (!d.specs || Object.keys(d.specs).length === 0)
      );
      if (needSpecs.length > 0) {
        setParsingSpecs(true);
        const updated = [...itemsToImport];
        for (let i = 0; i < needSpecs.length; i++) {
          const draft = needSpecs[i];
          setParseProgress(`Parsing specs… ${i + 1} / ${needSpecs.length}`);
          try {
            const categoryContext = `${draft.category}${draft.subCategory ? ` / ${draft.subCategory}` : ''}`;
            const knownKeys = resolveEssentialSpecKeys(draft.category, draft.subCategory, categoryFields);
            const result = await generateItemSpecs(draft.name, categoryContext, knownKeys);
            const idx = updated.findIndex((x) => x.id === draft.id);
            if (idx >= 0 && result.specs && Object.keys(result.specs).length > 0) {
              const mergedSpecs = mergeAiSpecsIntoEssential(
                updated[idx].specs,
                result.specs,
                draft.category,
                draft.subCategory,
                categoryFields
              );
              const prev = updated[idx];
              const conditionText = `${prev.sourceLine || ''} ${prev.name} ${prev.note || ''}`;
              const stillDefective =
                !!prev.isDefective ||
                (lineHasDefectKeyword(conditionText) &&
                  resolveDefectCounts(1, conditionText, prev.isDefective).defective > 0);
              updated[idx] = {
                ...prev,
                specs: mergedSpecs,
                specsAiSuggested: Object.keys(mergedSpecs).length ? { ...mergedSpecs } : undefined,
                isDefective: stillDefective,
                // Specs parse must not rename — keep pasted / reviewed title as-is.
                ...pickSpecsAiNameVendorUpdates(result),
              };
            }
          } catch (e) {
            console.warn('AI specs parse failed for', draft.name, e);
            // Keep original item, don't block import
          }
        }
        // After specs: re-assert defect flags from source text for every imported draft
        itemsToImport = updated.map((d) => {
          const conditionText = `${d.sourceLine || ''} ${d.name} ${d.note || ''}`;
          if (d.isDefective) return d;
          if (
            lineHasDefectKeyword(conditionText) &&
            resolveDefectCounts(1, conditionText, false).defective > 0
          ) {
            return { ...d, isDefective: true };
          }
          return d;
        });
        setParseProgress(null);
        setParsingSpecs(false);
      }
    }

    const timestamp = Date.now();
    const bulkImportId = `bulkimp-${timestamp}`;
    const importSource = resolveBulkImportSource(
      itemsToImport.map((d) => d.draftSource || 'manual')
    );

    // Archive chat screenshot to our storage (survives Imgur / host removal).
    let archivedChatImage = (chatImage || '').trim();
    if (archivedChatImage && urlNeedsPhotoArchive(archivedChatImage)) {
      try {
        archivedChatImage = await persistSaleProofImage(archivedChatImage, bulkImportId);
      } catch (err) {
        console.warn('Could not archive bulk buy chat screenshot', err);
        // Keep original (data URL / remote) on items so proof is not lost locally.
      }
    }
    const chatUrlTrimmed = (chatUrl || '').trim();
    const sellerProfileTrimmed = (sellerProfileUrl || '').trim();
    // History sync pack must not carry huge data: URLs — prefer Storage / http only.
    const historyChatImage =
      archivedChatImage && !archivedChatImage.startsWith('data:')
        ? archivedChatImage
        : undefined;

    const childItems: InventoryItem[] = itemsToImport.map((draft, index) => {
      const finalCost = draft.manualCost !== undefined ? draft.manualCost : (autoCostsById[draft.id] ?? 0);
      const fallbackImage =
        CATEGORY_IMAGES[draft.subCategory || draft.category] || CATEGORY_IMAGES[draft.category];
      const rowImage = galleryUrls[0] || draft.imageUrl || fallbackImage;
      const rowImages = galleryUrls.length
        ? galleryUrls
        : draft.imageUrl
          ? [draft.imageUrl]
          : [fallbackImage];
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
        buyPaymentType: normalizeBuyPaymentForPlatform(platform, payment),
        kleinanzeigenBuyChatUrl: chatUrlTrimmed || undefined,
        kleinanzeigenBuyChatImage: archivedChatImage || undefined,
        kleinanzeigenSellerProfileUrl: sellerProfileTrimmed || undefined,
        imageUrl: rowImage,
        imageUrls: rowImages,
        bulkImportId,
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
            category: 'Mixed Bundle',
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
            buyPaymentType: normalizeBuyPaymentForPlatform(platform, payment),
            kleinanzeigenBuyChatUrl: chatUrlTrimmed || undefined,
            kleinanzeigenBuyChatImage: archivedChatImage || undefined,
            kleinanzeigenSellerProfileUrl: sellerProfileTrimmed || undefined,
            imageUrl: childItems[0]?.imageUrl || CATEGORY_IMAGES['Components'],
            imageUrls: childItems[0]?.imageUrls || [CATEGORY_IMAGES['Components']],
            bulkImportId,
          };
          return [parentBundle, ...childItems];
        })()
      : childItems;

    const record = createBulkImportRecord({
      id: bulkImportId,
      items: inventoryItems,
      source: importSource,
      totalCost,
      buyDate,
      platformBought: platform,
      bundleId: addAsBundle ? `bundle-${timestamp}` : undefined,
      createdAt: new Date(timestamp).toISOString(),
      kleinanzeigenBuyChatUrl: chatUrlTrimmed || undefined,
      kleinanzeigenBuyChatImage: historyChatImage,
      kleinanzeigenSellerProfileUrl: sellerProfileTrimmed || undefined,
    });
    // Prefer a label from draft names when a bundle parent would dominate.
    record.label = buildBulkImportLabel(itemsToImport.map((d) => d.name));

    onSave(inventoryItems);
    onBulkImportComplete?.(record);
    navigate('/panel/inventory');
  };

  return (
    <div className="max-w-[1600px] mx-auto h-[calc(100dvh-5.5rem)] md:h-[calc(100vh-100px)] flex flex-col animate-in fade-in">
      {/* HEADER */}
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 mb-3 lg:mb-6 shrink-0 px-3 sm:px-4">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
           <button onClick={() => navigate(-1)} className="p-2.5 sm:p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all shrink-0"><ArrowLeft size={22}/></button>
           <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight truncate">Bulk Entry</h1>
              <p className="text-xs sm:text-sm text-slate-500 font-bold truncate">Add Multiple Items • One Transaction</p>
           </div>
           <button
             type="button"
             onClick={() => navigate('/panel/bulk-imports')}
             className="ml-auto lg:ml-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 shrink-0"
             title="Open bulk import history"
           >
             <Layers size={14} />
             <span className="hidden sm:inline">History</span>
           </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:gap-3 md:gap-4 bg-white p-2 md:p-3 rounded-2xl border border-slate-200 shadow-sm">
           <div className="px-3 border-r border-slate-100 min-w-[6rem]">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Total paid</label>
              <div className="flex items-center gap-1">
                 <span className="text-slate-400 font-bold">€</span>
                 <input 
                    type="text"
                    inputMode="decimal"
                    className="w-28 font-black text-xl outline-none text-slate-900 placeholder:text-slate-200" 
                    placeholder="0,00"
                    value={totalCostDraft !== null ? totalCostDraft : totalCost === 0 ? '' : String(totalCost)}
                    onFocus={() => setTotalCostDraft(totalCost === 0 ? '' : String(totalCost))}
                    onBlur={() => {
                      const raw = totalCostDraft ?? '';
                      setTotalCostDraft(null);
                      const t = raw.trim();
                      if (!t) {
                        setTotalCost(0);
                        return;
                      }
                      const n = parseLocaleNumber(t);
                      if (Number.isFinite(n)) setTotalCost(n);
                    }}
                    onChange={(e) => setTotalCostDraft(e.target.value)}
                 />
              </div>
           </div>
           <div className="px-3">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Buy date</label>
              <input 
                 type="date" 
                 className="font-bold text-sm outline-none text-slate-700 bg-transparent"
                 value={buyDate}
                 onChange={e => setBuyDate(e.target.value)}
              />
           </div>
           <div className="px-3 min-w-[9rem]">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Bought on</label>
              <select 
                 className="w-full max-w-[11rem] py-1.5 bg-transparent font-bold text-xs outline-none text-slate-800 border border-slate-200 rounded-xl px-2"
                 value={platform}
                 onChange={(e) => {
                   const next = e.target.value as Platform;
                   setPlatform(next);
                   setPayment((prev) => paymentAfterPlatformChange(next, prev));
                 }}
              >
                 <option value="kleinanzeigen.de">Kleinanzeigen</option>
                 <option value="ebay.de">eBay</option>
                 <option value="Amazon">Amazon</option>
                 <option value="In Person">In Person</option>
                 <option value="Other">Other</option>
              </select>
           </div>
           <div className="px-3 min-w-[10rem]">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest block">Paid with</label>
              <select 
                 className="w-full max-w-[13rem] py-1.5 bg-transparent font-bold text-xs outline-none text-slate-800 border border-slate-200 rounded-xl px-2"
                 value={payment}
                 onChange={(e) =>
                   setPayment(
                     normalizeBuyPaymentForPlatform(platform, e.target.value as PaymentType) ||
                       (e.target.value as PaymentType)
                   )
                 }
              >
                 {PAYMENT_METHODS.map((p) => (
                   <option key={p} value={p}>{p}</option>
                 ))}
              </select>
           </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row gap-3 lg:gap-6 overflow-y-auto lg:overflow-hidden px-3 sm:px-4 pb-[max(5.5rem,calc(4rem+env(safe-area-inset-bottom)))] lg:pb-4">
         
         {/* LEFT: ITEM BUILDER */}
         <div className="w-full lg:w-[450px] flex flex-col gap-4 lg:gap-6 shrink-0 lg:overflow-y-auto lg:pb-20 scrollbar-hide">
            
            {/* INPUT MODE TABS */}
            <div className="bg-slate-200 p-1 rounded-2xl flex font-bold text-xs">
               <button onClick={() => setMode('MANUAL')} className={`flex-1 py-3 rounded-xl transition-all ${mode === 'MANUAL' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Manual</button>
               <button onClick={() => setMode('SCAN')} className={`flex-1 py-3 rounded-xl transition-all flex items-center justify-center gap-1 ${mode === 'SCAN' ? 'bg-white shadow text-rose-600' : 'text-slate-500 hover:text-slate-700'}`}><ScanBarcode size={12} /> Scan</button>
               <button onClick={() => setMode('SEARCH')} className={`flex-1 py-3 rounded-xl transition-all ${mode === 'SEARCH' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>Database</button>
            </div>

            {mode === 'SCAN' ? (
               <div className="bg-white p-4 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-3">
                  <BarcodeScanPanel onProduct={handleAddFromBarcode} compact />
                  <p className="text-[10px] text-slate-400 px-1">
                    Each successful scan adds a row to the list. If the name matches the hardware DB, specs are filled automatically.
                  </p>
               </div>
            ) : mode === 'MANUAL' ? (
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
                          onClick={() => setBulkQtyMode('INDIVIDUAL')}
                          className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all ${
                            bulkQtyMode === 'INDIVIDUAL'
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-50 text-slate-500 border border-slate-200 hover:border-slate-300'
                          }`}
                          title="2x / 4x → separate inventory rows (split working vs defekt)"
                        >
                          Separately (Nx → N)
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkQtyMode('LOT')}
                          className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all ${
                            bulkQtyMode === 'LOT'
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-50 text-slate-500 border border-slate-200 hover:border-slate-300'
                          }`}
                          title="Keep each line as one lot item (e.g. 4x Kingston…)"
                        >
                          1 lot as written
                        </button>
                     </div>
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
                     <p className="text-[10px] text-slate-400">
                       {bulkQtyMode === 'INDIVIDUAL'
                         ? 'Nx lines expand to N items. “(2 working, 2 defekt)” → 2 OK + 2 Defekt.'
                         : 'Each Nx line becomes one lot item named like “4x Product…”.'}
                     </p>
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

            {/* Optional proof — platform & payment are in the header */}
            <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-200 space-y-4">
               <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2"><Globe size={12}/> Optional purchase proof</h3>
               <p className="text-[10px] text-slate-500 font-medium leading-snug">
                 Source and payment are set in the top bar (same as single-item add). Add a chat link or screenshot if you bought on Kleinanzeigen.
               </p>
               
               {platform === 'kleinanzeigen.de' && (
                  <div className="pt-2 border-t border-slate-200/50 space-y-3">
                     <div className="flex gap-2">
                        <input 
                           placeholder="Chat URL (kleinanzeigen.de/…)"
                           className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                           value={chatUrl}
                           onChange={e => setChatUrl(e.target.value)}
                        />
                        <label className="p-2 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100" title="Upload chat screenshot">
                           <Upload size={14} className="text-slate-400"/>
                           <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload}/>
                        </label>
                     </div>
                     <input
                        type="url"
                        placeholder="Seller profile URL (kleinanzeigen.de/s-bestandsliste…)"
                        className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                        value={sellerProfileUrl}
                        onChange={(e) => setSellerProfileUrl(e.target.value)}
                     />
                     <input
                        type="text"
                        placeholder="Or paste chat screenshot URL (imgur, etc.)"
                        className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                        value={chatImage.startsWith('data:') ? '' : chatImage}
                        onChange={(e) => setChatImage(e.target.value.trim())}
                     />
                     {chatImage && (
                        <div className="flex items-center gap-2 text-[10px] text-emerald-600 bg-emerald-50 p-2 rounded-xl border border-emerald-100">
                           <CheckCircle2 size={12}/>
                           <span className="font-bold">
                             {chatImage.startsWith('data:')
                               ? 'Screenshot attached'
                               : 'Screenshot URL set'}
                           </span>
                           {(chatImage.startsWith('data:') || /^https?:\/\//i.test(chatImage)) && (
                             <a
                               href={chatImage}
                               target="_blank"
                               rel="noreferrer"
                               className="ml-auto w-8 h-8 rounded-lg overflow-hidden border border-emerald-200 shrink-0"
                               onClick={(e) => e.stopPropagation()}
                             >
                               <img src={chatImage} alt="" className="w-full h-full object-cover" />
                             </a>
                           )}
                           <button
                             type="button"
                             onClick={() => setChatImage('')}
                             className="text-[9px] font-black uppercase text-emerald-800 hover:underline"
                           >
                             Clear
                           </button>
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
         <div className="flex-1 min-h-[40vh] lg:min-h-0 bg-white rounded-[1.75rem] lg:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
            <div className="p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
               <div className="flex items-center gap-3">
                  <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
                     <Layers size={20}/>
                  </div>
                  <div>
                     <h3 className="text-base sm:text-lg font-black text-slate-900">Items to Import</h3>
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

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2">
               {items.length === 0 ? (
                  <div className="h-full min-h-[8rem] flex flex-col items-center justify-center text-center opacity-40 py-8">
                     <ShoppingBag size={40} className="mb-3 text-slate-300"/>
                     <p className="font-black text-slate-400 text-sm uppercase tracking-widest">List is empty</p>
                     <p className="text-xs text-slate-400 mt-2 max-w-xs lg:hidden">Scan a barcode or add items above.</p>
                     <p className="text-xs text-slate-400 mt-2 max-w-xs hidden lg:block">Use the panel on the left to build your inventory list.</p>
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
                                {item.skipAiSpecs && (
                                  <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase">No AI specs</span>
                                )}
                             </div>
                             {item.note && <p className="text-[10px] text-slate-400 truncate">{item.note}</p>}
                           </div>
                          <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 pr-3 border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-50 transition-all">
                             <span className="text-[10px] font-bold text-slate-400 pl-2">€</span>
                             <input 
                                type="text"
                                inputMode="decimal"
                                className="w-20 min-w-[4.5rem] bg-transparent text-right font-black text-sm outline-none text-slate-900"
                                placeholder={formatEUR(autoCostsById[item.id] ?? 0)}
                                value={
                                  rowCostDrafts[item.id] !== undefined
                                    ? rowCostDrafts[item.id]
                                    : item.manualCost !== undefined
                                      ? String(item.manualCost)
                                      : ''
                                }
                                onFocus={() =>
                                  setRowCostDrafts((d) =>
                                    d[item.id] !== undefined
                                      ? d
                                      : {
                                          ...d,
                                          [item.id]: item.manualCost !== undefined ? String(item.manualCost) : '',
                                        }
                                  )
                                }
                                onBlur={(e) => {
                                  const raw = e.target.value;
                                  setRowCostDrafts(({ [item.id]: _, ...rest }) => rest);
                                  commitRowCost(item.id, raw);
                                }}
                                onChange={(e) =>
                                  setRowCostDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                                }
                             />
                          </div>

                          <button
                            type="button"
                            title={
                              item.skipAiSpecs
                                ? 'AI tech specs skipped — click to allow parsing'
                                : 'Skip AI tech specs for this item'
                            }
                            onClick={() =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === item.id ? { ...x, skipAiSpecs: !x.skipAiSpecs } : x
                                )
                              )
                            }
                            className={`p-2 rounded-xl transition-all ${
                              item.skipAiSpecs
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'text-slate-300 hover:text-amber-600 hover:bg-amber-50'
                            }`}
                          >
                            <Ban size={14} />
                          </button>
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
               <div className="hidden lg:flex justify-between items-center mb-6 text-xs font-bold text-slate-500">
                  <span>Total Paid: <span className="text-slate-900">€{formatEUR(totalCost)}</span></span>
                  <span>Allocated: <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-500'}>€{formatEUR(allocatedTotal)}</span></span>
               </div>
               <button 
                  onClick={handleSubmit}
                  disabled={items.length === 0 || parsingSpecs}
                  className="hidden lg:flex w-full py-5 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:shadow-none items-center justify-center gap-3"
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

      {/* Phone: sticky confirm above bottom nav */}
      <div className="lg:hidden fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[90] border-t border-slate-200 bg-white/95 backdrop-blur-sm px-3 pt-2 pb-2 shadow-[0_-6px_20px_rgba(15,23,42,0.08)]">
         <div className="flex justify-between items-center mb-1.5 text-[10px] font-bold text-slate-500">
            <span>{items.length} item{items.length === 1 ? '' : 's'} · €{formatEUR(totalCost)}</span>
            <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-500'}>
              Alloc €{formatEUR(allocatedTotal)}
            </span>
         </div>
         <button
            type="button"
            onClick={handleSubmit}
            disabled={items.length === 0 || parsingSpecs}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
         >
            {parsingSpecs ? (
               <>
                  <Loader2 size={16} className="animate-spin" /> {parseProgress || 'Parsing…'}
               </>
            ) : (
               <>
                  <Save size={16} />
                  {items.length === 0
                    ? 'Add items to import'
                    : addAsBundle && items.length >= 2
                      ? `Import bundle (${items.length})`
                      : `Confirm import (${items.length})`}
               </>
            )}
         </button>
      </div>
    </div>
  );
};

export default BulkItemForm;
