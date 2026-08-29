import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useDeferredValue, startTransition } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { pickEssentialSpecOptions, mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { formatEUR, parseLocaleMoney, parseLocaleNumber } from '../utils/formatMoney';
import { toLocalCalendarDateKey, averageDateKey, formatInventoryDisplayDate } from '../utils/calendarDate';
import { getTimeGaugeRow, resolveContainerChildItems, stressToRgb, timeGaugeSortKey, buildTimeGaugeSortKeyMap } from '../utils/inventoryTimeGauge';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Edit2, Search, CheckSquare, Square, X, Check, Trash2, Calendar, Package, Plus, Minus, Receipt, Monitor, ArrowUp, ArrowDown, ArrowUpDown, Tag, Info, Layers, ListTree, ChevronRight, ShoppingBag, Settings2, RotateCcw, RotateCw, HeartCrack, ListPlus, ArrowRightLeft, Archive, History, MoreHorizontal, Filter, FilterX, TrendingUp, Wallet, Download, FileSpreadsheet, Globe, CreditCard, Hourglass, AlertCircle, XCircle, Hammer, Share2, Copy, Sliders, Image as ImageIcon, ImageOff, FileText, Clock, Upload, Percent, CalendarRange, Wrench, Loader2, FolderInput, CalendarDays, Eye, Unlink, BoxSelect, ChevronUp, ChevronDown, StickyNote, ListChecks, Sparkles, ArrowRight, Columns2, List, AlertTriangle, Home, Camera, Gift, User, Images, Scissors, GripVertical, RefreshCw, Calculator, Inbox, MessageSquare, ExternalLink, Bookmark, Link2, CheckCircle2
} from 'lucide-react';
import { InventoryItem, ItemStatus, BusinessSettings, Platform, PaymentType, ItemUpdateOptions, CustomerInfo, BulkImportRecord } from '../types';
import { isRealizedDisposal, isSoldOrTradedOnly } from '../utils/itemDisposition';
import { computeSoldTabMargin, getChildren, getItemDisplayShippingAmount, getSoldContainerDisplayTotals, healRealizedProfitsFromSaleProceeds, POCKET_PROFIT_TAX_MODE, shouldHideContainerChildInList, containerOrChildMatchesSearch, shouldSurfaceSoldContainerPartInList, itemMatchesActiveInventoryTab, soldContainerPartDispositionDate, matchesInventoryCategoryPin, inventorySubcategoryAliasesMatch, roundMoney, buildInventoryLookup, type InventoryLookup } from '../services/financialAggregation';
import { SaleProceedsTrigger } from './SaleProceedsPopover';
import { SellSplitLedger } from './SellSplitLedger';
import { INV_MONEY_MAIN } from './inventoryMoneyColumnStyles';
import {
  PaymentMethodIcon,
  SalePlatformCell,
  SalePlatformIcon,
  SalePlatformIconPicker,
  SalePlatformSwitchRow,
  salePlatformIconTitle,
  shouldShowPaymentMethodIcon,
} from './SalePlatformIcon';
import { saleProceedsFromItemFields, saleProceedsFeeTotal, netPayoutAfterRefund, applyManualSellerShipping, canEditManualSellerShipping, shouldShowSellCellMarketplaceFees, isTrustedEbayProceeds, type SaleColumnSplit } from '../utils/saleProceeds';
import { resolveSellColumnSplit } from '../utils/sellColumnDisplay';
import { isMissingExplicitSalePlatform, MISSING_PLATFORM_FILTER, SALE_PLATFORM_OPTIONS, formatSalePlatformLabel, hasEbaySaleSignals, resolveSalePlatform } from '../utils/salePlatform';
import { expandUpdatesWithContainerSaleMeta } from '../utils/containerSaleCascade';
import {
  containerBuyerTotalForParts,
  containerChildProfitDisplayMap,
  containerChildSoldDisplayMap,
  expandSoldContainerPriceSync,
  syncSoldContainerFamilyEqual,
} from '../utils/containerChildSoldDisplay';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import { getCompatibleItemsForItem } from '../services/compatibility';
import { generateKleinanzeigenCSV, generateEbayCSV } from '../services/ebayCsvService';
import { matchesInventorySearch, buildInventorySearchMatcher } from '../utils/inventorySearchIndex';
import {
  type AmountFilterState,
  EMPTY_AMOUNT_FILTER,
  isAmountFilterActive,
  itemMatchesAmountFilter,
  amountFilterSummary,
} from '../utils/inventoryAmountFilter';
import { cycleInventoryItemPresence, getItemPresenceCycleState, getItemUserPhotoCount, getItemUserPhotoUrls, normalizeImageList, prepareInventoryImagesForStorage } from '../utils/imageImport';
import { photoQcSummary } from '../utils/photoQc';
import { exportInventoryToExcel } from '../services/excelExportService';
import { getRecentItemIds, addRecentItemId } from '../services/recentItemsService';
import { generateStoreDescription } from '../services/specsAI';
import { suggestPriceFromSoldListings, SoldPriceSuggestion, getSpecsAIProvider } from '../services/specsAI';
import {
  appendBulkImportMember,
  bulkImportSourceLabel,
  countBulkImportItems,
  getBulkImportMembers,
  removeBulkImportMember,
} from '../utils/bulkImportHistory';
import { applyBulkImportResplit } from '../utils/bulkImportEdit';
import { resplitContainerBuyPrices } from '../utils/containerBuyPriceRecalc';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import MobileStockCard from './MobileStockCard';
import { MobileSheetShell } from './MobileBottomSheets';
import { generateMarketplaceListing } from '../services/marketplaceListingAI';
import {
  buildSuggestedEbayMap,
  resolveSuggestedEbayList,
  suggestionPatchFromPrice,
  type SuggestedEbayPrice,
} from '../utils/flipInsights';
import { loadFlipFees } from '../utils/flipCoach';
import {
  computePriceAnalyzer,
  hasPriceChangeHintFast,
  isMaybeSoldCandidate,
  isSaleReadyUnlisted,
  isSaleReadyWatch,
  type PriceAnalyzerAction,
} from '../utils/listingWatch';
import {
  enqueueProductCardBackgroundJob,
  isItemProductCardJobActive,
  subscribeProductCardBackgroundJobs,
  type ProductCardBgJob,
} from '../services/productCardBackgroundQueue';
import {
  countPresenceFlagsForItem,
  maxPresenceFlagsInItems,
  presenceColWidthFromFlagCount,
  PRESENCE_FLAG_SLOT_COUNT,
  sampleHasSplitLotBadge,
} from '../utils/inventoryPresenceFlagCount';
import {
  countLocalProductCardsByItemId,
  countProductCardsByItemId,
} from '../services/productCardGallery';
import ItemAccessoryToggles from './ItemAccessoryToggles';
import {
  canMarkSaleReady,
} from '../utils/listingPrepChecklist';
import { scheduleBackgroundWork } from '../services/backgroundPersistence';

const ebaySoldSearchUrl = (query: string) =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
import SaleModal from './SaleModal';
import InventoryOrderLinkPicker from './InventoryOrderLinkPicker';
import ReturnModal from './ReturnModal';
import SaleCycleHistory from './SaleCycleHistory';
import BuyPriceHistory, { BuyPriceBumpBadge } from './BuyPriceHistory';
import { applyUnsoldRestock, loadRefundOrdersForRestock } from '../services/saleRevert';
import TradeModal from './TradeModal';
import GiftModal from './GiftModal';
import CrossPostingModal from './CrossPostingModal';
import RetroBundleModal from './RetroBundleModal';
import SoldEqualSplitGroupsModal from './SoldEqualSplitGroupsModal';
import ReinvestBundleRecalcModal from './ReinvestBundleRecalcModal';
import ComposeTypeModal, { type ComposeType } from './ComposeTypeModal';
import QuickBundleAddModal from './QuickBundleAddModal';
import SplitPartsModal from './SplitPartsModal';
import { canSplitItem, resolveIdenticalLotQty } from '../utils/splitParts';
import EditItemModal from './EditItemModal';
import ItemThumbnail from './ItemThumbnail';
import InvoiceView from './InvoiceView';
import InventoryAISpecsPanel from './InventoryAISpecsPanel';
import AddPhotosModal, { type AddPhotosApplyOptions } from './AddPhotosModal';
import GeminiProductCardModal from './GeminiProductCardModal';
import BulkSelectionBar, { type BulkAction } from './BulkSelectionBar';
import { generateItemSpecs } from '../services/specsAI';
import { getStorefrontHiddenReason, isPublishedOnStorefront } from '../utils/storefrontCatalog';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { findMatchingOrdersForItem, type EbayOrderMatch } from '../utils/ebayOrderMatch';
import { linkInventoryItemToEbayOrder } from '../utils/linkInventoryItemToEbayOrder';
import { buildEbayOrderUrl, buildEbayItemUrl, resolveItemSourceLinks } from '../utils/sourceLinks';
import { getEbayPublishReadiness } from '../utils/ebayListingReadiness';
import ContainerMembershipBadge from './ContainerMembershipBadge';
import { buildContainerTitle, withRebuiltContainerTitle } from '../utils/buildTitle';
import { countEqualSplitSoldGroupCandidates } from '../utils/suggestEqualSplitSoldGroups';
import { applyRetroComposeToInventory, findOrphanSoldContainerShellIds } from '../utils/retroComposeApply';
import { filterPartsAvailableForCompose } from '../utils/containerMembershipInvariants';
import { pickSpecsAiNameVendorUpdates } from '../utils/applySpecsAiResult';
import { applyRamKitToSpecs } from '../utils/ramKitParse';
import { listingAccessoriesReady } from '../utils/itemAccessoryToggles';
import {
  applyContainerKind,
  buildContainersById,
  buildContainerByChildId,
  getContainerKind,
  getContainerKindShortLabel,
  isContainerMember,
  normalizeExclusiveContainerFlags,
  resolveParentContainer,
} from '../utils/containerMembership';
import { resolveTradeReceivedItems, resolveTradeSourceItem } from '../utils/tradeLinks';
import { formatPlatformBoughtLabel } from '../utils/purchaseSource';
import TradeLinkBadge from './TradeLinkBadge';
import { resolveComponentPartTone, componentPartRowAccentClass, componentPartPillProps } from '../utils/componentPartTone';
import { useInventoryPurchases } from './InventoryPurchasesPanel';
import {
  isPurchasePreviewId,
  savePurchaseDraftFromPreviewItem,
} from '../utils/ebayPurchaseToInventory';

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
  onBusinessSettingsChange?: (settings: BusinessSettings) => void;
  categories: Record<string, string[]>;
  categoryFields?: Record<string, string[]>; 
  persistenceKey?: string;
  onPublishStoreCatalog?: () => void | Promise<void>;
  bulkImports?: BulkImportRecord[];
  onUpdateBulkImport?: (record: BulkImportRecord) => void;
  onDeleteBulkImport?: (importId: string) => void;
  onDownloadBackup?: () => void;
}

const EMPTY_TIME_GAUGE_SORT_MAP = new Map<string, number>();
const EMPTY_COMPAT_COUNT_MAP = new Map<string, number>();

type ColumnId = 'select' | 'item' | 'presence' | 'parseSpecs' | 'category' | 'status' | 'buyPrice' | 'sellPrice' | 'suggestedHubSplit' | 'storePrice' | 'profit' | 'buyDate' | 'timeGauge' | 'sellDate' | 'salePlatform' | 'actions';
type TimeFilter = 'ALL' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'THIS_YEAR' | 'LAST_YEAR';

function getTimeFilterDateRange(timeFilter: TimeFilter, nowInput = new Date()): { start: Date; end: Date } {
  const now = new Date(nowInput);
  now.setHours(23, 59, 59, 999);
  let start = new Date(0);
  let end = new Date(now);

  switch (timeFilter) {
    case 'THIS_WEEK': {
      const day = now.getDay() || 7;
      if (day !== 1) now.setHours(-24 * (day - 1));
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case 'LAST_WEEK':
      start = new Date(now);
      start.setDate(now.getDate() - 7 - (now.getDay() || 7) + 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
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
      start.setHours(0, 0, 0, 0);
      break;
    case 'LAST_90':
      start = new Date(now);
      start.setDate(now.getDate() - 90);
      start.setHours(0, 0, 0, 0);
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
}

function isMarkReadyEligible(item: InventoryItem): boolean {
  return (
    (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) &&
    !item.isDefective &&
    !item.isDraft &&
    !item.parentContainerId
  );
}

type StatusFilter = 'ACTIVE' | 'SOLD' | 'DRAFTS' | 'ALL' | 'PURCHASES';

function isSpecialListTab(tab: StatusFilter): boolean {
  return tab === 'PURCHASES';
}

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

/** Checklist options for the Platform filter — "No platform" plus every real sale platform. */
const PLATFORM_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: MISSING_PLATFORM_FILTER, label: 'No platform' },
  ...SALE_PLATFORM_OPTIONS.map((opt) => ({ value: opt.value as string, label: opt.label })),
];

/** The platform-filter checklist key this item falls under (real platform, or "no platform"). */
function itemPlatformFilterKey(item: InventoryItem): string {
  return isMissingExplicitSalePlatform(item) ? MISSING_PLATFORM_FILTER : resolveSalePlatform(item);
}

/** True when the item's platform is unchecked in the platform filter panel. */
function isItemHiddenByPlatformFilter(item: InventoryItem, excludedPlatforms: Set<string>): boolean {
  if (excludedPlatforms.size === 0) return false;
  return excludedPlatforms.has(itemPlatformFilterKey(item));
}

/** Open-order / match-order controls — eBay sales only, never Kleinanzeigen etc. */
function shouldShowEbayOrderRowActions(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD) return false;
  if (item.platformSold === 'kleinanzeigen.de') return false;
  if (item.paymentType?.startsWith('Kleinanzeigen')) return false;
  const platform = resolveSalePlatform(item);
  if (platform === 'kleinanzeigen.de') return false;
  return platform === 'ebay.de' || hasEbaySaleSignals(item);
}

/** eBay order link in Flags — show whenever we have an order id on a sold eBay row. */
function shouldShowEbayOrderLinkInFlags(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  if (item.platformSold === 'kleinanzeigen.de') return false;
  if (item.paymentType?.startsWith('Kleinanzeigen')) return false;
  if ((item.ebayOrderId || '').trim()) return true;
  return shouldShowEbayOrderRowActions(item);
}

/** Flags: open the live eBay order page. Sell cell opens the in-app comparison. */
function SoldEbayOrderLinkButton({
  item,
  onMatchOrder,
  iconClassName,
}: {
  item: InventoryItem;
  onMatchOrder: (item: InventoryItem) => void;
  iconClassName: string;
}) {
  if (!shouldShowEbayOrderLinkInFlags(item)) return null;
  const orderId = (item.ebayOrderId || '').trim();
  const url = orderId ? buildEbayOrderUrl(orderId) : undefined;
  if (orderId && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${iconClassName} shrink-0 flex items-center justify-center rounded-lg border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors`}
        title={`Open eBay order ${orderId} ↗`}
        aria-label={`Open eBay order ${orderId}`}
      >
        <ExternalLink size={13} strokeWidth={2.25} />
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onMatchOrder(item);
      }}
      className={`${iconClassName} shrink-0 flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors`}
      title="Match this sale to a cached eBay order (API backfill or CSV import)"
      aria-label="Match eBay order"
    >
      <Receipt size={13} strokeWidth={2.25} />
    </button>
  );
}

function containerRowClassName(
  item: InventoryItem,
  isSelected: boolean,
  highlighted: boolean,
): string {
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
  } else {
    const accent = componentPartRowAccentClass(item);
    if (accent) parts.push(accent);
    if (!isSelected) parts.push('hover:bg-slate-50/50');
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

import { resolveCategoryFromHardwareType } from './AddCategorySubcategoryPicker';

const DEFAULT_QUICK_CATEGORY_PINS: QuickCategoryPin[] = [
  { id: quickCategoryPinId('Components', 'Processors'), label: 'CPU', category: 'Components', subCategory: 'Processors' },
  { id: quickCategoryPinId('Components', 'Graphics Cards'), label: 'GPU', category: 'Components', subCategory: 'Graphics Cards' },
  { id: quickCategoryPinId('Components', 'Motherboards'), label: 'Motherboards', category: 'Components', subCategory: 'Motherboards' },
  { id: quickCategoryPinId('Components', 'Storage (SSD/HDD)'), label: 'SSD/HDD', category: 'Components', subCategory: 'Storage (SSD/HDD)' },
];

/** Keep pins pointed at the live subcategory name (e.g. Graphics Cards → GPU). */
function resolveQuickCategoryPinsAgainstCatalog(
  pins: QuickCategoryPin[],
  categories: Record<string, string[]>
): QuickCategoryPin[] {
  return pins.map((pin) => {
    const hwType =
      pin.label === 'GPU' ||
      pin.subCategory === 'Graphics Cards' ||
      pin.subCategory === 'Graphic Cards' ||
      pin.subCategory === 'GPU'
        ? 'GPU'
        : pin.label === 'CPU' || pin.subCategory === 'Processors' || pin.subCategory === 'CPU'
          ? 'CPU'
          : null;
    if (!hwType) return pin;
    const resolved = resolveCategoryFromHardwareType(hwType, categories);
    if (!resolved.category || !resolved.subCategory) return pin;
    // Ignore Components[0] fallback when Settings has no Processors/CPU (or GPU) entry —
    // otherwise the CPU pin silently filters Graphics Cards / Cases and shows 0 CPUs.
    const resolvedIsCorrectFamily =
      hwType === 'CPU'
        ? inventorySubcategoryAliasesMatch(resolved.subCategory, 'CPU')
        : hwType === 'GPU'
          ? inventorySubcategoryAliasesMatch(resolved.subCategory, 'GPU')
          : true;
    if (!resolvedIsCorrectFamily) return pin;
    if (resolved.category === pin.category && resolved.subCategory === pin.subCategory) return pin;
    return {
      ...pin,
      id: quickCategoryPinId(resolved.category, resolved.subCategory),
      category: resolved.category,
      subCategory: resolved.subCategory,
    };
  });
}

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

/** Date-only columns — compact baseline width. */
const INV_DATE_COL_MIN_PX = 76;
/** Platform badge row in dedicated column. */
const SALE_PLATFORM_COL_MIN_PX = 118;

const INV_DATE_CELL =
  'inv-col-date text-left tabular-nums text-[0.8125rem] font-medium text-slate-600 tracking-tight cursor-pointer hover:bg-slate-50/80 transition-colors';
const INV_DATE_INPUT =
  'w-[6.75rem] bg-white border border-blue-400 rounded-md px-2 py-0.5 text-left outline-none text-[0.8125rem] font-medium tabular-nums shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200';

/** Title-row icon strip (OVP/IO toggles only — sell/delete moved to Flags). */
const ITEM_TITLE_ACTIONS_RESERVE = '2.75rem';
const BUNDLE_PART_FIN_GRID = 'w-[11.5rem]';

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 36,
  item: 168,
  presence: presenceColWidthFromFlagCount(6),
  parseSpecs: 148,
  category: 104,
  status: 68,
  buyPrice: 68,
  sellPrice: 84,
  suggestedHubSplit: 88,
  storePrice: 64,
  profit: 64,
  buyDate: INV_DATE_COL_MIN_PX,
  timeGauge: 68,
  sellDate: INV_DATE_COL_MIN_PX,
  salePlatform: SALE_PLATFORM_COL_MIN_PX,
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
  { id: 'storePrice', label: 'Shop' },
  { id: 'profit', label: 'Margin' },
  { id: 'buyDate', label: 'Acquired' },
  { id: 'timeGauge', label: 'Time' },
  { id: 'sellDate', label: 'Sold' },
  { id: 'salePlatform', label: 'Platform' },
  // Actions merged into Flags — kept for legacy saved layouts only
  { id: 'actions', label: 'Actions' },
];

function SellSplitLines({
  split,
  showFees,
  hideDeductions,
}: {
  split: SaleColumnSplit;
  showFees: boolean;
  hideDeductions?: boolean;
}) {
  return <SellSplitLedger split={split} showFees={showFees} hideDeductions={hideDeductions} />;
}

function resolveSellColumnBuyerTotalForItem(
  item: InventoryItem,
  soldContainerTotals: ReturnType<typeof getSoldContainerDisplayTotals> | null
): number | null {
  if (isTrustedEbayProceeds(item.saleProceeds) && item.saleProceeds?.buyerTotalEur != null) {
    return roundMoney(item.saleProceeds.buyerTotalEur);
  }
  const containerSell = soldContainerTotals?.sellPrice;
  if (containerSell != null && containerSell > 0.01) return containerSell;
  const sell = Number(item.sellPrice);
  return sell > 0.01 ? roundMoney(sell) : null;
}

const MOBILE_ACTIVE_SORT_OPTIONS = [
  { key: 'buyDate', label: 'Acquired' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status' },
  { key: 'buyPrice', label: 'Buy price' },
  { key: 'sellPrice', label: 'Sell price' },
  { key: 'storePrice', label: 'Shop' },
  { key: 'profit', label: 'Margin' },
  { key: 'timeGauge', label: 'Time in stock' },
] as const;

const MOBILE_SOLD_SORT_OPTIONS = [
  { key: 'sellDate', label: 'Sold date' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status' },
  { key: 'buyPrice', label: 'Buy price' },
  { key: 'sellPrice', label: 'Sell price' },
  { key: 'storePrice', label: 'Shop' },
  { key: 'profit', label: 'Margin' },
  { key: 'buyDate', label: 'Acquired' },
] as const;

function defaultMobileSortDirection(key: string): SortConfig['direction'] {
  return ['buyDate', 'sellDate', 'buyPrice', 'sellPrice', 'storePrice', 'profit', 'timeGauge'].includes(key)
    ? 'desc'
    : 'asc';
}

function clampInventoryColumnWidth(colId: ColumnId, w: number): number {
  const def = DEFAULT_WIDTHS[colId];
  const floor =
    colId === 'presence'
      ? presenceColWidthFromFlagCount(3)
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
      ? presenceColWidthFromFlagCount(3)
      : colId === 'sellDate' || colId === 'buyDate'
        ? 68
      : colId === 'salePlatform'
        ? 72
      : colId === 'category'
        ? 76
        : colId === 'timeGauge'
          ? 64
          : colId === 'actions'
            ? 96
            : 48;
  const absoluteMax = ['buyPrice', 'sellPrice', 'storePrice', 'profit'].includes(colId)
    ? 1600
    : colId === 'presence'
      ? presenceColWidthFromFlagCount(PRESENCE_FLAG_SLOT_COUNT, { lotBadge: true }) + 48
    : colId === 'salePlatform'
      ? 200
    : colId === 'actions'
      ? 960
      : 720;
  return Math.round(Math.min(absoluteMax, Math.max(absoluteMin, w)));
}

const HEADER_MEASURE_FONT = '900 10px Inter, sans-serif';
// Real thead letter-spacing is 0.04em (0.4px at 10px) — keep a touch of slack.
const HEADER_MEASURE_TRACKING = 0.8;
/** Horizontal padding in cells + room for sort chevron (matches thead/tbody CSS). */
const AUTO_COL_HPAD = 22;

function autoColPadding(colId: ColumnId): number {
  if (colId === 'status') return AUTO_COL_HPAD + 18;
  if (colId === 'category') return AUTO_COL_HPAD + 6;
  if (['buyPrice', 'sellPrice', 'storePrice', 'profit'].includes(colId)) {
    return AUTO_COL_HPAD;
  }
  return AUTO_COL_HPAD + 4;
}

const INV_DATE_MEASURE_FONT = '500 13px Inter, sans-serif';

function measureInventoryDateWidth(ctx: CanvasRenderingContext2D, raw: string | undefined | null): number {
  const display = formatInventoryDisplayDate(raw) || '-';
  return measureTextWidth(ctx, display, INV_DATE_MEASURE_FONT);
}

function measureSalePlatformCellWidth(ctx: CanvasRenderingContext2D, item: InventoryItem): number {
  if (!isRealizedDisposal(item)) return 0;
  const chip = 26;
  const gap = 2;
  const missing = isMissingExplicitSalePlatform(item);
  if (missing) {
    return chip + gap + 3 * (chip + gap) + chip;
  }
  if (!item.platformSold) return 0;
  let w = 4 * chip + 3 * gap;
  if (shouldShowPaymentMethodIcon(item.platformSold, item.paymentType) && item.paymentType) {
    w += gap + chip;
  }
  return w;
}

const INV_MONEY_MEASURE_MAIN = '600 14.4px Inter, sans-serif';
const INV_MONEY_MEASURE_DED = '600 12px Inter, sans-serif';
/** Rough text width in px for sell-column ledgers. */
function measureMoneyLedgerColumnWidth(
  ctx: CanvasRenderingContext2D,
  split: SaleColumnSplit,
): number {
  let w = measureTextWidth(ctx, `€${formatEUR(split.totalEur)}`, INV_MONEY_MEASURE_MAIN);
  if (split.shippingEur >= 0.01) {
    w = Math.max(w, measureTextWidth(ctx, `−€${formatEUR(split.shippingEur)} delivery`, INV_MONEY_MEASURE_DED));
  }
  if (split.ebayFeeEur >= 0.01) {
    w = Math.max(w, measureTextWidth(ctx, `−€${formatEUR(split.ebayFeeEur)} eBay`, INV_MONEY_MEASURE_DED));
  }
  if (split.adFeeEur >= 0.01) {
    w = Math.max(w, measureTextWidth(ctx, `−€${formatEUR(split.adFeeEur)} ads`, INV_MONEY_MEASURE_DED));
  }
  if (split.otherFeeEur >= 0.01) {
    w = Math.max(w, measureTextWidth(ctx, `−€${formatEUR(split.otherFeeEur)} other`, INV_MONEY_MEASURE_DED));
  }
  if (split.refundEur >= 0.01) {
    w = Math.max(w, measureTextWidth(ctx, `−€${formatEUR(split.refundEur)} refund`, INV_MONEY_MEASURE_DED));
  }
  const netEur = split.netEur;
  const hasDistinctNet =
    netEur != null && Number.isFinite(netEur) && Math.abs(split.totalEur - netEur) >= 0.02;
  if (hasDistinctNet && netEur != null) {
    const netStr =
      netEur < 0 ? `−€${formatEUR(Math.abs(netEur))}` : `€${formatEUR(netEur)}`;
    w = Math.max(w, measureTextWidth(ctx, netStr, INV_MONEY_MEASURE_MAIN));
  }
  return w;
}

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
  'salePlatform',
];

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

/** QW2: width maps are recomputed per filter pass but rarely change — reuse the previous
 * object when values are identical so React.memo'd rows are not invalidated by identity churn. */
function sameWidthRecord(
  a: Record<string, number | undefined>,
  b: Record<string, number | undefined>
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Computes a "just wide enough" width per auto-size column from header labels + cell content. */
function computeAutoColumnWidths(
  visibleItems: InventoryItem[],
  allItems: InventoryItem[],
  listDensity: 'comfortable' | 'compact' = 'compact',
  resolveBulkImportId?: (item: InventoryItem) => string | null,
  sortKey?: string
): Partial<Record<ColumnId, number>> {
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
  let salePlatformW = measureColumnHeader(ctx, 'salePlatform');
  let timeGaugeW = measureColumnHeader(ctx, 'timeGauge');
  let presenceW = measureColumnHeader(ctx, 'presence');
  const dense = listDensity === 'compact';
  let maxFlags = 0;

  const emptyCellW = measureTextWidth(ctx, '-', '700 13px Inter, sans-serif');
  sellPriceW = Math.max(sellPriceW, emptyCellW);
  storePriceW = Math.max(storePriceW, emptyCellW);
  profitW = Math.max(profitW, emptyCellW);

  // Sample — measuring every row on large inventories blocks first paint.
  const sample =
    visibleItems.length <= 120
      ? visibleItems
      : visibleItems.filter((_, idx) => idx % Math.ceil(visibleItems.length / 120) === 0).slice(0, 120);

  for (const item of sample) {
    maxFlags = Math.max(maxFlags, countPresenceFlagsForItem(item, allItems, resolveBulkImportId));
    if (item.category) {
      categoryW = Math.max(categoryW, measureTextWidth(ctx, item.category.toUpperCase(), '900 11px Inter, sans-serif'));
    }
    if (item.subCategory) {
      categoryW = Math.max(categoryW, measureTextWidth(ctx, item.subCategory, '700 9px Inter, sans-serif'));
    }

    const statusLabel = item.status === ItemStatus.IN_COMPOSITION ? 'In Composition' : item.status;
    statusW = Math.max(statusW, measureTextWidth(ctx, String(statusLabel).toUpperCase(), '900 10px Inter, sans-serif', 2.2));

    buyPriceW = Math.max(buyPriceW, measureTextWidth(ctx, `€${formatEUR(item.buyPrice)}`, '900 13px Inter, sans-serif'));
    if (item.sellPrice) {
      const sellSplit = resolveSellColumnSplit(item, allItems, POCKET_PROFIT_TAX_MODE, {
        shippingFallbackEur: getItemDisplayShippingAmount(item, allItems),
      });
      if (sellSplit) {
        sellPriceW = Math.max(sellPriceW, measureMoneyLedgerColumnWidth(ctx, sellSplit));
      } else {
        sellPriceW = Math.max(
          sellPriceW,
          measureTextWidth(ctx, `€${formatEUR(item.sellPrice)}`, INV_MONEY_MEASURE_MAIN)
        );
      }
    } else {
      sellPriceW = Math.max(sellPriceW, measureTextWidth(ctx, '-', '700 13px Inter, sans-serif'));
    }
    storePriceW = Math.max(
      storePriceW,
      measureTextWidth(ctx, item.storePrice ? `€${formatEUR(item.storePrice)}` : '-', '700 13px Inter, sans-serif')
    );
    if (item.profit != null && !item.isPC && !item.isBundle) {
      profitW = Math.max(profitW, measureTextWidth(ctx, `€${formatEUR(item.profit)}`, '900 13px Inter, sans-serif'));
    }
    if (item.buyDate) {
      buyDateW = Math.max(buyDateW, measureInventoryDateWidth(ctx, item.buyDate));
    }
    if (item.sellDate) {
      sellDateW = Math.max(sellDateW, measureInventoryDateWidth(ctx, item.sellDate));
    }
    if (isRealizedDisposal(item)) {
      salePlatformW = Math.max(salePlatformW, measureSalePlatformCellWidth(ctx, item));
    }
  }

  timeGaugeW = Math.max(timeGaugeW, 64);

  if (maxFlags < 1) maxFlags = maxPresenceFlagsInItems(sample.length ? sample : visibleItems);
  const lotBadge = sampleHasSplitLotBadge(sample.length ? sample : visibleItems);
  presenceW = Math.max(
    presenceW,
    presenceColWidthFromFlagCount(maxFlags, { dense, lotBadge })
  );

  // Never narrower than the full header label + header chrome (padding + sort chevron).
  const headerHPad = dense ? 21 : 25;
  const headerFloor = (colId: ColumnId): number =>
    Math.ceil(measureColumnHeader(ctx, colId)) + headerHPad + (sortKey === colId ? 18 : 0);
  const fit = (colId: ColumnId, contentW: number): number =>
    clampAutoColumnWidth(colId, Math.max(contentW, headerFloor(colId)));

  return {
    presence: fit('presence', Math.ceil(presenceW)),
    category: fit('category', Math.ceil(categoryW) + autoColPadding('category')),
    status: fit('status', Math.ceil(statusW) + autoColPadding('status')),
    buyPrice: fit('buyPrice', Math.ceil(buyPriceW) + autoColPadding('buyPrice')),
    sellPrice: fit('sellPrice', Math.ceil(sellPriceW) + autoColPadding('sellPrice')),
    storePrice: fit('storePrice', Math.ceil(storePriceW) + autoColPadding('storePrice')),
    profit: fit('profit', Math.ceil(profitW) + autoColPadding('profit')),
    buyDate: fit('buyDate', Math.ceil(buyDateW) + autoColPadding('buyDate')),
    timeGauge: fit('timeGauge', Math.ceil(timeGaugeW) + autoColPadding('timeGauge')),
    sellDate: fit('sellDate', Math.ceil(sellDateW) + autoColPadding('sellDate')),
    salePlatform: fit('salePlatform', Math.ceil(salePlatformW) + autoColPadding('salePlatform')),
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

type SmartPreset =
  | 'no_photo'
  | 'presence_unknown'
  | 'no_specs'
  | 'defective'
  | 'aging'
  | 'sale_ready'
  | 'sale_ready_unlisted'
  | 'price_change'
  | 'maybe_sold'
  | null;

type InventoryListFilterParams = {
  items: InventoryItem[];
  statusFilter: StatusFilter;
  searchTerm: string;
  categoryFilter: string;
  subCategoryFilter: string;
  sortConfig: SortConfig;
  timeFilter: TimeFilter;
  dateRange: { start: Date; end: Date };
  /** Platform values (+ MISSING_PLATFORM_FILTER) to hide — empty set shows every platform. */
  excludedPlatforms: Set<string>;
  salePaymentFilter: string;
  specFilters: Record<string, (string | number)[]>;
  specRangeFilters: Record<string, { min?: number; max?: number }>;
  showInComposition: boolean;
  timeGaugeSortKeyMap: Map<string, number>;
  amountFilter: AmountFilterState;
  smartPreset: SmartPreset;
  /** When set, show only this bulk-import batch (status tabs ignored). */
  bulkImportFilterId: string | null;
  /** Item ids from the history record — used when rows were never stamped with bulkImportId. */
  bulkImportItemIds: Set<string> | null;
  /** Precomputed kit-child ids — avoids O(n²) hide scans. */
  hiddenChildIds?: Set<string>;
  /** QW7: prebuilt id/parent/child maps — turns per-item parent scans into O(1) lookups. */
  lookup?: InventoryLookup;
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
    excludedPlatforms,
    salePaymentFilter,
    specFilters,
    specRangeFilters,
    showInComposition,
    timeGaugeSortKeyMap,
    amountFilter,
    smartPreset,
    bulkImportFilterId,
    bulkImportItemIds,
    hiddenChildIds,
    lookup,
  } = params;

  const query = searchTerm.trim();
  const searchActive = query.length >= 2;
  const bulkBatchActive = Boolean(bulkImportFilterId);
  // QW6: tokenize the query once per pass; per-item haystacks come from the WeakMap cache.
  const searchMatches = searchActive ? buildInventorySearchMatcher(query) : null;
  const searchMatchesFn = searchMatches ? (it: InventoryItem) => searchMatches(it) : null;

  const filtered = items.filter((item) => {
    if (bulkBatchActive) {
      const stamped = item.bulkImportId === bulkImportFilterId;
      const inRecord = bulkImportItemIds?.has(item.id) === true;
      if (!stamped && !inRecord) return false;
    } else {
      // Search must still respect Active / Sold / Drafts — never leak other tabs.
      let matchesStatus = false;
      if (statusFilter === 'ACTIVE') {
        matchesStatus = itemMatchesActiveInventoryTab(item, items, lookup);
      } else if (statusFilter === 'SOLD') {
        matchesStatus = isRealizedDisposal(item);
        // Parts inside a sold PC/bundle stay IN_COMPOSITION; surface them when the user
        // pins their category (Components → GPU) so build sales are not invisible.
        if (
          !matchesStatus &&
          shouldSurfaceSoldContainerPartInList(
            item,
            items,
            statusFilter,
            categoryFilter,
            subCategoryFilter,
            lookup
          )
        ) {
          matchesStatus = true;
        }
      } else if (statusFilter === 'DRAFTS') {
        matchesStatus = item.isDraft === true;
      } else {
        matchesStatus = true;
      }
      if (!matchesStatus) return false;
    }

    if (smartPreset === 'no_photo' && getItemUserPhotoCount(item) > 0) return false;
    if (smartPreset === 'presence_unknown' && getItemPresenceCycleState(item) !== 'unknown') return false;
    if (smartPreset === 'no_specs' && item.specs && Object.keys(item.specs).length > 0) return false;
    if (smartPreset === 'defective' && !item.isDefective) return false;
    if (smartPreset === 'sale_ready' && !isSaleReadyWatch(item)) return false;
    if (smartPreset === 'sale_ready_unlisted' && !isSaleReadyUnlisted(item)) return false;
    if (smartPreset === 'price_change' && !hasPriceChangeHintFast(item)) return false;
    if (smartPreset === 'maybe_sold' && !isMaybeSoldCandidate(item)) return false;
    if (smartPreset === 'aging') {
      const key = item.buyDate || '';
      if (!key) return false;
      const bought = new Date(key);
      const ageDays = (Date.now() - bought.getTime()) / (1000 * 60 * 60 * 24);
      if (!(ageDays > 90) || isRealizedDisposal(item)) return false;
    }

    // Bundle/PC/mixed components always nest under the parent — never as top-level rows.
    // Search still surfaces the parent when a child matches.
    // Dedicated bulk-batch view lists every stamped member (including sold / in-composition kids).
    // Exception: SOLD + category pin (e.g. Components/GPU) lists matching parts from sold builds.
    if (!bulkBatchActive) {
      const isHiddenChild = hiddenChildIds
        ? !item.isBundle && !item.isPC && hiddenChildIds.has(item.id)
        : shouldHideContainerChildInList(item, items, undefined, lookup);
      if (isHiddenChild) {
        const surface =
          shouldSurfaceSoldContainerPartInList(
            item,
            items,
            statusFilter,
            categoryFilter,
            subCategoryFilter,
            lookup
          );
        // Never promote nested parts to top-level during search — the parent row
        // already matches via containerOrChildMatchesSearch, which caused duplicates.
        if (!surface) return false;
      }
    }
    // Orphan "in composition" rows (no parent container) respect the visibility toggle.
    if (!bulkBatchActive && !searchActive && !showInComposition && item.status === ItemStatus.IN_COMPOSITION) return false;

    // Search ignores leftover category pins so a name lookup still finds the row.
    // Dedicated bulk-batch view also ignores leftover category pins.
    if (!bulkBatchActive && !searchActive && (categoryFilter !== 'ALL' || subCategoryFilter)) {
      if (!matchesInventoryCategoryPin(item, categoryFilter, subCategoryFilter)) return false;
    }

    if (searchActive && searchMatchesFn) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, query, searchMatchesFn, lookup)) return false;
      } else if (!searchMatchesFn(item)) {
        return false;
      }
    }

    // Spec and date filters are browsing aids — skip them during search so a suggestion click always reveals the row.
    if (!searchActive && timeFilter !== 'ALL') {
      const surfacedSoldPart = shouldSurfaceSoldContainerPartInList(
        item,
        items,
        statusFilter,
        categoryFilter,
        subCategoryFilter,
        lookup
      );
      const isSalesItem = isRealizedDisposal(item) || surfacedSoldPart;
      const dateStr = isSalesItem
        ? surfacedSoldPart
          ? soldContainerPartDispositionDate(item, items, lookup)
          : item.sellDate
        : item.buyDate;
      if (!dateStr) return true;
      const itemDate = new Date(dateStr);
      if (itemDate < dateRange.start || itemDate > dateRange.end) return false;
    }

    if (!searchActive && statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS') {
      if (excludedPlatforms.size > 0 && isItemHiddenByPlatformFilter(item, excludedPlatforms)) return false;
      if (salePaymentFilter !== 'ALL' && item.paymentType !== salePaymentFilter) return false;
      if (isAmountFilterActive(amountFilter) && !itemMatchesAmountFilter(item, amountFilter)) {
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
  categories = HIERARCHY_CATEGORIES,
  categoryFields = {}, 
  persistenceKey = 'default_inv',
  onPublishStoreCatalog,
  bulkImports = [],
  onUpdateBulkImport,
  onDeleteBulkImport,
  onDownloadBackup,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // -- PERSISTENT STATE LOADING --
  const loadState = <T,>(key: string, defaultVal: T): T => {
    const saved = localStorage.getItem(`${persistenceKey}_${key}`);
    if (saved) return JSON.parse(saved);
    return defaultVal;
  };

  const defaultSortForTab = (tab: StatusFilter): SortConfig => {
    if (tab === 'SOLD') return { key: 'sellDate', direction: 'desc' };
    if (tab === 'ACTIVE') return { key: 'buyDate', direction: 'desc' };
    return { key: 'buyDate', direction: 'desc' };
  };

  const readPersistedSortForTab = (tab: StatusFilter): SortConfig | null => {
    const perTab = localStorage.getItem(`${persistenceKey}_sort_${tab}`);
    if (perTab) {
      try {
        return JSON.parse(perTab) as SortConfig;
      } catch {
        /* ignore */
      }
    }
    const legacy = localStorage.getItem(`${persistenceKey}_sort_config`);
    if (legacy) {
      try {
        return JSON.parse(legacy) as SortConfig;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  const [searchTerm, setSearchTerm] = useState(() => {
    const q = searchParams.get('q');
    return q != null ? q : loadState<string>('search', '');
  });
  // QW1: the input stays on `searchTerm` (urgent) while filtering/rendering follow this
  // deferred copy, so keystrokes are never blocked behind a full list re-filter.
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [bulkImportFilterId, setBulkImportFilterId] = useState<string | null>(() =>
    searchParams.get('bulkImport')
  );
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => loadState<TimeFilter>('time', 'ALL'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    loadState<StatusFilter>('status_filter', 'ACTIVE')
  );
  // Split view (side-by-side Active + Sold) was removed — always off now, regardless
  // of what a previous session may have persisted to localStorage under this key.
  const [splitView, setSplitView] = useState<boolean>(false);
  const [quickCategoryPins, setQuickCategoryPins] = useState<QuickCategoryPin[]>(() => {
    const saved = loadState<QuickCategoryPin[] | null>('quick_category_pins', null);
    return saved && saved.length > 0 ? saved : DEFAULT_QUICK_CATEGORY_PINS;
  });

  // After Settings renames (Graphics Cards → GPU), retarget saved pins to the live subcategory.
  useEffect(() => {
    setQuickCategoryPins((prev) => {
      const next = resolveQuickCategoryPinsAgainstCatalog(prev, categories);
      const same =
        next.length === prev.length &&
        next.every(
          (p, i) =>
            p.id === prev[i].id &&
            p.category === prev[i].category &&
            p.subCategory === prev[i].subCategory
        );
      return same ? prev : next;
    });
  }, [categories]);
  const [showQuickCategoryPicker, setShowQuickCategoryPicker] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>(() => loadState<string>('category_filter', 'ALL'));
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>(() => loadState<string>('subcategory_filter', ''));
  
  // New Filters for Sales
  const [excludedPlatforms, setExcludedPlatforms] = useState<Set<string>>(
    () => new Set(loadState<string[]>('sale_platform_excluded', []))
  );
  const [showPlatformFilterPanel, setShowPlatformFilterPanel] = useState(false);
  const platformFilterPanelRef = useRef<HTMLDivElement>(null);
  const platformFilterButtonRef = useRef<HTMLButtonElement>(null);
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
  const [showMobileFiltersSheet, setShowMobileFiltersSheet] = useState(false);
  const filtersPanelRef = useRef<HTMLDivElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);

  // Desktop split/table chrome is unusable on phones — force single-pane card list.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      if (mq.matches) setSplitView(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Visibility toggle for orphan "In Composition" items (container children always nest under parent)
  const [showInComposition, setShowInComposition] = useState<boolean>(() => loadState<boolean>('show_in_composition', false));
  /** When on, every sell cell also shows ads / eBay fee. Hub and screenshot sales always show those lines. */
  const [showPriceBreakdown, setShowPriceBreakdown] = useState<boolean>(() => loadState<boolean>('show_price_breakdown', false));
  /** When on, the sell cell drops every deduction line (shipping, refund, eBay/ad/other fees) —
   *  just the sell price and the net pocket value, regardless of showPriceBreakdown. */
  const [hideSellDeductions, setHideSellDeductions] = useState<boolean>(() => loadState<boolean>('hide_sell_deductions', false));
  // One-shot heal: Hub-applied rows sometimes kept a stale `profit` while sell-cell net was right.
  const hubProfitHealDoneRef = useRef(false);
  useEffect(() => {
    if (hubProfitHealDoneRef.current) return;
    if (!items.length) return;
    let cancelled = false;
    const run = () => {
      if (cancelled || hubProfitHealDoneRef.current) return;
      const patches = healRealizedProfitsFromSaleProceeds(items);
      hubProfitHealDoneRef.current = true;
      if (!patches.length) return;
      onUpdate(patches, undefined, {
        skipUndo: true,
        skipActionLog: true,
        skipMembershipSync: true,
        skipContainerSync: true,
        flushCloud: true,
        actionNote: { action: 'Healed sale margins from Hub / fee split' },
      });
    };
    scheduleBackgroundWork(run);
    return () => {
      cancelled = true;
    };
  }, [items, onUpdate]);

  /** Collapsed bundle/PC rows — open by default; user closes only if they want. */
  const [collapsedBundles, setCollapsedBundles] = useState<Set<string>>(() => new Set());

  const toggleBundleExpanded = useCallback((id: string) => {
    setCollapsedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Sort — persisted per status tab; tab defaults only apply when switching tabs (not on every render).
  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
    const tab = loadState<StatusFilter>('status_filter', 'ACTIVE');
    return readPersistedSortForTab(tab) ?? defaultSortForTab(tab);
  });

  const prevStatusForSortRef = useRef(statusFilter);
  useEffect(() => {
    if (splitView) {
      prevStatusForSortRef.current = statusFilter;
      return;
    }
    if (prevStatusForSortRef.current === statusFilter) return;
    prevStatusForSortRef.current = statusFilter;
    const restored = readPersistedSortForTab(statusFilter);
    setSortConfig(restored ?? defaultSortForTab(statusFilter));
  }, [statusFilter, splitView]);
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = loadState<Record<string, number>>('widths', DEFAULT_WIDTHS);
    const merged = { ...DEFAULT_WIDTHS, ...saved };
    if ((merged.presence ?? 0) > presenceColWidthFromFlagCount(PRESENCE_FLAG_SLOT_COUNT, { lotBadge: true }) + 8) {
      merged.presence = presenceColWidthFromFlagCount(6);
    }
    if ((merged.parseSpecs ?? 0) < DEFAULT_WIDTHS.parseSpecs) merged.parseSpecs = DEFAULT_WIDTHS.parseSpecs;
    if ((merged.category ?? 0) < DEFAULT_WIDTHS.category) merged.category = DEFAULT_WIDTHS.category;
    return merged;
  });
  // Columns the user has explicitly drag-resized; these opt out of auto-sizing until reset.
  const [manualWidthColumns, setManualWidthColumns] = useState<Set<ColumnId>>(
    () => new Set(loadState<ColumnId[]>('manual_width_cols', []).filter((id) => id === 'item'))
  );

  const defaultColumnOrder: ColumnId[] = ['select', 'item', 'presence', 'category', 'status', 'buyPrice', 'sellPrice', 'storePrice', 'profit', 'buyDate', 'timeGauge', 'sellDate', 'salePlatform'];
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
    if (!next.includes('salePlatform')) {
      const sold = next.indexOf('sellDate');
      if (sold >= 0) next.splice(sold + 1, 0, 'salePlatform');
      else next.splice(Math.max(0, next.length - 1), 0, 'salePlatform');
    }
    // Remove legacy / merged-away columns
    next = next.filter(id => id !== 'parseSpecs' && id !== 'actions' && id !== 'suggestedHubSplit');
    // Ensure every known column exists once (except actions)
    for (const id of defaultColumnOrder) {
      if (!next.includes(id)) next.push(id);
    }
    return next;
  });
  const [hiddenColumnIds, setHiddenColumnIds] = useState<ColumnId[]>(() => loadState<ColumnId[]>('hidden_columns', []));
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement>(null);
  const columnWidthsRef = useRef(columnWidths);
  const columnResizeRef = useRef<{ colId: ColumnId; startX: number; startW: number } | null>(null);

  // Migration: strip legacy ghost columns (parseSpecs, actions) from saved layouts.
  useEffect(() => {
    const LEGACY_COLS = ['parseSpecs', 'actions', 'suggestedHubSplit'] as string[];
    if (columnOrder.some(id => LEGACY_COLS.includes(id))) {
      setColumnOrder(prev => prev.filter(id => !LEGACY_COLS.includes(id)));
    }
    if (!columnOrder.includes('salePlatform')) {
      setColumnOrder(prev => {
        if (prev.includes('salePlatform')) return prev;
        const copy = [...prev];
        const sold = copy.indexOf('sellDate');
        if (sold >= 0) copy.splice(sold + 1, 0, 'salePlatform');
        else copy.push('salePlatform');
        return copy;
      });
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
  const [listDensity, setListDensity] = useState<ListDensity>(() => {
    const global = localStorage.getItem('panel_list_density');
    if (global === 'comfortable' || global === 'compact') return global;
    return loadState<ListDensity>('list_density', 'compact');
  });
  useEffect(() => {
    localStorage.setItem(`${persistenceKey}_list_density`, JSON.stringify(listDensity));
    localStorage.setItem('panel_list_density', listDensity);
  }, [listDensity, persistenceKey]);
  const [smartPreset, setSmartPreset] = useState<SmartPreset>(null);
  const [showAISpecsModal, setShowAISpecsModal] = useState(false);

  const [showBulkAddPhotosModal, setShowBulkAddPhotosModal] = useState(false);
  const [addPhotosTargetIds, setAddPhotosTargetIds] = useState<string[]>([]);
  const [addPhotosAutoEbay, setAddPhotosAutoEbay] = useState(false);
  const [geminiCardItem, setGeminiCardItem] = useState<InventoryItem | null>(null);
  const [bgCardJobs, setBgCardJobs] = useState<ProductCardBgJob[]>([]);
  const bgCardNotifiedRef = useRef<Set<string>>(new Set());
  const [itemAiCardCounts, setItemAiCardCounts] = useState<Record<string, number>>(() =>
    countLocalProductCardsByItemId()
  );
  const [aiCardRegenConfirmId, setAiCardRegenConfirmId] = useState<string | null>(null);

  const refreshAiCardCounts = useCallback(() => {
    setItemAiCardCounts(countLocalProductCardsByItemId());
    void countProductCardsByItemId()
      .then((counts) => setItemAiCardCounts(counts))
      .catch(() => {
        /* keep local */
      });
  }, []);

  useEffect(() => {
    refreshAiCardCounts();
  }, [refreshAiCardCounts]);

  useEffect(() => {
    return subscribeProductCardBackgroundJobs((jobs) => {
      setBgCardJobs(jobs);
    });
  }, []);

  useEffect(() => {
    if (!aiCardRegenConfirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAiCardRegenConfirmId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aiCardRegenConfirmId]);

  const activeBgCardItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const j of bgCardJobs) {
      if (j.status === 'queued' || j.status === 'running') ids.add(j.itemId);
    }
    return ids;
  }, [bgCardJobs]);

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

  // Sync dedicated bulk-import batch view from ?bulkImport=
  useEffect(() => {
    const bulkId = searchParams.get('bulkImport');
    if (bulkId) {
      setBulkImportFilterId(bulkId);
      setSearchTerm('');
      setCategoryFilter('ALL');
      setSubCategoryFilter('');
      setSmartPreset(null);
      setSplitView(false);
    } else {
      setBulkImportFilterId(null);
    }
  }, [searchParams]);

  const openBulkImportBatch = useCallback(
    (importId: string) => {
      setBulkImportFilterId(importId);
      setSearchTerm('');
      setCategoryFilter('ALL');
      setSubCategoryFilter('');
      setSmartPreset(null);
      setSplitView(false);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('q');
          next.set('bulkImport', importId);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const clearBulkImportBatch = useCallback(() => {
    setBulkImportFilterId(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('bulkImport');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const bulkBatchActive = Boolean(bulkImportFilterId);

  const bulkImportRecord = useMemo(
    () => (bulkImportFilterId ? bulkImports.find((r) => r.id === bulkImportFilterId) ?? null : null),
    [bulkImports, bulkImportFilterId]
  );

  const bulkImportIdByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of bulkImports) {
      for (const id of record.itemIds || []) {
        if (!map.has(id)) map.set(id, record.id);
      }
    }
    return map;
  }, [bulkImports]);

  const resolveItemBulkImportId = useCallback(
    (item: InventoryItem) => item.bulkImportId || bulkImportIdByItemId.get(item.id) || null,
    [bulkImportIdByItemId]
  );

  const bulkImportItemIds = useMemo(() => {
    if (!bulkImportFilterId) return null;
    if (bulkImportRecord?.itemIds?.length) return new Set(bulkImportRecord.itemIds);
    // Fallback: any currently stamped members (e.g. record not loaded yet).
    return new Set(items.filter((i) => i.bulkImportId === bulkImportFilterId).map((i) => i.id));
  }, [bulkImportFilterId, bulkImportRecord, items]);

  const bulkImportCounts = useMemo(() => {
    if (!bulkImportFilterId) return null;
    if (bulkImportRecord) {
      const byId = new Map(items.map((i) => [i.id, i]));
      return countBulkImportItems(bulkImportRecord, byId);
    }
    const members = items.filter(
      (i) => i.bulkImportId === bulkImportFilterId || bulkImportItemIds?.has(i.id)
    );
    let sold = 0;
    let inStock = 0;
    for (const m of members) {
      if (isRealizedDisposal(m)) sold += 1;
      else inStock += 1;
    }
    return { present: members.length, inStock, sold, missing: 0 };
  }, [bulkImportFilterId, bulkImportRecord, bulkImportItemIds, items]);

  // Heal missing bulkImportId stamps so Flags icon + future filters stay consistent.
  const healedBulkImportRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bulkImportFilterId) {
      healedBulkImportRef.current = null;
      return;
    }
    if (!bulkImportRecord?.itemIds?.length) return;
    if (healedBulkImportRef.current === bulkImportFilterId) return;
    const missing = bulkImportRecord.itemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is InventoryItem => Boolean(i && i.bulkImportId !== bulkImportFilterId));
    healedBulkImportRef.current = bulkImportFilterId;
    if (missing.length === 0) return;
    onUpdate(
      missing.map((i) => ({ ...i, bulkImportId: bulkImportFilterId })),
      undefined,
      { skipUndo: true, skipActionLog: true }
    );
  }, [bulkImportFilterId, bulkImportRecord, items, onUpdate]);

  const [bulkParentExpanded, setBulkParentExpanded] = useState(true);
  const [bulkTotalDraft, setBulkTotalDraft] = useState('');
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkNewName, setBulkNewName] = useState('');
  const [bulkNewCategory, setBulkNewCategory] = useState('Components');
  const [bulkNewSubCategory, setBulkNewSubCategory] = useState('Spare Parts');
  const [bulkNewManualCost, setBulkNewManualCost] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!bulkImportRecord) {
      setBulkTotalDraft('');
      setBulkAdding(false);
      return;
    }
    setBulkTotalDraft(String(bulkImportRecord.totalCost ?? ''));
    setBulkParentExpanded(true);
  }, [bulkImportRecord?.id]);

  const bulkMembers = useMemo(
    () => (bulkImportRecord ? getBulkImportMembers(bulkImportRecord, items) : []),
    [bulkImportRecord, items]
  );

  const recalcBulkBatch = useCallback(
    (totalOverride?: number) => {
      if (!bulkImportRecord || !onUpdateBulkImport) return;
      const raw =
        totalOverride ?? parseLocaleNumber(bulkTotalDraft || String(bulkImportRecord.totalCost));
      const total = Number.isFinite(raw) ? Math.max(0, raw) : bulkImportRecord.totalCost;
      setBulkBusy(true);
      try {
        const { record: nextRecord, patchedItems } = applyBulkImportResplit({
          record: bulkImportRecord,
          items,
          totalCost: total,
          mode: 'SMART',
        });
        if (patchedItems.length) {
          onUpdate(patchedItems, undefined, {
            flushCloud: true,
            skipActionLog: true,
            skipPriceHistory: true,
          });
        }
        onUpdateBulkImport(nextRecord);
        setBulkTotalDraft(String(nextRecord.totalCost ?? total));
        setToast('Batch prices recalculated');
        setTimeout(() => setToast(null), 2200);
      } finally {
        setBulkBusy(false);
      }
    },
    [bulkImportRecord, bulkTotalDraft, items, onUpdate, onUpdateBulkImport]
  );

  const removeFromBulkBatch = useCallback(
    (itemId: string) => {
      if (!bulkImportRecord || !onUpdateBulkImport) return;
      const members = bulkMembers.filter((m) => m.id !== itemId);
      const nextRecord = removeBulkImportMember(bulkImportRecord, itemId, members);
      const item = items.find((i) => i.id === itemId);
      if (item) {
        // '' clears stamp; omitting the key would be restored by App merge preserve.
        onUpdate([{ ...item, bulkImportId: '' }], undefined, { flushCloud: true, skipActionLog: true });
      }
      onUpdateBulkImport(nextRecord);
      if (members.length > 0 && window.confirm('Re-split remaining items to the batch total?')) {
        const { record: afterSplit, patchedItems } = applyBulkImportResplit({
          record: nextRecord,
          items: items.filter((i) => i.id !== itemId),
          totalCost: nextRecord.totalCost,
          mode: 'SMART',
        });
        if (patchedItems.length) {
          onUpdate(patchedItems, undefined, {
            flushCloud: true,
            skipActionLog: true,
            skipPriceHistory: true,
          });
        }
        onUpdateBulkImport(afterSplit);
      }
    },
    [bulkImportRecord, bulkMembers, items, onUpdate, onUpdateBulkImport]
  );

  const addToBulkBatch = useCallback(() => {
    if (!bulkImportRecord || !onUpdateBulkImport) return;
    const name = bulkNewName.trim();
    if (!name) return;
    const manual = bulkNewManualCost.trim() ? parseLocaleNumber(bulkNewManualCost) : undefined;
    const fallbackImage =
      CATEGORY_IMAGES[bulkNewSubCategory] ||
      CATEGORY_IMAGES[bulkNewCategory] ||
      CATEGORY_IMAGES.Components;
    const id = `bulk-${Date.now()}-extra`;
    const newItem: InventoryItem = {
      id,
      name,
      category: bulkNewCategory,
      subCategory: bulkNewSubCategory,
      buyPrice: Number.isFinite(manual) ? Number(manual) : 0,
      buyDate: bulkImportRecord.buyDate || new Date().toISOString().split('T')[0],
      status: ItemStatus.IN_STOCK,
      vendor: 'Unknown',
      platformBought: bulkImportRecord.platformBought,
      bulkImportId: bulkImportRecord.id,
      imageUrl: fallbackImage,
      imageUrls: fallbackImage ? [fallbackImage] : [],
      comment1: '',
      comment2: `Bulk Import (added later). Source total: €${bulkImportRecord.totalCost}.`,
      kleinanzeigenBuyChatUrl: bulkImportRecord.kleinanzeigenBuyChatUrl,
      kleinanzeigenBuyChatImage: bulkImportRecord.kleinanzeigenBuyChatImage,
      kleinanzeigenSellerProfileUrl: bulkImportRecord.kleinanzeigenSellerProfileUrl,
    };
    const membersAfter = [...bulkMembers, newItem];
    const nextRecord = appendBulkImportMember(bulkImportRecord, newItem, membersAfter);
    onUpdate([newItem], undefined, { flushCloud: true });
    onUpdateBulkImport(nextRecord);
    const locked = new Set<string>();
    if (manual !== undefined && Number.isFinite(manual)) locked.add(id);
    const { record: afterSplit, patchedItems } = applyBulkImportResplit({
      record: nextRecord,
      items: [...items, newItem],
      totalCost: nextRecord.totalCost,
      mode: 'SMART',
      lockedItemIds: locked.size ? locked : undefined,
    });
    if (patchedItems.length) {
      onUpdate(patchedItems, undefined, {
        flushCloud: true,
        skipActionLog: true,
        skipPriceHistory: true,
      });
    }
    onUpdateBulkImport(afterSplit);
    setBulkNewName('');
    setBulkNewManualCost('');
    setBulkAdding(false);
    setToast(`Added “${name}” to batch · prices resplit`);
    setTimeout(() => setToast(null), 2200);
  }, [
    bulkImportRecord,
    bulkMembers,
    bulkNewName,
    bulkNewCategory,
    bulkNewSubCategory,
    bulkNewManualCost,
    items,
    onUpdate,
    onUpdateBulkImport,
  ]);

  const deleteBulkBatchHistory = useCallback(() => {
    if (!bulkImportRecord || !onDeleteBulkImport) return;
    if (
      !window.confirm(
        `Remove “${bulkImportRecord.label}” from bulk import history?\n\nInventory items stay — only the history link is removed.`
      )
    ) {
      return;
    }
    onDeleteBulkImport(bulkImportRecord.id);
    clearBulkImportBatch();
  }, [bulkImportRecord, onDeleteBulkImport, clearBulkImportBatch]);

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
      localStorage.setItem(`${k}_sort_${statusFilter}`, JSON.stringify(sortConfig));
      localStorage.setItem(`${k}_widths`, JSON.stringify(columnWidths));
      localStorage.setItem(`${k}_manual_width_cols`, JSON.stringify(Array.from(manualWidthColumns)));
      localStorage.setItem(`${k}_sale_platform_excluded`, JSON.stringify(Array.from(excludedPlatforms)));
      localStorage.setItem(`${k}_sale_payment`, JSON.stringify(salePaymentFilter));
      localStorage.setItem(`${k}_amount_filter`, JSON.stringify(amountFilter));
      localStorage.setItem(`${k}_spec_filters`, JSON.stringify(specFilters));
      localStorage.setItem(`${k}_spec_range_filters`, JSON.stringify(specRangeFilters));
      localStorage.setItem(`${k}_show_in_composition`, JSON.stringify(showInComposition));
      localStorage.setItem(`${k}_show_price_breakdown`, JSON.stringify(showPriceBreakdown));
      localStorage.setItem(`${k}_hide_sell_deductions`, JSON.stringify(hideSellDeductions));
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
    manualWidthColumns, excludedPlatforms, salePaymentFilter, amountFilter, specFilters, specRangeFilters, showInComposition,
    showPriceBreakdown, hideSellDeductions, columnOrder, hiddenColumnIds, splitView, quickCategoryPins, persistenceKey,
  ]);

  /** Fast hide set for kit children — built before filter to avoid O(n²) parent scans. */
  const hiddenChildIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      if (i.parentContainerId) s.add(i.id);
      if ((i.isBundle || i.isPC) && i.componentIds?.length) {
        for (const id of i.componentIds) s.add(id);
      }
    }
    return s;
  }, [items]);

  /** QW7: O(1) id/parent/child maps for the filter — replaces per-item full-array scans. */
  const inventoryLookup = useMemo(() => buildInventoryLookup(items), [items]);

  // Ensure matching nested bundles reopen if the user had collapsed them
  useEffect(() => {
    const q = deferredSearchTerm.trim();
    if (q.length < 2) return;
    const childMatches = buildInventorySearchMatcher(q);
    const toReopen: string[] = [];
    for (const item of items) {
      if (!item.isPC && !item.isBundle) continue;
      const children = getChildren(item, items, inventoryLookup);
      if (children.some((c) => childMatches(c))) {
        toReopen.push(item.id);
      }
    }
    if (toReopen.length === 0) return;
    setCollapsedBundles((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of toReopen) {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [deferredSearchTerm, items, inventoryLookup]);

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
    if (!showPlatformFilterPanel) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (platformFilterPanelRef.current?.contains(el) || platformFilterButtonRef.current?.contains(el)) return;
      setShowPlatformFilterPanel(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showPlatformFilterPanel]);

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

  // Listing AI opens as a modal — no dropdown click-outside needed

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
  const [itemToFindOrder, setItemToFindOrder] = useState<InventoryItem | null>(null);
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
  const [showEqualSplitGroups, setShowEqualSplitGroups] = useState(false);
  const [equalSplitIgnoreRev, setEqualSplitIgnoreRev] = useState(0);
  const orphanShellCleanupDoneRef = useRef(false);
  const dualFlagCleanupDoneRef = useRef(false);

  // One-time: trash sold PC/bundle shells that still list parts now owned by another
  // container (second historical compose). Stops double revenue on the dashboard.
  useEffect(() => {
    if (orphanShellCleanupDoneRef.current || items.length === 0) return;
    const ids = findOrphanSoldContainerShellIds(items);
    if (ids.length === 0) {
      orphanShellCleanupDoneRef.current = true;
      return;
    }
    orphanShellCleanupDoneRef.current = true;
    onUpdate([], ids);
    setToast(
      `Removed ${ids.length} duplicate sold PC/bundle shell${ids.length === 1 ? '' : 's'} that were double-counting the same sale`
    );
    setTimeout(() => setToast(null), 4200);
  }, [items, onUpdate]);

  // One-time: clear isBundle on Gaming PCs that wrongly have both badges (legacy historical compose).
  useEffect(() => {
    if (dualFlagCleanupDoneRef.current || items.length === 0) return;
    const fixed = items
      .filter((i) => i.isPC && i.isBundle)
      .map((i) => normalizeExclusiveContainerFlags(i));
    dualFlagCleanupDoneRef.current = true;
    if (fixed.length === 0) return;
    onUpdate(fixed, undefined, { skipUndo: true, skipActionLog: true, skipContainerSync: true });
  }, [items, onUpdate]);

  const [recalcTarget, setRecalcTarget] = useState<InventoryItem | null>(null);
  const [showComposeType, setShowComposeType] = useState(false);
  const [quickBundleSeed, setQuickBundleSeed] = useState<InventoryItem | null>(null);
  const [splitPartsSeed, setSplitPartsSeed] = useState<InventoryItem | null>(null);
  const quickBundleSeedRef = useRef<InventoryItem | null>(null);
  useEffect(() => {
    quickBundleSeedRef.current = quickBundleSeed;
  }, [quickBundleSeed]);

  const openQuickBundlePanel = useCallback((seed: InventoryItem) => {
    // Cancel any pending row-click → Edit PC Build / Edit Item navigation
    if (rowClickTimeoutRef.current != null) {
      window.clearTimeout(rowClickTimeoutRef.current);
      rowClickTimeoutRef.current = null;
    }
    setQuickBundleSeed(seed);
    if (seed.isPC || seed.isBundle) {
      setCollapsedBundles((prev) => {
        if (!prev.has(seed.id)) return prev;
        const next = new Set(prev);
        next.delete(seed.id);
        return next;
      });
    }
    setScrollTargetItemId(seed.id);
  }, []);

  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
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
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    for (const job of bgCardJobs) {
      if (job.status !== 'done' && job.status !== 'error') continue;
      if (bgCardNotifiedRef.current.has(job.id)) continue;
      bgCardNotifiedRef.current.add(job.id);
      if (job.status === 'done') {
        const extra = job.error ? ` (${job.plannedCards - job.cardsSaved} failed)` : '';
        setToast(
          `AI cards ready · ${job.itemName.slice(0, 40)}${job.itemName.length > 40 ? '…' : ''} · ${job.cardsSaved} in gallery${extra}`
        );
        refreshAiCardCounts();
      } else {
        setToast(
          `AI card failed · ${job.itemName.slice(0, 36)}${job.itemName.length > 36 ? '…' : ''} · ${job.error || 'error'}`
        );
      }
      setTimeout(() => setToast((prev) => (prev?.startsWith('AI card') ? null : prev)), 4200);
    }
  }, [bgCardJobs, refreshAiCardCounts]);

  const queueBackgroundAiCards = useCallback(
    (item: InventoryItem) => {
      if (isItemProductCardJobActive(item.id)) {
        setToast('AI cards already generating for this item…');
        setTimeout(() => setToast((prev) => (prev?.startsWith('AI cards already') ? null : prev)), 2200);
        return;
      }
      const fields =
        (categoryFields || {})[`${item.category}:${item.subCategory}`] ||
        (categoryFields || {})[item.category];
      enqueueProductCardBackgroundJob(item, { categoryFields: fields, inventoryItems: items });
      setAiCardRegenConfirmId(null);
      setToast(
        `Generating AI cards in background · ${item.name.slice(0, 36)}${item.name.length > 36 ? '…' : ''}`
      );
      setTimeout(() => setToast((prev) => (prev?.startsWith('Generating AI cards') ? null : prev)), 2600);
    },
    [categoryFields]
  );

  const handleGenerateListingPrep = useCallback(
    async (item: InventoryItem) => {
      if (!item.name?.trim()) {
        setToast('Enter an item name first');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      const children = getChildren(item, items);
      const gate = listingAccessoriesReady(item, children);
      if (!gate.ok) {
        setToast(gate.reason || 'Confirm OVP / IO Blende first');
        setTimeout(() => setToast(null), 3200);
        return;
      }

      setListingGenId(item.id);
      try {
        const categoryContext = `${item.category || 'Unknown'}${item.subCategory ? ' / ' + item.subCategory : ''}`;
        const knownKeys = resolveEssentialSpecKeys(item.category || '', item.subCategory, categoryFields);
        const specsResult = await generateItemSpecs(item.name, categoryContext, knownKeys);
        let newSpecs = mergeAiSpecsIntoEssential(
          item.specs,
          specsResult.specs,
          item.category || '',
          item.subCategory,
          categoryFields,
        );
        newSpecs = applyRamKitToSpecs(item.name, newSpecs);

        const withSpecs: InventoryItem = {
          ...item,
          specs: newSpecs,
          specsAiSuggested: Object.keys(newSpecs).length ? { ...newSpecs } : undefined,
          ...pickSpecsAiNameVendorUpdates(specsResult),
        };

        const listing = await generateMarketplaceListing(withSpecs, {
          hasOVP: item.hasOVP,
          hasIOShield: item.hasIOShield,
          hasReceipt: item.hasReceipt,
          aiDescriptionNote: item.aiDescriptionNote,
          children,
        });

        onUpdate(
          [
            {
              ...withSpecs,
              marketTitle: listing.ebayTitle,
              marketDescription: listing.listingText,
            },
          ],
          undefined,
          { skipActionLog: true },
        );
        setToast('Listing ready · title + description + specs');
        setTimeout(() => setToast((prev) => (prev?.startsWith('Listing ready') ? null : prev)), 2800);
      } catch (e: unknown) {
        console.error('Listing prep generation failed', e);
        const msg = (e as Error)?.message || 'Failed to generate listing.';
        setToast(msg.includes('API key') ? 'Add an AI key in .env and restart' : msg.slice(0, 120));
        setTimeout(() => setToast(null), 3600);
      } finally {
        setListingGenId(null);
      }
    },
    [items, categoryFields, onUpdate],
  );

  const handleGenerateListingDescription = async (item: InventoryItem) => {
    await handleGenerateListingPrep(item);
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
    const updated = linkInventoryItemToEbayOrder(item, match, POCKET_PROFIT_TAX_MODE, items);
    onUpdate([updated]);
    setToast(`Applied order ${match.order.orderId} to ${item.name}`);
    setTimeout(() => setToast((prev) => (prev?.startsWith('Applied order') ? null : prev)), 2200);
    closeOrderLookupModal();
  };

  // Visible Columns (from order, excluding hidden) — memoized so row renders are not invalidated every parent render
  const visibleColumns = useMemo(() => {
    const ALWAYS_HIDDEN = ['parseSpecs', 'actions', 'suggestedHubSplit'];
    return columnOrder.filter((id) => {
      if (hiddenColumnIds.includes(id) || ALWAYS_HIDDEN.includes(id)) return false;
      // Active stock: no State / Sell / Margin / Sold / Platform (those belong on Sold)
      if (
        (id === 'sellDate' ||
          id === 'salePlatform' ||
          id === 'status' ||
          id === 'sellPrice' ||
          id === 'profit') &&
        !splitView &&
        statusFilter === 'ACTIVE'
      ) {
        return false;
      }
      // In pure SOLD mode: hide STOCK AGE gauge (irrelevant once item is sold)
      if (id === 'timeGauge' && !splitView && statusFilter === 'SOLD') return false;
      return true;
    });
  }, [columnOrder, hiddenColumnIds, statusFilter, splitView]);

  const activeInventoryColumns = useMemo(
    () =>
      visibleColumns.filter(
        (id) =>
          id !== 'status' &&
          id !== 'sellPrice' &&
          id !== 'suggestedHubSplit' &&
          id !== 'profit' &&
          id !== 'sellDate' &&
          id !== 'salePlatform'
      ),
    [visibleColumns]
  );

  const [draggingColumnId, setDraggingColumnId] = useState<ColumnId | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<ColumnId | null>(null);

  const handleColumnDragStart = useCallback((colId: ColumnId) => {
    if (colId === 'select') return;
    setDraggingColumnId(colId);
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent, colId: ColumnId) => {
    if (!draggingColumnId || colId === 'select' || colId === draggingColumnId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumnId(colId);
  }, [draggingColumnId]);

  const handleColumnDrop = useCallback((colId: ColumnId) => {
    if (!draggingColumnId || colId === 'select' || draggingColumnId === colId) {
      setDraggingColumnId(null);
      setDragOverColumnId(null);
      return;
    }
    setColumnOrder((prev) => {
      const next: ColumnId[] = prev.filter((id) => id !== 'actions');
      const from = next.indexOf(draggingColumnId);
      const to = next.indexOf(colId);
      if (from < 0 || to < 0) return prev;
      const copy: ColumnId[] = [...next];
      copy.splice(from, 1);
      copy.splice(to, 0, draggingColumnId);
      return copy;
    });
    setDraggingColumnId(null);
    setDragOverColumnId(null);
  }, [draggingColumnId]);

  const handleColumnDragEnd = useCallback(() => {
    setDraggingColumnId(null);
    setDragOverColumnId(null);
  }, []);

  // Bumped once web fonts finish loading so the canvas measurement below re-runs with the real
  // font metrics instead of whatever fallback font was active during the first paint.
  const [fontsReadyTick, setFontsReadyTick] = useState(0);
  useEffect(() => {
    const fonts = (document as any).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => setFontsReadyTick((t) => t + 1));
    }
  }, []);

  // Calculate Date Range based on filter
  const dateRange = useMemo(() => getTimeFilterDateRange(timeFilter), [timeFilter]);

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
    const searchLower = deferredSearchTerm.toLowerCase();
    return items.filter(item => {
      let matchesStatus = false;
      if (statusFilter === 'ACTIVE') matchesStatus = itemMatchesActiveInventoryTab(item, items);
      else if (statusFilter === 'SOLD') {
        matchesStatus = isRealizedDisposal(item);
        if (
          !matchesStatus &&
          shouldSurfaceSoldContainerPartInList(item, items, statusFilter, categoryFilter, subCategoryFilter)
        ) {
          matchesStatus = true;
        }
      } else if (statusFilter === 'DRAFTS') matchesStatus = item.isDraft === true;
      else matchesStatus = true;
      if (!matchesStatus) return false;

      // Optional visibility toggle for orphan "In Composition" items (container children always nest)
      if (
        !showInComposition &&
        item.status === ItemStatus.IN_COMPOSITION &&
        !shouldSurfaceSoldContainerPartInList(item, items, statusFilter, categoryFilter, subCategoryFilter)
      ) {
        return false;
      }
      if (shouldHideContainerChildInList(item, items)) {
        if (
          !shouldSurfaceSoldContainerPartInList(item, items, statusFilter, categoryFilter, subCategoryFilter)
        ) {
          return false;
        }
      }
      if (categoryFilter !== 'ALL' || subCategoryFilter) {
        if (!matchesInventoryCategoryPin(item, categoryFilter, subCategoryFilter)) return false;
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
        if (isItemHiddenByPlatformFilter(item, excludedPlatforms)) return false;
        if (salePaymentFilter !== 'ALL' && item.paymentType !== salePaymentFilter) return false;
      }
      return true;
    });
  }, [items, deferredSearchTerm, statusFilter, categoryFilter, subCategoryFilter, timeFilter, dateRange, excludedPlatforms, salePaymentFilter, showInComposition, showSpecFiltersPanel, hasActiveSpecFilters, activeQuickPin]);

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
      searchTerm: deferredSearchTerm,
      categoryFilter,
      subCategoryFilter,
      sortConfig,
      timeFilter,
      dateRange,
      excludedPlatforms,
      salePaymentFilter,
      amountFilter,
      specFilters,
      specRangeFilters,
      showInComposition,
      timeGaugeSortKeyMap,
      smartPreset,
      bulkImportFilterId,
      bulkImportItemIds,
      hiddenChildIds,
      lookup: inventoryLookup,
    }),
    [
      items,
      deferredSearchTerm,
      categoryFilter,
      subCategoryFilter,
      sortConfig,
      timeFilter,
      dateRange,
      excludedPlatforms,
      salePaymentFilter,
      amountFilter,
      specFilters,
      specRangeFilters,
      showInComposition,
      timeGaugeSortKeyMap,
      smartPreset,
      bulkImportFilterId,
      bulkImportItemIds,
      hiddenChildIds,
      inventoryLookup,
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

  // Narrow-by-default column widths: computed from visible rows (Flags = widest icon row in view).
  const autoWidthSourceItems = useMemo(() => {
    if (splitView) {
      const union = [...sortedActiveItems, ...sortedSoldItems];
      return union.length ? union : items;
    }
    return sortedItems.length ? sortedItems : items;
  }, [splitView, sortedActiveItems, sortedSoldItems, sortedItems, items]);

  const autoColumnWidthsRaw = useMemo(
    () =>
      computeAutoColumnWidths(
        autoWidthSourceItems,
        items,
        listDensity,
        resolveItemBulkImportId,
        sortConfig.key
      ),
    [autoWidthSourceItems, items, fontsReadyTick, listDensity, resolveItemBulkImportId, sortConfig.key]
  );
  // QW2: keep a stable identity while the computed values are unchanged (typing in search
  // recomputes this every keystroke, but the numbers almost never differ).
  const autoColumnWidthsStableRef = useRef(autoColumnWidthsRaw);
  if (
    autoColumnWidthsStableRef.current !== autoColumnWidthsRaw &&
    !sameWidthRecord(autoColumnWidthsStableRef.current, autoColumnWidthsRaw)
  ) {
    autoColumnWidthsStableRef.current = autoColumnWidthsRaw;
  }
  const autoColumnWidths = autoColumnWidthsStableRef.current;

  // Google Sheets-style fit for the Flags column: measure the actual rendered icon strips
  // in the DOM and size the column to the widest one. The estimate above is only a floor,
  // so a newly added icon type automatically widens the column without any constant edits.
  const [measuredPresenceWidth, setMeasuredPresenceWidth] = useState(0);
  const presenceMeasureKey = useMemo(
    () => `${items.length}|${listDensity}|${fontsReadyTick}`,
    [items.length, listDensity, fontsReadyTick]
  );
  const lastPresenceWidthRef = useRef(0);
  const presenceMeasureKeyRef = useRef(presenceMeasureKey);
  useLayoutEffect(() => {
    if (presenceMeasureKeyRef.current !== presenceMeasureKey) {
      presenceMeasureKeyRef.current = presenceMeasureKey;
      lastPresenceWidthRef.current = 0;
    }
    let widest = 0;
    document.querySelectorAll<HTMLElement>('[data-flags-strip]').forEach((el) => {
      const w = el.scrollWidth;
      if (w > widest) widest = w;
    });
    const target =
      widest > 0 ? Math.ceil(widest) + (listDensity === 'compact' ? 11 : 13) : 0;
    if (target === lastPresenceWidthRef.current) return;
    lastPresenceWidthRef.current = target;
    setMeasuredPresenceWidth((prev) => (prev === target ? prev : target));
    // Remeasure only when inventory size / density / fonts change — not on every items reference swap.
  }, [presenceMeasureKey, listDensity]);

  const effectiveColumnWidthsRaw = useMemo(() => {
    const merged: Record<string, number> = { ...columnWidths };
    for (const colId of AUTO_SIZE_COLUMN_IDS) {
      if (autoColumnWidths[colId] != null) {
        merged[colId] = autoColumnWidths[colId]!;
      }
    }
    if (measuredPresenceWidth > 0) {
      merged['presence'] = clampAutoColumnWidth(
        'presence',
        Math.max(merged['presence'] ?? 0, measuredPresenceWidth)
      );
    }
    return merged;
  }, [columnWidths, autoColumnWidths, measuredPresenceWidth]);
  // QW2: renderRowCells (and therefore every memoized row) keys off this object's identity.
  const effectiveColumnWidthsStableRef = useRef(effectiveColumnWidthsRaw);
  if (
    effectiveColumnWidthsStableRef.current !== effectiveColumnWidthsRaw &&
    !sameWidthRecord(effectiveColumnWidthsStableRef.current, effectiveColumnWidthsRaw)
  ) {
    effectiveColumnWidthsStableRef.current = effectiveColumnWidthsRaw;
  }
  const effectiveColumnWidths = effectiveColumnWidthsStableRef.current;
  const effectiveColumnWidthsRef = useRef(effectiveColumnWidths);
  useEffect(() => {
    effectiveColumnWidthsRef.current = effectiveColumnWidths;
  }, [effectiveColumnWidths]);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const activeTableRef = useRef<HTMLDivElement>(null);
  const soldTableRef = useRef<HTMLDivElement>(null);
  const rowHeightEstimate = listDensity === 'compact' ? 97 : 113;

  const snapshotInventoryScrollTops = useCallback((): Map<HTMLDivElement, number> => {
    const tops = new Map<HTMLDivElement, number>();
    for (const ref of [tableContainerRef, activeTableRef, soldTableRef]) {
      if (ref.current) tops.set(ref.current, ref.current.scrollTop);
    }
    return tops;
  }, []);

  const restoreInventoryScrollTops = useCallback((tops: Map<HTMLDivElement, number>) => {
    tops.forEach((top, el) => {
      el.scrollTop = top;
    });
  }, []);

  const pendingScrollRestoreRef = useRef<Map<HTMLDivElement, number> | null>(null);

  const runSelectionUpdate = useCallback(
    (updater: (prev: string[]) => string[]) => {
      pendingScrollRestoreRef.current = snapshotInventoryScrollTops();
      setSelectedIds(updater);
    },
    [snapshotInventoryScrollTops]
  );

  useLayoutEffect(() => {
    const tops = pendingScrollRestoreRef.current;
    if (!tops || tops.size === 0) return;
    pendingScrollRestoreRef.current = null;
    restoreInventoryScrollTops(tops);
    requestAnimationFrame(() => restoreInventoryScrollTops(tops));
  }, [selectedIds, restoreInventoryScrollTops]);

  useEffect(() => {
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    if (activeTableRef.current) activeTableRef.current.scrollTop = 0;
    if (soldTableRef.current) soldTableRef.current.scrollTop = 0;
  }, [deferredSearchTerm, timeFilter, sortConfig, statusFilter, categoryFilter, subCategoryFilter, excludedPlatforms, salePaymentFilter, amountFilter, specFilters, specRangeFilters, splitView]);

  const getRowActivityKey = useCallback(
    (item: InventoryItem) => {
      // Include editValue (not just which field is being edited) while this row is the one being
      // edited — otherwise the key stays identical across every keystroke, the row's React.memo
      // sees "no change," and the input silently stops updating after the very first keystroke.
      // Include quickBundleSeed so Flags “+” panel open/close re-renders the memoized row
      // (otherwise X / Cancel set state but the inline panel stays mounted).
      // Nested part buy/sell/name must be in the key too: React.memo compares parent `item` by
      // reference, so renaming a child (or recalculating only child prices) would otherwise
      // leave the expanded bundle body showing stale nested UI.
      let kidsKey = '';
      let kidsEditKey = '';
      if (item.isPC || item.isBundle) {
        const kids = getChildren(item, items);
        kidsKey = `|kids:${kids
          .map(
            (c) =>
              `${c.id}:${c.name}:${c.sellPrice ?? ''}:${c.buyPrice ?? ''}:${c.profit ?? ''}:${c.status ?? ''}`,
          )
          .join(',')}`;
        // Nested inline rename: parent row must re-render on every keystroke (same memo trap as
        // top-level item name edit).
        if (editingCell && kids.some((c) => c.id === editingCell.itemId)) {
          kidsEditKey = `|cedit:${editingCell.itemId}:${editingCell.field}:${editValue}`;
        }
      }
      // Thumb fingerprint: photo *count* alone is not enough (replace/reorder main with same count).
      const thumb = getItemUserPhotoUrls(item)[0] || '';
      const fin = `fin:${item.sellPrice ?? ''}:${item.profit ?? ''}:${item.feeAmount ?? ''}:${item.saleProceeds?.netPayoutEur ?? ''}:${item.saleProceeds?.buyerTotalEur ?? ''}:${item.saleProceeds?.source ?? ''}:${item.saleProceeds?.refundEur ?? ''}`;
      return `${editingCell?.itemId === item.id ? `${editingCell.field}:${editValue}` : ''}|${listingGenId === item.id}|${parsingSingleId === item.id}|${priceSuggestId === item.id}|${(item.isPC || item.isBundle) && collapsedBundles.has(item.id) ? 'col' : 'exp'}|${quickBundleSeed?.id === item.id ? 'qb' : ''}|${activeBgCardItemIds.has(item.id) ? 'bgcard' : ''}|${itemAiCardCounts[item.id] || 0}|${aiCardRegenConfirmId === item.id ? 'confirm' : ''}|lr:${item.saleReady ? 1 : 0}:${(item.marketTitle || '').length}:${(item.marketDescription || '').length}|ph:${getItemUserPhotoCount(item)}:${thumb.slice(-48)}|${fin}${kidsKey}${kidsEditKey}`;
    },
    [editingCell, editValue, listingGenId, parsingSingleId, priceSuggestId, collapsedBundles, quickBundleSeed, activeBgCardItemIds, itemAiCardCounts, aiCardRegenConfirmId, items]
  );

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

  const profitForDisplay = useCallback(
    (item: InventoryItem): number | null => {
      if (item.isPC || item.isBundle) return null;
      if (item.sellPrice == null) return item.profit ?? null;
      return computeSoldTabMargin(item);
    },
    []
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
    const th = (e.currentTarget as HTMLElement).closest('th');
    const measured = th?.getBoundingClientRect().width ?? 0;
    const fallback =
      effectiveColumnWidthsRef.current[colId] ??
      columnWidthsRef.current[colId] ??
      DEFAULT_WIDTHS[colId];
    const startW = clampInventoryColumnWidth(colId, measured > 40 ? measured : fallback);
    setManualWidthColumns((prev) => (prev.has(colId) ? prev : new Set(prev).add(colId)));
    setColumnWidths((prev) => (prev[colId] === startW ? prev : { ...prev, [colId]: startW }));
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

  const handleResetItemColumnWidth = useCallback(() => {
    setColumnWidths((prev) => ({ ...prev, item: DEFAULT_WIDTHS.item }));
    setManualWidthColumns((prev) => {
      if (!prev.has('item')) return prev;
      const next = new Set(prev);
      next.delete('item');
      return next;
    });
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

    if (targetField === 'buyDate' || targetField === 'sellDate') {
      newValue = toLocalCalendarDateKey(String(editValue)) || String(editValue).trim();
    }

    const updates: Partial<InventoryItem> = { [targetField]: newValue };

    // Logic to release from composition if status is changed manually
    if (targetField === 'status') {
        if (item.status === ItemStatus.IN_COMPOSITION && newValue !== ItemStatus.IN_COMPOSITION) {
            updates.parentContainerId = undefined; // Detach from parent
        }
    }

    const merged = { ...item, ...updates };
    if (targetField === 'buyPrice' || targetField === 'sellPrice') {
      onUpdate(expandSoldContainerPriceSync(merged, targetField, items));
    } else {
      onUpdate([merged]);
    }
    setEditingCell(null);
  };

  const saveSellerShipping = useCallback(
    (item: InventoryItem, amount: number) => {
      onUpdate([applyManualSellerShipping(item, amount)]);
    },
    [onUpdate]
  );

  const handleSelectAll = useCallback(() => {
    runSelectionUpdate((prev) => {
      if (prev.length === sortedItems.length && sortedItems.length > 0) return [];
      return sortedItems.map((i) => i.id);
    });
  }, [sortedItems, runSelectionUpdate]);

  const handleSelectAllFor = useCallback(
    (list: InventoryItem[]) => {
      runSelectionUpdate((prev) => {
        const listIds = list.map((i) => i.id);
        const allInPaneSelected = listIds.length > 0 && listIds.every((id) => prev.includes(id));
        if (allInPaneSelected) {
          return prev.filter((id) => !listIds.includes(id));
        }
        return [...new Set([...prev, ...listIds])];
      });
    },
    [runSelectionUpdate]
  );

  const toggleSelect = useCallback(
    (id: string) => {
      runSelectionUpdate((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return [...next];
      });
    },
    [runSelectionUpdate]
  );

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const deferredSelectedIds = useDeferredValue(selectedIds);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const containersById = useMemo(() => buildContainersById(items), [items]);
  const containerByChildId = useMemo(() => buildContainerByChildId(items), [items]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const child of items) {
      if (!child.parentContainerId) continue;
      const list = map.get(child.parentContainerId) || [];
      list.push(child);
      map.set(child.parentContainerId, list);
    }
    for (const parent of items) {
      if (!(parent.isPC || parent.isBundle) || !parent.componentIds?.length) continue;
      const kids = parent.componentIds
        .map((id) => itemsById.get(id))
        .filter(Boolean) as InventoryItem[];
      if (kids.length) map.set(parent.id, kids);
    }
    return map;
  }, [items, itemsById]);

  const deferredItemsForSuggest = useDeferredValue(items);
  const deferredChildrenByParent = useDeferredValue(childrenByParentId);
  const [suggestedEbayById, setSuggestedEbayById] = useState(
    () => new Map<string, SuggestedEbayPrice>()
  );

  // Suggest chips: cheap snapshots first frame, full comps after idle (keeps open instant).
  useEffect(() => {
    let cancelled = false;
    const fees = loadFlipFees();
    const children = deferredChildrenByParent;
    const list = deferredItemsForSuggest;

    const paintFast = () => {
      if (cancelled) return;
      setSuggestedEbayById(
        buildSuggestedEbayMap(list, fees, {
          childrenByParent: children,
          limit: 80,
          snapshotsOnly: true,
        })
      );
    };

    const paintFull = () => {
      if (cancelled) return;
      startTransition(() => {
        setSuggestedEbayById(
          buildSuggestedEbayMap(list, fees, {
            childrenByParent: children,
            limit: 100,
            snapshotsOnly: false,
          })
        );
      });
    };

    // Microtask: snapshots/cost only (no sales-pool rebuild).
    const t0 = window.setTimeout(paintFast, 0);
    scheduleBackgroundWork(paintFull);
    return () => {
      cancelled = true;
      window.clearTimeout(t0);
    };
  }, [deferredItemsForSuggest, deferredChildrenByParent]);

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
    // Don't open Edit / PC Builder while the Flags “+” add panel is open
    if (quickBundleSeed) return;
    // If there's already a pending click, do nothing (double-click handler will take over)
    if (rowClickTimeoutRef.current != null) return;
    rowClickTimeoutRef.current = window.setTimeout(() => {
      rowClickTimeoutRef.current = null;
      // Re-check: panel may have opened during the delay
      if (quickBundleSeedRef.current) return;
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
                parentContainerId: undefined,
                isSplitRemainder: undefined
             };
          } else {
             return {
                ...c,
                status: ItemStatus.IN_STOCK,
                parentContainerId: undefined,
                isSplitRemainder: undefined,
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

  /** Remove one child from a PC / Bundle / Mixed Bundle → back to active stock; parent buy total recalculates. */
  const handleRemoveFromContainer = useCallback(
    (child: InventoryItem, parent: InventoryItem) => {
      if (!parent || child.id === parent.id) return;
      const remaining = items.filter(
        (i) =>
          i.id !== child.id &&
          (((parent.componentIds || []).includes(i.id) || i.parentContainerId === parent.id) &&
            !i.isPC &&
            !i.isBundle)
      );
      const buyTotal = Math.round(remaining.reduce((s, i) => s + Number(i.buyPrice || 0), 0) * 100) / 100;
      const restoreAsSold = isRealizedDisposal(parent) || parent.subCategory === 'Retro Bundle';
      // The leaving part keeps its own sale value — the container's sell total must shrink
      // by the same amount, or that value gets counted twice (once on the now-standalone
      // item, once still baked into the container's unchanged total).
      const sellTotal = restoreAsSold
        ? Math.round(remaining.reduce((s, i) => s + Number(i.sellPrice || 0), 0) * 100) / 100
        : undefined;
      const restored: InventoryItem = restoreAsSold
        ? { ...child, parentContainerId: undefined, isSplitRemainder: undefined, status: ItemStatus.SOLD }
        : {
            ...child,
            parentContainerId: undefined,
            isSplitRemainder: undefined,
            status: ItemStatus.IN_STOCK,
            sellPrice: undefined,
            sellDate: undefined,
            profit: undefined,
            paymentType: undefined,
            platformSold: undefined,
            containerSoldDate: undefined,
          };
      let updatedParent: InventoryItem = {
        ...parent,
        componentIds: remaining.map((p) => p.id),
        buyPrice: buyTotal,
        ...(sellTotal != null ? { sellPrice: sellTotal } : {}),
        comment2: remaining
          .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
          .join('\n')
          .slice(0, 2000),
      };
      // Drop removed hardware from name/marketTitle so listing AI matches remaining parts.
      const kind = getContainerKind(updatedParent);
      if (kind) {
        updatedParent = withRebuiltContainerTitle(updatedParent, kind, remaining);
      }
      if (remaining.length === 0) {
        onUpdate([restored], [parent.id]);
        setToast(`Removed “${child.name}” · last part · container removed`);
      } else {
        onUpdate([updatedParent, restored]);
        setToast(
          `Removed “${child.name}” → active · title updated · €${formatEUR(buyTotal)}`
        );
      }
      setTimeout(() => setToast(null), 2400);
    },
    [items, onUpdate]
  );

  const handleEditClick = (item: InventoryItem) => {
    // Flags “+” panel open — never navigate away
    if (quickBundleSeedRef.current) return;
    addRecentItemId(item.id);
    // Always stay on inventory: edit in modal (PC / Bundle included — no Builder route)
    setItemToEdit(item);
  };

  /** Rebuild PC / Bundle / Mixed title from current parts (fixed RAM kit totals, etc.). */
  const handleRebuildContainerTitle = useCallback(
    (container: InventoryItem) => {
      const kind = getContainerKind(container);
      if (!kind) {
        setToast('Only PC / Bundle titles can be rebuilt from parts');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      const parts = getChildren(container, items);
      if (parts.length === 0) {
        setToast('No parts found to rebuild title from');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      const updated = withRebuiltContainerTitle(container, kind, parts);
      if (!updated.name || updated.name === container.name) {
        setToast(
          updated.name === container.name ? 'Title already up to date' : 'Could not build a new title'
        );
        setTimeout(() => setToast(null), 2200);
        return;
      }
      onUpdate([updated], undefined, { skipUndo: false, flushCloud: true });
      setToast(`Title rebuilt · ${updated.name}`);
      setTimeout(() => setToast(null), 2800);
    },
    [items, onUpdate]
  );

  const createContainerInInventory = useCallback(
    (type: 'pc' | 'bundle' | 'mixed', parts: InventoryItem[]) => {
      if (parts.length === 0) return;
      const { available, blocked } = filterPartsAvailableForCompose(parts, items);
      if (blocked.length > 0) {
        setToast(
          `${blocked.length} part${blocked.length === 1 ? '' : 's'} already in another PC/bundle — skipped`
        );
        setTimeout(() => setToast(null), 2800);
      }
      if (available.length === 0) {
        alert('All selected parts are already inside another PC or bundle.');
        return;
      }
      const kind = type === 'pc' ? 'pc' : type === 'bundle' ? 'bundle' : 'mixed';
      const parentId =
        type === 'pc' ? `pc-${Date.now()}` : `bundle-inline-${Date.now()}`;
      const title = buildContainerTitle(kind, available);
      const buyTotal =
        Math.round(available.reduce((s, i) => s + Number(i.buyPrice || 0), 0) * 100) / 100;
      const defectiveCount = available.filter((i) => i.isDefective).length;
      const parent: InventoryItem = {
        id: parentId,
        name: title,
        category: type === 'pc' ? 'PC' : type === 'mixed' ? 'Mixed Bundle' : 'Bundle',
        status: ItemStatus.IN_STOCK,
        buyPrice: buyTotal,
        buyDate: averageDateKey(available.map((i) => i.buyDate)),
        comment1:
          type === 'pc'
            ? `PC Build (${available.length} parts).`
            : type === 'mixed'
              ? `Mixed Bundle (${available.length} items)${defectiveCount ? ` · ${defectiveCount} defekt` : ''}.`
              : `Bundle (${available.length} items).`,
        comment2: available
          .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
          .join('\n')
          .slice(0, 2000),
        isPC: type === 'pc',
        isBundle: type !== 'pc',
        componentIds: available.map((p) => p.id),
        vendor:
          type === 'pc' ? 'Custom Build' : type === 'mixed' ? 'Mixed Bundle' : 'PC Bundle',
        marketTitle: title,
        imageUrl: available.find((p) => p.imageUrl)?.imageUrl,
        presence: 'present',
      };
      const updatedParts = available.map((comp) => ({
        ...comp,
        status: ItemStatus.IN_COMPOSITION,
        parentContainerId: parentId,
      }));
      onUpdate([parent, ...updatedParts]);
      setSelectedIds([]);
      setShowComposeType(false);
      setScrollTargetItemId(parentId);
      setCollapsedBundles((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      setToast(
        type === 'pc'
          ? `PC created in inventory · ${available.length} parts`
          : type === 'mixed'
            ? `Mixed Bundle created · ${available.length} parts`
            : `Bundle created · ${available.length} parts`
      );
      setTimeout(() => setToast(null), 2400);
    },
    [items, onUpdate]
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
      setCollapsedBundles((prev) => {
        if (!prev.has(parent.id)) return prev;
        const next = new Set(prev);
        next.delete(parent.id);
        return next;
      });
      setScrollTargetItemId(parent.id);
    },
    []
  );

  const openParentContainer = useCallback(
    (parent: InventoryItem) => {
      addRecentItemId(parent.id);
      // Stay in inventory — expand & scroll (never open PC Builder)
      focusContainerInList(parent);
    },
    [focusContainerInList]
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
      const newSpecs = applyRamKitToSpecs(
        item.name,
        mergeAiSpecsIntoEssential(item.specs, result.specs, item.category || '', item.subCategory, categoryFields),
      );
      // Specs parse must not rename standalone items — only the explicit AI title button may.
      const updates: Partial<InventoryItem> = {
        specs: newSpecs,
        specsAiSuggested: Object.keys(newSpecs).length ? { ...newSpecs } : undefined,
        ...pickSpecsAiNameVendorUpdates(result),
      };
      const merged = { ...item, ...updates };
      onUpdate(items.map((i) => (i.id === item.id ? merged : i)));
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Parse failed';
      alert(msg.includes('API key') ? `${msg}\n\nAdd the key in .env and restart.` : msg);
    } finally {
      setParsingSingleId(null);
    }
  }, [items, categoryFields, onUpdate]);

  const openComposeChooser = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (selectedIds.length === 0) {
      alert('Select at least one item first.');
      return;
    }
    setShowComposeType(true);
  };

  const handleComposeTypeChosen = (type: ComposeType) => {
    setShowComposeType(false);
    const selectedItemsList = items.filter((i) => selectedIds.includes(i.id));

    if (type === 'sold') {
      if (selectedItemsList.length < 2) {
        alert('Select at least 2 sold items to group.');
        return;
      }
      if (!selectedItemsList.every((i) => isRealizedDisposal(i))) {
        alert('Sold grouping only works when all selected items are sold/traded/gifted.');
        return;
      }
      setShowRetroBundle(true);
      return;
    }

    const blocked = selectedItemsList.filter((i) => i.parentContainerId || i.isBundle || i.isPC);
    if (blocked.length > 0) {
      alert('Some selected items are already inside another bundle/PC or are containers.');
      return;
    }

    if (type === 'pc' || type === 'bundle') {
      const validItems = selectedItemsList.filter(
        (i) =>
          !i.isDefective &&
          (i.status === ItemStatus.IN_STOCK || i.status === ItemStatus.ORDERED)
      );
      if (validItems.length === 0) {
        alert(
          `No valid items for a ${type === 'bundle' ? 'Bundle' : 'PC'} (defective blocked — use Mixed Bundle).`
        );
        return;
      }
      if (validItems.length < selectedItemsList.length) {
        const skipped = selectedItemsList.length - validItems.length;
        if (
          !window.confirm(
            `${skipped} item(s) skipped (defective or wrong status). Continue with ${validItems.length} part(s)?`
          )
        ) {
          return;
        }
      }
      // Stay in inventory — create immediately (no Builder page)
      createContainerInInventory(type, validItems);
      return;
    }

    // Mixed Bundle — defective allowed
    const validItems = selectedItemsList.filter(
      (i) => i.status === ItemStatus.IN_STOCK || i.status === ItemStatus.ORDERED
    );
    if (validItems.length === 0) {
      alert('Mixed Bundle needs In Stock / Ordered items.');
      return;
    }
    createContainerInInventory('mixed', validItems);
  };

  const handleCreateRetroBundle = (bundle: InventoryItem, updatedComponents: InventoryItem[]) => {
     const { available, blocked } = filterPartsAvailableForCompose(updatedComponents, items);
     if (blocked.length > 0 && available.length < 2) {
       alert(
         `These parts are already inside another PC/bundle. Remove the duplicate suggestion instead of composing again.`
       );
       setShowRetroBundle(false);
       return;
     }
     const components =
       available.length >= 2
         ? available.map((c) => ({
             ...c,
             status: c.status,
             parentContainerId: bundle.id,
           }))
         : updatedComponents;
     const nextBundle =
       available.length >= 2
         ? {
             ...bundle,
             componentIds: available.map((c) => c.id),
             buyPrice: Math.round(available.reduce((s, i) => s + Number(i.buyPrice || 0), 0) * 100) / 100,
             sellPrice: Math.round(available.reduce((s, i) => s + Number(i.sellPrice || 0), 0) * 100) / 100,
           }
         : bundle;
     const { nextItems, deleteIds } = applyRetroComposeToInventory(items, nextBundle, components);
     const changed = nextItems.filter((n) => {
       const old = items.find((i) => i.id === n.id);
       return !old || old !== n;
     });
     onUpdate(changed, deleteIds);
     setShowRetroBundle(false);
     setSelectedIds([]);
     setScrollTargetItemId(nextBundle.id);
     setCollapsedBundles((prev) => {
       const next = new Set(prev);
       next.delete(nextBundle.id);
       return next;
     });
     if (deleteIds.length > 0) {
       setToast(`Grouped — removed ${deleteIds.length} duplicate sold shell${deleteIds.length === 1 ? '' : 's'}`);
       setTimeout(() => setToast(null), 2800);
     }
     // Clear any horizontal scroll leftover from the modal / selection bar layout swap.
     requestAnimationFrame(() => {
       for (const ref of [tableContainerRef, activeTableRef, soldTableRef]) {
         if (ref.current) ref.current.scrollLeft = 0;
       }
     });
  };

  const equalSplitGroupCount = useMemo(
    () => countEqualSplitSoldGroupCandidates(items),
    [items, equalSplitIgnoreRev]
  );

  const handleApplyRecalc = (updates: Array<{ itemId: string; newSellPrice: number }>) => {
    const container = recalcTarget;
    const byId = new Map(updates.map((u) => [u.itemId, u.newSellPrice]));
    const updatedItems = items
      .filter((i) => byId.has(i.id))
      .map((i) => {
        const newSellPrice = byId.get(i.id)!;
        const buyPrice = Number(i.buyPrice) || 0;
        const fee = Number(i.feeAmount) || 0;
        return { ...i, sellPrice: newSellPrice, profit: newSellPrice - buyPrice - fee };
      });
    const changedCount = updatedItems.filter((i) => {
      const next = byId.get(i.id)!;
      const prev = Number(items.find((x) => x.id === i.id)?.sellPrice) || 0;
      return Math.abs(next - prev) >= 0.005;
    }).length;
    onUpdate(updatedItems, undefined, { flushCloud: true, skipActionLog: true });
    if (container) {
      setCollapsedBundles((prev) => {
        if (!prev.has(container.id)) return prev;
        const next = new Set(prev);
        next.delete(container.id);
        return next;
      });
      setScrollTargetItemId(container.id);
    }
    setRecalcTarget(null);
    setToast(
      changedCount > 0
        ? `Component prices updated · ${changedCount} part${changedCount === 1 ? '' : 's'} changed`
        : 'Component prices already match this split'
    );
    setTimeout(() => setToast(null), 2800);
  };

  /** SMART-resplit container lot buy cost across current parts (incl. items added later). */
  const handleResplitContainerBuy = useCallback(
    (container: InventoryItem) => {
      const children = getChildren(container, items);
      if (children.length === 0) {
        setToast('No parts to resplit');
        setTimeout(() => setToast(null), 2000);
        return;
      }
      const lot = Number(container.buyPrice) || children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
      if (!(lot > 0)) {
        setToast('Set a buy price on the bundle first');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      const ok = window.confirm(
        `Resplit €${formatEUR(lot)} across ${children.length} parts with SMART weights?\n\nEach part’s buy price will be replaced by a proportional share of the lot total.`
      );
      if (!ok) return;
      const { parent, children: patched } = resplitContainerBuyPrices({
        container,
        items,
        totalCost: lot,
        mode: 'SMART',
      });
      onUpdate([parent, ...patched], undefined, { flushCloud: true, skipActionLog: true });
      setToast(`Buy prices resplit · €${formatEUR(lot)} across ${patched.length} parts`);
      setTimeout(() => setToast(null), 2400);
    },
    [items, onUpdate]
  );

  const handleBulkEditSales = (platform: Platform, payment: PaymentType) => {
     const selected = items.filter((i) => selectedIds.includes(i.id)).map((i) => ({
        ...i,
        platformSold: platform,
        paymentType: payment,
     }));
     // Sold PC/bundle selection also stamps every linked part with the same platform.
     const updates = expandUpdatesWithContainerSaleMeta(selected, items);
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
    const updates =
      platform && (next.isPC || next.isBundle)
        ? expandUpdatesWithContainerSaleMeta([next], items)
        : [next];
    startTransition(() => {
      onUpdate(updates, undefined, {
        skipActionLog: true,
        skipContainerSync: true,
      });
      if (platform) {
        const childCount = updates.length - 1;
        setToast(
          childCount > 0
            ? `Sold on ${formatSalePlatformLabel(platform)} · ${childCount} part${childCount === 1 ? '' : 's'} updated`
            : `Sold on ${formatSalePlatformLabel(platform)}`
        );
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
           const result = await generateMarketplaceListing(selected[i], {
             hasOVP: selected[i].hasOVP,
             hasIOShield: selected[i].hasIOShield,
             hasReceipt: selected[i].hasReceipt,
             aiDescriptionNote: selected[i].aiDescriptionNote,
             children: getChildren(selected[i], items),
           });
           updates.push({
             ...selected[i],
             marketTitle: result.ebayTitle,
             marketDescription: result.listingText,
             storeDescription: result.listingText,
           });
        } catch (err) {
           console.warn('AI description failed for', selected[i].name, err);
        }
     }
     if (updates.length > 0) onUpdate(updates);
     setBulkGenerateProgress(null);
     setBulkGenerateDescriptions(false);
     setSelectedIds([]);
  };

  const renderCell = (item: InventoryItem, id: ColumnId, isSelected: boolean, _itemFlexWidth?: number | null) => {
    const width = effectiveColumnWidths[id] || columnWidths[id] || DEFAULT_WIDTHS[id];
    const itemLocked = id === 'item' && manualWidthColumns.has('item');
    const style =
      id === 'item' && !itemLocked
        ? { minWidth: `${width}px`, width: 'auto' as const, maxWidth: 'none' as const }
        : { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };
    const dense = listDensity === 'compact';
    const iconBtn = dense ? 'h-6 w-6' : 'h-7 w-7';
    const thumbPx = dense ? 32 : 36;
    /** Missing flag actions render nothing — row packs tight instead of reserving empty slots. */
    const iconSlotReserve = null;

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
          <td
            key={id}
            className="inv-col-icons border-r border-slate-100/90 align-middle overflow-visible"
            style={{
              width: `${width}px`,
              minWidth: `${width}px`,
              maxWidth: `${width}px`,
              overflow: 'visible',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              data-flags-strip
              className={`inline-flex flex-nowrap items-center justify-start ${dense ? 'gap-0' : 'gap-px'} w-max`}
            >
              {/* 1–2: Mark sold, Delete (same order as former title-row actions) */}
              {!item.parentContainerId &&
              (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    addRecentItemId(item.id);
                    setItemToSell(item);
                  }}
                  className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 transition-colors`}
                  title="Mark Sold"
                  aria-label={`Mark ${item.name} sold`}
                >
                  <ShoppingBag size={13} strokeWidth={2.25} />
                </button>
              ) : (
                iconSlotReserve
              )}
              {!item.parentContainerId ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setItemToDelete(item);
                  }}
                  className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors`}
                  title="Delete"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 size={13} strokeWidth={2.25} />
                </button>
              ) : (
                iconSlotReserve
              )}

              {/* Listed on eBay (link to live listing) — or, if not listed yet, ready-to-publish badge */}
              {!item.parentContainerId &&
              (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) ? (
                item.listedOnEbay && item.ebayListingId ? (
                  <a
                    href={buildEbayItemUrl(item.ebayListingId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors`}
                    title="Live on eBay — click to open the listing"
                    aria-label={`Open eBay listing for ${item.name}`}
                  >
                    <Link2 size={13} strokeWidth={2.25} />
                  </a>
                ) : getEbayPublishReadiness(item).ok ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditClick(item);
                    }}
                    className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors`}
                    title="Ready to publish to eBay — click to open and publish"
                    aria-label={`${item.name} is ready to publish to eBay`}
                  >
                    <CheckCircle2 size={13} strokeWidth={2.25} />
                  </button>
                ) : (
                  iconSlotReserve
                )
              ) : (
                iconSlotReserve
              )}

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
                    : '? Presence not set — click to mark present / lost / defective'
                }
              >
                {cycleState === 'defective' ? (
                  <AlertCircle size={13} className="text-amber-600" />
                ) : cycleState === 'unknown' ? (
                  <span className="text-[11px] font-black leading-none text-slate-500">?</span>
                ) : (
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    cycleState === 'present'
                      ? 'bg-emerald-500'
                      : 'bg-red-500'
                  }`}
                />
                )}
              </button>
                );
              })()}

              {/* Add photos (replaces former defective quick button slot) */}
              {(() => {
                const qc = photoQcSummary(item);
                return (
              <button
                type="button"
                onClick={() => openAddPhotosModal([item.id])}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  !qc.ok && qc.issues.some((i) => i.level === 'error')
                    ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                    : !qc.ok
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : getItemUserPhotoCount(item) > 0
                    ? 'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50'
                }`}
                title={qc.ok ? 'Photos OK — click to add more' : `Photo QC: ${qc.label}`}
              >
                <Camera size={13} strokeWidth={2.25} />
              </button>
                );
              })()}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openAddPhotosModal([item.id], { ebay: true });
                }}
                className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300 transition-colors`}
                title="Parse photos from my eBay listings into this item"
              >
                <ShoppingBag size={13} strokeWidth={2.25} />
              </button>

              {(() => {
                const bgBusy = activeBgCardItemIds.has(item.id);
                const bgJob = bgCardJobs.find(
                  (j) => j.itemId === item.id && (j.status === 'queued' || j.status === 'running')
                );
                const cardCount = itemAiCardCounts[item.id] || 0;
                const hasCards = cardCount > 0;
                const confirming = aiCardRegenConfirmId === item.id;
                return (
              <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (bgBusy) return;
                  if (hasCards && !confirming) {
                    setAiCardRegenConfirmId(item.id);
                    return;
                  }
                  queueBackgroundAiCards(item);
                }}
                disabled={bgBusy}
                className={`${iconBtn} relative shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-70 ${
                  bgBusy
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : confirming
                      ? 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                      : hasCards
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                }`}
                title={
                  bgBusy
                    ? `Generating in background… ${bgJob?.progress || ''}`.trim()
                    : confirming
                      ? `Already has ${cardCount} AI card${cardCount === 1 ? '' : 's'} — confirm to generate more`
                      : hasCards
                        ? `Already has ${cardCount} AI card${cardCount === 1 ? '' : 's'} in gallery — click to confirm another run`
                        : 'Generate AI cards in background — saved to card gallery (come back later to pick)'
                }
              >
                {bgBusy ? (
                  <Loader2 size={13} strokeWidth={2.25} className="animate-spin" />
                ) : (
                  <Images size={13} strokeWidth={2.25} />
                )}
                {hasCards && !bgBusy && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm"
                    aria-hidden
                  >
                    {cardCount > 9 ? (
                      <Check size={8} strokeWidth={3} />
                    ) : (
                      <span className="text-[8px] font-black leading-none">{cardCount}</span>
                    )}
                  </span>
                )}
              </button>
              {confirming && (
                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-[70] flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      queueBackgroundAiCards(item);
                    }}
                    className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                    title="Yes — generate more cards"
                  >
                    <Check size={12} strokeWidth={2.75} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiCardRegenConfirmId(null);
                    }}
                    className="p-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-rose-600"
                    title="No — keep existing cards"
                  >
                    <X size={12} strokeWidth={2.75} />
                  </button>
                </div>
              )}
              </div>
                );
              })()}

              {/* Quick Bundle / Mixed Bundle / add-to-PC from Flags — any category */}
              {(() => {
                const parentOfItem = resolveParentContainer(item, containersById, containerByChildId);
                const soldLike =
                  isRealizedDisposal(item) || item.status === ItemStatus.GIFTED;
                // Sold/traded/gifted PC/bundle containers can still take more parts — the new
                // part is stamped Sold (matching the container) instead of In Composition, so
                // it shows correctly in the Sold tab. Use the Calculator icon afterward to
                // redistribute the (unchanged) sale total across the now-larger part set.
                const isSoldContainer = (item.isPC || item.isBundle) && soldLike;
                const canQuickBundle = !soldLike || isSoldContainer;
                if (!canQuickBundle) {
                  return iconSlotReserve;
                }
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Parts already inside a container → add more to that parent
                      const seed =
                        parentOfItem && !item.isPC && !item.isBundle ? parentOfItem : item;
                      openQuickBundlePanel(seed);
                    }}
                    className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300`}
                    title={
                      parentOfItem && !item.isPC && !item.isBundle
                        ? `Add parts to ${parentOfItem.isPC ? 'PC' : 'bundle'}: ${parentOfItem.name}`
                        : item.isPC
                          ? isSoldContainer
                            ? 'Add parts to this sold PC — use Recalculate after to resplit the sale total'
                            : 'Add parts to this PC'
                          : item.isBundle
                            ? isSoldContainer
                              ? 'Add parts to this sold bundle — use Recalculate after to resplit the sale total'
                              : 'Add parts to this bundle'
                            : 'Turn into Bundle / Mixed Bundle — search any category'
                    }
                  >
                    <Plus size={13} strokeWidth={2.5} />
                  </button>
                );
              })()}

              {/* Bulk import batch — open dedicated status-agnostic view */}
              {(() => {
                const itemBulkId = resolveItemBulkImportId(item);
                if (!itemBulkId) return iconSlotReserve;
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openBulkImportBatch(itemBulkId);
                    }}
                    className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                      bulkImportFilterId === itemBulkId
                        ? 'border-violet-400 bg-violet-100 text-violet-800'
                        : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300'
                    }`}
                    title="Bulk import — show all from this batch (including sold)"
                  >
                    <Layers size={13} strokeWidth={2.25} />
                  </button>
                );
              })()}

              {/* Rebuild PC / Bundle title from parts */}
              {getContainerKind(item) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRebuildContainerTitle(item);
                  }}
                  className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300`}
                  title="Rebuild title from parts (RAM kits, CPU, mobo…)"
                >
                  <RotateCw size={13} strokeWidth={2.25} />
                </button>
              ) : (
                iconSlotReserve
              )}

              {(item.isPC || item.isBundle) ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); setBundleToDismantle(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`} title="Unbundle / Dismantle"><Unlink size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {canSplitItem(item, (item.isPC || item.isBundle) ? getChildren(item, items).length : 0) ? (() => {
                const lotQty = resolveIdenticalLotQty(item);
                return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSplitPartsSeed(item);
                  }}
                  className={`${iconBtn} shrink-0 inline-flex items-center justify-center gap-0.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 px-1`}
                  title={
                    lotQty != null
                      ? `Split lot ×${lotQty} into identical items`
                      : 'Split into parts or identical copies'
                  }
                >
                  <Scissors size={13} strokeWidth={2.25} />
                  {lotQty != null && (
                    <span className="text-[9px] font-black tabular-nums leading-none pr-0.5">
                      ×{lotQty}
                    </span>
                  )}
                </button>
                );
              })() : (
                iconSlotReserve
              )}
              {(item.isPC || item.isBundle) && isRealizedDisposal(item) && getChildren(item, items).length > 0 ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); setRecalcTarget(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Recalculate component sell prices"><Calculator size={13} strokeWidth={2.25} /></button>
              ) : (item.isPC || item.isBundle) && !isRealizedDisposal(item) && getChildren(item, items).length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResplitContainerBuy(item);
                  }}
                  className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
                  title="Resplit buy prices across parts (proportional lot cost)"
                >
                  <Calculator size={13} strokeWidth={2.25} />
                </button>
              ) : (
                iconSlotReserve
              )}
              {item.status === ItemStatus.IN_STOCK ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToTrade(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`} title="Trade"><ArrowRightLeft size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {item.status === ItemStatus.IN_STOCK ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToGift(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`} title="Gift / Privatentnahme"><Gift size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {isSoldOrTradedOnly(item) ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setInvoiceViewItem(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`} title="Generate Invoice"><FileText size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {item.status === ItemStatus.SOLD ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); addRecentItemId(item.id); setItemToEditBuyer(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`} title="Buyer & eBay order"><User size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); setItemToReturn(item); }} className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`} title={item.status === ItemStatus.GIFTED ? 'Undo gift' : 'Mark Unsold / Return'}><RotateCcw size={13} strokeWidth={2.25} /></button>
              ) : (
                iconSlotReserve
              )}
              {shouldShowEbayOrderLinkInFlags(item) ? (
                <SoldEbayOrderLinkButton
                  item={item}
                  onMatchOrder={openOrderLookupModal}
                  iconClassName={iconBtn}
                />
              ) : (() => {
                const links = resolveItemSourceLinks(item);
                const primary = links.chat || links.order || links.profile;
                if (!primary) return iconSlotReserve;
                return (
                  <a
                    href={primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors`}
                    title={`${primary.title} ↗`}
                  >
                    {primary.kind === 'chat' ? (
                      <MessageSquare size={13} strokeWidth={2.25} />
                    ) : primary.kind === 'order' ? (
                      <ExternalLink size={13} strokeWidth={2.25} />
                    ) : (
                      <User size={13} strokeWidth={2.25} />
                    )}
                  </a>
                );
              })()}
            </div>
          </td>
        );
      case 'item':
        const isContainerRow = isInventoryContainer(item);
        const childItems = isContainerRow ? getChildren(item, items) : [];
        const isEditingName = editingCell?.itemId === item.id && editingCell?.field === 'item';
        // Rows render from the deferred filter results — keep the nest display in sync with them.
        const searchQuery = deferredSearchTerm.trim();
        const searchActiveForNest = searchQuery.length >= 2;
        const isGroupedContainerRow = isContainerRow && childItems.length > 0;
        const isBundleBodyExpanded = isGroupedContainerRow && !collapsedBundles.has(item.id);
        const isSoldContainerRow = isGroupedContainerRow && isRealizedDisposal(item);
        const liveChildren = isSoldContainerRow
          ? childItems.map((c) => itemsById.get(c.id) || c)
          : childItems;
        const childSoldById = isSoldContainerRow
          ? containerChildSoldDisplayMap(item, liveChildren)
          : null;
        const childProfitById = isSoldContainerRow
          ? containerChildProfitDisplayMap(item, liveChildren)
          : null;
        const childSoldSum = isSoldContainerRow
          ? containerBuyerTotalForParts(item, liveChildren)
          : 0;
        const parentContainer = resolveParentContainer(item, containersById, containerByChildId);
        const parentKind = getContainerKind(parentContainer);
        const showMembershipBadge = Boolean(parentKind && parentContainer && !item.isPC && !item.isBundle);
        const tradeReceived = resolveTradeReceivedItems(item, itemsById);
        const tradeSource = resolveTradeSourceItem(item, itemsById);
        const userPhotoCount = getItemUserPhotoCount(item);
        const hasUserPhotos = userPhotoCount > 0;
        const quickBundleOpenHere = quickBundleSeed?.id === item.id;
        return (
          <td
            key={id}
            style={style}
            // Above sticky Actions (z-[18]) / sticky header (z-[40]) so the panel X is clickable
            className={`inv-col-item ${quickBundleOpenHere ? 'relative z-[45]' : ''} overflow-hidden min-w-0 h-full`.trim()}
            onClick={() => {
              if (quickBundleSeed) return;
              handleRowClick(item, isEditingName);
            }}
          >
             <div className="flex items-start gap-2.5 cursor-pointer group/cell w-full h-full py-0.5">
                <div
                  className={`relative shrink-0 self-start inline-block ${dense ? 'w-8 h-8' : 'w-9 h-9'} rounded-md cursor-pointer hover:opacity-90 transition-opacity ${
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
                <div className="flex-1 min-w-0 flex flex-col h-full min-h-0">
                   <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1 items-center w-full min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
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
                      {item.splitOrigin && (
                        <span
                          className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide bg-violet-100 text-violet-800 border border-violet-200"
                          title={
                            item.splitOrigin === 'identical'
                              ? 'Created by splitting one lot into identical copies'
                              : 'Created by splitting one item into parts'
                          }
                        >
                          <Scissors size={9} strokeWidth={2.75} />
                          Split
                        </span>
                      )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 justify-self-end">
                            <ItemAccessoryToggles
                              item={item}
                              children={isContainerRow ? childItems : undefined}
                              dense
                              onPatch={(patch) =>
                                onUpdate([{ ...item, ...patch }], undefined, {
                                  skipActionLog: true,
                                })
                              }
                            />
                          </div>
                   </div>
                   {(() => {
                     const showContainerKinds = isContainerRow;
                     const showAnalyzer =
                       (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) &&
                       !item.parentContainerId;
                     if (!showContainerKinds && !showAnalyzer) return null;
                     const analyzerChips =
                       showAnalyzer
                         ? (() => {
                             const sugg = suggestedEbayById.get(item.id) || null;
                             const analyzer = computePriceAnalyzer(item, sugg, items);
                             if (!analyzer) return null;
                             const channelBadgeClass = (
                               channel: 'KA' | 'EB',
                               action: PriceAnalyzerAction,
                             ) => {
                               if (action === 'drop')
                                 return 'bg-amber-50 text-amber-950 border-amber-300';
                               if (action === 'raise')
                                 return 'bg-sky-50 text-sky-950 border-sky-300';
                               if (channel === 'KA')
                                 return 'bg-emerald-100 text-emerald-950 border-emerald-400';
                               return 'bg-orange-100 text-orange-800 border-orange-300';
                             };
                             const shortChannelLabel = (ch: {
                               action: PriceAnalyzerAction;
                               channel: string;
                               suggest: number;
                               live?: number;
                             }) => {
                               if (ch.action === 'drop')
                                 return `↓${ch.channel} €${Math.round(ch.live || 0)}→€${Math.round(ch.suggest)}`;
                               if (ch.action === 'raise')
                                 return `↑${ch.channel} €${Math.round(ch.live || 0)}→€${Math.round(ch.suggest)}`;
                               if (ch.action === 'ok')
                                 return `OK ${ch.channel} €${Math.round(ch.live || ch.suggest)}`;
                               return `${ch.channel} €${Math.round(ch.suggest)}`;
                             };
                             const saveSuggest = () => {
                               const fresh =
                                 resolveSuggestedEbayList(item, items, loadFlipFees(), childItems) ||
                                 sugg;
                               if (!fresh) return;
                               onUpdate(
                                 [{ ...item, ...suggestionPatchFromPrice(fresh) }],
                                 undefined,
                                 { skipActionLog: true }
                               );
                               setToast(
                                 `Saved price target · Day ${fresh.daysHeld ?? analyzer.daysHeld} · ${Math.round((fresh.targetMargin ?? analyzer.targetMarginPct / 100) * 100)}% · KA €${formatEUR(fresh.kleinList)} · EB €${formatEUR(fresh.ebayList)}`
                               );
                               setTimeout(() => setToast(null), 2600);
                             };
                             return analyzer.channels.map((ch) => (
                               <button
                                 key={ch.channel}
                                 type="button"
                                 onClick={saveSuggest}
                                 title={ch.label}
                                 className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide tabular-nums ${channelBadgeClass(ch.channel, ch.action)}`}
                               >
                                 {shortChannelLabel(ch)}
                               </button>
                             ));
                           })()
                         : null;
                     if (!showContainerKinds && !analyzerChips) return null;
                     return (
                   <>
                     {showContainerKinds ? (
                   <div
                     className="flex items-center gap-1 flex-wrap mt-0.5"
                     onClick={(e) => e.stopPropagation()}
                   >
                     {(['pc', 'bundle', 'mixed'] as const).map((kind) => {
                         const active = getContainerKind(item) === kind;
                         return (
                           <button
                             key={kind}
                             type="button"
                             title={`Set type: ${getContainerKindShortLabel(kind)}`}
                             onClick={() => {
                               if (active) return;
                               onUpdate([applyContainerKind(item, kind)]);
                             }}
                             className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide ${
                               active
                                 ? kind === 'pc'
                                   ? 'bg-indigo-600 text-white border-indigo-700'
                                   : kind === 'mixed'
                                     ? 'bg-amber-500 text-white border-amber-600'
                                     : 'bg-violet-600 text-white border-violet-700'
                                 : 'bg-slate-50 text-slate-500 border-slate-200'
                             }`}
                           >
                             {getContainerKindShortLabel(kind)}
                           </button>
                         );
                       })}
                   </div>
                     ) : null}
                     {analyzerChips ? (
                   <div
                     className="flex items-center gap-1 flex-wrap mt-0.5"
                     data-scroll-defer=""
                     onClick={(e) => e.stopPropagation()}
                   >
                     {analyzerChips}
                   </div>
                     ) : null}
                   </>
                     );
                   })()}
                   <div data-scroll-defer="" className="mt-0.5 flex flex-wrap items-center gap-1 min-w-0 max-w-full">
                     <SaleCycleHistory item={item} compact />
                     <BuyPriceHistory item={item} compact />
                   </div>
                   {showMembershipBadge && parentKind && parentContainer && (
                      <div className="mt-1.5">
                        <ContainerMembershipBadge
                          kind={parentKind}
                          parentName={parentContainer.name}
                          onOpen={() => openParentContainer(parentContainer)}
                          onLocate={() => focusContainerInList(parentContainer)}
                          onRemoveFromContainer={
                            isRealizedDisposal(parentContainer)
                              ? undefined
                              : () => handleRemoveFromContainer(item, parentContainer)
                          }
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
                   {quickBundleSeed?.id === item.id && (
                      <QuickBundleAddModal
                        seed={quickBundleSeed}
                        items={items}
                        onClose={() => setQuickBundleSeed(null)}
                        onApply={(updates) => {
                          onUpdate(updates);
                          setToast(
                            updates.some((u) => (u.isBundle || u.isPC) && u.componentIds)
                              ? `Updated · ${updates.find((u) => u.isBundle || u.isPC)?.name || 'saved'}`
                              : 'Bundle saved'
                          );
                          setTimeout(() => setToast(null), 2200);
                          setQuickBundleSeed(null);
                        }}
                      />
                   )}
                   {isBundleBodyExpanded && (
                  <div
                    className={`mt-1 ml-0.5 pl-2 border-l-2 py-0 space-y-0 min-w-0 overflow-hidden ${
                        item.isPC
                          ? 'border-indigo-300 bg-indigo-50/40'
                          : 'border-violet-300 bg-violet-50/40'
                      }`}
                    style={{ maxWidth: `calc(100% - ${ITEM_TITLE_ACTIONS_RESERVE})` }}
                  >
                         {isSoldContainerRow && (
                           <div className="flex items-center gap-2 px-1 pb-0.5 min-w-0">
                             <span className="flex-1 min-w-0 text-[8px] font-bold uppercase tracking-wider text-slate-400">
                               Part
                             </span>
                             <span className={`shrink-0 ${BUNDLE_PART_FIN_GRID} grid grid-cols-3 gap-x-1 items-baseline text-right text-[8px] font-bold uppercase tracking-wider text-slate-400 tabular-nums`}>
                               <span>EK</span>
                               <span>Sold</span>
                               <span>Profit</span>
                             </span>
                           </div>
                         )}
                         {childItems.map((child) => {
                            const liveChild = itemsById.get(child.id) || child;
                            const childHit =
                              searchActiveForNest && matchesInventorySearch(liveChild, searchQuery);
                            const childProfit =
                              childProfitById?.get(liveChild.id) ?? profitForDisplay(liveChild);
                            const childSoldDisplay =
                              childSoldById?.get(liveChild.id) ?? liveChild.sellPrice ?? 0;
                            const isEditingChildName =
                              editingCell?.itemId === liveChild.id && editingCell?.field === 'item';
                            const childTone = resolveComponentPartTone(liveChild);
                            return (
                            <div
                              key={`${liveChild.id}:${liveChild.name}`}
                              className={`flex items-center gap-2 py-px pl-1.5 pr-1 rounded-sm transition-colors w-full min-w-0 border-l-[3px] ${
                                  liveChild.isSplitRemainder
                                    ? 'bg-violet-100/50 hover:bg-violet-100/80'
                                    : childHit
                                      ? 'bg-amber-100/80 ring-1 ring-amber-200/80'
                                      : item.isPC
                                        ? 'hover:bg-indigo-100/70'
                                        : 'hover:bg-violet-100/70'
                                }`}
                              style={{
                                borderLeftColor: liveChild.isSplitRemainder
                                  ? '#7c3aed'
                                  : childTone?.accentHex || (item.isPC ? '#6366f1' : '#8b5cf6'),
                              }}
                            >
                              {isEditingChildName ? (
                                <input
                                  autoFocus
                                  className="flex-1 min-w-0 text-[11px] font-medium px-1.5 py-0.5 rounded border border-indigo-300 bg-white outline-none ring-2 ring-indigo-100"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={() => saveEdit()}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      saveEdit();
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (rowClickTimeoutRef.current != null) return;
                                  rowClickTimeoutRef.current = window.setTimeout(() => {
                                    rowClickTimeoutRef.current = null;
                                    handleEditClick(liveChild);
                                  }, 220);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  if (rowClickTimeoutRef.current != null) {
                                    window.clearTimeout(rowClickTimeoutRef.current);
                                    rowClickTimeoutRef.current = null;
                                  }
                                  startEditing(liveChild, 'item', liveChild.name);
                                }}
                                title="Click to edit · double-click to rename"
                                className="flex-1 min-w-0 text-left group/child flex items-center gap-1"
                              >
                                {liveChild.isSplitRemainder && (
                                  <span
                                    className="shrink-0 text-[8px] font-black uppercase px-1 py-0.5 rounded bg-violet-600 text-white"
                                    title="This is the original item — whatever wasn't split off into other parts"
                                  >
                                    Main
                                  </span>
                                )}
                                <span className={`block text-[11px] truncate ${
                                  liveChild.isSplitRemainder ? 'font-black' : 'font-medium'
                                } ${
                                  item.isPC
                                    ? 'text-indigo-900 group-hover/child:text-indigo-950'
                                    : 'text-violet-900 group-hover/child:text-violet-950'
                                }`}>
                                  {liveChild.name}
                                </span>
                              </button>
                              )}
                              {isSoldContainerRow ? (
                                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                  <span className={`shrink-0 ${BUNDLE_PART_FIN_GRID} grid grid-cols-3 gap-x-1 items-baseline text-right tabular-nums text-[10px] font-semibold leading-tight`}>
                                    <span className="text-slate-500 inline-flex items-baseline justify-end gap-0.5">
                                      €{formatEUR(liveChild.buyPrice || 0)}
                                      <BuyPriceBumpBadge item={liveChild} />
                                    </span>
                                    <span className="text-slate-800">€{formatEUR(childSoldDisplay)}</span>
                                    <span
                                      className={
                                        (childProfit || 0) > 0
                                          ? 'text-emerald-600'
                                          : (childProfit || 0) < 0
                                            ? 'text-red-500'
                                            : 'text-slate-400'
                                      }
                                      title="Component margin (same as the green Margin column)"
                                    >
                                      {(childProfit || 0) > 0 ? '+' : (childProfit || 0) < 0 ? '−' : ''}
                                      €{formatEUR(Math.abs(childProfit || 0))}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveFromContainer(liveChild, item);
                                    }}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                                    title="Remove from container — becomes a standalone sold item"
                                    aria-label={`Remove ${liveChild.name} from container`}
                                  >
                                    <Trash2 size={12} strokeWidth={2.25} />
                                  </button>
                                </div>
                              ) : (
                                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                  {liveChild.buyPrice != null ? (
                                    <span className="text-[10px] font-semibold text-slate-600 tabular-nums inline-flex items-center gap-0.5">
                                      €{formatEUR(liveChild.buyPrice)}
                                      <BuyPriceBumpBadge item={liveChild} />
                                    </span>
                                  ) : null}
                                  {liveChild.status === ItemStatus.IN_COMPOSITION ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        addRecentItemId(liveChild.id);
                                        setItemToSell(liveChild);
                                      }}
                                      className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 transition-colors"
                                      title="Mark this part sold — leaves the group"
                                      aria-label={`Mark ${liveChild.name} sold`}
                                    >
                                      <ShoppingBag size={12} strokeWidth={2.25} />
                                    </button>
                                  ) : (
                                    <span className="h-6 w-6" aria-hidden />
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveFromContainer(liveChild, item);
                                    }}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                                    title="Remove from container — back to active inventory"
                                    aria-label={`Remove ${liveChild.name} from container`}
                                  >
                                    <Trash2 size={12} strokeWidth={2.25} />
                                  </button>
                                </div>
                              )}
                            </div>
                            );
                         })}
                         {!isSoldContainerRow && (
                           <p className={`px-2 pt-0.5 text-[9px] font-bold uppercase tracking-wider ${
                             item.isPC ? 'text-indigo-600/90' : 'text-violet-600/90'
                           }`}>
                             Total cost €{formatEUR(item.buyPrice)} · {childItems.length} parts
                           </p>
                         )}
                         {isSoldContainerRow && (
                           <div className="flex items-center gap-2 px-1 pt-0.5 min-w-0">
                             <span className={`flex-1 min-w-0 text-[9px] font-bold uppercase tracking-wider ${
                               item.isPC ? 'text-indigo-600/90' : 'text-violet-600/90'
                             }`}>
                               {childItems.length} parts
                             </span>
                             <span className={`shrink-0 ${BUNDLE_PART_FIN_GRID} grid grid-cols-3 gap-x-1 items-baseline text-right tabular-nums text-[9px] font-bold ${
                               item.isPC ? 'text-indigo-700' : 'text-violet-700'
                             }`}>
                               <span>€{formatEUR(childItems.reduce((s, c) => s + (Number((itemsById.get(c.id) || c).buyPrice) || 0), 0))}</span>
                               <span>€{formatEUR(childSoldSum)}</span>
                               <span>
                                 €{formatEUR(
                                   childProfitById
                                     ? [...childProfitById.values()].reduce((s, n) => s + n, 0)
                                     : childItems.reduce((s, c) => s + (Number(profitForDisplay(itemsById.get(c.id) || c)) || 0), 0)
                                 )}
                               </span>
                             </span>
                           </div>
                         )}
                      </div>
                   )}
                   <div className="mt-auto pt-1.5 space-y-1.5 min-w-0 w-full">
                     {item.status === ItemStatus.SOLD && (() => {
                        const hasBuyerInfo = Boolean(item.customer?.name || item.ebayUsername || item.ebayOrderId);
                        const openBuyerEditor = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          addRecentItemId(item.id);
                          setItemToEditBuyer(item);
                        };
                        const openOrderFinder = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          addRecentItemId(item.id);
                          setItemToFindOrder(item);
                        };
                        return (
                          <div className="flex items-center gap-1.5 min-w-0 w-full">
                            <button
                              type="button"
                              onClick={openBuyerEditor}
                              className={`text-[9px] font-bold flex items-center gap-1 rounded-lg border transition-colors min-w-0 flex-1 overflow-hidden ${
                                hasBuyerInfo
                                  ? 'text-slate-600 bg-slate-50 px-2 py-1 border-slate-100 hover:bg-slate-100 hover:border-slate-200'
                                  : 'text-indigo-800 bg-indigo-50 px-2 py-1 border-indigo-200 hover:bg-indigo-100'
                              }`}
                              title="Open buyer & eBay order editor — paste order ID, upload screenshot for AI parse, or type manually"
                            >
                              {hasBuyerInfo ? (
                                <>
                                  <Info size={10} className="text-slate-400 shrink-0" />
                                  <span className="truncate min-w-0">
                                    {item.customer?.name || 'Buyer'}
                                    {item.ebayUsername ? ` · eBay: ${item.ebayUsername}` : ''}
                                    {item.ebayOrderId ? ` · #${item.ebayOrderId}` : ''}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <User size={10} className="shrink-0" />
                                  <span className="truncate">Add eBay order & buyer</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={openOrderFinder}
                              className="shrink-0 p-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                              title="Find an eBay order from Abrechnung to link to this item"
                              aria-label="Find eBay order to link"
                            >
                              <Search size={10} />
                            </button>
                          </div>
                        );
                     })()}
                     {item.status !== ItemStatus.SOLD && isRealizedDisposal(item) && (item.customer?.name || item.giftRecipient || item.ebayUsername || item.ebayOrderId) && (
                        <p
                          className="text-[9px] text-slate-600 font-medium flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100"
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
                   </div>
                </div>
             </div>
          </td>
        );
      case 'category': {
        const partPill = componentPartPillProps(item);
        return (
          <td key={id} style={style}>
             <div 
               onClick={(e) => { e.stopPropagation(); setItemToEditCategory(item); }}
               className="group/cat cursor-pointer hover:bg-slate-100 rounded-md px-1 py-0.5 -mx-0.5 transition-colors"
               title="Click to reclassify"
             >
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-tight group-hover/cat:text-blue-600 flex items-center justify-center gap-1.5 leading-snug">
                   {item.category}
                   <Edit2 size={10} className="opacity-0 group-hover/cat:opacity-100 transition-opacity shrink-0"/>
                </p>
                {partPill ? (
                  <p
                    className={`mt-0.5 ${partPill.className}`}
                    title={partPill.title}
                  >
                    {partPill.label}
                  </p>
                ) : null}
             </div>
          </td>
        );
      }
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
            className="inv-col-money cursor-pointer hover:bg-blue-50/30 transition-colors" 
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
              <span className={`flex flex-col items-center ${INV_MONEY_MAIN} text-slate-900`}>
                <span className="inline-flex items-baseline justify-center gap-0.5">
                  <span>€{formatEUR(item.buyPrice)}</span>
                  <BuyPriceBumpBadge item={item} />
                </span>
              </span>
            )}
          </td>
        );
      case 'sellPrice': {
        const isEditingSell = editingCell?.itemId === item.id && editingCell?.field === 'sellPrice';
        const soldContainerTotals =
          isInventoryContainer(item) && isRealizedDisposal(item)
            ? getSoldContainerDisplayTotals(item, items, POCKET_PROFIT_TAX_MODE)
            : null;
        const buyerTotalEur = resolveSellColumnBuyerTotalForItem(item, soldContainerTotals);
        const displaySellPrice = buyerTotalEur ?? item.sellPrice;
        const split = resolveSellColumnSplit(item, items, POCKET_PROFIT_TAX_MODE, {
          shippingFallbackEur: getItemDisplayShippingAmount(item, items),
        });
        const sellLines = split ? (
          <SellSplitLines
            split={split}
            showFees={shouldShowSellCellMarketplaceFees(item, showPriceBreakdown)}
            hideDeductions={hideSellDeductions}
          />
        ) : (
          <span className={`underline decoration-dotted decoration-slate-300 underline-offset-2 ${INV_MONEY_MAIN} text-slate-900`}>
            €{formatEUR(displaySellPrice)}
          </span>
        );
        return (
          <td
            key={id}
            className="inv-col-money text-slate-600 cursor-pointer hover:bg-blue-50/30 transition-colors"
            style={style}
            title={
              soldContainerTotals != null
                ? 'Bundle total sell price (sum of components)'
                : canEditManualSellerShipping(item)
                  ? 'Click to add shipping you paid · double-click to edit sell price'
                  : 'Click for fees & shipping split · double-click to edit'
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
            ) : displaySellPrice ? (
              <SaleProceedsTrigger
                item={item}
                className="flex flex-col items-center leading-snug gap-0.5 w-fit mx-auto"
                onDoubleClick={(e) => { e.stopPropagation(); startEditing(item, 'sellPrice', item.sellPrice || 0); }}
                onSaveShipping={
                  canEditManualSellerShipping(item)
                    ? (amount) => saveSellerShipping(item, amount)
                    : undefined
                }
              >
                {sellLines}
              </SaleProceedsTrigger>
            ) : (
              '-'
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
            title="Shop asking price. Double click to edit — separate from Sell Price."
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
            ? getSoldContainerDisplayTotals(item, items, POCKET_PROFIT_TAX_MODE).profit
            : null;
        const displayProfit = soldContainerProfit ?? profitForDisplay(item);
        const marginHint = 'Margin = Bestelleinnahmen − EK. No VAT taken out.';
        if (item.isPC || item.isBundle) {
          if (soldContainerProfit != null) {
            return (
              <td
                key={id}
                className={`inv-col-money inv-col-margin tabular-nums ${INV_MONEY_MAIN} ${soldContainerProfit > 0 ? 'text-emerald-600' : soldContainerProfit < 0 ? 'text-red-500' : 'text-slate-300'}`}
                style={style}
                title={`Bundle total margin. ${marginHint}`}
              >
                <span className="flex flex-col items-center">€{formatEUR(soldContainerProfit)}</span>
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
          <td
            key={id}
            className={`inv-col-money inv-col-margin tabular-nums ${INV_MONEY_MAIN} ${displayProfit && displayProfit > 0 ? 'text-emerald-600' : displayProfit && displayProfit < 0 ? 'text-red-500' : 'text-slate-300'}`}
            style={style}
            title={marginHint}
          >
            <span className="flex flex-col items-center">
              {displayProfit != null ? `€${formatEUR(displayProfit)}` : '-'}
            </span>
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
      case 'buyDate': {
        const rawDate = toLocalCalendarDateKey(item.buyDate);
        const displayDate = formatInventoryDisplayDate(rawDate) || '-';
        const isEditingDate = editingCell?.itemId === item.id && editingCell?.field === id;
        return (
          <td
            key={id}
            className={INV_DATE_CELL}
            style={style}
            title={
              item.isPC || item.isBundle
                ? 'Bundle/PC acquired (composition) date — double click to edit'
                : 'Double click to edit acquisition date'
            }
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing(item, id, rawDate || '');
            }}
          >
            {isEditingDate ? (
              <input
                autoFocus
                type="date"
                className={INV_DATE_INPUT}
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
              <span className={rawDate ? '' : 'text-slate-300'}>{displayDate}</span>
            )}
          </td>
        );
      }
      case 'sellDate': {
        const rawDate = toLocalCalendarDateKey(item.sellDate);
        const displayDate = formatInventoryDisplayDate(rawDate) || '-';
        const isEditingDate = editingCell?.itemId === item.id && editingCell?.field === id;
        return (
          <td
            key={id}
            className={INV_DATE_CELL}
            style={style}
            title="Double click to edit sold date"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing(item, id, rawDate || '');
            }}
          >
            {isEditingDate ? (
              <input
                autoFocus
                type="date"
                className={INV_DATE_INPUT}
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
              <span className={rawDate ? '' : 'text-slate-300'}>{displayDate}</span>
            )}
          </td>
        );
      }
      case 'salePlatform': {
        const isSoldOrTraded = isRealizedDisposal(item);
        const missing = isSoldOrTraded ? isMissingExplicitSalePlatform(item) : false;
        const inferredPlatform = missing ? resolveSalePlatform(item) : null;
        return (
          <td
            key={id}
            className="inv-col-platform text-left align-top"
            style={style}
            onClick={(e) => e.stopPropagation()}
          >
            {isSoldOrTraded ? (
              <SalePlatformCell
                item={item}
                missing={missing}
                inferredPlatform={inferredPlatform}
                onPick={(platform) => handleQuickPlatformChange(item, platform)}
              />
            ) : (
              <span className="text-slate-200">—</span>
            )}
          </td>
        );
      }
      case 'actions':
        // Merged into Flags — never rendered (column always hidden).
        return null;
      default: return null;
    }
  };

  const renderCellRef = useRef(renderCell);
  renderCellRef.current = renderCell;
  const renderRowCells = useCallback(
    (item: InventoryItem, isSelected: boolean, itemFlexWidth?: number | null) =>
      visibleColumns.map((colId) => renderCellRef.current(item, colId, isSelected, itemFlexWidth)),
    // InventoryTableRow is React.memo'd and only re-renders when this function's identity
    // changes (see its comparator) — every toggle that changes what a cell renders, even
    // via the renderCellRef indirection, has to be listed here or rows go stale until reload.
    [visibleColumns, effectiveColumnWidths, showPriceBreakdown, hideSellDeductions]
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

  const hasActiveFilters =
    (statusFilter !== 'ACTIVE' && !isSpecialListTab(statusFilter)) ||
    categoryFilter !== 'ALL' ||
    !!subCategoryFilter ||
    timeFilter !== 'ALL' ||
    excludedPlatforms.size > 0 ||
    salePaymentFilter !== 'ALL' ||
    isAmountFilterActive(amountFilter) ||
    activeSpecFilterCount > 0;
  const clearAllFilters = () => {
    setStatusFilter('ACTIVE');
    setCategoryFilter('ALL');
    setSubCategoryFilter('');
    setTimeFilter('ALL');
    setExcludedPlatforms(new Set());
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

  /**
   * Deep link from "Done by AI" (and anywhere else): /panel/inventory?focus=<itemId>
   * clears blocking filters, scrolls the row into view and flashes it, then drops the
   * param so a refresh doesn't re-trigger the jump.
   */
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId) return;
    const target = items.find((i) => i.id === focusId);
    if (target) {
      revealItemInList(target);
      setSearchTerm('');
      setSmartPreset(null);
      setSplitView(false);
      setScrollTargetItemId(target.id);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [searchParams, items, revealItemInList, setSearchParams]);

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

  const openAddPhotosModal = useCallback((ids: string[], opts?: { ebay?: boolean }) => {
    if (!ids.length) return;
    setAddPhotosTargetIds(ids);
    setAddPhotosAutoEbay(Boolean(opts?.ebay));
    setShowBulkAddPhotosModal(true);
  }, []);

  const closeAddPhotosModal = useCallback(() => {
    setShowBulkAddPhotosModal(false);
    setAddPhotosTargetIds([]);
    setAddPhotosAutoEbay(false);
  }, []);
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
          // Drop category SVG placeholders so new uploads become the row thumbnail.
          const existing = getItemUserPhotoUrls(item);
          const merged = normalizeImageList([...existing, ...prepared]);
          const match = options?.ebayMatch;
          return {
            ...item,
            imageUrl: merged[0] || '',
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
      {
        id: 'ebay_photos',
        label: 'eBay photos',
        icon: <ShoppingBag size={16} />,
        onClick: () => openAddPhotosModal(deferredSelectedIds, { ebay: true }),
        variant: 'primary',
      },
      {
        id: 'sale_ready',
        label: 'List Ready',
        icon: <ListChecks size={16} />,
        onClick: () => {
          const selected = deferredSelectedIds
            .map((id) => itemsById.get(id))
            .filter((i): i is InventoryItem => Boolean(i))
            .filter(isMarkReadyEligible)
            .filter((i) => !i.saleReady);
          const updated = selected.filter(canMarkSaleReady).map((i) => ({ ...i, saleReady: true }));
          const skipped = selected.length - updated.length;
          if (!updated.length) {
            setToast(
              skipped
                ? `${skipped} need title · description · photos before List Ready`
                : 'Select in-stock items with checklist complete',
            );
            setTimeout(() => setToast(null), 2600);
            return;
          }
          onUpdate(updated, undefined, { skipActionLog: true });
          setToast(
            skipped
              ? `List Ready ${updated.length} · skipped ${skipped} (checklist incomplete)`
              : `List Ready ${updated.length}`,
          );
          setTimeout(() => setToast(null), 2600);
        },
        variant: 'primary',
      },
      { id: 'compose', label: 'Compose', icon: <Monitor size={16} />, onClick: openComposeChooser, variant: 'primary' },
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
    openComposeChooser,
    handleBulkStoreVisible,
    handleBulkGenerateDescriptions,
    openAddPhotosModal,
    onUpdate,
    businessSettings,
  ]);

  const bulkSelectionCount = deferredSelectedIds.length;

  const bulkSelectedTotals = useMemo(() => {
    let buy = 0;
    let sell = 0;
    for (const id of deferredSelectedIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      buy += Number(item.buyPrice) || 0;
      if (item.sellPrice != null) {
        sell += Number(item.sellPrice) || 0;
      }
    }
    return { buy, sell };
  }, [deferredSelectedIds, itemsById]);

  const purchasesView = useInventoryPurchases({
    items,
    categories,
    categoryFields: categoryFields || {},
    searchTerm: deferredSearchTerm,
    onUpdate: (newItems) => onUpdate(newItems, undefined, { flushCloud: true }),
    onOpenItem: (id) => {
      setStatusFilter('ACTIVE');
      navigate(`/panel/edit/${id}`);
    },
    onOpenPurchaseDraft: (item) => {
      setItemToEdit(item);
    },
  });

  const listCountLabel =
    statusFilter === 'PURCHASES'
      ? `${purchasesView.rowCount} deal${purchasesView.rowCount === 1 ? '' : 's'}`
      : `${sortedItems.length} items`;

  const mobileSortOptions =
    statusFilter === 'ACTIVE'
      ? MOBILE_ACTIVE_SORT_OPTIONS
      : statusFilter === 'SOLD'
        ? MOBILE_SOLD_SORT_OPTIONS
        : null;
  const normalizedSortKey = sortConfig.key === 'item' ? 'name' : sortConfig.key;
  const mobileSortValue = mobileSortOptions?.some((option) => option.key === normalizedSortKey)
    ? normalizedSortKey
    : '';

  return (
    <div
      className="inventory-ui flex-1 min-h-0 h-full flex flex-col gap-1 overflow-hidden relative"
      // 5% smaller across the board (sold + active) — `zoom` scales fonts, padding,
      // borders and icons together instead of hand-tuning every Tailwind size class.
      style={{ zoom: 0.95 } as React.CSSProperties}
    >
      <header className="shrink-0 space-y-1">
         {bulkImportFilterId && (
           <div className="rounded-xl border border-violet-200 bg-violet-50 text-sm overflow-hidden">
             <div className="flex flex-wrap items-center gap-2 px-3 py-2">
               <button
                 type="button"
                 onClick={() => setBulkParentExpanded((v) => !v)}
                 className="p-1 rounded-md text-violet-700 hover:bg-violet-100"
                 aria-label={bulkParentExpanded ? 'Collapse batch' : 'Expand batch'}
               >
                 {bulkParentExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
               </button>
               <Layers size={16} className="text-violet-700 shrink-0" />
               <div className="min-w-0 flex-1">
                 <p className="font-bold text-violet-950 truncate">
                   Bulk batch
                   {bulkImportRecord?.label ? ` · ${bulkImportRecord.label}` : ''}
                 </p>
                 <p className="text-[11px] font-semibold text-violet-800/80">
                   {bulkImportRecord
                     ? `${bulkImportSourceLabel(bulkImportRecord.source)} · ${bulkMembers.length} children · €${formatEUR(bulkImportRecord.totalCost || 0)}`
                     : 'Batch view'}
                   {bulkImportCounts
                     ? ` · ${bulkImportCounts.inStock} in stock · ${bulkImportCounts.sold} sold`
                     : ''}
                   {bulkImportCounts && bulkImportCounts.missing > 0
                     ? ` · ${bulkImportCounts.missing} missing`
                     : ''}
                   {' · includes sold'}
                 </p>
               </div>
               {bulkImportRecord && onUpdateBulkImport && (
                 <>
                   <label className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-800">
                     Total €
                     <input
                       type="text"
                       inputMode="decimal"
                       value={bulkTotalDraft}
                       onChange={(e) => setBulkTotalDraft(e.target.value)}
                       className="w-20 px-1.5 py-1 rounded-md border border-violet-200 bg-white text-[11px] font-bold text-slate-900"
                     />
                   </label>
                   <button
                     type="button"
                     disabled={bulkBusy}
                     onClick={() => recalcBulkBatch()}
                     className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-violet-200 bg-white text-[11px] font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                   >
                     <RefreshCw size={12} className={bulkBusy ? 'animate-spin' : ''} /> Recalc
                   </button>
                   <button
                     type="button"
                     onClick={() => setBulkAdding((v) => !v)}
                     className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-violet-200 bg-white text-[11px] font-bold text-violet-800 hover:bg-violet-100"
                   >
                     <Plus size={12} /> Add
                   </button>
                 </>
               )}
               <button
                 type="button"
                 onClick={() =>
                   navigate('/panel/bulk-imports', {
                     state: { expandId: bulkImportFilterId },
                   })
                 }
                 className="px-2.5 py-1 rounded-lg border border-violet-200 bg-white text-[11px] font-bold text-violet-800 hover:bg-violet-100"
               >
                 History
               </button>
               {onDeleteBulkImport && bulkImportRecord && (
                 <button
                   type="button"
                   onClick={deleteBulkBatchHistory}
                   className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 bg-white text-[11px] font-bold text-red-700 hover:bg-red-50"
                   title="Delete history (items stay)"
                 >
                   <Trash2 size={12} />
                 </button>
               )}
               <button
                 type="button"
                 onClick={clearBulkImportBatch}
                 className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-900 text-white text-[11px] font-bold hover:bg-violet-800"
               >
                 <X size={12} /> Clear
               </button>
             </div>
             {bulkParentExpanded && bulkImportRecord && (
               <div className="border-t border-violet-200/80 bg-white/60 px-3 py-2 space-y-2">
                 {bulkAdding && (
                   <div className="flex flex-wrap items-end gap-2 rounded-lg border border-violet-100 bg-white p-2">
                     <label className="text-[10px] font-bold text-slate-500 flex-1 min-w-[8rem]">
                       Name
                       <input
                         value={bulkNewName}
                         onChange={(e) => setBulkNewName(e.target.value)}
                         className="mt-0.5 w-full px-2 py-1 rounded-md border border-slate-200 text-xs font-semibold"
                         placeholder="Forgotten item…"
                       />
                     </label>
                     <label className="text-[10px] font-bold text-slate-500">
                       Category
                       <select
                         value={bulkNewCategory}
                         onChange={(e) => {
                           setBulkNewCategory(e.target.value);
                           const subs = categories[e.target.value] || [];
                           setBulkNewSubCategory(subs[0] || '');
                         }}
                         className="mt-0.5 block px-2 py-1 rounded-md border border-slate-200 text-xs font-semibold"
                       >
                         {Object.keys(categories).map((c) => (
                           <option key={c} value={c}>
                             {c}
                           </option>
                         ))}
                       </select>
                     </label>
                     <label className="text-[10px] font-bold text-slate-500">
                       Sub
                       <select
                         value={bulkNewSubCategory}
                         onChange={(e) => setBulkNewSubCategory(e.target.value)}
                         className="mt-0.5 block px-2 py-1 rounded-md border border-slate-200 text-xs font-semibold"
                       >
                         {(categories[bulkNewCategory] || []).map((s) => (
                           <option key={s} value={s}>
                             {s}
                           </option>
                         ))}
                       </select>
                     </label>
                     <label className="text-[10px] font-bold text-slate-500 w-20">
                       Manual €
                       <input
                         value={bulkNewManualCost}
                         onChange={(e) => setBulkNewManualCost(e.target.value)}
                         className="mt-0.5 w-full px-2 py-1 rounded-md border border-slate-200 text-xs font-semibold"
                         placeholder="opt"
                       />
                     </label>
                     <button
                       type="button"
                       onClick={addToBulkBatch}
                       disabled={!bulkNewName.trim()}
                       className="px-2.5 py-1.5 rounded-lg bg-violet-900 text-white text-[11px] font-bold disabled:opacity-40"
                     >
                       Add & resplit
                     </button>
                   </div>
                 )}
                 <ul className="space-y-1 max-h-40 overflow-y-auto">
                   {bulkMembers.map((m) => (
                     <li
                       key={m.id}
                       className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 pl-2 border-l-2 border-violet-300"
                     >
                       <span className="truncate flex-1 min-w-0">{m.name}</span>
                       <span className="shrink-0 text-slate-500">€{formatEUR(m.buyPrice || 0)}</span>
                       {onUpdateBulkImport && (
                         <button
                           type="button"
                           onClick={() => removeFromBulkBatch(m.id)}
                           className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                           title="Remove from batch"
                         >
                           <Unlink size={12} />
                         </button>
                       )}
                     </li>
                   ))}
                   {bulkMembers.length === 0 && (
                     <li className="text-[11px] text-slate-400 font-medium pl-2">No members found</li>
                   )}
                 </ul>
               </div>
             )}
           </div>
         )}

          {/* Compact executive phone chrome for iPhone 13 Pro Max */}
          <div className="lg:hidden space-y-2.5 pb-1">
            {/* Header: Title + Quick Actions */}
            <div className="flex items-center justify-between gap-2 px-1">
              <div>
                <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                  <span>Stock &amp; Assets</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    statusFilter === 'ACTIVE'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : statusFilter === 'SOLD'
                        ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                        : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      statusFilter === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' : statusFilter === 'SOLD' ? 'bg-sky-400' : 'bg-purple-400'
                    }`} />
                    {sortedItems.length} {statusFilter === 'ACTIVE' ? 'In Stock' : statusFilter.toLowerCase()}
                  </span>
                </h1>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowMobileFiltersSheet(true)}
                  disabled={isSpecialListTab(statusFilter)}
                  className={`h-9 px-2.5 rounded-xl border text-[11px] font-black uppercase inline-flex items-center gap-1.5 transition-all active:scale-95 ${
                    isSpecialListTab(statusFilter)
                      ? 'bg-slate-900 text-slate-600 border-slate-800'
                      : hasActiveFilters || activeSpecFilterCount > 0 || smartPreset
                      ? 'bg-emerald-500 text-slate-950 border-emerald-500 shadow-md shadow-emerald-500/20'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                  aria-label="Open filters"
                >
                  <Sliders size={13} />
                  <span>Filters</span>
                  {(hasActiveFilters || activeSpecFilterCount > 0) && (
                    <span className="h-4 w-4 rounded-full bg-slate-950 text-white text-[9px] font-black flex items-center justify-center">
                      {activeSpecFilterCount || 1}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/panel/bulk-imports')}
                  className="h-9 px-2.5 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 text-[11px] font-black uppercase inline-flex items-center gap-1 active:scale-95"
                  title="Bulk imports"
                >
                  <Layers size={13} />
                  {bulkImports.length > 0 && (
                    <span className="text-[10px] tabular-nums font-bold">
                      {Math.min(bulkImports.length, 99)}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Segmented Status Toggle Bar */}
            <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-slate-900 border border-slate-800 shadow-inner">
              <button
                type="button"
                onClick={() => { setStatusFilter('ACTIVE'); setSplitView(false); }}
                className={`py-2 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Package size={13} />
                <span>Active</span>
              </button>

              <button
                type="button"
                onClick={() => { setStatusFilter('SOLD'); setSplitView(false); }}
                className={`py-2 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                  statusFilter === 'SOLD'
                    ? 'bg-slate-800 text-sky-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShoppingBag size={13} />
                <span>Sold</span>
              </button>

              <button
                type="button"
                onClick={() => { setStatusFilter('PURCHASES'); setSplitView(false); }}
                className={`py-2 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-1.5 transition-all relative ${
                  statusFilter === 'PURCHASES'
                    ? 'bg-slate-800 text-amber-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Inbox size={13} />
                <span>Inbox</span>
                {purchasesView.openCount > 0 && (
                  <span className={`h-4 min-w-[16px] px-1 rounded-full text-white text-[9px] font-black flex items-center justify-center tabular-nums ${
                    purchasesView.staleCount > 0 ? 'bg-red-500' : 'bg-amber-500'
                  }`}>
                    {purchasesView.openCount}
                  </span>
                )}
              </button>

              <select
                value={statusFilter === 'DRAFTS' || statusFilter === 'ALL' ? statusFilter : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) { setStatusFilter(v); setSplitView(false); }
                }}
                className={`w-full py-2 px-1 text-center rounded-xl text-xs font-black uppercase bg-transparent outline-none transition-all ${
                  statusFilter === 'DRAFTS' || statusFilter === 'ALL'
                    ? 'bg-slate-800 text-purple-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400'
                }`}
              >
                <option value="" className="bg-slate-900 text-slate-300">More…</option>
                <option value="DRAFTS" className="bg-slate-900 text-slate-300">Drafts</option>
                <option value="ALL" className="bg-slate-900 text-slate-300">All Items</option>
              </select>
            </div>

            {/* Dark Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
              <input
                type="search"
                enterKeyHint="search"
                className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-800 bg-slate-900 text-white placeholder-slate-500 text-sm font-semibold outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all shadow-inner"
                placeholder={
                  statusFilter === 'PURCHASES'
                    ? 'Search incoming purchases…'
                    : 'Search GPU, CPU, SSD, serial, buyer…'
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setSearchSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setSearchSuggestionsOpen(false), 180)}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  <X size={14} />
                </button>
              )}
              {searchSuggestionsOpen && searchSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 py-1 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-h-48 overflow-y-auto divide-y divide-slate-800/60">
                  {searchSuggestions.map((s, sidx) => (
                    <button
                      key={`${s.type}-${s.text}-${sidx}`}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-800 flex items-center justify-between text-slate-200"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchTerm(s.text);
                        setSearchSuggestionsOpen(false);
                        if (s.type === 'name') {
                          const match = items.find((i) => i.name === s.text);
                          if (match) revealItemInList(match);
                        }
                      }}
                    >
                      <span className="font-semibold truncate">{s.text}</span>
                      <span className="text-[10px] uppercase font-bold text-slate-500 shrink-0">{s.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Horizontal Thumb-Scrollable Category Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 custom-scrollbar">
              <button
                type="button"
                onClick={() => { setCategoryFilter('ALL'); setSubCategoryFilter(''); }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all active:scale-95 ${
                  categoryFilter === 'ALL'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
                    : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                All ({sortedItems.length})
              </button>

              {Object.keys(categories).map((cat) => {
                const isSelected = categoryFilter === cat;
                const count = items.filter((i) => {
                  const matchesStatus = statusFilter === 'ACTIVE' ? i.status === 'In Stock' : statusFilter === 'Sold' ? i.status === 'Sold' : true;
                  return matchesStatus && i.category === cat;
                }).length;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => { setCategoryFilter(cat); setSubCategoryFilter(''); }}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
                        : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {cat} {count > 0 && <span className="opacity-75">({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>

         <div className="hidden lg:block space-y-1">
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
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('PURCHASES'); setSplitView(false); }}
                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all ${
                      !splitView && statusFilter === 'PURCHASES' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Pending eBay and Kleinanzeigen deals — buys and sells"
                  >
                    <Inbox size={12} className="shrink-0" />
                    Inbox
                    {purchasesView.openCount > 0 && (
                      <span
                        className={`ml-0.5 min-w-[16px] px-1 rounded-full text-white text-[9px] tabular-nums ${
                          purchasesView.staleCount > 0 ? 'bg-red-500' : 'bg-amber-500'
                        }`}
                        title={
                          purchasesView.staleCount > 0
                            ? `${purchasesView.staleCount} deal(s) unresolved for 3+ days`
                            : undefined
                        }
                      >
                        {purchasesView.openCount}
                      </span>
                    )}
                  </button>
                </div>
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
              {statusFilter === 'PURCHASES'
                ? listCountLabel
                : splitView
                ? `${sortedActiveItems.length} active · ${sortedSoldItems.length} sold${timeFilter !== 'ALL' ? ' · period' : ''}`
                : `${sortedItems.length} items${timeFilter !== 'ALL' ? ' · period' : ''}`}
            </span>
            <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-[220px] relative" ref={searchSuggestionsRef}>
               <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
               <input
                  ref={searchInputRef}
                  type="text"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
                  placeholder={
                    statusFilter === 'PURCHASES'
                      ? 'Search purchases…'
                      : 'Search name, seller profile URL…'
                  }
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
            <button
               type="button"
               onClick={() => navigate('/panel/bulk-imports')}
               className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300"
               title="Bulk import history — reopen any batch"
             >
               <Layers size={14} /> Imports
               {bulkImports.length > 0 && (
                 <span className="text-[10px] opacity-75">({Math.min(bulkImports.length, 99)}{bulkImports.length > 99 ? '+' : ''})</span>
               )}
             </button>
            <select
               value={categoryFilter}
               onChange={e => { setCategoryFilter(e.target.value); setSubCategoryFilter(''); }}
               disabled={isSpecialListTab(statusFilter)}
               className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/20 appearance-none bg-no-repeat bg-right min-w-[100px] disabled:opacity-40"
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
                  <div className="relative flex items-center" ref={platformFilterPanelRef}>
                    <button
                      type="button"
                      ref={platformFilterButtonRef}
                      onClick={() => setShowPlatformFilterPanel((p) => !p)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold uppercase tracking-wide min-w-[100px] ${
                        showPlatformFilterPanel || excludedPlatforms.size > 0
                          ? 'border-blue-500 text-blue-600 bg-blue-50'
                          : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                      }`}
                      title="Choose which platforms to show"
                    >
                      Platform
                      {excludedPlatforms.size > 0 && (
                        <span className="max-w-[110px] truncate normal-case font-bold">
                          {PLATFORM_FILTER_OPTIONS.length - excludedPlatforms.size}/{PLATFORM_FILTER_OPTIONS.length}
                        </span>
                      )}
                      <ChevronDown size={11} className={`transition-transform ${showPlatformFilterPanel ? 'rotate-180' : ''}`} />
                    </button>
                    {showPlatformFilterPanel && (
                      <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Show platforms</span>
                          {excludedPlatforms.size > 0 && (
                            <button
                              type="button"
                              onClick={() => setExcludedPlatforms(new Set())}
                              className="text-[10px] font-bold text-slate-500 hover:text-red-600 flex items-center gap-1"
                            >
                              <FilterX size={10} /> All
                            </button>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          {PLATFORM_FILTER_OPTIONS.map((opt) => {
                            const checked = !excludedPlatforms.has(opt.value);
                            return (
                              <label
                                key={opt.value}
                                className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-slate-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setExcludedPlatforms((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(opt.value);
                                      else next.delete(opt.value);
                                      return next;
                                    });
                                  }}
                                  className="rounded border-slate-300"
                                />
                                <span className="text-xs font-semibold text-slate-700">{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
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
                        {columnOrder.filter((id) => id !== 'actions' && id !== 'suggestedHubSplit').map((id, idx) => {
                           const label = ALL_COLUMNS.find((c) => c.id === id)?.label || id;
                           const isHidden = hiddenColumnIds.includes(id);
                           const orderIds = columnOrder.filter((x) => x !== 'actions');
                           const orderIdx = orderIds.indexOf(id);
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
                                    <button type="button" onClick={() => {
                                      const realIdx = columnOrder.indexOf(id);
                                      moveColumn(realIdx, 'up');
                                    }} disabled={orderIdx <= 0} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronUp size={12} /></button>
                                    <button type="button" onClick={() => {
                                      const realIdx = columnOrder.indexOf(id);
                                      moveColumn(realIdx, 'down');
                                    }} disabled={orderIdx >= orderIds.length - 1} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronDown size={12} /></button>
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
                        <button
                           type="button"
                           onClick={() => setShowPriceBreakdown((prev) => !prev)}
                           className={`w-full inline-flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-black uppercase tracking-wide ${
                             showPriceBreakdown
                               ? 'border-amber-400 bg-amber-50 text-amber-800'
                               : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                           }`}
                           title={showPriceBreakdown ? 'Hide ads, eBay fee, and shipping under sell price' : 'Show ads, eBay fee, and shipping under sell price'}
                        >
                           <span className="inline-flex items-center gap-1.5">
                              <Receipt size={12} />
                              Price breakdown
                           </span>
                           <span className={`text-[10px] ${showPriceBreakdown ? 'text-amber-700' : 'text-slate-400'}`}>
                             {showPriceBreakdown ? 'On' : 'Off'}
                           </span>
                        </button>
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
            <button
               type="button"
               onClick={() => navigate('/panel/add')}
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600"
               title="Add — choose type"
            >
               <Plus size={12} strokeWidth={2.25} /> Add
            </button>
            {hasActiveFilters && (
               <button type="button" onClick={clearAllFilters} className="text-[10px] font-bold uppercase text-slate-500 hover:text-red-600">Reset all</button>
            )}
         </div>

         <div className="flex flex-wrap items-center gap-1">
               {(
                 [
                   ['no_photo', 'No photo'],
                   ['presence_unknown', '? Presence'],
                   ['no_specs', 'No specs'],
                   ['defective', 'Defekt'],
                   ['aging', '>90d'],
                 ] as const
               ).map(([id, label]) => (
                 <button
                   key={id}
                   type="button"
                   onClick={() => setSmartPreset((p) => (p === id ? null : id))}
                   className={`px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wide ${
                     smartPreset === id
                       ? 'bg-amber-500 text-white border-amber-500'
                       : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300'
                   }`}
                   title={`Smart filter: ${label}`}
                 >
                   {label}
                 </button>
               ))}
               {quickCategoryPins.map((pin) => {
                 const active = isQuickCategoryPinActive(pin);
                 return (
                   <button
                     key={pin.id}
                     type="button"
                     onClick={() => applyQuickCategoryPin(pin)}
                     className={`px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wide ${
                       active
                         ? 'bg-blue-600 text-white border-blue-600'
                         : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-700'
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
                 className="inline-flex items-center justify-center h-[26px] w-[26px] rounded-lg border border-dashed border-slate-300 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50"
                 title="Add category shortcut"
                 aria-label="Add category shortcut"
               >
                 <Plus size={12} />
               </button>
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
                 title={listDensity === 'compact' ? 'Comfortable: more spacing' : 'Compact: denser list'}
               >
                 <List size={14} />{' '}
                 <span className="text-[10px] font-bold uppercase">
                   {listDensity === 'compact' ? 'Compact' : 'Comfort'}
                 </span>
               </button>
               <button
                 type="button"
                 onClick={() => setHideSellDeductions((v) => !v)}
                 className={`p-1.5 rounded-lg border flex items-center gap-1 ${hideSellDeductions ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                 title={hideSellDeductions ? 'Sell cell: showing sell price and pocket only' : 'Sell cell: hide shipping/fee/refund deductions, keep sell price and pocket'}
               >
                 <Receipt size={14} />{' '}
                 <span className="text-[10px] font-bold uppercase">
                   {hideSellDeductions ? 'No deductions' : 'Deductions'}
                 </span>
               </button>
               <button
                 type="button"
                 onClick={() => exportInventoryToExcel(sortedItems)}
                 className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-1"
                 title="Export current view to Excel"
               >
                 <FileSpreadsheet size={14} /> <span className="text-[10px] font-bold uppercase">Excel</span>
               </button>
               {onDownloadBackup && (
                 <button
                   type="button"
                   onClick={onDownloadBackup}
                   className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-1"
                   title="Download a full JSON backup of all inventory, trash, expenses and settings"
                 >
                   <Download size={14} /> <span className="text-[10px] font-bold uppercase">Backup</span>
                 </button>
               )}
               <div className="flex gap-1">
                 <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Undo"><RotateCcw size={14} /></button>
                 <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50" title="Redo"><RotateCw size={14} /></button>
               </div>
         </div>

         {/* Desktop purchase subfilters — same slot height as mobile pin row */}
         {statusFilter === 'PURCHASES' && (
           <div className="hidden lg:block min-h-[28px]">{purchasesView.chrome}</div>
         )}

         {/* Active filter chips */}
         {hasActiveFilters && !isSpecialListTab(statusFilter) && (
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
               {statusFilter !== 'ACTIVE' && statusFilter !== 'DRAFTS' && (excludedPlatforms.size > 0 || salePaymentFilter !== 'ALL') && (
                  <>
                     {excludedPlatforms.size > 0 && (
                       <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-medium">
                         {excludedPlatforms.size === 1
                           ? `Not ${PLATFORM_FILTER_OPTIONS.find((o) => excludedPlatforms.has(o.value))?.label ?? '1 platform'}`
                           : `${PLATFORM_FILTER_OPTIONS.length - excludedPlatforms.size}/${PLATFORM_FILTER_OPTIONS.length} platforms`}
                         <button type="button" onClick={() => setExcludedPlatforms(new Set())} className="hover:opacity-80">×</button>
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

         {(statusFilter === 'SOLD' || splitView) && (
            <div
              className={`flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] ${
                equalSplitGroupCount > 0
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-950'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <Layers
                size={12}
                className={`shrink-0 ${equalSplitGroupCount > 0 ? 'text-indigo-600' : 'text-slate-500'}`}
              />
              <span>
                {equalSplitGroupCount > 0 ? (
                  <>
                    <strong>{equalSplitGroupCount}</strong> possible historical bundle
                    {equalSplitGroupCount === 1 ? '' : 's'} (same sell date + price)
                  </>
                ) : (
                  <>Historical equal-split bundles</>
                )}
              </span>
              <button
                type="button"
                onClick={() => setShowEqualSplitGroups(true)}
                className={`ml-auto px-1.5 py-0.5 rounded font-bold ${
                  equalSplitGroupCount > 0
                    ? 'bg-indigo-200/80 hover:bg-indigo-300/80'
                    : 'bg-slate-200/80 hover:bg-slate-300/80'
                }`}
              >
                {equalSplitGroupCount > 0 ? 'Review' : 'Open'}
              </button>
            </div>
         )}

         {(statusFilter === 'SOLD' || splitView) && missingPlatformSoldCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] text-amber-950">
              <AlertTriangle size={12} className="text-amber-600 shrink-0" />
              <span><strong>{missingPlatformSoldCount}</strong> sold without platform</span>
              <button
                type="button"
                onClick={() =>
                  setExcludedPlatforms(
                    new Set(PLATFORM_FILTER_OPTIONS.map((o) => o.value).filter((v) => v !== MISSING_PLATFORM_FILTER))
                  )
                }
                className="ml-auto px-1.5 py-0.5 rounded bg-amber-200/80 font-bold hover:bg-amber-300/80"
              >
                Show
              </button>
            </div>
         )}

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

      <MobileSheetShell
        open={showMobileFiltersSheet}
        title="Stock filters"
        subtitle={`${sortedItems.length} items in view`}
        onClose={() => setShowMobileFiltersSheet(false)}
      >
        <div className="space-y-4 pb-6">
          <button
            type="button"
            onClick={() => setShowPriceBreakdown((prev) => !prev)}
            className={`w-full inline-flex items-center justify-between gap-2 px-3 py-3 rounded-xl border text-[11px] font-black uppercase ${
              showPriceBreakdown
                ? 'border-amber-400 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Receipt size={14} />
              Price breakdown
            </span>
            <span>{showPriceBreakdown ? 'On' : 'Off'}</span>
          </button>
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Category</p>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setSubCategoryFilter(''); }}
              className="w-full py-3 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800"
            >
              <option value="ALL">All categories</option>
              {Object.keys(categories).map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            {categoryFilter !== 'ALL' && (categories[categoryFilter]?.length ?? 0) > 0 && (
              <select
                value={subCategoryFilter}
                onChange={(e) => setSubCategoryFilter(e.target.value)}
                className="w-full py-3 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800"
              >
                <option value="">All subcategories</option>
                {(categories[categoryFilter] || []).map((sub) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Time</p>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
              className="w-full py-3 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800"
            >
              <option value="ALL">All time</option>
              <option value="THIS_WEEK">This week</option>
              <option value="LAST_WEEK">Last week</option>
              <option value="THIS_MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              <option value="LAST_30">Last 30 days</option>
              <option value="LAST_90">Last 90 days</option>
              <option value="THIS_YEAR">This year</option>
              <option value="LAST_YEAR">Last year</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['no_photo', 'No photo'],
                ['presence_unknown', '? Presence'],
                ['no_specs', 'No specs'],
                ['defective', 'Defekt'],
                ['aging', '>90d'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSmartPreset((p) => (p === id ? null : id))}
                className={`px-3 py-2 rounded-xl border text-[11px] font-black uppercase ${
                  smartPreset === id ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowInComposition((prev) => !prev)}
            className={`w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-[11px] font-black uppercase ${
              showInComposition ? 'border-slate-200 text-slate-700 bg-white' : 'border-blue-500 text-blue-700 bg-blue-50'
            }`}
          >
            <Hourglass size={14} />
            {showInComposition ? 'Orphans: shown' : 'Orphans: hidden'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { exportInventoryToExcel(sortedItems); setShowMobileFiltersSheet(false); }}
              className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase text-slate-700"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              type="button"
              onClick={() => { clearAllFilters(); setSmartPreset(null); }}
              className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase text-slate-700"
            >
              <FilterX size={14} /> Reset
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileFiltersSheet(false)}
            className="w-full py-3.5 rounded-xl bg-slate-900 text-white text-sm font-black uppercase"
          >
            Done
          </button>
        </div>
      </MobileSheetShell>

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
        autoEbay={addPhotosAutoEbay}
      />

      {geminiCardItem && (
        <GeminiProductCardModal
          item={geminiCardItem}
          inventoryItems={items}
          categoryFields={
            (categoryFields || {})[`${geminiCardItem.category}:${geminiCardItem.subCategory}`] ||
            (categoryFields || {})[geminiCardItem.category]
          }
          onClose={() => setGeminiCardItem(null)}
          onApplyAsMainPhoto={async (url) => {
            const base = items.find((i) => i.id === geminiCardItem.id) || geminiCardItem;
            const merged = normalizeImageList([url, ...getItemUserPhotoUrls(base)]);
            const next = {
              ...base,
              imageUrl: merged[0] || url,
              imageUrls: merged,
            };
            // handleUpdate expects InventoryItem[] — a bare object crashed with .forEach
            await onUpdate([next]);
            setGeminiCardItem(next);
            setToast('AI product card set as main photo');
            setTimeout(() => setToast(null), 2200);
          }}
          onAddToItemGallery={async (url) => {
            const base = items.find((i) => i.id === geminiCardItem.id) || geminiCardItem;
            const existing = getItemUserPhotoUrls(base);
            const merged = normalizeImageList([...existing, url]);
            const next = {
              ...base,
              imageUrl: merged[0] || '',
              imageUrls: merged,
            };
            await onUpdate([next]);
            setGeminiCardItem(next);
            setToast('AI card added to item photos');
            setTimeout(() => setToast(null), 2200);
          }}
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

      {/* Shared list shells — only the inner items swap between Active / Sold / Purchases / Hub orders */}
      <div
        className="lg:hidden flex-1 min-h-0 px-2.5 pt-1 pb-[calc(6rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-y-contain touch-pan-y custom-scrollbar space-y-2.5 bg-slate-950"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
          {statusFilter === 'PURCHASES' ? (
            purchasesView.mobileList
          ) : sortedItems.length === 0 ? (
            <div className="py-16 text-center opacity-40">
              <Package size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="font-bold text-slate-400 text-sm">No matches found</p>
              <p className="text-xs text-slate-400 mt-1">Try clearing search or filters</p>
            </div>
          ) : (
            sortedItems.map((item) => {
              return (
              <div
                key={item.id}
                className={
                  bulkBatchActive
                    ? 'pl-2 ml-1 border-l-2 border-violet-300'
                    : undefined
                }
              >
              <MobileStockCard
                item={item}
                allItems={items}
                taxMode={POCKET_PROFIT_TAX_MODE}
                suggestedEbayList={suggestedEbayById.get(item.id)?.ebayList}
                suggestedKleinList={suggestedEbayById.get(item.id)?.kleinList}
                suggestedFeePct={suggestedEbayById.get(item.id)?.feePct}
                showPriceBreakdown={showPriceBreakdown}
                onSaveShipping={
                  canEditManualSellerShipping(item)
                    ? (amount) => saveSellerShipping(item, amount)
                    : undefined
                }
                selected={selectedIdSet.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
                actions={{
                  onEdit: (it) => handleEditClick(it),
                  onSell: (it) => {
                    addRecentItemId(it.id);
                    setItemToSell(it);
                  },
                  onPhotos: (it) => openAddPhotosModal([it.id]),
                  onEbayPhotos: (it) => openAddPhotosModal([it.id], { ebay: true }),
                  onQuickBundle: (it) => {
                    const parentOfItem = resolveParentContainer(
                      it,
                      containersById,
                      containerByChildId
                    );
                    const soldLike =
                      isRealizedDisposal(it) || it.status === ItemStatus.GIFTED;
                    const isSoldContainer = (it.isPC || it.isBundle) && soldLike;
                    if (soldLike && !isSoldContainer) return;
                    const seed =
                      parentOfItem && !it.isPC && !it.isBundle ? parentOfItem : it;
                    openQuickBundlePanel(seed);
                  },
                  onSplitParts: (it) => {
                    const childCount =
                      it.isPC || it.isBundle ? getChildren(it, items).length : 0;
                    if (!canSplitItem(it, childCount)) return;
                    setSplitPartsSeed(it);
                  },
                  onTrade: (it) => {
                    addRecentItemId(it.id);
                    setItemToTrade(it);
                  },
                  onGift: (it) => {
                    addRecentItemId(it.id);
                    setItemToGift(it);
                  },
                  onDuplicate: (it) => handleDuplicate(it),
                  onDelete: (it) => setItemToDelete(it),
                  onPatchAccessory: (it, patch) =>
                    onUpdate([{ ...it, ...patch }], undefined, {
                      skipActionLog: true,
                    }),
                  onTogglePresence: (it) => togglePresence(it),
                  onUnbundle: (it) => setBundleToDismantle(it),
                  onEditBuyer: (it) => {
                    addRecentItemId(it.id);
                    setItemToEditBuyer(it);
                  },
                  onMarkUnsold: (it) => setItemToReturn(it),
                }}
              />
              </div>
            );
            })
          )}
      </div>

      {/* Mobile Quick Bundle — desktop embeds the panel in the table row (hidden on phones). */}
      {quickBundleSeed && (
        <div className="lg:hidden fixed inset-0 z-[220] flex flex-col justify-end bg-slate-900/50 backdrop-blur-[1px]">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close bundle panel"
            onClick={() => setQuickBundleSeed(null)}
          />
          <div className="relative z-10 max-h-[min(92dvh,40rem)] overflow-y-auto overscroll-contain rounded-t-2xl bg-white shadow-2xl pb-[env(safe-area-inset-bottom,0px)]">
            <QuickBundleAddModal
              seed={quickBundleSeed}
              items={items}
              onClose={() => setQuickBundleSeed(null)}
              onApply={(updates) => {
                onUpdate(updates);
                setToast(
                  updates.some((u) => (u.isBundle || u.isPC) && u.componentIds)
                    ? `Updated · ${updates.find((u) => u.isBundle || u.isPC)?.name || 'saved'}`
                    : 'Bundle saved'
                );
                setTimeout(() => setToast(null), 2200);
                setQuickBundleSeed(null);
              }}
            />
          </div>
        </div>
      )}

      {splitPartsSeed && (
        <SplitPartsModal
          item={splitPartsSeed}
          items={items}
          onClose={() => setSplitPartsSeed(null)}
          onApply={(updates, deleteIds) => {
            onUpdate(updates, deleteIds);
            const parent = updates.find((u) => u.isBundle || u.isPC);
            const childCount = deleteIds?.length ? updates.length : Math.max(0, updates.length - 1);
            if (parent) {
              setScrollTargetItemId(parent.id);
              setCollapsedBundles((prev) => {
                const next = new Set(prev);
                next.delete(parent.id);
                return next;
              });
            } else if (updates[0]) {
              setScrollTargetItemId(updates[0].id);
            }
            setToast(`Split into ${(parent?.componentIds || []).length || childCount} parts`);
            setTimeout(() => setToast(null), 2400);
            setSplitPartsSeed(null);
          }}
        />
      )}

      {/* Table scrolls in remaining height; bulk bar is a separate row below (never overlays rows) */}
      <style>{`
        [data-inventory-table] { zoom: 1.05; }
        [data-inventory-table] tbody > tr > td { padding: 0.28rem 0.75rem !important; vertical-align: top !important; text-align: center !important; }
        [data-inventory-table] tbody > tr > td.inv-col-money { vertical-align: top !important; }
        [data-inventory-table] tbody > tr > td.inv-col-money { line-height: 1.25 !important; }
        [data-inventory-table] tbody > tr > td.inv-col-item { text-align: left !important; }
        [data-inventory-table] tbody > tr > td.inv-col-icons { padding: 0.25rem 0.35rem !important; overflow: visible !important; }
        [data-inventory-table] tbody > tr > td.inv-col-hub-sell { padding-right: 1.15rem !important; }
        [data-inventory-table] tbody > tr > td.inv-col-date { padding-left: 0.55rem !important; padding-right: 0.55rem !important; }
        [data-inventory-table] tbody > tr > td.inv-col-platform { padding-left: 0.5rem !important; padding-right: 0.55rem !important; vertical-align: top !important; }
        [data-inventory-table] thead th.inv-col-hub-sell > div:first-of-type { padding-right: 1.15rem !important; }
        [data-inventory-table] thead th.inv-col-date > div:first-of-type { padding-left: 0.55rem !important; padding-right: 0.55rem !important; }
        [data-inventory-table] thead th.inv-col-platform > div:first-of-type { padding-left: 0.5rem !important; padding-right: 0.55rem !important; }
        [data-inventory-table] thead th.inv-col-item > div:first-of-type { padding-left: 3.625rem !important; }
        [data-inventory-table] tbody > tr > td.inv-col-soak,
        [data-inventory-table] thead th.inv-col-soak { padding: 0 !important; }
        [data-inventory-table] thead th > div:first-of-type { padding: 0.28rem 0.75rem !important; min-height: 1.65rem !important; }
        [data-inventory-table] thead th { font-size: 0.625rem; letter-spacing: 0.04em; text-align: center; }
        [data-inventory-table] thead th.inv-col-item { text-align: left; }
        [data-density="compact"][data-inventory-table] tbody > tr > td { padding: 0.16rem 0.625rem !important; }
        [data-density="compact"][data-inventory-table] tbody > tr > td.inv-col-icons { padding: 0.14rem 0.3rem !important; }
        [data-density="compact"][data-inventory-table] tbody > tr > td.inv-col-hub-sell { padding-right: 1rem !important; }
        [data-density="compact"][data-inventory-table] tbody > tr > td.inv-col-date { padding-left: 0.45rem !important; padding-right: 0.45rem !important; }
        [data-density="compact"][data-inventory-table] tbody > tr > td.inv-col-platform { padding-left: 0.4rem !important; padding-right: 0.45rem !important; }
        [data-density="compact"][data-inventory-table] thead th.inv-col-hub-sell > div:first-of-type { padding-right: 1rem !important; }
        [data-density="compact"][data-inventory-table] thead th.inv-col-date > div:first-of-type { padding-left: 0.45rem !important; padding-right: 0.45rem !important; }
        [data-density="compact"][data-inventory-table] thead th.inv-col-platform > div:first-of-type { padding-left: 0.4rem !important; padding-right: 0.45rem !important; }
        [data-density="compact"][data-inventory-table] thead th.inv-col-item > div:first-of-type { padding-left: 3.25rem !important; }
        [data-density="compact"][data-inventory-table] thead th > div:first-of-type { padding: 0.16rem 0.625rem !important; min-height: 1.35rem !important; }
        [data-density="compact"] .text-sm { font-size: 0.6875rem; line-height: 1.2; }
        [data-density="compact"] .text-xs { font-size: 0.625rem; line-height: 1.2; }
        [data-density="comfortable"] .text-sm { line-height: 1.25; }
        [data-bulk-batch] tbody > tr > td:first-child { box-shadow: inset 3px 0 0 #8b5cf6; }
      `}</style>
      {splitView && !isSpecialListTab(statusFilter) ? (
        <div className="hidden lg:flex flex-1 min-h-0 min-w-0 flex-col relative">
        <div className="flex flex-1 min-h-0 gap-2 flex-col lg:flex-row min-h-0">
          <InventoryListTablePane
            key="split-active"
            paneItems={sortedActiveItems}
            paneStatus="ACTIVE"
            paneLabel="Active"
            scrollRef={activeTableRef}
            visibleColumns={activeInventoryColumns}
            columnWidths={effectiveColumnWidths}
            manualWidthColumns={manualWidthColumns}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onResetItemColumnWidth={handleResetItemColumnWidth}
            draggingColumnId={draggingColumnId}
            dragOverColumnId={dragOverColumnId}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragOver={handleColumnDragOver}
            onColumnDrop={handleColumnDrop}
            onColumnDragEnd={handleColumnDragEnd}
            onSelectAll={() => handleSelectAllFor(sortedActiveItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            highlightedItemId={highlightedItemId}
            rowHeightEstimate={rowHeightEstimate}
            collapsedBundles={collapsedBundles}
            bulkBatchActive={bulkBatchActive}
          />
          <InventoryListTablePane
            key="split-sold"
            paneItems={sortedSoldItems}
            paneStatus="SOLD"
            paneLabel="Sold"
            paneExtra={null}
            scrollRef={soldTableRef}
            visibleColumns={visibleColumns}
            columnWidths={effectiveColumnWidths}
            manualWidthColumns={manualWidthColumns}
            listDensity={listDensity}
            sortConfig={sortConfig}
            handleHeaderSort={handleHeaderSort}
            handleColumnResizeStart={handleColumnResizeStart}
            onResetItemColumnWidth={handleResetItemColumnWidth}
            draggingColumnId={draggingColumnId}
            dragOverColumnId={dragOverColumnId}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragOver={handleColumnDragOver}
            onColumnDrop={handleColumnDrop}
            onColumnDragEnd={handleColumnDragEnd}
            onSelectAll={() => handleSelectAllFor(sortedSoldItems)}
            selectedIdSet={selectedIdSet}
            renderRowCells={renderRowCells}
            getRowActivityKey={getRowActivityKey}
            highlightedItemId={highlightedItemId}
            rowHeightEstimate={rowHeightEstimate}
            collapsedBundles={collapsedBundles}
            bulkBatchActive={bulkBatchActive}
          />
        </div>
        {selectedIds.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-30">
            <BulkSelectionBar
              count={bulkSelectionCount}
              totalBuy={bulkSelectedTotals.buy}
              totalSell={bulkSelectedTotals.sell}
              onClear={() => startTransition(() => setSelectedIds([]))}
              actions={bulkActions}
            />
          </div>
        )}
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 min-h-0 min-w-0 flex-col relative">
        {statusFilter === 'PURCHASES' ? (
          purchasesView.desktopList
        ) : (
        <InventoryListTablePane
          key="single-pane"
          paneItems={sortedItems}
          paneStatus={statusFilter}
          scrollRef={tableContainerRef}
          visibleColumns={visibleColumns}
          columnWidths={effectiveColumnWidths}
          manualWidthColumns={manualWidthColumns}
          listDensity={listDensity}
          sortConfig={sortConfig}
          handleHeaderSort={handleHeaderSort}
          handleColumnResizeStart={handleColumnResizeStart}
          onResetItemColumnWidth={handleResetItemColumnWidth}
          draggingColumnId={draggingColumnId}
          dragOverColumnId={dragOverColumnId}
          onColumnDragStart={handleColumnDragStart}
          onColumnDragOver={handleColumnDragOver}
          onColumnDrop={handleColumnDrop}
          onColumnDragEnd={handleColumnDragEnd}
          onSelectAll={handleSelectAll}
          selectedIdSet={selectedIdSet}
          renderRowCells={renderRowCells}
          getRowActivityKey={getRowActivityKey}
          highlightedItemId={highlightedItemId}
          rowHeightEstimate={rowHeightEstimate}
          collapsedBundles={collapsedBundles}
          className="flex flex-1"
          bulkBatchActive={bulkBatchActive}
        />
        )}
        {!isSpecialListTab(statusFilter) && selectedIds.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-30">
            <BulkSelectionBar
              count={bulkSelectionCount}
              totalBuy={bulkSelectedTotals.buy}
              totalSell={bulkSelectedTotals.sell}
              onClear={() => startTransition(() => setSelectedIds([]))}
              actions={bulkActions}
            />
          </div>
        )}
        </div>
      )}

      <div className="lg:hidden shrink-0 w-full">
        {!isSpecialListTab(statusFilter) ? (
        <BulkSelectionBar
          count={bulkSelectionCount}
          totalBuy={bulkSelectedTotals.buy}
          totalSell={bulkSelectedTotals.sell}
          onClear={() => startTransition(() => setSelectedIds([]))}
          actions={bulkActions}
        />
        ) : null}
      </div>

      {/* MODALS */}
      {itemToEdit && (
         <EditItemModal
            item={itemToEdit}
            items={items}
            onSave={(updatedList) => {
               // Persist patches while Listing Studio stays open.
               const updated = updatedList[0];
               if (updated && isPurchasePreviewId(updated.id)) {
                 if (savePurchaseDraftFromPreviewItem(updated)) {
                   purchasesView.refresh();
                   setItemToEdit(updated);
                   setToast('Purchase draft saved — Confirm received to add to Active');
                   setTimeout(() => setToast(null), 2200);
                 }
                 return;
               }
               const nameChanged = !!updated && updated.name !== itemToEdit.name;
               onUpdate(updatedList, undefined, {
                 flushCloud:
                   !!updated &&
                   (updated.marketTitle !== itemToEdit.marketTitle ||
                     updated.marketDescription !== itemToEdit.marketDescription ||
                     nameChanged),
               });
               // Keep edit target in sync so nested inventory + further patches see the new name.
               if (updated) setItemToEdit(updated);
               if (
                 updated &&
                 (updated.marketTitle !== itemToEdit.marketTitle ||
                   updated.marketDescription !== itemToEdit.marketDescription)
               ) {
                 setToast('Listing saved to item');
                 setTimeout(() => setToast(null), 1600);
               } else if (nameChanged) {
                 setToast('Name saved');
                 setTimeout(() => setToast(null), 1400);
               }
            }}
            onClose={() => setItemToEdit(null)}
            categories={categories}
            categoryFields={categoryFields} // Pass prop
            onAddCategory={() => {}}
            parentContainer={resolveParentContainer(itemToEdit, containersById, containerByChildId)}
            onOpenParentContainer={(parent) => {
              setItemToEdit(null);
              openParentContainer(parent);
            }}
            onLocateParentContainer={(parent) => {
              setItemToEdit(null);
              focusContainerInList(parent);
            }}
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

      <ComposeTypeModal
        open={showComposeType}
        selectedCount={selectedIds.length}
        allowSold={
          selectedIds.length > 1 &&
          items.filter((i) => selectedIds.includes(i.id)).every((i) => isRealizedDisposal(i))
        }
        onChoose={handleComposeTypeChosen}
        onClose={() => setShowComposeType(false)}
      />
      {showRetroBundle && (
        <RetroBundleModal
            items={items.filter(i => selectedIds.includes(i.id))}
            allItems={items}
            onConfirm={handleCreateRetroBundle}
            onClose={() => setShowRetroBundle(false)}
        />
      )}

      {showEqualSplitGroups && (
        <SoldEqualSplitGroupsModal
          items={items}
          onApply={(updates) => {
            const parent = updates.find((u) => u.isBundle || u.isPC);
            const parts = updates.filter((u) => u !== parent);
            if (parent) {
              const { nextItems, deleteIds } = applyRetroComposeToInventory(items, parent, parts);
              const changed = nextItems.filter((n) => {
                const old = items.find((i) => i.id === n.id);
                return !old || old !== n;
              });
              onUpdate(changed, deleteIds);
              setScrollTargetItemId(parent.id);
              setCollapsedBundles((prev) => {
                const next = new Set(prev);
                next.delete(parent.id);
                return next;
              });
              setToast(
                deleteIds.length > 0
                  ? `Grouped as ${parent.isPC ? 'PC' : 'Bundle'} — removed ${deleteIds.length} duplicate shell${deleteIds.length === 1 ? '' : 's'}`
                  : `Grouped as ${parent.isPC ? 'PC' : 'Bundle'}: ${parent.name}`
              );
              setTimeout(() => setToast(null), 2400);
            } else {
              onUpdate(updates);
            }
          }}
          onIgnored={() => setEqualSplitIgnoreRev((n) => n + 1)}
          onClose={() => {
            setEqualSplitIgnoreRev((n) => n + 1);
            setShowEqualSplitGroups(false);
          }}
        />
      )}

      {recalcTarget && (
        <ReinvestBundleRecalcModal
          container={recalcTarget}
          allItems={items}
          onApply={handleApplyRecalc}
          onClose={() => setRecalcTarget(null)}
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
                              <p className="text-[10px] font-bold text-slate-400 uppercase">Sold comps band (eBay.de)</p>
                              <p className="text-sm font-black text-slate-700">€{formatEUR(Number(priceSuggestResult.priceLow))} – €{formatEUR(Number(priceSuggestResult.priceHigh))}</p>
                              <p className="text-2xl font-black text-emerald-600 mt-1">€{formatEUR(Number(priceSuggestResult.priceAverage))} avg</p>
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
                           Sync new orders in <span className="font-bold text-slate-600">eBay Abrechnung</span>, then try again.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                           <button
                              type="button"
                              onClick={() => { closeOrderLookupModal(); navigate('/panel/ebay-abrechnung'); }}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700"
                           >
                              Open eBay Abrechnung
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
            inventoryItems={items}
            taxMode={POCKET_PROFIT_TAX_MODE}
            mode="sell"
            onSave={(updated, splitOff) => { 
               // Selling one nested part: detach from parent, leave remaining parts in the group.
               const soldFromComposition =
                 itemToSell &&
                 !(updated.isPC || updated.isBundle) &&
                 (itemToSell.status === ItemStatus.IN_COMPOSITION ||
                   Boolean(itemToSell.parentContainerId));
               const compositionParentId =
                 itemToSell?.parentContainerId ||
                 (soldFromComposition
                   ? items.find(
                       (i) =>
                         (i.isPC || i.isBundle) &&
                         (i.componentIds || []).includes(itemToSell!.id)
                     )?.id
                   : undefined);

               if (soldFromComposition && compositionParentId) {
                 const parent = items.find((i) => i.id === compositionParentId);
                 const soldChild: InventoryItem = {
                   ...updated,
                   status: ItemStatus.SOLD,
                   parentContainerId: undefined,
                 };
                 if (parent && (parent.isPC || parent.isBundle)) {
                   const remainingChildren = items.filter(
                     (i) =>
                       i.id !== soldChild.id &&
                       (((parent.componentIds || []).includes(i.id) ||
                         i.parentContainerId === parent.id) &&
                         !i.isPC &&
                         !i.isBundle)
                   );
                   if (remainingChildren.length === 0) {
                     // Last part sold — remove empty parent shell from inventory.
                     onUpdate([soldChild], [parent.id]);
                   } else {
                     const buyTotal =
                       Math.round(
                         remainingChildren.reduce((s, i) => s + Number(i.buyPrice || 0), 0) * 100
                       ) / 100;
                     let updatedParent: InventoryItem = {
                       ...parent,
                       componentIds: remainingChildren.map((c) => c.id),
                       buyPrice: buyTotal,
                       comment2: remainingChildren
                         .map((i) => `- ${i.name}${i.isDefective ? ' [defekt]' : ''}`)
                         .join('\n')
                         .slice(0, 2000),
                     };
                     const kind = getContainerKind(updatedParent);
                     if (kind) {
                       updatedParent = withRebuiltContainerTitle(
                         updatedParent,
                         kind,
                         remainingChildren
                       );
                     }
                     onUpdate([updatedParent, soldChild]);
                   }
                 } else {
                   onUpdate([soldChild]);
                 }
                 setItemToSell(null);
                 return;
               }

               // When selling a PC or bundle, also stamp all child components
               // with the container's sale date. Child items keep their original buyDate.
               const childComponents =
                 updated.isPC || updated.isBundle ? resolveContainerChildItems(updated, items) : [];
               if (childComponents.length > 0) {
                 // Use the bundle/PC's sell date value for all child items
                 const soldAt = updated.sellDate || new Date().toISOString().split('T')[0];
                 const datedChildren = childComponents.map((i) => ({
                   ...i,
                   sellDate: soldAt,
                   status: ItemStatus.SOLD,
                   containerSoldDate: soldAt,
                   platformSold: updated.platformSold,
                   paymentType: updated.paymentType,
                   ebayOrderId: updated.ebayOrderId ?? i.ebayOrderId,
                   ebayUsername: updated.ebayUsername ?? i.ebayUsername,
                   customer: updated.customer ?? i.customer,
                 }));
                 const synced = syncSoldContainerFamilyEqual(updated, datedChildren);
                 const updatedChildren = synced.children;
                 
                 onUpdate([{ ...synced.container, profit: 0 }, ...updatedChildren]);
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
            inventoryItems={items}
            taxMode={POCKET_PROFIT_TAX_MODE}
            mode="editBuyer"
            onSave={(updated) => {
              const updates =
                updated.isPC || updated.isBundle
                  ? expandUpdatesWithContainerSaleMeta([updated], items)
                  : [updated];
              onUpdate(updates);
              setItemToEditBuyer(null);
            }}
            onClose={() => setItemToEditBuyer(null)}
         />
      )}

      {itemToFindOrder && (
         <InventoryOrderLinkPicker
            item={itemToFindOrder}
            taxMode={POCKET_PROFIT_TAX_MODE}
            onLink={(updated) => {
              const updates =
                updated.isPC || updated.isBundle
                  ? expandUpdatesWithContainerSaleMeta([updated], items)
                  : [updated];
              onUpdate(updates);
              setItemToFindOrder(null);
            }}
            onClose={() => setItemToFindOrder(null)}
         />
      )}

      {itemToReturn && (
         <ReturnModal
            items={[itemToReturn]}
            onConfirm={(updatedItems) => {
               const { updates, deleteIds } = applyUnsoldRestock(
                 items,
                 updatedItems.map((i) => i.id),
                 { patches: updatedItems, refundOrders: loadRefundOrdersForRestock() }
               );
               const detailsByItemId: Record<string, string> = {};
               for (const u of updates) {
                 const before = items.find((i) => i.id === u.id);
                 if (!before) continue;
                 const delta = Math.round(((Number(u.buyPrice) || 0) - (Number(before.buyPrice) || 0)) * 100) / 100;
                 detailsByItemId[u.id] =
                   delta >= 0.01
                     ? `Restored to In Stock · +€${delta.toFixed(2)} EK (return/cancellation fees)`
                     : 'Restored to In Stock';
               }
               onUpdate(updates, deleteIds.length ? deleteIds : undefined, {
                 flushCloud: true,
                 skipFieldPreserve: true,
                 actionNote: {
                   action: 'Marked unsold / returned',
                   detailsByItemId,
                 },
               });
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
               onUpdate([updatedOriginal, ...newItems], undefined, { flushCloud: true });
               setItemToTrade(null);
            }}
            onClose={() => setItemToTrade(null)}
         />
      )}

      {itemToGift && (
         <GiftModal
            item={itemToGift}
            taxMode={POCKET_PROFIT_TAX_MODE}
            onSave={(updated) => {
               onUpdate([updated], undefined, {
                 flushCloud: true,
                 actionNote: {
                   action: 'Gifted / Privatentnahme',
                   details: updated.giftRecipient
                     ? `To ${updated.giftRecipient}${updated.giftRelation ? ` (${updated.giftRelation})` : ''}`
                     : undefined,
                 },
               });
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
const INVENTORY_VIRTUAL_THRESHOLD = 40;

type InventoryTableBodyProps = {
  sortedItems: InventoryItem[];
  selectedIdSet: Set<string>;
  visibleColumns: ColumnId[];
  renderRowCells: (item: InventoryItem, isSelected: boolean, itemFlexWidth?: number | null) => React.ReactNode;
  getRowActivityKey: (item: InventoryItem) => string;
  highlightedItemId: string | null;
  scrollElement: HTMLDivElement | null;
  rowHeightEstimate: number;
  collapsedBundles: Set<string>;
  itemFlexWidth?: number | null;
  soakSpacer?: boolean;
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
  collapsedBundles,
  itemFlexWidth,
  soakSpacer = false,
}: InventoryTableBodyProps) {
  const useVirtual = sortedItems.length > INVENTORY_VIRTUAL_THRESHOLD;

  // Precompute once per data/edit change — not on every virtualizer scroll frame.
  const rowActivityKeyById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of sortedItems) {
      map.set(item.id, getRowActivityKey(item));
    }
    return map;
  }, [sortedItems, getRowActivityKey]);

  const estimateSize = useCallback(
    (index: number) => {
      const item = sortedItems[index];
      if (!item) return rowHeightEstimate;
      let h = rowHeightEstimate;
      // Extra under-name rows only (OVP/IO live on the title row now — do not pad every row).
      if (item.isPC || item.isBundle) h += 16;
      if (
        (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) &&
        !item.parentContainerId
      ) {
        h += 14; // price-analyzer chips
      }
      if (
        isRealizedDisposal(item) &&
        (item.customer?.name || item.giftRecipient || item.ebayUsername || item.ebayOrderId)
      ) {
        h += 18;
      }
      if ((item.tradedForIds?.length ?? 0) > 0 || item.tradedFromId) {
        h += 22;
      }
      if (item.parentContainerId || item.status === ItemStatus.IN_COMPOSITION) h += 22;
      if (!collapsedBundles.has(item.id) && (item.isPC || item.isBundle)) {
        const childCount = Math.max(1, item.componentIds?.length ?? 3);
        h += childCount * 18 + 10;
      }
      return h;
    },
    [sortedItems, rowHeightEstimate, collapsedBundles]
  );

  const rowVirtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollElement,
    estimateSize,
    // Fixed estimates only — measureElement during scroll causes layout thrash / jumpy feel.
    overscan: 12,
    // Briefly treat scroll as active after the last wheel/touch so deferred chrome stays hidden.
    isScrollingResetDelay: 120,
    getItemKey: (index) => sortedItems[index]?.id ?? index,
  });

  const itemCount = sortedItems.length;
  const collapsedSig = useMemo(() => {
    if (collapsedBundles.size === 0) return '';
    return Array.from(collapsedBundles).join('\0');
  }, [collapsedBundles]);

  useLayoutEffect(() => {
    if (!useVirtual) return;
    // Refresh estimated positions after expand/collapse or list length change — never on scroll.
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useVirtual, itemCount, collapsedSig, rowHeightEstimate]);

  if (sortedItems.length === 0) {
    return (
      <tbody className="divide-y divide-slate-50">
        <tr>
          <td colSpan={visibleColumns.length} className="p-20 text-center opacity-40">
            <Package size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="font-bold text-slate-400">No matches found</p>
            <p className="text-sm text-slate-400 mt-1">Try clearing search or category filters</p>
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
            itemFlexWidth={itemFlexWidth}
            soakSpacer={soakSpacer}
            rowActivityKey={rowActivityKeyById.get(item.id) ?? ''}
            highlighted={highlightedItemId === item.id}
          />
        ))}
      </tbody>
    );
  }

  const colCount = visibleColumns.length + (soakSpacer ? 1 : 0);
  const virtualItems = rowVirtualizer.getVirtualItems();
  const topSpacer = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const bottomSpacer =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <tbody
      className={`divide-y divide-slate-50${rowVirtualizer.isScrolling ? ' inv-is-scrolling' : ''}`}
    >
      {topSpacer > 0 && (
        <tr aria-hidden="true" className="pointer-events-none border-0">
          <td colSpan={colCount} className="!p-0 !border-0" style={{ height: `${topSpacer}px` }} />
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
            itemFlexWidth={itemFlexWidth}
            soakSpacer={soakSpacer}
            rowActivityKey={rowActivityKeyById.get(item.id) ?? ''}
            highlighted={highlightedItemId === item.id}
            virtualIndex={virtualRow.index}
          />
        );
      })}
      {bottomSpacer > 0 && (
        <tr aria-hidden="true" className="pointer-events-none border-0">
          <td colSpan={colCount} className="!p-0 !border-0" style={{ height: `${bottomSpacer}px` }} />
        </tr>
      )}
    </tbody>
  );
});

type InventoryTableRowProps = {
  item: InventoryItem;
  isSelected: boolean;
  visibleColumns: ColumnId[];
  renderRowCells: (item: InventoryItem, isSelected: boolean, itemFlexWidth?: number | null) => React.ReactNode;
  /** Bumps when inline edit / AI spinners / Flags + panel / collapse affect this row so memo does not skip updates. */
  rowActivityKey: string;
  highlighted?: boolean;
  virtualIndex?: number;
  itemFlexWidth?: number | null;
  soakSpacer?: boolean;
};

const InventoryTableRow = React.memo(
  function InventoryTableRow({ item, isSelected, renderRowCells, highlighted, virtualIndex, itemFlexWidth, soakSpacer }: InventoryTableRowProps) {
    return (
      <tr
        data-index={virtualIndex}
        data-inventory-item-id={item.id}
        data-container={isInventoryContainer(item) ? (item.isPC ? 'pc' : 'bundle') : undefined}
        className={containerRowClassName(item, isSelected, Boolean(highlighted))}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 88px' }}
      >
        {renderRowCells(item, isSelected, itemFlexWidth)}
        {soakSpacer ? <td className="inv-col-soak" aria-hidden /> : null}
      </tr>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.isSelected === next.isSelected &&
    prev.visibleColumns === next.visibleColumns &&
    prev.rowActivityKey === next.rowActivityKey &&
    prev.highlighted === next.highlighted &&
    prev.renderRowCells === next.renderRowCells &&
    prev.itemFlexWidth === next.itemFlexWidth &&
    prev.soakSpacer === next.soakSpacer &&
    prev.virtualIndex === next.virtualIndex
);

type InventoryListTablePaneProps = {
  paneItems: InventoryItem[];
  paneStatus: StatusFilter;
  paneLabel?: string;
  paneExtra?: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  visibleColumns: ColumnId[];
  columnWidths: Record<string, number>;
  manualWidthColumns: Set<ColumnId>;
  listDensity: 'comfortable' | 'compact';
  sortConfig: SortConfig;
  handleHeaderSort: (columnId: ColumnId) => void;
  handleColumnResizeStart: (e: React.MouseEvent, colId: ColumnId) => void;
  onResetItemColumnWidth: () => void;
  draggingColumnId: ColumnId | null;
  dragOverColumnId: ColumnId | null;
  onColumnDragStart: (colId: ColumnId) => void;
  onColumnDragOver: (e: React.DragEvent, colId: ColumnId) => void;
  onColumnDrop: (colId: ColumnId) => void;
  onColumnDragEnd: () => void;
  onSelectAll: () => void;
  selectedIdSet: Set<string>;
  renderRowCells: (item: InventoryItem, isSelected: boolean, itemFlexWidth?: number | null) => React.ReactNode;
  getRowActivityKey: (item: InventoryItem) => string;
  highlightedItemId: string | null;
  rowHeightEstimate: number;
  collapsedBundles: Set<string>;
  className?: string;
  bulkBatchActive?: boolean;
};

const InventoryListTablePane: React.FC<InventoryListTablePaneProps> = ({
  paneItems,
  paneStatus,
  paneLabel,
  paneExtra,
  scrollRef,
  visibleColumns,
  columnWidths,
  manualWidthColumns,
  listDensity,
  sortConfig,
  handleHeaderSort,
  handleColumnResizeStart,
  onResetItemColumnWidth,
  draggingColumnId,
  dragOverColumnId,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDrop,
  onColumnDragEnd,
  onSelectAll,
  selectedIdSet,
  renderRowCells,
  getRowActivityKey,
  highlightedItemId,
  rowHeightEstimate,
  collapsedBundles,
  className = 'flex flex-1',
  bulkBatchActive = false,
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

  // Default: Asset Name soaks leftover space. After a drag-resize it is locked to a px width
  // and a trailing soak column absorbs leftover so the name can actually get narrower.
  const itemLocked = manualWidthColumns.has('item');
  const itemFloor = columnWidths['item'] || DEFAULT_WIDTHS['item'];
  const othersWidth = useMemo(
    () =>
      visibleColumns
        .filter((id) => id !== 'item')
        .reduce((sum, id) => sum + (columnWidths[id] || DEFAULT_WIDTHS[id]), 0),
    [visibleColumns, columnWidths]
  );
  const tableMinWidth = othersWidth + itemFloor;

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
      <div
        ref={attachScrollRef}
        className="flex-1 min-h-0 overflow-x-auto overflow-y-auto custom-scrollbar pb-[4.75rem]"
        style={{ overflowAnchor: 'none', overscrollBehavior: 'contain' }}
      >
        <table
          className="w-full text-left border-collapse table-fixed"
          style={{ minWidth: tableMinWidth, width: '100%' }}
          data-inventory-table
          data-density={listDensity}
          {...(bulkBatchActive ? { 'data-bulk-batch': '' } : {})}
        >
          <colgroup>
            {visibleColumns.map((colId) =>
              colId === 'item' ? (
                itemLocked ? (
                  <col key={colId} style={{ width: itemFloor, minWidth: itemFloor }} />
                ) : (
                  <col key={colId} style={{ minWidth: itemFloor }} />
                )
              ) : (
                <col
                  key={colId}
                  style={{
                    width: columnWidths[colId] || DEFAULT_WIDTHS[colId],
                  }}
                />
              )
            )}
            {itemLocked ? <col key="soak" /> : null}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest">
              {visibleColumns.map((colId) => {
                const rawW = columnWidths[colId] || DEFAULT_WIDTHS[colId];
                const sortable = !['actions', 'select', 'parseSpecs'].includes(colId);
                const canDrag = colId !== 'select';
                const isDragging = draggingColumnId === colId;
                const isDragOver = dragOverColumnId === colId && draggingColumnId !== colId;
                const thStyle =
                  colId === 'item'
                    ? itemLocked
                      ? { width: itemFloor, minWidth: itemFloor, maxWidth: itemFloor }
                      : { minWidth: itemFloor }
                    : { width: rawW, minWidth: rawW, maxWidth: rawW };
                return (
                  <th
                    key={colId}
                    className={`group/th relative p-0 align-middle bg-slate-50/80 ${
                      colId === 'item' ? 'inv-col-item' : ''
                    } ${colId === 'buyDate' || colId === 'sellDate' ? 'inv-col-date' : ''} ${
                      colId === 'salePlatform' ? 'inv-col-platform' : ''} ${
                      isDragging ? 'opacity-50' : ''
                    } ${isDragOver ? 'ring-2 ring-inset ring-blue-400' : ''}`}
                    style={thStyle}
                    onDragOver={canDrag ? (e) => onColumnDragOver(e, colId) : undefined}
                    onDrop={canDrag ? (e) => { e.preventDefault(); onColumnDrop(colId); } : undefined}
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
                      className={`flex items-center ${colId === 'item' ? 'justify-start' : 'justify-center'} gap-1 w-full ${listDensity === 'compact' ? 'min-h-[1.35rem]' : 'min-h-[1.65rem]'} ${sortable ? 'cursor-pointer hover:bg-slate-100/90' : ''}`}
                    >
                      {canDrag && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', colId);
                            onColumnDragStart(colId);
                          }}
                          onDragEnd={onColumnDragEnd}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 px-0.5 opacity-0 group-hover/th:opacity-100 transition-opacity"
                          title="Drag to reorder column"
                          aria-label={`Drag to reorder ${ALL_COLUMNS.find((c) => c.id === colId)?.label || colId}`}
                        >
                          <GripVertical size={12} />
                        </span>
                      )}
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
                        <span className="flex items-center justify-center gap-1 truncate" title="Parse tech specs with AI">
                          <Sparkles size={12} className="text-amber-500" /> Parse
                        </span>
                      ) : colId === 'timeGauge' ? (
                        <span
                          className="flex items-center justify-center gap-1 w-full truncate"
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
                        title="Drag to resize name column · double-click to reset"
                        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize z-20 shrink-0 group/resize"
                        onMouseDown={(e) => handleColumnResizeStart(e, colId)}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onResetItemColumnWidth();
                        }}
                      >
                        <span className="absolute right-[4px] top-1 bottom-1 w-px bg-slate-300 group-hover/resize:bg-blue-500 group-active/resize:bg-blue-600" />
                      </div>
                    )}
                  </th>
                );
              })}
              {itemLocked ? <th className="inv-col-soak p-0 bg-slate-50/80" aria-hidden /> : null}
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
            collapsedBundles={collapsedBundles}
            soakSpacer={itemLocked}
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

