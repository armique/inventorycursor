import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  AlertCircle, CheckCircle2,
  History, Plus, Search, RefreshCw, Receipt, Package,
} from 'lucide-react';
import { CustomerInfo, InventoryItem, ItemStatus, TaxMode } from '../types';
import { buildCostOrigin } from '../utils/costOrigin';
import FilamentStockPanel from './FilamentStockPanel';
import { ThreeDPrintAdminSettings } from './ThreeDPrintCalculatorPanel';
import ThreeDPrintQuoteSummary from './ThreeDPrintQuoteSummary';
import ThreeDPrintQueueBar from './ThreeDPrintQueueBar';
import { COCKPIT_STEPS, ThreeDPrintCockpitFooter, ThreeDPrintCockpitRail } from './ThreeDPrintCockpit';
import { useUndoToastContext } from '../context/UndoToastContext';
import { undoFilamentUsageForItem } from '../services/filamentStock';
import {
  getRemainingGrams,
  gramsToKgDisplay,
  loadFilamentStock,
  recordFilamentUsage,
  spoolLabel,
  colorToDotStyle,
  type FilamentSpool,
} from '../services/filamentStock';
import {
  FILAMENT_COLOR_OPTIONS,
  loadThreeDPrintSettings,
  saveThreeDPrintSettings,
  resolveFilamentPricePerKg,
  type ThreeDPrintCalculatorSettings,
} from '../services/threeDPrintDefaults';
import { calculateThreeDPrintQuote, formatPrintTimeDisplay } from '../utils/threeDPrintCalculator';
import { AddOptionTile } from './addFlowShared';
import { getCategoryIcon } from './categoryIcons';
import { hasEbayToken, fetchEbayOrder } from '../services/ebayService';
import { refreshRecentEbayOrders } from '../services/ebayOrderBackfill';
import { findEbayOrderById, loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { listRecentEbayOrdersForSale, type EbayOrderMatch } from '../utils/ebayOrderMatch';
import { getLinePayout } from '../utils/ebayOrderPayout';
import { calculateSaleProfit } from '../utils/saleProfit';
import { formatEUR } from '../utils/formatMoney';

const FIELD =
  'w-full px-4 py-3 rounded-xl border border-white/10 bg-[#1a2438] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
const LABEL = 'block text-xs font-semibold text-slate-400 mb-1.5';

interface ThreeDPrintPageProps {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  onRemoveItems?: (ids: string[]) => void;
  categories: Record<string, string[]>;
  onAddExpense?: (expense: import('../types').Expense) => void;
  isAdmin?: boolean;
}

const ThreeDPrintPage: React.FC<ThreeDPrintPageProps> = ({ items = [], onSave, onRemoveItems, categories, onAddExpense, isAdmin = false }) => {
  const { showUndo } = useUndoToastContext();

  // Basic Details
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState('Misc');
  const [selectedSubCategory, setSelectedSubCategory] = useState('3D Printed');
  
  // Custom category / subcategory option
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [customSubCategory, setCustomSubCategory] = useState('');

  // Sells Price
  const [plannedSellPrice, setPlannedSellPrice] = useState<string>('');
  const [storeVisible, setStoreVisible] = useState(false);
  const [markAsSoldNow, setMarkAsSoldNow] = useState(false);
  const [soldDate, setSoldDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [orderGrossTotal, setOrderGrossTotal] = useState<string>('');
  const [marketFeeTotal, setMarketFeeTotal] = useState<string>('');
  const [shippingTotal, setShippingTotal] = useState<string>('');
  const [ebayOrderId, setEbayOrderId] = useState<string>('');
  const [ebaySku, setEbaySku] = useState<string>('');
  const [ebayListingId, setEbayListingId] = useState<string>('');
  const [ebayUsername, setEbayUsername] = useState<string>('');
  const [customer, setCustomer] = useState<CustomerInfo>({ name: '', address: '' });
  const [orderSuggestions, setOrderSuggestions] = useState<EbayOrderMatch[]>([]);
  const [orderLookupBusy, setOrderLookupBusy] = useState(false);
  const [orderLookupMsg, setOrderLookupMsg] = useState<string | null>(null);

  // Filament stock + calculator fields
  const initialStock = loadFilamentStock();
  const [selectedSpoolId, setSelectedSpoolId] = useState<string | null>(() => initialStock.spools[0]?.id ?? null);

  const applySpoolToCalculator = useCallback((spool: FilamentSpool | null) => {
    if (!spool) return;
    setSelectedSpoolId(spool.id);
    setFilamentType(spool.type);
    setFilamentColor(spool.color);
    setFilamentPrice(spool.pricePerKg);
  }, []);

  const [filamentType, setFilamentType] = useState<string>(() => initialStock.spools[0]?.type || 'PLA');
  const [filamentColor, setFilamentColor] = useState<string>(() => initialStock.spools[0]?.color || 'Black');
  const [filamentWeight, setFilamentWeight] = useState<number>(100);
  const [filamentPrice, setFilamentPrice] = useState<number>(() => initialStock.spools[0]?.pricePerKg || 13);
  const [printTimeHours, setPrintTimeHours] = useState<number>(4);
  const [calcSettings, setCalcSettings] = useState<ThreeDPrintCalculatorSettings>(() => loadThreeDPrintSettings());
  const [cockpitStep, setCockpitStep] = useState(0);
  const [stockOpen, setStockOpen] = useState(false);

  const handleCalcSettingsChange = useCallback((next: ThreeDPrintCalculatorSettings) => {
    setCalcSettings(next);
    saveThreeDPrintSettings(next);
  }, []);

  const catalogFilamentPrice = useMemo(
    () => resolveFilamentPricePerKg(calcSettings, filamentType, filamentColor),
    [calcSettings, filamentType, filamentColor],
  );

  useEffect(() => {
    if (selectedSpoolId) return;
    setFilamentPrice(catalogFilamentPrice);
  }, [catalogFilamentPrice, selectedSpoolId]);

  const [stockRevision, setStockRevision] = useState(0);
  useEffect(() => {
    const onStock = () => setStockRevision((v) => v + 1);
    window.addEventListener('filament-stock-updated', onStock);
    return () => window.removeEventListener('filament-stock-updated', onStock);
  }, []);

  const selectedSpool = useMemo(() => {
    if (!selectedSpoolId) return null;
    return loadFilamentStock().spools.find((s) => s.id === selectedSpoolId) ?? null;
  }, [selectedSpoolId, stockRevision]);

  const allSpools = useMemo(
    () => loadFilamentStock().spools.filter((s) => !s.archived),
    [stockRevision],
  );

  const pendingFilamentGrams = filamentWeight * quantity;

  // --- RECENT PRINTS HISTORY ---
  const recentPrints = useMemo(() => {
    const printedItems = items.filter(
      (item) => item.specs && item.specs['Production Method'] === '3D Printed' && item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED && item.status !== ItemStatus.GIFTED
    );
    const map = new Map<string, InventoryItem>();
    const sorted = [...printedItems].sort((a, b) => {
      const dateA = a.buyDate || '';
      const dateB = b.buyDate || '';
      return dateA.localeCompare(dateB);
    });
    for (const item of sorted) {
      if (item.name) {
        map.set(item.name.toLowerCase(), item);
      }
    }
    return Array.from(map.values()).reverse().slice(0, 10);
  }, [items]);

  const loadFromHistory = (histItem: InventoryItem) => {
    setItemName(histItem.name || '');
    setSelectedCategory(histItem.category || 'Misc');
    setSelectedSubCategory(histItem.subCategory || '3D Printed');
    if (histItem.sellPrice) setPlannedSellPrice(histItem.sellPrice.toString());
    setStoreVisible(!!histItem.storeVisible);
    
    const specs = histItem.specs || {};
    const weightStr = String(specs['Filament Weight'] || '');
    const weightNum = parseFloat(weightStr);
    if (!isNaN(weightNum)) setFilamentWeight(weightNum);
    
    const timeStr = String(specs['Print Time'] || '');
    const hoursMatch = timeStr.match(/(\d+(?:\.\d+)?)\s*h/);
    const minsMatch = timeStr.match(/(\d+)\s*m/);
    if (hoursMatch) {
      const h = parseFloat(hoursMatch[1]);
      const m = minsMatch ? parseInt(minsMatch[1], 10) : 0;
      setPrintTimeHours(h + m / 60);
    }
    
    const fType = String(specs['Filament Type'] || '');
    const fColor = String(specs['Filament Color'] || '');
    const spoolId = String(specs['Filament Spool ID'] || '');
    if (fType) setFilamentType(fType);
    if (fColor) setFilamentColor(fColor);

    const stock = loadFilamentStock();
    const byId = spoolId ? stock.spools.find((s) => s.id === spoolId) : undefined;
    const byMatch = stock.spools.find(
      (s) => s.type.toLowerCase() === fType.toLowerCase() && s.color.toLowerCase() === fColor.toLowerCase()
    );
    const matched = byId || byMatch;
    if (matched) {
      applySpoolToCalculator(matched);
    }
    
    setCockpitStep(1);
    setSuccessMsg(`Pre-filled fields from history for "${histItem.name}"`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Success / Error status messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const filamentPricePerKg = useMemo(
    () => resolveFilamentPricePerKg(calcSettings, filamentType, filamentColor, filamentPrice),
    [calcSettings, filamentType, filamentColor, filamentPrice],
  );

  const quote = useMemo(
    () =>
      calculateThreeDPrintQuote(
        {
          weightG: filamentWeight,
          printTimeHours,
          quantity,
          filamentPricePerKg,
        },
        calcSettings,
      ),
    [filamentWeight, printTimeHours, quantity, filamentPricePerKg, calcSettings],
  );

  const totalProductionCost = useMemo(
    () => (quote.valid ? quote.productionCostPerPart * quantity : 0),
    [quote, quantity],
  );

  const sellPriceNum = parseFloat(plannedSellPrice) || 0;
  const fallbackGrossTotal = quote.valid ? quote.finalPrice : sellPriceNum * quantity;
  const grossTotal = parseFloat(orderGrossTotal) || fallbackGrossTotal;
  const feeTotalNum = Math.max(0, parseFloat(marketFeeTotal) || 0);
  const shippingTotalNum = Math.max(0, parseFloat(shippingTotal) || 0);
  const netAfterMarketplaceTotal = Math.max(0, grossTotal - feeTotalNum - shippingTotalNum);
  const realizedProfitTotal = netAfterMarketplaceTotal - totalProductionCost;
  const realizedMarginPercent = grossTotal > 0 ? (realizedProfitTotal / grossTotal) * 100 : 0;

  const refreshOrderSuggestions = useCallback(() => {
    const seed: InventoryItem = {
      id: '__3d-order-seed__',
      name: itemName.trim(),
      buyPrice: 0,
      buyDate: soldDate || new Date().toISOString().split('T')[0],
      category: selectedCategory || 'Misc',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
      ...(ebaySku.trim() ? { ebaySku: ebaySku.trim() } : {}),
      ...(ebayListingId.trim() ? { ebayListingId: ebayListingId.trim() } : {}),
    };
    const { orders } = loadEbayOrderIndex();
    const list = listRecentEbayOrdersForSale(seed, orders, { days: 60, limit: 12 });
    setOrderSuggestions(list);
    return list;
  }, [itemName, soldDate, selectedCategory, ebaySku, ebayListingId]);

  const applyOrderMatch = useCallback((match: EbayOrderMatch) => {
    const payout = getLinePayout(match.order, match.lineItem);
    setEbayOrderId(match.order.orderId);
    setEbayUsername(match.order.buyer.username || '');
    setCustomer({
      name: match.order.buyer.fullName || '',
      address: match.order.buyer.address || '',
      phone: match.order.buyer.phone,
      email: match.order.buyer.email,
    });
    if (match.order.creationDate) setSoldDate(match.order.creationDate);
    if (match.lineItem.quantity != null && Number.isFinite(match.lineItem.quantity)) {
      setQuantity(Math.max(1, Math.round(match.lineItem.quantity)));
    }
    if (match.lineItem.sku) setEbaySku(match.lineItem.sku);
    if (match.lineItem.listingId) setEbayListingId(match.lineItem.listingId);
    if (payout.gross != null && payout.gross > 0) setOrderGrossTotal(formatEUR(payout.gross));
    if (payout.netKnown && payout.net != null && payout.gross != null && payout.gross > payout.net) {
      setMarketFeeTotal(formatEUR(Math.max(0, payout.gross - payout.net)));
    } else if (payout.fee > 0) {
      setMarketFeeTotal(formatEUR(payout.fee));
    }
    setOrderLookupMsg('Order applied. Verify totals and click Done.');
  }, []);

  const handleLookupEbayOrder = useCallback(async () => {
    if (!markAsSoldNow) return;
    setOrderLookupBusy(true);
    setOrderLookupMsg(null);
    try {
      if (hasEbayToken()) {
        await refreshRecentEbayOrders(45);
      }
      if (ebayOrderId.trim()) {
        const cached = findEbayOrderById(ebayOrderId.trim());
        if (cached) {
          const line = cached.lineItems[0];
          if (line) {
            applyOrderMatch({
              order: cached,
              lineItem: line,
              matchKind: 'recent',
              matchScore: 100,
            });
            setOrderSuggestions(refreshOrderSuggestions());
            return;
          }
        }
        if (hasEbayToken()) {
          const live = await fetchEbayOrder(ebayOrderId.trim());
          setEbayUsername(live.ebayUsername || '');
          setCustomer(live.customer || { name: '', address: '' });
          if (live.sellDate) setSoldDate(live.sellDate);
          if (live.quantity != null && Number.isFinite(live.quantity)) {
            setQuantity(Math.max(1, Math.round(live.quantity)));
          }
          if (live.sellPrice != null && Number.isFinite(live.sellPrice)) {
            setOrderGrossTotal(formatEUR(live.sellPrice));
          }
          setOrderLookupMsg('Order fetched from eBay. Verify totals and click Done.');
        }
      }
      const suggestions = refreshOrderSuggestions();
      if (!suggestions.length && !orderLookupMsg) {
        setOrderLookupMsg('No matching recent eBay orders found. Enter totals manually.');
      }
    } catch (e) {
      setOrderLookupMsg((e as Error)?.message || 'Could not load eBay orders.');
    } finally {
      setOrderLookupBusy(false);
    }
  }, [markAsSoldNow, ebayOrderId, applyOrderMatch, refreshOrderSuggestions, orderLookupMsg]);

  // Handle category changes
  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === 'CUSTOM') {
      setShowCustomCategory(true);
      setSelectedSubCategory('');
    } else {
      setShowCustomCategory(false);
      const subs = categories[cat] || [];
      if (cat === 'Misc' && !subs.includes('3D Printed')) {
        setSelectedSubCategory('3D Printed');
      } else {
        setSelectedSubCategory(subs[0] || '');
      }
    }
  };

  const handleSave = () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation
    if (!itemName.trim()) {
      setErrorMsg('Please enter a print item name.');
      return;
    }
    if (quantity <= 0) {
      setErrorMsg('Quantity must be 1 or more.');
      return;
    }
    if (filamentWeight <= 0 || printTimeHours <= 0) {
      setErrorMsg('Enter model weight and print time greater than zero.');
      return;
    }
    if (!quote.valid) {
      setErrorMsg(Object.values(quote.errors).find(Boolean) || 'Fix calculator inputs before saving.');
      return;
    }
    if (markAsSoldNow) {
      const gross = parseFloat(orderGrossTotal) || 0;
      if (!(gross > 0)) {
        setErrorMsg('Enter gross order total before marking as Done.');
        return;
      }
    }

    const totalGramsNeeded = filamentWeight * quantity;
    if (selectedSpoolId && selectedSpool) {
      const remaining = getRemainingGrams(selectedSpool);
      if (selectedSpool.purchasedGrams > 0 && totalGramsNeeded > remaining + 0.5) {
        setErrorMsg(
          `Not enough filament on ${spoolLabel(selectedSpool)} â€” need ${gramsToKgDisplay(totalGramsNeeded)}, only ${gramsToKgDisplay(remaining)} left.`
        );
        return;
      }
    }

    const categoryToSave = showCustomCategory ? customCategory.trim() : selectedCategory;
    const subCategoryToSave = showCustomCategory ? customSubCategory.trim() : selectedSubCategory;

    if (!categoryToSave) {
      setErrorMsg('Please select or specify a category.');
      return;
    }

    const buyPrice = parseFloat(totalProductionCost.toFixed(2));
    const grossSale = markAsSoldNow
      ? parseFloat(orderGrossTotal) || 0
      : plannedSellPrice.trim()
        ? (parseFloat(plannedSellPrice) || 0) * quantity
        : quote.valid
          ? quote.finalPrice
          : 0;
    const feeTotalNum = markAsSoldNow ? Math.max(0, parseFloat(marketFeeTotal) || 0) : 0;
    const shippingTotalNum = markAsSoldNow ? Math.max(0, parseFloat(shippingTotal) || 0) : 0;
    const sellPrice = grossSale > 0 ? parseFloat(grossSale.toFixed(2)) : undefined;
    const buyDate = new Date().toISOString().split('T')[0];
    const taxMode: TaxMode = 'SmallBusiness';
    const realizedProfit = sellPrice != null
      ? calculateSaleProfit(Math.max(0, sellPrice - shippingTotalNum), buyPrice, feeTotalNum, taxMode)
      : undefined;

    const timestamp = Date.now();
    const uniqueId = `item-3d-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    const createdItems: InventoryItem[] = [
      {
        id: uniqueId,
        name: itemName,
        buyPrice,
        sellPrice,
        buyDate,
        category: categoryToSave,
        subCategory: subCategoryToSave || undefined,
        status: markAsSoldNow ? ItemStatus.SOLD : ItemStatus.IN_STOCK,
        ...(markAsSoldNow ? { sellDate: soldDate || buyDate } : {}),
        comment1: `3D Printed (${filamentType} - ${filamentColor}). Weight: ${filamentWeight}g. Print time: ${formatPrintTimeDisplay(printTimeHours)}.`,
        comment2: `Electricity: ${calcSettings.electricityPricePerKwh}€/kWh (${calcSettings.printerPowerW}W). Printer: ${calcSettings.printerCost}€ over ${calcSettings.printerLifetimeHours}h. Waste: ${calcSettings.wastePct}%. Markup: ${calcSettings.profitMarkupPct}%.${markAsSoldNow ? ` Sold order: gross €${formatEUR(grossSale)} · fee €${formatEUR(feeTotalNum)} · shipping €${formatEUR(shippingTotalNum)} · net €${formatEUR(Math.max(0, grossSale - feeTotalNum - shippingTotalNum))}.` : ''}`,
        printStage: markAsSoldNow ? 'sold' : 'queued',
        buyPaymentType: 'Other',
        ...(markAsSoldNow ? { paymentType: 'ebay.de' as const, platformSold: 'ebay.de' as const } : {}),
        ...(markAsSoldNow && sellPrice != null ? { profit: parseFloat(realizedProfit.toFixed(2)) } : {}),
        ...(markAsSoldNow ? { hasFee: feeTotalNum > 0, feeAmount: feeTotalNum } : {}),
        ...(markAsSoldNow && shippingTotalNum > 0 ? { sellerPaidShipping: true, sellerShippingAmount: shippingTotalNum } : {}),
        ...(markAsSoldNow && ebayOrderId.trim() ? { ebayOrderId: ebayOrderId.trim() } : {}),
        ...(markAsSoldNow && ebayUsername.trim() ? { ebayUsername: ebayUsername.trim() } : {}),
        ...(markAsSoldNow && ebaySku.trim() ? { ebaySku: ebaySku.trim() } : {}),
        ...(markAsSoldNow && ebayListingId.trim() ? { ebayListingId: ebayListingId.trim() } : {}),
        ...(markAsSoldNow && (customer.name || customer.address || customer.phone || customer.email) ? { customer } : {}),
        presence: 'present',
        isDraft: false,
        storeVisible: storeVisible && sellPrice !== undefined,
        quantity,
        costOrigin: buildCostOrigin({
          kind: 'print_3d',
          addedAs: '3D print production',
          lotTotalEur: buyPrice,
          allocatedEur: buyPrice,
          allocationMethod: 'calculator_3d',
          siblings: [{ id: uniqueId, name: itemName, allocatedEur: buyPrice }],
          notes: `Filament ${filamentWeight}g ${filamentType} ${filamentColor} · ${formatPrintTimeDisplay(printTimeHours)} · qty ${quantity}`,
        }),
        specs: {
          'Production Method': '3D Printed',
          'Filament Weight': `${filamentWeight}g`,
          'Print Time': formatPrintTimeDisplay(printTimeHours),
          'Printer Model Cost': `${calcSettings.printerCost} €`,
          'Filament Type': filamentType,
          'Filament Color': filamentColor,
          ...(selectedSpoolId ? { 'Filament Spool ID': selectedSpoolId } : {}),
        },
      },
    ];

    try {
      onSave(createdItems);

      if (selectedSpoolId) {
        const stock = loadFilamentStock();
        const { error } = recordFilamentUsage(stock, selectedSpoolId, totalGramsNeeded, {
          kind: 'print',
          inventoryItemId: uniqueId,
          inventoryItemName: itemName.trim(),
          note: `${quantity}× @ ${filamentWeight}g`,
        });
        if (error) {
          setErrorMsg(`Item saved but stock deduction failed: ${error}`);
          return;
        }
      }

      setSuccessMsg(markAsSoldNow
        ? 'Done — order moved to Sold. Undo if that was a mistake.'
        : `Added ${quantity} item(s) to inventory. Stay here or undo.`);
      showUndo(markAsSoldNow ? 'Print saved as sold' : 'Print added to inventory', () => {
        onRemoveItems?.([uniqueId]);
        undoFilamentUsageForItem(uniqueId);
        setSuccessMsg('Print & Add undone.');
      });
      
      // Reset basic inputs but preserve calculator setup for next print
      setItemName('');
      setQuantity(1);
      setPlannedSellPrice('');
      setOrderGrossTotal('');
      setMarketFeeTotal('');
      setShippingTotal('');
      setEbayOrderId('');
      setOrderSuggestions([]);
      setOrderLookupMsg(null);
      setMarkAsSoldNow(false);
      setStoreVisible(false);
      setCockpitStep(0);

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save items.');
    }
  };

  const currentCategoryList = Object.keys(categories);
  const materials = calcSettings.materials.length > 0
    ? calcSettings.materials
    : [{ key: 'PLA', label: 'PLA', pricePerKg: 13 }];

  const jobSummary = itemName.trim() || (isAdmin ? 'Name this print' : 'New quote');
  const printSummary = `${filamentWeight}g / ${printTimeHours}h / qty ${quantity}`;
  const materialSummary = selectedSpool
    ? `${spoolLabel(selectedSpool)} · ${gramsToKgDisplay(getRemainingGrams(selectedSpool))} left`
    : `${filamentType} · ${filamentColor}`;
  const checkoutSummary = sellPriceNum > 0
    ? `€${sellPriceNum.toFixed(2)} / part`
    : quote.valid
      ? `€${quote.finalPrice.toFixed(2)} recommended`
      : 'Set price';

  const printStepValid = filamentWeight > 0 && printTimeHours > 0 && quantity >= 1;
  const canContinue =
    cockpitStep === 0
      ? !isAdmin || Boolean(itemName.trim())
      : cockpitStep === 1
        ? printStepValid
        : true;

  const goNext = () => {
    if (cockpitStep === 3) {
      if (isAdmin) handleSave();
      return;
    }
    if (!canContinue) {
      if (cockpitStep === 0) setErrorMsg('Please enter a print item name.');
      if (cockpitStep === 1) setErrorMsg('Enter model weight and print time greater than zero.');
      return;
    }
    setErrorMsg(null);
    setCockpitStep((s) => Math.min(3, s + 1));
  };

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col animate-in fade-in">
      {errorMsg && (
        <div className="shrink-0 mx-2 mt-2 p-3 rounded-2xl bg-red-500/15 border border-red-400/30 text-red-100 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold">{errorMsg}</p>
        </div>
      )}
      {successMsg && (
        <div className="shrink-0 mx-2 mt-2 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-100 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold">{successMsg}</p>
        </div>
      )}
      {isAdmin && <ThreeDPrintQueueBar items={items} onUpdate={onSave} />}

      <div className="flex-1 min-h-0 rounded-2xl bg-[#0e1524] text-slate-100 border border-white/10 overflow-hidden flex flex-col">
      <div className="grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)_20rem] gap-6 items-stretch p-5 sm:p-6 flex-1 min-h-0 overflow-auto">
        <ThreeDPrintCockpitRail
          step={cockpitStep}
          summaries={[jobSummary, printSummary, materialSummary, checkoutSummary]}
          onSelect={setCockpitStep}
        />

        <div className="min-w-0">
          <div className="space-y-5">
            {cockpitStep === 0 && (
              <>
                <h2 className="text-2xl font-semibold text-white">Job</h2>
                <p className="text-sm text-slate-400">What are you printing?</p>

                {isAdmin && recentPrints.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <History size={12} /> Repeat a print
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {recentPrints.map((histItem) => {
                        const specs = histItem.specs || {};
                        return (
                          <button
                            key={histItem.id}
                            type="button"
                            onClick={() => loadFromHistory(histItem)}
                            className="px-3 py-2 rounded-2xl border border-white/10 bg-[#1a2438] hover:border-brand-400 text-left text-xs font-semibold"
                          >
                            <span className="block text-white">{histItem.name}</span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {specs['Filament Type'] || 'PLA'} Â· {specs['Filament Weight'] || 'â€”'} Â· {specs['Print Time'] || 'â€”'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isAdmin ? (
                  <div className="space-y-4">
                    <div>
                      <label className={LABEL}>Item name *</label>
                      <input
                        type="text"
                        placeholder="e.g. GPU Anti-Sag Bracket"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        className={FIELD}
                      />
                    </div>

                    {!showCustomCategory ? (
                      <>
                        <div className="space-y-2">
                          <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 px-1">
                            Category
                          </label>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2">
                            {currentCategoryList.map((cat) => {
                              const Icon = getCategoryIcon(cat);
                              return (
                                <AddOptionTile
                                  key={cat}
                                  size="sm"
                                  label={cat}
                                  icon={<Icon size={18} strokeWidth={1.75} />}
                                  selected={selectedCategory === cat}
                                  dimmed={Boolean(selectedCategory) && selectedCategory !== 'CUSTOM' && selectedCategory !== cat}
                                  onClick={() => handleCategoryChange(cat)}
                                />
                              );
                            })}
                            <AddOptionTile
                              size="sm"
                              label="Custom"
                              hint="New category"
                              icon={<Plus size={18} strokeWidth={1.75} />}
                              selected={showCustomCategory}
                              dimmed={Boolean(selectedCategory) && !showCustomCategory}
                              onClick={() => handleCategoryChange('CUSTOM')}
                            />
                          </div>
                        </div>
                        {selectedCategory && !showCustomCategory && (
                          <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 px-1">
                              Subcategory
                            </label>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2">
                              {selectedCategory === 'Misc' &&
                                !categories['Misc']?.includes('3D Printed') && (
                                  <AddOptionTile
                                    size="sm"
                                    label="3D Printed"
                                    icon={React.createElement(getCategoryIcon('3D Printed'), {
                                      size: 18,
                                      strokeWidth: 1.75,
                                    })}
                                    selected={selectedSubCategory === '3D Printed'}
                                    dimmed={Boolean(selectedSubCategory) && selectedSubCategory !== '3D Printed'}
                                    onClick={() => setSelectedSubCategory('3D Printed')}
                                  />
                                )}
                              {(categories[selectedCategory] || []).map((sub) => {
                                const Icon = getCategoryIcon(sub);
                                return (
                                  <AddOptionTile
                                    key={sub}
                                    size="sm"
                                    label={sub}
                                    icon={<Icon size={18} strokeWidth={1.75} />}
                                    selected={selectedSubCategory === sub}
                                    dimmed={Boolean(selectedSubCategory) && selectedSubCategory !== sub}
                                    onClick={() => setSelectedSubCategory(sub)}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                        <div className="sm:col-span-2 flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-600">Custom category</span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowCustomCategory(false);
                              setSelectedCategory('Misc');
                              setSelectedSubCategory('3D Printed');
                            }}
                            className="text-xs text-brand-600 font-bold hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Category"
                          value={customCategory}
                          onChange={(e) => setCustomCategory(e.target.value)}
                          className={`${FIELD} bg-white`}
                        />
                        <input
                          type="text"
                          placeholder="Subcategory"
                          value={customSubCategory}
                          onChange={(e) => setCustomSubCategory(e.target.value)}
                          className={`${FIELD} bg-white`}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-300">
                    Enter print details next. Estimated price updates as you go.
                  </p>
                )}
              </>
            )}

            {cockpitStep === 1 && (
              <>
                <h2 className="text-2xl font-semibold text-white">Print</h2>
                <p className="text-sm text-slate-400">Weight, machine time, and how many copies.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL}>Model weight (g)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={filamentWeight}
                      onChange={(e) => setFilamentWeight(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={FIELD}
                    />
                    {quote.errors.weightG && (
                      <p className="mt-1 text-[11px] font-semibold text-red-600">{quote.errors.weightG}</p>
                    )}
                  </div>
                  <div>
                    <label className={LABEL}>Print time (hours)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={printTimeHours}
                      onChange={(e) => setPrintTimeHours(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={FIELD}
                    />
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      {formatPrintTimeDisplay(printTimeHours)}
                    </p>
                    {quote.errors.printTimeHours && (
                      <p className="mt-0.5 text-[11px] font-semibold text-red-600">{quote.errors.printTimeHours}</p>
                    )}
                  </div>
                  <div>
                    <label className={LABEL}>Quantity</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className={FIELD}
                    />
                  </div>
                </div>
              </>
            )}

            {cockpitStep === 2 && (
              <>
                <h2 className="text-2xl font-semibold text-white">Material</h2>
                <p className="text-sm text-slate-400">Select filament for this print.</p>

                <div>
                  <label className={LABEL}>Material</label>
                  <select
                    value={filamentType}
                    onChange={(e) => {
                      const key = e.target.value;
                      setFilamentType(key);
                      if (!selectedSpoolId) {
                        setFilamentPrice(resolveFilamentPricePerKg(calcSettings, key, filamentColor));
                      }
                    }}
                    className={`${FIELD} font-semibold max-w-xs`}
                  >
                    {materials.map((m) => (
                      <option key={m.key} value={m.key}>{m.label} · €{m.pricePerKg.toFixed(2)}/kg</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">Spool</p>
                  {allSpools.length === 0 && (
                    <div className="space-y-2">
                      {FILAMENT_COLOR_OPTIONS.map((c) => {
                        const selected = filamentColor === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setFilamentColor(c)}
                            className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-3 text-left ${
                              selected
                                ? 'border-brand-500 bg-[#1a2740] ring-1 ring-brand-500/40'
                                : 'border-white/10 bg-[#151d2e] hover:border-white/20'
                            }`}
                          >
                            <span
                              className="w-12 h-12 rounded-xl border border-white/10 shrink-0"
                              style={{ background: c === 'Black' ? '#1e293b' : '#f1f5f9' }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white">{filamentType} {c}</p>
                              <p className="text-[11px] text-slate-400">Ø 1.75 mm</p>
                            </div>
                            <span className={`w-4 h-4 rounded-full border-2 ${selected ? 'border-brand-500 bg-brand-500' : 'border-slate-500'}`} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {allSpools.map((spool) => {
                    const selected = selectedSpoolId === spool.id;
                    const remaining = getRemainingGrams(spool);
                    const fill = colorToDotStyle(spool.color);
                    return (
                      <button
                        key={spool.id}
                        type="button"
                        onClick={() => applySpoolToCalculator(spool)}
                        className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-3 text-left ${
                          selected
                            ? 'border-brand-500 bg-[#1a2740] ring-1 ring-brand-500/40'
                            : 'border-white/10 bg-[#151d2e] hover:border-white/20'
                        }`}
                      >
                        <span
                          className="w-12 h-12 rounded-xl border border-white/10 shrink-0"
                          style={{ background: fill }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {spool.type} {spool.color}
                          </p>
                          <p className="text-[11px] text-slate-400">Ø 1.75 mm · €{spool.pricePerKg.toFixed(2)}/kg</p>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
                          remaining < pendingFilamentGrams ? 'bg-amber-400/20 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'
                        }`}>
                          {gramsToKgDisplay(remaining)}
                        </span>
                        <span className={`w-4 h-4 rounded-full border-2 ${selected ? 'border-brand-500 bg-brand-500' : 'border-slate-500'}`} />
                      </button>
                    );
                  })}
                  {isAdmin && allSpools.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSpoolId(null);
                      }}
                      className={`w-full text-left rounded-2xl border px-3 py-2.5 text-xs font-semibold ${
                        !selectedSpoolId ? 'border-brand-500 text-white' : 'border-white/10 text-slate-400'
                      }`}
                    >
                      No spool — price only, no stock deduction
                    </button>
                  )}
                </div>

                <div className="flex items-start gap-3 rounded-2xl bg-[#151d2e] border border-white/10 px-3 py-3 text-[12px] text-slate-400">
                  <Package size={16} className="text-brand-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>Not seeing the right spool? Only stocked filament is listed.</p>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setStockOpen((v) => !v)}
                        className="mt-1 text-brand-400 font-semibold hover:text-brand-300"
                      >
                        {stockOpen ? 'Hide inventory' : 'Manage inventory'}
                      </button>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="space-y-3">
                    <div>
                      <label className={LABEL}>Filament price (€ / kg)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={filamentPricePerKg}
                        onChange={(e) => setFilamentPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                        className={FIELD}
                      />
                    </div>
                    {stockOpen && (
                      <div className="rounded-2xl overflow-hidden bg-white text-slate-900">
                        <FilamentStockPanel
                          selectedSpoolId={selectedSpoolId}
                          onSelectSpool={applySpoolToCalculator}
                          pendingGrams={pendingFilamentGrams}
                          onAddExpense={onAddExpense}
                        />
                      </div>
                    )}
                    <div className="rounded-2xl overflow-hidden bg-white text-slate-900">
                      <ThreeDPrintAdminSettings settings={calcSettings} onSettingsChange={handleCalcSettingsChange} />
                    </div>
                  </div>
                )}
              </>
            )}
            {cockpitStep === 3 && (
              <>
                <h2 className="text-2xl font-semibold text-white">Checkout</h2>
                <p className="text-sm text-slate-400">Your charged price vs the recommended quote.</p>
                <div>
                  <label className={LABEL}>Price charged (€ / part)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={plannedSellPrice}
                    onChange={(e) => setPlannedSellPrice(e.target.value.replace(',', '.'))}
                    placeholder={quote.valid ? quote.effectivePricePerPart.toFixed(2) : 'e.g. 12.00'}
                    className={FIELD}
                  />
                  {quote.valid && !plannedSellPrice.trim() && (
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      Leave empty to use recommended €{quote.finalPrice.toFixed(2)} total on save.
                    </p>
                  )}
                </div>

                {isAdmin && (
                  <div className="space-y-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={markAsSoldNow}
                        onChange={(e) => setMarkAsSoldNow(e.target.checked)}
                        className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4"
                      />
                          <span className="text-xs font-semibold text-slate-200">Finish this order now and send directly to Sold</span>
                    </label>

                    {markAsSoldNow && (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-black uppercase tracking-widest text-blue-700 flex items-center gap-1">
                            <Receipt size={13} />
                            eBay order parse
                          </h3>
                          <button
                            type="button"
                            onClick={handleLookupEbayOrder}
                            disabled={orderLookupBusy}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                          >
                            {orderLookupBusy ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                            Parse order
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input type="text" placeholder="eBay order ID (optional)" value={ebayOrderId} onChange={(e) => setEbayOrderId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="date" value={soldDate} onChange={(e) => setSoldDate(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="SKU (optional)" value={ebaySku} onChange={(e) => setEbaySku(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="Listing ID (optional)" value={ebayListingId} onChange={(e) => setEbayListingId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="Gross order total (€)" value={orderGrossTotal} onChange={(e) => setOrderGrossTotal(e.target.value.replace(',', '.'))} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="eBay fees total (€)" value={marketFeeTotal} onChange={(e) => setMarketFeeTotal(e.target.value.replace(',', '.'))} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="Shipping you paid (€)" value={shippingTotal} onChange={(e) => setShippingTotal(e.target.value.replace(',', '.'))} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                          <input type="text" placeholder="Buyer username" value={ebayUsername} onChange={(e) => setEbayUsername(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm" />
                        </div>
                        {orderLookupMsg && <p className="text-[11px] text-blue-700 font-semibold">{orderLookupMsg}</p>}
                        {orderSuggestions.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-black">Recent matched orders</p>
                            <div className="max-h-40 overflow-auto space-y-1">
                              {orderSuggestions.map((s, idx) => (
                                <button
                                  key={`${s.order.orderId}-${idx}`}
                                  type="button"
                                  onClick={() => applyOrderMatch(s)}
                                  className="w-full text-left rounded-lg border border-blue-200 bg-white px-2.5 py-2 hover:bg-blue-100"
                                >
                                  <div className="text-[11px] font-bold text-slate-800 truncate">
                                    {s.order.orderId} · {s.lineItem.title}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    {s.order.creationDate || 'date n/a'} · {s.lineItem.sku || 'no sku'}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {plannedSellPrice && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={storeVisible}
                          onChange={(e) => setStoreVisible(e.target.checked)}
                          className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4"
                        />
                        <span className="text-xs font-semibold text-slate-200">Show in public storefront immediately</span>
                      </label>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-2 min-h-0 h-full">
          <ThreeDPrintQuoteSummary
            quote={quote}
            isAdmin={isAdmin}
            chargedPricePerPart={sellPriceNum > 0 ? sellPriceNum : null}
            productionCostTotal={totalProductionCost}
            showStockHint={
              selectedSpool && pendingFilamentGrams > 0 ? (
                <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-white/10">
                  <span>Stock use ({quantity}× {filamentWeight}g)</span>
                  <span className="font-mono font-bold">−{gramsToKgDisplay(pendingFilamentGrams)}</span>
                </div>
              ) : undefined
            }
          >
            {isAdmin && quote.valid && (
              <button
                type="button"
                onClick={() => {
                  setPlannedSellPrice(quote.effectivePricePerPart.toFixed(2));
                  setCockpitStep(3);
                }}
                className="w-full py-2.5 rounded-xl border border-white/10 text-[12px] font-semibold text-slate-200 hover:bg-white/5"
              >
                Use recommended price per part
              </button>
            )}

            {markAsSoldNow && grossTotal > 0 && (
              <div className="border-t border-white/10 pt-4 space-y-2 text-sm">
                <p className="text-[11px] font-semibold text-slate-500">Sold-order margin</p>
                <div className="flex justify-between"><span className="text-slate-400">Gross</span><span className="font-mono">€{formatEUR(grossTotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Fees</span><span className="font-mono">-€{formatEUR(feeTotalNum)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Shipping</span><span className="font-mono">-€{formatEUR(shippingTotalNum)}</span></div>
                <div className="flex justify-between text-white font-semibold pt-2 border-t border-white/10"><span>Clean profit</span><span className="font-mono text-emerald-400">€{formatEUR(realizedProfitTotal)}</span></div>
              </div>
            )}
          </ThreeDPrintQuoteSummary>
        </div>
      </div>

          <ThreeDPrintCockpitFooter
            step={cockpitStep}
            total={COCKPIT_STEPS.length}
            continueLabel={
              cockpitStep < 3
                ? 'Continue'
                : isAdmin
                  ? markAsSoldNow
                    ? 'Done · Move to Sold'
                    : 'Print & Add to Inventory'
                  : 'Done'
            }
            disableContinue={cockpitStep < 3 && !canContinue}
            onBack={() => {
              setErrorMsg(null);
              setCockpitStep((s) => Math.max(0, s - 1));
            }}
            onContinue={goNext}
          />
      </div>
    </div>
  );
};

export default ThreeDPrintPage;
