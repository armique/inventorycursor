import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useDeferredValue, startTransition } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { pickEssentialSpecOptions, mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { formatEUR, parseLocaleMoney, parseLocaleNumber } from '../utils/formatMoney';
import { toLocalCalendarDateKey } from '../utils/calendarDate';
import { getTimeGaugeRow, resolveContainerChildItems, stressToRgb, timeGaugeSortKey, buildTimeGaugeSortKeyMap } from '../utils/inventoryTimeGauge';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Edit2, Search, CheckSquare, Square, X, Check, Trash2, Calendar, Package, Plus, Minus, Receipt, Monitor, ArrowUp, ArrowDown, ArrowUpDown, Tag, Info, Layers, ListTree, ChevronRight, ShoppingBag, Settings2, RotateCcw, RotateCw, HeartCrack, ListPlus, ArrowRightLeft, Archive, History, MoreHorizontal, Filter, FilterX, TrendingUp, Wallet, Download, FileSpreadsheet, Globe, CreditCard, Hourglass, AlertCircle, XCircle, Hammer, Share2, Copy, Sliders, Image as ImageIcon, ImageOff, FileText, Clock, Upload, Percent, CalendarRange, Wrench, Loader2, FolderInput, CalendarDays, Eye, Unlink, BoxSelect, ChevronUp, ChevronDown, StickyNote, ListChecks, Sparkles, ArrowRight, Columns2, List, AlertTriangle, Home, Handshake, Gavel, Megaphone, Camera, Gift, User
} from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings, Platform, PaymentType, ItemUpdateOptions, CustomerInfo, TaxMode } from '../types';
import { isRealizedDisposal, isSoldOrTradedOnly } from '../utils/itemDisposition';
import { computeItemProfitBeforeOverhead, getChildren, getSoldContainerDisplayTotals, shouldHideContainerChildInList, containerOrChildMatchesSearch } from '../services/financialAggregation';
import { itemMatchesSalePlatformFilter, isMissingExplicitSalePlatform, MISSING_PLATFORM_FILTER, SALE_PLATFORM_OPTIONS, formatItemSalePlatform, formatSalePlatformLabel } from '../utils/salePlatform';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { getCompatibleItemsForItem } from '../services/compatibility';
import { generateKleinanzeigenCSV, generateEbayCSV } from '../services/ebayCsvService';
import { matchesInventorySearch } from '../utils/inventorySearchIndex';
import {
  type AmountFilterState,
  EMPTY_AMOUNT_FILTER,
  isAmountFilterActive,
  itemMatchesAmountFilter,
  amountFilterSummary,
} from '../utils/inventoryAmountFilter';
import { copyKleinanzeigenListing } from '../utils/copyKleinanzeigenListing';
import { cycleInventoryItemPresence, getItemPresenceCycleState, getItemUserPhotoCount, normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { exportInventoryToExcel } from '../services/excelExportService';
import { getRecentItemIds, addRecentItemId } from '../services/recentItemsService';
import { generateStoreDescription } from '../services/specsAI';
import { suggestPriceFromSoldListings, SoldPriceSuggestion, getSpecsAIProvider } from '../services/specsAI';

const ebaySoldSearchUrl = (query: string) =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
import SaleModal from './SaleModal';
import ReturnModal from './ReturnModal';
import TradeModal from './TradeModal';
import GiftModal from './GiftModal';
import CrossPostingModal from './CrossPostingModal';
import RetroBundleModal from './RetroBundleModal';
import EditItemModal from './EditItemModal';
import ItemForm from './ItemForm';
import ItemThumbnail from './ItemThumbnail';
import InvoiceView from './InvoiceView';
import InventoryAISpecsPanel from './InventoryAISpecsPanel';
import AddPhotosModal, { type AddPhotosApplyOptions } from './AddPhotosModal';
import ProductCardGeneratorModal from './ProductCardGeneratorModal';
import BulkSelectionBar, { type BulkAction } from './BulkSelectionBar';
import { generateItemSpecs } from '../services/specsAI';
import { getStorefrontHiddenReason, isPublishedOnStorefront } from '../utils/storefrontCatalog';
import { fetchEbayListingPriceForItem, type EbayListingPriceMatch } from '../services/ebayService';
import { hasEbayStorefrontPriceSynced } from '../utils/ebayPrice';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { findMatchingOrdersForItem, type EbayOrderMatch } from '../utils/ebayOrderMatch';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import ContainerMembershipBadge from './ContainerMembershipBadge';
import {
  buildContainersById,
  buildContainerByChildId,
  getContainerKind,
  isContainerMember,
  resolveParentContainer,
} from '../utils/containerMembership';
import { resolveTradeReceivedItems, resolveTradeSourceItem } from '../utils/tradeLinks';
import TradeLinkBadge from './TradeLinkBadge';

interface Props {
  items: InventoryItem[];
  totalCount: number;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
  onDelete: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pageTitle: string;
  allowedStatuses: ItemStatus[];
  businessSettings: BusinessSettings;
  onBusinessSettingsChange: (settings: BusinessSettings) => void;
  categories: Record<string, string[]>;
  categoryFields?: Record<string, string[]>; 
  persistenceKey?: string;
  onPublishStoreCatalog?: () => void | Promise<void>;
}

const EMPTY_TIME_GAUGE_SORT_MAP = new Map<string, number>();
const EMPTY_COMPAT_COUNT_MAP = new Map<string, number>();

type ColumnId = 'select' | 'item' | 'presence' | 'parseSpecs' | 'category' | 'status' | 'buyPrice' | 'sellPrice' | 'storePrice' | 'profit' | 'buyDate' | 'timeGauge' | 'sellDate' | 'salePlatform' | 'actions';
type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';
type StatusFilter = 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL';

type QuickCategoryPin = {
  id: string;
  label: string;
  category: string;
  /** Empty = filter by top-level category only */
  subCategory?: string;
};

function quickCategoryPinId(category: string, subCategory?: string): string {
  return subCategory ? `${category}::${subCategory}` : `${category}::`;
}

/** Parent rows that own children (PC builds, lot bundles, etc.). */
function isInventoryContainer(item: InventoryItem): boolean {
  return Boolean(
    item.isPC ||
      item.isBundle ||
      (item.componentIds && item.componentIds.length > 0)
  );
}

function containerRowClassName(item: InventoryItem, isSelected: boolean, highlighted: boolean): string {
  const parts = ['group/row transition-colors'];
  if (highlighted) {
    parts.push('ring-2 ring-amber-400 ring-inset bg-amber-50/40 animate-pulse');
    return parts.join(' ');
  }
  if (isSelected) {
    parts.push('bg-blue-50/35');
  }
  if (item.isPC) {
    parts.push(
      isSelected
        ? 'bg-indigo-100/50 hover:bg-indigo-100/70 shadow-[inset_3px_0_0_0_#4f46e5]'
        : 'bg-indigo-50/55 hover:bg-indigo-50/90 shadow-[inset_3px_0_0_0_#6366f1]'
    );
  } else if (isInventoryContainer(item)) {
    parts.push(
      isSelected
        ? 'bg-violet-100/50 hover:bg-violet-100/70 shadow-[inset_3px_0_0_0_#7c3aed]'
        : 'bg-violet-50/60 hover:bg-violet-50/95 shadow-[inset_3px_0_0_0_#8b5cf6]'
    );
  } else if (!isSelected) {
    parts.push('hover:bg-slate-50/50');
  }
  return parts.join(' ');
}

function specValuesMatch(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function toggleSpecFilterSelection(
  prev: Record<string, (string | number)[]>,
  key: string,
  val: string | number
): Record<string, (string | number)[]> {
  const arr = [...(prev[key] ?? [])];
  const isSel = arr.some((a) => specValuesMatch(a, val));
  if (isSel) {
    const idx = arr.findIndex((a) => specValuesMatch(a, val));
    if (idx !== -1) arr.splice(idx, 1);
  } else {
    arr.push(val);
  }
  const next = { ...prev };
  if (arr.length) next[key] = arr;
  else delete next[key];
  return next;
}

const DEFAULT_QUICK_CATEGORY_PINS: QuickCategoryPin[] = [
  { id: quickCategoryPinId('Components', 'Processors'), label: 'CPU', category: 'Components', subCategory: 'Processors' },
  { id: quickCategoryPinId('Components', 'Graphics Cards'), label: 'GPU', category: 'Components', subCategory: 'Graphics Cards' },
  { id: quickCategoryPinId('Components', 'Motherboards'), label: 'Motherboards', category: 'Components', subCategory: 'Motherboards' },
  { id: quickCategoryPinId('Components', 'Storage (SSD/HDD)'), label: 'SSD/HDD', category: 'Components', subCategory: 'Storage (SSD/HDD)' },
];

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

/** Inv column: icon buttons in one row (28px each + 4px gaps, matching the actual `gap-1` grid + cell padding). */
const PRESENCE_ICON_SIZE_PX = 28;
const PRESENCE_ICON_GAP_PX = 4;
const PRESENCE_ICON_COUNT = 5;
const PRESENCE_COL_WIDTH =
  PRESENCE_ICON_COUNT * PRESENCE_ICON_SIZE_PX +
  (PRESENCE_ICON_COUNT - 1) * PRESENCE_ICON_GAP_PX +
  12;

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 36,
  item: 200,
  presence: PRESENCE_COL_WIDTH,
  parseSpecs: 148,
  category: 116,
  status: 82,
  buyPrice: 76,
  sellPrice: 76,
  storePrice: 84,
  profit: 76,
  buyDate: 90,
  timeGauge: 72,
  sellDate: 90,
  salePlatform: 168,
  actions: 104,
};

const ALL_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'select', label: '' },
  { id: 'item', label: 'Asset Name' },
  { id: 'presence', label: 'Flags' },
  { id: 'category', label: 'Category' },
  { id: 'status', label: 'State' },
  { id: 'buyPrice', label: 'Buy Price' },
  { id: 'sellPrice', label: 'Sell Price' },
  { id: 'storePrice', label: 'Storefront Price' },
  { id: 'profit', label: 'Margin' },
  { id: 'buyDate', label: 'Acquired' },
  { id: 'timeGauge', label: 'Time' },
  { id: 'sellDate', label: 'Sold Date' },
  { id: 'actions', label: 'Actions' },
];

function clampInventoryColumnWidth(colId: ColumnId, w: number): number {
  const def = DEFAULT_WIDTHS[colId];
  const floor =
    colId === 'presence'
      ? PRESENCE_COL_WIDTH - 8
      : colId === 'parseSpecs'
        ? 132
        : colId === 'category'
          ? 96
          : Math.max(40, Math.floor(def * 0.35));
  const min = floor;
  const max = colId === 'item' ? Math.min(1200, Math.ceil(def * 6)) : Math.min(900, Math.ceil(def * 3.5));
  return Math.round(Math.min(max, Math.max(min, w)));
}

/** Auto-sized columns: fit header label + widest cell value; grow only when content requires it. */
function clampAutoColumnWidth(colId: ColumnId, w: number): number {
  const absoluteMin =
    colId === 'presence'
      ? PRESENCE_COL_WIDTH
      : colId === 'category'
        ? 80
        : colId === 'timeGauge'
          ? 72
          : colId === 'actions'
            ? 96
            : 52;
  const absoluteMax = ['buyPrice', 'sellPrice', 'storePrice', 'profit'].includes(colId)
    ? 1600
    : colId === 'actions'
      ? 960
      : 720;
  return Math.round(Math.min(absoluteMax, Math.max(absoluteMin, w)));
}

const HEADER_MEASURE_FONT = '900 10px Inter, sans-serif';
const HEADER_MEASURE_TRACKING = 2.2;
/** Horizontal padding in cells + room for sort chevron (matches thead/tbody CSS). */
const AUTO_COL_HPAD = 28;

function getColumnHeaderLabel(colId: ColumnId): string {
  return ALL_COLUMNS.find((c) => c.id === colId)?.label || '';
}

function measureColumnHeader(ctx: CanvasRenderingContext2D, colId: ColumnId): number {
  const label = getColumnHeaderLabel(colId);
  if (!label) return 0;
  return measureTextWidth(ctx, label.toUpperCase(), HEADER_MEASURE_FONT, HEADER_MEASURE_TRACKING);
}

/** Column ids whose width auto-fits the longest currently-rendered value (narrow by default, grows only for long content like a huge price). */
const AUTO_SIZE_COLUMN_IDS: ColumnId[] = [
  'presence',
  'category',
  'status',
  'buyPrice',
  'sellPrice',
  'storePrice',
  'profit',
  'buyDate',
  'timeGauge',
  'sellDate',
  'actions',
];

const ACTIONS_BUTTON_PX = 28;
const ACTIONS_GAP_PX = 2;

/** Number of action buttons rendered for a given item — must mirror the conditions in the 'actions' cell below. */
function countActionButtons(item: InventoryItem): number {
  let n = 2; // Edit, Duplicate (always shown)
  if (item.status === ItemStatus.IN_STOCK) n += 6; // Check price, Cross-post, AI tools, Mark sold, Trade, Gift
  if (item.isPC || item.isBundle) n += 1; // Unbundle
  if (isSoldOrTradedOnly(item)) n += 1; // Invoice
  if (item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED) n += 1; // Mark unsold/return or undo gift
  n += 1; // Delete (always shown)
  return n;
}

let measureCanvasCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCanvasCtx !== undefined) return measureCanvasCtx;
  try {
    measureCanvasCtx = document.createElement('canvas').getContext('2d');
  } catch {
    measureCanvasCtx = null;
  }
  return measureCanvasCtx;
}

/** Rough text width in px, padding out for letter-spacing (tracking) that measureText ignores. */
function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, font: string, trackingPx = 0): number {
  ctx.font = font;
  return ctx.measureText(text).width + trackingPx * Math.max(0, text.length - 1);
}

/** Computes a "just wide enough" width per auto-size column from header labels + cell content. */
function computeAutoColumnWidths(items: InventoryItem[]): Partial<Record<ColumnId, number>> {
  const ctx = getMeasureCtx();
  if (!ctx) return {};

  let categoryW = measureColumnHeader(ctx, 'category');
  let statusW = measureColumnHeader(ctx, 'status');
  let buyPriceW = measureColumnHeader(ctx, 'buyPrice');
  let sellPriceW = measureColumnHeader(ctx, 'sellPrice');
  let storePriceW = measureColumnHeader(ctx, 'storePrice');
  let profitW = measureColumnHeader(ctx, 'profit');
  let buyDateW = measureColumnHeader(ctx, 'buyDate');
  let sellDateW = measureColumnHeader(ctx, 'sellDate');
  let timeGaugeW = measureColumnHeader(ctx, 'timeGauge');
  let actionsW = measureColumnHeader(ctx, 'actions');

  const emptyCellW = measureTextWidth(ctx, '-', '700 13px Inter, sans-serif');
  sellPriceW = Math.max(sellPriceW, emptyCellW);
  storePriceW = Math.max(storePriceW, emptyCellW);
  profitW = Math.max(profitW, emptyCellW);

  let maxActionButtons = 0;

  for (const item of items) {
    maxActionButtons = Math.max(maxActionButtons, countActionButtons(item));
    if (item.category) {
      categoryW = Math.max(categoryW, measureTextWidth(ctx, item.category.toUpperCase(), '900 11px Inter, sans-serif'));
    }
    if (item.subCategory) {
      categoryW = Math.max(categoryW, measureTextWidth(ctx, item.subCategory, '700 9px Inter, sans-serif'));
    }

    const statusLabel = item.status === ItemStatus.IN_COMPOSITION ? 'In Composition' : item.status;
    statusW = Math.max(statusW, measureTextWidth(ctx, String(statusLabel).toUpperCase(), '900 10px Inter, sans-serif', 2.2));

    buyPriceW = Math.max(buyPriceW, measureTextWidth(ctx, `€${formatEUR(item.buyPrice)}`, '900 13px Inter, sans-serif'));
    sellPriceW = Math.max(
      sellPriceW,
      measureTextWidth(ctx, item.sellPrice ? `€${formatEUR(item.sellPrice)}` : '-', '700 13px Inter, sans-serif')
    );
    storePriceW = Math.max(
      storePriceW,
      measureTextWidth(ctx, item.storePrice ? `€${formatEUR(item.storePrice)}` : '-', '700 13px Inter, sans-serif')
    );
    if (item.profit != null && !item.isPC && !item.isBundle) {
      profitW = Math.max(profitW, measureTextWidth(ctx, `€${formatEUR(item.profit)}`, '900 13px Inter, sans-serif'));
    }
    if (item.buyDate && !item.isPC && !item.isBundle) {
      buyDateW = Math.max(buyDateW, measureTextWidth(ctx, item.buyDate, '700 12px Inter, sans-serif'));
    }
    if (item.sellDate) {
      sellDateW = Math.max(sellDateW, measureTextWidth(ctx, item.sellDate, '700 12px Inter, sans-serif'));
    }
  }

  const actionsButtonsW =
    maxActionButtons > 0
      ? maxActionButtons * ACTIONS_BUTTON_PX + Math.max(0, maxActionButtons - 1) * ACTIONS_GAP_PX
      : 0;
  actionsW = Math.max(actionsW, actionsButtonsW);

  timeGaugeW = Math.max(timeGaugeW, 68);

  return {
    presence: PRESENCE_COL_WIDTH,
    category: clampAutoColumnWidth('category', Math.ceil(categoryW) + AUTO_COL_HPAD + 8),
    status: clampAutoColumnWidth('status', Math.ceil(statusW) + AUTO_COL_HPAD + 28),
    buyPrice: clampAutoColumnWidth('buyPrice', Math.ceil(buyPriceW) + AUTO_COL_HPAD),
    sellPrice: clampAutoColumnWidth('sellPrice', Math.ceil(sellPriceW) + AUTO_COL_HPAD),
    storePrice: clampAutoColumnWidth('storePrice', Math.ceil(storePriceW) + AUTO_COL_HPAD),
    profit: clampAutoColumnWidth('profit', Math.ceil(profitW) + AUTO_COL_HPAD),
    buyDate: clampAutoColumnWidth('buyDate', Math.ceil(buyDateW) + AUTO_COL_HPAD),
    timeGauge: clampAutoColumnWidth('timeGauge', Math.ceil(timeGaugeW) + AUTO_COL_HPAD),
    sellDate: clampAutoColumnWidth('sellDate', Math.ceil(sellDateW) + AUTO_COL_HPAD),
    actions: clampAutoColumnWidth('actions', Math.ceil(actionsW) + AUTO_COL_HPAD),
  };
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

type InventoryListFilterParams = {
  items: InventoryItem[];
  statusFilter: StatusFilter;
  searchTerm: string;
  categoryFilter: string;
  subCategoryFilter: string;
  sortConfig: SortConfig;
  timeFilter: TimeFilter;
  dateRange: { start: Date; end: Date };
  salePlatformFilter: string;
  salePaymentFilter: string;
  specFilters: Record<string, (string | number)[]>;
  specRangeFilters: Record<string, { min?: number; max?: number }>;
  showInComposition: boolean;
  timeGaugeSortKeyMap: Map<string, number>;
  amountFilter: AmountFilterState;
};

function filterAndSortInventoryItems(params: InventoryListFilterParams): InventoryItem[] {
  const {
    items,
    statusFilter,
    searchTerm,
    categoryFilter,
    subCategoryFilter,
    sortConfig,
    timeFilter,
    dateRange,
    salePlatformFilter,
    salePaymentFilter,
    specFilters,
    specRangeFilters,
    showInComposition,
    timeGaugeSortKeyMap,
    amountFilter,
  } = params;

  const query = searchTerm.trim();
  const searchActive = query.length >= 2;

  const filtered = items.filter((item) => {
    let matchesStatus = false;
    if (statusFilter === 'ACTIVE') {
      matchesStatus =
        item.status === ItemStatus.IN_STOCK ||
        item.status === ItemStatus.ORDERED ||
        item.status === ItemStatus.IN_COMPOSITION;
    } else if (statusFilter === 'SOLD') {
      matchesStatus = isRealizedDisposal(item);
    } else if (statusFilter === 'DRAFTS') {
      matchesStatus = item.isDraft === true;
    } else {
      matchesStatus = true;
    }
    if (!matchesStatus) return false;
    // Bundle/PC/lot components always nest under the parent — never as top-level rows.
    // Search still surfaces the parent when a child matches.
    if (shouldHideContainerChildInList(item, items)) return false;
    // Orphan "in composition" rows (no parent container) respect the visibility toggle.
    if (!searchActive && !showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;

    // While actively searching, ignore the category filter entirely so search is always global —
    // otherwise a category filter left active from earlier browsing (e.g. a quick-category pin)
    // silently hides matching items in other categories with no indication why.
    if (!searchActive && (categoryFilter !== 'ALL' || subCategoryFilter)) {
      const matchParentAndSub =
        categoryFilter !== 'ALL' &&
        item.category === categoryFilter &&
        (!subCategoryFilter || item.subCategory === subCategoryFilter);
      const matchSubAsTopLevel = subCategoryFilter && item.category === subCategoryFilter;
      if (!matchParentAndSub && !matchSubAsTopLevel) return false;
    }

    if (searchActive) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, query, matchesInventorySearch)) return false;
      } else if (!matchesInventorySearch(item, query)) {
        return false;
      }
    }

    // Spec and date filters are browsing aids — skip them during search so a suggestion click always reveals the row.
    if (!searchActive && timeFilter !== 'ALL') {
      const isSalesItem = isRealizedDisposal(item);
      const dateStr = isSalesItem ? item.sellDate : item.buyDate;
      if (!dateStr) return true;
      const itemDate = new Date(dateStr);
      if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
    }

    if (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS') {
      if (salePlatformFilter !== 'ALL') {
        if (salePlatformFilter === MISSING_PLATFORM_FILTER) {
          if (!isMissingExplicitSalePlatform(item)) return false;
        } else if (!itemMatchesSalePlatformFilter(item, salePlatformFilter as Platform)) return false;
      }
      if (salePaymentFilter !== 'ALL' && item.paymentType !== salePaymentFilter) return false;
      if (!searchActive && isAmountFilterActive(amountFilter) && !itemMatchesAmountFilter(item, amountFilter)) {
        return false;
      }
    }

    if (!searchActive) {
      for (const key of Object.keys(specFilters)) {
        const allowed = specFilters[key];
        if (!allowed || allowed.length === 0) continue;
        const v = item.specs?.[key];
        if (v === undefined || v === null) return false;
        const match = allowed.some((a) => {
          if (typeof v === 'number' && typeof a === 'number') return v === a;
          return String(v).trim().toLowerCase() === String(a).trim().toLowerCase();
        });
        if (!match) return false;
      }

      for (const key of Object.keys(specRangeFilters)) {
        const { min, max } = specRangeFilters[key] || {};
        if (min === undefined && max === undefined) continue;
        const v = item.specs?.[key];
        const num = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(String(v)) : NaN;
        if (Number.isNaN(num)) return false;
        if (min !== undefined && num < min) return false;
        if (max !== undefined && num > max) return false;
      }
    }

    return true;
  });

  filtered.sort((a, b) => {
    const key = sortConfig.key === 'item' ? 'name' : sortConfig.key;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;

    if (sortConfig.key === 'timeGauge') {
      return ((timeGaugeSortKeyMap.get(a.id) ?? -1) - (timeGaugeSortKeyMap.get(b.id) ?? -1)) * dir;
    }

    let valA: unknown = (a as unknown as Record<string, unknown>)[key];
    let valB: unknown = (b as unknown as Record<string, unknown>)[key];

    if (key === 'buyDate' || key === 'sellDate') {
      const tA = valA ? new Date(valA as string).getTime() : 0;
      const tB = valB ? new Date(valB as string).getTime() : 0;
      return (tA - tB) * dir;
    }

    if (typeof valA === 'number' || typeof valB === 'number') {
      return (((valA as number) || 0) - ((valB as number) || 0)) * dir;
    }

    const strA = valA ? String(valA).toLowerCase() : '';
    const strB = valB ? String(valB).toLowerCase() : '';
    return strA.localeCompare(strB) * dir;
  });

  return filtered;
}

const InventoryList: React.FC<Props> = ({ 
  items, 
  totalCount, 
  onUpdate, 
  onDelete, 
  onUndo, 
  onRedo, 
  canUndo, 
  canRedo, 
  pageTitle, 
  allowedStatuses,
  businessSettings,
  onBusinessSettingsChange,
  categories = HIERARCHY_CATEGORIES,
  categoryFields = {}, 
  persistenceKey = 'default_inv',
  onPublishStoreCatalog,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // -- PERSISTENT STATE LOADING --
  const loadState = <T,>(key: string, defaultVal: T): T => {
    const saved = localStorage.getItem(`${persistenceKey}_${key}`);
    if (saved) return JSON.parse(saved);
    return defaultVal;
  };

  const [searchTerm, setSearchTerm] = useState(() => {
    const q = searchParams.get('q');
    return q != null ? q : loadState<string>('search', '');
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => loadState<TimeFilter>('time', 'ALL'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => loadState<StatusFilter>('status_filter', 'ACTIVE'));
  const [splitView, setSplitView] = useState<boolean>(() => loadState<boolean>('split_view', false));
  const [quickCategoryPins, setQuickCategoryPins] = useState<QuickCategoryPin[]>(() => {
    const saved = loadState<QuickCategoryPin[] | null>('quick_category_pins', null);
    return saved && saved.length > 0 ? saved : DEFAULT_QUICK_CATEGORY_PINS;
  });
  const [showQuickCategoryPicker, setShowQuickCategoryPicker] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>(() => loadState<string>('category_filter', 'ALL'));
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>(() => loadState<string>('subcategory_filter', ''));
  
  // New Filters for Sales
  const [salePlatformFilter, setSalePlatformFilter] = useState<string>(() => loadState<string>('sale_platform', 'ALL'));
  const [salePaymentFilter, setSalePaymentFilter] = useState<string>(() => loadState<string>('sale_payment', 'ALL'));
  const [amountFilter, setAmountFilter] = useState<AmountFilterState>(() =>
    loadState<AmountFilterState>('amount_filter', EMPTY_AMOUNT_FILTER)
  );
  const [showAmountFilterPanel, setShowAmountFilterPanel] = useState(false);
  const amountFilterPanelRef = useRef<HTMLDivElement>(null);
  const amountFilterButtonRef = useRef<HTMLButtonElement>(null);
  const [amountExactDraft, setAmountExactDraft] = useState('');
  const [amountMinDraft, setAmountMinDraft] = useState('');
  const [amountMaxDraft, setAmountMaxDraft] = useState('');

  // Spec filters: key -> allowed values (empty = no filter). Range filters for numeric specs.
  const [specFilters, setSpecFilters] = useState<Record<string, (string | number)[]>>(() => loadState('spec_filters', {}));
  const [specRangeFilters, setSpecRangeFilters] = useState<Record<string, { min?: number; max?: number }>>(() => loadState('spec_range_filters', {}));
  const [showSpecFiltersPanel, setShowSpecFiltersPanel] = useState(false);
  const filtersPanelRef = useRef<HTMLDivElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);

  // Visibility toggle for orphan "In Composition" items (container children always nest under parent)
  const [showInComposition, setShowInComposition] = useState<boolean>(() => loadState<boolean>('show_in_composition', false));

  /** Expanded bundle/PC rows showing nested children (active + sold). */
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(() => new Set());

  const toggleBundleExpanded = useCallback((id: string) => {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Sort State
  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
     const saved = localStorage.getItem(`${persistenceKey}_sort_config`);
     return saved ? JSON.parse(saved) : { key: 'buyDate', direction: 'desc' };
  });
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = loadState<Record<string, number>>('widths', DEFAULT_WIDTHS);
    const merged = { ...DEFAULT_WIDTHS, ...saved };
    if ((merged.presence ?? 0) < DEFAULT_WIDTHS.presence) merged.presence = DEFAULT_WIDTHS.presence;
    if ((merged.parseSpecs ?? 0) < DEFAULT_WIDTHS.parseSpecs) merged.parseSpecs = DEFAULT_WIDTHS.parseSpecs;
    if ((merged.category ?? 0) < DEFAULT_WIDTHS.category) merged.category = DEFAULT_WIDTHS.category;
    return merged;
  });
  // Columns the user has explicitly drag-resized; these opt out of auto-sizing until reset.
  const [manualWidthColumns, setManualWidthColumns] = useState<Set<ColumnId>>(
    () => new Set(loadState<ColumnId[]>('manual_width_cols', []).filter((id) => id === 'item'))
  );

  const defaultColumnOrder: ColumnId[] = ['select', 'item', 'presence', 'category', 'status', 'buyPrice', 'sellPrice', 'storePrice', 'profit', 'buyDate', 'timeGauge', 'sellDate', 'actions'];
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const saved = loadState<ColumnId[]>('column_order', defaultColumnOrder);
    const base = saved && saved.length > 0 ? saved : defaultColumnOrder;
    let next = [...base];
    if (!next.includes('timeGauge')) {
      const buy = next.indexOf('buyDate');
      if (buy >= 0) next.splice(buy + 1, 0, 'timeGauge');
      else next.splice(Math.max(0, next.length - 1), 0, 'timeGauge');
    }
    if (!next.includes('storePrice')) {
      const sell = next.indexOf('sellPrice');
      if (sell >= 0) next.splice(sell + 1, 0, 'storePrice');
      else next.splice(Math.max(0, next.length - 1), 0, 'storePrice');
    }
    // Remove any legacy salePlatform or parseSpecs entries from saved order
    next = next.filter(id => id !== 'salePlatform' && id !== 'parseSpecs');
    return next;
  });
  const [hiddenColumnIds, setHiddenColumnIds] = useState<ColumnId[]>(() => loadState<ColumnId[]>('hidden_columns', []));
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement>(null);
  const columnWidthsRef = useRef(columnWidths);
  const columnResizeRef = useRef<{ colId: ColumnId; startX: number; startW: number } | null>(null);

  // Migration: strip any legacy ghost columns (salePlatform, parseSpecs) that may
  // still be present in an already-mounted component's state (e.g. after HMR).
  useEffect(() => {
    const LEGACY_COLS = ['salePlatform', 'parseSpecs'] as string[];
    if (columnOrder.some(id => LEGACY_COLS.includes(id))) {
      setColumnOrder(prev => prev.filter(id => !LEGACY_COLS.includes(id)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);
  const [showRecentDropdown, setShowRecentDropdown] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  const recentItemsResolved = useMemo(() => {
    const ids = getRecentItemIds();
    const itemMap = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => itemMap.get(id)).filter(Boolean) as InventoryItem[];
  }, [items, showRecentDropdown]);

  const timeGaugeColumnTitle = useMemo(() => {
    if (statusFilter === 'SOLD') return 'Sale speed';
    if (statusFilter === 'ACTIVE') return 'Stock age';
    return 'Hold / sale';
  }, [statusFilter]);

  type ListDensity = 'comfortable' | 'compact';
  const [listDensity, setListDensity] = useState<ListDensity>(() => loadState<ListDensity>('list_density', 'compact'));
  useEffect(() => localStorage.setItem(`${persistenceKey}_list_density`, JSON.stringify(listDensity)), [listDensity, persistenceKey]);
  const [showAISpecsModal, setShowAISpecsModal] = useState(false);
  const [showBulkAddPhotosModal, setShowBulkAddPhotosModal] = useState(false);
  const [addPhotosTargetIds, setAddPhotosTargetIds] = useState<string[]>([]);
  const [cardGenItem, setCardGenItem] = useState<InventoryItem | null>(null);

  // -- INLINE EDITING STATE --
  const [editingCell, setEditingCell] = useState<{ itemId: string, field: ColumnId } | null>(null);
  const [editValue, setEditValue] = useState<string | number>('');
  const [parsingSingleId, setParsingSingleId] = useState<string | null>(null);
  const [activeAiDropdownId, setActiveAiDropdownId] = useState<string | null>(null);
  const rowClickTimeoutRef = useRef<number | null>(null);

  // Sync search from URL ?q= (e.g. from global search)
  useEffect(() => {
    const q = searchParams.get('q');
    if (q != null) setSearchTerm(q);
  }, [searchParams]);

  // -- STATE PERSISTENCE (batched; avoids many sync localStorage writes per keystroke) --
  const listPrefsPersistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (listPrefsPersistRef.current) clearTimeout(listPrefsPersistRef.current);
    listPrefsPersistRef.current = setTimeout(() => {
      listPrefsPersistRef.current = null;
      const k = persistenceKey;
      localStorage.setItem(`${k}_search`, JSON.stringify(searchTerm));
      localStorage.setItem(`${k}_time`, JSON.stringify(timeFilter));
      localStorage.setItem(`${k}_status_filter`, JSON.stringify(statusFilter));
      localStorage.setItem(`${k}_category_filter`, JSON.stringify(categoryFilter));
      localStorage.setItem(`${k}_subcategory_filter`, JSON.stringify(subCategoryFilter));
      localStorage.setItem(`${k}_sort_config`, JSON.stringify(sortConfig));
      localStorage.setItem(`${k}_widths`, JSON.stringify(columnWidths));
      localStorage.setItem(`${k}_manual_width_cols`, JSON.stringify(Array.from(manualWidthColumns)));
      localStorage.setItem(`${k}_sale_platform`, JSON.stringify(salePlatformFilter));
      localStorage.setItem(`${k}_sale_payment`, JSON.stringify(salePaymentFilter));
      localStorage.setItem(`${k}_amount_filter`, JSON.stringify(amountFilter));
      localStorage.setItem(`${k}_spec_filters`, JSON.stringify(specFilters));
      localStorage.setItem(`${k}_spec_range_filters`, JSON.stringify(specRangeFilters));
      localStorage.setItem(`${k}_show_in_composition`, JSON.stringify(showInComposition));
      localStorage.setItem(`${k}_column_order`, JSON.stringify(columnOrder));
      localStorage.setItem(`${k}_hidden_columns`, JSON.stringify(hiddenColumnIds));
      localStorage.setItem(`${k}_split_view`, JSON.stringify(splitView));
      localStorage.setItem(`${k}_quick_category_pins`, JSON.stringify(quickCategoryPins));
    }, 200);
    return () => {
      if (listPrefsPersistRef.current) clearTimeout(listPrefsPersistRef.current);
    };
  }, [
    searchTerm, timeFilter, statusFilter, categoryFilter, subCategoryFilter, sortConfig, columnWidths,
    manualWidthColumns, salePlatformFilter, salePaymentFilter, amountFilter, specFilters, specRangeFilters, showInComposition,
    columnOrder, hiddenColumnIds, splitView, quickCategoryPins, persistenceKey,
  ]);

  // Auto-expand bundle/PC rows when search matches a nested child
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) return;
    const toExpand: string[] = [];
    for (const item of items) {
      if (!item.isPC && !item.isBundle) continue;
      const children = getChildren(item, items);
      if (children.some((c) => matchesInventorySearch(c, q))) {
        toExpand.push(item.id);
      }
    }
    if (toExpand.length === 0) return;
    setExpandedBundles((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of toExpand) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [searchTerm, items]);

  // Close spec filters panel when clicking outside
  useEffect(() => {
    if (!showSpecFiltersPanel) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (filtersPanelRef.current?.contains(el) || filtersButtonRef.current?.contains(el)) return;
      setShowSpecFiltersPanel(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showSpecFiltersPanel]);

  useEffect(() => {
    if (!showAmountFilterPanel) return;
    setAmountExactDraft(amountFilter.exact != null ? String(amountFilter.exact) : '');
    setAmountMinDraft(amountFilter.min != null ? String(amountFilter.min) : '');
    setAmountMaxDraft(amountFilter.max != null ? String(amountFilter.max) : '');
  }, [showAmountFilterPanel, amountFilter.exact, amountFilter.min, amountFilter.max]);

  useEffect(() => {
    if (!showAmountFilterPanel) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (amountFilterPanelRef.current?.contains(el) || amountFilterButtonRef.current?.contains(el)) return;
      setShowAmountFilterPanel(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showAmountFilterPanel]);

  const applyAmountFilterDraft = useCallback(() => {
    const exactRaw = amountExactDraft.trim();
    const minRaw = amountMinDraft.trim();
    const maxRaw = amountMaxDraft.trim();
    const exact = exactRaw ? parseLocaleMoney(exactRaw) : null;
    const min = minRaw ? parseLocaleMoney(minRaw) : null;
    const max = maxRaw ? parseLocaleMoney(maxRaw) : null;
    if (exactRaw && exact == null) return;
    if (minRaw && min == null) return;
    if (maxRaw && max == null) return;
    setAmountFilter((prev) => ({
      ...prev,
      exact: exact ?? undefined,
      min: exact != null ? undefined : min ?? undefined,
      max: exact != null ? undefined : max ?? undefined,
    }));
    setShowAmountFilterPanel(false);
  }, [amountExactDraft, amountMinDraft, amountMaxDraft]);

  const clearAmountFilter = useCallback(() => {
    setAmountFilter(EMPTY_AMOUNT_FILTER);
    setAmountExactDraft('');
    setAmountMinDraft('');
    setAmountMaxDraft('');
    setShowAmountFilterPanel(false);
  }, []);

  // Close columns panel when clicking outside
  useEffect(() => {
    if (!showColumnsPanel) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (columnsPanelRef.current?.contains(el)) return;
      setShowColumnsPanel(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showColumnsPanel]);

  useEffect(() => {
    if (!showRecentDropdown) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (recentDropdownRef.current?.contains(el)) return;
      setShowRecentDropdown(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showRecentDropdown]);

  // Close AI actions dropdown when clicking outside
  useEffect(() => {
    if (!activeAiDropdownId) return;
    const handle = () => {
      setActiveAiDropdownId(null);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handle);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handle);
    };
  }, [activeAiDropdownId]);

  const toggleColumnVisibility = (id: ColumnId) => {
    const visible = visibleColumns.length;
    const wouldHide = !hiddenColumnIds.includes(id);
    if (wouldHide && visible <= 2) return; // keep at least 2 columns
    setHiddenColumnIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...columnOrder];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setColumnOrder(newOrder);
  };

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [scrollTargetItemId, setScrollTargetItemId] = useState<string | null>(null);
  
  // Modals
  const [itemToSell, setItemToSell] = useState<InventoryItem | null>(null);
  const [itemToEditBuyer, setItemToEditBuyer] = useState<InventoryItem | null>(null);
  const [itemToReturn, setItemToReturn] = useState<InventoryItem | null>(null);
  const [itemToTrade, setItemToTrade] = useState<InventoryItem | null>(null);
  const [itemToGift, setItemToGift] = useState<InventoryItem | null>(null);
  const [itemToCrossPost, setItemToCrossPost] = useState<InventoryItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const [itemToEditCategory, setItemToEditCategory] = useState<InventoryItem | null>(null);
  const [itemToEdit, setItemToEdit] = useState<InventoryItem | null>(null); 
  
  const [bundleToDismantle, setBundleToDismantle] = useState<InventoryItem | null>(null);
  const [invoiceViewItem, setInvoiceViewItem] = useState<InventoryItem | null>(null);

  const [showBulkSalesEdit, setShowBulkSalesEdit] = useState(false);
  const [showBulkCategoryEdit, setShowBulkCategoryEdit] = useState(false);
  const [showBulkStoreVisible, setShowBulkStoreVisible] = useState(false);
  const [showBulkSalePct, setShowBulkSalePct] = useState(false);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkGenerateDescriptions, setBulkGenerateDescriptions] = useState(false);
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<string | null>(null);
  const [showRetroBundle, setShowRetroBundle] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSuggestionsRef = useRef<HTMLDivElement>(null);

  const searchSuggestions = useMemo(() => {
    if (!searchSuggestionsOpen) return [];
    const q = searchTerm.trim().toLowerCase();
    if (q.length < 2) return [];
    const seen = new Set<string>();
    const out: { text: string; type: 'name' | 'category' | 'vendor' }[] = [];
    const add = (t: string, type: 'name' | 'category' | 'vendor') => {
      if (!t || !t.toLowerCase().includes(q) || seen.has(t)) return;
      seen.add(t);
      out.push({ text: t, type });
    };
    for (const i of items) {
      if (out.length >= 12) break;
      add(i.name, 'name');
      if (out.length >= 12) break;
      if (i.category) add(i.category, 'category');
      if (out.length >= 12) break;
      if (i.subCategory) add(`${i.category} / ${i.subCategory}`, 'category');
      if (out.length >= 12) break;
      if (i.vendor) add(i.vendor, 'vendor');
    }
    return out;
  }, [items, searchTerm, searchSuggestionsOpen]);

  const hasActiveSpecFilters = useMemo(() => {
    if (Object.values(specFilters).some((v) => v?.length)) return true;
    return Object.values(specRangeFilters).some(
      (r) => r && (r.min !== undefined || r.max !== undefined)
    );
  }, [specFilters, specRangeFilters]);
  const timeGaugeSortKeyMap = useMemo(() => {
    if (sortConfig.key !== 'timeGauge') return EMPTY_TIME_GAUGE_SORT_MAP;
    return buildTimeGaugeSortKeyMap(items);
  }, [items, sortConfig.key]);

  // --- INVENTORY PRESENCE (PRESENT / LOST / DEFECTIVE cycle) ---
  const togglePresence = (item: InventoryItem) => {
    onUpdate([cycleInventoryItemPresence(item)]);
  };

  const toggleStoreVisible = (item: InventoryItem) => {
    const hiddenReason = getStorefrontHiddenReason(item);
    if (hiddenReason && item.storeVisible !== false) {
      return;
    }
    if (item.status !== ItemStatus.IN_STOCK) {
      return;
    }
    const currentlyPublished = isPublishedOnStorefront(item);
    const updated: InventoryItem = {
      ...item,
      storeVisible: currentlyPublished ? false : true,
    };
    onUpdate([updated]);
    void onPublishStoreCatalog?.();
  };

  // --- AI LISTING DESCRIPTION (Kleinanzeigen / eBay style, same as store description style) ---
  const [listingGenId, setListingGenId] = useState<string | null>(null);
  const [priceSuggestId, setPriceSuggestId] = useState<string | null>(null);
  const [priceSuggestModalItem, setPriceSuggestModalItem] = useState<InventoryItem | null>(null);
  const [priceSuggestResult, setPriceSuggestResult] = useState<SoldPriceSuggestion | null>(null);
  const [priceSuggestError, setPriceSuggestError] = useState<string | null>(null);
  const [ebayPriceModalItem, setEbayPriceModalItem] = useState<InventoryItem | null>(null);
  const [ebayPriceLoading, setEbayPriceLoading] = useState(false);
  const [ebayPriceError, setEbayPriceError] = useState<string | null>(null);
  const [ebayPriceMatch, setEbayPriceMatch] = useState<EbayListingPriceMatch | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleGenerateListingDescription = async (item: InventoryItem) => {
    if (!item.name) {
      alert('Enter an item name first.');
      return;
    }
    setListingGenId(item.id);
    try {
      const context =
        item.marketDescription ||
        item.storeDescription ||
        item.comment1 ||
        '';
      const text = await generateStoreDescription(item.name, context || undefined, { hasOVP: item.hasOVP, hasIOShield: item.hasIOShield });
      const updated: InventoryItem = { ...item, marketDescription: text };
      onUpdate([updated]);
    } catch (e: any) {
      console.error('Listing description generation failed', e);
      const msg = e?.message || 'Failed to generate listing description.';
      alert(msg.includes('API key') ? `${msg}\n\nAdd an AI key in .env and restart the app.` : msg);
    } finally {
      setListingGenId(null);
    }
  };

  const handleCopyListingDescription = async (item: InventoryItem) => {
    if (!item.marketDescription) return;
    try {
      await navigator.clipboard.writeText(item.marketDescription);
      setToast('Listing text copied');
      setTimeout(() => setToast((prev) => (prev === 'Listing text copied' ? null : prev)), 1200);
    } catch (e) {
      console.error('Copy to clipboard failed', e);
      alert('Could not copy text to clipboard.');
    }
  };

  const handleSuggestPrice = async (item: InventoryItem) => {
    if (!item.name) {
      alert('Enter a name first.');
      return;
    }
    // Open modal immediately so user sees feedback
    setPriceSuggestModalItem(item);
    setPriceSuggestResult(null);
    setPriceSuggestError(null);
    setPriceSuggestId(item.id);
    if (!getSpecsAIProvider()) {
      setPriceSuggestError('No AI configured. Add VITE_GROQ_API_KEY or VITE_GEMINI_API_KEY in .env and restart.');
      setPriceSuggestId(null);
      return;
    }
    try {
      const result = await suggestPriceFromSoldListings(item.name, 'used');
      setPriceSuggestResult(result);
    } catch (e: any) {
      console.error('Price suggestion failed', e);
      const msg = e?.message || 'Preisermittlung fehlgeschlagen.';
      setPriceSuggestError(msg.includes('No AI configured') ? 'Kein AI Provider konfiguriert. Bitte .env prüfen.' : msg);
    } finally {
      setPriceSuggestId(null);
    }
  };

  const closePriceSuggestModal = () => {
    setPriceSuggestModalItem(null);
    setPriceSuggestResult(null);
    setPriceSuggestError(null);
  };

  const applyPriceSuggestionAsSellPrice = (item: InventoryItem, price: number) => {
    onUpdate([{ ...item, sellPrice: price }]);
    closePriceSuggestModal();
  };

  const savePriceSuggestionAsNote = (item: InventoryItem, result: SoldPriceSuggestion) => {
    const suggested = result.priceAverage;
    const rangeText = result.priceLow && result.priceHigh ? `€${formatEUR(Number(result.priceLow))}–€${formatEUR(Number(result.priceHigh))}` : '';
    const examplesText = result.soldExamples.length > 0
      ? '\nBeispiele: ' + result.soldExamples.map(e => `${e.title} (€${formatEUR(Number(e.price))})`).join(', ')
      : '';
    const note = `AI-Preistipp (eBay verkaufte Artikel): ~€${formatEUR(suggested)}${rangeText ? ` (${rangeText})` : ''}${examplesText}`;
    onUpdate([{ ...item, comment2: item.comment2 ? `${item.comment2}\n${note}` : note }]);
    closePriceSuggestModal();
  };

  const closeEbayPriceModal = () => {
    setEbayPriceModalItem(null);
    setEbayPriceError(null);
    setEbayPriceMatch(null);
    setEbayPriceLoading(false);
  };

  const handleFetchEbayListingPrice = async (item: InventoryItem) => {
    if (!item.name?.trim()) {
      alert('Enter an item name first.');
      return;
    }
    setEbayPriceModalItem(item);
    setEbayPriceError(null);
    setEbayPriceMatch(null);
    setEbayPriceLoading(true);
    try {
      const match = await fetchEbayListingPriceForItem(item.name, item.ebaySku);
      if (!match) {
        setEbayPriceError(`No matching live eBay listing with a price found for "${item.name}".`);
        return;
      }
      setEbayPriceMatch(match);
    } catch (e: unknown) {
      setEbayPriceError((e as Error)?.message || 'Failed to fetch eBay listing price.');
    } finally {
      setEbayPriceLoading(false);
    }
  };

  const applyEbayListingPrice = (item: InventoryItem, price: number, match: EbayListingPriceMatch) => {
    onUpdate([
      {
        ...item,
        storePrice: price,
        listedOnEbay: true,
        ebayListingId: match.listingId,
        ebaySku: item.ebaySku || match.sku,
      },
    ]);
    setToast(`Storefront price set to €${formatEUR(price)} from eBay`);
    setTimeout(() => setToast((prev) => (prev?.startsWith('Storefront price set') ? null : prev)), 2000);
    closeEbayPriceModal();
  };

  // --- eBay order lookup (Flags column) — searches the locally cached order index (API backfill + CSV import) ---
  const [orderLookupItem, setOrderLookupItem] = useState<InventoryItem | null>(null);
  const [orderLookupMatches, setOrderLookupMatches] = useState<EbayOrderMatch[]>([]);

  const openOrderLookupModal = (item: InventoryItem) => {
    const { orders } = loadEbayOrderIndex();
    const matches = findMatchingOrdersForItem(item, orders);
    setOrderLookupItem(item);
    setOrderLookupMatches(matches);
  };

  const closeOrderLookupModal = () => {
    setOrderLookupItem(null);
    setOrderLookupMatches([]);
  };

  const applyOrderMatchToItem = (item: InventoryItem, match: EbayOrderMatch) => {
    const updated = applyEbayOrderMatchToItem(item, match, businessSettings.taxMode);
    onUpdate([updated]);
    setToast(`Applied order ${match.order.orderId} to ${item.name}`);
    setTimeout(() => setToast((prev) => (prev?.startsWith('Applied order') ? null : prev)), 2200);
    closeOrderLookupModal();
  };

  // Visible Columns (from order, excluding hidden) — memoized so row renders are not invalidated every parent render
  const visibleColumns = useMemo(() => {
    const ALWAYS_HIDDEN = ['parseSpecs', 'salePlatform'];
    return columnOrder.filter((id) => {
      if (hiddenColumnIds.includes(id) || ALWAYS_HIDDEN.includes(id)) return false;
      // In pure ACTIVE mode: hide SOLD DATE (always empty — items haven't been sold yet)
      if (id === 'sellDate' && !splitView && statusFilter === 'ACTIVE') return false;
      // In pure SOLD mode: hide STOCK AGE gauge (irrelevant once item is sold)
      if (id === 'timeGauge' && !splitView && statusFilter === 'SOLD') return false;
      return true;
    });
  }, [columnOrder, hiddenColumnIds, statusFilter, splitView]);

  // Bumped once web fonts finish loading so the canvas measurement below re-runs with the real
  // font metrics instead of whatever fallback font was active during the first paint.
  const [fontsReadyTick, setFontsReadyTick] = useState(0);
  useEffect(() => {
    const fonts = (document as any).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => setFontsReadyTick((t) => t + 1));
    }
  }, []);

  // Narrow-by-default column widths: computed from the actual data so category/status/price
  // columns fit their content, only growing when a value (e.g. a very large price) needs it.
  const autoColumnWidths = useMemo(() => computeAutoColumnWidths(items), [items, fontsReadyTick]);

  const effectiveColumnWidths = useMemo(() => {
    const merged: Record<string, number> = { ...columnWidths };
    for (const colId of AUTO_SIZE_COLUMN_IDS) {
      if (autoColumnWidths[colId] != null) {
        merged[colId] = autoColumnWidths[colId]!;
      }
    }
    return merged;
  }, [columnWidths, autoColumnWidths]);
  const effectiveColumnWidthsRef = useRef(effectiveColumnWidths);
  useEffect(() => {
    effectiveColumnWidthsRef.current = effectiveColumnWidths;
  }, [effectiveColumnWidths]);

  // Calculate Date Range based on filter
  const dateRange = useMemo(() => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    
    let start = new Date(0); // Epoch
    let end = new Date(now);

    switch (timeFilter) {
      case 'THIS_WEEK':
        const day = now.getDay() || 7; 
        if (day !== 1) now.setHours(-24 * (day - 1));
        start = new Date(now);
        start.setHours(0,0,0,0);
        break;
      case 'LAST_WEEK':
        start = new Date(now);
        start.setDate(now.getDate() - 7 - (now.getDay() || 7) + 1);
        start.setHours(0,0,0,0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23,59,59,999);
        break;
      case 'THIS_MONTH':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'LAST_MONTH':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'LAST_30':
        start = new Date(now);
        start.setDate(now.getDate() - 30);
        break;
      case 'LAST_90':
        start = new Date(now);
        start.setDate(now.getDate() - 90);
        break;
      case 'THIS_YEAR':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case 'LAST_YEAR':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31);
        end.setHours(23, 59, 59, 999);
        break;
      default:
        break;
    }
    return { start, end };
  }, [timeFilter]);

  const isQuickCategoryPinActive = useCallback(
    (pin: QuickCategoryPin) => {
      if (categoryFilter !== pin.category) return false;
      if (!pin.subCategory) return !subCategoryFilter;
      return subCategoryFilter === pin.subCategory;
    },
    [categoryFilter, subCategoryFilter]
  );

  const activeQuickPin = useMemo(
    () => quickCategoryPins.find((pin) => isQuickCategoryPinActive(pin)) ?? null,
    [quickCategoryPins, isQuickCategoryPinActive]
  );

  // Base-filtered items (no spec filters) — used to build available spec options in the Filters panel / quick pins
  const baseFilteredForSpecs = useMemo(() => {
    if (!showSpecFiltersPanel && !hasActiveSpecFilters && !activeQuickPin) return [];
    const searchLower = searchTerm.toLowerCase();
    return items.filter(item => {
      let matchesStatus = false;
      if (statusFilter === 'ACTIVE') matchesStatus = item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED || item.status === ItemStatus.IN_COMPOSITION;
      else if (statusFilter === 'SOLD') matchesStatus = isRealizedDisposal(item);
      else if (statusFilter === 'DRAFTS') matchesStatus = item.isDraft === true;
      else matchesStatus = true;
      if (!matchesStatus) return false;

      // Optional visibility toggle for orphan "In Composition" items (container children always nest)
      if (!showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;
      if (shouldHideContainerChildInList(item, items)) return false;
      if (categoryFilter !== 'ALL' || subCategoryFilter) {
        const matchParentAndSub = categoryFilter !== 'ALL' && item.category === categoryFilter && (!subCategoryFilter || item.subCategory === subCategoryFilter);
        const matchSubAsTopLevel = subCategoryFilter && item.category === subCategoryFilter;
        if (!matchParentAndSub && !matchSubAsTopLevel) return false;
      }
      const matchesSearch = item.name.toLowerCase().includes(searchLower) || item.category.toLowerCase().includes(searchLower) || item.vendor?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
      if (timeFilter !== 'ALL') {
        const isSalesItem = isRealizedDisposal(item);
        const dateStr = isSalesItem ? item.sellDate : item.buyDate;
        if (!dateStr) return false;
        const itemDate = new Date(dateStr);
        if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
      }
      if (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS') {
        if (salePlatformFilter !== 'ALL') {
          if (salePlatformFilter === MISSING_PLATFORM_FILTER) {
            if (!isMissingExplicitSalePlatform(item)) return false;
          } else if (!itemMatchesSalePlatformFilter(item, salePlatformFilter as Platform)) return false;
        }
        if (salePaymentFilter !== 'ALL' && item.paymentType !== salePaymentFilter) return false;
      }
      return true;
    });
  }, [items, searchTerm, statusFilter, categoryFilter, subCategoryFilter, timeFilter, dateRange, salePlatformFilter, salePaymentFilter, showInComposition, showSpecFiltersPanel, hasActiveSpecFilters, activeQuickPin]);

  // Available spec keys and unique values (from base-filtered items) for the Filters panel / quick pins
  const specOptions = useMemo(() => {
    if (!showSpecFiltersPanel && !hasActiveSpecFilters && !activeQuickPin) return [];
    const keyToValues = new Map<string, Set<string | number>>();
    const keyToNumeric = new Map<string, boolean>();
    baseFilteredForSpecs.forEach(item => {
      if (!item.specs) return;
      Object.entries(item.specs).forEach(([key, val]) => {
        if (val === undefined || val === null || val === '') return;
        if (!keyToValues.has(key)) keyToValues.set(key, new Set());
        keyToValues.get(key)!.add(val);
        const isNum = typeof val === 'number' || (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val)));
        keyToNumeric.set(key, (keyToNumeric.get(key) ?? true) && isNum);
      });
    });
    const keys = Array.from(keyToValues.keys()).sort();
    const result: { key: string; values: (string | number)[]; isNumeric: boolean; min?: number; max?: number }[] = [];
    keys.forEach(key => {
      const values = Array.from(keyToValues.get(key)!);
      const isNumeric = keyToNumeric.get(key) ?? false;
      let min: number | undefined, max: number | undefined;
      if (isNumeric) {
        const nums = values.map(v => typeof v === 'number' ? v : Number(v)).filter(n => !Number.isNaN(n));
        if (nums.length) {
          min = Math.min(...nums);
          max = Math.max(...nums);
        }
      }
      result.push({ key, values: values.sort((a, b) => String(a).localeCompare(String(b))), isNumeric, min, max });
    });
    return result;
  }, [baseFilteredForSpecs, showSpecFiltersPanel, hasActiveSpecFilters, activeQuickPin]);

  const quickPinSpecOptions = useMemo(() => {
    if (!activeQuickPin) return [];
    const fallbackKeys =
      categoryFields[`${activeQuickPin.category}:${activeQuickPin.subCategory || ''}`] ||
      categoryFields[activeQuickPin.category] ||
      [];
    return pickEssentialSpecOptions(
      specOptions,
      activeQuickPin.category,
      activeQuickPin.subCategory,
      fallbackKeys
    );
  }, [activeQuickPin, specOptions, categoryFields]);

  // Convenience: socket filter options (e.g. for processors / motherboards)
  const socketSpec = useMemo(() => {
    const lowerMatch = (k: string) => {
      const lk = k.toLowerCase();
      return lk === 'socket' || lk === 'sockel' || lk.includes('socket');
    };
    return specOptions.find((o) => lowerMatch(o.key));
  }, [specOptions]);

  // Filtering & Sorting
  const listFilterParams = useMemo(
    (): Omit<InventoryListFilterParams, 'statusFilter'> => ({
      items,
      searchTerm,
      categoryFilter,
      subCategoryFilter,
      sortConfig,
      timeFilter,
      dateRange,
      salePlatformFilter,
      salePaymentFilter,
      amountFilter,
      specFilters,
      specRangeFilters,
      showInComposition,
      timeGaugeSortKeyMap,
    }),
    [
      items,
      searchTerm,
      categoryFilter,
      subCategoryFilter,
      sortConfig,
      timeFilter,
      dateRange,
      salePlatformFilter,
      salePaymentFilter,
      amountFilter,
      specFilters,
      specRangeFilters,
      showInComposition,
      timeGaugeSortKeyMap,
    ]
  );

  const sortedItems = useMemo(
    () => filterAndSortInventoryItems({ ...listFilterParams, statusFilter }),
    [listFilterParams, statusFilter]
  );

  const sortedActiveItems = useMemo(
    () => (splitView ? filterAndSortInventoryItems({ ...listFilterParams, statusFilter: 'ACTIVE' }) : []),
    [listFilterParams, splitView]
  );

  const sortedSoldItems = useMemo(
    () => (splitView ? filterAndSortInventoryItems({ ...listFilterParams, statusFilter: 'SOLD' }) : []),
    [listFilterParams, splitView]
  );

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const activeTableRef = useRef<HTMLDivElement>(null);
  const soldTableRef = useRef<HTMLDivElement>(null);
  const rowHeightEstimate = listDensity === 'compact' ? 64 : 78;

  useEffect(() => {
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    if (activeTableRef.current) activeTableRef.current.scrollTop = 0;
    if (soldTableRef.current) soldTableRef.current.scrollTop = 0;
  }, [searchTerm, timeFilter, sortConfig, statusFilter, categoryFilter, subCategoryFilter, salePlatformFilter, salePaymentFilter, amountFilter, specFilters, specRangeFilters, splitView]);

  const getRowActivityKey = useCallback(
    (item: InventoryItem) =>
      // Include editValue (not just which field is being edited) while this row is the one being
      // edited — otherwise the key stays identical across every keystroke, the row's React.memo
      // sees "no change," and the input silently stops updating after the very first keystroke.
      `${editingCell?.itemId === item.id ? `${editingCell.field}:${editValue}` : ''}|${listingGenId === item.id}|${parsingSingleId === item.id}|${priceSuggestId === item.id}|${(item.isPC || item.isBundle) && expandedBundles.has(item.id) ? 'exp' : 'col'}`,
    [editingCell, editValue, listingGenId, parsingSingleId, priceSuggestId, expandedBundles]
  );

  const showFinancials = splitView || (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS');

  const missingPlatformSoldCount = useMemo(() => {
    const list = splitView ? sortedSoldItems : sortedItems;
    return list.filter((i) => isMissingExplicitSalePlatform(i)).length;
  }, [splitView, sortedSoldItems, sortedItems]);

  const compatibleCountByItemId = useMemo(() => {
    if (!splitView && statusFilter !== 'ACTIVE') return EMPTY_COMPAT_COUNT_MAP;
    const source = splitView ? sortedActiveItems : sortedItems;
    const map = new Map<string, number>();
    const partTypes = new Set(['Processors', 'Motherboards', 'RAM']);
    for (const item of source.slice(0, 120)) {
      if (!partTypes.has(item.subCategory || '') && !partTypes.has(item.category || '')) continue;
      const groups = getCompatibleItemsForItem(item, items);
      const total = groups.reduce((sum, g) => sum + g.items.length, 0);
      if (total > 0) map.set(item.id, total);
    }
    return map;
  }, [sortedItems, sortedActiveItems, items, statusFilter, splitView]);

  // Active filter count (for badge) — category/subcategory + spec keys
  const activeSpecFilterCount = useMemo(() => {
    let n = 0;
    if (categoryFilter !== 'ALL' || subCategoryFilter) n += 1;
    Object.entries(specFilters).forEach(([, arr]) => { if (arr?.length) n++; });
    Object.entries(specRangeFilters).forEach(([, r]) => { if (r && (r.min !== undefined || r.max !== undefined)) n++; });
    return n;
  }, [specFilters, specRangeFilters, categoryFilter, subCategoryFilter]);


  const financialStats = useMemo(() => {
    if (!showFinancials) return null;
    
    let totalGross = 0;
    let totalTax = 0;
    let totalNetRevenue = 0;
    let totalProfit = 0;
    let cashMargin = 0;

    const soldItems = (splitView ? sortedSoldItems : sortedItems).filter((i) => isRealizedDisposal(i));
    const soldAtomicItems = soldItems.filter(i => !i.isPC && !i.isBundle);
    
    soldAtomicItems.forEach(item => {
        const sell = item.sellPrice || 0;
        if (sell === 0) return;
        
        let tax = 0;
        let netSell = sell;

        if (businessSettings.taxMode === 'RegularVAT') {
            netSell = sell / 1.19;
            tax = sell - netSell;
        } else if (businessSettings.taxMode === 'DifferentialVAT') {
            const buy = item.buyPrice || 0;
            const margin = sell - buy;
            if (margin > 0) {
                const netMargin = margin / 1.19;
                tax = margin - netMargin;
            }
            netSell = sell - tax;
        }
        
        totalGross += sell;
        totalTax += tax;
        totalNetRevenue += netSell;
        cashMargin += computeItemProfitBeforeOverhead(item, 'SmallBusiness');
    });

    soldAtomicItems.forEach(item => {
        totalProfit += computeItemProfitBeforeOverhead(item, businessSettings.taxMode);
    });

    return { totalGross, totalTax, totalNetRevenue, totalProfit, cashMargin };
  }, [sortedItems, sortedSoldItems, splitView, businessSettings.taxMode, showFinancials]);

  const profitForDisplay = useCallback(
    (item: InventoryItem): number | null => {
      if (item.isPC || item.isBundle) return null;
      if (!showFinancials || item.sellPrice == null) return item.profit ?? null;
      return computeItemProfitBeforeOverhead(item, businessSettings.taxMode);
    },
    [showFinancials, businessSettings.taxMode]
  );

  // -- HANDLERS --

  const handleHeaderSort = (columnId: ColumnId) => {
    if (columnId === 'actions' || columnId === 'select' || columnId === 'parseSpecs') return;
    
    setSortConfig(prev => {
      // If clicking same column, toggle direction
      if (prev.key === columnId || (columnId === 'item' && prev.key === 'name')) {
        return { key: prev.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      // New column -> Default ASC
      return { key: columnId === 'item' ? 'name' : columnId, direction: 'asc' };
    });
  };

  const handleColumnResizeStart = useCallback((e: React.MouseEvent, colId: ColumnId) => {
    if (colId !== 'item') return;
    e.preventDefault();
    e.stopPropagation();
    setManualWidthColumns((prev) => (prev.has(colId) ? prev : new Set(prev).add(colId)));
    const startW = effectiveColumnWidthsRef.current[colId] ?? columnWidthsRef.current[colId] ?? DEFAULT_WIDTHS[colId];
    columnResizeRef.current = { colId, startX: e.clientX, startW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const r = columnResizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const next = clampInventoryColumnWidth(r.colId, r.startW + dx);
      setColumnWidths((prev) => (prev[r.colId] === next ? prev : { ...prev, [r.colId]: next }));
    };

    const onUp = () => {
      columnResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const startEditing = (item: InventoryItem, field: ColumnId, value: string | number) => {
    setEditingCell({ itemId: item.id, field });
    setEditValue(value || '');
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const { itemId, field } = editingCell;
    const targetField = field === 'item' ? 'name' : field;
    const item = items.find(i => i.id === itemId);
    if (!item) {
        setEditingCell(null);
        return;
    }

    let newValue: any = editValue;

    if (targetField === 'buyPrice' || targetField === 'sellPrice' || targetField === 'storePrice') {
       // Clearing the field should actually clear it (undefined), not silently reset to 0 — buyPrice
       // still defaults to 0 (it's required), but sellPrice/storePrice are optional and should be
       // erasable, otherwise "empty" ends up as a fake €0 value polluting profit/dashboard math.
       if (String(editValue).trim() === '' && targetField !== 'buyPrice') {
         newValue = undefined;
       } else {
         newValue = parseLocaleMoney(editValue, 0);
       }
    }

    const updates: Partial<InventoryItem> = { [targetField]: newValue };

    if ((targetField === 'buyPrice' || targetField === 'sellPrice') && isRealizedDisposal(item)) {
        const b = targetField === 'buyPrice' ? newValue : item.buyPrice;
        const s = targetField === 'sellPrice' ? newValue : (item.sellPrice || 0);
        const fee = item.feeAmount || 0;
        updates.profit = s - b - fee;
    }

    // Logic to release from composition if status is changed manually
    if (targetField === 'status') {
        if (item.status === ItemStatus.IN_COMPOSITION && newValue !== ItemStatus.IN_COMPOSITION) {
            updates.parentContainerId = undefined; // Detach from parent
        }
    }

    onUpdate([{ ...item, ...updates }]);
    setEditingCell(null);
  };

  const handleSelectAll = useCallback(() => {
    startTransition(() => {
      setSelectedIds((prev) => {
        if (prev.length === sortedItems.length && sortedItems.length > 0) return [];
        return sortedItems.map((i) => i.id);
      });
    });
  }, [sortedItems]);

  const handleSelectAllFor = useCallback((list: InventoryItem[]) => {
    startTransition(() => {
      setSelectedIds((prev) => {
        const listIds = list.map((i) => i.id);
        const allInPaneSelected = listIds.length > 0 && listIds.every((id) => prev.includes(id));
        if (allInPaneSelected) {
          return prev.filter((id) => !listIds.includes(id));
        }
        return [...new Set([...prev, ...listIds])];
      });
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    startTransition(() => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return [...next];
      });
    });
  }, []);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const deferredSelectedIds = useDeferredValue(selectedIds);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const containersById = useMemo(() => buildContainersById(items), [items]);
  const containerByChildId = useMemo(() => buildContainerByChildId(items), [items]);

  const handleDuplicate = (item: InventoryItem) => {
    const copy: InventoryItem = {
      ...item,
      id: `copy-${Date.now()}`,
      name: `${item.name} (Copy)`,
      status: ItemStatus.IN_STOCK,
      sellPrice: undefined,
      sellDate: undefined,
      profit: undefined,
      feeAmount: undefined,
      paymentType: undefined,
      platformSold: undefined,
      customer: undefined,
      invoiceNumber: undefined,
      ebayUsername: undefined,
      ebayOrderId: undefined,
      tradedForIds: undefined,
      tradedFromId: undefined,
      cashOnTop: undefined,
      parentContainerId: undefined,
      containerSoldDate: undefined,
      ebaySku: undefined,
      ebayOfferId: undefined
    };
    onUpdate([copy]);
  };

  // Delayed row click handler so double-click can enter inline rename
  const handleRowClick = (item: InventoryItem, isEditingName: boolean) => {
    if (isEditingName) return;
    // If there's already a pending click, do nothing (double-click handler will take over)
    if (rowClickTimeoutRef.current != null) return;
    rowClickTimeoutRef.current = window.setTimeout(() => {
      rowClickTimeoutRef.current = null;
      handleEditClick(item);
    }, 220);
  };

  const handleConfirmDismantle = () => {
    if (!bundleToDismantle) return;
    const bundle = bundleToDismantle;

    const components = items.filter(i => 
       (bundle.componentIds && bundle.componentIds.includes(i.id)) || 
       i.parentContainerId === bundle.id
    );
    
    if (components.length === 0) {
       onDelete(bundle.id);
    } else {
       const restoreAsSold =
         isRealizedDisposal(bundle) || bundle.subCategory === 'Retro Bundle';

       const updates = components.map(c => {
          if (restoreAsSold) {
             return {
                ...c,
                status: ItemStatus.SOLD,
                parentContainerId: undefined
             };
          } else {
             return {
                ...c,
                status: ItemStatus.IN_STOCK,
                parentContainerId: undefined,
                sellPrice: undefined,
                sellDate: undefined,
                profit: undefined,
                paymentType: undefined,
                platformSold: undefined
             };
          }
       });
       onUpdate(updates, [bundle.id]); 
    }
    setBundleToDismantle(null);
  };

  const handleEditClick = (item: InventoryItem) => {
    addRecentItemId(item.id);
    if (item.isPC || item.isBundle) {
      navigate(`/panel/builder?editId=${item.id}`); 
    } else {
      setItemToEdit(item); 
    }
  };

  const openParentContainer = useCallback(
    (parent: InventoryItem) => {
      addRecentItemId(parent.id);
      if (parent.isPC || parent.isBundle) {
        navigate(`/panel/builder?editId=${parent.id}`);
      } else {
        setItemToEdit(parent);
      }
    },
    [navigate]
  );

  const focusContainerInList = useCallback(
    (parent: InventoryItem) => {
      setSearchTerm('');
      setSpecFilters({});
      setSpecRangeFilters({});
      setTimeFilter('ALL');
      setCategoryFilter('ALL');
      setSubCategoryFilter('');
      setShowInComposition(false);
      if (isRealizedDisposal(parent)) {
        setStatusFilter('SOLD');
      } else if (parent.isDraft) {
        setStatusFilter('DRAFTS');
      } else {
        setStatusFilter('ACTIVE');
      }
      setExpandedBundles((prev) => {
        const next = new Set(prev);
        next.add(parent.id);
        return next;
      });
      setScrollTargetItemId(parent.id);
    },
    []
  );

  const focusTradeLinkedItem = useCallback((target: InventoryItem) => {
    setSearchTerm('');
    setSpecFilters({});
    setSpecRangeFilters({});
    setTimeFilter('ALL');
    setCategoryFilter('ALL');
    setSubCategoryFilter('');
    setShowInComposition(false);
    if (isRealizedDisposal(target)) {
      setStatusFilter('SOLD');
    } else if (target.isDraft) {
      setStatusFilter('DRAFTS');
    } else {
      setStatusFilter('ACTIVE');
    }
    setScrollTargetItemId(target.id);
  }, []);

  const openTradeLinkedItem = useCallback((target: InventoryItem) => {
    setItemToEdit(target);
  }, []);

  const handleParseSingleItem = useCallback(async (item: InventoryItem) => {
    setParsingSingleId(item.id);
    try {
      const categoryContext = `${item.category || 'Unknown'}${item.subCategory ? ' / ' + item.subCategory : ''}`;
      const knownKeys = resolveEssentialSpecKeys(item.category || '', item.subCategory, categoryFields);
      const result = await generateItemSpecs(item.name, categoryContext, knownKeys);
      const newSpecs = mergeAiSpecsIntoEssential(item.specs, result.specs, item.category || '', item.subCategory, categoryFields);
      const updates: Partial<InventoryItem> = {
        specs: newSpecs,
        specsAiSuggested: Object.keys(newSpecs).length ? { ...newSpecs } : undefined,
      };
      if (result.standardizedName) updates.name = result.standardizedName;
      if (result.vendor) updates.vendor = result.vendor;
      const merged = { ...item, ...updates };
      onUpdate(items.map((i) => (i.id === item.id ? merged : i)));
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Parse failed';
      alert(msg.includes('API key') ? `${msg}\n\nAdd the key in .env and restart.` : msg);
    } finally {
      setParsingSingleId(null);
    }
  }, [items, categoryFields, onUpdate]);

  const handleBuildFromSelection = (e?: React.MouseEvent) => {
    if (e) {
       e.preventDefault();
       e.stopPropagation();
    }
    
    const selectedItemsList = items.filter(i => selectedIds.includes(i.id));
    const isSalesMode = selectedItemsList.some((i) => isRealizedDisposal(i));

    if (isSalesMode) {
       if (selectedItemsList.length < 2) {
          alert("Select at least 2 items to bundle.");
          return;
       }
       setShowRetroBundle(true);
       return;
    }
    
    const validItems = selectedItemsList.filter(i => 
      !i.isDefective &&
      (i.status === ItemStatus.IN_STOCK || 
      isRealizedDisposal(i))
    );
    
    if (validItems.length === 0) {
      alert("No valid items selected for composition (defective items are excluded).");
      return;
    }
    
    navigate('/panel/builder', { state: { initialParts: validItems } });
  };

  const handleCreateLotBundleFromSelection = () => {
    const selectedItemsList = items.filter((i) => selectedIds.includes(i.id));
    if (selectedItemsList.length < 2) {
      alert('Select at least 2 items to create a lot bundle.');
      return;
    }

    const blocked = selectedItemsList.filter((i) => i.parentContainerId || i.isBundle || i.isPC);
    if (blocked.length > 0) {
      alert('Some selected items are already inside another bundle/PC or are containers. Please select standalone items only.');
      return;
    }

    const invalidStatus = selectedItemsList.filter(
      (i) => i.status !== ItemStatus.IN_STOCK && i.status !== ItemStatus.ORDERED
    );
    if (invalidStatus.length > 0) {
      alert('Lot bundle can only be created from In Stock / Ordered items.');
      return;
    }

    const suggested = `Lot Bundle (${selectedItemsList.length} items)`;
    const bundleName = (window.prompt('Lot bundle name:', suggested) || '').trim() || suggested;
    const ts = Date.now();
    const bundleId = `bundle-lot-${ts}`;
    const totalBuy = selectedItemsList.reduce((sum, i) => sum + Number(i.buyPrice || 0), 0);

    const bundle: InventoryItem = {
      id: bundleId,
      name: bundleName,
      category: 'Bundle',
      subCategory: 'Lot Bundle',
      status: ItemStatus.IN_STOCK,
      buyPrice: Math.round(totalBuy * 100) / 100,
      buyDate: new Date().toISOString().slice(0, 10),
      isBundle: true,
      componentIds: selectedItemsList.map((i) => i.id),
      comment1: `Generic lot bundle (${selectedItemsList.length} items).`,
      comment2: selectedItemsList.map((i) => `- ${i.name}`).join('\n').slice(0, 2000),
      imageUrl: selectedItemsList.find((i) => i.imageUrl)?.imageUrl,
      imageUrls: selectedItemsList.find((i) => i.imageUrls?.length)?.imageUrls,
    };

    const updates: InventoryItem[] = selectedItemsList.map((i) => ({
      ...i,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: bundleId,
    }));

    onUpdate([bundle, ...updates]);
    setSelectedIds([]);
  };

  const handleCreateRetroBundle = (bundle: InventoryItem, updatedComponents: InventoryItem[]) => {
     onUpdate([bundle, ...updatedComponents]);
     setShowRetroBundle(false);
     setSelectedIds([]);
  };

  const handleBulkEditSales = (platform: Platform, payment: PaymentType) => {
     const updates = items.filter(i => selectedIds.includes(i.id)).map(i => ({
        ...i,
        platformSold: platform,
        paymentType: payment
     }));
     onUpdate(updates);
     setShowBulkSalesEdit(false);
     setSelectedIds([]);
  };

  const handleQuickPlatformChange = (item: InventoryItem, platform: Platform | '') => {
    const next: InventoryItem = { ...item, platformSold: platform || undefined };
    if (platform === 'In Person' && !next.paymentType) {
      next.paymentType = 'Cash';
    }
    if (platform === 'kleinanzeigen.de' && !next.paymentType) {
      next.paymentType = 'Kleinanzeigen (Cash)';
    }
    startTransition(() => {
      onUpdate([next], undefined, {
        skipUndo: true,
        skipActionLog: true,
        skipContainerSync: true,
      });
      if (platform) {
        setToast(`Sold on ${formatSalePlatformLabel(platform)}`);
      }
    });
  };

  const handleBulkCategorySave = (category: string, subCategory: string) => {
     const updates = items.filter(i => selectedIds.includes(i.id)).map(i => ({
        ...i,
        category,
        subCategory
     }));
     onUpdate(updates);
     setShowBulkCategoryEdit(false);
     setSelectedIds([]);
  };

  const handleBulkStoreVisible = (visible: boolean) => {
     const updates = items
       .filter((i) => selectedIds.includes(i.id) && i.status === ItemStatus.IN_STOCK && !i.parentContainerId)
       .map((i) => ({ ...i, storeVisible: visible }));
     onUpdate(updates);
     setShowBulkStoreVisible(false);
     setSelectedIds([]);
     void onPublishStoreCatalog?.();
  };

  const handleBulkSalePct = (pct: number) => {
     const updates = items.filter(i => selectedIds.includes(i.id)).map(i => {
        const sell = Number(i.sellPrice) ?? 0;
        const salePrice = sell > 0 ? Math.round(sell * (1 - pct / 100) * 100) / 100 : undefined;
        return { ...i, storeOnSale: true, storeSalePrice: salePrice };
     });
     onUpdate(updates);
     setShowBulkSalePct(false);
     setSelectedIds([]);
  };

  const handleBulkTag = (tag: string) => {
     const updates = items.filter(i => selectedIds.includes(i.id)).map(i => ({ ...i, comment1: tag.trim() || i.comment1 }));
     onUpdate(updates);
     setShowBulkTag(false);
     setSelectedIds([]);
  };

  const handleBulkGenerateDescriptions = async () => {
     const selected = items.filter(i => selectedIds.includes(i.id));
     if (selected.length === 0) return;
     setBulkGenerateDescriptions(true);
     setBulkGenerateProgress(`0 / ${selected.length}`);
     const updates: InventoryItem[] = [];
     for (let i = 0; i < selected.length; i++) {
        setBulkGenerateProgress(`${i + 1} / ${selected.length}`);
        try {
           const text = await generateStoreDescription(selected[i].name, selected[i].storeDescription || undefined, { hasOVP: selected[i].hasOVP, hasIOShield: selected[i].hasIOShield });
           updates.push({ ...selected[i], storeDescription: text });
        } catch (err) {
           console.warn('AI description failed for', selected[i].name, err);
        }
     }
     if (updates.length > 0) onUpdate(updates);
     setBulkGenerateProgress(null);
     setBulkGenerateDescriptions(false);
     setSelectedIds([]);
  };

  const renderCell = (item: InventoryItem, id: ColumnId, isSelected: boolean) => {
    const width = effectiveColumnWidths[id] || columnWidths[id] || DEFAULT_WIDTHS[id];
    const style = { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };
    const dense = listDensity === 'compact';
    const iconBtn = dense ? 'h-6 w-6' : 'h-7 w-7';
    const thumbPx = dense ? 32 : 36;

    switch (id) {
      case 'select':
        return (
          <td key={id} className="text-center" style={style}>
             <div onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }} className={`w-5 h-5 mx-auto border-2 rounded-md flex items-center justify-center cursor-pointer transition-all touch-manipulation ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 hover:border-blue-400'}`}>
                {isSelected && <Check size={11}/>}
             </div>
          </td>
        );
      case 'presence':
        return (
          <td key={id} className="inv-col-icons border-r border-slate-100/90 align-middle" style={style} onClick={(e) => e.stopPropagation()}>
            <div
              className={`grid grid-cols-5 ${dense ? 'gap-0.5' : 'gap-1'} items-center justify-items-start shrink-0`}
              style={{ width: PRESENCE_ICON_COUNT * PRESENCE_ICON_SIZE_PX + (PRESENCE_ICON_COUNT - 1) * PRESENCE_ICON_GAP_PX }}
            >
              {/* Physical presence: present → lost → defective → unknown */}
              {(() => {
                const cycleState = getItemPresenceCycleState(item);
                return (
              <button
                type="button"
                onClick={() => togglePresence(item)}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  cycleState === 'present'
                    ? 'border-emerald-300 bg-emerald-50'
                  : cycleState === 'lost'
                    ? 'border-red-300 bg-red-50'
                  : cycleState === 'defective'
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
                title={
                  cycleState === 'present'
                    ? 'Present (click → lost)'
                    : cycleState === 'lost'
                    ? 'Lost (click → defective)'
                    : cycleState === 'defective'
                    ? 'Defective (click → clear)'
                    : 'Not checked (click → present)'
                }
              >
                {cycleState === 'defective' ? (
                  <AlertCircle size={13} className="text-amber-600" />
                ) : (
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    cycleState === 'present'
                      ? 'bg-emerald-500'
                      : cycleState === 'lost'
                      ? 'bg-red-500'
                      : 'bg-slate-300'
                  }`}
                />
                )}
              </button>
                );
              })()}

              {/* Add photos (replaces former defective quick button slot) */}
              <button
                type="button"
                onClick={() => openAddPhotosModal([item.id])}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  getItemUserPhotoCount(item) > 0
                    ? 'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50'
                }`}
                title="Add photos (upload, URL, or Imgur album)"
              >
                <Camera size={13} strokeWidth={2.25} />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCardGenItem(item);
                }}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors border-indigo-200 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100`}
                title="Generate premium product card (eBay / Kleinanzeigen)"
              >
                <Sparkles size={13} strokeWidth={2.25} />
              </button>

              {/* Live eBay listing price (seller store / account) */}
              {(() => {
                const ebayPriceSynced = hasEbayStorefrontPriceSynced(item);
                const ebayPriceLoadingThis = ebayPriceLoading && ebayPriceModalItem?.id === item.id;
                return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleFetchEbayListingPrice(item);
                }}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  ebayPriceLoadingThis
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : ebayPriceSynced
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50/50'
                }`}
                title={
                  ebayPriceSynced
                    ? `eBay storefront price synced${item.storePrice != null ? ` (€${formatEUR(item.storePrice)})` : ''}${item.ebayListingId ? ` · listing ${item.ebayListingId}` : ''} — click to refresh`
                    : 'Fetch live storefront price from your eBay listing (rounded to .99)'
                }
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    ebayPriceLoadingThis
                      ? 'bg-amber-500 text-white'
                      : ebayPriceSynced
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  €
                </span>
              </button>
                );
              })()}

              <button
                type="button"
                onClick={() => toggleStoreVisible(item)}
                disabled={Boolean(getStorefrontHiddenReason(item) && item.storeVisible !== false)}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border text-violet-700 ${
                  isPublishedOnStorefront(item) ? 'border-violet-200 bg-violet-50' : 'border-violet-200 bg-white opacity-80'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                title={
                  isPublishedOnStorefront(item)
                    ? 'Live on storefront (click to hide)'
                    : getStorefrontHiddenReason(item) || 'Hidden from storefront (click to show)'
                }
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    isPublishedOnStorefront(item) ? 'bg-violet-600 text-white' : 'bg-slate-200 text-violet-700'
                  }`}
                >
                  S
                </span>
              </button>

              {/* eBay order lookup: search cached order history (API backfill + CSV import) for this item */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openOrderLookupModal(item);
                }}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  item.ebayOrderId
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/50'
                }`}
                title={
                  item.ebayOrderId
                    ? `eBay order linked: ${item.ebayOrderId} — click to search cached orders again`
                    : 'Search cached eBay orders (since Feb 2025) for this item'
                }
              >
                <Receipt size={13} strokeWidth={2.25} />
              </button>
            </div>
          </td>
        );
      case 'item':
        const isContainerRow = isInventoryContainer(item);
        const childItems = isContainerRow ? getChildren(item, items) : [];
        const isEditingName = editingCell?.itemId === item.id && editingCell?.field === 'item';
        const searchQuery = searchTerm.trim();
        const searchActiveForNest = searchQuery.length >= 2;
        const isGroupedContainerRow = isContainerRow && childItems.length > 0;
        const isBundleBodyExpanded = isGroupedContainerRow && expandedBundles.has(item.id);
        const isSoldContainerRow = isGroupedContainerRow && isRealizedDisposal(item);
        const formatChildListDate = (child: InventoryItem) => {
          const raw = isSoldContainerRow
            ? child.sellDate || child.containerSoldDate || child.buyDate
            : child.buyDate || child.sellDate;
          return raw ? new Date(raw).toLocaleDateString() : '—';
        };
        const parentContainer = resolveParentContainer(item, containersById, containerByChildId);
        const parentKind = getContainerKind(parentContainer);
        const showMembershipBadge = Boolean(parentKind && parentContainer && !item.isPC && !item.isBundle);
        const tradeReceived = resolveTradeReceivedItems(item, itemsById);
        const tradeSource = resolveTradeSourceItem(item, itemsById);
        const userPhotoCount = getItemUserPhotoCount(item);
        const hasUserPhotos = userPhotoCount > 0;
        return (
          <td key={id} style={style} onClick={() => handleRowClick(item, isEditingName)}>
             <div className="flex items-start gap-1.5 cursor-pointer group/cell w-full py-0.5">
                <div
                  className={`relative shrink-0 rounded-md cursor-pointer hover:opacity-90 transition-opacity ${
                    hasUserPhotos
                      ? 'ring-2 ring-emerald-500/45'
                      : 'ring-1 ring-dashed ring-amber-400/80 bg-amber-50/40'
                  }`}
                  title={
                    hasUserPhotos
                      ? `${userPhotoCount} photo${userPhotoCount === 1 ? '' : 's'} — click to add more`
                      : 'Click to add photos'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    openAddPhotosModal([item.id]);
                  }}
                >
                  <ItemThumbnail item={item} className={`${dense ? 'w-8 h-8' : 'w-9 h-9'} rounded-md object-cover border border-slate-100 shrink-0`} size={thumbPx} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center shadow-sm ${
                      hasUserPhotos
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-100 text-amber-700 border border-amber-300'
                    }`}
                    aria-hidden
                  >
                    {hasUserPhotos ? (
                      userPhotoCount > 1 ? (
                        <span className="text-[8px] font-black leading-none">{userPhotoCount}</span>
                      ) : (
                        <Camera size={8} strokeWidth={2.5} />
                      )
                    ) : (
                      <ImageOff size={8} strokeWidth={2.5} />
                    )}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                   <div className="flex items-center gap-2 w-full min-w-0">
                      {isGroupedContainerRow && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBundleExpanded(item.id);
                          }}
                          className={`shrink-0 p-0.5 rounded-md transition-colors ${
                            item.isPC
                              ? 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100/80'
                              : 'text-violet-600 hover:text-violet-800 hover:bg-violet-100/80'
                          }`}
                          title={isBundleBodyExpanded ? 'Collapse contents' : 'Expand contents'}
                          aria-expanded={isBundleBodyExpanded}
                        >
                          {isBundleBodyExpanded ? (
                            <ChevronDown size={15} strokeWidth={2.75} />
                          ) : (
                            <ChevronRight size={15} strokeWidth={2.75} />
                          )}
                        </button>
                      )}
                      {isEditingName ? (
                        <input
                          autoFocus
                          className="flex-1 min-w-0 px-2 py-1 bg-white border-2 border-blue-500 rounded-lg text-sm font-black text-slate-900 outline-none shadow-lg"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p
                      className={`${dense ? 'text-xs' : 'text-sm'} font-black truncate group-hover/cell:text-blue-600 transition-colors flex-1 min-w-0 ${
                        item.isPC ? 'text-indigo-950' : isInventoryContainer(item) ? 'text-violet-950' : 'text-slate-900'
                      }`}
                          title="Double click to rename"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (rowClickTimeoutRef.current != null) {
                              window.clearTimeout(rowClickTimeoutRef.current);
                              rowClickTimeoutRef.current = null;
                            }
                            startEditing(item, 'item', item.name);
                          }}
                        >
                          {item.name}
                        </p>
                      )}
                   </div>
                   <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {hasUserPhotos ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80"
                          title={`${userPhotoCount} photo${userPhotoCount === 1 ? '' : 's'}`}
                        >
                          <Camera size={9} className="shrink-0" />
                          {userPhotoCount > 1 ? `${userPhotoCount} photos` : 'Photo'}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/80"
                          title="No item photos yet"
                        >
                          <ImageOff size={9} className="shrink-0" />
                          No photo
                        </span>
                      )}
                      {item.specs && Object.keys(item.specs).length > 0 && (
                         <span className="inline-flex items-center gap-1 text-emerald-600" title="Tech specs filled — open to edit or re-parse">
                            <ListChecks size={12} className="shrink-0" />
                            <span className="text-[9px] font-bold uppercase text-emerald-600">Specs</span>
                         </span>
                      )}
                      {item.isDraft && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1"><StickyNote size={8}/> Draft</span>}
                      {item.isBundle && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] bg-violet-600 text-white px-1.5 py-0.5 rounded font-black uppercase shadow-sm shadow-violet-200/80">
                          <Layers size={9} className="shrink-0" /> Bundle
                          {childItems.length > 0 ? ` · ${childItems.length}` : ''}
                        </span>
                      )}
                      {item.isPC && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-black uppercase shadow-sm shadow-indigo-200/80">
                          <Monitor size={9} className="shrink-0" /> PC Build
                          {childItems.length > 0 ? ` · ${childItems.length}` : ''}
                        </span>
                      )}
                      {!item.isPC && !item.isBundle && isInventoryContainer(item) && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] bg-violet-600 text-white px-1.5 py-0.5 rounded font-black uppercase shadow-sm shadow-violet-200/80">
                          <Package size={9} className="shrink-0" /> Container
                          {item.componentIds?.length ? ` · ${item.componentIds.length}` : ''}
                        </span>
                      )}
                      {isContainerMember(item) && !showMembershipBadge && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase">
                          In composition
                        </span>
                      )}
                      {item.isDefective && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase">Defective</span>}
                      {item.quantity != null && item.quantity > 1 && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase">
                          Qty: {item.quantity}
                        </span>
                      )}
                      {showFinancials && isMissingExplicitSalePlatform(item) && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black uppercase"
                          title="Platform not set — choose Sold on in the row or use bulk edit"
                        >
                          <AlertTriangle size={9} className="shrink-0" /> No platform
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.vendor}</span>
                   </div>
                   {item.status === ItemStatus.SOLD && (() => {
                      const hasBuyerInfo = Boolean(item.customer?.name || item.ebayUsername || item.ebayOrderId);
                      const openBuyerEditor = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        addRecentItemId(item.id);
                        setItemToEditBuyer(item);
                      };
                      return (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={openBuyerEditor}
                            className={`text-[9px] font-bold flex items-center gap-1 rounded-lg border transition-colors ${
                              hasBuyerInfo
                                ? 'text-slate-600 bg-slate-50 px-2 py-1 border-slate-100 hover:bg-slate-100 hover:border-slate-200'
                                : 'text-indigo-800 bg-indigo-50 px-2 py-1 border-indigo-200 hover:bg-indigo-100'
                            }`}
                            title="Open buyer & eBay order editor — paste order ID, upload screenshot for AI parse, or type manually"
                          >
                            {hasBuyerInfo ? (
                              <>
                                <Info size={10} className="text-slate-400 shrink-0" />
                                <span className="truncate max-w-[14rem]">
                                  {item.customer?.name || 'Buyer'}
                                  {item.ebayUsername ? ` · eBay: ${item.ebayUsername}` : ''}
                                  {item.ebayOrderId ? ` · #${item.ebayOrderId}` : ''}
                                </span>
                              </>
                            ) : (
                              <>
                                <User size={10} className="shrink-0" />
                                Add eBay order & buyer
                              </>
                            )}
                          </button>
                          {!item.ebayOrderId && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openOrderLookupModal(item); }}
                              className="text-[9px] font-bold text-indigo-600 flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-100 bg-white hover:bg-indigo-50"
                              title="Match this sale to a cached eBay order (API backfill or CSV import)"
                            >
                              <Receipt size={10} className="shrink-0" />
                              Match order
                            </button>
                          )}
                        </div>
                      );
                   })()}
                   {item.status !== ItemStatus.SOLD && isRealizedDisposal(item) && (item.customer?.name || item.giftRecipient || item.ebayUsername || item.ebayOrderId) && (
                      <p
                        className="text-[9px] text-slate-600 font-medium mt-1.5 flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100"
                        title={[
                          item.customer?.name ? `Buyer: ${item.customer.name}` : null,
                          item.customer?.address ? `Address: ${item.customer.address}` : null,
                          item.ebayUsername ? `eBay: ${item.ebayUsername}` : null,
                          item.ebayOrderId ? `Order ID: ${item.ebayOrderId}` : null,
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      >
                        <Info size={10} className="text-slate-400" />
                        <span className="truncate">
                          {item.customer?.name || item.giftRecipient || 'Buyer'}
                          {item.ebayUsername ? ` · eBay: ${item.ebayUsername}` : ''}
                          {item.ebayOrderId ? ` · #${item.ebayOrderId}` : ''}
                        </span>
                      </p>
                   )}
                   {item.specs && Object.keys(item.specs).length > 0 && (
                      <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug truncate pb-0.5" title={Object.entries(item.specs).map(([k, v]) => `${k}: ${v}`).join(' • ')}>
                         {Object.entries(item.specs).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </p>
                   )}
                   {compatibleCountByItemId.get(item.id) != null && (
                      <p className="text-[9px] text-blue-600 font-bold mt-1 flex items-center gap-1" title="Compatible parts in inventory — open item to see list">
                         <Layers size={10} /> Works with {compatibleCountByItemId.get(item.id)} item{compatibleCountByItemId.get(item.id) === 1 ? '' : 's'}
                      </p>
                   )}
                   {showMembershipBadge && parentKind && parentContainer && (
                      <div className="mt-1.5">
                        <ContainerMembershipBadge
                          kind={parentKind}
                          parentName={parentContainer.name}
                          onOpen={() => openParentContainer(parentContainer)}
                          onLocate={() => focusContainerInList(parentContainer)}
                        />
                      </div>
                   )}
                   {(tradeReceived.length > 0 || tradeSource) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {tradeReceived.length > 0 && (
                          <TradeLinkBadge
                            variant="outgoing"
                            receivedItems={tradeReceived}
                            onLocateItem={focusTradeLinkedItem}
                            onOpenItem={openTradeLinkedItem}
                          />
                        )}
                        {tradeSource && (
                          <TradeLinkBadge
                            variant="incoming"
                            sourceItem={tradeSource}
                            onLocate={() => focusTradeLinkedItem(tradeSource)}
                            onOpen={() => openTradeLinkedItem(tradeSource)}
                          />
                        )}
                      </div>
                   )}
                   {isBundleBodyExpanded && (
                      <div className={`mt-2 ml-0.5 pl-3 border-l-2 rounded-r-lg py-1 space-y-0.5 max-w-full ${
                        item.isPC
                          ? 'border-indigo-300 bg-indigo-50/60'
                          : 'border-violet-300 bg-violet-50/60'
                      }`}>
                         {childItems.map((child) => {
                            const childHit =
                              searchActiveForNest && matchesInventorySearch(child, searchQuery);
                            return (
                            <button
                              key={child.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick(child);
                              }}
                              className="w-full text-left group/child"
                            >
                              <div
                                className={`flex items-center justify-between gap-2 py-1 px-2 rounded-md transition-colors ${
                                  childHit
                                    ? 'bg-amber-100/80 ring-1 ring-amber-200/80'
                                    : item.isPC
                                      ? 'hover:bg-indigo-100/70'
                                      : 'hover:bg-violet-100/70'
                                }`}
                              >
                                <span className={`text-[11px] font-medium truncate min-w-0 ${
                                  item.isPC
                                    ? 'text-indigo-900 group-hover/child:text-indigo-950'
                                    : 'text-violet-900 group-hover/child:text-violet-950'
                                }`}>
                                  {child.name}
                                </span>
                                <span className="text-[10px] font-semibold text-slate-500 shrink-0 tabular-nums flex items-center gap-1">
                                  {!isSoldContainerRow && child.buyPrice != null && (
                                    <span className="text-slate-600">€{formatEUR(child.buyPrice)}</span>
                                  )}
                                  <Calendar size={9} className="opacity-60" />
                                  {formatChildListDate(child)}
                                </span>
                              </div>
                            </button>
                            );
                         })}
                         {!isSoldContainerRow && (
                           <p className={`px-2 pt-0.5 text-[9px] font-bold uppercase tracking-wider ${
                             item.isPC ? 'text-indigo-600/90' : 'text-violet-600/90'
                           }`}>
                             Total cost €{formatEUR(item.buyPrice)} · {childItems.length} parts
                           </p>
                         )}
                      </div>
                   )}
                </div>
             </div>
          </td>
        );
      case 'category':
        return (
          <td key={id} style={style}>
             <div 
               onClick={(e) => { e.stopPropagation(); setItemToEditCategory(item); }}
               className="group/cat cursor-pointer hover:bg-slate-100 rounded-md px-1 py-0.5 -mx-0.5 transition-colors"
               title="Click to reclassify"
             >
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-tight group-hover/cat:text-blue-600 flex items-center gap-1.5 leading-snug">
                   {item.category}
                   <Edit2 size={10} className="opacity-0 group-hover/cat:opacity-100 transition-opacity shrink-0"/>
                </p>
                {item.subCategory && <p className="text-[9px] font-bold text-slate-400 group-hover/cat:text-blue-400 truncate mt-0.5 pl-0.5">{item.subCategory}</p>}
             </div>
          </td>
        );
      case 'status':
        const isEditingStatus = editingCell?.itemId === item.id && editingCell?.field === 'status';
        const statusLabel =
          item.status === ItemStatus.IN_COMPOSITION
            ? 'In\u00A0Composition' // non-breaking space to keep on one line
            : item.status;
        const tradeReceivedForStatus = resolveTradeReceivedItems(item, itemsById);
        const tradeSourceForStatus = resolveTradeSourceItem(item, itemsById);
        const statusTitle =
          item.status === ItemStatus.TRADED && tradeReceivedForStatus.length > 0
            ? `Traded for: ${tradeReceivedForStatus.map((i) => i.name).join(', ')} — double click to change status`
            : tradeSourceForStatus
              ? `From trade: ${tradeSourceForStatus.name} — double click to change status`
              : 'Double click to change status';
        return (
          <td 
             key={id} 
             style={style}
             onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'status', item.status); }}
          >
             {isEditingStatus ? (
                <select
                   autoFocus
                   className="w-full bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-[10px] font-black uppercase outline-none shadow-lg"
                   value={editValue}
                   onChange={e => setEditValue(e.target.value)}
                   onBlur={saveEdit}
                   onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                   onClick={e => e.stopPropagation()}
                >
                   {Object.values(ItemStatus).map(status => (
                      <option key={status} value={status}>{status}</option>
                   ))}
                </select>
             ) : (
                <span 
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.18em] whitespace-nowrap cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all ${
                      item.status === ItemStatus.SOLD ? 'bg-purple-100 text-purple-700' :
                      item.status === ItemStatus.IN_STOCK ? 'bg-emerald-100 text-emerald-700' :
                      item.status === ItemStatus.TRADED ? 'bg-indigo-100 text-indigo-700' :
                      item.status === ItemStatus.GIFTED ? 'bg-rose-100 text-rose-700' :
                      item.status === ItemStatus.IN_COMPOSITION ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                   }`}
                   title={statusTitle}
                >
                  {item.status === ItemStatus.TRADED && tradeReceivedForStatus.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ArrowRightLeft size={10} className="opacity-80" />
                      {statusLabel}
                    </span>
                  )}
                  {(item.status !== ItemStatus.TRADED || tradeReceivedForStatus.length === 0) && statusLabel}
                </span>
             )}
          </td>
        );
      case 'buyPrice':
        const isEditingBuy = editingCell?.itemId === item.id && editingCell?.field === 'buyPrice';
        return (
          <td 
            key={id} 
            className="text-left font-black text-slate-900 cursor-pointer hover:bg-blue-50/30 transition-colors" 
            style={style}
            title="Double click to edit"
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'buyPrice', item.buyPrice); }}
          >
            {isEditingBuy ? (
               <input 
                 autoFocus
                 type="text"
                 inputMode="decimal"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-left outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               `€${formatEUR(item.buyPrice)}`
            )}
          </td>
        );
      case 'sellPrice': {
        const isEditingSell = editingCell?.itemId === item.id && editingCell?.field === 'sellPrice';
        const soldContainerSell =
          (item.isPC || item.isBundle) && isRealizedDisposal(item)
            ? getSoldContainerDisplayTotals(item, items, businessSettings.taxMode).sellPrice
            : null;
        const displaySellPrice = soldContainerSell ?? item.sellPrice;
        return (
          <td 
            key={id} 
            className="text-left font-bold text-slate-600 cursor-pointer hover:bg-blue-50/30 transition-colors" 
            style={style}
            title={
              soldContainerSell != null
                ? 'Bundle total sell price (sum of components)'
                : 'Double click to edit'
            }
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'sellPrice', item.sellPrice || 0); }}
          >
            {isEditingSell ? (
               <input
                 autoFocus
                 type="text"
                 inputMode="decimal"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-left outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               displaySellPrice ? `€${formatEUR(displaySellPrice)}` : '-'
            )}
          </td>
        );
      }
      case 'storePrice': {
        // Public asking price shown on the storefront — deliberately separate from Sell Price
        // (which is your internal target/realized sale price used for profit tracking).
        const isEditingStorePrice = editingCell?.itemId === item.id && editingCell?.field === 'storePrice';
        return (
          <td
            key={id}
            className="text-left font-bold text-violet-700 cursor-pointer hover:bg-violet-50/40 transition-colors"
            style={style}
            title="Storefront asking price. Double click to edit — separate from Sell Price."
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'storePrice', item.storePrice || 0); }}
          >
            {isEditingStorePrice ? (
               <input
                 autoFocus
                 type="text"
                 inputMode="decimal"
                 className="w-20 bg-white border-2 border-violet-500 rounded-lg px-2 py-1 text-left outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               item.storePrice ? `€${formatEUR(item.storePrice)}` : '-'
            )}
          </td>
        );
      }
      case 'profit': {
        const soldContainerProfit =
          (item.isPC || item.isBundle) && isRealizedDisposal(item)
            ? getSoldContainerDisplayTotals(item, items, businessSettings.taxMode).profit
            : null;
        const displayProfit = soldContainerProfit ?? profitForDisplay(item);
        if (item.isPC || item.isBundle) {
          if (soldContainerProfit != null) {
            return (
              <td
                key={id}
                className={`text-left font-black ${soldContainerProfit > 0 ? 'text-emerald-600' : soldContainerProfit < 0 ? 'text-red-500' : 'text-slate-300'}`}
                style={style}
                title="Bundle total profit (sum of component margins)"
              >
                €{formatEUR(soldContainerProfit)}
              </td>
            );
          }
          return (
            <td key={id} className="text-left text-xs font-bold text-slate-300" style={style} title="Bundles/PCs don't have profit. Expand to see component margins.">
              -
            </td>
          );
        }
        return (
          <td key={id} className={`text-left font-black ${displayProfit && displayProfit > 0 ? 'text-emerald-600' : displayProfit && displayProfit < 0 ? 'text-red-500' : 'text-slate-300'}`} style={style}>
             {displayProfit != null ? `€${formatEUR(displayProfit)}` : '-'}
          </td>
        );
      }
      case 'timeGauge': {
        const now = Date.now();
        const row = getTimeGaugeRow(item, now, items);
        if (!row) {
          return (
            <td key={id} className="text-left text-[10px] text-slate-300" style={style} title="Set acquisition date (or add components to bundle)">
              —
            </td>
          );
        }
        if (row.missingSellDate) {
          return (
            <td key={id} className="align-middle" style={style}>
              <div className="flex flex-col items-stretch gap-0.5 min-w-0" title={row.title}>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden" />
                <span className="text-[8px] font-bold text-slate-400 text-center leading-none">—</span>
              </div>
            </td>
          );
        }
        const fillPct = Math.max(8, Math.min(100, Math.round(row.t * 100)));
        const barColor = stressToRgb(row.t);
        return (
          <td key={id} className="align-middle" style={style}>
            <div
              className="flex flex-col items-stretch gap-0.5 min-w-0 max-w-[4.25rem]"
              title={row.title + (row.fromComponents ? ' (from components)' : '')}
            >
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-200/70">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${fillPct}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
              <span className="text-[8px] font-bold text-slate-500 text-left tabular-nums leading-none">
                {row.shortLabel}
              </span>
            </div>
          </td>
        );
      }
      case 'buyDate':
        if ((item.isPC || item.isBundle)) {
          return (
            <td key={id} className="text-left text-xs font-bold text-slate-300" style={style} title="Bundles/PCs don't have buy dates. Expand to see component buy dates.">
              -
            </td>
          );
        }
        return (
           <td 
             key={id} 
             className="text-left text-xs font-bold text-slate-500 cursor-pointer hover:bg-blue-50/30 transition-colors" 
             style={style}
             title="Double click to edit"
             onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, id, toLocalCalendarDateKey((item as any)[id]) || ''); }}
           >
              {editingCell?.itemId === item.id && editingCell?.field === id ? (
                 <input 
                   autoFocus
                   type="date"
                   className="w-24 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-left outline-none text-xs font-bold shadow-lg"
                   value={editValue}
                   onChange={e => setEditValue(e.target.value)}
                   onBlur={saveEdit}
                   onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                   onClick={e => e.stopPropagation()}
                 />
              ) : (
                 toLocalCalendarDateKey((item as any)[id]) || '-'
              )}
           </td>
        );
      case 'sellDate': {
        const isSoldOrTraded = isRealizedDisposal(item);
        const hasBuyerData = item.customer?.name || item.ebayUsername || item.ebayOrderId;
        const buyerTitle = hasBuyerData ? [
          item.customer?.name ? `Buyer: ${item.customer.name}` : null,
          item.customer?.address ? `Address: ${item.customer.address}` : null,
          item.ebayUsername ? `eBay: ${item.ebayUsername}` : null,
          item.ebayOrderId ? `Order ID: ${item.ebayOrderId}` : null,
        ].filter(Boolean).join(' • ') : undefined;
        const isEditingDate = editingCell?.itemId === item.id && editingCell?.field === id;
        
        const missing = isSoldOrTraded ? isMissingExplicitSalePlatform(item) : false;
        const inferred = missing ? formatItemSalePlatform(item) : null;

        return (
           <td 
             key={id} 
             className="text-left text-xs font-bold text-slate-500 cursor-pointer hover:bg-blue-50/30 transition-colors" 
             style={style}
             title={buyerTitle || "Double click to edit"}
             onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, id, toLocalCalendarDateKey((item as any)[id]) || ''); }}
           >
              {isEditingDate ? (
                 <input 
                   autoFocus
                   type="date"
                   className="w-24 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-left outline-none text-xs font-bold shadow-lg"
                   value={editValue}
                   onChange={e => setEditValue(e.target.value)}
                   onBlur={saveEdit}
                   onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                   onClick={e => e.stopPropagation()}
                 />
              ) : (
                 <div className="flex flex-col items-end gap-1">
                   <span>{toLocalCalendarDateKey((item as any)[id]) || '-'}</span>
                   {isSoldOrTraded && (
                     <>
                       {missing ? (
                         <div className="flex flex-col items-end gap-1 mt-1" onClick={e => e.stopPropagation()}>
                           <div className="flex items-center gap-1 scale-90 origin-right">
                             <span title="Platform not set — pick where this was sold">
                               <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                             </span>
                             <SalePlatformQuickPickButtons
                               dense={true}
                               onPick={(platform) => handleQuickPlatformChange(item, platform)}
                             />
                           </div>
                           {inferred && inferred !== 'Unknown' && (
                             <p className="text-[8px] text-amber-700 truncate pl-4" title="Inferred from order ID / payment">
                               Detect: {inferred}
                             </p>
                           )}
                         </div>
                       ) : (
                         <div className="flex flex-col items-end gap-0.5 mt-0.5" onClick={e => e.stopPropagation()}>
                           <select
                             value={item.platformSold || ''}
                             onChange={(e) => handleQuickPlatformChange(item, e.target.value as Platform | '')}
                             className="py-0.5 pl-1 pr-4 rounded border border-slate-200 bg-white text-[9px] font-black text-blue-600 uppercase tracking-tight outline-none focus:ring-1 focus:ring-blue-400/40 appearance-none bg-no-repeat bg-right"
                             style={{
                               backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' fill='%232563eb' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`,
                               backgroundPosition: 'right 0.15rem center',
                             }}
                           >
                             <option value="">— Sold On —</option>
                             {SALE_PLATFORM_OPTIONS.map((opt) => (
                               <option key={opt.value} value={opt.value}>{opt.label}</option>
                             ))}
                           </select>
                           {item.paymentType && (
                             <span className="text-[8px] font-medium text-slate-400 mt-0.5 leading-none">
                               {item.paymentType}
                             </span>
                           )}
                         </div>
                       )}
                       
                       {hasBuyerData && (
                         <span className="text-[9px] font-medium text-slate-600 truncate max-w-full" title={buyerTitle}>
                           {item.customer?.name || item.ebayUsername || `#${item.ebayOrderId}`}
                         </span>
                       )}
                     </>
                   )}
                 </div>
              )}
           </td>
        );
      }
      case 'actions':
        return (
          <td
            key={id}
            className="text-left relative sticky right-0 z-[18] bg-white group-hover/row:bg-slate-50 border-l border-slate-200/90 shadow-[-6px_0_12px_-4px_rgba(15,23,42,0.07)]"
            style={style}
          >
            <div className={`flex flex-nowrap justify-start items-center gap-0.5 transition-opacity ${activeAiDropdownId === item.id ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100'}`}>
              {item.status === ItemStatus.IN_STOCK && (
                 <>
                   <button onClick={(e) => { e.stopPropagation(); setItemToCrossPost(item); }} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md shrink-0" title="Cross-Post"><Share2 size={14}/></button>
                   
                   {/* Sparkles button (AI tools dropdown toggle) */}
                   <div className="relative inline-block" onClick={e => e.stopPropagation()}>
                     <button
                       type="button"
                       onClick={(e) => {
                         e.stopPropagation();
                         setActiveAiDropdownId(prev => prev === item.id ? null : item.id);
                       }}
                       className={`p-1.5 rounded-md shrink-0 transition-colors ${
                         activeAiDropdownId === item.id 
                           ? 'bg-amber-100 text-amber-700' 
                           : 'text-amber-600 hover:bg-amber-50'
                       }`}
                       title="AI Assistant & Listing Tools"
                     >
                       {parsingSingleId === item.id ? (
                         <Loader2 size={14} className="animate-spin text-amber-600" />
                       ) : (
                         <Sparkles size={14} />
                       )}
                     </button>
                     
                     {activeAiDropdownId === item.id && (
                       <div 
                         onClick={(e) => e.stopPropagation()} 
                         className="absolute right-0 bottom-full mb-1 z-[150] w-56 rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 text-left animate-in fade-in slide-in-from-bottom-2 duration-150"
                       >
                         <div className="px-2 py-1 border-b border-slate-100 flex items-center justify-between mb-1">
                           <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">AI Listing Tools</span>
                           {item.marketDescription && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Text generated" />}
                         </div>
                         <div className="space-y-0.5">
                           <button
                             type="button"
                             onClick={() => { setActiveAiDropdownId(null); handleParseSingleItem(item); }}
                             disabled={parsingSingleId !== null}
                             className="w-full text-left px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
                           >
                             <Sparkles size={12} className="text-amber-500" /> Parse Specs (AI)
                           </button>
                           <button
                             type="button"
                             onClick={() => { setActiveAiDropdownId(null); handleSuggestPrice(item); }}
                             disabled={priceSuggestId === item.id}
                             className="w-full text-left px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
                           >
                             <Tag size={12} className="text-amber-500" /> Suggest Price (AI)
                           </button>
                           <button
                             type="button"
                             onClick={() => { setActiveAiDropdownId(null); handleGenerateListingDescription(item); }}
                             disabled={listingGenId === item.id}
                             className="w-full text-left px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
                           >
                             <FileText size={12} className="text-emerald-500" /> Generate Desc (AI)
                           </button>
                           {item.marketDescription && (
                             <button
                               type="button"
                               onClick={() => { setActiveAiDropdownId(null); handleCopyListingDescription(item); }}
                               className="w-full text-left px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
                             >
                               <Copy size={12} className="text-slate-500" /> Copy AI Text
                             </button>
                           )}
                           <button
                             type="button"
                             onClick={async () => {
                               setActiveAiDropdownId(null);
                               try {
                                 await copyKleinanzeigenListing(item);
                               } catch {
                                 alert('Copy failed');
                               }
                             }}
                             className="w-full text-left px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg flex items-center gap-2"
                           >
                             <span className="w-3 h-3 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[7px] font-bold">K</span> Copy Kleinanzeigen List
                           </button>
                         </div>
                       </div>
                     )}
                   </div>
                 </>
              )}
              <button onClick={(e) => { e.stopPropagation(); handleEditClick(item); }} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md shrink-0" title="Edit">
                 <Edit2 size={14}/>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleDuplicate(item); }} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md shrink-0" title="Duplicate Item">
                 <Copy size={14}/>
              </button>
              {(item.isPC || item.isBundle) && (
                 <button onClick={(e) => { e.stopPropagation(); setBundleToDismantle(item); }} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md shrink-0" title="Unbundle / Dismantle"><Unlink size={14}/></button>
              )}
              {item.status === ItemStatus.IN_STOCK && <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToSell(item); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md shrink-0" title="Mark Sold"><ShoppingBag size={14}/></button>}
              {item.status === ItemStatus.IN_STOCK && <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToTrade(item); }} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md shrink-0" title="Trade"><ArrowRightLeft size={14}/></button>}
              {item.status === ItemStatus.IN_STOCK && <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToGift(item); }} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md shrink-0" title="Gift / Privatentnahme"><Gift size={14}/></button>}
              {isSoldOrTradedOnly(item) && (
                <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setInvoiceViewItem(item); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md shrink-0" title="Generate Invoice"><FileText size={14}/></button>
              )}
              {item.status === ItemStatus.SOLD && (
                <button onClick={(e) => { e.stopPropagation(); openOrderLookupModal(item); }} className={`p-1.5 rounded-md shrink-0 ${item.ebayOrderId ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'}`} title={item.ebayOrderId ? `eBay order ${item.ebayOrderId} — search cached orders` : 'Match cached eBay order to this sale'}><Receipt size={14}/></button>
              )}
              {item.status === ItemStatus.SOLD && (
                <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToEditBuyer(item); }} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md shrink-0" title="Buyer & eBay order — order ID, screenshot parse, or manual entry"><User size={14}/></button>
              )}
              {(item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED) && (
                <button onClick={(e) => { e.stopPropagation(); setItemToReturn(item); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md shrink-0" title={item.status === ItemStatus.GIFTED ? 'Undo gift' : 'Mark Unsold / Return'}><RotateCcw size={14}/></button>
              )}
              <button onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }} className="p-1.5 text-slate-300 hover:text-red-500 rounded-md shrink-0" title="Delete"><Trash2 size={14}/></button>
            </div>
          </td>
        );
      default: return null;
    }
  };

  const renderCellRef = useRef(renderCell);
  renderCellRef.current = renderCell;
  const renderRowCells = useCallback(
    (item: InventoryItem, isSelected: boolean) =>
      visibleColumns.map((colId) => renderCellRef.current(item, colId, isSelected)),
    [visibleColumns, effectiveColumnWidths]
  );

  const handleDeleteItem = (item: InventoryItem) => {
     onDelete(item.id);
     setItemToDelete(null);
  };

  const handleBulkDelete = () => {
     onUpdate([], selectedIds);
     setShowBulkDeleteConfirm(false);
     setSelectedIds([]);
  };

  const hasActiveFilters = statusFilter !== 'ACTIVE' || categoryFilter !== 'ALL' || subCategoryFilter || timeFilter !== 'ALL' || salePlatformFilter !== 'ALL' || salePaymentFilter !== 'ALL' || isAmountFilterActive(amountFilter) || activeSpecFilterCount > 0;
  const clearAllFilters = () => {
    setStatusFilter('ACTIVE');
    setCategoryFilter('ALL');
    setSubCategoryFilter('');
    setTimeFilter('ALL');
    setSalePlatformFilter('ALL');
    setSalePaymentFilter('ALL');
    setAmountFilter(EMPTY_AMOUNT_FILTER);
    setSpecFilters({});
    setSpecRangeFilters({});
    setShowInComposition(true);
  };

  const revealItemInList = useCallback((item: InventoryItem) => {
    setSpecFilters({});
    setSpecRangeFilters({});
    setAmountFilter(EMPTY_AMOUNT_FILTER);
    setTimeFilter('ALL');
    setCategoryFilter('ALL');
    setSubCategoryFilter('');
    setShowInComposition(true);
    if (isRealizedDisposal(item)) {
      setStatusFilter('SOLD');
    } else if (item.isDraft) {
      setStatusFilter('DRAFTS');
    } else {
      setStatusFilter('ACTIVE');
    }
  }, []);

  useLayoutEffect(() => {
    if (!scrollTargetItemId) return;
    const id = scrollTargetItemId;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-inventory-item-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedItemId(id);
        setScrollTargetItemId(null);
        window.setTimeout(() => {
          setHighlightedItemId((current) => (current === id ? null : current));
        }, 2600);
        return;
      }
      attempts += 1;
      if (attempts < 8) {
        window.setTimeout(tryScroll, 80);
      } else {
        setScrollTargetItemId(null);
      }
    };
    tryScroll();
  }, [scrollTargetItemId, sortedItems, sortedActiveItems, sortedSoldItems, splitView]);

  const toggleSpecFilterValue = useCallback((key: string, val: string | number) => {
    setSpecFilters((prev) => toggleSpecFilterSelection(prev, key, val));
  }, []);

  const clearQuickPinSpecFilters = useCallback(() => {
    setSpecFilters({});
    setSpecRangeFilters({});
  }, []);

  const applyQuickCategoryPin = useCallback(
    (pin: QuickCategoryPin) => {
      if (isQuickCategoryPinActive(pin)) {
        setCategoryFilter('ALL');
        setSubCategoryFilter('');
        clearQuickPinSpecFilters();
      } else {
        setCategoryFilter(pin.category);
        setSubCategoryFilter(pin.subCategory ?? '');
        clearQuickPinSpecFilters();
      }
    },
    [isQuickCategoryPinActive, clearQuickPinSpecFilters]
  );

  const addQuickCategoryPin = useCallback((category: string, subCategory: string, label: string) => {
    const sub = subCategory.trim();
    const id = quickCategoryPinId(category, sub || undefined);
    const trimmedLabel = label.trim() || sub || category;
    setQuickCategoryPins((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { id, label: trimmedLabel, category, ...(sub ? { subCategory: sub } : {}) }];
    });
  }, []);

  const removeQuickCategoryPin = useCallback((id: string) => {
    setQuickCategoryPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const resetQuickCategoryPins = useCallback(() => {
    setQuickCategoryPins(DEFAULT_QUICK_CATEGORY_PINS);
  }, []);

  const addPhotosTargetItems = useMemo(
    () => addPhotosTargetIds.map((id) => itemsById.get(id)).filter(Boolean) as InventoryItem[],
    [addPhotosTargetIds, itemsById]
  );

  const openAddPhotosModal = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setAddPhotosTargetIds(ids);
    setShowBulkAddPhotosModal(true);
  }, []);

  const closeAddPhotosModal = useCallback(() => {
    setShowBulkAddPhotosModal(false);
    setAddPhotosTargetIds([]);
  }, []);

  const handleApplyProductCardPhoto = useCallback(
    async (url: string) => {
      if (!cardGenItem) return;
      const merged = normalizeImageList([url, cardGenItem.imageUrl, ...(cardGenItem.imageUrls || [])]);
      await onUpdate({
        ...cardGenItem,
        imageUrl: merged[0],
        imageUrls: merged,
      });
      setToast('Product card applied as main photo');
    },
    [cardGenItem, onUpdate]
  );

  const selectedHasSoldOrTraded = useMemo(
    () =>
      deferredSelectedIds.some((id) => {
        const s = itemsById.get(id)?.status;
        return s != null && isRealizedDisposal({ status: s } as InventoryItem);
      }),
    [deferredSelectedIds, itemsById]
  );

  const handleBulkAddPhotos = useCallback(
    async (urls: string[], options?: AddPhotosApplyOptions) => {
      if (!urls.length || addPhotosTargetIds.length === 0) return;
      const prepared = urls;
      if (!prepared.length) return;
      const idSet = new Set(addPhotosTargetIds);
      const updated = items
        .filter((i) => idSet.has(i.id))
        .map((item) => {
          const existing = normalizeImageList([item.imageUrl, ...(item.imageUrls || [])]);
          const merged = normalizeImageList([...existing, ...prepared]);
          const match = options?.ebayMatch;
          return {
            ...item,
            imageUrl: merged[0],
            imageUrls: merged,
            ...(match
              ? {
                  storePrice: match.roundedPrice,
                  listedOnEbay: true,
                  ebayListingId: match.listingId,
                  ebaySku: item.ebaySku || match.sku,
                }
              : {}),
            ...(options?.offerId ? { ebayOfferId: options.offerId } : {}),
          };
        });
      if (updated.length) {
        onUpdate(updated);
        const priceNote = options?.ebayMatch
          ? ` · storefront €${formatEUR(options.ebayMatch.roundedPrice)} from eBay`
          : '';
        setToast(
          `Added ${prepared.length} photo${prepared.length === 1 ? '' : 's'} to ${updated.length} item${updated.length === 1 ? '' : 's'}${priceNote}`
        );
      }
      closeAddPhotosModal();
    },
    [addPhotosTargetIds, items, onUpdate, closeAddPhotosModal]
  );

  const bulkActions = useMemo((): BulkAction[] => {
    const exportKleinanzeigen = () => {
      const selected = deferredSelectedIds.map((id) => itemsById.get(id)).filter(Boolean) as InventoryItem[];
      const csv = generateKleinanzeigenCSV(selected);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kleinanzeigen-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const exportEbayCsv = () => {
      const selected = deferredSelectedIds.map((id) => itemsById.get(id)).filter(Boolean) as InventoryItem[];
      const csv = generateEbayCSV(selected, businessSettings);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ebay-file-exchange-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const exportExcel = () => {
      const selected = deferredSelectedIds.map((id) => itemsById.get(id)).filter(Boolean) as InventoryItem[];
      exportInventoryToExcel(selected);
    };
    return [
      { id: 'photos', label: 'Add photos', icon: <Camera size={16} />, onClick: () => openAddPhotosModal(deferredSelectedIds), variant: 'primary' },
      { id: 'compose', label: 'Compose Bundle', icon: <Monitor size={16} />, onClick: handleBuildFromSelection, variant: 'primary' },
      { id: 'lot', label: 'Lot Bundle', icon: <Package size={16} />, onClick: handleCreateLotBundleFromSelection, variant: 'violet' },
      { id: 'category', label: 'Set category', icon: <Layers size={16} />, onClick: () => setShowBulkCategoryEdit(true), variant: 'primary' },
      { id: 'publish', label: 'Publish store', icon: <Globe size={16} />, onClick: () => handleBulkStoreVisible(true), variant: 'emerald' },
      { id: 'visible', label: 'Store visible', icon: <Eye size={16} />, onClick: () => setShowBulkStoreVisible(true), variant: 'primary' },
      { id: 'salepct', label: 'Sale %', icon: <Percent size={16} />, onClick: () => setShowBulkSalePct(true), variant: 'primary' },
      { id: 'tag', label: 'Add tag', icon: <Tag size={16} />, onClick: () => setShowBulkTag(true), variant: 'primary' },
      { id: 'kleincsv', label: 'Kleinanzeigen CSV', icon: <Download size={16} />, onClick: exportKleinanzeigen, variant: 'primary' },
      { id: 'ebaycsv', label: 'eBay CSV', icon: <Download size={16} />, onClick: exportEbayCsv, variant: 'primary' },
      { id: 'excel', label: 'Export Excel', icon: <FileSpreadsheet size={16} />, onClick: exportExcel, variant: 'primary' },
      {
        id: 'aidesc',
        label: bulkGenerateDescriptions ? bulkGenerateProgress || 'Generating…' : 'AI descriptions',
        icon: bulkGenerateDescriptions ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />,
        onClick: () => handleBulkGenerateDescriptions(),
        variant: 'violet',
        disabled: bulkGenerateDescriptions,
      },
      {
        id: 'editsales',
        label: 'Edit sales',
        icon: <Edit2 size={16} />,
        onClick: () => setShowBulkSalesEdit(true),
        variant: 'indigo',
        hidden: !selectedHasSoldOrTraded,
      },
      { id: 'delete', label: 'Delete', icon: <Trash2 size={16} />, onClick: () => setShowBulkDeleteConfirm(true), variant: 'danger' },
    ];
  }, [
    deferredSelectedIds,
    itemsById,
    bulkGenerateDescriptions,
    bulkGenerateProgress,
    selectedHasSoldOrTraded,
    handleBuildFromSelection,
    handleCreateLotBundleFromSelection,
    handleBulkStoreVisible,
    handleBulkGenerateDescriptions,
    openAddPhotosModal,
  ]);

  const bulkSelectionCount = deferredSelectedIds.length;

  return (
    <div className="h-full min-h-0 flex flex-col gap-1 overflow-hidden animate-in fade-in relative">
      {showFinancials && financialStats && !splitView && (
        <SoldFinancialBar
          stats={financialStats}
          taxMode={businessSettings.taxMode}
          businessSettings={businessSettings}
          onBusinessSettingsChange={onBusinessSettingsChange}
        />
      )}

      <header className="shrink-0 space-y-1">
         <div className="flex flex-wrap items-center gap-1">
            {(statusFilter === 'DRAFTS' || statusFilter === 'ALL') && !splitView ? (
              <>
                <span className="text-[10px] font-black uppercase text-slate-600 px-0.5">
                  {statusFilter === 'DRAFTS' ? 'Drafts' : 'All'}
                </span>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ACTIVE')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  <Package size={12} /> Active / Sold
                </button>
              </>
            ) : (
              <>
                <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('ACTIVE'); setSplitView(false); }}
                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all ${
                      !splitView && statusFilter === 'ACTIVE' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Package size={12} className="shrink-0" />
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('SOLD'); setSplitView(false); }}
                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all ${
                      !splitView && statusFilter === 'SOLD' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <ShoppingBag size={12} className="shrink-0" />
                    Sold
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSplitView((v) => {
                      const next = !v;
                      if (next && statusFilter !== 'ACTIVE' && statusFilter !== 'SOLD') {
                        setStatusFilter('ACTIVE');
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase transition-all ${
                    splitView ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Show active and sold lists side by side"
                >
                  <Columns2 size={12} className="shrink-0" />
                  Split
                </button>
                {!splitView && (
                  <select
                    value={statusFilter === 'DRAFTS' || statusFilter === 'ALL' ? statusFilter : ''}
                    onChange={(e) => {
                      const v = e.target.value as StatusFilter;
                      if (v) { setStatusFilter(v); setSplitView(false); }
                    }}
                    className="py-1 pl-2 pr-6 rounded-lg border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.25rem center' }}
                  >
                    <option value="">More…</option>
                    <option value="DRAFTS">Drafts</option>
                    <option value="ALL">All items</option>
                  </select>
                )}
              </>
            )}
            <span className="text-slate-500 text-xs font-medium">
              {splitView
                ? `${sortedActiveItems.length} active · ${sortedSoldItems.length} sold${timeFilter !== 'ALL' ? ' · period' : ''}`
                : `${sortedItems.length} items${timeFilter !== 'ALL' ? ' · period' : ''}`}
            </span>
            <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-[220px] relative" ref={searchSuggestionsRef}>
               <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
               <input
                  ref={searchInputRef}
                  type="text"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onFocus={() => setSearchSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setSearchSuggestionsOpen(false), 180)}
               />
               {searchSuggestionsOpen && searchSuggestions.length > 0 && (
                 <div className="absolute z-50 left-0 right-0 top-full mt-1 py-1.5 bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                   {searchSuggestions.map((s, idx) => (
                     <button
                       key={`${s.type}-${s.text}-${idx}`}
                       type="button"
                       className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50 flex items-center gap-2"
                       onMouseDown={(e) => {
                         e.preventDefault();
                         setSearchTerm(s.text);
                         setSearchSuggestionsOpen(false);
                         if (s.type === 'name') {
                           const match = items.find((i) => i.name === s.text);
                           if (match) revealItemInList(match);
                         }
                         searchInputRef.current?.focus();
                       }}
                     >
                       <span className="text-slate-900 font-medium truncate">{s.text}</span>
                       <span className="text-[10px] text-slate-400 shrink-0">{s.type}</span>
                     </button>
                   ))}
                 </div>
               )}
            </div>
            <div className="relative" ref={recentDropdownRef}>
               <button
                 type="button"
                 onClick={() => setShowRecentDropdown((p) => !p)}
                 className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${showRecentDropdown ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                 title="Quick access to recently edited or viewed items"
               >
                 <History size={14} /> Recent
                 {recentItemsResolved.length > 0 && <span className="text-[10px] opacity-75">({recentItemsResolved.length})</span>}
               </button>
               {showRecentDropdown && (
                 <div className="absolute left-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                   {recentItemsResolved.length === 0 ? (
                     <p className="px-3 py-4 text-xs text-slate-400">No recent items. Edit or view items to see them here.</p>
                   ) : (
                     recentItemsResolved.map((it) => (
                       <button
                         key={it.id}
                         type="button"
                         onClick={() => { handleEditClick(it); setShowRecentDropdown(false); }}
                         className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50 flex flex-col gap-0.5 truncate"
                       >
                         <span className="font-medium text-slate-900 truncate">{it.name}</span>
                         <span className="text-[10px] text-slate-500">{it.category}{it.subCategory ? ` · ${it.subCategory}` : ''}</span>
                       </button>
                     ))
                   )}
                 </div>
               )}
            </div>
            <select
               value={categoryFilter}
               onChange={e => { setCategoryFilter(e.target.value); setSubCategoryFilter(''); }}
               className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px]"
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
            >
               <option value="ALL">All categories</option>
               {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            {categoryFilter !== 'ALL' && (categories[categoryFilter]?.length ?? 0) > 0 && (
               <select
                  value={subCategoryFilter}
                  onChange={e => setSubCategoryFilter(e.target.value)}
                  className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[90px]"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
               >
                  <option value="">All sub</option>
                  {(categories[categoryFilter] || []).map(sub => <option key={sub} value={sub}>{sub}</option>)}
               </select>
            )}
            <select
               value={timeFilter}
               onChange={e => setTimeFilter(e.target.value as TimeFilter)}
               className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right"
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
            >
               <option value="ALL">All time</option>
               <option value="THIS_WEEK">This week</option>
               <option value="LAST_WEEK">Last week</option>
               <option value="THIS_MONTH">This month</option>
               <option value="LAST_MONTH">Last month</option>
               <option value="LAST_30">Last 30d</option>
               <option value="LAST_90">Last 90d</option>
               <option value="THIS_YEAR">This year</option>
               <option value="LAST_YEAR">Last year</option>
            </select>
            <button
               type="button"
               onClick={() => setShowInComposition(prev => !prev)}
               className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold uppercase tracking-wide ${
                 showInComposition
                   ? 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                   : 'border-blue-500 text-blue-600 bg-blue-50'
               }`}
               title={
                 showInComposition
                   ? 'Hide orphan in-composition items (bundle/PC parts always nest under their parent)'
                   : 'Show orphan in-composition items (bundle/PC parts always nest under their parent)'
               }
            >
               <Hourglass size={11} />
               {showInComposition ? 'Orphans: shown' : 'Orphans: hidden'}
            </button>
            {(splitView || (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS')) && (
               <>
                  <select value={salePlatformFilter} onChange={e => setSalePlatformFilter(e.target.value)} className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}>
                      <option value="ALL">Platform</option>
                      <option value={MISSING_PLATFORM_FILTER}>⚠ No platform</option>
                      <option value="kleinanzeigen.de">Kleinanzeigen</option>
                      <option value="ebay.de">eBay</option>
                      <option value="In Person">In person</option>
                      <option value="Amazon">Amazon</option>
                      <option value="Other">Other</option>
                  </select>
                  <select value={salePaymentFilter} onChange={e => setSalePaymentFilter(e.target.value)} className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}>
                      <option value="ALL">Payment</option>
                      {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="relative flex items-center" ref={amountFilterPanelRef}>
                    <button
                      type="button"
                      ref={amountFilterButtonRef}
                      onClick={() => setShowAmountFilterPanel((p) => !p)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold uppercase tracking-wide ${
                        showAmountFilterPanel || isAmountFilterActive(amountFilter)
                          ? 'border-blue-500 text-blue-600 bg-blue-50'
                          : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                      }`}
                      title="Filter sold items by sell (VK) or buy (EK) amount"
                    >
                      <Wallet size={11} />
                      Amount
                      {isAmountFilterActive(amountFilter) && (
                        <span className="max-w-[88px] truncate normal-case font-bold">{amountFilterSummary(amountFilter)}</span>
                      )}
                      <ChevronDown size={11} className={`transition-transform ${showAmountFilterPanel ? 'rotate-180' : ''}`} />
                    </button>
                    {showAmountFilterPanel && (
                      <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Amount filter</span>
                          {isAmountFilterActive(amountFilter) && (
                            <button type="button" onClick={clearAmountFilter} className="text-[10px] font-bold text-slate-500 hover:text-red-600 flex items-center gap-1">
                              <FilterX size={10} /> Clear
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(['sell', 'buy', 'either'] as const).map((field) => (
                            <button
                              key={field}
                              type="button"
                              onClick={() => setAmountFilter((prev) => ({ ...prev, field }))}
                              className={`px-2 py-1 rounded-lg text-xs font-bold ${
                                amountFilter.field === field ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {field === 'sell' ? 'Sell (VK)' : field === 'buy' ? 'Buy (EK)' : 'Either'}
                            </button>
                          ))}
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[10px] font-bold uppercase text-slate-500">Exact €</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 22.33"
                            value={amountExactDraft}
                            onChange={(e) => setAmountExactDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') applyAmountFilterDraft(); }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block space-y-1">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Min €</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Min"
                              value={amountMinDraft}
                              onChange={(e) => setAmountMinDraft(e.target.value)}
                              disabled={Boolean(amountExactDraft.trim())}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Max €</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Max"
                              value={amountMaxDraft}
                              onChange={(e) => setAmountMaxDraft(e.target.value)}
                              disabled={Boolean(amountExactDraft.trim())}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </label>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-snug">Exact match allows ±2 ct. Use Either to match sell or buy price.</p>
                        <button
                          type="button"
                          onClick={applyAmountFilterDraft}
                          className="w-full py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-wide hover:bg-slate-800"
                        >
                          Apply
                        </button>
                      </div>
                    )}
                  </div>
               </>
            )}
            <div className="relative flex items-center" ref={columnsPanelRef}>
               <button
                  type="button"
                  onClick={() => setShowColumnsPanel((p) => !p)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all ${showColumnsPanel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
                  title="Show/hide and reorder columns"
               >
                  <Columns2 size={12} /> Columns
                  <ChevronDown size={12} className={`transition-transform ${showColumnsPanel ? 'rotate-180' : ''}`} />
               </button>
               {showColumnsPanel && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150">
                     <div className="p-2 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Columns</span>
                        <div className="flex items-center gap-1.5">
                           <button type="button" title="Reset column order and visibility" onClick={() => { setColumnOrder(defaultColumnOrder); setHiddenColumnIds([]); }} className="text-[10px] font-bold text-slate-500 hover:text-blue-600">Reset</button>
                           <button type="button" title="Reset column widths to defaults" onClick={() => { setColumnWidths({ ...DEFAULT_WIDTHS }); setManualWidthColumns(new Set()); }} className="text-[10px] font-bold text-slate-500 hover:text-blue-600">Widths</button>
                        </div>
                     </div>
                     <div className="p-2 space-y-0.5 max-h-72 overflow-y-auto">
                        {columnOrder.map((id, idx) => {
                           const label = ALL_COLUMNS.find((c) => c.id === id)?.label || id;
                           const isHidden = hiddenColumnIds.includes(id);
                           return (
                              <div key={id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 group">
                                 <input
                                    type="checkbox"
                                    checked={!isHidden}
                                    onChange={() => toggleColumnVisibility(id)}
                                    disabled={!isHidden && visibleColumns.length <= 2}
                                    className="rounded border-slate-300"
                                 />
                                 <span className={`flex-1 text-xs font-medium truncate ${isHidden ? 'text-slate-400' : 'text-slate-900'}`}>{label || id}</span>
                                 <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button type="button" onClick={() => moveColumn(idx, 'up')} disabled={idx === 0} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronUp size={12} /></button>
                                    <button type="button" onClick={() => moveColumn(idx, 'down')} disabled={idx === columnOrder.length - 1} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronDown size={12} /></button>
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  </div>
               )}
            </div>
            <div className="relative flex items-center" ref={filtersPanelRef}>
               <button
                  type="button"
                  ref={filtersButtonRef}
                  onClick={() => setShowSpecFiltersPanel(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all ${showSpecFiltersPanel || activeSpecFilterCount > 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
               >
                  <Sliders size={12} /> Filters
                  {activeSpecFilterCount > 0 && <span className="bg-white/20 text-[10px] min-w-[16px] h-4 rounded flex items-center justify-center px-0.5">{activeSpecFilterCount}</span>}
                  <ChevronDown size={12} className={`transition-transform ${showSpecFiltersPanel ? 'rotate-180' : ''}`} />
               </button>
               {showSpecFiltersPanel && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-[min(90vw,420px)] max-h-[min(70vh,420px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150">
                     <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Category &amp; specs</span>
                        {activeSpecFilterCount > 0 && (
                           <button type="button" onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); setSpecFilters({}); setSpecRangeFilters({}); }} className="text-[10px] font-bold text-slate-500 hover:text-red-600 flex items-center gap-1"><FilterX size={10} /> Clear</button>
                        )}
                     </div>
                     <div className="p-3 space-y-3 max-h-[min(65vh,380px)] overflow-y-auto">
                        <div className="flex flex-wrap gap-1.5">
                           <button type="button" onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); }} className={`px-2 py-1 rounded-lg text-xs font-bold ${categoryFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All</button>
                           {Object.keys(categories).map(cat => (
                              <button key={cat} type="button" onClick={() => { setCategoryFilter(cat); setSubCategoryFilter(''); }} className={`px-2 py-1 rounded-lg text-xs font-bold ${categoryFilter === cat && !subCategoryFilter ? 'bg-blue-600 text-white' : categoryFilter === cat ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{cat}</button>
                           ))}
                        </div>
                        {categoryFilter !== 'ALL' && (categories[categoryFilter]?.length ?? 0) > 0 && (
                           <div className="flex flex-wrap gap-1">
                              <button type="button" onClick={() => setSubCategoryFilter('')} className={`px-2 py-1 rounded text-xs font-medium ${!subCategoryFilter ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>All</button>
                              {(categories[categoryFilter] || []).map(sub => <button key={sub} type="button" onClick={() => setSubCategoryFilter(sub)} className={`px-2 py-1 rounded text-xs font-medium ${subCategoryFilter === sub ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{sub}</button>)}
                           </div>
                        )}
                        {specOptions.length === 0 ? <p className="text-slate-400 text-xs py-2">Select a category to see spec filters.</p> : (
                           <div className="grid grid-cols-2 gap-2">
                              {specOptions.map(({ key, values, isNumeric, min: optMin, max: optMax }) => {
                                 const selected = specFilters[key] ?? [];
                                 const range = specRangeFilters[key];
                                 const hasRange = range && (range.min !== undefined || range.max !== undefined);
                                 return (
                                    <div key={key} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                       <div className="text-[10px] font-bold text-slate-500 mb-1">{key}</div>
                                       <div className="flex flex-wrap gap-1">
                                          {values.map(val => {
                                             const isSelected = selected.some(s => (typeof val === 'number' && typeof s === 'number' && val === s) || String(val).toLowerCase() === String(s).toLowerCase());
                                             return (
                                                <button key={String(val)} type="button" onClick={() => toggleSpecFilterValue(key, val)} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'}`}>{String(val)}</button>
                                             );
                                          })}
                                       </div>
                                       {isNumeric && (optMin !== undefined || optMax !== undefined) && (
                                          <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-200/50">
                                             <input type="number" placeholder={`Min ${optMin ?? ''}`} value={range?.min ?? ''} onChange={e => setSpecRangeFilters(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value === '' ? undefined : Number(e.target.value), max: prev[key]?.max } }))} className="w-12 px-1.5 py-0.5 rounded border border-slate-200 text-[10px]" />
                                             <span className="text-slate-400 text-[10px]">–</span>
                                             <input type="number" placeholder={`Max ${optMax ?? ''}`} value={range?.max ?? ''} onChange={e => setSpecRangeFilters(prev => ({ ...prev, [key]: { ...prev[key], min: prev[key]?.min, max: e.target.value === '' ? undefined : Number(e.target.value) } }))} className="w-12 px-1.5 py-0.5 rounded border border-slate-200 text-[10px]" />
                                             {hasRange && <button type="button" onClick={() => setSpecRangeFilters(prev => { const n = { ...prev }; delete n[key]; return n; })} className="text-[10px] font-bold text-slate-400 hover:text-red-600">×</button>}
                                          </div>
                                       )}
                                    </div>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                  </div>
               )}
            </div>
            <div className="flex items-center gap-1">
               <button
                 type="button"
                 onClick={() => setShowAISpecsModal(true)}
                 className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-amber-700 hover:border-amber-300 flex items-center gap-1"
                 title="Parse specs with AI for selected items"
               >
                 <Sparkles size={14} className="text-amber-500" />
                 <span className="text-[10px] font-bold uppercase hidden sm:inline">AI</span>
                 {bulkSelectionCount > 0 && (
                   <span className="text-[9px] font-black bg-amber-100 text-amber-800 rounded px-1 min-w-[14px] text-center">{bulkSelectionCount}</span>
                 )}
               </button>
               <button
                 type="button"
                 onClick={() => setListDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                 className={`p-1.5 rounded-lg border flex items-center gap-1 ${listDensity === 'compact' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                 title={listDensity === 'compact' ? 'Switch to comfortable view (more spacing)' : 'Compact view – denser list'}
               >
                 <List size={14} /> <span className="text-[10px] font-bold uppercase">Compact</span>
               </button>
               <button
                 type="button"
                 onClick={() => exportInventoryToExcel(sortedItems)}
                 className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-1"
                 title="Export current view to Excel"
               >
                 <FileSpreadsheet size={14} /> <span className="text-[10px] font-bold uppercase">Excel</span>
               </button>
               <div className="flex gap-1">
                 <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Undo"><RotateCcw size={14} /></button>
                 <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Redo"><RotateCw size={14} /></button>
               </div>
               <button
                 type="button"
                 onClick={() => setShowNewItemModal(true)}
                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-emerald-700 transition-colors"
                 title="Add new inventory item (opens modal)"
               >
                 <Plus size={14} />
                 <span>Add Item</span>
               </button>
            </div>
            {hasActiveFilters && (
               <button type="button" onClick={clearAllFilters} className="text-[10px] font-bold uppercase text-slate-500 hover:text-red-600">Reset all</button>
            )}
         </div>

         {/* Active filter chips */}
         {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-1.5">
               {statusFilter !== 'ACTIVE' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                     {statusFilter} <button type="button" onClick={() => setStatusFilter('ACTIVE')} className="hover:opacity-80">×</button>
                  </span>
               )}
               {categoryFilter !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                     {categoryFilter}{subCategoryFilter ? ` / ${subCategoryFilter}` : ''} <button type="button" onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); setSpecFilters({}); setSpecRangeFilters({}); }} className="hover:opacity-80">×</button>
                  </span>
               )}
               {timeFilter !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                     {timeFilter} <button type="button" onClick={() => setTimeFilter('ALL')} className="hover:opacity-80">×</button>
                  </span>
               )}
               {statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS' && (salePlatformFilter !== 'ALL' || salePaymentFilter !== 'ALL') && (
                  <>
                     {salePlatformFilter !== 'ALL' && (
                       <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                         {salePlatformFilter === MISSING_PLATFORM_FILTER ? 'No platform' : salePlatformFilter}
                         <button type="button" onClick={() => setSalePlatformFilter('ALL')} className="hover:opacity-80">×</button>
                       </span>
                     )}
                     {salePaymentFilter !== 'ALL' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium truncate max-w-[120px]" title={salePaymentFilter}>{salePaymentFilter} <button type="button" onClick={() => setSalePaymentFilter('ALL')} className="hover:opacity-80">×</button></span>}
                     {isAmountFilterActive(amountFilter) && (
                       <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                         {amountFilterSummary(amountFilter)}
                         <button type="button" onClick={clearAmountFilter} className="hover:opacity-80">×</button>
                       </span>
                     )}
                  </>
               )}
               {Object.entries(specFilters).filter(([, v]) => v?.length).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-xs font-medium">
                     {k}: {v?.slice(0, 2).join(', ')}{(v?.length ?? 0) > 2 ? '…' : ''} <button type="button" onClick={() => setSpecFilters(prev => { const n = { ...prev }; delete n[k]; return n; })} className="hover:opacity-80">×</button>
                  </span>
               ))}
               {Object.entries(specRangeFilters).filter(([, r]) => r && (r.min !== undefined || r.max !== undefined)).map(([k, r]) => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-xs font-medium">
                     {k}: {r?.min ?? '?'}–{r?.max ?? '?'} <button type="button" onClick={() => setSpecRangeFilters(prev => { const n = { ...prev }; delete n[k]; return n; })} className="hover:opacity-80">×</button>
                  </span>
               ))}
            </div>
         )}

         {(statusFilter === 'SOLD' || splitView) && missingPlatformSoldCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] text-amber-950">
              <AlertTriangle size={12} className="text-amber-600 shrink-0" />
              <span><strong>{missingPlatformSoldCount}</strong> sold without platform</span>
              <button
                type="button"
                onClick={() => setSalePlatformFilter(MISSING_PLATFORM_FILTER)}
                className="ml-auto px-1.5 py-0.5 rounded bg-amber-200/80 font-bold hover:bg-amber-300/80"
              >
                Show
              </button>
            </div>
         )}

         <div className="space-y-2">
           <div className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0">Cat</span>
            {quickCategoryPins.map((pin) => {
              const active = isQuickCategoryPinActive(pin);
              return (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => applyQuickCategoryPin(pin)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:border-slate-300'
                  }`}
                  title={pin.subCategory ? `${pin.category} › ${pin.subCategory}` : pin.category}
                >
                  {pin.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowQuickCategoryPicker(true)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-dashed border-slate-300 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
              title="Add category shortcut"
              aria-label="Add category shortcut"
            >
              <Plus size={14} />
            </button>
           </div>

           {activeQuickPin && (
             <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-2.5 space-y-2">
               <div className="flex items-center justify-between gap-2">
                 <span className="text-[9px] font-black uppercase tracking-wider text-blue-700">
                   Narrow {activeQuickPin.label}
                 </span>
                 {hasActiveSpecFilters && (
                   <button
                     type="button"
                     onClick={clearQuickPinSpecFilters}
                     className="text-[9px] font-bold uppercase text-blue-600 hover:text-red-600 flex items-center gap-1"
                   >
                     <FilterX size={10} /> Clear specs
                   </button>
                 )}
               </div>
               {quickPinSpecOptions.length === 0 ? (
                 <p className="text-[10px] text-slate-500">
                   No key spec fields on {activeQuickPin.label} items yet — add specs like memory type, capacity, or speed to filter here.
                 </p>
               ) : (
                 <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                   {quickPinSpecOptions.map(({ key, values }) => {
                     const selected = specFilters[key] ?? [];
                     return (
                       <div key={key} className="flex flex-wrap items-center gap-1.5">
                         <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 shrink-0 min-w-[4.5rem]">
                           {key}
                         </span>
                         <div className="flex flex-wrap gap-1">
                           {values.map((val) => {
                             const isSelected = selected.some((s) => specValuesMatch(s, val));
                             return (
                               <button
                                 key={`${key}-${String(val)}`}
                                 type="button"
                                 onClick={() => toggleSpecFilterValue(key, val)}
                                 className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                                   isSelected
                                     ? 'bg-blue-600 text-white border-blue-600'
                                     : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                                 }`}
                               >
                                 {String(val)}
                               </button>
                             );
                           })}
                         </div>
                       </div>
                     );
                   })}
                 </div>
               )}
             </div>
           )}
         </div>
      </header>

      <InventoryAISpecsPanel
        open={showAISpecsModal}
        onClose={() => setShowAISpecsModal(false)}
        items={items}
        selectedIds={deferredSelectedIds}
        categoryFields={categoryFields ?? {}}
        onUpdate={(updated) => onUpdate(updated)}
      />

      <AddPhotosModal
        open={showBulkAddPhotosModal}
        onClose={closeAddPhotosModal}
        onApply={handleBulkAddPhotos}
        itemCount={addPhotosTargetIds.length}
        searchName={addPhotosTargetItems[0]?.name ?? ''}
        ebaySku={addPhotosTargetItems.length === 1 ? addPhotosTargetItems[0]?.ebaySku : undefined}
        storageItemId={addPhotosTargetItems.length === 1 ? addPhotosTargetItems[0]?.id : 'shared'}
      />

      {cardGenItem && (
        <ProductCardGeneratorModal
          item={cardGenItem}
          categoryFields={
            (categoryFields || {})[`${cardGenItem.category}:${cardGenItem.subCategory}`] ||
            (categoryFields || {})[cardGenItem.category]
          }
          onClose={() => setCardGenItem(null)}
          onApplyAsMainPhoto={handleApplyProductCardPhoto}
        />
      )}

      {/* Toast notification for quick actions (e.g. copy listing text) */}
      {toast && (
        <div className={`pointer-events-none fixed z-[180] ${selectedIds.length > 0 ? 'top-4 right-4' : 'bottom-6 right-6 max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))]'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900 text-white text-xs font-bold shadow-lg shadow-slate-900/30">
            <Check size={14} className="text-emerald-400" />
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* Mobile-friendly sold list (phones) */}
      {statusFilter === 'SOLD' && !splitView && (
        <div className="lg:hidden flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-4 space-y-3">
          {sortedItems.length === 0 ? (
            <div className="py-16 text-center opacity-40">
              <Package size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="font-bold text-slate-400 text-sm">No sold items match filters</p>
            </div>
          ) : (
            sortedItems.map((item) => {
              const userPhotoCount = getItemUserPhotoCount(item);
              const hasUserPhotos = userPhotoCount > 0;
              const parentContainer = resolveParentContainer(item, containersById, containerByChildId);
              const parentKind = getContainerKind(parentContainer);
              const showMembershipBadge = Boolean(parentKind && parentContainer && !item.isPC && !item.isBundle);
              const tradeReceived = resolveTradeReceivedItems(item, itemsById);
              const tradeSource = resolveTradeSourceItem(item, itemsById);
              const mobileChildItems = isInventoryContainer(item) ? getChildren(item, items) : [];
              const mobileSearchQuery = searchTerm.trim();
              const mobileSearchActive = mobileSearchQuery.length >= 2;
              const isSoldContainerRow =
                isInventoryContainer(item) && isRealizedDisposal(item) && mobileChildItems.length > 0;
              const isMobileBundleExpanded = isSoldContainerRow && expandedBundles.has(item.id);
              const mobileSoldTotals = isSoldContainerRow
                ? getSoldContainerDisplayTotals(item, items, businessSettings.taxMode)
                : null;
              const mobileDisplaySell = mobileSoldTotals?.sellPrice ?? item.sellPrice;
              const mobileDisplayProfit = mobileSoldTotals?.profit ?? profitForDisplay(item);
              const formatMobileChildDate = (child: InventoryItem) => {
                const raw = child.sellDate || child.containerSoldDate || child.buyDate;
                return raw ? new Date(raw).toLocaleDateString() : '—';
              };
              return (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 shadow-sm space-y-3 ${
                  item.isPC
                    ? 'bg-indigo-50/70 border-indigo-200 shadow-[inset_3px_0_0_0_#6366f1]'
                    : isSoldContainerRow
                      ? 'bg-violet-50/70 border-violet-200 shadow-[inset_3px_0_0_0_#8b5cf6]'
                      : 'bg-white border-slate-100'
                }`}
              >
                <div className="flex gap-3 items-start">
                  <div
                    className={`relative shrink-0 rounded-xl ${
                      hasUserPhotos ? 'ring-2 ring-emerald-500/45' : 'ring-1 ring-dashed ring-amber-400/80'
                    }`}
                  >
                    <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover border border-slate-100 shrink-0" size={48} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center ${
                        hasUserPhotos ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700 border border-amber-300'
                      }`}
                    >
                      {hasUserPhotos ? (userPhotoCount > 1 ? <span className="text-[8px] font-black">{userPhotoCount}</span> : <Camera size={8} />) : <ImageOff size={8} />}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                      {isSoldContainerRow && (
                        <button
                          type="button"
                          onClick={() => toggleBundleExpanded(item.id)}
                          className={`shrink-0 mt-0.5 p-0.5 rounded-md ${
                            item.isPC
                              ? 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100'
                              : 'text-violet-600 hover:text-violet-800 hover:bg-violet-100'
                          }`}
                          title={isMobileBundleExpanded ? 'Collapse contents' : 'Expand contents'}
                          aria-expanded={isMobileBundleExpanded}
                        >
                          {isMobileBundleExpanded ? (
                            <ChevronDown size={14} strokeWidth={2.75} />
                          ) : (
                            <ChevronRight size={14} strokeWidth={2.75} />
                          )}
                        </button>
                      )}
                      <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => handleEditClick(item)}
                        className={`font-black text-sm leading-snug text-left w-full ${
                        item.isPC ? 'text-indigo-950' : isSoldContainerRow ? 'text-violet-950' : 'text-slate-900'
                      }`}
                      >
                        {item.name}
                      </button>
                      {isSoldContainerRow && (
                        <span className={`mt-1 inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white ${
                          item.isPC ? 'bg-indigo-600' : 'bg-violet-600'
                        }`}>
                          {item.isPC ? <Monitor size={9} /> : <Layers size={9} />}
                          {item.isPC ? 'PC Build' : 'Bundle'} · {mobileChildItems.length}
                        </span>
                      )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                          hasUserPhotos ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'
                        }`}
                      >
                        {hasUserPhotos ? <><Camera size={8} /> {userPhotoCount > 1 ? `${userPhotoCount} photos` : 'Photo'}</> : <><ImageOff size={8} /> No photo</>}
                      </span>
                      <span>Sold {item.sellDate || '—'} · €{mobileDisplaySell != null ? formatEUR(mobileDisplaySell) : '—'}</span>
                      {mobileDisplayProfit != null && (
                        <span className={(mobileDisplayProfit ?? 0) >= 0 ? ' text-emerald-600' : ' text-red-600'}>
                          {' '}· {(mobileDisplayProfit ?? 0) >= 0 ? '+' : ''}€{formatEUR(mobileDisplayProfit!)}
                        </span>
                      )}
                    </p>
                    {(item.customer?.name || item.ebayUsername) && (
                      <p className="text-[10px] text-slate-500 mt-1 truncate">
                        {item.customer?.name}{item.ebayUsername ? ` · ${item.ebayUsername}` : ''}
                      </p>
                    )}
                    {showMembershipBadge && parentKind && parentContainer && (
                      <div className="mt-2">
                        <ContainerMembershipBadge
                          kind={parentKind}
                          parentName={parentContainer.name}
                          onOpen={() => openParentContainer(parentContainer)}
                          onLocate={() => focusContainerInList(parentContainer)}
                        />
                      </div>
                    )}
                    {(tradeReceived.length > 0 || tradeSource) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tradeReceived.length > 0 && (
                          <TradeLinkBadge
                            variant="outgoing"
                            receivedItems={tradeReceived}
                            onLocateItem={focusTradeLinkedItem}
                            onOpenItem={openTradeLinkedItem}
                          />
                        )}
                        {tradeSource && (
                          <TradeLinkBadge
                            variant="incoming"
                            sourceItem={tradeSource}
                            onLocate={() => focusTradeLinkedItem(tradeSource)}
                            onOpen={() => openTradeLinkedItem(tradeSource)}
                          />
                        )}
                      </div>
                    )}
                    {isContainerMember(item) && !showMembershipBadge && (
                      <div className="mt-2">
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase">
                          In composition
                        </span>
                      </div>
                    )}
                    {isMobileBundleExpanded && (
                      <div className={`mt-2 pl-3 border-l-2 rounded-r-lg py-1 space-y-0.5 ${
                        item.isPC
                          ? 'border-indigo-300 bg-indigo-50/70'
                          : 'border-violet-300 bg-violet-50/70'
                      }`}>
                        {mobileChildItems.map((child) => {
                          const childHit =
                            mobileSearchActive && matchesInventorySearch(child, mobileSearchQuery);
                          return (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => handleEditClick(child)}
                            className="w-full text-left"
                          >
                            <div
                              className={`flex items-center justify-between gap-2 py-1 px-2 rounded-md ${
                                childHit ? 'bg-amber-100/80 ring-1 ring-amber-200/80' : 'active:bg-purple-100/60'
                              }`}
                            >
                              <span className="text-[11px] font-medium text-slate-700 truncate">{child.name}</span>
                              <span className="text-[10px] font-semibold text-slate-500 shrink-0 tabular-nums">
                                {formatMobileChildDate(child)}
                              </span>
                            </div>
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[9px] font-black uppercase text-slate-400 w-full">Sold on</label>
                  {isMissingExplicitSalePlatform(item) ? (
                    <SalePlatformQuickPickButtons
                      onPick={(platform) => handleQuickPlatformChange(item, platform)}
                    />
                  ) : (
                    <select
                      value={item.platformSold || ''}
                      onChange={(e) => handleQuickPlatformChange(item, e.target.value as Platform | '')}
                      className="text-xs font-bold rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 flex-1 min-w-[8rem]"
                    >
                      <option value="">—</option>
                      {SALE_PLATFORM_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { addRecentItemId(item.id); setItemToEditBuyer(item); }}
                    className="flex-1 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-800 text-[10px] font-black uppercase"
                  >
                    Buyer
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditClick(item)}
                    className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => { addRecentItemId(item.id); setInvoiceViewItem(item); }}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-black uppercase"
                  >
                    Invoice
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>
      )}

      {/* Table scrolls in remaining height; bulk bar is a separate row below (never overlays rows) */}
      <style>{`
        [data-inventory-table] tbody > tr > td { padding: 0.28rem 0.75rem !important; vertical-align: top !important; text-align: left !important; }
        [data-inventory-table] tbody > tr > td.inv-col-icons { padding: 0.25rem 0.5rem !important; }
        [data-inventory-table] thead th > div:first-of-type { padding: 0.28rem 0.75rem !important; min-height: 1.65rem !important; }
        [data-inventory-table] thead th { font-size: 0.625rem; letter-spacing: 0.04em; text-align: left; }
        [data-density="compact"][data-inventory-table] tbody > tr > td { padding: 0.16rem 0.625rem !important; }
        [data-density="compact"][data-inventory-table] tbody > tr > td.inv-col-icons { padding: 0.14rem 0.45rem !important; }
        [data-density="compact"][data-inventory-table] thead th > div:first-of-type { padding: 0.16rem 0.625rem !important; min-height: 1.35rem !important; }
        [data-density="compact"] .text-sm { font-size: 0.6875rem; line-height: 1.2; }
        [data-density="compact"] .text-xs { font-size: 0.625rem; line-height: 1.2; }
        [data-density="comfortable"] .text-sm { line-height: 1.25; }
      `}</style>
      {splitView ? (
        <div className="flex flex-1 min-h-0 gap-2 flex-col lg:flex-row">
          <InventoryListTablePane
            key="split-active"
            paneItems={sortedActiveItems}
            paneStatus="ACTIVE"
            paneLabel="Active"
            scrollRef={activeTableRef}
            visibleColumns={visibleColumns}
            columnWidths={effectiveColumnWidths}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onSelectAll={() => handleSelectAllFor(sortedActiveItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            highlightedItemId={highlightedItemId}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={selectedIds.length > 0}
            expandedBundles={expandedBundles}
          />
          <InventoryListTablePane
            key="split-sold"
            paneItems={sortedSoldItems}
            paneStatus="SOLD"
            paneLabel="Sold"
            paneExtra={
              financialStats ? (
                <SoldFinancialBar
                  stats={financialStats}
                  taxMode={businessSettings.taxMode}
                  businessSettings={businessSettings}
                  onBusinessSettingsChange={onBusinessSettingsChange}
                  compact
                />
              ) : null
            }
            scrollRef={soldTableRef}
            visibleColumns={visibleColumns}
            columnWidths={effectiveColumnWidths}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onSelectAll={() => handleSelectAllFor(sortedSoldItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            highlightedItemId={highlightedItemId}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={selectedIds.length > 0}
            expandedBundles={expandedBundles}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 min-w-0 flex-col">
        <InventoryListTablePane
          key={`single-${statusFilter}`}
          paneItems={sortedItems}
          paneStatus={statusFilter}
          scrollRef={tableContainerRef}
          visibleColumns={visibleColumns}
          columnWidths={effectiveColumnWidths}
          listDensity={listDensity}
          sortConfig={sortConfig}
          handleHeaderSort={handleHeaderSort}
          handleColumnResizeStart={handleColumnResizeStart}
          onSelectAll={handleSelectAll}
          selectedIdSet={selectedIdSet}
          renderRowCells={renderRowCells}
          getRowActivityKey={getRowActivityKey}
          highlightedItemId={highlightedItemId}
          rowHeightEstimate={rowHeightEstimate}
          bulkBarSpacer={selectedIds.length > 0}
          expandedBundles={expandedBundles}
          className={statusFilter === 'SOLD' ? 'hidden lg:flex flex-1' : 'flex flex-1'}
        />
        </div>
      )}

      <div className="shrink-0 w-full">
        <BulkSelectionBar
          count={bulkSelectionCount}
          onClear={() => startTransition(() => setSelectedIds([]))}
          actions={bulkActions}
        />
      </div>

      {/* MODALS */}
      {itemToEdit && (
         <EditItemModal
            item={itemToEdit}
            items={items}
            onSave={(updatedList) => {
               onUpdate(updatedList);
               setItemToEdit(null); 
            }}
            onClose={() => setItemToEdit(null)}
            categories={categories}
            categoryFields={categoryFields} // Pass prop
            onAddCategory={() => {}}
            parentContainer={resolveParentContainer(itemToEdit, containersById, containerByChildId)}
            onOpenParentContainer={openParentContainer}
            onLocateParentContainer={focusContainerInList}
            onLocateTradeItem={(target) => {
              setItemToEdit(null);
              focusTradeLinkedItem(target);
            }}
            onOpenTradeItem={openTradeLinkedItem}
         />
      )}

      {showQuickCategoryPicker && (
        <QuickCategoryPinPickerModal
          categories={categories}
          pins={quickCategoryPins}
          onAdd={(category, subCategory, label) => {
            addQuickCategoryPin(category, subCategory, label);
          }}
          onRemove={removeQuickCategoryPin}
          onReset={resetQuickCategoryPins}
          onClose={() => setShowQuickCategoryPicker(false)}
        />
      )}

      {showNewItemModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-slate-50 w-full max-w-6xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-[min(88vh,820px)] relative">
            <button
              onClick={() => setShowNewItemModal(false)}
              className="absolute top-4 right-4 z-50 p-2 bg-white rounded-full shadow-lg text-slate-400 hover:text-slate-900 hover:scale-110 transition-all"
            >
              <X size={18} />
            </button>
            <div className="flex-1 overflow-hidden p-4 md:p-5">
              <ItemForm
                items={items}
                onSave={(created) => {
                  onUpdate(created);
                  setShowNewItemModal(false);
                  const first = created[0];
                  if (first) {
                    revealItemInList(first);
                    setCategoryFilter(first.category);
                    setSubCategoryFilter(first.subCategory ?? '');
                    setSearchTerm('');
                  }
                }}
                categories={categories}
                categoryFields={categoryFields}
                onAddCategory={() => {}}
                isModal={true}
              />
            </div>
          </div>
        </div>
      )}

      {showRetroBundle && (
         <RetroBundleModal 
            items={items.filter(i => selectedIds.includes(i.id))}
            onConfirm={handleCreateRetroBundle}
            onClose={() => setShowRetroBundle(false)}
         />
      )}

      {showBulkSalesEdit && (
         <BulkSalesEditModal 
            count={selectedIds.length}
            onConfirm={handleBulkEditSales}
            onClose={() => setShowBulkSalesEdit(false)}
         />
      )}

      {itemToEditCategory && (
         <CategoryPickerModal 
            initialCategory={itemToEditCategory.category}
            categories={categories}
            onSave={(cat, sub) => {
               onUpdate([{ ...itemToEditCategory, category: cat, subCategory: sub }]);
               setItemToEditCategory(null);
            }}
            onClose={() => setItemToEditCategory(null)}
         />
      )}

      {showBulkCategoryEdit && (
         <CategoryPickerModal 
            categories={categories}
            initialCategory={selectedIds.length === 1 ? items.find(i => i.id === selectedIds[0])?.category : undefined}
            onSave={handleBulkCategorySave}
            onClose={() => setShowBulkCategoryEdit(false)}
         />
      )}

      {showBulkStoreVisible && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
            <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full">
               <h3 className="text-lg font-black text-slate-900 mb-3">Store visible ({selectedIds.length} items)</h3>
               <p className="text-sm text-slate-500 mb-4">Show or hide selected items on the storefront.</p>
               <div className="flex gap-2">
                  <button onClick={() => handleBulkStoreVisible(true)} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700">Show on store</button>
                  <button onClick={() => handleBulkStoreVisible(false)} className="flex-1 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300">Hide</button>
               </div>
               <button onClick={() => setShowBulkStoreVisible(false)} className="w-full mt-3 py-2 text-slate-500 text-sm font-medium hover:text-slate-700">Cancel</button>
            </div>
         </div>
      )}

      {showBulkSalePct && (
         <BulkSalePctModal
            count={selectedIds.length}
            onApply={handleBulkSalePct}
            onClose={() => setShowBulkSalePct(false)}
         />
      )}

      {showBulkTag && (
         <BulkTagModal
            count={selectedIds.length}
            onApply={handleBulkTag}
            onClose={() => setShowBulkTag(false)}
         />
      )}

      {priceSuggestModalItem && createPortal(
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4" onClick={closePriceSuggestModal}>
            <div 
               className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
               onClick={e => e.stopPropagation()}
            >
               <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-2">
                     <Tag size={18} className="text-amber-500"/>
                     <h3 className="font-black text-slate-900 text-sm">eBay Sold Price • {priceSuggestModalItem.name}</h3>
                  </div>
                  <button onClick={closePriceSuggestModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
               </div>
               <div className="p-4 max-h-[70vh] overflow-y-auto">
                  {priceSuggestId === priceSuggestModalItem.id ? (
                     <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
                        <Loader2 size={32} className="animate-spin text-amber-500"/>
                        <p className="text-xs font-bold">Searching eBay.de sold listings...</p>
                     </div>
                  ) : priceSuggestError ? (
                     <div className="py-4 flex items-start gap-3">
                        <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5"/>
                        <p className="text-sm text-red-700">{priceSuggestError}</p>
                     </div>
                  ) : priceSuggestResult ? (
                     <div className="space-y-4">
                        <div className="flex justify-between items-end">
                           <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase">€{formatEUR(Number(priceSuggestResult.priceLow))} – €{formatEUR(Number(priceSuggestResult.priceHigh))}</p>
                              <p className="text-2xl font-black text-emerald-600">€{formatEUR(Number(priceSuggestResult.priceAverage))}</p>
                           </div>
                           <a href={ebaySoldSearchUrl(priceSuggestModalItem.name)} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1">
                              eBay.de <ArrowRight size={12}/>
                           </a>
                        </div>
                        <div className="h-2 bg-slate-200 rounded-full relative overflow-hidden">
                           <div className="absolute inset-0 bg-gradient-to-r from-emerald-300 to-emerald-600 opacity-30"/>
                           <div 
                              className="absolute top-0 bottom-0 w-1.5 bg-slate-900 rounded-full -translate-x-1/2"
                              style={{ left: `${Math.min(100, Math.max(0, ((priceSuggestResult.priceAverage - priceSuggestResult.priceLow) / (priceSuggestResult.priceHigh - priceSuggestResult.priceLow || 1)) * 100))}%` }}
                           />
                        </div>
                        <p className="text-[11px] text-slate-500 italic">{priceSuggestResult.reasoning}</p>
                        <p className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">AI estimate – verify on eBay. Click a listing to search for that exact title.</p>
                        {priceSuggestResult.soldExamples.length > 0 && (
                           <div>
                              <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Sold Listings</p>
                              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                 {priceSuggestResult.soldExamples.map((ex, idx) => (
                                    <a key={idx} href={ebaySoldSearchUrl(ex.title || priceSuggestModalItem.name)} target="_blank" rel="noopener noreferrer" className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg hover:bg-amber-50 text-left group" title="Search for this exact listing on eBay sold">
                                       <span className="text-[11px] font-medium text-slate-700 truncate flex-1 mr-2">{ex.title}</span>
                                       <span className="text-xs font-black text-slate-900 shrink-0">€{formatEUR(Number(ex.price))}</span>
                                    </a>
                                 ))}
                              </div>
                           </div>
                        )}
                        <div className="flex gap-2 pt-2">
                           <button 
                              onClick={() => applyPriceSuggestionAsSellPrice(priceSuggestModalItem, priceSuggestResult.priceAverage)}
                              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700"
                           >
                              Apply €{formatEUR(Number(priceSuggestResult.priceAverage))} as sell price
                           </button>
                           <button 
                              onClick={() => savePriceSuggestionAsNote(priceSuggestModalItem, priceSuggestResult)}
                              className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
                           >
                              Save as note
                           </button>
                        </div>
                     </div>
                  ) : null}
               </div>
            </div>
         </div>,
         document.body
      )}

      {ebayPriceModalItem && createPortal(
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4" onClick={closeEbayPriceModal}>
            <div
               className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
               onClick={(e) => e.stopPropagation()}
            >
               <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-2 min-w-0">
                     <ShoppingBag size={18} className="text-blue-600 shrink-0"/>
                     <h3 className="font-black text-slate-900 text-sm truncate">eBay live price • {ebayPriceModalItem.name}</h3>
                  </div>
                  <button onClick={closeEbayPriceModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl shrink-0"><X size={18}/></button>
               </div>
               <div className="p-4 max-h-[70vh] overflow-y-auto">
                  {ebayPriceLoading ? (
                     <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
                        <Loader2 size={32} className="animate-spin text-blue-600"/>
                        <p className="text-xs font-bold">Matching your eBay listings…</p>
                     </div>
                  ) : ebayPriceError ? (
                     <div className="py-4 flex items-start gap-3">
                        <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5"/>
                        <p className="text-sm text-red-700">{ebayPriceError}</p>
                     </div>
                  ) : ebayPriceMatch ? (
                     <div className="space-y-4">
                        <div>
                           <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Matched listing</p>
                           {ebayPriceMatch.listingUrl ? (
                              <a
                                 href={ebayPriceMatch.listingUrl}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="text-sm font-bold text-blue-600 hover:underline line-clamp-2"
                              >
                                 {ebayPriceMatch.title}
                              </a>
                           ) : (
                              <p className="text-sm font-bold text-slate-800 line-clamp-2">{ebayPriceMatch.title}</p>
                           )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                           <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                              <p className="text-[10px] font-black uppercase text-slate-400">eBay price</p>
                              <p className="text-xl font-black text-slate-700">€{formatEUR(ebayPriceMatch.rawPrice)}</p>
                           </div>
                           <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                              <p className="text-[10px] font-black uppercase text-emerald-600">Rounded to .99</p>
                              <p className="text-xl font-black text-emerald-700">€{formatEUR(ebayPriceMatch.roundedPrice)}</p>
                           </div>
                        </div>
                        {ebayPriceModalItem.storePrice != null && (
                           <p className="text-xs text-slate-500">
                              Current storefront price: <span className="font-bold text-slate-800">€{formatEUR(ebayPriceModalItem.storePrice)}</span>
                           </p>
                        )}
                        {ebayPriceMatch.rawPrice !== ebayPriceMatch.roundedPrice && (
                           <p className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
                              Cents adjusted from {formatEUR(ebayPriceMatch.rawPrice).replace('.', ',')} to ,99
                           </p>
                        )}
                        <div className="flex gap-2 pt-1">
                           <button
                              type="button"
                              onClick={() => applyEbayListingPrice(ebayPriceModalItem, ebayPriceMatch.roundedPrice, ebayPriceMatch)}
                              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700"
                           >
                              Apply €{formatEUR(ebayPriceMatch.roundedPrice)} as storefront price
                           </button>
                           <button
                              type="button"
                              onClick={closeEbayPriceModal}
                              className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
                           >
                              Cancel
                           </button>
                        </div>
                     </div>
                  ) : null}
               </div>
            </div>
         </div>,
         document.body
      )}

      {orderLookupItem && createPortal(
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4" onClick={closeOrderLookupModal}>
            <div
               className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
               onClick={(e) => e.stopPropagation()}
            >
               <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-2 min-w-0">
                     <Receipt size={18} className="text-indigo-600 shrink-0"/>
                     <h3 className="font-black text-slate-900 text-sm truncate">eBay order lookup • {orderLookupItem.name}</h3>
                  </div>
                  <button onClick={closeOrderLookupModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl shrink-0"><X size={18}/></button>
               </div>
               <div className="p-4 max-h-[70vh] overflow-y-auto space-y-3">
                  {orderLookupMatches.length === 0 ? (
                     <div className="py-6 text-center space-y-3">
                        <AlertCircle size={28} className="mx-auto text-slate-300"/>
                        <p className="text-sm font-bold text-slate-600">No cached orders match this item.</p>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto">
                           Run an API backfill or import a Seller Hub CSV in <span className="font-bold text-slate-600">eBay Store Pull → Sales sync</span>, then try again.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                           <button
                              type="button"
                              onClick={() => { closeOrderLookupModal(); navigate('/panel/ebay-store-pull?tab=orders'); }}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700"
                           >
                              Open order history tool
                           </button>
                           <button
                              type="button"
                              onClick={() => {
                                 const target = orderLookupItem;
                                 closeOrderLookupModal();
                                 if (target) {
                                    addRecentItemId(target.id);
                                    setItemToEditBuyer(target);
                                 }
                              }}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-800 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100"
                           >
                              <User size={12} />
                              Enter manually
                           </button>
                        </div>
                     </div>
                  ) : (
                     orderLookupMatches.slice(0, 8).map((match) => {
                        const { order, lineItem, matchScore, matchKind } = match;
                        const gross = lineItem.lineItemCost ?? order.grossTotal ?? null;
                        const net = order.netTotal ?? null;
                        return (
                           <div key={`${order.orderId}-${lineItem.sku || lineItem.title}`} className="rounded-xl border border-slate-200 p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                 <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 line-clamp-2">{lineItem.title}</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">Order {order.orderId} · {order.creationDate || 'date unknown'}</p>
                                 </div>
                                 <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap ${
                                    matchKind === 'listingId' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                    matchKind === 'sku' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                                    'bg-amber-50 text-amber-700 border border-amber-100'
                                 }`}>
                                    {matchKind === 'listingId' ? 'Listing match' : matchKind === 'sku' ? 'SKU match' : `Title match ${matchScore}`}
                                 </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                 <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                                    <p className="text-[9px] font-black uppercase text-slate-400">Buyer</p>
                                    <p className="font-bold text-slate-800 truncate">{order.buyer.fullName || order.buyer.username || '—'}</p>
                                    {order.buyer.address && <p className="text-slate-500 whitespace-pre-line text-[10px] mt-0.5 line-clamp-3">{order.buyer.address}</p>}
                                 </div>
                                 <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                                    <p className="text-[9px] font-black uppercase text-slate-400">Price</p>
                                    {gross != null && <p className="font-bold text-slate-800">Gross €{formatEUR(gross)}</p>}
                                    {net != null ? (
                                       <p className="font-black text-emerald-700">Net €{formatEUR(net)}</p>
                                    ) : (
                                       <p className="text-[10px] text-slate-400">Net unknown (import CSV for fees)</p>
                                    )}
                                 </div>
                              </div>
                              <button
                                 type="button"
                                 onClick={() => applyOrderMatchToItem(orderLookupItem, match)}
                                 className="w-full py-2 bg-emerald-600 text-white rounded-lg text-[11px] font-black hover:bg-emerald-700"
                              >
                                 Apply order to this item
                              </button>
                           </div>
                        );
                     })
                  )}
               </div>
            </div>
         </div>,
         document.body
      )}

      {itemToSell && (
         <SaleModal 
            item={itemToSell} 
            taxMode={businessSettings.taxMode}
            mode="sell"
            onSave={(updated, splitOff) => { 
               // When selling a PC or bundle, also stamp all child components
               // with the container's sale date. Child items keep their original buyDate.
               const childComponents =
                 updated.isPC || updated.isBundle ? resolveContainerChildItems(updated, items) : [];
               if (childComponents.length > 0) {
                 // Use the bundle/PC's sell date value for all child items
                 const soldAt = updated.sellDate || new Date().toISOString().split('T')[0];
                 const bundleSellPrice = updated.sellPrice || 0;
                 const bundleFee = updated.feeAmount || 0;
                 
                 // Calculate proportional sell prices based on buy price ratios
                 const totalChildBuyPrice = childComponents.reduce((sum, i) => sum + (i.buyPrice || 0), 0);
                 
                 const updatedChildren = childComponents.map(i => {
                   const childBuyPrice = i.buyPrice || 0;
                   
                   // Calculate proportional sell price: (item buy price / total buy price) * bundle sell price
                   const proportionalSellPrice = totalChildBuyPrice > 0 
                     ? (childBuyPrice / totalChildBuyPrice) * bundleSellPrice
                     : bundleSellPrice / childComponents.length; // Fallback: equal split if no buy prices
                   
                   // Allocate fee proportionally too (optional, but makes sense)
                   const proportionalFee = totalChildBuyPrice > 0
                     ? (childBuyPrice / totalChildBuyPrice) * bundleFee
                     : bundleFee / childComponents.length;
                   
                   // Calculate profit for this child item
                   const childProfit = proportionalSellPrice - childBuyPrice - proportionalFee;
                   
                   return {
                     ...i,
                     sellDate: soldAt,
                     sellPrice: Math.round(proportionalSellPrice * 100) / 100, // Round to 2 decimals
                     feeAmount: Math.round(proportionalFee * 100) / 100,
                     hasFee: proportionalFee > 0,
                     profit: Math.round(childProfit * 100) / 100,
                     status: ItemStatus.SOLD,
                     containerSoldDate: soldAt,
                     platformSold: updated.platformSold,
                     paymentType: updated.paymentType,
                     ebayOrderId: updated.ebayOrderId ?? i.ebayOrderId,
                     ebayUsername: updated.ebayUsername ?? i.ebayUsername,
                     customer: updated.customer ?? i.customer,
                     // Keep original buyDate - don't overwrite it
                   };
                 });
                 
                 // Bundle/PC itself should have profit set to 0 (or undefined) - profit only exists in child items
                 const updatedContainer = {
                   ...updated,
                   profit: 0, // No profit on container - only child items have profit
                 };
                 
                 onUpdate([updatedContainer, ...updatedChildren]);
               } else if (splitOff) {
                 onUpdate([updated, splitOff]);
               } else {
                 onUpdate([updated]); 
               }
               setItemToSell(null); 
            }} 
            onClose={() => setItemToSell(null)} 
         />
      )}

      {itemToEditBuyer && (
         <SaleModal
            item={itemToEditBuyer}
            taxMode={businessSettings.taxMode}
            mode="editBuyer"
            onSave={(updated) => {
              onUpdate([updated]);
              setItemToEditBuyer(null);
            }}
            onClose={() => setItemToEditBuyer(null)}
         />
      )}

      {itemToReturn && (
         <ReturnModal
            items={[itemToReturn]}
            onConfirm={(updatedItems) => {
               onUpdate(updatedItems);
               setItemToReturn(null);
            }}
            onClose={() => setItemToReturn(null)}
         />
      )}
      {invoiceViewItem && (
         <InvoiceView
            item={invoiceViewItem}
            business={businessSettings}
            onClose={() => setInvoiceViewItem(null)}
         />
      )}

      {itemToTrade && (
         <TradeModal 
            item={itemToTrade}
            categoryFields={categoryFields}
            onSave={(updatedOriginal, newItems) => {
               onUpdate([updatedOriginal, ...newItems]);
               setItemToTrade(null);
            }}
            onClose={() => setItemToTrade(null)}
         />
      )}

      {itemToGift && (
         <GiftModal
            item={itemToGift}
            taxMode={businessSettings.taxMode}
            onSave={(updated) => {
               onUpdate([updated]);
               setItemToGift(null);
            }}
            onClose={() => setItemToGift(null)}
         />
      )}

      {itemToCrossPost && (
         <CrossPostingModal 
            item={itemToCrossPost}
            onClose={() => setItemToCrossPost(null)}
         />
      )}

      {bundleToDismantle && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
            <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-sm text-center">
               <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600">
                  <BoxSelect size={24}/>
               </div>
               <h3 className="text-xl font-black text-slate-900 mb-2">Unbundle Asset?</h3>
               <p className="text-sm text-slate-500 mb-2">"{bundleToDismantle.name}" will be deleted.</p>
               <p className="text-xs text-slate-400 mb-6 font-medium">
                  {isRealizedDisposal(bundleToDismantle) || bundleToDismantle.subCategory === 'Retro Bundle'
                    ? 'Components will be restored to Sales History.' 
                    : 'Components will return to Active Inventory.'}
               </p>
               <div className="mb-6 p-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-600">
                  {items.filter(i => (bundleToDismantle.componentIds && bundleToDismantle.componentIds.includes(i.id)) || i.parentContainerId === bundleToDismantle.id).length} Components Restored
               </div>
               <div className="flex gap-3">
                  <button onClick={() => setBundleToDismantle(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200">Cancel</button>
                  <button onClick={handleConfirmDismantle} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-200 hover:bg-amber-600">Confirm Unbundle</button>
               </div>
            </div>
         </div>
      )}

      {itemToDelete && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
            <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-sm text-center">
               <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                  <Trash2 size={24}/>
               </div>
               <h3 className="text-xl font-black text-slate-900 mb-2">Delete Item?</h3>
               <p className="text-sm text-slate-500 mb-6">"{itemToDelete.name}" will be moved to trash.</p>
               <div className="flex gap-3">
                  <button onClick={() => setItemToDelete(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold">Cancel</button>
                  <button onClick={() => handleDeleteItem(itemToDelete)} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-200">Delete</button>
               </div>
            </div>
         </div>
      )}

      {showBulkDeleteConfirm && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
            <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-sm text-center">
               <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                  <Trash2 size={24}/>
               </div>
               <h3 className="text-xl font-black text-slate-900 mb-2">Delete {selectedIds.length} Items?</h3>
               <p className="text-sm text-slate-500 mb-6">Selected items will be moved to trash.</p>
               <div className="flex gap-3">
                  <button onClick={() => setShowBulkDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200">Cancel</button>
                  <button onClick={handleBulkDelete} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-200 hover:bg-red-600">Delete All</button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

/** Below this count, native table scrolling is smoother than virtualized absolute rows. */
const INVENTORY_VIRTUAL_THRESHOLD = 100;

const SalePlatformQuickPickButtons: React.FC<{
  dense?: boolean;
  onPick: (platform: Platform) => void;
}> = ({ dense, onPick }) => {
  const btn = dense ? 'h-6 w-6' : 'h-7 w-7';
  const iconSize = dense ? 11 : 13;
  const stroke = 2.25;

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Quick set sale platform">
      <button
        type="button"
        title="eBay"
        aria-label="Mark sold on eBay"
        onClick={() => onPick('ebay.de')}
        className={`${btn} flex items-center justify-center rounded-lg border border-blue-300 bg-gradient-to-b from-blue-50 to-blue-100/90 hover:from-blue-100 hover:to-blue-200 shadow-sm transition-colors text-[#0064D2]`}
      >
        <Gavel size={iconSize} strokeWidth={stroke} aria-hidden />
      </button>
      <button
        type="button"
        title="Kleinanzeigen"
        aria-label="Mark sold on Kleinanzeigen"
        onClick={() => onPick('kleinanzeigen.de')}
        className={`${btn} flex items-center justify-center rounded-lg border border-emerald-400 bg-gradient-to-b from-emerald-50 to-lime-50 hover:from-emerald-100 hover:to-lime-100 shadow-sm transition-colors text-emerald-700`}
      >
        <Megaphone size={iconSize} strokeWidth={stroke} aria-hidden />
      </button>
      <button
        type="button"
        title="In person (pickup / cash)"
        aria-label="Mark sold in person"
        onClick={() => onPick('In Person')}
        className={`${btn} flex items-center justify-center rounded-lg border border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-200 shadow-sm transition-colors text-slate-700`}
      >
        <Handshake size={iconSize} strokeWidth={stroke} aria-hidden />
      </button>
    </div>
  );
};

type InventoryTableBodyProps = {
  sortedItems: InventoryItem[];
  selectedIdSet: Set<string>;
  visibleColumns: ColumnId[];
  renderRowCells: (item: InventoryItem, isSelected: boolean) => React.ReactNode;
  getRowActivityKey: (item: InventoryItem) => string;
  highlightedItemId: string | null;
  scrollElement: HTMLDivElement | null;
  rowHeightEstimate: number;
  bulkBarSpacer: boolean;
  expandedBundles: Set<string>;
};

const InventoryTableBody = React.memo(function InventoryTableBody({
  sortedItems,
  selectedIdSet,
  visibleColumns,
  renderRowCells,
  getRowActivityKey,
  highlightedItemId,
  scrollElement,
  rowHeightEstimate,
  bulkBarSpacer,
  expandedBundles,
}: InventoryTableBodyProps) {
  const useVirtual = sortedItems.length > INVENTORY_VIRTUAL_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => {
      const item = sortedItems[index];
      if (!item) return rowHeightEstimate;
      let h = rowHeightEstimate;
      if (item.specs && Object.keys(item.specs).length > 0) h += 14;
      if (
        isRealizedDisposal(item) &&
        (item.customer?.name || item.giftRecipient || item.ebayUsername || item.ebayOrderId)
      ) {
        h += 16;
      }
      if ((item.tradedForIds?.length ?? 0) > 0 || item.tradedFromId) {
        h += 22;
      }
      if (item.parentContainerId || item.status === ItemStatus.IN_COMPOSITION) h += 22;
      if (expandedBundles.has(item.id) && (item.isPC || item.isBundle)) {
        const childCount = Math.max(1, item.componentIds?.length ?? 3);
        h += childCount * 28 + 20;
      }
      return h;
    },
    overscan: 5,
    getItemKey: (index) => sortedItems[index]?.id ?? index,
  });

  useLayoutEffect(() => {
    if (!useVirtual || !scrollElement) return;
    rowVirtualizer.measure();
    const ro = new ResizeObserver(() => rowVirtualizer.measure());
    ro.observe(scrollElement);
    return () => ro.disconnect();
  }, [scrollElement, useVirtual, sortedItems, rowVirtualizer, expandedBundles]);

  if (sortedItems.length === 0) {
    return (
      <tbody className="divide-y divide-slate-50">
        <tr>
          <td colSpan={visibleColumns.length} className="p-20 text-center opacity-40">
            <Package size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="font-bold text-slate-400">No items found matching current filters</p>
          </td>
        </tr>
      </tbody>
    );
  }

  if (!useVirtual) {
    return (
      <tbody className="divide-y divide-slate-50">
        {sortedItems.map((item) => (
          <InventoryTableRow
            key={item.id}
            item={item}
            isSelected={selectedIdSet.has(item.id)}
            visibleColumns={visibleColumns}
            renderRowCells={renderRowCells}
            rowActivityKey={getRowActivityKey(item)}
            highlighted={highlightedItemId === item.id}
          />
        ))}
        {bulkBarSpacer && (
          <tr aria-hidden="true" className="pointer-events-none border-0">
            <td colSpan={visibleColumns.length} className="!p-0 !border-0 h-24 lg:h-28" />
          </tr>
        )}
      </tbody>
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const topSpacer = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const bottomSpacer =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <tbody className="divide-y divide-slate-50">
      {topSpacer > 0 && (
        <tr aria-hidden="true" className="pointer-events-none border-0">
          <td colSpan={visibleColumns.length} className="!p-0 !border-0" style={{ height: `${topSpacer}px` }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => {
        const item = sortedItems[virtualRow.index]!;
        return (
          <InventoryTableRow
            key={item.id}
            item={item}
            isSelected={selectedIdSet.has(item.id)}
            visibleColumns={visibleColumns}
            renderRowCells={renderRowCells}
            rowActivityKey={getRowActivityKey(item)}
            highlighted={highlightedItemId === item.id}
            virtualIndex={virtualRow.index}
            measureRef={rowVirtualizer.measureElement}
          />
        );
      })}
      {bottomSpacer > 0 && (
        <tr aria-hidden="true" className="pointer-events-none border-0">
          <td colSpan={visibleColumns.length} className="!p-0 !border-0" style={{ height: `${bottomSpacer}px` }} />
        </tr>
      )}
      {bulkBarSpacer && (
        <tr aria-hidden="true" className="pointer-events-none border-0">
          <td colSpan={visibleColumns.length} className="!p-0 !border-0 h-24 lg:h-28" />
        </tr>
      )}
    </tbody>
  );
});

type InventoryTableRowProps = {
  item: InventoryItem;
  isSelected: boolean;
  visibleColumns: ColumnId[];
  renderRowCells: (item: InventoryItem, isSelected: boolean) => React.ReactNode;
  /** Bumps when inline edit / AI spinners affect this row so memo does not skip updates. */
  rowActivityKey: string;
  highlighted?: boolean;
  virtualIndex?: number;
  measureRef?: (node: Element | null) => void;
};

const InventoryTableRow = React.memo(
  function InventoryTableRow({ item, isSelected, renderRowCells, highlighted, virtualIndex, measureRef }: InventoryTableRowProps) {
    return (
      <tr
        ref={measureRef}
        data-index={virtualIndex}
        data-inventory-item-id={item.id}
        data-container={isInventoryContainer(item) ? (item.isPC ? 'pc' : 'bundle') : undefined}
        className={containerRowClassName(item, isSelected, Boolean(highlighted))}
      >
        {renderRowCells(item, isSelected)}
      </tr>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.isSelected === next.isSelected &&
    prev.visibleColumns === next.visibleColumns &&
    prev.rowActivityKey === next.rowActivityKey &&
    prev.highlighted === next.highlighted &&
    prev.renderRowCells === next.renderRowCells
);

type SoldFinancialBarProps = {
  stats: {
    totalGross: number;
    totalTax: number;
    totalNetRevenue: number;
    totalProfit: number;
    cashMargin: number;
  };
  taxMode: TaxMode;
  businessSettings: BusinessSettings;
  onBusinessSettingsChange: (settings: BusinessSettings) => void;
  compact?: boolean;
};

const SoldFinancialBar: React.FC<SoldFinancialBarProps> = ({
  stats,
  taxMode,
  businessSettings,
  onBusinessSettingsChange,
  compact,
}) => {
  const profitLabel =
    taxMode === 'SmallBusiness' ? 'Cash profit' : taxMode === 'DifferentialVAT' ? 'After diff. VAT' : 'After VAT';
  const showCashMargin = taxMode !== 'SmallBusiness';

  return (
    <div
      className={`shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white ${
        compact ? 'text-[10px]' : 'text-[11px]'
      }`}
    >
      <span className="inline-flex items-baseline gap-1">
        <span className="text-[9px] font-black uppercase text-slate-400">Gross</span>
        <span className="font-black text-slate-900">€{formatEUR(stats.totalGross)}</span>
      </span>
      {taxMode !== 'SmallBusiness' && (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[9px] font-black uppercase text-slate-400">VAT</span>
          <span className="font-black text-red-500">-€{formatEUR(stats.totalTax)}</span>
        </span>
      )}
      {showCashMargin && (
        <span className="inline-flex items-baseline gap-1" title="Sell − buy − fees (no VAT reserve)">
          <span className="text-[9px] font-black uppercase text-slate-400">Cash</span>
          <span className="font-black text-slate-700">€{formatEUR(stats.cashMargin)}</span>
        </span>
      )}
      <span className="inline-flex items-baseline gap-1">
        <span className="text-[9px] font-black uppercase text-slate-400">{profitLabel}</span>
        <span className={`font-black ${stats.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
          {stats.totalProfit >= 0 ? '+' : ''}€{formatEUR(stats.totalProfit)}
        </span>
      </span>
      <div className={`${compact ? '' : 'ml-auto'} flex rounded-md border border-slate-200 bg-slate-50 p-0.5`}>
        <button
          type="button"
          onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'SmallBusiness' })}
          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase transition-all ${
            taxMode === 'SmallBusiness' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
          }`}
          title="Cash income — no VAT reserve on margin"
        >
          Kleinunt.
        </button>
        <button
          type="button"
          onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'DifferentialVAT' })}
          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase transition-all ${
            taxMode === 'DifferentialVAT' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
          }`}
          title="Differenzbesteuerung — VAT on margin"
        >
          Diff.
        </button>
        <button
          type="button"
          onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'RegularVAT' })}
          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase transition-all ${
            taxMode === 'RegularVAT' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
          }`}
          title="Regular 19% VAT on sell price"
        >
          VAT
        </button>
      </div>
    </div>
  );
};

type InventoryListTablePaneProps = {
  paneItems: InventoryItem[];
  paneStatus: StatusFilter;
  paneLabel?: string;
  paneExtra?: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  visibleColumns: ColumnId[];
  columnWidths: Record<string, number>;
  listDensity: 'comfortable' | 'compact';
  sortConfig: SortConfig;
  handleHeaderSort: (columnId: ColumnId) => void;
  handleColumnResizeStart: (e: React.MouseEvent, colId: ColumnId) => void;
  onSelectAll: () => void;
  selectedIdSet: Set<string>;
  renderRowCells: (item: InventoryItem, isSelected: boolean) => React.ReactNode;
  getRowActivityKey: (item: InventoryItem) => string;
  highlightedItemId: string | null;
  rowHeightEstimate: number;
  bulkBarSpacer: boolean;
  expandedBundles: Set<string>;
  className?: string;
};

const InventoryListTablePane: React.FC<InventoryListTablePaneProps> = ({
  paneItems,
  paneStatus,
  paneLabel,
  paneExtra,
  scrollRef,
  visibleColumns,
  columnWidths,
  listDensity,
  sortConfig,
  handleHeaderSort,
  handleColumnResizeStart,
  onSelectAll,
  selectedIdSet,
  renderRowCells,
  getRowActivityKey,
  highlightedItemId,
  rowHeightEstimate,
  bulkBarSpacer,
  expandedBundles,
  className = 'flex flex-1',
}) => {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const attachScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      setScrollElement(node);
      if (scrollRef) {
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [scrollRef]
  );

  const timeGaugeTitle =
    paneStatus === 'SOLD' ? 'Sale speed' : paneStatus === 'ACTIVE' ? 'Stock age' : 'Hold / sale';
  const paneSelectedCount = paneItems.filter((i) => selectedIdSet.has(i.id)).length;
  const allPaneSelected = paneItems.length > 0 && paneSelectedCount === paneItems.length;

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 rounded-xl border border-slate-100 shadow-sm bg-white overflow-hidden ${className}`}
    >
      {paneLabel && (
        <div className="shrink-0 flex flex-col gap-2 px-4 lg:px-6 py-2.5 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">{paneLabel}</span>
            <span className="text-[10px] font-bold text-slate-400">{paneItems.length} items</span>
          </div>
          {paneExtra}
        </div>
      )}
      <div ref={attachScrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-auto custom-scrollbar pb-3">
        <table className="w-full text-left border-collapse min-w-[1160px] table-fixed" data-inventory-table data-density={listDensity}>
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="bg-slate-50/80 border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest backdrop-blur-sm">
              {visibleColumns.map((colId) => {
                const w = columnWidths[colId] || DEFAULT_WIDTHS[colId];
                const sortable = !['actions', 'select', 'parseSpecs'].includes(colId);
                const stickyActions = colId === 'actions';
                return (
                  <th
                    key={colId}
                    className={`relative p-0 align-middle ${stickyActions ? 'sticky right-0 z-[40] bg-slate-50 shadow-[-8px_0_14px_-6px_rgba(15,23,42,0.1)] border-l border-slate-200/90' : 'bg-slate-50/80'}`}
                    style={{ width: w, minWidth: w, maxWidth: w }}
                  >
                    <div
                      role={sortable ? 'button' : undefined}
                      tabIndex={sortable ? 0 : undefined}
                      onClick={() => handleHeaderSort(colId)}
                      onKeyDown={
                        sortable
                          ? (ev) => {
                              if (ev.key === 'Enter' || ev.key === ' ') {
                                ev.preventDefault();
                                handleHeaderSort(colId);
                              }
                            }
                          : undefined
                      }
                      className={`flex items-center justify-start gap-1 w-full ${listDensity === 'compact' ? 'min-h-[1.35rem]' : 'min-h-[1.65rem]'} ${sortable ? 'cursor-pointer hover:bg-slate-100/90' : ''} ${colId === 'select' ? 'justify-center' : ''}`}
                    >
                      {colId === 'select' ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAll();
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-5 h-5 mx-auto border-2 border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-400"
                        >
                          {paneSelectedCount > 0 &&
                            (allPaneSelected ? (
                              <Check size={12} className="text-blue-500" />
                            ) : (
                              <Minus size={12} className="text-blue-500" />
                            ))}
                        </div>
                      ) : colId === 'parseSpecs' ? (
                        <span className="flex items-center justify-start gap-1 truncate" title="Parse tech specs with AI">
                          <Sparkles size={12} className="text-amber-500" /> Parse
                        </span>
                      ) : colId === 'timeGauge' ? (
                        <span
                          className="flex items-center justify-start gap-1 w-full truncate"
                          title={
                            paneStatus === 'SOLD'
                              ? 'Buy → sell: green = quick, red = slow'
                              : 'Days in stock: green = recent, red = aging'
                          }
                        >
                          <Clock size={12} className="text-slate-400 shrink-0" />
                          <span className="truncate">{timeGaugeTitle}</span>
                          {sortConfig.key === 'timeGauge' && (
                            <span className="text-blue-500 shrink-0">
                              {sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </span>
                          )}
                        </span>
                      ) : (
                        <>
                          <span className="truncate">{ALL_COLUMNS.find((c) => c.id === colId)?.label}</span>
                          {(sortConfig.key === colId || (colId === 'item' && sortConfig.key === 'name')) && (
                            <span className="text-blue-500 shrink-0">
                              {sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {colId === 'item' && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${ALL_COLUMNS.find((c) => c.id === colId)?.label || colId} column`}
                        title="Drag to resize column"
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 shrink-0 hover:bg-blue-500/35 active:bg-blue-500/50 border-r border-transparent hover:border-blue-400/40"
                        onMouseDown={(e) => handleColumnResizeStart(e, colId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <InventoryTableBody
            sortedItems={paneItems}
            selectedIdSet={selectedIdSet}
            visibleColumns={visibleColumns}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            highlightedItemId={highlightedItemId}
            scrollElement={scrollElement}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={bulkBarSpacer}
            expandedBundles={expandedBundles}
          />
        </table>
      </div>
    </div>
  );
};

const QuickCategoryPinPickerModal: React.FC<{
  categories: Record<string, string[]>;
  pins: QuickCategoryPin[];
  onAdd: (category: string, subCategory: string, label: string) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}> = ({ categories, pins, onAdd, onRemove, onReset, onClose }) => {
  const categoryKeys = Object.keys(categories);
  const [pickCategory, setPickCategory] = useState(() => categoryKeys[0] ?? 'Components');
  const [pickSub, setPickSub] = useState('');
  const [pickLabel, setPickLabel] = useState(() => categoryKeys[0] ?? 'Components');

  useEffect(() => {
    setPickSub('');
    setPickLabel(pickCategory);
  }, [pickCategory]);

  const pickId = quickCategoryPinId(pickCategory, pickSub || undefined);
  const alreadyPinned = pins.some((p) => p.id === pickId);

  const handleAdd = () => {
    if (!pickCategory || alreadyPinned) return;
    onAdd(pickCategory, pickSub, pickLabel.trim() || pickSub || pickCategory);
    setPickLabel(pickCategory);
    setPickSub('');
  };

  const labelPlaceholder = pickSub || pickCategory;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-slate-900">Category shortcuts</h3>
            <p className="text-xs text-slate-500 mt-0.5">Add buttons for quick filtering in inventory.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-slate-100">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-0.5">Category</label>
            <select
              value={pickCategory}
              onChange={(e) => setPickCategory(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/30"
            >
              {categoryKeys.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-0.5">Subcategory (optional)</label>
            <select
              value={pickSub}
              onChange={(e) => {
                const v = e.target.value;
                setPickSub(v);
                setPickLabel(v || pickCategory);
              }}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/30"
            >
              <option value="">All subcategories — category only</option>
              {(categories[pickCategory] ?? []).map((sub) => (
                <option key={sub} value={sub}>{sub}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-0.5">Button label</label>
            <input
              type="text"
              value={pickLabel}
              onChange={(e) => setPickLabel(e.target.value)}
              placeholder={labelPlaceholder}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400/30"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!pickCategory || alreadyPinned}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black uppercase tracking-wide hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {alreadyPinned ? 'Already in quick list' : 'Add shortcut'}
          </button>
        </div>

        <div className="p-4 max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Your shortcuts</span>
            <button type="button" onClick={onReset} className="text-[10px] font-bold text-slate-400 hover:text-slate-700">
              Reset defaults
            </button>
          </div>
          {pins.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No shortcuts yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {pins.map((pin) => (
                <li key={pin.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-900">{pin.label}</span>
                    <span className="block text-[10px] text-slate-500 truncate">
                      {pin.subCategory ? `${pin.category} › ${pin.subCategory}` : pin.category}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(pin.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="Remove shortcut"
                    aria-label={`Remove ${pin.label}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const CategoryPickerModal: React.FC<{
  initialCategory?: string;
  categories: Record<string, string[]>;
  onSave: (category: string, subCategory: string) => void;
  onClose: () => void;
}> = ({ initialCategory, categories, onSave, onClose }) => {
  const [selectedCat, setSelectedCat] = useState(() => {
     if (initialCategory && categories[initialCategory]) return initialCategory;
     const keys = Object.keys(categories);
     return keys.length > 0 ? keys[0] : '';
  });

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95">
        <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><Layers size={20}/></div>
             <div>
                <h3 className="font-black text-slate-900 text-lg">Select Category</h3>
                <p className="text-xs text-slate-500 font-bold">{initialCategory ? 'Reclassifying Item' : 'Bulk Update'}</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20} className="text-slate-400"/></button>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/3 bg-slate-50 border-r border-slate-100 overflow-y-auto p-3 space-y-1 custom-scrollbar">
             {Object.keys(categories).map(cat => (
                <button 
                   key={cat}
                   onClick={() => setSelectedCat(cat)}
                   className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all flex justify-between items-center group ${selectedCat === cat ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}
                >
                   {cat}
                   {selectedCat === cat && <ChevronRight size={12} className="text-slate-500"/>}
                </button>
             ))}
          </div>
          <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
             <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 flex items-center gap-2">
                <Tag size={12}/> Select Subcategory
             </h4>
             <div className="grid grid-cols-2 gap-3">
                {categories[selectedCat]?.map(sub => (
                   <button
                      key={sub}
                      onClick={() => onSave(selectedCat, sub)}
                      className={`p-4 rounded-2xl border text-left transition-all hover:scale-[1.02] active:scale-95 flex flex-col gap-1 bg-white border-slate-100 hover:border-blue-200 hover:shadow-md`}
                   >
                      <span className="font-black text-xs">{sub}</span>
                      <span className="text-[9px] opacity-60 font-bold uppercase">{selectedCat}</span>
                   </button>
                ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const BulkSalePctModal: React.FC<{ count: number; onApply: (pct: number) => void; onClose: () => void }> = ({ count, onApply, onClose }) => {
  const [pct, setPct] = useState<string>('10');
  const num = parseLocaleNumber(pct);
  const valid = !Number.isNaN(num) && num >= 0 && num <= 100;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
      <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full">
        <h3 className="text-lg font-black text-slate-900 mb-2">Apply sale % ({count} items)</h3>
        <p className="text-sm text-slate-500 mb-4">Set store sale price to (sell price × (1 − pct/100)). E.g. 10 = 10% off.</p>
        <input type="number" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium mb-4 outline-none focus:ring-2 focus:ring-blue-400" placeholder="10" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200">Cancel</button>
          <button onClick={() => valid && onApply(num)} disabled={!valid} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 disabled:opacity-50">Apply</button>
        </div>
      </div>
    </div>
  );
};

const BulkTagModal: React.FC<{ count: number; onApply: (tag: string) => void; onClose: () => void }> = ({ count, onApply, onClose }) => {
  const [tag, setTag] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
      <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full">
        <h3 className="text-lg font-black text-slate-900 mb-2">Add tag ({count} items)</h3>
        <p className="text-sm text-slate-500 mb-4">Set comment/tag (comment1) for all selected items.</p>
        <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium mb-4 outline-none focus:ring-2 focus:ring-blue-400" placeholder="e.g. Black Friday" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200">Cancel</button>
          <button onClick={() => onApply(tag)} className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800">Apply</button>
        </div>
      </div>
    </div>
  );
};

const BulkSalesEditModal: React.FC<{
  count: number;
  onConfirm: (platform: Platform, payment: PaymentType) => void;
  onClose: () => void;
}> = ({ count, onConfirm, onClose }) => {
  const [platform, setPlatform] = useState<Platform>('kleinanzeigen.de');
  const [payment, setPayment] = useState<PaymentType>('Cash');

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-6 space-y-6">
         <div className="text-center space-y-2">
            <h3 className="text-xl font-black text-slate-900">Edit Sales Details</h3>
            <p className="text-sm text-slate-500 font-medium">Updating {count} items</p>
         </div>
         
         <div className="space-y-4">
            <div className="space-y-1">
               <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Platform</label>
               <select 
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-indigo-500"
                  value={platform}
                  onChange={e => setPlatform(e.target.value as Platform)}
               >
                  {SALE_PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
               </select>
            </div>
            
            <div className="space-y-1">
               <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Payment Method</label>
               <select 
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-indigo-500"
                  value={payment}
                  onChange={e => setPayment(e.target.value as PaymentType)}
               >
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
               </select>
            </div>
         </div>

         <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-3 font-bold text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200">Cancel</button>
            <button onClick={() => onConfirm(platform, payment)} className="flex-1 py-3 font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-lg">Apply</button>
         </div>
      </div>
    </div>
  );
};

export default InventoryList;
