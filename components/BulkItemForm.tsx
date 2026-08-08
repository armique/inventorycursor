
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Save, Plus, Trash2, Calendar, 
  ShoppingBag, Calculator, Layers, 
  Search, Database, 
  CheckCircle2,
  Sparkles, Loader2, Package, Ban, ScanBarcode, Wrench, Globe, Upload
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
import { AddFlowStepHeader, AddFlowPageHeader, AddFlowSecondaryButton, AddFlowPrimaryButton, AddOptionTile, ADD_FLOW_PANEL, ADD_FLOW_LABEL, ADD_FLOW_INPUT } from './addFlowShared';
import BuySourcePlatformPicker, {
  BuyPaymentTypePicker,
  BuySourceSellerField,
} from './BuySourcePlatformPicker';
import AddCategorySubcategoryPicker, {
  firstCategorySelection,
  resolveCategoryFromHardwareType,
} from './AddCategorySubcategoryPicker';
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
  pickBulkImportDisplayName,
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

const MOTHERBOARD_PATTERN =
  /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i;

function normalizeCategory(input: string | undefined, categories: Record<string, string[]>): string {
  const keys = Object.keys(categories || {});
  const fallback = keys[0] || 'Components';
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return fallback;
  const match = keys.find((c) => c.toLowerCase() === raw);
  return match || (keys.includes('Components') ? 'Components' : fallback);
}

function normalizeSubCategory(
  category: string,
  sub: string | undefined,
  categories: Record<string, string[]>
): string {
  const options = categories[category] || [];
  if (!options.length) return '';
  const raw = (sub || '').trim().toLowerCase();
  const match = options.find((s) => s.toLowerCase() === raw);
  return match || options[0];
}

/** Clamp any guessed/AI pair onto the live Settings tree. */
function clampToLiveCategories(
  selection: { category: string; subCategory: string },
  categories: Record<string, string[]>
): { category: string; subCategory: string } {
  const category = normalizeCategory(selection.category, categories);
  const subCategory = normalizeSubCategory(category, selection.subCategory, categories);
  return { category, subCategory };
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

function reconcileCategory(
  name: string,
  category: string | undefined,
  subCategory: string | undefined,
  categories: Record<string, string[]>
): { category: string; subCategory: string } {
  const guessed = inferCategoryFromName(name);
  const aiCategory = normalizeCategory(category || guessed.category, categories);
  const aiSub = normalizeSubCategory(aiCategory, subCategory || guessed.subCategory, categories);

  const n = name.toLowerCase();
  let resolved = { category: aiCategory, subCategory: aiSub };
  if (/(prodesk|optiplex|elitedesk|business\s*pc|desktop\s*pc|mini\s*pc)\b/i.test(n)) {
    resolved = { category: 'PC', subCategory: 'Pre-Built PC' };
  } else if (/(dvd|bluray|blu-ray|optical|oddd|gud\d)/i.test(n)) {
    resolved = { category: 'Misc', subCategory: 'Spare Parts' };
  } else if (/\b(i[3579]|intel\s*core|ryzen|threadripper|cpu|prozessor)\b/i.test(n) && !/mainboard|motherboard|prodesk|optiplex|elitedesk|business\s*pc/i.test(n)) {
    resolved = { category: 'Components', subCategory: 'Processors' };
  } else if (/(ssd|nvme|m\.2|hdd|sata)/i.test(n)) {
    resolved = { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
  } else if (/(ddr4|ddr5|ram|memory|\d+\s*[x×]\s*\d+\s*gb|crucial)/i.test(n) && !/mainboard|motherboard|prodesk|business\s*pc/i.test(n)) {
    resolved = { category: 'Components', subCategory: 'RAM' };
  } else if (MOTHERBOARD_PATTERN.test(n)) {
    resolved = { category: 'Components', subCategory: 'Motherboards' };
  } else if (aiCategory !== 'Components' && guessed.category === 'Components') {
    resolved = guessed;
  } else if (aiCategory === 'Components' && aiSub === 'Graphics Cards' && guessed.subCategory !== 'Graphics Cards') {
    resolved = guessed;
  } else if (guessed.category === 'PC' && aiCategory !== 'PC') {
    resolved = guessed;
  }

  return clampToLiveCategories(resolved, categories);
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
  const [batchSeller, setBatchSeller] = useState('');

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
  const initialCat = firstCategorySelection(categories);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>(initialCat.category || 'Components');
  const [newSubCategory, setNewSubCategory] = useState<string>(initialCat.subCategory || '');
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const handleManualCategoryChange = useCallback((next: { category: string; subCategory: string }) => {
    setNewCategory(next.category);
    setNewSubCategory(next.subCategory);
  }, []);

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
    if (!newCategory) {
      alert('Choose a category first.');
      return;
    }
    const clamped = clampToLiveCategories(
      { category: newCategory, subCategory: newSubCategory },
      categories
    );

    const newItems: DraftItem[] = [];
    for(let i=0; i<quantity; i++) {
        newItems.push({
            id: `draft-${Date.now()}-${i}`,
            name: newName,
            category: clamped.category,
            subCategory: clamped.subCategory,
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
    const { category: cat, subCategory: sub } = resolveCategoryFromHardwareType(hw.type, categories);

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
    const clamped = clampToLiveCategories(
      { category: newCategory, subCategory: newSubCategory },
      categories
    );
    setItems((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}`,
        name: product.name,
        category: clamped.category,
        subCategory: clamped.subCategory,
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
  };

  const handleAddBlankRow = () => {
    const clamped = clampToLiveCategories(
      { category: newCategory, subCategory: newSubCategory },
      categories
    );
    setItems((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        category: clamped.category,
        subCategory: clamped.subCategory,
        note: '',
        isDefective: false,
        draftSource: 'manual',
      },
    ]);
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
        ? clampToLiveCategories(
            { category: newCategory, subCategory: newSubCategory },
            categories
          )
        : reconcileCategory(productFromLine || baseName, row.category, row.subCategory, categories);
      const ramKit =
        rec.subCategory === 'RAM'
          ? resolveRamKitInfo(productFromLine || baseName, { sourceLine, specs: row.specs })
          : null;
      const inventoryQty = resolveRamInventoryQuantity(lineQty, ramKit, lineQty);
      // AI mode: use cleaned AI title. RAM kits keep paste-based formatting so "-8X"
      // part numbers are never expanded into fake 8-module kits.
      const displayName = pickBulkImportDisplayName({
        mode: importMode,
        pasteProductName: productFromLine || baseName,
        aiName: baseName || productFromLine,
        ramFormattedName: ramKit
          ? formatRamKitDisplayName(productFromLine || baseName, ramKit)
          : null,
      });
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
- name: clean short product title — brand + model + key size/capacity (e.g. "Samsung 980 Pro 1TB NVMe", "MSI GeForce RTX 3060 Gaming X 12GB", "Intel Core i7-4790K"). Fix casing, drop junk (emoji, shipping, "neu", seller fluff, trailing prices). Keep real model / P/N tokens.
- Keep categories limited to: ${Object.keys(categories).join(', ') || 'Components'}
- SubCategory must exist under that category in the list above (or be omitted).
- Parse quantity from prefixes like "2x ..." or "8x4GB ...". If no quantity, use 1.
- Leading "2x Product" / "4x Product" is a PURCHASE count (how many units bought), not a RAM kit size. Example: "2x Samsung … 4GB" → quantity=2, name without the "2x". Spaced "2x 8GB Samsung" → quantity=2, single 8GB sticks (NOT a 2x8GB kit).
- Model codes like "ACR24D4U1S1ME-8X" or "…-8X 8GB": the "-8X" is part of the part number, NEVER modules=8. Keep the full model string in name — do NOT invent "64GB (8x8GB)".
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
    if (items.some((item) => !item.name.trim())) {
      alert('Fill in a name for every row (or delete empty rows).');
      return;
    }

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
        vendor: draft.vendor || batchSeller.trim() || 'Unknown',
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

  const updateDraft = (id: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  if (true) {
    return (
      <div className="w-full min-w-0 h-[calc(100dvh-5.5rem)] md:h-[calc(100vh-5.5rem)] flex flex-col animate-in fade-in">
        <div className="px-1 sm:px-2 shrink-0">
          <AddFlowStepHeader title="Bulk entry" />
          <AddFlowPageHeader
            icon={<Layers size={22} strokeWidth={1.75} />}
            title="Bulk Entry"
            subtitle="Sheet · paste fills rows · one transaction"
            onBack={() => navigate(-1)}
            actions={
              <AddFlowSecondaryButton onClick={() => navigate('/panel/bulk-imports')}>
                <Layers size={14} /> History
              </AddFlowSecondaryButton>
            }
          />
        </div>

        <main className="flex flex-1 min-h-0 flex-col gap-2.5 px-1 sm:px-2 pb-[max(5.5rem,calc(4rem+env(safe-area-inset-bottom)))] lg:pb-2">
          <section className={`${ADD_FLOW_PANEL} shrink-0 p-2 sm:p-3`}>
            <div className="flex flex-wrap items-end gap-2 lg:flex-nowrap">
              <div className="min-w-[8rem]">
                <label className={ADD_FLOW_LABEL}>Total paid</label>
                <div className="mt-1 flex h-9 items-center rounded-lg border border-slate-200 bg-white px-2 focus-within:border-slate-400">
                  <span className="text-xs font-bold text-slate-400">€</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="min-w-0 flex-1 bg-transparent px-1 text-sm font-black text-slate-900 outline-none"
                    placeholder="0,00"
                    value={totalCostDraft !== null ? totalCostDraft : totalCost === 0 ? '' : String(totalCost)}
                    onFocus={() => setTotalCostDraft(totalCost === 0 ? '' : String(totalCost))}
                    onBlur={() => {
                      const raw = totalCostDraft ?? '';
                      setTotalCostDraft(null);
                      if (!raw.trim()) {
                        setTotalCost(0);
                        return;
                      }
                      const next = parseLocaleNumber(raw);
                      if (Number.isFinite(next)) setTotalCost(next);
                    }}
                    onChange={(event) => setTotalCostDraft(event.target.value)}
                  />
                </div>
              </div>
              <div className="min-w-[9rem]">
                <label className={ADD_FLOW_LABEL}>Buy date</label>
                <input
                  type="date"
                  className={`${ADD_FLOW_INPUT} mt-1 !h-9 !rounded-lg !px-2 !py-1.5 text-xs`}
                  value={buyDate}
                  onChange={(event) => setBuyDate(event.target.value)}
                />
              </div>
              <div className="min-w-[13rem] flex-1">
                <BuySourcePlatformPicker
                  size="sm"
                  value={platform}
                  onChange={(next) => {
                    setPlatform(next);
                    setPayment((prev) => paymentAfterPlatformChange(next, prev));
                  }}
                />
              </div>
              <div className="min-w-[13rem] flex-1">
                <BuyPaymentTypePicker
                  size="sm"
                  platform={platform}
                  value={payment}
                  onChange={(next) =>
                    setPayment(normalizeBuyPaymentForPlatform(platform, next) || next)
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => setCostSplitMode((mode) => (mode === 'EQUAL' ? 'SMART' : 'EQUAL'))}
                className={`h-9 whitespace-nowrap rounded-lg border px-3 text-[10px] font-black uppercase tracking-wide transition-colors ${
                  costSplitMode === 'SMART'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                title="Smart split prioritizes expensive component types"
              >
                Smart split {costSplitMode === 'SMART' ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={distributeEvenly}
                className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
              >
                <Calculator size={13} /> Reset split
              </button>
              <AddFlowPrimaryButton
                onClick={handleSubmit}
                disabled={items.length === 0 || parsingSpecs}
                className="hidden h-9 whitespace-nowrap px-4 lg:flex"
              >
                {parsingSpecs ? (
                  <><Loader2 size={15} className="animate-spin" /> {parseProgress || 'Parsing…'}</>
                ) : (
                  <><Save size={15} /> Confirm import ({items.length})</>
                )}
              </AddFlowPrimaryButton>
            </div>
          </section>

          <section className={`${ADD_FLOW_PANEL} shrink-0 p-2.5 sm:p-3`}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
              <div className="min-w-0 flex-1">
                <label className={ADD_FLOW_LABEL}>Paste seeds</label>
                <textarea
                  className={`${ADD_FLOW_INPUT} mt-1 min-h-16 resize-y !rounded-lg !px-3 !py-2 text-xs`}
                  placeholder={'One item per line — paste fills editable rows below\nExample: ASUS TUF Gaming RTX 5070 12GB'}
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-end gap-2 lg:w-auto lg:max-w-[31rem]">
                <div className="grid min-w-[13rem] flex-1 grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setBulkQtyMode('INDIVIDUAL')}
                    className={`rounded-md px-2 py-2 text-[10px] font-black uppercase ${
                      bulkQtyMode === 'INDIVIDUAL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    Separately
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkQtyMode('LOT')}
                    className={`rounded-md px-2 py-2 text-[10px] font-black uppercase ${
                      bulkQtyMode === 'LOT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    Lot
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleAddBulkTextAsIs}
                  disabled={!bulkText.trim() || bulkTextBusy}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Fill sheet
                </button>
                <button
                  type="button"
                  onClick={handleParseBulkTextWithAI}
                  disabled={!bulkText.trim() || bulkTextBusy}
                  className="flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-[10px] font-black uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {bulkTextBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Parse AI
                </button>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-medium text-slate-400">Paste fills rows below. Review names, categories, and costs before importing.</p>
              {bulkTextStatus && <p className="text-[10px] text-slate-500">{bulkTextStatus}</p>}
            </div>
          </section>

          <section className={`${ADD_FLOW_PANEL} flex min-h-[18rem] flex-1 flex-col overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-3 py-2">
              <div>
                <h2 className="text-sm font-black text-slate-900">Import sheet</h2>
                <p className="text-[10px] font-semibold text-slate-500">
                  {items.length} row{items.length === 1 ? '' : 's'} · €{formatEUR(allocatedTotal)} allocated
                </p>
              </div>
              <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-[10px] font-bold text-red-500' : 'text-[10px] font-bold text-emerald-600'}>
                {Math.abs(allocatedTotal - totalCost) > 0.1 ? `Difference €${formatEUR(allocatedTotal - totalCost)}` : 'Costs balanced'}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[780px] table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-12" />
                  <col />
                  <col className="w-[21rem]" />
                  <col className="w-28" />
                  <col className="w-16" />
                  <col className="w-24" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="border-b border-r border-slate-200 px-3 py-2.5">#</th>
                    <th className="border-b border-r border-slate-200 px-3 py-2.5">Name</th>
                    <th className="border-b border-r border-slate-200 px-3 py-2.5">Category</th>
                    <th className="border-b border-r border-slate-200 px-3 py-2.5 text-right">Cost €</th>
                    <th className="border-b border-r border-slate-200 px-3 py-2.5 text-center">Def</th>
                    <th className="border-b border-slate-200 px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="h-32 border-b border-slate-100 text-center text-xs font-semibold text-slate-400">
                        Paste lines above or add a row
                      </td>
                    </tr>
                  ) : (
                    items.map((item, index) => (
                      <tr key={item.id} className="group border-b border-slate-100 bg-white hover:bg-slate-50/70">
                        <td className="border-r border-slate-100 px-3 py-2 align-top text-xs font-black tabular-nums text-slate-400">
                          {index + 1}
                        </td>
                        <td className="border-r border-slate-100 p-1.5 align-top">
                          <input
                            className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-bold text-slate-900 outline-none hover:border-slate-200 focus:border-slate-400 focus:bg-white"
                            value={item.name}
                            onChange={(event) => updateDraft(item.id, { name: event.target.value })}
                            placeholder="Item name"
                          />
                          <input
                            className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[10px] font-medium text-slate-500 outline-none hover:border-slate-200 focus:border-slate-400 focus:bg-white"
                            value={item.note}
                            onChange={(event) => updateDraft(item.id, { note: event.target.value })}
                            placeholder="Optional note"
                          />
                        </td>
                        <td className="border-r border-slate-100 p-1.5 align-top">
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-700 outline-none focus:border-slate-400"
                              value={item.category}
                              onChange={(event) => {
                                const category = event.target.value;
                                updateDraft(item.id, {
                                  category,
                                  subCategory: normalizeSubCategory(category, '', categories),
                                });
                              }}
                            >
                              {Object.keys(categories).map((category) => (
                                <option key={category} value={category}>{category}</option>
                              ))}
                            </select>
                            <select
                              className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-700 outline-none focus:border-slate-400"
                              value={item.subCategory || ''}
                              onChange={(event) => updateDraft(item.id, { subCategory: event.target.value })}
                            >
                              {(categories[item.category] || []).map((subCategory) => (
                                <option key={subCategory} value={subCategory}>{subCategory}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="border-r border-slate-100 p-1.5 align-top">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-black tabular-nums text-slate-900 outline-none focus:border-slate-400"
                            placeholder={formatEUR(autoCostsById[item.id] ?? 0)}
                            value={rowCostDrafts[item.id] !== undefined ? rowCostDrafts[item.id] : item.manualCost !== undefined ? String(item.manualCost) : ''}
                            onFocus={() =>
                              setRowCostDrafts((drafts) =>
                                drafts[item.id] !== undefined
                                  ? drafts
                                  : { ...drafts, [item.id]: item.manualCost !== undefined ? String(item.manualCost) : '' }
                              )
                            }
                            onBlur={(event) => {
                              const raw = event.target.value;
                              setRowCostDrafts(({ [item.id]: _, ...rest }) => rest);
                              commitRowCost(item.id, raw);
                            }}
                            onChange={(event) => setRowCostDrafts((drafts) => ({ ...drafts, [item.id]: event.target.value }))}
                          />
                        </td>
                        <td className="border-r border-slate-100 px-3 py-2 text-center align-top">
                          <input
                            type="checkbox"
                            checked={!!item.isDefective}
                            onChange={(event) => updateDraft(item.id, { isDefective: event.target.checked })}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                            aria-label={`Mark row ${index + 1} defective`}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              title={item.skipAiSpecs ? 'Allow AI specs' : 'Skip AI specs'}
                              onClick={() => updateDraft(item.id, { skipAiSpecs: !item.skipAiSpecs })}
                              className={`rounded-md p-1.5 transition-colors ${
                                item.skipAiSpecs ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                              }`}
                            >
                              <Ban size={14} />
                            </button>
                            <button
                              type="button"
                              title="Delete row"
                              onClick={() => handleRemoveItem(item.id)}
                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
              <button
                type="button"
                onClick={handleAddBlankRow}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:border-slate-500 hover:bg-slate-50"
              >
                <Plus size={14} /> Add row
              </button>
            </div>
          </section>

          <section className={`${ADD_FLOW_PANEL} shrink-0 overflow-hidden`}>
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              aria-expanded={moreOpen}
            >
              <span>
                <span className="block text-xs font-black text-slate-800">More tools</span>
                <span className="block text-[10px] font-medium text-slate-400">Single-item add, source proof, photos, bundle and AI options</span>
              </span>
              <span className="text-lg font-medium text-slate-400">{moreOpen ? '−' : '+'}</span>
            </button>
            {moreOpen && (
              <div className="max-h-[45vh] overflow-y-auto border-t border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1">
                      <AddOptionTile size="sm" label="Manual" hint="Single item" icon={<Plus size={17} />} selected={mode === 'MANUAL'} onClick={() => setMode('MANUAL')} className="!py-2" />
                      <AddOptionTile size="sm" label="Scan" hint="Barcode" icon={<ScanBarcode size={17} />} selected={mode === 'SCAN'} onClick={() => setMode('SCAN')} className="!py-2" />
                      <AddOptionTile size="sm" label="Database" hint="Hardware DB" icon={<Database size={17} />} selected={mode === 'SEARCH'} onClick={() => setMode('SEARCH')} className="!py-2" />
                    </div>
                    {mode === 'SCAN' ? (
                      <div className={`${ADD_FLOW_PANEL} p-3`}><BarcodeScanPanel onProduct={handleAddFromBarcode} compact /></div>
                    ) : mode === 'SEARCH' ? (
                      <div className={`${ADD_FLOW_PANEL} p-3`}>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                          <input className={`${ADD_FLOW_INPUT} !py-2 pl-9 text-xs`} placeholder="Search hardware model…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
                        </div>
                        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                          {searchResults.map((result, index) => (
                            <button key={`${result.vendor}-${result.model}-${index}`} type="button" onClick={() => handleAddFromSearch(result)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-bold text-slate-700 hover:border-slate-400">
                              {result.vendor} {result.model}<Plus size={13} />
                            </button>
                          ))}
                          {searchResults.length === 0 && searchQuery.length > 2 && <p className="py-3 text-center text-xs text-slate-400">No results found.</p>}
                        </div>
                      </div>
                    ) : (
                      <form className={`${ADD_FLOW_PANEL} space-y-3 p-3`} onSubmit={handleAddManual}>
                        <AddCategorySubcategoryPicker categories={categories} category={newCategory} subCategory={newSubCategory} onChange={handleManualCategoryChange} onAddCategory={onAddCategory ? handleAddGlobalCategory : undefined} size="sm" />
                        <input className={ADD_FLOW_INPUT} placeholder="Item name" value={newName} onChange={(event) => setNewName(event.target.value)} />
                        <div className="grid grid-cols-[1fr_5rem] gap-2">
                          <input className={`${ADD_FLOW_INPUT} text-xs`} placeholder="Optional details" value={newNote} onChange={(event) => setNewNote(event.target.value)} />
                          <input type="number" min="1" className={`${ADD_FLOW_INPUT} text-center`} value={quantity} onChange={(event) => setQuantity(parseInt(event.target.value) || 1)} />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                          <input type="checkbox" checked={newDefective} onChange={(event) => setNewDefective(event.target.checked)} className="rounded border-slate-300 text-slate-900" />
                          Mark as defective
                        </label>
                        <AddFlowPrimaryButton type="submit" disabled={!newName.trim()} className="w-full"><Plus size={15} /> Add to sheet</AddFlowPrimaryButton>
                      </form>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className={`${ADD_FLOW_PANEL} space-y-3 p-3`}>
                      <h3 className={`${ADD_FLOW_LABEL} flex items-center gap-2`}><Globe size={12} /> Source extras</h3>
                      {(platform === 'kleinanzeigen.de' || platform === 'ebay.de') && (
                        <BuySourceSellerField platform={platform} value={batchSeller} onChange={setBatchSeller} />
                      )}
                      {platform === 'kleinanzeigen.de' && (
                        <>
                          <input className={ADD_FLOW_INPUT} placeholder="Chat URL" value={chatUrl} onChange={(event) => setChatUrl(event.target.value)} />
                          <input className={ADD_FLOW_INPUT} placeholder="Seller profile URL" value={sellerProfileUrl} onChange={(event) => setSellerProfileUrl(event.target.value)} />
                          <div className="flex gap-2">
                            <input className={`${ADD_FLOW_INPUT} flex-1`} placeholder="Chat screenshot URL" value={chatImage.startsWith('data:') ? '' : chatImage} onChange={(event) => setChatImage(event.target.value.trim())} />
                            <label className="flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 text-slate-500 hover:bg-slate-50" title="Upload chat screenshot">
                              <Upload size={15} /><input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                            </label>
                          </div>
                          {chatImage && <button type="button" onClick={() => setChatImage('')} className="text-[10px] font-black uppercase text-slate-600">Clear attached screenshot</button>}
                        </>
                      )}
                    </div>

                    <div className={`${ADD_FLOW_PANEL} space-y-3 p-3`}>
                      <div className="flex items-center justify-between">
                        <h3 className={ADD_FLOW_LABEL}>Item photos</h3>
                        <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                          <Upload size={12} /> Add files<input type="file" accept="image/*" multiple className="hidden" onChange={handleItemImageUpload} />
                        </label>
                      </div>
                      <input
                        className={ADD_FLOW_INPUT}
                        placeholder="Paste image URL and press Enter"
                        value={imageUrlInput}
                        onChange={(event) => setImageUrlInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const value = imageUrlInput.trim();
                          if (!value) return;
                          setItemImageUrls((prev) => normalizeImageList([...prev, value]));
                          setImageUrlInput('');
                        }}
                      />
                      {itemImageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {itemImageUrls.map((url, index) => (
                            <div key={url} className={`relative h-16 w-20 overflow-hidden rounded-lg border ${index === 0 ? 'border-slate-900' : 'border-slate-200'}`}>
                              <img src={url} alt="Imported item" className="h-full w-full object-cover" />
                              <button type="button" onClick={() => removeItemImage(url)} className="absolute right-1 top-1 rounded bg-white/90 px-1 text-[9px] font-black text-red-600">X</button>
                              {index > 0 && <button type="button" onClick={() => setMainItemImage(url)} className="absolute bottom-1 left-1 rounded bg-white/90 px-1 text-[8px] font-black uppercase text-slate-700">Main</button>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={`${ADD_FLOW_PANEL} space-y-3 p-3`}>
                      {items.length >= 2 && (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                          <input type="checkbox" checked={addAsBundle} onChange={(event) => setAddAsBundle(event.target.checked)} className="rounded border-slate-300 text-slate-900" />
                          Add as bundle
                        </label>
                      )}
                      {addAsBundle && items.length >= 2 ? (
                        <>
                          <input className={ADD_FLOW_INPUT} placeholder="Bundle name" value={bundleName} onChange={(event) => setBundleName(event.target.value)} />
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={bundleHasOVP} onChange={(event) => setBundleHasOVP(event.target.checked)} /> OVP</label>
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={bundleHasIOShield} onChange={(event) => setBundleHasIOShield(event.target.checked)} /> IO Shield</label>
                        </>
                      ) : items.length > 0 ? (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={allItemsHaveOVP} onChange={(event) => setAllItemsHaveOVP(event.target.checked)} /> All items have OVP</label>
                      ) : null}
                      {aiAvailable && (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                          <input type="checkbox" checked={parseSpecsBeforeImport} onChange={(event) => setParseSpecsBeforeImport(event.target.checked)} className="rounded border-slate-300 text-slate-900" />
                          Parse tech specs with AI before import
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>

        <div className="lg:hidden fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[90] border-t border-slate-200 bg-white/95 backdrop-blur-sm px-3 pt-2 pb-2 shadow-[0_-6px_20px_rgba(15,23,42,0.08)]">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-slate-500">
            <span>{items.length} item{items.length === 1 ? '' : 's'} · €{formatEUR(totalCost)}</span>
            <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-600'}>Alloc €{formatEUR(allocatedTotal)}</span>
          </div>
          <AddFlowPrimaryButton onClick={handleSubmit} disabled={items.length === 0 || parsingSpecs} className="w-full py-3.5">
            {parsingSpecs ? <><Loader2 size={16} className="animate-spin" /> {parseProgress || 'Parsing…'}</> : <><Save size={16} /> {items.length === 0 ? 'Add items to import' : `Confirm import (${items.length})`}</>}
          </AddFlowPrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-[calc(100dvh-5.5rem)] md:h-[calc(100vh-5.5rem)] flex flex-col animate-in fade-in">
      <div className="px-1 sm:px-2 shrink-0">
        <AddFlowStepHeader title="Bulk entry" />
        <AddFlowPageHeader
          icon={<Layers size={22} strokeWidth={1.75} />}
          title="Bulk Entry"
          subtitle="Add multiple items · one transaction"
          onBack={() => navigate(-1)}
          actions={
            <AddFlowSecondaryButton onClick={() => navigate('/panel/bulk-imports')}>
              <Layers size={14} /> History
            </AddFlowSecondaryButton>
          }
        />
      </div>
      {/* HEADER totals strip — full width, not shoved to the right */}
      <header className="flex flex-col gap-3 mb-3 lg:mb-4 shrink-0 px-1 sm:px-2">
        <div className={`w-full flex flex-wrap items-end gap-2 sm:gap-3 md:gap-4 ${ADD_FLOW_PANEL} p-2 md:p-3`}>
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
           <div className="px-3 min-w-[14rem] flex-1 max-w-md space-y-2">
              <BuySourcePlatformPicker
                size="sm"
                value={platform}
                onChange={(next) => {
                  setPlatform(next);
                  setPayment((prev) => paymentAfterPlatformChange(next, prev));
                }}
              />
              <BuyPaymentTypePicker
                size="sm"
                platform={platform}
                value={payment}
                onChange={(next) =>
                  setPayment(normalizeBuyPaymentForPlatform(platform, next) || next)
                }
              />
           </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row gap-3 lg:gap-4 overflow-y-auto lg:overflow-hidden px-1 sm:px-2 pb-[max(5.5rem,calc(4rem+env(safe-area-inset-bottom)))] lg:pb-2">
         
         {/* LEFT: ITEM BUILDER */}
         <div className="w-full lg:w-[min(100%,26rem)] xl:w-[28rem] flex flex-col gap-4 lg:gap-5 shrink-0 lg:overflow-y-auto lg:pb-20 scrollbar-hide">
            
            {/* INPUT MODE TABS */}
            <div className={`${ADD_FLOW_PANEL} p-2 grid grid-cols-3 gap-1`}>
               <AddOptionTile
                 size="sm"
                 label="Manual"
                 hint="Type / paste"
                 icon={<Plus size={18} strokeWidth={1.75} />}
                 selected={mode === 'MANUAL'}
                 onClick={() => setMode('MANUAL')}
                 className="!py-2"
               />
               <AddOptionTile
                 size="sm"
                 label="Scan"
                 hint="Barcode"
                 icon={<ScanBarcode size={18} strokeWidth={1.75} />}
                 selected={mode === 'SCAN'}
                 onClick={() => setMode('SCAN')}
                 className="!py-2"
               />
               <AddOptionTile
                 size="sm"
                 label="Database"
                 hint="Search parts"
                 icon={<Database size={18} strokeWidth={1.75} />}
                 selected={mode === 'SEARCH'}
                 onClick={() => setMode('SEARCH')}
                 className="!py-2"
               />
            </div>

            {mode === 'SCAN' ? (
               <div className={`${ADD_FLOW_PANEL} p-4 space-y-3`}>
                  <BarcodeScanPanel onProduct={handleAddFromBarcode} compact />
                  <p className="text-[10px] text-slate-400 px-1">
                    Each successful scan adds a row to the list. If the name matches the hardware DB, specs are filled automatically.
                  </p>
               </div>
            ) : mode === 'MANUAL' ? (
               <div className={`${ADD_FLOW_PANEL} p-5 space-y-5`}>
                  <div className="space-y-2">
                     <label className={ADD_FLOW_LABEL}>Paste text (quick bulk parse)</label>
                     <textarea
                        className={`${ADD_FLOW_INPUT} min-h-28 font-medium text-xs`}
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
                          className="py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wide hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {bulkTextBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Parse With AI
                        </button>
                     </div>
                     <p className="text-[10px] text-slate-400">
                       {bulkQtyMode === 'INDIVIDUAL'
                         ? 'Nx lines expand to N items. “(2 working, 2 defekt)” → 2 OK + 2 Defekt. Parse With AI also cleans product names.'
                         : 'Each Nx line becomes one lot item named like “4x Product…”. Parse With AI also cleans product names.'}
                     </p>
                     {bulkTextStatus && <p className="text-[10px] text-slate-500">{bulkTextStatus}</p>}
                  </div>

                  <div className="space-y-2">
                     <AddCategorySubcategoryPicker
                       categories={categories}
                       category={newCategory}
                       subCategory={newSubCategory}
                       onChange={handleManualCategoryChange}
                       onAddCategory={onAddCategory ? handleAddGlobalCategory : undefined}
                       size="sm"
                     />
                     {(newCategory || newSubCategory) && (
                       <p className="text-[10px] font-semibold text-slate-500 px-1">
                         New rows use{' '}
                         <span className="font-black text-slate-800">
                           {newCategory}
                           {newSubCategory ? ` / ${newSubCategory}` : ''}
                         </span>
                       </p>
                     )}
                  </div>

                  <div className="space-y-4">
                     <div className="space-y-2">
                        <label className={ADD_FLOW_LABEL}>Item name</label>
                        <input 
                           autoFocus
                           className={ADD_FLOW_INPUT}
                           placeholder="e.g. Corsair RM850x"
                           value={newName}
                           onChange={e => setNewName(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                        />
                     </div>
                     
                     <div className="flex gap-4 items-center">
                        <div className="flex-1 space-y-2">
                           <label className={ADD_FLOW_LABEL}>Details (optional)</label>
                           <input 
                              className={`${ADD_FLOW_INPUT} font-medium text-xs`}
                              placeholder="Condition, Specs..."
                              value={newNote}
                              onChange={e => setNewNote(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                           />
                        </div>
                        <div className="w-24 space-y-2">
                           <label className={ADD_FLOW_LABEL}>Count</label>
                           <input 
                              type="text"
                              inputMode="decimal"
                              min="1"
                              className={`${ADD_FLOW_INPUT} font-black text-center`}
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

                  <AddFlowPrimaryButton onClick={handleAddManual} disabled={!newName} className="w-full py-4">
                     <Plus size={16}/> Add to List
                  </AddFlowPrimaryButton>
               </div>
            ) : (
               <div className={`${ADD_FLOW_PANEL} p-5 flex-1 flex flex-col min-h-0`}>
                  <div className="relative mb-4">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                     <input 
                        autoFocus
                        className={`${ADD_FLOW_INPUT} pl-12`}
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
                           className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-slate-400 hover:bg-slate-50 transition-all group"
                        >
                           <div className="flex justify-between items-center">
                              <p className="font-black text-xs text-slate-900 group-hover:text-slate-700">{res.vendor} {res.model}</p>
                              <Plus size={14} className="opacity-0 group-hover:opacity-100 text-slate-700"/>
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
            <div className={`${ADD_FLOW_PANEL} p-5 space-y-4 bg-slate-50/80`}>
               <h3 className={`${ADD_FLOW_LABEL} flex items-center gap-2`}><Globe size={12}/> Source extras</h3>
               <p className="text-[10px] text-slate-500 font-medium leading-snug">
                 {platform === 'kleinanzeigen.de'
                   ? 'Add chat link / screenshot for this Kleinanzeigen purchase.'
                   : platform === 'ebay.de'
                     ? 'eBay checkout is selected above. Item photos below apply to every imported row.'
                     : platform === 'In Person'
                       ? 'Cash is typical for in-person buys. Add shared item photos below if you have them.'
                       : platform === 'Amazon'
                         ? 'Amazon order trails go in comments later if needed. Photos below apply to all rows.'
                         : 'Pick payment above. Photos below apply to every imported row.'}
               </p>
               
               {platform === 'kleinanzeigen.de' && (
                  <div className="pt-2 border-t border-slate-200/50 space-y-3">
                     <BuySourceSellerField
                       platform="kleinanzeigen.de"
                       value={batchSeller}
                       onChange={setBatchSeller}
                     />
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
                        <div className="flex items-center gap-2 text-[10px] text-slate-700 bg-slate-50 p-2 rounded-xl border border-slate-200">
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
                               className="ml-auto w-8 h-8 rounded-lg overflow-hidden border border-slate-200 shrink-0"
                               onClick={(e) => e.stopPropagation()}
                             >
                               <img src={chatImage} alt="" className="w-full h-full object-cover" />
                             </a>
                           )}
                           <button
                             type="button"
                             onClick={() => setChatImage('')}
                             className="text-[9px] font-black uppercase text-slate-800 hover:underline"
                           >
                             Clear
                           </button>
                        </div>
                     )}
                  </div>
               )}

               {platform === 'ebay.de' && (
                  <div className="pt-2 border-t border-slate-200/50 space-y-2">
                     <BuySourceSellerField
                       platform="ebay.de"
                       value={batchSeller}
                       onChange={setBatchSeller}
                     />
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
                        <div key={url} className={`p-1.5 rounded-lg border ${idx === 0 ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                          <img src={url} alt="" className="w-full h-14 object-cover rounded-md border border-slate-200 bg-slate-100" />
                          <div className="flex justify-between mt-1 gap-1">
                            <button
                              type="button"
                              onClick={() => setMainItemImage(url)}
                              className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${idx === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
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
         <div className={`flex-1 min-h-[40vh] lg:min-h-0 ${ADD_FLOW_PANEL} overflow-hidden flex flex-col`}>
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
               <div className="flex items-center gap-3">
                  <div className="bg-slate-100 text-slate-700 p-2 rounded-xl border border-slate-200">
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
                    className={`text-[10px] font-black uppercase px-3 py-2 rounded-xl transition-all border ${
                      costSplitMode === 'SMART'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                    }`}
                    title="Smart split prioritizes expensive component types (GPU/CPU/etc.)"
                  >
                    {costSplitMode === 'SMART' ? 'Smart Split: On' : 'Smart Split: Off'}
                  </button>
                  <button onClick={distributeEvenly} className="text-[10px] font-black uppercase text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-xl transition-all flex items-center gap-2 border border-slate-200">
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
                     <div key={item.id} className="p-3 bg-white border border-slate-100 rounded-2xl shadow-sm group hover:border-slate-300 transition-all relative space-y-2">
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
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[8px] font-black uppercase border border-slate-200">No AI specs</span>
                                )}
                             </div>
                             {item.note && <p className="text-[10px] text-slate-400 truncate">{item.note}</p>}
                           </div>
                          <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 pr-3 border border-slate-200 focus-within:border-slate-400 transition-all">
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
                                ? 'bg-slate-900 text-white hover:bg-slate-800'
                                : 'text-slate-300 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Ban size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingItemId((curr) => (curr === item.id ? null : item.id))}
                            className="text-[10px] font-black uppercase text-slate-600 hover:bg-slate-100 px-2 py-1 rounded-lg border border-slate-200"
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
                          <div className="space-y-3 pt-2 border-t border-slate-100">
                            <input
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                              value={item.name}
                              onChange={(e) => setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, name: e.target.value } : x))}
                              placeholder="Item name"
                            />
                            <AddCategorySubcategoryPicker
                              categories={categories}
                              category={item.category}
                              subCategory={item.subCategory || ''}
                              size="sm"
                              onChange={(next) =>
                                setItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? { ...x, category: next.category, subCategory: next.subCategory }
                                      : x
                                  )
                                )
                              }
                            />
                            <input
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
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
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${addAsBundle ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        <Package size={16}/>
                     </div>
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">Add as bundle?</span>
                        <span className="text-[10px] text-slate-400">Creates one bundle item with child components, margin calculated from children</span>
                     </div>
                     <input type="checkbox" checked={addAsBundle} onChange={e => setAddAsBundle(e.target.checked)} className="hidden"/>
                     {addAsBundle && <CheckCircle2 size={16} className="text-slate-900"/>}
                  </label>
               )}
               {addAsBundle && items.length >= 2 && (
                  <>
                     <div className="mb-4">
                        <label className={`${ADD_FLOW_LABEL} block mb-1`}>Bundle name</label>
                        <input 
                           className={ADD_FLOW_INPUT}
                           placeholder={`Bundle: ${items[0]?.name || 'Item 1'} + ${items.length - 1} more`}
                           value={bundleName}
                           onChange={e => setBundleName(e.target.value)}
                        />
                     </div>
                     <div className="flex flex-wrap gap-4 mb-4 p-3 bg-white rounded-xl border border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={bundleHasOVP} onChange={(e) => setBundleHasOVP(e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-500" />
                           <span className="text-sm font-bold text-slate-700">OVP (Original Packaging)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={bundleHasIOShield} onChange={(e) => setBundleHasIOShield(e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-500" />
                           <span className="text-sm font-bold text-slate-700">IO Shield</span>
                        </label>
                     </div>
                  </>
               )}
               {!addAsBundle && items.length > 0 && (
                  <label className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
                     <input type="checkbox" checked={allItemsHaveOVP} onChange={e => setAllItemsHaveOVP(e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-500" />
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">OVP (Original Packaging)</span>
                        <span className="text-[10px] text-slate-400">All items come with original packaging</span>
                     </div>
                  </label>
               )}
               {aiAvailable && (
                  <label className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${parseSpecsBeforeImport ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        <Sparkles size={16}/>
                     </div>
                     <div className="flex-1">
                        <span className="text-xs font-bold text-slate-700 block">Parse tech specs with AI before import</span>
                        <span className="text-[10px] text-slate-400">Fills specs from product knowledge so you don't need to edit later</span>
                     </div>
                     <input type="checkbox" checked={parseSpecsBeforeImport} onChange={e => setParseSpecsBeforeImport(e.target.checked)} className="hidden"/>
                     {parseSpecsBeforeImport && <CheckCircle2 size={16} className="text-slate-900"/>}
                  </label>
               )}
               <div className="hidden lg:flex justify-between items-center mb-6 text-xs font-bold text-slate-500">
                  <span>Total Paid: <span className="text-slate-900">€{formatEUR(totalCost)}</span></span>
                  <span>Allocated: <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'text-red-500' : 'text-emerald-500'}>€{formatEUR(allocatedTotal)}</span></span>
               </div>
               <AddFlowPrimaryButton
                  onClick={handleSubmit}
                  disabled={items.length === 0 || parsingSpecs}
                  className="hidden lg:flex w-full py-5"
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
               </AddFlowPrimaryButton>
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
         <AddFlowPrimaryButton
            onClick={handleSubmit}
            disabled={items.length === 0 || parsingSpecs}
            className="w-full py-3.5"
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
         </AddFlowPrimaryButton>
      </div>
    </div>
  );
};

export default BulkItemForm;
