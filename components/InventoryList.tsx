import React, { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue, startTransition } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatEUR, parseLocaleMoney, parseLocaleNumber } from '../utils/formatMoney';
import { getTimeGaugeRow, resolveContainerChildItems, stressToRgb, timeGaugeSortKey, buildTimeGaugeSortKeyMap } from '../utils/inventoryTimeGauge';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Edit2, Search, CheckSquare, Square, X, Check, Trash2, Calendar, Package, Plus, Minus, Receipt, Monitor, ArrowUp, ArrowDown, ArrowUpDown, Tag, Info, Layers, ListTree, ChevronRight, ShoppingBag, Settings2, RotateCcw, RotateCw, HeartCrack, ListPlus, ArrowRightLeft, Archive, History, MoreHorizontal, Filter, FilterX, TrendingUp, Wallet, Download, FileSpreadsheet, Globe, CreditCard, Hourglass, AlertCircle, XCircle, Hammer, Share2, Copy, Sliders, Image as ImageIcon, FileText, Clock, Upload, Percent, CalendarRange, Wrench, Loader2, FolderInput, CalendarDays, Eye, Unlink, BoxSelect, ChevronUp, ChevronDown, StickyNote, ListChecks, Sparkles, ArrowRight, Columns2, List, AlertTriangle, Home
} from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings, Platform, PaymentType, ItemUpdateOptions } from '../types';
import { itemMatchesSalePlatformFilter, isMissingExplicitSalePlatform, MISSING_PLATFORM_FILTER, SALE_PLATFORM_OPTIONS, formatItemSalePlatform } from '../utils/salePlatform';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { getCompatibleItemsForItem } from '../services/compatibility';
import { generateKleinanzeigenCSV, generateEbayCSV } from '../services/ebayCsvService';
import { searchInventory } from '../utils/inventorySearchIndex';
import { copyKleinanzeigenListing } from '../utils/copyKleinanzeigenListing';
import { bundleComponentBreakdown } from '../utils/bundleProfitBreakdown';
import { exportInventoryToExcel } from '../services/excelExportService';
import { getRecentItemIds, addRecentItemId } from '../services/recentItemsService';
import { generateStoreDescription } from '../services/specsAI';
import { suggestPriceFromSoldListings, SoldPriceSuggestion, getSpecsAIProvider } from '../services/specsAI';

const ebaySoldSearchUrl = (query: string) =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
import SaleModal from './SaleModal';
import ReturnModal from './ReturnModal';
import TradeModal from './TradeModal';
import CrossPostingModal from './CrossPostingModal';
import RetroBundleModal from './RetroBundleModal';
import EditItemModal from './EditItemModal';
import ItemForm from './ItemForm';
import ItemThumbnail from './ItemThumbnail';
import InvoiceView from './InvoiceView';
import InventoryAISpecsPanel from './InventoryAISpecsPanel';
import BulkSelectionBar, { type BulkAction } from './BulkSelectionBar';
import { generateItemSpecs } from '../services/specsAI';

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
}

const EMPTY_TIME_GAUGE_SORT_MAP = new Map<string, number>();
const EMPTY_COMPAT_COUNT_MAP = new Map<string, number>();

type ColumnId = 'select' | 'item' | 'presence' | 'parseSpecs' | 'category' | 'status' | 'buyPrice' | 'sellPrice' | 'profit' | 'buyDate' | 'timeGauge' | 'sellDate' | 'salePlatform' | 'actions';
type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';
type StatusFilter = 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL';

type QuickCategoryPin = {
  id: string;
  label: string;
  category: string;
  subCategory: string;
};

function quickCategoryPinId(category: string, subCategory: string): string {
  return `${category}::${subCategory}`;
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

/** Inv column: 5 icon buttons in one row (28px each + 6px gaps + cell padding). */
const PRESENCE_ICON_SIZE_PX = 28;
const PRESENCE_ICON_GAP_PX = 6;
const PRESENCE_ICON_COUNT = 5;
const PRESENCE_COL_WIDTH =
  PRESENCE_ICON_COUNT * PRESENCE_ICON_SIZE_PX +
  (PRESENCE_ICON_COUNT - 1) * PRESENCE_ICON_GAP_PX +
  20;

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 36,
  item: 200,
  presence: PRESENCE_COL_WIDTH,
  parseSpecs: 148,
  category: 116,
  status: 82,
  buyPrice: 76,
  sellPrice: 76,
  profit: 76,
  buyDate: 90,
  timeGauge: 72,
  sellDate: 90,
  salePlatform: 148,
  actions: 104,
};

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
  const max = Math.min(900, Math.ceil(def * 3.5));
  return Math.round(Math.min(max, Math.max(min, w)));
}

const ALL_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'select', label: '' },
  { id: 'item', label: 'Asset Name' },
  { id: 'presence', label: 'Inv' },
  { id: 'parseSpecs', label: 'Parse' },
  { id: 'category', label: 'Category' },
  { id: 'status', label: 'Status' },
  { id: 'buyPrice', label: 'Buy Price' },
  { id: 'sellPrice', label: 'Sell Price' },
  { id: 'profit', label: 'Margin' },
  { id: 'buyDate', label: 'Acquired' },
  { id: 'timeGauge', label: 'Time' },
  { id: 'sellDate', label: 'Sold Date' },
  { id: 'salePlatform', label: 'Sold on' },
  { id: 'actions', label: 'Actions' }
];

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
  deferredSearchTerm: string;
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
};

function filterAndSortInventoryItems(params: InventoryListFilterParams): InventoryItem[] {
  const {
    items,
    statusFilter,
    deferredSearchTerm,
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
  } = params;

  const searchLower = deferredSearchTerm.toLowerCase();
  const indexedIds =
    searchLower.trim().length >= 2
      ? new Set(searchInventory(items, searchLower, 500).map((h) => h.item.id))
      : null;

  const filtered = items.filter((item) => {
    let matchesStatus = false;
    if (statusFilter === 'ACTIVE') {
      matchesStatus =
        item.status === ItemStatus.IN_STOCK ||
        item.status === ItemStatus.ORDERED ||
        item.status === ItemStatus.IN_COMPOSITION;
    } else if (statusFilter === 'SOLD') {
      matchesStatus = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
    } else if (statusFilter === 'DRAFTS') {
      matchesStatus = item.isDraft === true;
    } else {
      matchesStatus = true;
    }
    if (!matchesStatus) return false;
    if (item.parentContainerId) return false;
    if (!showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;

    if (categoryFilter !== 'ALL' || subCategoryFilter) {
      const matchParentAndSub =
        categoryFilter !== 'ALL' &&
        item.category === categoryFilter &&
        (!subCategoryFilter || item.subCategory === subCategoryFilter);
      const matchSubAsTopLevel = subCategoryFilter && item.category === subCategoryFilter;
      if (!matchParentAndSub && !matchSubAsTopLevel) return false;
    }

    if (searchLower) {
      const matchesSearch = indexedIds
        ? indexedIds.has(item.id)
        : item.name.toLowerCase().includes(searchLower) ||
          item.category.toLowerCase().includes(searchLower) ||
          (item.vendor?.toLowerCase().includes(searchLower) ?? false);
      if (!matchesSearch) return false;
    }

    if (timeFilter !== 'ALL') {
      const isSalesItem = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
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
    }

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

    return true;
  });

  filtered.sort((a, b) => {
    const key = sortConfig.key === 'item' ? 'name' : sortConfig.key;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;

    if (sortConfig.key === 'timeGauge') {
      return ((timeGaugeSortKeyMap.get(a.id) ?? -1) - (timeGaugeSortKeyMap.get(b.id) ?? -1)) * dir;
    }

    let valA: unknown = (a as Record<string, unknown>)[key];
    let valB: unknown = (b as Record<string, unknown>)[key];

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
  persistenceKey = 'default_inv'
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

  // Spec filters: key -> allowed values (empty = no filter). Range filters for numeric specs.
  const [specFilters, setSpecFilters] = useState<Record<string, (string | number)[]>>(() => loadState('spec_filters', {}));
  const [specRangeFilters, setSpecRangeFilters] = useState<Record<string, { min?: number; max?: number }>>(() => loadState('spec_range_filters', {}));
  const [showSpecFiltersPanel, setShowSpecFiltersPanel] = useState(false);
  const filtersPanelRef = useRef<HTMLDivElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);

  // Visibility toggle for items that are part of a PC / bundle composition
  const [showInComposition, setShowInComposition] = useState<boolean>(() => loadState<boolean>('show_in_composition', true));

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

  const defaultColumnOrder: ColumnId[] = ['select', 'item', 'presence', 'parseSpecs', 'category', 'status', 'buyPrice', 'sellPrice', 'profit', 'buyDate', 'timeGauge', 'sellDate', 'salePlatform', 'actions'];
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const saved = loadState<ColumnId[]>('column_order', defaultColumnOrder);
    const base = saved && saved.length > 0 ? saved : defaultColumnOrder;
    let next = [...base];
    if (!next.includes('timeGauge')) {
      const buy = next.indexOf('buyDate');
      if (buy >= 0) next.splice(buy + 1, 0, 'timeGauge');
      else next.splice(Math.max(0, next.length - 1), 0, 'timeGauge');
    }
    if (!next.includes('salePlatform')) {
      const sell = next.indexOf('sellDate');
      if (sell >= 0) next.splice(sell + 1, 0, 'salePlatform');
      else next.splice(Math.max(0, next.length - 1), 0, 'salePlatform');
    }
    return next;
  });
  const [hiddenColumnIds, setHiddenColumnIds] = useState<ColumnId[]>(() => loadState<ColumnId[]>('hidden_columns', []));
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement>(null);
  const columnWidthsRef = useRef(columnWidths);
  const columnResizeRef = useRef<{ colId: ColumnId; startX: number; startW: number } | null>(null);
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
  const [listDensity, setListDensity] = useState<ListDensity>(() => loadState<ListDensity>('list_density', 'comfortable'));
  useEffect(() => localStorage.setItem(`${persistenceKey}_list_density`, JSON.stringify(listDensity)), [listDensity, persistenceKey]);

  // -- INLINE EDITING STATE --
  const [editingCell, setEditingCell] = useState<{ itemId: string, field: ColumnId } | null>(null);
  const [editValue, setEditValue] = useState<string | number>('');
  const [parsingSingleId, setParsingSingleId] = useState<string | null>(null);
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
      localStorage.setItem(`${k}_sale_platform`, JSON.stringify(salePlatformFilter));
      localStorage.setItem(`${k}_sale_payment`, JSON.stringify(salePaymentFilter));
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
    salePlatformFilter, salePaymentFilter, specFilters, specRangeFilters, showInComposition, columnOrder,
    hiddenColumnIds, splitView, quickCategoryPins, persistenceKey,
  ]);

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
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  
  // Modals
  const [itemToSell, setItemToSell] = useState<InventoryItem | null>(null);
  const [itemToReturn, setItemToReturn] = useState<InventoryItem | null>(null);
  const [itemToTrade, setItemToTrade] = useState<InventoryItem | null>(null);
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

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const searchSuggestions = useMemo(() => {
    if (!searchSuggestionsOpen) return [];
    const q = deferredSearchTerm.trim().toLowerCase();
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
  }, [items, deferredSearchTerm, searchSuggestionsOpen]);

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

  // --- INVENTORY PRESENCE (PRESENT / LOST) ---
  const togglePresence = (item: InventoryItem) => {
    let next: 'present' | 'lost' | undefined;
    if (!item.presence) {
      next = 'present';
    } else if (item.presence === 'present') {
      next = 'lost';
    } else {
      // 'lost' -> back to unknown (unset)
      next = undefined;
    }
    const updated: InventoryItem = { ...item };
    if (next) {
      updated.presence = next;
    } else {
      delete (updated as any).presence;
    }
    onUpdate([updated]);
  };

  // --- INVENTORY CONDITION (WORKING / DEFECTIVE) ---
  const toggleDefective = (item: InventoryItem) => {
    const updated: InventoryItem = {
      ...item,
      isDefective: !item.isDefective,
    };
    onUpdate([updated]);
  };

  // --- MARKETPLACE LISTING FLAGS (Kleinanzeigen / eBay) ---
  const toggleListedKleinanzeigen = (item: InventoryItem) => {
    const updated: InventoryItem = {
      ...item,
      listedOnKleinanzeigen: !item.listedOnKleinanzeigen,
    };
    onUpdate([updated]);
  };

  const toggleListedEbay = (item: InventoryItem) => {
    const updated: InventoryItem = {
      ...item,
      listedOnEbay: !item.listedOnEbay,
    };
    onUpdate([updated]);
  };

  const toggleStoreVisible = (item: InventoryItem) => {
    const currentlyVisible = item.storeVisible === true;
    const updated: InventoryItem = {
      ...item,
      storeVisible: !currentlyVisible,
    };
    onUpdate([updated]);
  };

  // --- AI LISTING DESCRIPTION (Kleinanzeigen / eBay style, same as store description style) ---
  const [listingGenId, setListingGenId] = useState<string | null>(null);
  const [priceSuggestId, setPriceSuggestId] = useState<string | null>(null);
  const [priceSuggestModalItem, setPriceSuggestModalItem] = useState<InventoryItem | null>(null);
  const [priceSuggestResult, setPriceSuggestResult] = useState<SoldPriceSuggestion | null>(null);
  const [priceSuggestError, setPriceSuggestError] = useState<string | null>(null);
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

  // Visible Columns (from order, excluding hidden) — memoized so row renders are not invalidated every parent render
  const visibleColumns = useMemo(
    () => columnOrder.filter((id) => !hiddenColumnIds.includes(id)),
    [columnOrder, hiddenColumnIds]
  );

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

  // Base-filtered items (no spec filters) — used to build available spec options in the Filters panel
  const baseFilteredForSpecs = useMemo(() => {
    if (!showSpecFiltersPanel && !hasActiveSpecFilters) return [];
    const searchLower = deferredSearchTerm.toLowerCase();
    return items.filter(item => {
      let matchesStatus = false;
      if (statusFilter === 'ACTIVE') matchesStatus = item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED || item.status === ItemStatus.IN_COMPOSITION;
      else if (statusFilter === 'SOLD') matchesStatus = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
      else if (statusFilter === 'DRAFTS') matchesStatus = item.isDraft === true;
      else matchesStatus = true;
      if (!matchesStatus) return false;

      // Optional visibility toggle for "In Composition" items
      if (!showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;
      if (categoryFilter !== 'ALL' || subCategoryFilter) {
        const matchParentAndSub = categoryFilter !== 'ALL' && item.category === categoryFilter && (!subCategoryFilter || item.subCategory === subCategoryFilter);
        const matchSubAsTopLevel = subCategoryFilter && item.category === subCategoryFilter;
        if (!matchParentAndSub && !matchSubAsTopLevel) return false;
      }
      const matchesSearch = item.name.toLowerCase().includes(searchLower) || item.category.toLowerCase().includes(searchLower) || item.vendor?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
      if (timeFilter !== 'ALL') {
        const isSalesItem = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
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
  }, [items, deferredSearchTerm, statusFilter, categoryFilter, subCategoryFilter, timeFilter, dateRange, salePlatformFilter, salePaymentFilter, showInComposition, showSpecFiltersPanel, hasActiveSpecFilters]);

  // Available spec keys and unique values (from base-filtered items) for the Filters panel
  const specOptions = useMemo(() => {
    if (!showSpecFiltersPanel && !hasActiveSpecFilters) return [];
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
  }, [baseFilteredForSpecs, showSpecFiltersPanel, hasActiveSpecFilters]);

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
      deferredSearchTerm,
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
    }),
    [
      items,
      deferredSearchTerm,
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
  const rowHeightEstimate = listDensity === 'compact' ? 76 : 118;

  useEffect(() => {
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    if (activeTableRef.current) activeTableRef.current.scrollTop = 0;
    if (soldTableRef.current) soldTableRef.current.scrollTop = 0;
  }, [searchTerm, timeFilter, sortConfig, statusFilter, categoryFilter, subCategoryFilter, salePlatformFilter, salePaymentFilter, specFilters, specRangeFilters, splitView]);

  const getRowActivityKey = useCallback(
    (item: InventoryItem) =>
      `${editingCell?.itemId === item.id ? editingCell.field : ''}|${listingGenId === item.id}|${parsingSingleId === item.id}|${priceSuggestId === item.id}|${expandedBundles.has(item.id) ? 'open' : 'shut'}`,
    [editingCell, listingGenId, parsingSingleId, priceSuggestId, expandedBundles]
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

    const soldItems = (splitView ? sortedSoldItems : sortedItems).filter(i => i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED);
    // For financial stats we only want to count *real* items once.
    // PC builds / Bundles are just containers whose economics live in their child items,
    // so we ignore rows where isPC / isBundle is true to avoid double-counting revenue & profit.
    const soldAtomicItems = soldItems.filter(i => !i.isPC && !i.isBundle);
    
    // Calculate gross revenue and tax for all sold atomic items
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
    });

    // Calculate profit only for the same atomic set
    soldAtomicItems.forEach(item => {
        const sell = item.sellPrice || 0;
        const buy = item.buyPrice || 0;
        const fee = item.feeAmount || 0;
        
        let netSell = sell;
        if (businessSettings.taxMode === 'RegularVAT') {
            netSell = sell / 1.19;
        } else if (businessSettings.taxMode === 'DifferentialVAT') {
            const margin = sell - buy;
            if (margin > 0) {
                const netMargin = margin / 1.19;
                netSell = sell - (margin - netMargin);
            } else {
                netSell = sell;
            }
        }
        
        totalProfit += (netSell - buy - fee);
    });

    return { totalGross, totalTax, totalNetRevenue, totalProfit };
  }, [sortedItems, sortedSoldItems, splitView, businessSettings.taxMode, showFinancials]);

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
    e.preventDefault();
    e.stopPropagation();
    const startW = columnWidthsRef.current[colId] ?? DEFAULT_WIDTHS[colId];
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

    if (targetField === 'buyPrice' || targetField === 'sellPrice') {
       newValue = parseLocaleMoney(editValue, 0);
    }

    const updates: Partial<InventoryItem> = { [targetField]: newValue };

    if ((targetField === 'buyPrice' || targetField === 'sellPrice') && (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED)) {
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
       const isRetroBundle = bundle.subCategory === 'Retro Bundle';

       const updates = components.map(c => {
          if (isRetroBundle) {
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

  const handleParseSingleItem = useCallback(async (item: InventoryItem) => {
    setParsingSingleId(item.id);
    try {
      const categoryContext = `${item.category || 'Unknown'}${item.subCategory ? ' / ' + item.subCategory : ''}`;
      const activeKey = `${item.category}:${item.subCategory}`;
      const knownKeys = (categoryFields || {})[activeKey] || (categoryFields || {})[item.category || ''] || [];
      const result = await generateItemSpecs(item.name, categoryContext, knownKeys);
      const definedFields = knownKeys;
      let newSpecs = { ...(item.specs || {}) };
      Object.entries(result.specs || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        const keyToUse = definedFields.length > 0 ? (definedFields.find((df) => df.toLowerCase() === k.toLowerCase()) || k) : k;
        newSpecs[keyToUse] = v;
      });
      const updates: Partial<InventoryItem> = { specs: newSpecs as Record<string, string | number> };
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
    const isSalesMode = selectedItemsList.some(i => i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED);

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
      i.status === ItemStatus.SOLD || 
      i.status === ItemStatus.TRADED)
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
    if (platform === 'ebay.de' && !next.paymentType) {
      next.paymentType = 'ebay.de';
    }
    startTransition(() => {
      onUpdate([next], undefined, {
        skipUndo: true,
        skipActionLog: true,
        skipContainerSync: true,
      });
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
     const updates = items.filter(i => selectedIds.includes(i.id)).map(i => ({ ...i, storeVisible: visible }));
     onUpdate(updates);
     setShowBulkStoreVisible(false);
     setSelectedIds([]);
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
    const width = columnWidths[id] || DEFAULT_WIDTHS[id];
    const style = { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };

    switch (id) {
      case 'select':
        return (
          <td key={id} className="p-5 text-center" style={style}>
             <div onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }} className={`w-6 h-6 sm:w-5 sm:h-5 mx-auto border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all touch-manipulation ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 hover:border-blue-400'}`}>
                {isSelected && <Check size={12}/>}
             </div>
          </td>
        );
      case 'presence':
        return (
          <td key={id} className="p-2 inv-col-icons border-r border-slate-100/90 align-middle" style={style} onClick={(e) => e.stopPropagation()}>
            <div
              className="grid grid-cols-5 gap-1.5 items-center justify-items-center mx-auto shrink-0"
              style={{ width: PRESENCE_ICON_COUNT * PRESENCE_ICON_SIZE_PX + (PRESENCE_ICON_COUNT - 1) * PRESENCE_ICON_GAP_PX }}
            >
              {/* Physical presence: present / lost / unknown */}
              <button
                type="button"
                onClick={() => togglePresence(item)}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-xl border transition-colors ${
                  item.presence === 'present'
                    ? 'border-emerald-300 bg-emerald-50'
                  : item.presence === 'lost'
                    ? 'border-red-300 bg-red-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
                title={
                  item.presence === 'present'
                    ? 'Present (click to mark as lost)'
                    : item.presence === 'lost'
                    ? 'Lost (click to clear)'
                    : 'Not checked (click to mark as present)'
                }
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    item.presence === 'present'
                      ? 'bg-emerald-500'
                      : item.presence === 'lost'
                      ? 'bg-red-500'
                      : 'bg-slate-300'
                  }`}
                />
              </button>

              {/* Condition: working / defective */}
              <button
                type="button"
                onClick={() => toggleDefective(item)}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-xl text-[10px] font-bold transition-colors ${
                  item.isDefective
                    ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-700'
                }`}
                title={
                  item.isDefective
                    ? 'Defective / not working (click to mark as working)'
                    : 'Working / OK (click to mark as defective)'
                }
              >
                {item.isDefective ? <AlertCircle size={13} /> : <Wrench size={13} />}
              </button>

              {/* Listed on Kleinanzeigen (same style as Parse K icon) */}
              <button
                type="button"
                onClick={() => toggleListedKleinanzeigen(item)}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-xl border text-emerald-700 ${
                  item.listedOnKleinanzeigen
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-emerald-200 bg-white'
                }`}
                title={
                  item.listedOnKleinanzeigen
                    ? 'Listed on Kleinanzeigen (click to mark as not listed)'
                    : 'Not listed on Kleinanzeigen (click to mark as listed)'
                }
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    item.listedOnKleinanzeigen ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-emerald-700'
                  }`}
                >
                  K
                </span>
              </button>

              {/* Listed on eBay (same style as Parse E icon) */}
              <button
                type="button"
                onClick={() => toggleListedEbay(item)}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-xl border text-blue-700 ${
                  item.listedOnEbay
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-blue-200 bg-white'
                }`}
                title={
                  item.listedOnEbay
                    ? 'Listed on eBay (click to mark as not listed)'
                    : 'Not listed on eBay (click to mark as listed)'
                }
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    item.listedOnEbay ? 'bg-blue-600 text-white' : 'bg-slate-200 text-blue-700'
                  }`}
                >
                  E
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleStoreVisible(item)}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-xl border text-violet-700 ${
                  item.storeVisible === true ? 'border-violet-200 bg-violet-50' : 'border-violet-200 bg-white'
                }`}
                title={
                  item.storeVisible === true
                    ? 'Visible on storefront (click to hide)'
                    : 'Hidden from storefront (click to show)'
                }
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    item.storeVisible === true ? 'bg-violet-600 text-white' : 'bg-slate-200 text-violet-700'
                  }`}
                >
                  S
                </span>
              </button>
            </div>
          </td>
        );
      case 'item':
        const isExpanded = expandedBundles.has(item.id);
        const childItems = (item.isPC || item.isBundle) && (item.componentIds || []) 
          ? items.filter(i => 
              (item.componentIds && item.componentIds.includes(i.id)) || 
              i.parentContainerId === item.id
            )
          : [];
        const toggleExpand = (e: React.MouseEvent) => {
          e.stopPropagation();
          const newExpanded = new Set(expandedBundles);
          if (isExpanded) {
            newExpanded.delete(item.id);
          } else {
            newExpanded.add(item.id);
          }
          setExpandedBundles(newExpanded);
        };
        const isEditingName = editingCell?.itemId === item.id && editingCell?.field === 'item';
        const canExpandBundle = (item.isPC || item.isBundle) && childItems.length > 0;
        return (
          <td key={id} className="p-5" style={style} onClick={() => handleRowClick(item, isEditingName)}>
             <div className="flex items-start gap-2 cursor-pointer group/cell w-full">
                <ItemThumbnail item={item} className="w-10 h-10 rounded-lg object-cover shadow-sm border border-slate-100 shrink-0" size={40} />
                <div className="flex-1 min-w-0">
                   <div className="flex items-center gap-2 w-full min-w-0">
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
                          className="text-sm font-black text-slate-900 truncate group-hover/cell:text-blue-600 transition-colors flex-1 min-w-0"
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
                      {canExpandBundle && (
                        <button
                          type="button"
                          onClick={toggleExpand}
                          className="p-1 mr-3 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                          title={isExpanded ? 'Collapse components' : 'Expand to show components'}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Collapse bundle components' : 'Expand bundle components'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                   </div>
                   <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {item.specs && Object.keys(item.specs).length > 0 && (
                         <span className="inline-flex items-center gap-1 text-emerald-600" title="Tech specs filled — open to edit or re-parse">
                            <ListChecks size={12} className="shrink-0" />
                            <span className="text-[9px] font-bold uppercase text-emerald-600">Specs</span>
                         </span>
                      )}
                      {item.isDraft && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1"><StickyNote size={8}/> Draft</span>}
                      {item.isBundle && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black uppercase">Bundle</span>}
                      {item.isPC && <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-black uppercase">PC Build</span>}
                      {item.isDefective && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase">Defective</span>}
                      {showFinancials && isMissingExplicitSalePlatform(item) && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black uppercase"
                          title="Platform not set — choose Sold on in the row or use bulk edit"
                        >
                          <AlertTriangle size={9} className="shrink-0" /> No platform
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.vendor}</span>
                      {canExpandBundle && (
                         <span className="text-[9px] text-slate-500 font-medium">({childItems.length} items)</span>
                      )}
                   </div>
                   {(item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) && (item.customer?.name || item.ebayUsername || item.ebayOrderId) && (
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
                          {item.customer?.name || 'Buyer'}
                          {item.ebayUsername ? ` · eBay: ${item.ebayUsername}` : ''}
                          {item.ebayOrderId ? ` · #${item.ebayOrderId}` : ''}
                        </span>
                      </p>
                   )}
                   {item.specs && Object.keys(item.specs).length > 0 && (
                      <p className="text-[10px] text-slate-500 font-medium mt-1 truncate" title={Object.entries(item.specs).map(([k, v]) => `${k}: ${v}`).join(' • ')}>
                         {Object.entries(item.specs).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </p>
                   )}
                   {compatibleCountByItemId.get(item.id) != null && (
                      <p className="text-[9px] text-blue-600 font-bold mt-1 flex items-center gap-1" title="Compatible parts in inventory — open item to see list">
                         <Layers size={10} /> Works with {compatibleCountByItemId.get(item.id)} item{compatibleCountByItemId.get(item.id) === 1 ? '' : 's'}
                      </p>
                   )}
                   {isExpanded && childItems.length > 0 && (
                      <div className="mt-3 ml-4 pl-4 border-l-2 border-slate-200 space-y-2">
                         <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Components:</p>
                         {childItems.map(child => {
                            const breakdown = bundleComponentBreakdown(item, items).find((b) => b.item.id === child.id);
                            const childMargin = breakdown?.profit ?? (child.profit != null ? child.profit : (child.sellPrice && child.buyPrice ? child.sellPrice - child.buyPrice - (child.feeAmount || 0) : null));
                            return (
                               <button
                                 key={child.id}
                                 type="button"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   handleEditClick(child);
                                 }}
                                 className="w-full text-left"
                               >
                                 <div className="flex items-center justify-between gap-2 text-xs bg-slate-50 hover:bg-slate-100 p-2 rounded-lg transition-colors">
                                   <span className="font-medium text-slate-700 truncate flex-1">
                                     {child.name}
                                   </span>
                                   <div className="flex items-center gap-3 text-[10px] shrink-0">
                                      {childMargin != null && (
                                         <span className={`font-bold px-1.5 py-0.5 rounded ${childMargin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            {childMargin >= 0 ? '+' : ''}€{formatEUR(childMargin)}
                                         </span>
                                      )}
                                      {child.buyDate && (
                                         <span className="flex items-center gap-1 text-slate-500">
                                            <Calendar size={10} />
                                            Buy: {new Date(child.buyDate).toLocaleDateString()}
                                            {child.buyPrice != null && (
                                              <span className="font-semibold text-slate-600">· €{formatEUR(child.buyPrice)}</span>
                                            )}
                                         </span>
                                      )}
                                      {child.sellDate && (
                                         <span className="flex items-center gap-1 text-emerald-600">
                                            <Calendar size={10} />
                                            Sold: {new Date(child.sellDate).toLocaleDateString()}
                                         </span>
                                      )}
                                   </div>
                                 </div>
                               </button>
                            );
                         })}
                         {/* Total margin summary */}
                         {(() => {
                            const totalMargin = childItems.reduce((sum, child) => {
                               const childMargin = child.profit != null ? child.profit : (child.sellPrice && child.buyPrice ? child.sellPrice - child.buyPrice - (child.feeAmount || 0) : 0);
                               return sum + childMargin;
                            }, 0);
                            if (totalMargin !== 0 || childItems.some(c => c.sellPrice)) {
                               return (
                                  <div className="mt-2 pt-2 border-t border-slate-200 bg-slate-100/50 p-2 rounded-lg">
                                     <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black uppercase text-slate-600 tracking-widest">Total Margin:</span>
                                        <span className={`text-sm font-black ${totalMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                           {totalMargin >= 0 ? '+' : ''}€{formatEUR(totalMargin)}
                                        </span>
                                     </div>
                                  </div>
                               );
                            }
                            return null;
                         })()}
                      </div>
                   )}
                </div>
             </div>
          </td>
        );
      case 'parseSpecs':
        return (
          <td key={id} className="p-3 inv-col-icons text-center border-r border-slate-100/90" style={style} onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-row flex-wrap items-center justify-center gap-2">
              {/* Visual indicator if AI listing text already exists */}
              {item.marketDescription && (
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500"
                  title="AI listing text already generated – use copy button to reuse"
                />
              )}

              {/* Tech specs parse (same as before) */}
              <button
                type="button"
                onClick={() => handleParseSingleItem(item)}
                disabled={parsingSingleId !== null}
                title="Parse tech specs with AI (can correct name)"
                className={`h-6 w-6 flex items-center justify-center rounded-lg text-slate-600 transition-colors ${
                  parsingSingleId === item.id
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 hover:bg-amber-100 hover:text-amber-700'
                }`}
              >
                {parsingSingleId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              </button>

              {/* Suggested price from sold history (eBay/Kleinanzeigen) */}
              <button
                type="button"
                onClick={() => handleSuggestPrice(item)}
                disabled={priceSuggestId === item.id}
                className={`h-6 w-6 flex items-center justify-center rounded-lg border text-amber-700 ${
                  item.sellPrice
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-amber-200 bg-white'
                } ${priceSuggestId === item.id ? 'opacity-70 cursor-wait' : 'hover:bg-amber-100'}`}
                title="AI: Preisvorschlag auf Basis verkaufter Angebote (eBay.de, Kleinanzeigen)"
              >
                <Tag size={11} />
              </button>

              {/* Kleinanzeigen listing (green K) */}
              <button
                type="button"
                onClick={() => handleGenerateListingDescription(item)}
                disabled={listingGenId === item.id}
                className={`h-6 w-6 flex items-center justify-center rounded-lg border text-emerald-700 ${
                  item.marketDescription
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-emerald-200 bg-white'
                } ${listingGenId === item.id ? 'opacity-70 cursor-wait' : 'hover:bg-emerald-100'}`}
                title={
                  item.marketDescription
                    ? 'AI: Kleinanzeigen Beschreibung ist bereits gespeichert – Klick generiert eine neue Version'
                    : 'AI: Kleinanzeigen Beschreibung auf Deutsch generieren'
                }
              >
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[8px]">K</span>
              </button>

              {/* eBay listing (blue E – same style, German text) */}
              <button
                type="button"
                onClick={() => handleGenerateListingDescription(item)}
                disabled={listingGenId === item.id}
                className={`h-6 w-6 flex items-center justify-center rounded-lg border text-blue-700 ${
                  item.marketDescription
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-blue-200 bg-white'
                } ${listingGenId === item.id ? 'opacity-70 cursor-wait' : 'hover:bg-blue-100'}`}
                title={
                  item.marketDescription
                    ? 'AI: eBay Beschreibung ist bereits gespeichert – Klick generiert eine neue Version'
                    : 'AI: eBay Beschreibung auf Deutsch generieren'
                }
              >
                <span className="w-3.5 h-3.5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[8px]">E</span>
              </button>

              {/* Copy generated listing text */}
              {item.marketDescription && (
                <button
                  type="button"
                  onClick={() => handleCopyListingDescription(item)}
                  className="h-6 w-6 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  title="Copy generated listing text (German) to clipboard"
                >
                  <Copy size={10} />
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await copyKleinanzeigenListing(item);
                  } catch {
                    alert('Copy failed');
                  }
                }}
                className="h-6 px-1.5 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[8px] font-black"
                title="Copy Kleinanzeigen listing (title + description + price)"
              >
                KA
              </button>
            </div>
          </td>
        );
      case 'category':
        return (
          <td key={id} className="p-3 pl-4" style={style}>
             <div 
               onClick={(e) => { e.stopPropagation(); setItemToEditCategory(item); }}
               className="group/cat cursor-pointer hover:bg-slate-100 rounded-lg px-2 py-1.5 -mx-1 transition-colors"
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
        return (
          <td 
             key={id} 
             className="p-5" 
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
                      item.status === ItemStatus.IN_COMPOSITION ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                   }`}
                   title="Double click to change status"
                >
                  {statusLabel}
                </span>
             )}
          </td>
        );
      case 'buyPrice':
        const isEditingBuy = editingCell?.itemId === item.id && editingCell?.field === 'buyPrice';
        return (
          <td 
            key={id} 
            className="p-5 text-right font-black text-slate-900 cursor-pointer hover:bg-blue-50/30 transition-colors" 
            style={style}
            title="Double click to edit"
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'buyPrice', item.buyPrice); }}
          >
            {isEditingBuy ? (
               <input 
                 autoFocus
                 type="text"
                 inputMode="decimal"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
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
      case 'sellPrice':
        const isEditingSell = editingCell?.itemId === item.id && editingCell?.field === 'sellPrice';
        return (
          <td 
            key={id} 
            className="p-5 text-right font-bold text-slate-600 cursor-pointer hover:bg-blue-50/30 transition-colors" 
            style={style}
            title="Double click to edit"
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'sellPrice', item.sellPrice || 0); }}
          >
            {isEditingSell ? (
               <input 
                 autoFocus
                 type="text"
                 inputMode="decimal"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               item.sellPrice ? `€${formatEUR(item.sellPrice)}` : '-'
            )}
          </td>
        );
      case 'profit':
        // Bundles/PCs don't have profit - profit is only in child items
        if (item.isPC || item.isBundle) {
          return (
            <td key={id} className="p-5 text-right text-xs font-bold text-slate-300" style={style} title="Bundles/PCs don't have profit. Expand to see component margins.">
              -
            </td>
          );
        }
        return (
          <td key={id} className={`p-5 text-right font-black ${item.profit && item.profit > 0 ? 'text-emerald-600' : item.profit && item.profit < 0 ? 'text-red-500' : 'text-slate-300'}`} style={style}>
             {item.profit ? `€${formatEUR(item.profit)}` : '-'}
          </td>
        );
      case 'timeGauge': {
        const now = Date.now();
        const row = getTimeGaugeRow(item, now, items);
        if (!row) {
          return (
            <td key={id} className="p-5 text-center text-[10px] text-slate-300" style={style} title="Set acquisition date (or add components to bundle)">
              —
            </td>
          );
        }
        if (row.missingSellDate) {
          return (
            <td key={id} className="p-5 align-middle" style={style}>
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
          <td key={id} className="p-5 align-middle" style={style}>
            <div
              className="flex flex-col items-stretch gap-0.5 min-w-0 max-w-[4.25rem] mx-auto"
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
              <span className="text-[8px] font-bold text-slate-500 text-center tabular-nums leading-none">
                {row.shortLabel}
              </span>
            </div>
          </td>
        );
      }
      case 'buyDate':
        if ((item.isPC || item.isBundle)) {
          return (
            <td key={id} className="p-5 text-right text-xs font-bold text-slate-300" style={style} title="Bundles/PCs don't have buy dates. Expand to see component buy dates.">
              -
            </td>
          );
        }
        return (
           <td 
             key={id} 
             className="p-5 text-right text-xs font-bold text-slate-500 cursor-pointer hover:bg-blue-50/30 transition-colors" 
             style={style}
             title="Double click to edit"
             onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, id, (item as any)[id] || ''); }}
           >
              {editingCell?.itemId === item.id && editingCell?.field === id ? (
                 <input 
                   autoFocus
                   type="date"
                   className="w-24 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
                   value={editValue}
                   onChange={e => setEditValue(e.target.value)}
                   onBlur={saveEdit}
                   onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                   onClick={e => e.stopPropagation()}
                 />
              ) : (
                 (item as any)[id] || '-'
              )}
           </td>
        );
      case 'sellDate': {
        const isSoldOrTraded = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
        const hasBuyerData = item.customer?.name || item.ebayUsername || item.ebayOrderId;
        const buyerTitle = hasBuyerData ? [
          item.customer?.name ? `Buyer: ${item.customer.name}` : null,
          item.customer?.address ? `Address: ${item.customer.address}` : null,
          item.ebayUsername ? `eBay: ${item.ebayUsername}` : null,
          item.ebayOrderId ? `Order ID: ${item.ebayOrderId}` : null,
        ].filter(Boolean).join(' • ') : undefined;
        const isEditingDate = editingCell?.itemId === item.id && editingCell?.field === id;
        return (
           <td 
             key={id} 
             className="p-5 text-right text-xs font-bold text-slate-500 cursor-pointer hover:bg-blue-50/30 transition-colors" 
             style={style}
             title={buyerTitle || "Double click to edit"}
             onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, id, (item as any)[id] || ''); }}
           >
              {isEditingDate ? (
                 <input 
                   autoFocus
                   type="date"
                   className="w-24 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
                   value={editValue}
                   onChange={e => setEditValue(e.target.value)}
                   onBlur={saveEdit}
                   onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                   onClick={e => e.stopPropagation()}
                 />
              ) : (
                 <div className="flex flex-col items-end gap-1">
                   <span>{(item as any)[id] || '-'}</span>
                   {isSoldOrTraded && hasBuyerData && (
                     <span className="text-[9px] font-medium text-slate-600 truncate max-w-full" title={buyerTitle}>
                       {item.customer?.name || item.ebayUsername || `#${item.ebayOrderId}`}
                     </span>
                   )}
                 </div>
              )}
           </td>
        );
      }
      case 'salePlatform': {
        const isSoldOrTraded = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
        if (!isSoldOrTraded) {
          return (
            <td key={id} className="p-5 text-xs text-slate-300 text-center" style={style}>—</td>
          );
        }
        const missing = isMissingExplicitSalePlatform(item);
        const inferred = missing ? formatItemSalePlatform(item) : null;
        return (
          <td key={id} className="p-3" style={style} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 min-w-0">
              {missing && (
                <span title={`Platform not set${inferred && inferred !== 'Unknown' ? ` (detected: ${inferred})` : ''}`}>
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                </span>
              )}
              <select
                value={item.platformSold || ''}
                onChange={(e) => handleQuickPlatformChange(item, e.target.value as Platform | '')}
                className={`w-full min-w-0 py-1.5 pl-2 pr-6 rounded-lg border text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-400/40 appearance-none bg-no-repeat bg-right ${
                  missing
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`,
                  backgroundPosition: 'right 0.35rem center',
                }}
              >
                <option value="">— Select —</option>
                {SALE_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {missing && inferred && inferred !== 'Unknown' && (
              <p className="text-[9px] text-amber-700 mt-1 truncate" title="Inferred from order ID / payment — pick a platform to confirm">
                Detected: {inferred}
              </p>
            )}
          </td>
        );
      }
      case 'actions':
        return (
          <td
            key={id}
            className="p-5 text-right relative sticky right-0 z-[18] bg-white group-hover/row:bg-slate-50/98 border-l border-slate-200/90 shadow-[-6px_0_12px_-4px_rgba(15,23,42,0.07)]"
            style={style}
          >
            <div className="flex flex-wrap justify-end gap-0.5 opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity max-w-[7.5rem] ml-auto">
              {item.status === ItemStatus.IN_STOCK && (
                 <>
                   <button onClick={(e) => { e.stopPropagation(); navigate('/panel/pricing', { state: { query: item.name } }); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md shrink-0" title="Check Market Price"><Tag size={14}/></button>
                   <button onClick={(e) => { e.stopPropagation(); setItemToCrossPost(item); }} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md shrink-0" title="Cross-Post"><Share2 size={14}/></button>
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
              {(item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) && (
                <button onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setInvoiceViewItem(item); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md shrink-0" title="Generate Invoice"><FileText size={14}/></button>
              )}
              {item.status === ItemStatus.SOLD && (
                <button onClick={(e) => { e.stopPropagation(); setItemToReturn(item); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md shrink-0" title="Mark Unsold / Return"><RotateCcw size={14}/></button>
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
    [visibleColumns, columnWidths]
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

  const hasActiveFilters = statusFilter !== 'ACTIVE' || categoryFilter !== 'ALL' || subCategoryFilter || timeFilter !== 'ALL' || salePlatformFilter !== 'ALL' || salePaymentFilter !== 'ALL' || activeSpecFilterCount > 0 || !showInComposition;
  const clearAllFilters = () => {
    setStatusFilter('ACTIVE');
    setCategoryFilter('ALL');
    setSubCategoryFilter('');
    setTimeFilter('ALL');
    setSalePlatformFilter('ALL');
    setSalePaymentFilter('ALL');
    setSpecFilters({});
    setSpecRangeFilters({});
    setShowInComposition(true);
  };

  const isQuickCategoryPinActive = useCallback(
    (pin: QuickCategoryPin) => categoryFilter === pin.category && subCategoryFilter === pin.subCategory,
    [categoryFilter, subCategoryFilter]
  );

  const applyQuickCategoryPin = useCallback(
    (pin: QuickCategoryPin) => {
      if (isQuickCategoryPinActive(pin)) {
        setCategoryFilter('ALL');
        setSubCategoryFilter('');
      } else {
        setCategoryFilter(pin.category);
        setSubCategoryFilter(pin.subCategory);
      }
    },
    [isQuickCategoryPinActive]
  );

  const addQuickCategoryPin = useCallback((category: string, subCategory: string, label: string) => {
    const id = quickCategoryPinId(category, subCategory);
    const trimmedLabel = label.trim() || subCategory;
    setQuickCategoryPins((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { id, label: trimmedLabel, category, subCategory }];
    });
  }, []);

  const removeQuickCategoryPin = useCallback((id: string) => {
    setQuickCategoryPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const resetQuickCategoryPins = useCallback(() => {
    setQuickCategoryPins(DEFAULT_QUICK_CATEGORY_PINS);
  }, []);

  const selectedHasSoldOrTraded = useMemo(
    () =>
      deferredSelectedIds.some((id) => {
        const s = itemsById.get(id)?.status;
        return s === ItemStatus.SOLD || s === ItemStatus.TRADED;
      }),
    [deferredSelectedIds, itemsById]
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
  ]);

  const bulkSelectionCount = deferredSelectedIds.length;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 overflow-hidden animate-in fade-in relative">
      <header className="shrink-0 space-y-2">
         {/* Compact bar: title + count + search + status + category + time + sales + filters + undo/redo */}
         <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight mr-2">{pageTitle}</h1>
            <span className="text-slate-500 text-sm font-medium py-1">
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
                  onChange={(e) => startTransition(() => setSearchTerm(e.target.value))}
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
                       onMouseDown={(e) => { e.preventDefault(); setSearchTerm(s.text); setSearchSuggestionsOpen(false); searchInputRef.current?.focus(); }}
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
               title={showInComposition ? 'Hide items that are in a PC/bundle composition' : 'Show items that are in a PC/bundle composition'}
            >
               <Hourglass size={11} />
               {showInComposition ? 'In composition: shown' : 'In composition: hidden'}
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
                           <button type="button" title="Reset column widths to defaults" onClick={() => setColumnWidths({ ...DEFAULT_WIDTHS })} className="text-[10px] font-bold text-slate-500 hover:text-blue-600">Widths</button>
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
                                                <button key={String(val)} type="button" onClick={() => { setSpecFilters(prev => { const arr = [...(prev[key] ?? [])]; const isSel = arr.some(a => (typeof a === 'number' && typeof val === 'number' && a === val) || String(a).toLowerCase() === String(val).toLowerCase()); if (isSel) { const idx = arr.findIndex(a => (typeof a === 'number' && typeof val === 'number' && a === val) || String(a).toLowerCase() === String(val).toLowerCase()); if (idx !== -1) arr.splice(idx, 1); } else arr.push(val); const next = { ...prev }; if (arr.length) next[key] = arr; else delete next[key]; return next; }); }} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'}`}>{String(val)}</button>
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
            <div className="flex items-center gap-2">
               <button
                 type="button"
                 onClick={() => setListDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                 className={`p-1.5 rounded-lg border flex items-center gap-1 ${listDensity === 'compact' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                 title={listDensity === 'compact' ? 'Switch to comfortable view' : 'Compact view – denser list'}
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

         {/* Active / Sold tabs + split view */}
         {(statusFilter === 'DRAFTS' || statusFilter === 'ALL') && !splitView ? (
           <div className="flex flex-wrap items-center gap-2">
             <span className="text-xs font-black uppercase tracking-wide text-slate-600 px-1">
               {statusFilter === 'DRAFTS' ? 'Drafts' : 'All items'}
             </span>
             <button
               type="button"
               onClick={() => setStatusFilter('ACTIVE')}
               className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50"
             >
               <Package size={14} /> Back to Active / Sold
             </button>
           </div>
         ) : (
         <div className="flex flex-wrap items-center gap-2">
           <div className="flex rounded-xl lg:rounded-2xl border border-slate-200 bg-white p-1 lg:p-1.5 w-full sm:w-auto">
             <button
               type="button"
               onClick={() => { setStatusFilter('ACTIVE'); setSplitView(false); }}
               className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 lg:px-6 py-2 lg:py-2.5 rounded-lg lg:rounded-xl text-xs lg:text-sm font-black uppercase tracking-wide transition-all min-h-[40px] ${
                 !splitView && statusFilter === 'ACTIVE' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
               }`}
             >
               <Package size={16} className="shrink-0" />
               Active
             </button>
             <button
               type="button"
               onClick={() => { setStatusFilter('SOLD'); setSplitView(false); }}
               className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 lg:px-6 py-2 lg:py-2.5 rounded-lg lg:rounded-xl text-xs lg:text-sm font-black uppercase tracking-wide transition-all min-h-[40px] ${
                 !splitView && statusFilter === 'SOLD' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
               }`}
             >
               <ShoppingBag size={16} className="shrink-0" />
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
             className={`inline-flex items-center justify-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 rounded-xl lg:rounded-2xl border text-xs lg:text-sm font-black uppercase tracking-wide transition-all min-h-[40px] ${
               splitView ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
             }`}
             title="Show active and sold lists side by side"
           >
             <Columns2 size={16} className="shrink-0" />
             Split view
           </button>
           {!splitView && (
             <select
               value={statusFilter === 'DRAFTS' || statusFilter === 'ALL' ? statusFilter : ''}
               onChange={(e) => {
                 const v = e.target.value as StatusFilter;
                 if (v) { setStatusFilter(v); setSplitView(false); }
               }}
               className="py-2 pl-2.5 pr-7 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right"
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
             >
               <option value="">More…</option>
               <option value="DRAFTS">Drafts</option>
               <option value="ALL">All items</option>
             </select>
           )}
         </div>
         )}

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
                     {categoryFilter}{subCategoryFilter ? ` / ${subCategoryFilter}` : ''} <button type="button" onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); }} className="hover:opacity-80">×</button>
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
            <div className="flex flex-wrap items-center gap-2 mt-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-950">
              <AlertTriangle size={14} className="text-amber-600 shrink-0" />
              <span>
                <strong>{missingPlatformSoldCount}</strong> sold item{missingPlatformSoldCount === 1 ? '' : 's'} without a platform — use the <strong>Sold on</strong> column or filter below.
              </span>
              <button
                type="button"
                onClick={() => setSalePlatformFilter(MISSING_PLATFORM_FILTER)}
                className="ml-auto px-2.5 py-1 rounded-lg bg-amber-200/80 font-bold hover:bg-amber-300/80"
              >
                Show only missing
              </button>
            </div>
         )}

         {/* Quick category shortcuts */}
         <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/60 mt-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider shrink-0 mr-0.5">Categories</span>
            {quickCategoryPins.map((pin) => {
              const active = isQuickCategoryPinActive(pin);
              return (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => applyQuickCategoryPin(pin)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:border-slate-300'
                  }`}
                  title={`${pin.category} › ${pin.subCategory}`}
                >
                  {pin.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowQuickCategoryPicker(true)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-dashed border-slate-300 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
              title="Add category shortcut"
              aria-label="Add category shortcut"
            >
              <Plus size={14} />
            </button>
         </div>

         {/* Quick spec filters: dropdowns for top spec keys when category has specs */}
         {specOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60 mt-2">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Specs</span>
               {specOptions.slice(0, 8).filter(o => !o.isNumeric || (o.values.length <= 20)).map(({ key, values }) => (
                  <select
                     key={key}
                     value={specFilters[key]?.[0] ?? ''}
                     onChange={(e) => {
                        const v = e.target.value;
                        setSpecFilters(prev => {
                           const n = { ...prev };
                           if (v === '') { delete n[key]; return n; }
                           n[key] = [v];
                           return n;
                        });
                     }}
                     className="py-1.5 pl-2 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[90px]"
                     style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
                  >
                     <option value="">{key}: All</option>
                     {values.map((val) => (
                        <option key={String(val)} value={String(val)}>{String(val)}</option>
                     ))}
                  </select>
               ))}
            </div>
         )}
      </header>

      <div className="shrink-0">
        <InventoryAISpecsPanel
          items={items}
          selectedIds={deferredSelectedIds}
          categoryFields={categoryFields ?? {}}
          onUpdate={(updated) => onUpdate(updated)}
        />
      </div>

      {/* Toast notification for quick actions (e.g. copy listing text) */}
      {toast && (
        <div className={`pointer-events-none fixed z-[180] ${selectedIds.length > 0 ? 'top-4 right-4' : 'bottom-6 right-6 max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))]'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900 text-white text-xs font-bold shadow-lg shadow-slate-900/30">
            <Check size={14} className="text-emerald-400" />
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* FINANCIAL STATS DASHBOARD - Only visible in Sold/All View */}
      {showFinancials && financialStats && (
         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm mb-2 flex flex-col xl:flex-row gap-6 items-center justify-between animate-in slide-in-from-top-4 shrink-0">
            <div className="flex flex-wrap justify-center gap-8">
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Sales (Gross)</p>
                  <p className="text-2xl font-black text-slate-900">€{formatEUR(financialStats.totalGross)}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Taxes Paid (VAT)</p>
                  <p className="text-2xl font-black text-red-500">-€{formatEUR(financialStats.totalTax)}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Sold Before Tax</p>
                  <p className="text-2xl font-black text-blue-600">€{formatEUR(financialStats.totalNetRevenue)}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Net Profit</p>
                  <p className={`text-2xl font-black ${financialStats.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                     {financialStats.totalProfit >= 0 ? '+' : ''}€{formatEUR(financialStats.totalProfit)}
                  </p>
               </div>
            </div>

            <div className="bg-slate-50 p-1.5 rounded-2xl flex items-center shadow-inner">
                <button
                    onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'SmallBusiness' })}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${businessSettings.taxMode === 'SmallBusiness' ? 'bg-white shadow text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Kleinunternehmer
                </button>
                <button
                    onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'DifferentialVAT' })}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${businessSettings.taxMode === 'DifferentialVAT' ? 'bg-white shadow text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Diff. Tax
                </button>
                <button
                    onClick={() => onBusinessSettingsChange({ ...businessSettings, taxMode: 'RegularVAT' })}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${businessSettings.taxMode === 'RegularVAT' ? 'bg-white shadow text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Regular VAT
                </button>
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
            sortedItems.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                <div className="flex gap-3 items-start">
                  <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover border border-slate-100 shrink-0" size={48} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm leading-snug">{item.name}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Sold {item.sellDate || '—'} · €{item.sellPrice != null ? formatEUR(item.sellPrice) : '—'}
                      {item.profit != null && (
                        <span className={item.profit >= 0 ? ' text-emerald-600' : ' text-red-600'}>
                          {' '}· {item.profit >= 0 ? '+' : ''}€{formatEUR(item.profit)}
                        </span>
                      )}
                    </p>
                    {(item.customer?.name || item.ebayUsername) && (
                      <p className="text-[10px] text-slate-500 mt-1 truncate">
                        {item.customer?.name}{item.ebayUsername ? ` · ${item.ebayUsername}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[9px] font-black uppercase text-slate-400">Sold on</label>
                  <select
                    value={item.platformSold || ''}
                    onChange={(e) => handleQuickPlatformChange(item, e.target.value as Platform | '')}
                    className={`text-xs font-bold rounded-lg border px-2 py-1.5 flex-1 min-w-[8rem] ${
                      isMissingExplicitSalePlatform(item) ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <option value="">—</option>
                    {SALE_PLATFORM_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
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
            ))
          )}
        </div>
      )}

      {/* Table scrolls in remaining height; bulk bar is a separate row below (never overlays rows) */}
      <style>{`
        [data-inventory-table] tbody > tr > td { padding: 0.45rem 0.4rem !important; }
        [data-inventory-table] tbody > tr > td.inv-col-icons { padding: 0.5rem 0.55rem !important; }
        [data-inventory-table] thead th > div:first-of-type { padding: 0.45rem 0.4rem !important; min-height: 2rem !important; }
        [data-inventory-table] thead th { font-size: 0.625rem; letter-spacing: 0.04em; }
        [data-density="compact"][data-inventory-table] tbody > tr > td { padding: 0.28rem 0.22rem !important; }
        [data-density="compact"][data-inventory-table] thead th > div:first-of-type { padding: 0.28rem 0.22rem !important; min-height: 1.65rem !important; }
        [data-density="compact"] .text-sm { font-size: 0.7rem; }
        [data-density="compact"] .text-xs { font-size: 0.65rem; }
      `}</style>
      {splitView ? (
        <div className="flex flex-1 min-h-0 gap-2 flex-col lg:flex-row">
          <InventoryListTablePane
            paneItems={sortedActiveItems}
            paneStatus="ACTIVE"
            paneLabel="Active"
            scrollRef={activeTableRef}
            visibleColumns={visibleColumns}
            columnWidths={columnWidths}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onSelectAll={() => handleSelectAllFor(sortedActiveItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={selectedIds.length > 0}
          />
          <InventoryListTablePane
            paneItems={sortedSoldItems}
            paneStatus="SOLD"
            paneLabel="Sold"
            scrollRef={soldTableRef}
            visibleColumns={visibleColumns}
            columnWidths={columnWidths}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onSelectAll={() => handleSelectAllFor(sortedSoldItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={selectedIds.length > 0}
          />
        </div>
      ) : (
        <InventoryListTablePane
          paneItems={sortedItems}
          paneStatus={statusFilter}
          scrollRef={tableContainerRef}
          visibleColumns={visibleColumns}
          columnWidths={columnWidths}
          listDensity={listDensity}
          sortConfig={sortConfig}
          handleHeaderSort={handleHeaderSort}
          handleColumnResizeStart={handleColumnResizeStart}
          onSelectAll={handleSelectAll}
          selectedIdSet={selectedIdSet}
          renderRowCells={renderRowCells}
          getRowActivityKey={getRowActivityKey}
          rowHeightEstimate={rowHeightEstimate}
          bulkBarSpacer={selectedIds.length > 0}
          className={statusFilter === 'SOLD' ? 'hidden lg:flex flex-1' : 'flex flex-1'}
        />
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
          <div className="bg-slate-50 w-full max-w-4xl rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden flex flex-col h-[80vh] relative">
            <button
              onClick={() => setShowNewItemModal(false)}
              className="absolute top-6 right-6 z-50 p-2 bg-white rounded-full shadow-lg text-slate-400 hover:text-slate-900 hover:scale-110 transition-all"
            >
              <X size={20} />
            </button>
            <div className="flex-1 overflow-hidden p-8">
              <ItemForm
                items={items}
                onSave={(created) => {
                  onUpdate(created);
                  setShowNewItemModal(false);
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

      {itemToSell && (
         <SaleModal 
            item={itemToSell} 
            taxMode={businessSettings.taxMode}
            onSave={(updated) => { 
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
               } else {
                 onUpdate([updated]); 
               }
               setItemToSell(null); 
            }} 
            onClose={() => setItemToSell(null)} 
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
                  {bundleToDismantle.subCategory === 'Retro Bundle' 
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

type InventoryTableBodyProps = {
  sortedItems: InventoryItem[];
  selectedIdSet: Set<string>;
  visibleColumns: ColumnId[];
  renderRowCells: (item: InventoryItem, isSelected: boolean) => React.ReactNode;
  getRowActivityKey: (item: InventoryItem) => string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowHeightEstimate: number;
  bulkBarSpacer: boolean;
};

const InventoryTableBody = React.memo(function InventoryTableBody({
  sortedItems,
  selectedIdSet,
  visibleColumns,
  renderRowCells,
  getRowActivityKey,
  scrollRef,
  rowHeightEstimate,
  bulkBarSpacer,
}: InventoryTableBodyProps) {
  const useVirtual = sortedItems.length > INVENTORY_VIRTUAL_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeightEstimate,
    overscan: 5,
    getItemKey: (index) => sortedItems[index]?.id ?? index,
  });

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

  return (
    <tbody
      className="divide-y divide-slate-50"
      style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const item = sortedItems[virtualRow.index]!;
        return (
          <InventoryTableRow
            key={item.id}
            item={item}
            isSelected={selectedIdSet.has(item.id)}
            visibleColumns={visibleColumns}
            renderRowCells={renderRowCells}
            rowActivityKey={getRowActivityKey(item)}
            rowTranslateY={virtualRow.start}
          />
        );
      })}
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
  rowTranslateY?: number;
};

const InventoryTableRow = React.memo(
  function InventoryTableRow({ item, isSelected, renderRowCells, rowTranslateY }: InventoryTableRowProps) {
    const virtualized = rowTranslateY !== undefined;
    return (
      <tr
        style={
          virtualized
            ? {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translate3d(0, ${rowTranslateY}px, 0)`,
                contain: 'layout style paint',
              }
            : undefined
        }
        className={`hover:bg-slate-50/50 group/row ${isSelected ? 'bg-blue-50/20' : ''}`}
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
    prev.renderRowCells === next.renderRowCells &&
    prev.rowTranslateY === next.rowTranslateY
);

type InventoryListTablePaneProps = {
  paneItems: InventoryItem[];
  paneStatus: StatusFilter;
  paneLabel?: string;
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
  rowHeightEstimate: number;
  bulkBarSpacer: boolean;
  className?: string;
};

const InventoryListTablePane: React.FC<InventoryListTablePaneProps> = ({
  paneItems,
  paneStatus,
  paneLabel,
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
  rowHeightEstimate,
  bulkBarSpacer,
  className = 'flex flex-1',
}) => {
  const timeGaugeTitle =
    paneStatus === 'SOLD' ? 'Sale speed' : paneStatus === 'ACTIVE' ? 'Stock age' : 'Hold / sale';
  const paneSelectedCount = paneItems.filter((i) => selectedIdSet.has(i.id)).length;
  const allPaneSelected = paneItems.length > 0 && paneSelectedCount === paneItems.length;

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 rounded-[2.5rem] border border-slate-100 shadow-sm bg-white overflow-hidden ${className}`}
    >
      {paneLabel && (
        <div className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-2.5 border-b border-slate-100 bg-slate-50/60">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">{paneLabel}</span>
          <span className="text-[10px] font-bold text-slate-400">{paneItems.length} items</span>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-auto custom-scrollbar pb-3">
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
                    className={`relative p-0 align-middle bg-slate-50/80 ${stickyActions ? 'sticky right-0 z-[40] shadow-[-8px_0_14px_-6px_rgba(15,23,42,0.1)] border-l border-slate-200/90' : ''}`}
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
                      className={`p-5 pr-2 flex items-center min-h-[3rem] ${sortable ? 'cursor-pointer hover:bg-slate-100/90' : ''} ${['buyPrice', 'sellPrice', 'profit', 'buyDate', 'sellDate', 'actions'].includes(colId) ? 'justify-end' : colId === 'parseSpecs' || colId === 'timeGauge' ? 'justify-center' : ''}`}
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
                        <span className="flex items-center gap-1" title="Parse tech specs with AI">
                          <Sparkles size={12} className="text-amber-500" /> Parse
                        </span>
                      ) : colId === 'timeGauge' ? (
                        <span
                          className="flex items-center justify-center gap-1 w-full"
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
                          {ALL_COLUMNS.find((c) => c.id === colId)?.label}
                          {(sortConfig.key === colId || (colId === 'item' && sortConfig.key === 'name')) && (
                            <span className="text-blue-500">
                              {sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${ALL_COLUMNS.find((c) => c.id === colId)?.label || colId} column`}
                      title="Drag to resize column"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 shrink-0 hover:bg-blue-500/35 active:bg-blue-500/50 border-r border-transparent hover:border-blue-400/40"
                      onMouseDown={(e) => handleColumnResizeStart(e, colId)}
                      onClick={(e) => e.stopPropagation()}
                    />
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
            scrollRef={scrollRef}
            rowHeightEstimate={rowHeightEstimate}
            bulkBarSpacer={bulkBarSpacer}
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
  const [pickSub, setPickSub] = useState(() => (categories[pickCategory]?.[0] ?? ''));
  const [pickLabel, setPickLabel] = useState('');

  useEffect(() => {
    const subs = categories[pickCategory] ?? [];
    const nextSub = subs[0] ?? '';
    setPickSub(nextSub);
    setPickLabel(nextSub);
  }, [pickCategory, categories]);

  const pickId = pickSub ? quickCategoryPinId(pickCategory, pickSub) : '';
  const alreadyPinned = pickId ? pins.some((p) => p.id === pickId) : false;

  const handleAdd = () => {
    if (!pickCategory || !pickSub || alreadyPinned) return;
    onAdd(pickCategory, pickSub, pickLabel.trim() || pickSub);
    setPickLabel('');
  };

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
            <label className="text-[10px] font-black uppercase text-slate-400 ml-0.5">Subcategory</label>
            <select
              value={pickSub}
              onChange={(e) => setPickSub(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/30"
            >
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
              placeholder={pickSub || 'Short label'}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400/30"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!pickSub || alreadyPinned}
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
                    <span className="block text-[10px] text-slate-500 truncate">{pin.category} › {pin.subCategory}</span>
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
