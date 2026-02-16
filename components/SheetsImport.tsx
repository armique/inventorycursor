import React, { useState, useMemo, useEffect } from 'react';
import { read, utils } from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, Info, Loader2, AlertCircle, Eye, HelpCircle, Trash2, AlertTriangle, RefreshCcw, ArrowRight, TrendingUp, Wallet, ListX, Table, Search, Globe, ChevronDown, ChevronUp, FileText, Settings2, Columns } from 'lucide-react';
import { InventoryItem, ItemStatus } from '../types';
import { LOCAL_HARDWARE_INDEX, CATEGORY_MAP, VENDOR_LIST, CATEGORY_IMAGES } from '../services/hardwareDB';

interface Props {
  onImport: (items: InventoryItem[], replace: boolean) => void;
  onClearData?: () => void;
}

interface SkippedRow {
  rowIndex: number;
  reason: string;
  data: any[];
}

type ImportLocale = 'DE' | 'US';

interface ColumnMapping {
  name: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  buyDate: number;
  sellDate: number;
}

const DEFAULT_MAPPING: ColumnMapping = {
  name: 0,
  buyPrice: 1,
  sellPrice: 2,
  profit: 3,
  buyDate: 4,
  sellDate: 5
};

const SheetsImport: React.FC<Props> = ({ onImport, onClearData }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawSheetData, setRawSheetData] = useState<any[][]>([]);
  
  // Configuration
  const [locale, setLocale] = useState<ImportLocale>('DE');
  const [detectedLocale, setDetectedLocale] = useState<ImportLocale>('DE');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [showMapping, setShowMapping] = useState(false);
  
  // Output State
  const [stats, setStats] = useState({ total: 0, autoCategorized: 0, review: 0, skipped: 0 });
  const [pendingItems, setPendingItems] = useState<(InventoryItem & { rowIndex: number })[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [step, setStep] = useState<'UPLOAD' | 'REVIEW' | 'SUCCESS'>('UPLOAD');
  
  // Review Table State
  const [reviewSearch, setReviewSearch] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'rowIndex', direction: 'asc' });
  const [showSkipped, setShowSkipped] = useState(false);

  // Wipe Modal State
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [justWiped, setJustWiped] = useState(false);

  // --- PARSING LOGIC ---

  const parseNumber = (val: any, loc: ImportLocale): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;

    let str = val.toString().trim();
    // Aggressive cleaning: Remove EVERYTHING that is not a digit, dot, comma, or minus
    str = str.replace(/[^\d.,-]/g, '');
    
    if (loc === 'DE') {
       // German: 1.000,00 -> remove dots, replace comma with dot
       // Also handle 1000,00 (no dot) -> 1000.00
       str = str.replace(/\./g, '').replace(',', '.');
    } else {
       // US: 1,000.00 -> remove commas
       str = str.replace(/,/g, '');
    }

    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  const parseDate = (val: any): string => {
    if (!val) return '';
    // Excel Serial
    if (typeof val === 'number') {
       // Excel dates sometimes come as very low numbers or weird floats if not dates
       if (val < 10000) return ''; // unlikely to be a modern date
       const date = new Date(Math.round((val - 25569) * 86400 * 1000));
       return !isNaN(date.getTime()) ? date.toISOString().split('T')[0] : '';
    }
    // String
    const str = val.toString().trim();
    if (str === '' || str === '-') return '';

    // Handle DD.MM.YYYY (German)
    if (str.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
      const parts = str.split('.');
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2]; 
      return `${year}-${month}-${day}`;
    }

    try {
      const d = new Date(str);
      return (!isNaN(d.getTime()) && d.getFullYear() > 2000) ? d.toISOString().split('T')[0] : '';
    } catch {
      return '';
    }
  };

  const smartClassify = (name: string) => {
    let clean = name.toLowerCase();
    if (clean.length < 2) return { category: 'Unknown', confidence: 0, specs: {} };

    let detectedCategory = 'Unknown';
    let confidence = 0;
    let autoSpecs: Record<string, string | number> = {};
    let detectedVendor = '';

    for (const [kw, cat] of Object.entries(CATEGORY_MAP)) {
      if (clean.includes(kw)) {
        detectedCategory = cat;
        confidence = 60;
      }
    }
    
    if (/\b(ryzen|threadripper|core|i[3579])\b/i.test(clean)) { detectedCategory = 'Processors'; confidence = 90; }
    if (/\b(rtx|gtx|rx|xt)\b/i.test(clean)) { detectedCategory = 'Graphics Cards'; confidence = 90; }

    return { category: detectedCategory, vendor: detectedVendor || 'Generic', confidence, specs: autoSpecs, needsReview: confidence < 75 };
  };

  // --- MAIN PROCESSOR ---

  // Re-run parsing when settings change
  useEffect(() => {
    if (rawSheetData.length === 0) return;
    processRows(rawSheetData, locale, hasHeader, mapping);
  }, [locale, hasHeader, mapping, rawSheetData]);

  const processRows = (rows: any[][], activeLocale: ImportLocale, headerMode: boolean, colMap: ColumnMapping) => {
    const importedItems: (InventoryItem & { rowIndex: number })[] = [];
    const skippedLog: SkippedRow[] = [];
    
    let categorizedCount = 0;
    let reviewCount = 0;

    const startIndex = headerMode ? 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      const excelRowNumber = i + 1;
      
      if (!row || row.length === 0) {
         skippedLog.push({ rowIndex: excelRowNumber, reason: "Empty Row", data: [] });
         continue;
      }

      const rawName = row[colMap.name] ? row[colMap.name].toString() : '';
      if (!rawName || rawName.trim() === '') {
         skippedLog.push({ rowIndex: excelRowNumber, reason: "Missing Name (Column A)", data: row });
         continue;
      }
      
      if (rawName.match(/^(total|summe|gesamt|sum|average|durchschnitt)/i)) {
         skippedLog.push({ rowIndex: excelRowNumber, reason: "Summary Row Detected", data: row });
         continue;
      }

      // Value Parsing using dynamic mapping
      const buyPrice = parseNumber(row[colMap.buyPrice], activeLocale);
      const sellPriceRaw = row[colMap.sellPrice];
      const profitRaw = row[colMap.profit];
      
      const buyDate = parseDate(row[colMap.buyDate]) || new Date().toISOString().split('T')[0];
      const sellDate = parseDate(row[colMap.sellDate]);
      
      // We assume simple comments for now, next to sell date usually, or just append extra cols
      // If user has specific comment columns, we'd need more mapping fields. 
      // For now, let's just join any unused columns at the end as comments? 
      // Or keep it simple: No explicit comment mapping unless requested.
      let comment1 = '';
      let comment2 = '';

      const sellPrice = (sellPriceRaw !== undefined && sellPriceRaw !== null && sellPriceRaw !== '') ? parseNumber(sellPriceRaw, activeLocale) : undefined;
      
      const hasProfit = profitRaw !== undefined && profitRaw !== null && profitRaw !== '';
      const isSold = !!sellDate || hasProfit;
      
      let profit = 0;
      if (hasProfit) {
         profit = parseNumber(profitRaw, activeLocale);
      } else if (isSold && sellPrice !== undefined) {
         profit = sellPrice - buyPrice;
      }

      let finalSellPrice = sellPrice;
      if (isSold && (finalSellPrice === undefined || finalSellPrice === 0) && hasProfit) {
         finalSellPrice = buyPrice + profit;
      }

      const analysis = smartClassify(rawName);
      if (analysis.needsReview) reviewCount++; else categorizedCount++;

      if (Object.keys(analysis.specs).length > 0) comment1 = `Specs Auto-Detected\n${comment1}`.trim();

      const item: InventoryItem & { rowIndex: number } = {
        id: `imp-${Date.now()}-${i}`,
        rowIndex: excelRowNumber,
        name: rawName,
        buyPrice,
        sellPrice: finalSellPrice,
        profit: isSold ? profit : undefined,
        buyDate,
        sellDate: isSold ? sellDate : undefined,
        category: analysis.category,
        subCategory: analysis.category,
        status: isSold ? ItemStatus.SOLD : ItemStatus.IN_STOCK,
        comment1,
        comment2,
        vendor: analysis.vendor,
        specs: analysis.specs,
        imageUrl: CATEGORY_IMAGES[analysis.category] || undefined
      };

      importedItems.push(item);
    }

    setSkippedRows(skippedLog);
    setStats({ 
       total: importedItems.length, 
       autoCategorized: categorizedCount, 
       review: reviewCount,
       skipped: skippedLog.length
    });
    setPendingItems(importedItems);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setStep('UPLOAD');
    }
  };

  const processImport = () => {
    if (!file) return;
    setLoading(true);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      try {
        const workbook = read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawRows: any[][] = utils.sheet_to_json(sheet, { header: 1 });
        
        setRawSheetData(rawRows);

        // Auto-Detect Locale from first 20 rows
        let commaCount = 0;
        let dotCount = 0;
        // Scan first 3 columns for price-like patterns
        for(let i=1; i<Math.min(rawRows.length, 20); i++) {
           [1,2,3].forEach(idx => {
              const val = rawRows[i]?.[idx];
              if (typeof val === 'string') {
                 if (val.includes(',')) commaCount++;
                 if (val.includes('.')) dotCount++;
              }
           });
        }
        const likelyLocale = commaCount >= dotCount ? 'DE' : 'US';
        setLocale(likelyLocale);
        setDetectedLocale(likelyLocale);

        setStep('REVIEW');
      } catch (err) {
        console.error("Import Error", err);
        alert("Failed to parse file.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const financialPreview = useMemo(() => {
     const totalBuy = pendingItems.reduce((acc, i) => acc + (i.buyPrice || 0), 0);
     const totalSell = pendingItems.reduce((acc, i) => acc + (i.sellPrice || 0), 0);
     const totalProfit = pendingItems.reduce((acc, i) => acc + (i.profit || 0), 0);
     return { totalBuy, totalSell, totalProfit };
  }, [pendingItems]);

  const sortedReviewItems = useMemo(() => {
     let items = [...pendingItems];
     if (reviewSearch) {
        const lower = reviewSearch.toLowerCase();
        items = items.filter(i => i.name.toLowerCase().includes(lower) || i.rowIndex.toString().includes(lower));
     }
     
     items.sort((a, b) => {
        const valA = (a as any)[sortConfig.key];
        const valB = (b as any)[sortConfig.key];
        
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
     });
     
     return items;
  }, [pendingItems, reviewSearch, sortConfig]);

  const handleSort = (key: string) => {
     setSortConfig(prev => ({
        key,
        direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
     }));
  };

  const handleFinalizeImport = (replace: boolean) => {
     onImport(pendingItems, replace);
     setStep('SUCCESS');
  };

  const confirmWipe = async () => {
    if (onClearData) {
      setWiping(true);
      await new Promise(resolve => setTimeout(resolve, 800));
      onClearData();
      setWiping(false);
      setShowWipeModal(false);
      setJustWiped(true);
      setTimeout(() => setJustWiped(false), 5000);
    }
  };

  const renderColumnSelector = (label: string, field: keyof ColumnMapping) => {
     // Generate options A-Z (0-25)
     const options = Array.from({length: 15}, (_, i) => ({ 
        value: i, 
        label: `Col ${String.fromCharCode(65+i)}` 
     }));

     return (
        <div className="flex flex-col gap-1">
           <label className="text-[9px] font-black uppercase text-slate-400">{label}</label>
           <select 
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-blue-500"
              value={mapping[field]}
              onChange={(e) => setMapping(prev => ({ ...prev, [field]: parseInt(e.target.value) }))}
           >
              {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
           </select>
        </div>
     );
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
      <header className="px-4">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Import Data</h1>
        <p className="text-slate-500 font-medium italic">Advanced CSV/Excel Analyzer</p>
      </header>

      {justWiped && (
         <div className="mx-4 bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-2">
            <CheckCircle2 size={24} className="text-emerald-500"/>
            <div>
               <p className="text-sm font-black text-emerald-800">System Reset Successful</p>
               <p className="text-xs text-emerald-600">All data cleared. Ready for clean import.</p>
            </div>
         </div>
      )}

      {step === 'REVIEW' && (
         <div className="flex flex-col lg:flex-row gap-6 px-4">
            {/* LEFT: SUMMARY & CONTROLS */}
            <div className="w-full lg:w-96 space-y-6 shrink-0">
               
               {/* Financial Card */}
               <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-2xl">
                  <div className="flex items-center gap-2 mb-6">
                     <Wallet size={20} className="text-emerald-400"/>
                     <h4 className="font-black uppercase text-xs tracking-widest">Financial Preview</h4>
                  </div>
                  <div className="space-y-6">
                     <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Buy</p>
                        <p className="text-xl font-black text-slate-200">€{financialPreview.totalBuy.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                     </div>
                     <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Sold</p>
                        <p className="text-xl font-black text-blue-400">€{financialPreview.totalSell.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                     </div>
                     <div className="flex justify-between items-end">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Profit</p>
                        <p className={`text-2xl font-black ${financialPreview.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                           €{financialPreview.totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}
                        </p>
                     </div>
                  </div>
               </div>

               {/* Settings Card */}
               <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                  <div className="flex justify-between items-center">
                     <h4 className="font-black text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2">
                        <Settings2 size={14}/> Parsing Settings
                     </h4>
                     <button 
                        onClick={() => setShowMapping(!showMapping)}
                        className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${showMapping ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-slate-200 text-slate-400'}`}
                     >
                        {showMapping ? 'Hide Mapping' : 'Edit Columns'}
                     </button>
                  </div>
                  
                  {showMapping && (
                     <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in slide-in-from-top-2">
                        <h5 className="text-[10px] font-bold text-slate-900 mb-3 flex items-center gap-2"><Columns size={12}/> Column Mapping</h5>
                        <div className="grid grid-cols-2 gap-3">
                           {renderColumnSelector('Name', 'name')}
                           {renderColumnSelector('Buy Price', 'buyPrice')}
                           {renderColumnSelector('Sell Price', 'sellPrice')}
                           {renderColumnSelector('Profit', 'profit')}
                           {renderColumnSelector('Buy Date', 'buyDate')}
                           {renderColumnSelector('Sell Date', 'sellDate')}
                        </div>
                     </div>
                  )}

                  {/* First Row Toggle */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                     <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-2"><FileText size={12}/> First Row Is</span>
                     </div>
                     <div className="flex gap-2">
                        <button 
                           onClick={() => setHasHeader(true)}
                           className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl border transition-all ${hasHeader ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                        >
                           Header (Skip)
                        </button>
                        <button 
                           onClick={() => setHasHeader(false)}
                           className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl border transition-all ${!hasHeader ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                        >
                           Data (Keep)
                        </button>
                     </div>
                  </div>

                  {/* Locale Toggle */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                     <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-700">Number Format</span>
                        <span className="text-[9px] font-black bg-slate-200 text-slate-500 px-2 py-0.5 rounded">
                           Detected: {detectedLocale}
                        </span>
                     </div>
                     <div className="flex gap-2">
                        <button 
                           onClick={() => setLocale('DE')}
                           className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl border transition-all ${locale === 'DE' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                        >
                           DE (1.000,00)
                        </button>
                        <button 
                           onClick={() => setLocale('US')}
                           className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl border transition-all ${locale === 'US' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                        >
                           US (1,000.00)
                        </button>
                     </div>
                  </div>
               </div>

               {/* Action Buttons */}
               <div className="space-y-3">
                  <button 
                     onClick={() => handleFinalizeImport(false)} 
                     className="w-full py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-[2rem] font-black uppercase text-xs tracking-widest hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                     <RefreshCcw size={16}/> Append {stats.total} Items
                  </button>
                  <button 
                     onClick={() => handleFinalizeImport(true)} 
                     className="w-full py-4 bg-emerald-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-widest shadow-xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                  >
                     <Trash2 size={16}/> Replace Database
                  </button>
               </div>
            </div>

            {/* RIGHT: DATA GRID */}
            <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[800px]">
               <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-4">
                     <div className="bg-blue-100 text-blue-600 p-2 rounded-xl"><Table size={20}/></div>
                     <div>
                        <h3 className="text-lg font-black text-slate-900">Data Review</h3>
                        <p className="text-xs text-slate-500 font-bold">{stats.total} Rows • {stats.skipped} Skipped</p>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                        <input 
                           type="text" 
                           placeholder="Search row or item..." 
                           className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100"
                           value={reviewSearch}
                           onChange={e => setReviewSearch(e.target.value)}
                        />
                     </div>
                     <button 
                        onClick={() => setShowSkipped(!showSkipped)}
                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${showSkipped ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}
                     >
                        {showSkipped ? 'Hide Skipped' : 'Show Skipped'}
                     </button>
                  </div>
               </header>

               <div className="flex-1 overflow-auto custom-scrollbar">
                  {showSkipped ? (
                     <div className="p-6">
                        <h4 className="font-bold text-amber-600 mb-4 flex items-center gap-2"><AlertTriangle size={16}/> Skipped Rows ({skippedRows.length})</h4>
                        <table className="w-full text-left text-xs">
                           <thead className="bg-amber-50 text-amber-700 font-bold uppercase">
                              <tr>
                                 <th className="p-3 rounded-l-xl">Row #</th>
                                 <th className="p-3">Reason</th>
                                 <th className="p-3 rounded-r-xl">Raw Data</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                              {skippedRows.map((row, idx) => (
                                 <tr key={idx} className="hover:bg-amber-50/30">
                                    <td className="p-3 font-mono text-slate-500">{row.rowIndex}</td>
                                    <td className="p-3 font-bold text-red-500">{row.reason}</td>
                                    <td className="p-3 font-mono text-slate-400 truncate max-w-md">{row.data.join(' | ')}</td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  ) : (
                     <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-white shadow-sm z-10 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                           <tr>
                              <SortHeader label="Row" sortKey="rowIndex" activeSort={sortConfig} onSort={handleSort} />
                              <SortHeader label="Item Name" sortKey="name" activeSort={sortConfig} onSort={handleSort} />
                              <SortHeader label="Buy Price" sortKey="buyPrice" align="right" activeSort={sortConfig} onSort={handleSort} />
                              <SortHeader label="Sell Price" sortKey="sellPrice" align="right" activeSort={sortConfig} onSort={handleSort} />
                              <SortHeader label="Profit" sortKey="profit" align="right" activeSort={sortConfig} onSort={handleSort} />
                              <th className="p-4 text-center">Status</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-xs font-bold text-slate-700">
                           {sortedReviewItems.map(item => (
                              <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                                 <td className="p-4 text-slate-400 font-mono">{ (item as any).rowIndex }</td>
                                 <td className="p-4">
                                    <p className="truncate max-w-[200px] text-slate-900">{item.name}</p>
                                    <p className="text-[9px] text-slate-400 font-medium uppercase">{item.category}</p>
                                 </td>
                                 <td className="p-4 text-right">€{item.buyPrice.toFixed(2)}</td>
                                 <td className="p-4 text-right text-slate-500">
                                    {item.sellPrice ? `€${item.sellPrice.toFixed(2)}` : '-'}
                                 </td>
                                 <td className={`p-4 text-right ${item.profit && item.profit > 0 ? 'text-emerald-600' : item.profit && item.profit < 0 ? 'text-red-500' : 'text-slate-300'}`}>
                                    {item.profit ? `€${item.profit.toFixed(2)}` : '-'}
                                 </td>
                                 <td className="p-4 text-center">
                                    <span className={`px-2 py-1 rounded text-[9px] uppercase font-black ${item.status === ItemStatus.SOLD ? 'bg-purple-100 text-purple-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                       {item.status === ItemStatus.SOLD ? 'SOLD' : 'STOCK'}
                                    </span>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  )}
               </div>
            </div>
         </div>
      )}

      {step === 'UPLOAD' && (
         <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 space-y-8 mx-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="p-6 bg-blue-50 text-blue-800 rounded-[2rem] border border-blue-100 flex gap-4">
                  <Info size={28} className="shrink-0 text-blue-400" />
                  <div className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
                     <p className="mb-2 text-blue-600">Smart Excel/CSV Columns:</p>
                     <ol className="list-decimal ml-4 space-y-1 opacity-80">
                        <li>Asset Name (Required)</li>
                        <li>Buy Price</li>
                        <li>Sell Price</li>
                        <li>Profit (Imported directly!)</li>
                        <li>Buy Date</li>
                        <li>Sell Date</li>
                     </ol>
                  </div>
               </div>
               <div className="p-6 bg-slate-50 text-slate-700 rounded-[2rem] border border-slate-200 flex gap-4">
                  <CheckCircle2 size={28} className="shrink-0 text-slate-400" />
                  <div className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
                     <p className="mb-2 text-slate-900">Improved Logic:</p>
                     <ul className="list-disc ml-4 space-y-1 opacity-80">
                        <li>Interactive Data Grid Review</li>
                        <li>Locale Toggle (DE/US)</li>
                        <li>Row-Level Debugging</li>
                     </ul>
                  </div>
               </div>
            </div>

            <div className="border-2 border-dashed border-slate-200 rounded-[3rem] p-20 flex flex-col items-center justify-center text-center space-y-6 hover:border-blue-400 hover:bg-slate-50 transition-all cursor-pointer relative group">
               <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                  {loading ? <Loader2 size={48} className="animate-spin" /> : <FileSpreadsheet size={48} />}
               </div>
               {file ? (
                  <div>
                     <p className="font-black text-slate-900 text-xl">{file.name}</p>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ready to analyze {(file.size / 1024).toFixed(1)} KB</p>
                  </div>
               ) : (
                  <div>
                     <p className="font-black text-slate-900 text-xl">Upload Excel or CSV</p>
                     <p className="text-sm font-medium text-slate-400">Drag & drop your sales export here</p>
                  </div>
               )}
               <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} accept=".csv, .xlsx, .xls" disabled={loading} />
            </div>

            <div className="flex flex-col gap-4">
               <button onClick={processImport} disabled={!file || loading} className="w-full py-7 bg-slate-900 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl hover:bg-black disabled:opacity-50 transition-all flex items-center justify-center gap-4">
                  {loading ? <Loader2 size={28} className="animate-spin" /> : <Upload size={28} />}
                  Analyze File
               </button>
               
               {onClearData && (
                  <button 
                     onClick={() => setShowWipeModal(true)} 
                     className="w-full py-4 text-red-500 font-black uppercase text-[10px] tracking-widest hover:bg-red-50 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                     <Trash2 size={14}/> Clear Existing Data
                  </button>
               )}
            </div>
         </div>
      )}

      {step === 'SUCCESS' && (
          <div className="p-8 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl space-y-6 animate-in slide-in-from-bottom-4 mx-4">
             <div className="flex items-center gap-4">
                <CheckCircle2 className="text-emerald-500" size={32} />
                <div>
                   <h3 className="text-2xl font-black tracking-tight">Import Successful</h3>
                   <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{stats.skipped} rows skipped (Empty/Totals)</p>
                </div>
             </div>
             <div className="grid grid-cols-3 gap-6">
                <StatBox label="Imported" value={stats.total} />
                <StatBox label="Recognized" value={stats.autoCategorized} color="text-emerald-400" />
                <StatBox label="Manual Review" value={stats.review} color="text-amber-400" />
             </div>
             <button onClick={() => window.location.hash = '#/inventory'} className="w-full py-6 bg-blue-600 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
               Open Inventory Hub <ArrowRight size={16}/>
             </button>
          </div>
      )}

      {showWipeModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
           <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-8 space-y-6 text-center animate-in zoom-in-95">
              <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto">
                 {wiping ? <Loader2 size={32} className="animate-spin"/> : <AlertTriangle size={32}/>}
              </div>
              <div className="space-y-2">
                 <h3 className="text-xl font-black text-slate-900">{wiping ? 'Wiping...' : 'Wipe All Data?'}</h3>
                 <p className="text-sm text-slate-500 font-medium leading-relaxed">
                    This will permanently delete your entire inventory, sales history, expenses, and reset goals.
                    <br/><br/>
                    <span className="text-red-500 font-bold">This action cannot be undone.</span>
                 </p>
              </div>
              <div className="flex gap-3 pt-2">
                 <button onClick={() => setShowWipeModal(false)} disabled={wiping} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50">Cancel</button>
                 <button onClick={confirmWipe} disabled={wiping} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold shadow-lg shadow-red-200 hover:bg-red-700 transition-all disabled:opacity-50">
                    {wiping ? 'Clearing...' : 'Yes, Wipe Everything'}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

const StatBox = ({ label, value, color = "text-white", bg = "bg-white/5" }: { label: string, value: number, color?: string, bg?: string }) => (
  <div className={`${bg} p-5 rounded-3xl border border-white/10 text-center`}>
    <p className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1.5">{label}</p>
    <p className={`text-3xl font-black ${color}`}>{value}</p>
  </div>
);

const SortHeader = ({ label, sortKey, activeSort, onSort, align = 'left' }: any) => (
   <th 
      className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors group text-${align}`}
      onClick={() => onSort(sortKey)}
   >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
         {label}
         <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
            {activeSort.key === sortKey ? (activeSort.direction === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : <ChevronDown size={12}/>}
         </span>
      </div>
   </th>
);

export default SheetsImport;
