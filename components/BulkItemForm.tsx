
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Save, Plus, Trash2, Calendar, 
  ShoppingBag, Calculator, Layers, 
  Search, Database, 
  CheckCircle2,
  Sparkles, Loader2, Package, Ban, ScanBarcode, Wrench, Upload
} from 'lucide-react';
import { InventoryItem, ItemStatus, Platform, PaymentType, BulkImportRecord, BulkImportSource } from '../types';
import {
  defaultBuyPaymentForPlatform,
  normalizeBuyPaymentForPlatform,
  paymentAfterPlatformChange,
  formatPlatformBoughtShort,
  formatBuyPaymentShort,
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
import {
  clampToLiveCategories,
  formatCategoryTreeForPrompt,
  inferCategoryFromName,
  reconcileBulkCategory,
  resolveSubCategory,
} from '../utils/bulkCategoryInfer';
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

function parseBulkTextLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•▸\-*]+/, '').trim())
    .filter(Boolean);
}

function parseQuantityAndName(rawLine: string): { name: string; quantity: number } {
  return parseBulkLineQuantityAndName(rawLine);
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
  const bulkTextRef = useRef<HTMLTextAreaElement>(null);
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

  const purchaseSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(totalCost > 0 ? `€${formatEUR(totalCost)}` : '€0');
    if (buyDate) {
      const d = new Date(`${buyDate}T12:00:00`);
      if (!Number.isNaN(d.getTime())) {
        parts.push(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
      }
    }
    parts.push(formatPlatformBoughtShort(platform));
    parts.push(formatBuyPaymentShort(payment));
    parts.push(`${items.length} item${items.length === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [totalCost, buyDate, platform, payment, items.length]);

  const syncBulkTextHeight = useCallback(() => {
    const el = bulkTextRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineCount = (el.value.match(/\n/g)?.length ?? 0) + 1;
    const minHeight = Math.max(52, lineCount * 20 + 16);
    const maxHeight = Math.min(Math.round(window.innerHeight * 0.42), 360);
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    syncBulkTextHeight();
  }, [bulkText, syncBulkTextHeight]);

  const handleAddManual = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newName) return;
    if (!newCategory) {
      alert('Choose a category first.');
      return;
    }
    const clamped = clampToLiveCategories(
      { category: newCategory, subCategory: newSubCategory },
      categories,
      onAddCategory
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
      categories,
      onAddCategory
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
      categories,
      onAddCategory
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
      const rec =
        importMode === 'AS_IS'
          ? reconcileBulkCategory(productFromLine || baseName, undefined, undefined, categories, onAddCategory)
          : reconcileBulkCategory(productFromLine || baseName, row.category, row.subCategory, categories, onAddCategory);
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
- Categories and subcategories must match the user's live tree when possible:
${formatCategoryTreeForPrompt(categories)}
- If the best subcategory is missing from the tree (e.g. "Displays" under Components), still output that subcategory name — the app will create it.
- Monitors, displays, and screens are NEVER graphics cards. Use Components/Displays or Peripherals/Monitors — never Graphics Cards for a monitor.
- Parse quantity from prefixes like "2x ..." or "8x4GB ...". If no quantity, use 1.
- Leading "2x Product" / "4x Product" is a PURCHASE count (how many units bought), not a RAM kit size. Example: "2x Samsung … 4GB" → quantity=2, name without the "2x". Spaced "2x 8GB Samsung" → quantity=2, single 8GB sticks (NOT a 2x8GB kit).
- Model codes like "ACR24D4U1S1ME-8X" or "…-8X 8GB": the "-8X" is part of the part number, NEVER modules=8. Keep the full model string in name — do NOT invent "64GB (8x8GB)".
- IMPORTANT: Do not classify CPUs, SSD/NVMe drives, RAM, motherboards, or monitors/displays as Graphics Cards.
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

  return (
    <div className="w-full min-w-0 h-[calc(100dvh-5.5rem)] md:h-[calc(100vh-5.5rem)] flex flex-col animate-in fade-in">
      <div className="px-1 sm:px-2 shrink-0">
        <AddFlowStepHeader title="Bulk entry" />
        <AddFlowPageHeader
          icon={<Layers size={22} strokeWidth={1.75} />}
          title="Bulk Entry"
          subtitle="Purchase rail · paste · sheet"
          onBack={() => navigate(-1)}
          actions={
            <AddFlowSecondaryButton onClick={() => navigate('/panel/bulk-imports')}>
              <Layers size={14} /> History
            </AddFlowSecondaryButton>
          }
        />
      </div>

      <main className="flex flex-1 min-h-0 flex-col gap-2 px-1 sm:px-2 pb-[max(5.5rem,calc(4rem+env(safe-area-inset-bottom)))] lg:flex-row lg:gap-2.5 lg:pb-2">
        <aside
          className={`${ADD_FLOW_PANEL} flex w-full shrink-0 flex-col overflow-hidden lg:max-h-full lg:w-[min(100%,22rem)] lg:max-w-[38%] lg:self-stretch`}
        >
          <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2">
            <h2 className="text-xs font-black text-slate-900">Purchase</h2>
            <p className="text-[10px] font-medium text-slate-500">{purchaseSummary}</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 sm:p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={ADD_FLOW_LABEL}>Total paid</label>
                <div className="mt-0.5 flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2 focus-within:border-slate-400">
                  <span className="text-[10px] font-bold text-slate-400">€</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="min-w-0 flex-1 bg-transparent px-1 text-xs font-black text-slate-900 outline-none"
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
              <div>
                <label className={ADD_FLOW_LABEL}>Buy date</label>
                <input
                  type="date"
                  className={`${ADD_FLOW_INPUT} mt-0.5 !h-8 !rounded-lg !px-2 !py-1 text-[11px]`}
                  value={buyDate}
                  onChange={(event) => setBuyDate(event.target.value)}
                />
              </div>
            </div>

            <BuySourcePlatformPicker
              size="sm"
              variant="chip"
              value={platform}
              onChange={(next) => {
                setPlatform(next);
                setPayment((prev) => paymentAfterPlatformChange(next, prev));
              }}
            />
            <BuyPaymentTypePicker
              size="sm"
              variant="chip"
              platform={platform}
              value={payment}
              onChange={(next) =>
                setPayment(normalizeBuyPaymentForPlatform(platform, next) || next)
              }
            />

            {(platform === 'kleinanzeigen.de' || platform === 'ebay.de') && (
              <div className="space-y-1.5">
                <p className={ADD_FLOW_LABEL}>Source proof</p>
                <BuySourceSellerField
                  compact
                  platform={platform}
                  value={batchSeller}
                  onChange={setBatchSeller}
                />
                {platform === 'kleinanzeigen.de' && (
                  <>
                    <input
                      className={`${ADD_FLOW_INPUT} !py-1.5 text-xs`}
                      placeholder="Seller profile URL"
                      value={sellerProfileUrl}
                      onChange={(event) => setSellerProfileUrl(event.target.value)}
                    />
                    <input
                      className={`${ADD_FLOW_INPUT} !py-1.5 text-xs`}
                      placeholder="Chat URL"
                      value={chatUrl}
                      onChange={(event) => setChatUrl(event.target.value)}
                    />
                    <div className="flex gap-1.5">
                      <input
                        className={`${ADD_FLOW_INPUT} min-w-0 flex-1 !py-1.5 text-xs`}
                        placeholder={chatImage.startsWith('data:') ? 'Screenshot attached' : 'Chat screenshot URL'}
                        value={chatImage.startsWith('data:') ? '' : chatImage}
                        onChange={(event) => setChatImage(event.target.value.trim())}
                      />
                      <label
                        className="flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50"
                        title="Upload chat screenshot"
                      >
                        <Upload size={13} />
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                      {chatImage ? (
                        <button
                          type="button"
                          onClick={() => setChatImage('')}
                          className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCostSplitMode((mode) => (mode === 'EQUAL' ? 'SMART' : 'EQUAL'))}
                className={`h-8 flex-1 rounded-lg border px-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
                  costSplitMode === 'SMART'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                title="Smart split prioritizes expensive component types"
              >
                Smart {costSplitMode === 'SMART' ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={distributeEvenly}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
              >
                <Calculator size={12} /> Reset
              </button>
            </div>
          </div>
          <div className="hidden shrink-0 border-t border-slate-100 p-2.5 lg:block">
            <AddFlowPrimaryButton
              onClick={handleSubmit}
              disabled={items.length === 0 || parsingSpecs}
              className="h-10 w-full whitespace-nowrap text-[10px]"
            >
              {parsingSpecs ? (
                <><Loader2 size={14} className="animate-spin" /> {parseProgress || 'Parsing…'}</>
              ) : (
                <><Save size={14} /> Confirm import ({items.length})</>
              )}
            </AddFlowPrimaryButton>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:gap-2.5">
        <section className={`${ADD_FLOW_PANEL} shrink-0 p-2 sm:p-2.5`}>
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <label className={ADD_FLOW_LABEL}>Paste seeds</label>
              <textarea
                ref={bulkTextRef}
                rows={2}
                className={`${ADD_FLOW_INPUT} mt-0.5 min-h-[3.25rem] resize-none !rounded-lg !px-2.5 !py-1.5 text-xs leading-5`}
                placeholder={'One item per line — paste fills editable rows below\nExample: ASUS TUF Gaming RTX 5070 12GB'}
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                onPaste={() => requestAnimationFrame(syncBulkTextHeight)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-1.5 lg:w-auto lg:shrink-0 lg:pt-[1.125rem]">
              <div className="grid min-w-[11rem] grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setBulkQtyMode('INDIVIDUAL')}
                  className={`rounded-md px-2 py-1.5 text-[9px] font-black uppercase ${
                    bulkQtyMode === 'INDIVIDUAL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Separate
                </button>
                <button
                  type="button"
                  onClick={() => setBulkQtyMode('LOT')}
                  className={`rounded-md px-2 py-1.5 text-[9px] font-black uppercase ${
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
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Fill sheet
              </button>
              <button
                type="button"
                onClick={handleParseBulkTextWithAI}
                disabled={!bulkText.trim() || bulkTextBusy}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[9px] font-black uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {bulkTextBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Parse AI
              </button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-medium text-slate-400">Paste fills rows below. Review names, categories, and costs before importing.</p>
            {bulkTextStatus && <p className="text-[10px] text-slate-500">{bulkTextStatus}</p>}
          </div>
        </section>

        <section className={`${ADD_FLOW_PANEL} flex min-h-[14rem] flex-1 flex-col overflow-hidden lg:min-h-0`}>
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
            <table className="w-full min-w-[520px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-[11rem]" />
                <col className="w-20" />
                <col className="w-12" />
                <col className="w-20" />
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
                                subCategory: resolveSubCategory(category, '', categories, onAddCategory),
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
              <span className="block text-[10px] font-medium text-slate-400">Single-item add, photos, bundle and AI options</span>
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
        </div>
      </main>

      <div className="lg:hidden fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[90] border-t border-slate-200 bg-white/95 backdrop-blur-sm px-3 pt-2 pb-2 shadow-[0_-6px_20px_rgba(15,23,42,0.08)]">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500">
          <span className="min-w-0 truncate">{purchaseSummary}</span>
          <span className={Math.abs(allocatedTotal - totalCost) > 0.1 ? 'shrink-0 text-red-500' : 'shrink-0 text-emerald-600'}>
            Alloc €{formatEUR(allocatedTotal)}
          </span>
        </div>
        <AddFlowPrimaryButton onClick={handleSubmit} disabled={items.length === 0 || parsingSpecs} className="w-full py-3.5">
          {parsingSpecs ? <><Loader2 size={16} className="animate-spin" /> {parseProgress || 'Parsing…'}</> : <><Save size={16} /> {items.length === 0 ? 'Add items to import' : `Confirm import (${items.length})`}</>}
        </AddFlowPrimaryButton>
      </div>
    </div>
  );
};

export default BulkItemForm;
