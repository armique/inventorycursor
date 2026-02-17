import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Edit2, Search, CheckSquare, Square, X, Check, Trash2, Calendar, Handbag, Package, Plus, Minus, Receipt, Monitor, ArrowUp, ArrowDown, ArrowUpDown, Tag, Info, Layers, ListTree, ChevronRight, ShoppingBag, Settings2, RotateCcw, RotateCw, HeartCrack, ListPlus, ArrowRightLeft, Archive, History, MoreHorizontal,   Filter, FilterX, TrendingUp, Wallet, Download, FileSpreadsheet, Globe, CreditCard, Hourglass, AlertCircle, XCircle, Hammer, Share2, Copy, Sliders, Image as ImageIcon, FileText, Clock, Upload, Percent, CalendarRange, Wrench, Loader2, FolderInput, CalendarDays, Eye, Unlink, BoxSelect, ChevronUp, ChevronDown, StickyNote, ListChecks, Sparkles
} from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings, Platform, PaymentType } from '../types';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { getCompatibleItemsForItem } from '../services/compatibility';
import { generateKleinanzeigenCSV } from '../services/ebayCsvService';
import { generateStoreDescription } from '../services/specsAI';
import SaleModal from './SaleModal';
import ReturnModal from './ReturnModal';
import TradeModal from './TradeModal';
import CrossPostingModal from './CrossPostingModal';
import RetroBundleModal from './RetroBundleModal';
import EditItemModal from './EditItemModal';
import ItemThumbnail from './ItemThumbnail';
import InventoryAISpecsPanel from './InventoryAISpecsPanel';
import { generateItemSpecs } from '../services/specsAI';

interface Props {
  items: InventoryItem[];
  totalCount: number;
  onUpdate: (items: InventoryItem[], deleteIds?: string[]) => void;
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

type ColumnId = 'select' | 'item' | 'presence' | 'parseSpecs' | 'category' | 'status' | 'buyPrice' | 'sellPrice' | 'profit' | 'buyDate' | 'sellDate' | 'actions';
type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';
type StatusFilter = 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 50,
  item: 260,
  presence: 80,
  parseSpecs: 52,
  category: 160,
  status: 120,
  buyPrice: 120,
  sellPrice: 120,
  profit: 120,
  buyDate: 130,
  sellDate: 130,
  actions: 140
};

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
  { id: 'sellDate', label: 'Sold Date' },
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
  
  // -- PERSISTENT STATE LOADING --
  const loadState = <T,>(key: string, defaultVal: T): T => {
    const saved = localStorage.getItem(`${persistenceKey}_${key}`);
    if (saved) return JSON.parse(saved);
    return defaultVal;
  };

  const [searchTerm, setSearchTerm] = useState(() => loadState<string>('search', ''));
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => loadState<TimeFilter>('time', 'ALL'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => loadState<StatusFilter>('status_filter', 'ACTIVE'));
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
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadState('widths', DEFAULT_WIDTHS));

  // -- INLINE EDITING STATE --
  const [editingCell, setEditingCell] = useState<{ itemId: string, field: ColumnId } | null>(null);
  const [editValue, setEditValue] = useState<string | number>('');
  const [parsingSingleId, setParsingSingleId] = useState<string | null>(null);

  // -- STATE PERSISTENCE EFFECTS --
  useEffect(() => localStorage.setItem(`${persistenceKey}_search`, JSON.stringify(searchTerm)), [searchTerm, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_time`, JSON.stringify(timeFilter)), [timeFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_status_filter`, JSON.stringify(statusFilter)), [statusFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_category_filter`, JSON.stringify(categoryFilter)), [categoryFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_subcategory_filter`, JSON.stringify(subCategoryFilter)), [subCategoryFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_sort_config`, JSON.stringify(sortConfig)), [sortConfig, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_widths`, JSON.stringify(columnWidths)), [columnWidths, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_sale_platform`, JSON.stringify(salePlatformFilter)), [salePlatformFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_sale_payment`, JSON.stringify(salePaymentFilter)), [salePaymentFilter, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_spec_filters`, JSON.stringify(specFilters)), [specFilters, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_spec_range_filters`, JSON.stringify(specRangeFilters)), [specRangeFilters, persistenceKey]);
  useEffect(() => localStorage.setItem(`${persistenceKey}_show_in_composition`, JSON.stringify(showInComposition)), [showInComposition, persistenceKey]);

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

  const [showBulkSalesEdit, setShowBulkSalesEdit] = useState(false);
  const [showBulkCategoryEdit, setShowBulkCategoryEdit] = useState(false);
  const [showBulkStoreVisible, setShowBulkStoreVisible] = useState(false);
  const [showBulkSalePct, setShowBulkSalePct] = useState(false);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkGenerateDescriptions, setBulkGenerateDescriptions] = useState(false);
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<string | null>(null);
  const [showRetroBundle, setShowRetroBundle] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

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

  // -- VIRTUALIZATION / PERFORMANCE --
  const [visibleCount, setVisibleCount] = useState(50);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Reset visual count when filters change to ensure user sees top results
  useEffect(() => {
    setVisibleCount(50);
    if(tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
  }, [searchTerm, timeFilter, sortConfig, statusFilter, categoryFilter, subCategoryFilter, salePlatformFilter, salePaymentFilter, specFilters, specRangeFilters]);

  // Infinite Scroll Handler
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      setVisibleCount(prev => prev + 20);
    }
  };
  
  // Visible Columns
  const visibleColumns: ColumnId[] = ['select', 'item', 'presence', 'parseSpecs', 'category', 'status', 'buyPrice', 'sellPrice', 'profit', 'buyDate', 'sellDate', 'actions'];

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
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.category.toLowerCase().includes(searchTerm.toLowerCase()) || item.vendor?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (timeFilter !== 'ALL') {
        const isSalesItem = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
        const dateStr = isSalesItem ? item.sellDate : item.buyDate;
        if (!dateStr) return false;
        const itemDate = new Date(dateStr);
        if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
      }
      if (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS') {
        if (salePlatformFilter !== 'ALL' && item.platformSold !== salePlatformFilter) return false;
        if (salePaymentFilter !== 'ALL' && item.paymentType !== salePaymentFilter) return false;
      }
      return true;
    });
  }, [items, searchTerm, statusFilter, categoryFilter, subCategoryFilter, timeFilter, dateRange, salePlatformFilter, salePaymentFilter, showInComposition]);

  // Available spec keys and unique values (from base-filtered items) for the Filters panel
  const specOptions = useMemo(() => {
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
  }, [baseFilteredForSpecs]);

  // Filtering & Sorting
  const sortedItems = useMemo(() => {
    let filtered = items.filter(item => {
      // 1. Status Filter
      let matchesStatus = false;
      if (statusFilter === 'ACTIVE') {
         // Include drafts in active too, but Drafts tab is specific
         matchesStatus = item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED || item.status === ItemStatus.IN_COMPOSITION;
      } else if (statusFilter === 'SOLD') {
         matchesStatus = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
      } else if (statusFilter === 'DRAFTS') {
         matchesStatus = item.isDraft === true;
      } else {
         matchesStatus = true; // ALL
      }
      
      if (!matchesStatus) return false;

      // Optional visibility toggle for "In Composition" items
      if (!showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;

      // 2. Category Filter (align with PC Builder: e.g. "Processors" shows both category=Components+subCategory=Processors AND category=Processors)
      if (categoryFilter !== 'ALL' || subCategoryFilter) {
         const matchParentAndSub = categoryFilter !== 'ALL' && item.category === categoryFilter && (!subCategoryFilter || item.subCategory === subCategoryFilter);
         const matchSubAsTopLevel = subCategoryFilter && item.category === subCategoryFilter; // items stored with Processors as category
         if (!matchParentAndSub && !matchSubAsTopLevel) return false;
      }

      // 3. Search Filter
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            item.vendor?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      // 4. Time Filter
      if (timeFilter !== 'ALL') {
        const isSalesItem = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
        const dateStr = isSalesItem ? item.sellDate : item.buyDate;
        if (!dateStr) return false;
        const itemDate = new Date(dateStr);
        if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
      }

      // 5. Sales Info Filters (Only apply if we are looking at Sold items or All)
      if (statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS') {
         if (salePlatformFilter !== 'ALL') {
            if (item.platformSold !== salePlatformFilter) return false;
         }
         if (salePaymentFilter !== 'ALL') {
            if (item.paymentType !== salePaymentFilter) return false;
         }
      }

      // 6. Spec value filters (multi-select: item must match one of selected values per key)
      for (const key of Object.keys(specFilters)) {
        const allowed = specFilters[key];
        if (!allowed || allowed.length === 0) continue;
        const v = item.specs?.[key];
        if (v === undefined || v === null) return false;
        const match = allowed.some(a => {
          if (typeof v === 'number' && typeof a === 'number') return v === a;
          return String(v).trim().toLowerCase() === String(a).trim().toLowerCase();
        });
        if (!match) return false;
      }

      // 7. Spec range filters (numeric min/max)
      for (const key of Object.keys(specRangeFilters)) {
        const { min, max } = specRangeFilters[key] || {};
        if (min === undefined && max === undefined) continue;
        const v = item.specs?.[key];
        const num = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(String(v)) : NaN);
        if (isNaN(num)) return false;
        if (min !== undefined && num < min) return false;
        if (max !== undefined && num > max) return false;
      }

      return true;
    });

    // Sorting Logic
    filtered.sort((a, b) => {
      const key = sortConfig.key === 'item' ? 'name' : sortConfig.key;
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      
      let valA: any = (a as any)[key];
      let valB: any = (b as any)[key];

      // Handle Dates (Parse to timestamp)
      if (key === 'buyDate' || key === 'sellDate') {
         valA = valA ? new Date(valA).getTime() : 0;
         valB = valB ? new Date(valB).getTime() : 0;
         return (valA - valB) * dir;
      }

      // Handle Numbers
      if (typeof valA === 'number' || typeof valB === 'number') {
         valA = valA || 0;
         valB = valB || 0;
         return (valA - valB) * dir;
      }

      // Handle Strings
      valA = valA ? valA.toString().toLowerCase() : '';
      valB = valB ? valB.toString().toLowerCase() : '';
      
      return valA.localeCompare(valB) * dir;
    });

    return filtered;
  }, [items, searchTerm, statusFilter, categoryFilter, subCategoryFilter, sortConfig, timeFilter, dateRange, salePlatformFilter, salePaymentFilter, specFilters, specRangeFilters, showInComposition]);

  const visibleItems = useMemo(() => sortedItems.slice(0, visibleCount), [sortedItems, visibleCount]);
  const showFinancials = statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS';

  const compatibleCountByItemId = useMemo(() => {
    const map = new Map<string, number>();
    const partTypes = ['Processors', 'Motherboards', 'RAM'];
    items.forEach((item) => {
      if (!partTypes.includes(item.subCategory || '') && !partTypes.includes(item.category || '')) return;
      const groups = getCompatibleItemsForItem(item, items);
      const total = groups.reduce((sum, g) => sum + g.items.length, 0);
      if (total > 0) map.set(item.id, total);
    });
    return map;
  }, [items]);

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

    sortedItems.filter(i => i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED).forEach(item => {
        const sell = item.sellPrice || 0;
        const buy = item.buyPrice || 0;
        const fee = item.feeAmount || 0;
        
        let tax = 0;
        let netSell = sell;

        if (businessSettings.taxMode === 'RegularVAT') {
            netSell = sell / 1.19;
            tax = sell - netSell;
        } else if (businessSettings.taxMode === 'DifferentialVAT') {
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
        totalProfit += (netSell - buy - fee);
    });

    return { totalGross, totalTax, totalNetRevenue, totalProfit };
  }, [sortedItems, businessSettings.taxMode, showFinancials]);

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

  const startEditing = (item: InventoryItem, field: ColumnId, value: string | number) => {
    setEditingCell({ itemId: item.id, field });
    setEditValue(value || '');
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const { itemId, field } = editingCell;
    const item = items.find(i => i.id === itemId);
    if (!item) {
        setEditingCell(null);
        return;
    }

    let newValue: any = editValue;

    if (field === 'buyPrice' || field === 'sellPrice') {
       newValue = parseFloat(editValue.toString());
       if (isNaN(newValue)) newValue = 0;
    }

    const updates: Partial<InventoryItem> = { [field]: newValue };

    if ((field === 'buyPrice' || field === 'sellPrice') && (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED)) {
        const b = field === 'buyPrice' ? newValue : item.buyPrice;
        const s = field === 'sellPrice' ? newValue : (item.sellPrice || 0);
        const fee = item.feeAmount || 0;
        updates.profit = s - b - fee;
    }

    // Logic to release from composition if status is changed manually
    if (field === 'status') {
        if (item.status === ItemStatus.IN_COMPOSITION && newValue !== ItemStatus.IN_COMPOSITION) {
            updates.parentContainerId = undefined; // Detach from parent
        }
    }

    onUpdate([{ ...item, ...updates }]);
    setEditingCell(null);
  };

  const handleSelectAll = () => {
    if (selectedIds.length === sortedItems.length && sortedItems.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sortedItems.map(i => i.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleDuplicate = (item: InventoryItem) => {
    const copy: InventoryItem = {
      ...item,
      id: `copy-${Date.now()}`,
      name: `${item.name} (Copy)`,
      status: ItemStatus.IN_STOCK,
      sellPrice: undefined,
      sellDate: undefined,
      profit: undefined,
      ebaySku: undefined,
      ebayOfferId: undefined
    };
    onUpdate([copy]);
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
           const text = await generateStoreDescription(selected[i].name, selected[i].storeDescription || undefined);
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

  const renderCell = (item: InventoryItem, id: ColumnId) => {
    const width = columnWidths[id] || DEFAULT_WIDTHS[id];
    const style = { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };

    switch (id) {
      case 'select':
        return (
          <td key={id} className="p-5 text-center" style={style}>
             <div onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }} className={`w-5 h-5 mx-auto border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all ${selectedIds.includes(item.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 hover:border-blue-400'}`}>
                {selectedIds.includes(item.id) && <Check size={12}/>}
             </div>
          </td>
        );
      case 'presence':
        return (
          <td key={id} className="p-5 text-center" style={style} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => togglePresence(item)}
              className={`inline-flex items-center justify-center w-10 px-2 py-1 rounded-full border text-[11px] font-bold ${
                item.presence === 'present'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                  : item.presence === 'lost'
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
              title={
                item.presence === 'present'
                  ? 'Present (click to mark as lost)'
                  : item.presence === 'lost'
                  ? 'Lost (click to clear)'
                  : 'Not checked (click to mark as present)'
              }
            >
              {item.presence === 'present' ? '+' : item.presence === 'lost' ? '−' : '·'}
            </button>
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
        return (
          <td key={id} className="p-5" style={style} onClick={() => handleEditClick(item)}>
             <div className="flex items-center gap-4 cursor-pointer group/cell">
                <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover shadow-sm border border-slate-100" size={48} />
                <div className="flex-1 min-w-0">
                   <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900 truncate group-hover/cell:text-blue-600 transition-colors flex-1">{item.name}</p>
                      {(item.isPC || item.isBundle) && childItems.length > 0 && (
                         <button
                            onClick={toggleExpand}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            title={isExpanded ? "Collapse components" : "Expand to show components"}
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
                      <span className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.vendor}</span>
                      {(item.isPC || item.isBundle) && childItems.length > 0 && (
                         <span className="text-[9px] text-slate-500 font-medium">({childItems.length} items)</span>
                      )}
                   </div>
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
                         {childItems.map(child => (
                            <div key={child.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50 p-2 rounded-lg">
                               <span className="font-medium text-slate-700 truncate flex-1">{child.name}</span>
                               <div className="flex items-center gap-3 text-[10px] text-slate-500 shrink-0">
                                  {child.buyDate && (
                                     <span className="flex items-center gap-1">
                                        <Calendar size={10} />
                                        Buy: {new Date(child.buyDate).toLocaleDateString()}
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
                         ))}
                      </div>
                   )}
                </div>
             </div>
          </td>
        );
      case 'parseSpecs':
        return (
          <td key={id} className="p-5 text-center" style={style} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => handleParseSingleItem(item)}
              disabled={parsingSingleId !== null}
              title="Parse tech specs with AI (can correct name)"
              className={`p-2 rounded-xl transition-colors ${parsingSingleId === item.id ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-700'}`}
            >
              {parsingSingleId === item.id ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            </button>
          </td>
        );
      case 'category':
        return (
          <td key={id} className="p-5" style={style}>
             <div 
               onClick={(e) => { e.stopPropagation(); setItemToEditCategory(item); }}
               className="group/cat cursor-pointer hover:bg-slate-100 rounded-lg p-2 -m-2 transition-colors"
               title="Click to reclassify"
             >
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-tight group-hover/cat:text-blue-600 flex items-center gap-1">
                   {item.category}
                   <Edit2 size={10} className="opacity-0 group-hover/cat:opacity-100 transition-opacity"/>
                </p>
                {item.subCategory && <p className="text-[9px] font-bold text-slate-400 group-hover/cat:text-blue-400 truncate">{item.subCategory}</p>}
             </div>
          </td>
        );
      case 'status':
        const isEditingStatus = editingCell?.itemId === item.id && editingCell?.field === 'status';
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
                   className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all ${
                      item.status === ItemStatus.SOLD ? 'bg-purple-100 text-purple-700' :
                      item.status === ItemStatus.IN_STOCK ? 'bg-emerald-100 text-emerald-700' :
                      item.status === ItemStatus.TRADED ? 'bg-indigo-100 text-indigo-700' :
                      item.status === ItemStatus.IN_COMPOSITION ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                   }`}
                   title="Double click to change status"
                >
                   {item.status}
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
                 type="number"
                 step="0.01"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               `€${item.buyPrice.toFixed(2)}`
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
                 type="number"
                 step="0.01"
                 className="w-20 bg-white border-2 border-blue-500 rounded-lg px-2 py-1 text-right outline-none text-xs font-bold shadow-lg"
                 value={editValue}
                 onChange={e => setEditValue(e.target.value)}
                 onBlur={saveEdit}
                 onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditingCell(null); }}
                 onClick={e => e.stopPropagation()}
               />
            ) : (
               item.sellPrice ? `€${item.sellPrice.toFixed(2)}` : '-'
            )}
          </td>
        );
      case 'profit':
        return (
          <td key={id} className={`p-5 text-right font-black ${item.profit && item.profit > 0 ? 'text-emerald-600' : item.profit && item.profit < 0 ? 'text-red-500' : 'text-slate-300'}`} style={style}>
             {item.profit ? `€${item.profit.toFixed(2)}` : '-'}
          </td>
        );
      case 'buyDate':
      case 'sellDate':
        // Bundles/PCs don't have buyDate - show "-" and tooltip
        if ((item.isPC || item.isBundle) && id === 'buyDate') {
          return (
            <td key={id} className="p-5 text-right text-xs font-bold text-slate-300" style={style} title="Bundles/PCs don't have buy dates. Expand to see component buy dates.">
              -
            </td>
          );
        }
        const isEditingDate = editingCell?.itemId === item.id && editingCell?.field === id;
        return (
           <td 
             key={id} 
             className="p-5 text-right text-xs font-bold text-slate-500 cursor-pointer hover:bg-blue-50/30 transition-colors" 
             style={style}
             title="Double click to edit"
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
                 (item as any)[id] || '-'
              )}
           </td>
        );
      case 'actions':
        return (
          <td key={id} className="p-5 text-right relative" style={style}>
            <div className="flex justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
              {item.status === ItemStatus.IN_STOCK && (
                 <>
                   <button onClick={(e) => { e.stopPropagation(); navigate('/panel/pricing', { state: { query: item.name } }); }} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded" title="Check Market Price"><Tag size={16}/></button>
                   <button onClick={(e) => { e.stopPropagation(); setItemToCrossPost(item); }} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded" title="Cross-Post"><Share2 size={16}/></button>
                 </>
              )}
              <button onClick={(e) => { e.stopPropagation(); handleEditClick(item); }} className="p-2 text-slate-500 hover:bg-slate-100 rounded" title="Edit">
                 <Edit2 size={16}/>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleDuplicate(item); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded" title="Duplicate Item">
                 <Copy size={16}/>
              </button>
              {(item.isPC || item.isBundle) && (
                 <button onClick={(e) => { e.stopPropagation(); setBundleToDismantle(item); }} className="p-2 text-purple-600 hover:bg-purple-50 rounded" title="Unbundle / Dismantle"><Unlink size={16}/></button>
              )}
              {item.status === ItemStatus.IN_STOCK && <button onClick={(e) => { e.stopPropagation(); setItemToSell(item); }} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded" title="Mark Sold"><ShoppingBag size={16}/></button>}
              {item.status === ItemStatus.IN_STOCK && <button onClick={(e) => { e.stopPropagation(); setItemToTrade(item); }} className="p-2 text-purple-600 hover:bg-purple-50 rounded" title="Trade"><ArrowRightLeft size={16}/></button>}
              {item.status === ItemStatus.SOLD && (
                <button onClick={(e) => { e.stopPropagation(); setItemToReturn(item); }} className="p-2 text-amber-600 hover:bg-amber-50 rounded" title="Mark Unsold / Return"><RotateCcw size={16}/></button>
              )}
              <button onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }} className="p-2 text-slate-300 hover:text-red-500 rounded" title="Delete"><Trash2 size={16}/></button>
            </div>
          </td>
        );
      default: return null;
    }
  };

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

  return (
    <div className="space-y-4 animate-in fade-in pb-4 relative h-full flex flex-col">
      <header className="shrink-0 space-y-2">
         {/* Compact bar: title + count + search + status + category + time + sales + filters + undo/redo */}
         <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight mr-2">{pageTitle}</h1>
            <span className="text-slate-500 text-sm font-medium py-1">{sortedItems.length} items{timeFilter !== 'ALL' ? ' · period' : ''}</span>
            <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-[220px] relative">
               <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
               <input
                  type="text"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
               />
            </div>
            <select
               value={statusFilter}
               onChange={e => setStatusFilter(e.target.value as StatusFilter)}
               className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right"
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}
            >
               <option value="ACTIVE">Active</option>
               <option value="SOLD">Sold</option>
               <option value="DRAFTS">Drafts</option>
               <option value="ALL">All</option>
            </select>
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
            {statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS' && (
               <>
                  <select value={salePlatformFilter} onChange={e => setSalePlatformFilter(e.target.value)} className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}>
                      <option value="ALL">Platform</option>
                      <option value="kleinanzeigen.de">Kleinanzeigen</option>
                      <option value="ebay.de">eBay</option>
                      <option value="Other">Other</option>
                  </select>
                  <select value={salePaymentFilter} onChange={e => setSalePaymentFilter(e.target.value)} className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.35rem center' }}>
                      <option value="ALL">Payment</option>
                      {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
               </>
            )}
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
            <div className="flex gap-1">
               <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Undo"><RotateCcw size={14} /></button>
               <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Redo"><RotateCw size={14} /></button>
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
                     {salePlatformFilter !== 'ALL' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">{salePlatformFilter} <button type="button" onClick={() => setSalePlatformFilter('ALL')} className="hover:opacity-80">×</button></span>}
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

      <InventoryAISpecsPanel
        items={items}
        selectedIds={selectedIds}
        categoryFields={categoryFields ?? {}}
        onUpdate={(updated) => onUpdate(updated)}
      />

      {/* FINANCIAL STATS DASHBOARD - Only visible in Sold/All View */}
      {showFinancials && financialStats && (
         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm mb-2 flex flex-col xl:flex-row gap-6 items-center justify-between animate-in slide-in-from-top-4 shrink-0">
            <div className="flex flex-wrap justify-center gap-8">
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Sales (Gross)</p>
                  <p className="text-2xl font-black text-slate-900">€{financialStats.totalGross.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Taxes Paid (VAT)</p>
                  <p className="text-2xl font-black text-red-500">-€{financialStats.totalTax.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Sold Before Tax</p>
                  <p className="text-2xl font-black text-blue-600">€{financialStats.totalNetRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="w-px bg-slate-100 hidden xl:block"></div>
               <div className="text-center xl:text-left">
                  <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Net Profit</p>
                  <p className={`text-2xl font-black ${financialStats.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                     {financialStats.totalProfit >= 0 ? '+' : ''}€{financialStats.totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
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

      {/* Main Table Area */}
      <div 
        ref={tableContainerRef}
        onScroll={handleScroll}
        className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-x-auto overflow-y-auto flex-1 custom-scrollbar min-h-0"
      >
         <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-10 bg-white">
               <tr className="bg-slate-50/80 border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest backdrop-blur-sm">
                  {visibleColumns.map(colId => (
                     <th key={colId} onClick={() => handleHeaderSort(colId)} className="p-5 cursor-pointer hover:bg-slate-100 transition-colors group" style={{ width: columnWidths[colId] || DEFAULT_WIDTHS[colId] }}>
                        <div className={`flex items-center gap-1 ${['buyPrice', 'sellPrice', 'profit', 'buyDate', 'sellDate', 'actions'].includes(colId) ? 'justify-end' : colId === 'parseSpecs' ? 'justify-center' : ''}`}>
                           {colId === 'select' ? (
                              <div onClick={(e) => { e.stopPropagation(); handleSelectAll(); }} className="w-5 h-5 mx-auto border-2 border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-400">
                                 {selectedIds.length > 0 && (selectedIds.length === sortedItems.length ? <Check size={12} className="text-blue-500"/> : <Minus size={12} className="text-blue-500"/>)}
                              </div>
                           ) : colId === 'parseSpecs' ? (
                              <span className="flex items-center gap-1" title="Parse tech specs with AI"><Sparkles size={12} className="text-amber-500"/> Parse</span>
                           ) : (
                              <>
                                 {ALL_COLUMNS.find(c => c.id === colId)?.label}
                                 {(sortConfig.key === colId || (colId === 'item' && sortConfig.key === 'name')) && (
                                    <span className="text-blue-500">
                                       {sortConfig.direction === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                                    </span>
                                 )}
                              </>
                           )}
                        </div>
                     </th>
                  ))}
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
               {visibleItems.length > 0 ? visibleItems.map(item => (
                  <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors group/row ${selectedIds.includes(item.id) ? 'bg-blue-50/20' : ''}`}>
                     {visibleColumns.map(colId => renderCell(item, colId))}
                  </tr>
               )) : (
                  <tr>
                     <td colSpan={visibleColumns.length} className="p-20 text-center opacity-40">
                        <Package size={48} className="mx-auto mb-4 text-slate-300"/>
                        <p className="font-bold text-slate-400">No items found matching current filters</p>
                     </td>
                  </tr>
               )}
               {visibleCount < sortedItems.length && (
                  <tr>
                     <td colSpan={visibleColumns.length} className="p-4 text-center">
                        <span className="text-xs text-slate-400 font-bold animate-pulse">Loading more items...</span>
                     </td>
                  </tr>
               )}
            </tbody>
         </table>
      </div>

      {selectedIds.length > 0 && (
         <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 px-8 py-5 rounded-[2.5rem] border border-slate-800 shadow-2xl flex items-center gap-8 animate-in slide-in-from-bottom-12 duration-300">
            <div className="flex flex-col">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Selected</p>
               <p className="text-xl font-black text-white">{selectedIds.length}</p>
            </div>
            <div className="h-10 w-px bg-slate-800"></div>
            <div className="flex gap-2">
               <button 
                 onClick={handleBuildFromSelection} 
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Monitor size={16}/> Compose Bundle
               </button>
               
               <button 
                 onClick={() => setShowBulkCategoryEdit(true)} 
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Layers size={16}/> Set category
               </button>
               <button 
                 onClick={() => handleBulkStoreVisible(true)} 
                 className="bg-emerald-600 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-emerald-700 transition-all"
               >
                 <Globe size={16}/> Publish to store
               </button>
               <button 
                 onClick={() => setShowBulkStoreVisible(true)} 
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Eye size={16}/> Store visible
               </button>
               <button 
                 onClick={() => setShowBulkSalePct(true)} 
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Percent size={16}/> Sale %
               </button>
               <button 
                 onClick={() => setShowBulkTag(true)} 
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Tag size={16}/> Add tag
               </button>
               <button 
                 onClick={() => {
                   const selected = items.filter(i => selectedIds.includes(i.id));
                   const csv = generateKleinanzeigenCSV(selected);
                   const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                   const a = document.createElement('a');
                   a.href = URL.createObjectURL(blob);
                   a.download = `kleinanzeigen-export-${new Date().toISOString().slice(0,10)}.csv`;
                   a.click();
                   URL.revokeObjectURL(a.href);
                 }}
                 className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
               >
                 <Download size={16}/> Export Kleinanzeigen CSV
               </button>
               <button 
                 onClick={() => handleBulkGenerateDescriptions()}
                 disabled={bulkGenerateDescriptions}
                 className="bg-violet-600 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-violet-700 disabled:opacity-60 transition-all"
               >
                 {bulkGenerateDescriptions ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}
                 {bulkGenerateDescriptions ? bulkGenerateProgress || 'Generating…' : 'Generate descriptions (AI)'}
               </button>

               {/* Show Edit Sales Button if any selected item is sold/traded */}
               {items.filter(i => selectedIds.includes(i.id)).some(i => i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) && (
                  <button 
                    onClick={() => setShowBulkSalesEdit(true)} 
                    className="bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-indigo-700 transition-all"
                  >
                    <Edit2 size={16}/> Edit Sales Info
                  </button>
               )}

               <button 
                 onClick={() => setShowBulkDeleteConfirm(true)} 
                 className="bg-red-600 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-red-700 transition-all"
               >
                 <Trash2 size={16}/> Delete
               </button>
            </div>
            <button onClick={() => setSelectedIds([])} className="p-3 text-slate-500 hover:text-white transition-colors">
               <X size={20}/>
            </button>
         </div>
      )}

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

      {itemToSell && (
         <SaleModal 
            item={itemToSell} 
            taxMode={businessSettings.taxMode}
            onSave={(updated) => { 
               // When selling a PC or bundle, also stamp all child components
               // with the container's sale date. Child items keep their original buyDate.
               if ((updated.isPC || updated.isBundle) && updated.componentIds && updated.componentIds.length > 0) {
                 const soldAt = updated.sellDate || new Date().toISOString().split('T')[0];
                 const childComponents = items
                   .filter(i => 
                     (updated.componentIds && updated.componentIds.includes(i.id)) ||
                     i.parentContainerId === updated.id
                   )
                   .map(i => ({
                     ...i,
                     sellDate: soldAt, // Set sellDate to match bundle/PC sellDate
                     status: ItemStatus.SOLD, // Mark as sold
                     containerSoldDate: soldAt,
                     // Keep original buyDate - don't overwrite it
                   }));
                 onUpdate([updated, ...childComponents]);
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

      {itemToTrade && (
         <TradeModal 
            item={itemToTrade}
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
  const num = parseFloat(pct);
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
                  <option value="kleinanzeigen.de">Kleinanzeigen</option>
                  <option value="ebay.de">eBay</option>
                  <option value="Other">Other</option>
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
