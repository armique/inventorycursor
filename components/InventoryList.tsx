import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Edit2, Search, CheckSquare, Square, X, Check, Trash2, Calendar, Handbag, Package, Plus, Minus, Receipt, Monitor, ArrowUp, ArrowDown, ArrowUpDown, Tag, Info, Layers, ListTree, ChevronRight, ShoppingBag, Settings2, RotateCcw, RotateCw, HeartCrack, ListPlus, ArrowRightLeft, Archive, History, MoreHorizontal,   Filter, FilterX, TrendingUp, Wallet, Download, FileSpreadsheet, Globe, CreditCard, Hourglass, AlertCircle, XCircle, Hammer, Share2, Copy, Sliders, Image as ImageIcon, FileText, Clock, Upload, Percent, CalendarRange, Wrench, Loader2, FolderInput, CalendarDays, Eye, Unlink, BoxSelect, ChevronUp, ChevronDown, StickyNote
} from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings, Platform, PaymentType } from '../types';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { getCompatibleItemsForItem } from '../services/compatibility';
import SaleModal from './SaleModal';
import ReturnModal from './ReturnModal';
import TradeModal from './TradeModal';
import CrossPostingModal from './CrossPostingModal';
import RetroBundleModal from './RetroBundleModal';
import EditItemModal from './EditItemModal';
import ItemThumbnail from './ItemThumbnail';

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

type ColumnId = 'select' | 'item' | 'category' | 'status' | 'buyPrice' | 'sellPrice' | 'profit' | 'buyDate' | 'sellDate' | 'actions';
type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';
type StatusFilter = 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 50,
  item: 350,
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

  // Sort State
  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
     const saved = localStorage.getItem(`${persistenceKey}_sort_config`);
     return saved ? JSON.parse(saved) : { key: 'buyDate', direction: 'desc' };
  });
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadState('widths', DEFAULT_WIDTHS));

  // -- INLINE EDITING STATE --
  const [editingCell, setEditingCell] = useState<{ itemId: string, field: ColumnId } | null>(null);
  const [editValue, setEditValue] = useState<string | number>('');

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

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
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
  const [showRetroBundle, setShowRetroBundle] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

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
  const visibleColumns: ColumnId[] = ['select', 'item', 'category', 'status', 'buyPrice', 'sellPrice', 'profit', 'buyDate', 'sellDate', 'actions'];

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
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (subCategoryFilter && item.subCategory !== subCategoryFilter) return false;
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
  }, [items, searchTerm, statusFilter, categoryFilter, subCategoryFilter, timeFilter, dateRange, salePlatformFilter, salePaymentFilter]);

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

      // 2. Category Filter
      if (categoryFilter !== 'ALL') {
         if (item.category !== categoryFilter) return false;
      }
      if (subCategoryFilter && item.subCategory !== subCategoryFilter) return false;

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
  }, [items, searchTerm, statusFilter, categoryFilter, subCategoryFilter, sortConfig, timeFilter, dateRange, salePlatformFilter, salePaymentFilter, specFilters, specRangeFilters]);

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
    if (columnId === 'actions' || columnId === 'select') return;
    
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
      i.status === ItemStatus.IN_STOCK || 
      i.status === ItemStatus.SOLD || 
      i.status === ItemStatus.TRADED
    );
    
    if (validItems.length === 0) {
      alert("No valid items selected for composition.");
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
      case 'item':
        return (
          <td key={id} className="p-5" style={style} onClick={() => handleEditClick(item)}>
             <div className="flex items-center gap-4 cursor-pointer group/cell">
                <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover shadow-sm border border-slate-100" size={48} />
                <div className="flex-1 min-w-0">
                   <p className="text-sm font-black text-slate-900 truncate group-hover/cell:text-blue-600 transition-colors">{item.name}</p>
                   <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {item.isDraft && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1"><StickyNote size={8}/> Draft</span>}
                      {item.isBundle && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black uppercase">Bundle</span>}
                      {item.isPC && <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-black uppercase">PC Build</span>}
                      {item.isDefective && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase">Defective</span>}
                      <span className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.vendor}</span>
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
                </div>
             </div>
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

  return (
    <div className="space-y-6 animate-in fade-in pb-4 relative h-full flex flex-col">
      <header className="flex flex-col gap-6 shrink-0">
         <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
            <div>
               <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pageTitle}</h1>
               <p className="text-slate-500 font-medium">{sortedItems.length} items {timeFilter !== 'ALL' ? 'in selected period' : ''}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
               {/* Status Filter Buttons */}
               <div className="flex bg-white p-1 rounded-2xl shadow-sm border border-slate-200">
                  <button 
                    onClick={() => setStatusFilter('ACTIVE')}
                    className={`px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${statusFilter === 'ACTIVE' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    Active
                  </button>
                  <button 
                    onClick={() => setStatusFilter('SOLD')}
                    className={`px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${statusFilter === 'SOLD' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    Sold
                  </button>
                  <button 
                    onClick={() => setStatusFilter('DRAFTS')}
                    className={`px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${statusFilter === 'DRAFTS' ? 'bg-amber-100 text-amber-700 shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    Drafts
                  </button>
                  <button 
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${statusFilter === 'ALL' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    All
                  </button>
               </div>

               <div className="flex gap-2">
                  <div className="relative">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                     <input 
                        type="text" 
                        className="pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-slate-100 transition-all w-full sm:w-64"
                        placeholder="Filter items..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                     />
                  </div>
               </div>
            </div>
         </div>

         {/* Category Pills */}
         <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <button 
               onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); }} 
               className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${categoryFilter === 'ALL' ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
            >
               <Layers size={14}/> All Categories
            </button>
            {Object.keys(categories).map(cat => (
               <button 
                  key={cat} 
                  onClick={() => { setCategoryFilter(cat); setSubCategoryFilter(''); }}
                  className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wide whitespace-nowrap transition-all ${categoryFilter === cat ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
               >
                  {cat}
               </button>
            ))}
         </div>

         {/* Filters & Sorting Toolbar + inline Spec Filters panel */}
         <div className="flex flex-col gap-0 rounded-2xl border border-slate-200/50 bg-slate-100/50 overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between p-2">
               <div className="flex gap-2 w-full sm:w-auto overflow-x-auto scrollbar-hide">
                  {/* Filters button — toggles wide panel below */}
                  <button
                     type="button"
                     onClick={() => setShowSpecFiltersPanel(prev => !prev)}
                     className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold uppercase tracking-wide transition-all shadow-sm shrink-0 ${showSpecFiltersPanel || activeSpecFilterCount > 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
                  >
                     <Sliders size={14} />
                     Filters
                     {activeSpecFilterCount > 0 && (
                        <span className="bg-white/20 text-[10px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                           {activeSpecFilterCount}
                        </span>
                     )}
                     <ChevronDown size={14} className={`transition-transform ${showSpecFiltersPanel ? 'rotate-180' : ''}`} />
                  </button>

               {/* Time Filter */}
               <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200 shrink-0">
                  <div className="relative flex items-center">
                     <div className="absolute left-3 text-slate-400 pointer-events-none"><CalendarDays size={14} /></div>
                     <select 
                       className="bg-transparent border-none outline-none font-bold text-slate-700 pl-9 pr-8 py-2 cursor-pointer appearance-none text-[10px] uppercase tracking-wide min-w-[120px]"
                       value={timeFilter}
                       onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
                     >
                       <option value="ALL">All Time</option>
                       <option disabled>──────────</option>
                       <option value="THIS_WEEK">This Week</option>
                       <option value="LAST_WEEK">Last Week</option>
                       <option disabled>──────────</option>
                       <option value="THIS_MONTH">This Month</option>
                       <option value="LAST_MONTH">Last Month</option>
                       <option value="LAST_30">Last 30 Days</option>
                       <option value="LAST_90">Last 90 Days</option>
                       <option disabled>──────────</option>
                       <option value="THIS_YEAR">This Year</option>
                       <option value="LAST_YEAR">Last Year</option>
                     </select>
                  </div>
               </div>

               {/* Sales Filters (Only visible if not ACTIVE stock) */}
               {statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS' && (
                  <>
                     <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200 shrink-0">
                        <div className="relative flex items-center">
                           <div className="absolute left-3 text-slate-400 pointer-events-none"><Globe size={14} /></div>
                           <select 
                             className="bg-transparent border-none outline-none font-bold text-slate-700 pl-9 pr-8 py-2 cursor-pointer appearance-none text-[10px] uppercase tracking-wide min-w-[140px]"
                             value={salePlatformFilter}
                             onChange={(e) => setSalePlatformFilter(e.target.value)}
                           >
                             <option value="ALL">All Platforms</option>
                             <option value="kleinanzeigen.de">Kleinanzeigen</option>
                             <option value="ebay.de">eBay</option>
                             <option value="Other">Other</option>
                           </select>
                        </div>
                     </div>
                     <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200 shrink-0">
                        <div className="relative flex items-center">
                           <div className="absolute left-3 text-slate-400 pointer-events-none"><CreditCard size={14} /></div>
                           <select 
                             className="bg-transparent border-none outline-none font-bold text-slate-700 pl-9 pr-8 py-2 cursor-pointer appearance-none text-[10px] uppercase tracking-wide min-w-[140px]"
                             value={salePaymentFilter}
                             onChange={(e) => setSalePaymentFilter(e.target.value)}
                           >
                             <option value="ALL">All Payments</option>
                             {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                           </select>
                        </div>
                     </div>
                  </>
               )}
            </div>

            <div className="flex gap-2 ml-auto">
               <button onClick={onUndo} disabled={!canUndo} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-slate-900 disabled:opacity-50 transition-colors shadow-sm"><RotateCcw size={16}/></button>
               <button onClick={onRedo} disabled={!canRedo} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-slate-900 disabled:opacity-50 transition-colors shadow-sm"><RotateCw size={16}/></button>
            </div>
            </div>

            {/* Inline Spec Filters panel — wide selection below the Filters button */}
            {showSpecFiltersPanel && (
               <div className="border-t border-slate-200/80 bg-white px-4 py-4 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between mb-3">
                     <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 flex items-center gap-2">
                        <Filter size={14} /> Filters
                     </h3>
                     {activeSpecFilterCount > 0 && (
                        <button
                           type="button"
                           onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); setSpecFilters({}); setSpecRangeFilters({}); }}
                           className="text-[10px] font-bold uppercase text-slate-500 hover:text-red-600 flex items-center gap-1"
                        >
                           <FilterX size={12} /> Clear all
                        </button>
                     )}
                  </div>

                  {/* Parent filter: PC part category */}
                  <div className="mb-4 pb-4 border-b border-slate-200">
                     <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Part category</div>
                     <div className="flex flex-wrap gap-2">
                        <button
                           type="button"
                           onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); }}
                           className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${categoryFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                           All categories
                        </button>
                        {Object.keys(categories).map(cat => (
                           <button
                              key={cat}
                              type="button"
                              onClick={() => { setCategoryFilter(cat); setSubCategoryFilter(''); }}
                              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${categoryFilter === cat && !subCategoryFilter ? 'bg-blue-600 text-white' : categoryFilter === cat ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                           >
                              {cat}
                           </button>
                        ))}
                     </div>
                     {categoryFilter !== 'ALL' && (categories[categoryFilter]?.length ?? 0) > 0 && (
                        <>
                           <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-3 mb-1.5">{categoryFilter} → subcategory</div>
                           <div className="flex flex-wrap gap-1.5">
                              <button
                                 type="button"
                                 onClick={() => setSubCategoryFilter('')}
                                 className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${!subCategoryFilter ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                              >
                                 All
                              </button>
                              {(categories[categoryFilter] || []).map(sub => (
                                 <button
                                    key={sub}
                                    type="button"
                                    onClick={() => setSubCategoryFilter(sub)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${subCategoryFilter === sub ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                 >
                                    {sub}
                                 </button>
                              ))}
                           </div>
                        </>
                     )}
                  </div>

                  {/* Spec filters — only shown when a category (or subcategory) is selected, or show message */}
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Specs</div>
                  {specOptions.length === 0 ? (
                     <p className="text-slate-400 text-sm py-4">Select a part category above (e.g. Motherboards) to see spec filters for that category.</p>
                  ) : (
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[50vh] overflow-y-auto pr-1">
                        {specOptions.map(({ key, values, isNumeric, min: optMin, max: optMax }) => {
                           const selected = specFilters[key] ?? [];
                           const range = specRangeFilters[key];
                           const hasRange = range && (range.min !== undefined || range.max !== undefined);
                           return (
                              <div key={key} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                 <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">{key}</div>
                                 <div className="flex flex-wrap gap-1.5">
                                    {values.map(val => {
                                       const isSelected = selected.some(s => (typeof val === 'number' && typeof s === 'number' && val === s) || String(val).toLowerCase() === String(s).toLowerCase());
                                       return (
                                          <button
                                             key={String(val)}
                                             type="button"
                                             onClick={() => {
                                                setSpecFilters(prev => {
                                                   const arr = [...(prev[key] ?? [])];
                                                   if (isSelected) {
                                                      const idx = arr.findIndex(a => (typeof a === 'number' && typeof val === 'number' && a === val) || String(a).toLowerCase() === String(val).toLowerCase());
                                                      if (idx !== -1) arr.splice(idx, 1);
                                                   } else arr.push(val);
                                                   const next = { ...prev };
                                                   if (arr.length) next[key] = arr; else delete next[key];
                                                   return next;
                                                });
                                             }}
                                             className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${isSelected ? 'bg-blue-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
                                          >
                                             {String(val)}
                                          </button>
                                       );
                                    })}
                                 </div>
                                 {isNumeric && (optMin !== undefined || optMax !== undefined) && (
                                    <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t border-slate-200/50">
                                       <input
                                          type="number"
                                          placeholder={`Min ${optMin ?? ''}`}
                                          value={range?.min ?? ''}
                                          onChange={e => {
                                             const v = e.target.value === '' ? undefined : Number(e.target.value);
                                             setSpecRangeFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v, max: prev[key]?.max } }));
                                          }}
                                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs font-medium"
                                       />
                                       <span className="text-slate-400 text-xs">–</span>
                                       <input
                                          type="number"
                                          placeholder={`Max ${optMax ?? ''}`}
                                          value={range?.max ?? ''}
                                          onChange={e => {
                                             const v = e.target.value === '' ? undefined : Number(e.target.value);
                                             setSpecRangeFilters(prev => ({ ...prev, [key]: { ...prev[key], min: prev[key]?.min, max: v } }));
                                          }}
                                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs font-medium"
                                       />
                                       {hasRange && (
                                          <button
                                             type="button"
                                             onClick={() => setSpecRangeFilters(prev => { const n = { ...prev }; delete n[key]; return n; })}
                                             className="text-[10px] font-bold text-slate-400 hover:text-red-600"
                                          >
                                             Clear
                                          </button>
                                       )}
                                    </div>
                                 )}
                              </div>
                           );
                        })}
                     </div>
                  )}
               </div>
            )}
         </div>
      </header>

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
                        <div className={`flex items-center gap-1 ${['buyPrice', 'sellPrice', 'profit', 'buyDate', 'sellDate', 'actions'].includes(colId) ? 'justify-end' : ''}`}>
                           {colId === 'select' ? (
                              <div onClick={(e) => { e.stopPropagation(); handleSelectAll(); }} className="w-5 h-5 mx-auto border-2 border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-400">
                                 {selectedIds.length > 0 && (selectedIds.length === sortedItems.length ? <Check size={12} className="text-blue-500"/> : <Minus size={12} className="text-blue-500"/>)}
                              </div>
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
                 <Layers size={16}/> Reclassify
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
            // If single item selected, default to its category, otherwise default to first available
            initialCategory={selectedIds.length === 1 ? items.find(i => i.id === selectedIds[0])?.category : undefined}
            onSave={handleBulkCategorySave}
            onClose={() => setShowBulkCategoryEdit(false)}
         />
      )}

      {itemToSell && (
         <SaleModal 
            item={itemToSell} 
            taxMode={businessSettings.taxMode}
            onSave={(updated) => { 
               // When selling a PC or bundle, also stamp all child components
               // with the container's sale date so we can measure per-component
               // time-in-stock even though they were sold as a build.
               if ((updated.isPC || updated.isBundle) && updated.componentIds && updated.componentIds.length > 0) {
                 const soldAt = updated.sellDate || new Date().toISOString().split('T')[0];
                 const childComponents = items
                   .filter(i => 
                     (updated.componentIds && updated.componentIds.includes(i.id)) ||
                     i.parentContainerId === updated.id
                   )
                   .map(i => ({
                     ...i,
                     containerSoldDate: soldAt,
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
