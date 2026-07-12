import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Printer, ArrowLeft, Save, AlertCircle, CheckCircle2,
  Layers, Zap, Gauge, ShieldAlert, History,
} from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import FilamentStockPanel from './FilamentStockPanel';
import {
  getRemainingGrams,
  gramsToKgDisplay,
  loadFilamentStock,
  recordFilamentUsage,
  spoolLabel,
  type FilamentSpool,
} from '../services/filamentStock';

interface ThreeDPrintPageProps {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  categories: Record<string, string[]>;
  onAddExpense?: (expense: import('../types').Expense) => void;
}

const ThreeDPrintPage: React.FC<ThreeDPrintPageProps> = ({ items = [], onSave, categories, onAddExpense }) => {
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
    const hoursMatch = timeStr.match(/(\d+)h/);
    const minsMatch = timeStr.match(/(\d+)m/);
    if (hoursMatch) setPrintHours(parseInt(hoursMatch[1]));
    if (minsMatch) setPrintMinutes(parseInt(minsMatch[1]));
    
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
    
    const comment2 = histItem.comment2 || '';
    const printerCostMatch = comment2.match(/Printer: ([\d.]+)€/);
    if (printerCostMatch) setPrinterCost(parseFloat(printerCostMatch[1]));
    
    const lifespanMatch = comment2.match(/over (\d+)h/);
    if (lifespanMatch) setPrinterLifespan(parseInt(lifespanMatch[1]));
    
    const powerMatch = comment2.match(/\((\d+)W\)/);
    if (powerMatch) setPrinterPower(parseInt(powerMatch[1]));
    
    const electMatch = comment2.match(/Electricity: ([\d.]+)€\/kWh/);
    if (electMatch) setElectricityPrice(parseFloat(electMatch[1]));
    
    const failMatch = comment2.match(/Fail margin: ([\d.]+)%/);
    if (failMatch) setFailMargin(parseFloat(failMatch[1]));
    
    setSuccessMsg(`Pre-filled fields from history for "${histItem.name}"`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Printer Settings
  const [printerCost, setPrinterCost] = useState<number>(300); // €
  const [printerLifespan, setPrinterLifespan] = useState<number>(3000); // expected printing hours
  const [printHours, setPrintHours] = useState<number>(4);
  const [printMinutes, setPrintMinutes] = useState<number>(0);

  // Electricity Settings
  const [printerPower, setPrinterPower] = useState<number>(150); // Watts
  const [electricityPrice, setElectricityPrice] = useState<number>(0.34); // €/kWh (Bavaria default)

  // Overhead & Adjustments
  const [failMargin, setFailMargin] = useState<number>(10); // % buffer for failed prints
  const [laborCost, setLaborCost] = useState<number>(0); // manual labor per print (post-processing/assembly)

  // Success / Error status messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Calculate values
  const calculations = useMemo(() => {
    const totalHours = printHours + printMinutes / 60;
    
    // Filament Cost: weight (g) * price per kg / 1000
    const filamentCostUnit = (filamentWeight / 1000) * filamentPrice;
    
    // Electricity Cost: hours * power (kW) * price per kWh
    const electricityCostUnit = totalHours * (printerPower / 1000) * electricityPrice;
    
    // Depreciation: hours * printer price / lifespan hours
    const depreciationCostUnit = totalHours * (printerCost / printerLifespan);
    
    // Base Subtotal (without fail rate margin)
    const baseSubtotalUnit = filamentCostUnit + electricityCostUnit + depreciationCostUnit + laborCost;
    
    // Fail Margin Amount
    const failCostUnit = baseSubtotalUnit * (failMargin / 100);
    
    // Final Unit Self-Cost (Production Cost)
    const finalUnitCost = baseSubtotalUnit + failCostUnit;
    
    // Total production cost for all prints
    const totalProductionCost = finalUnitCost * quantity;
    
    // Profit Calculation
    const sellPriceNum = parseFloat(plannedSellPrice) || 0;
    const profitUnit = sellPriceNum > 0 ? sellPriceNum - finalUnitCost : 0;
    const profitTotal = profitUnit * quantity;
    const profitMarginPercent = sellPriceNum > 0 ? (profitUnit / sellPriceNum) * 100 : 0;

    return {
      totalHours,
      filamentCostUnit,
      electricityCostUnit,
      depreciationCostUnit,
      baseSubtotalUnit,
      failCostUnit,
      finalUnitCost,
      totalProductionCost,
      profitUnit,
      profitTotal,
      profitMarginPercent
    };
  }, [
    filamentWeight, filamentPrice, printerCost, printerLifespan, 
    printHours, printMinutes, printerPower, electricityPrice, 
    failMargin, laborCost, quantity, plannedSellPrice
  ]);

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
    if (filamentWeight < 0 || printHours < 0 || printMinutes < 0) {
      setErrorMsg('Weights, hours, and minutes cannot be negative.');
      return;
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

    const buyPrice = parseFloat(calculations.finalUnitCost.toFixed(2));
    const sellPrice = plannedSellPrice ? parseFloat(plannedSellPrice) : undefined;
    const buyDate = new Date().toISOString().split('T')[0];

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
        status: ItemStatus.IN_STOCK,
        comment1: `3D Printed (${filamentType} - ${filamentColor}). Weight: ${filamentWeight}g. Print time: ${printHours}h ${printMinutes}m.`,
        comment2: `Electricity: ${electricityPrice}€/kWh (${printerPower}W). Printer: ${printerCost}€ over ${printerLifespan}h. Fail margin: ${failMargin}%.`,
        buyPaymentType: 'Other',
        presence: 'present',
        isDraft: false,
        storeVisible: storeVisible && sellPrice !== undefined,
        quantity,
        specs: {
          'Production Method': '3D Printed',
          'Filament Weight': `${filamentWeight}g`,
          'Print Time': `${printHours}h ${printMinutes}m`,
          'Printer Model Cost': `${printerCost} €`,
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

      setSuccessMsg(`Successfully created ${quantity} item(s) and added them to inventory!`);
      
      // Reset basic inputs but preserve calculator setup for next print
      setItemName('');
      setQuantity(1);
      setPlannedSellPrice('');
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

      <FilamentStockPanel
        selectedSpoolId={selectedSpoolId}
        onSelectSpool={applySpoolToCalculator}
        pendingGrams={pendingFilamentGrams}
        onAddExpense={onAddExpense}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Inputs (Left) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Section: Re-print from History */}
          {recentPrints.length > 0 && (
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

          {/* Section 1: Print Item Basic Details */}
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

              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                  Quantity to Add
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                  Planned Retail Price (€)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 19.99"
                  value={plannedSellPrice}
                  onChange={(e) => setPlannedSellPrice(e.target.value.replace(',', '.'))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              {!showCustomCategory ? (
                <>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                      Category
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                    >
                      {currentCategoryList.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="CUSTOM">+ Add Custom Category</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-1">
                      Subcategory
                    </label>
                    <select
                      value={selectedSubCategory}
                      onChange={(e) => setSelectedSubCategory(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                    >
                      {selectedCategory === 'Misc' && !categories['Misc']?.includes('3D Printed') && (
                        <option value="3D Printed">3D Printed</option>
                      )}
                      {(categories[selectedCategory] || []).map((sub) => (
                        <option key={sub} value={sub}>{sub}</option>
                      ))}
                    </select>
                  </div>
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

          {/* Section 2: Calculator Cost Variables */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Zap size={18} className="text-yellow-500" />
              2. Cost Parameters
            </h2>

            {/* Filament */}
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Material (Filament)</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-600 mb-1">
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
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white font-semibold text-slate-850"
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

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Filament Used per Item (g)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={filamentWeight}
                    onChange={(e) => setFilamentWeight(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Filament Price (€/kg)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={filamentPrice}
                    onChange={(e) => {
                      setFilamentPrice(Math.max(0, parseFloat(e.target.value) || 0));
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Filament Type
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PLA, PETG"
                    value={filamentType}
                    onChange={(e) => {
                      setFilamentType(e.target.value);
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Filament Color
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Black, White, Red"
                    value={filamentColor}
                    onChange={(e) => {
                      setFilamentColor(e.target.value);
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Print Time & Printer Cost */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Time & Printer Depreciation</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Print Time (Hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={printHours}
                    onChange={(e) => setPrintHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Print Time (Minutes)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={printMinutes}
                    onChange={(e) => setPrintMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Printer Cost (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={printerCost}
                    onChange={(e) => setPrinterCost(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Printer Lifespan (Hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={printerLifespan}
                    onChange={(e) => setPrinterLifespan(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Electricity */}
            <div className="space-y-3 pt-2">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Electricity (Bavaria, DE)</h3>
                <span className="text-[10px] text-brand-600 font-bold bg-brand-50 px-2 py-0.5 rounded-md">Bavarian Average (~34c)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Printer Power Draw (Watts)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={printerPower}
                    onChange={(e) => setPrinterPower(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Electricity Rate (€ / kWh)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={electricityPrice}
                    onChange={(e) => setElectricityPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Labor & Failures */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Overheads & Adjustments</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Labor / Finish Cost (€ per print)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={laborCost}
                    onChange={(e) => setLaborCost(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Fail Margin Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={failMargin}
                    onChange={(e) => setFailMargin(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Breakdown Card (Right) */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
          <div className="bg-slate-900 text-slate-100 rounded-3xl p-6 shadow-xl border border-slate-800 space-y-6">
            <h2 className="text-lg font-black flex items-center gap-2 border-b border-slate-800 pb-3 text-white">
              <Gauge size={18} className="text-brand-400" />
              Cost & Profit Summary
            </h2>

            {/* Calculations Breakdown */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Print Time</span>
                <span className="font-mono text-white font-bold">
                  {printHours}h {printMinutes}m ({calculations.totalHours.toFixed(2)}h)
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">
                  Filament Cost
                  {quantity > 1 ? ` (×${quantity})` : ''}
                </span>
                <span className="font-mono text-white font-bold">
                  €{calculations.filamentCostUnit.toFixed(2)}
                  {quantity > 1 && (
                    <span className="text-slate-400 font-normal text-xs ml-1">
                      / €{(calculations.filamentCostUnit * quantity).toFixed(2)} total
                    </span>
                  )}
                </span>
              </div>
              {selectedSpool && pendingFilamentGrams > 0 && (
                <div className="flex justify-between items-center text-xs text-indigo-300/90 px-1">
                  <span>Stock use ({quantity}× {filamentWeight}g)</span>
                  <span className="font-mono font-bold">−{gramsToKgDisplay(pendingFilamentGrams)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Electricity Cost</span>
                <span className="font-mono text-white font-bold">
                  €{calculations.electricityCostUnit.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Printer Depreciation</span>
                <span className="font-mono text-white font-bold">
                  €{calculations.depreciationCostUnit.toFixed(2)}
                </span>
              </div>
              {laborCost > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Labor / Processing</span>
                  <span className="font-mono text-white font-bold">
                    €{laborCost.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="border-t border-slate-800 my-2 pt-2 flex justify-between items-center text-sm font-semibold">
                <span className="text-slate-350">Subtotal per Unit</span>
                <span className="font-mono text-slate-200">
                  €{calculations.baseSubtotalUnit.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Fail Buffer ({failMargin}%)</span>
                <span className="font-mono text-white font-bold">
                  €{calculations.failCostUnit.toFixed(2)}
                </span>
              </div>

              {/* Final Unit cost */}
              <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-800 flex justify-between items-center mt-4">
                <div>
                  <span className="text-xs uppercase tracking-widest text-slate-400 block font-black">Production cost / unit</span>
                  <span className="text-xs text-slate-500 font-semibold">(Себестоимость детали)</span>
                </div>
                <span className="text-2xl font-black text-emerald-400 font-mono">
                  €{calculations.finalUnitCost.toFixed(2)}
                </span>
              </div>

              {/* Total calculation (if qty > 1) */}
              {quantity > 1 && (
                <div className="flex justify-between items-center text-sm bg-slate-800/20 p-3 rounded-xl border border-slate-800/40">
                  <span className="text-slate-350">Batch Sourcing Cost (x{quantity})</span>
                  <span className="font-mono text-brand-300 font-black">
                    €{calculations.totalProductionCost.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Profit outcomes */}
            {parseFloat(plannedSellPrice) > 0 && (
              <div className="border-t border-slate-800 pt-6 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Margin Predictions</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/30 p-3 rounded-2xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block font-black uppercase">Unit Profit</span>
                    <span className="text-lg font-black text-white font-mono">
                      €{calculations.profitUnit.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-800/30 p-3 rounded-2xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block font-black uppercase">Profit Margin</span>
                    <span className="text-lg font-black text-white font-mono">
                      {calculations.profitMarginPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {quantity > 1 && (
                  <div className="flex justify-between items-center text-sm p-2 rounded-xl bg-slate-800/10 border border-slate-850">
                    <span className="text-slate-450">Estimated Total Profit</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      €{calculations.profitTotal.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Action button */}
            <button
              type="button"
              onClick={handleSave}
              className="w-full py-4 px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-black uppercase tracking-widest text-xs transition-all shadow-lg hover:shadow-brand-500/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Save size={16} />
              Print & Add to Inventory
            </button>
          </div>

          {/* Bavaria Info Tip */}
          <div className="bg-amber-50/50 border border-amber-200/50 rounded-3xl p-5 text-xs text-amber-900 flex gap-3 items-start">
            <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Bavarian Power Rates</p>
              <p className="text-amber-800 leading-relaxed">
                Electricity pricing in Bavaria averages **34.0¢ per kWh** for German household tariffs in 2026. This rate is pre-loaded into the calculator, but you should adjust this if you are on a specific commercial, contract-bound, or dynamic grid tariff (e.g. Tibber/Awattar).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreeDPrintPage;
