import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Printer, ArrowLeft, Save, AlertCircle, CheckCircle2,
  Layers, ShieldAlert, History, Plus, Search, RefreshCw, Receipt,
} from 'lucide-react';
import { CustomerInfo, InventoryItem, ItemStatus, TaxMode } from '../types';
import FilamentStockPanel from './FilamentStockPanel';
import ThreeDPrintCalculatorPanel from './ThreeDPrintCalculatorPanel';
import ThreeDPrintQuoteSummary from './ThreeDPrintQuoteSummary';
import {
  getRemainingGrams,
  gramsToKgDisplay,
  loadFilamentStock,
  recordFilamentUsage,
  spoolLabel,
  type FilamentSpool,
} from '../services/filamentStock';
import {
  loadThreeDPrintSettings,
  saveThreeDPrintSettings,
  resolveFilamentPricePerKg,
  type ThreeDPrintCalculatorSettings,
} from '../services/threeDPrintDefaults';
import { calculateThreeDPrintQuote, formatPrintTimeDisplay } from '../utils/threeDPrintCalculator';
import { AddFlowStepHeader, AddOptionTile } from './addFlowShared';
import { getCategoryIcon } from './categoryIcons';
import { hasEbayToken, fetchEbayOrder } from '../services/ebayService';
import { refreshRecentEbayOrders } from '../services/ebayOrderBackfill';
import { findEbayOrderById, loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { listRecentEbayOrdersForSale, type EbayOrderMatch } from '../utils/ebayOrderMatch';
import { getLinePayout } from '../utils/ebayOrderPayout';
import { calculateSaleProfit } from '../utils/saleProfit';
import { formatEUR } from '../utils/formatMoney';

interface ThreeDPrintPageProps {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  categories: Record<string, string[]>;
  onAddExpense?: (expense: import('../types').Expense) => void;
  isAdmin?: boolean;
}

const ThreeDPrintPage: React.FC<ThreeDPrintPageProps> = ({ items = [], onSave, categories, onAddExpense, isAdmin = false }) => {
  const navigate = useNavigate();

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

  const handleCalcSettingsChange = useCallback((next: ThreeDPrintCalculatorSettings) => {
    setCalcSettings(next);
    saveThreeDPrintSettings(next);
  }, []);

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
  const profitUnit = sellPriceNum > 0 && quote.valid ? sellPriceNum - quote.productionCostPerPart : 0;
  const profitTotal = profitUnit * quantity;
  const profitMarginPercent = sellPriceNum > 0 ? (profitUnit / sellPriceNum) * 100 : 0;
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
          `Not enough filament on ${spoolLabel(selectedSpool)} — need ${gramsToKgDisplay(totalGramsNeeded)}, only ${gramsToKgDisplay(remaining)} left.`
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
        ? `Done — order moved to Sold with net margin calculation.`
        : `Successfully created ${quantity} item(s) and added them to inventory!`);
      
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

      // Scroll to top to see success msg
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Navigate to inventory after a brief delay
      setTimeout(() => {
        navigate('/panel/inventory');
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save items.');
    }
  };

  const currentCategoryList = Object.keys(categories);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24 animate-in fade-in">
      <AddFlowStepHeader title="3D print" />
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link to="/panel/dashboard" className="text-slate-500 hover:text-slate-800 text-xs font-bold uppercase tracking-wider flex items-center gap-1 mb-1">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <Printer className="text-brand-500" /> 3D Print Manager
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Calculate your production self-cost (себестоимость) and automatically add printed items to your inventory.
          </p>
        </div>
      </header>

      {/* Messages */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold">{errorMsg}</p>
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold">{successMsg}</p>
        </div>
      )}

      {isAdmin && (
        <FilamentStockPanel
          selectedSpoolId={selectedSpoolId}
          onSelectSpool={applySpoolToCalculator}
          pendingGrams={pendingFilamentGrams}
          onAddExpense={onAddExpense}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Inputs (Left) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Section: Re-print from History */}
          {isAdmin && recentPrints.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-250">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
                <History size={18} className="text-brand-500" />
                Quick Re-print from History
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Click on any previously printed item below to instantly fill the form with its settings.
              </p>
              <div className="flex flex-wrap gap-2">
                {recentPrints.map((histItem) => {
                  const specs = histItem.specs || {};
                  const fType = specs['Filament Type'] || 'PLA';
                  const fColor = specs['Filament Color'] || 'Black';
                  return (
                    <button
                      key={histItem.id}
                      type="button"
                      onClick={() => loadFromHistory(histItem)}
                      className="px-3 py-2 rounded-2xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50/10 text-slate-700 hover:text-brand-700 transition-all text-xs font-bold flex flex-col items-start gap-0.5"
                    >
                      <span className="font-extrabold text-slate-900 text-left">{histItem.name}</span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {fType} · {fColor} · {specs['Filament Weight'] || 'Unknown weight'} · {specs['Print Time'] || 'Unknown time'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isAdmin && (
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Layers size={18} className="text-brand-500" />
              1. Item Information
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                  Item Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. GPU Anti-Sag Bracket, Custom Fan Grill"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                  Planned retail price (€ / part)
                </label>
                <input
                  type="text"
                  placeholder={quote.valid ? quote.effectivePricePerPart.toFixed(2) : 'e.g. 19.99'}
                  value={plannedSellPrice}
                  onChange={(e) => setPlannedSellPrice(e.target.value.replace(',', '.'))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
                {quote.valid && !plannedSellPrice.trim() && (
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">
                    Leave empty to use recommended €{quote.finalPrice.toFixed(2)} total on save.
                  </p>
                )}
              </div>

              <div className="sm:col-span-2 flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="markAsSoldNow"
                  checked={markAsSoldNow}
                  onChange={(e) => setMarkAsSoldNow(e.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4"
                />
                <label htmlFor="markAsSoldNow" className="text-xs font-bold text-slate-700 select-none">
                  Finish this order now and send directly to Sold
                </label>
              </div>

              {markAsSoldNow && (
                <div className="sm:col-span-2 mt-2 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
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
                    <input
                      type="text"
                      placeholder="eBay order ID (optional)"
                      value={ebayOrderId}
                      onChange={(e) => setEbayOrderId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="date"
                      value={soldDate}
                      onChange={(e) => setSoldDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="SKU (optional)"
                      value={ebaySku}
                      onChange={(e) => setEbaySku(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Listing ID (optional)"
                      value={ebayListingId}
                      onChange={(e) => setEbayListingId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Gross order total (€)"
                      value={orderGrossTotal}
                      onChange={(e) => setOrderGrossTotal(e.target.value.replace(',', '.'))}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="eBay fees total (€)"
                      value={marketFeeTotal}
                      onChange={(e) => setMarketFeeTotal(e.target.value.replace(',', '.'))}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Shipping you paid (€)"
                      value={shippingTotal}
                      onChange={(e) => setShippingTotal(e.target.value.replace(',', '.'))}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Buyer username"
                      value={ebayUsername}
                      onChange={(e) => setEbayUsername(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm"
                    />
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

              {!showCustomCategory ? (
                <>
                  <div className="sm:col-span-2 space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 px-1">
                      Category
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 sm:gap-2">
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
                  <div className="sm:col-span-2 space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 px-1">
                      Subcategory
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 sm:gap-2">
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
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="sm:col-span-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-600">Custom Category Details</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setShowCustomCategory(false);
                        setSelectedCategory('Misc');
                        setSelectedSubCategory('3D Printed');
                      }}
                      className="text-xs text-brand-600 font-bold hover:underline"
                    >
                      Cancel custom category
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                      Custom Category Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 3D Prints"
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                      Custom Subcategory Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. PLA Parts"
                      value={customSubCategory}
                      onChange={(e) => setCustomSubCategory(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                    />
                  </div>
                </div>
              )}

              {plannedSellPrice && (
                <div className="sm:col-span-2 flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="storeVisible"
                    checked={storeVisible}
                    onChange={(e) => setStoreVisible(e.target.checked)}
                    className="rounded text-brand-600 focus:ring-brand-500 h-4 w-4"
                  />
                  <label htmlFor="storeVisible" className="text-xs font-bold text-slate-600 select-none">
                    Show in public storefront immediately (visible to customers)
                  </label>
                </div>
              )}
            </div>
          </div>
          )}

          <ThreeDPrintCalculatorPanel
            isAdmin={isAdmin}
            settings={calcSettings}
            onSettingsChange={handleCalcSettingsChange}
            weightG={filamentWeight}
            printTimeHours={printTimeHours}
            quantity={quantity}
            materialKey={filamentType}
            color={filamentColor}
            filamentPricePerKg={filamentPricePerKg}
            onWeightGChange={setFilamentWeight}
            onPrintTimeHoursChange={setPrintTimeHours}
            onQuantityChange={setQuantity}
            onMaterialKeyChange={(key) => {
              setFilamentType(key);
            }}
            onColorChange={setFilamentColor}
            onFilamentPriceChange={setFilamentPrice}
            quote={quote}
            spoolSelect={
              isAdmin ? (
              <div className="sm:col-span-2">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                  Active spool (deducts on save)
                </label>
                <select
                  value={selectedSpoolId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setSelectedSpoolId(null);
                      return;
                    }
                    const spool = loadFilamentStock().spools.find((s) => s.id === id);
                    applySpoolToCalculator(spool ?? null);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white font-semibold"
                >
                  <option value="">No spool — price only, no stock deduction</option>
                  {loadFilamentStock().spools.map((spool) => (
                    <option key={spool.id} value={spool.id}>
                      {spoolLabel(spool)} · {gramsToKgDisplay(getRemainingGrams(spool))} left · €
                      {spool.pricePerKg.toFixed(2)}/kg
                    </option>
                  ))}
                </select>
                {selectedSpool && (
                  <p className="text-[11px] text-slate-500 mt-1.5 font-semibold">
                    {gramsToKgDisplay(getRemainingGrams(selectedSpool))} remaining on this spool after prior prints.
                  </p>
                )}
              </div>
              ) : undefined
            }
          />
        </div>

        {/* Breakdown Card (Right) */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
          <ThreeDPrintQuoteSummary
            quote={quote}
            isAdmin={isAdmin}
            showStockHint={
              selectedSpool && pendingFilamentGrams > 0 ? (
                <div className="flex justify-between items-center text-xs text-indigo-300/90 px-1 pt-2 border-t border-slate-800">
                  <span>Stock use ({quantity}× {filamentWeight}g)</span>
                  <span className="font-mono font-bold">−{gramsToKgDisplay(pendingFilamentGrams)}</span>
                </div>
              ) : undefined
            }
          >
            {isAdmin && quote.valid && (
              <div className="border-t border-slate-800 pt-4 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Batch production cost</span>
                  <span className="font-mono text-emerald-400 font-bold">€{totalProductionCost.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPlannedSellPrice(quote.effectivePricePerPart.toFixed(2))}
                  className="w-full py-2 rounded-xl border border-slate-700 text-[11px] font-bold uppercase tracking-widest text-slate-300 hover:bg-slate-800"
                >
                  Use recommended price per part
                </button>
              </div>
            )}

            {parseFloat(plannedSellPrice) > 0 && !markAsSoldNow && quote.valid && (
              <div className="border-t border-slate-800 pt-6 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Margin vs planned retail</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/30 p-3 rounded-2xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block font-black uppercase">Unit profit</span>
                    <span className="text-lg font-black text-white font-mono">€{profitUnit.toFixed(2)}</span>
                  </div>
                  <div className="bg-slate-800/30 p-3 rounded-2xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block font-black uppercase">Margin</span>
                    <span className="text-lg font-black text-white font-mono">{profitMarginPercent.toFixed(1)}%</span>
                  </div>
                </div>
                {quantity > 1 && (
                  <div className="flex justify-between items-center text-sm p-2 rounded-xl bg-slate-800/10 border border-slate-850">
                    <span className="text-slate-450">Estimated total profit</span>
                    <span className="font-mono text-emerald-400 font-bold">€{profitTotal.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {markAsSoldNow && grossTotal > 0 && (
              <div className="border-t border-slate-800 pt-6 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Real sold-order margin</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Gross order</span><span className="font-mono">€{formatEUR(grossTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">eBay fees</span><span className="font-mono">-€{formatEUR(feeTotalNum)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Shipping paid</span><span className="font-mono">-€{formatEUR(shippingTotalNum)}</span></div>
                  <div className="flex justify-between border-t border-slate-800 pt-2"><span className="text-slate-300 font-bold">Net after marketplace</span><span className="font-mono font-bold text-emerald-300">€{formatEUR(netAfterMarketplaceTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Production cost (batch)</span><span className="font-mono">-€{formatEUR(totalProductionCost)}</span></div>
                  <div className="flex justify-between border-t border-slate-800 pt-2"><span className="text-slate-200 font-black">Clean profit</span><span className="font-mono font-black text-emerald-400">€{formatEUR(realizedProfitTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Margin</span><span className="font-mono">{realizedMarginPercent.toFixed(1)}%</span></div>
                </div>
              </div>
            )}

            {isAdmin && (
            <button
              type="button"
              onClick={handleSave}
              className="w-full py-4 px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-black uppercase tracking-widest text-xs transition-all shadow-lg hover:shadow-brand-500/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Save size={16} />
              {markAsSoldNow ? 'Done · Move to Sold' : 'Print & Add to Inventory'}
            </button>
            )}
          </ThreeDPrintQuoteSummary>

          {isAdmin && (
            <div className="bg-amber-50/50 border border-amber-200/50 rounded-3xl p-5 text-xs text-amber-900 flex gap-3 items-start">
              <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Calculator defaults</p>
                <p className="text-amber-800 leading-relaxed">
                  Admin settings (electricity, depreciation, markup, discounts) are saved in this browser and used for every quote. Machine time always affects price through electricity and printer wear — not weight alone.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreeDPrintPage;
