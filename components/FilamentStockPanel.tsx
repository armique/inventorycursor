import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import {
  addFilamentSpool,
  colorToDotStyle,
  getRemainingGrams,
  getRemainingPercent,
  getUsedGrams,
  gramsToKgDisplay,
  isLowStock,
  kgToGrams,
  loadFilamentStock,
  recordWasteUsage,
  removeFilamentSpool,
  setRemainingOverride,
  SOURCE_LABELS,
  spoolLabel,
  syncLegacyFilamentProfiles,
  updateFilamentSpool,
  type FilamentPurchaseSource,
  type FilamentSpool,
  type FilamentStockState,
} from '../services/filamentStock';
import { formatEUR } from '../utils/formatMoney';
import type { Expense } from '../types';
import { buildFilamentStockExpense } from '../services/filamentExpenseLink';
import { FILAMENT_STOCK_EXPENSE_CATEGORY } from '../utils/expenseCategories';

interface Props {
  selectedSpoolId: string | null;
  onSelectSpool: (spool: FilamentSpool | null) => void;
  /** Grams needed for current print job (optional warning). */
  pendingGrams?: number;
  onAddExpense?: (expense: Expense) => void;
}

const FILAMENT_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon', 'PVA'];
const COLORS = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Transparent'];

function SpoolCard({
  spool,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
  onRemove,
  onAdjustRemaining,
  onLogWaste,
  onUpdatePrice,
}: {
  spool: FilamentSpool;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onRemove: () => void;
  onAdjustRemaining: (grams: number) => void;
  onLogWaste: (grams: number) => void;
  onUpdatePrice: (price: number) => void;
}) {
  const remaining = getRemainingGrams(spool);
  const used = getUsedGrams(spool);
  const pct = getRemainingPercent(spool);
  const low = isLowStock(spool);
  const dot = colorToDotStyle(spool.color);
  const isGradient = dot.includes('gradient');

  const recentUsages = [...spool.usages]
    .filter((u) => u.grams > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  return (
    <div
      className={`rounded-2xl border-2 transition-all overflow-hidden ${
        selected
          ? 'border-indigo-400 bg-indigo-50/40 shadow-md shadow-indigo-100'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl border-2 border-slate-200 shrink-0 shadow-inner"
            style={
              isGradient
                ? { background: dot }
                : { backgroundColor: dot, boxShadow: spool.color.toLowerCase().includes('white') ? 'inset 0 0 0 1px #cbd5e1' : undefined }
            }
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-slate-900 truncate">{spoolLabel(spool)}</p>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {SOURCE_LABELS[spool.source]}
              </span>
              {selected && (
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                  Active
                </span>
              )}
              {low && (
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-0.5">
                  <AlertTriangle size={10} /> Low
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              €{formatEUR(spool.pricePerKg)}/kg
              {spool.purchasedAt ? ` · bought ${spool.purchasedAt}` : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-black text-slate-900 tabular-nums">{gramsToKgDisplay(remaining)}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase">left</p>
          </div>
        </div>

        {spool.purchasedGrams > 0 && (
          <div className="space-y-1">
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pct < 15 ? 'bg-amber-500' : pct < 40 ? 'bg-indigo-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>{gramsToKgDisplay(used)} used</span>
              <span>{gramsToKgDisplay(spool.purchasedGrams)} bought</span>
            </div>
          </div>
        )}
      </button>

      <div className="px-4 pb-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Hide' : 'Details'}
        </button>
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Use for print
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase text-red-600 hover:bg-red-50 ml-auto"
        >
          <Trash2 size={12} />
          Remove
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/80 p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[9px] font-black uppercase text-slate-400">€/kg</span>
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={spool.pricePerKg}
                onBlur={(e) => onUpdatePrice(parseFloat(e.target.value) || spool.pricePerKg)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
              />
            </label>
            <label className="space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[9px] font-black uppercase text-slate-400">Set remaining</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  step="1"
                  min="0"
                  placeholder="grams"
                  id={`remain-${spool.id}`}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`remain-${spool.id}`) as HTMLInputElement | null;
                    const g = parseFloat(el?.value || '');
                    if (Number.isFinite(g) && g >= 0) onAdjustRemaining(g);
                  }}
                  className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-800 text-white text-[10px] font-black"
                >
                  Set
                </button>
              </div>
            </label>
            <label className="space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[9px] font-black uppercase text-slate-400">Log waste (g)</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  step="1"
                  min="0"
                  placeholder="50"
                  id={`waste-${spool.id}`}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`waste-${spool.id}`) as HTMLInputElement | null;
                    const g = parseFloat(el?.value || '');
                    if (Number.isFinite(g) && g > 0) onLogWaste(g);
                  }}
                  className="shrink-0 px-2 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-black"
                >
                  Log
                </button>
              </div>
            </label>
          </div>

          {recentUsages.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Where it went</p>
              <ul className="space-y-1 max-h-36 overflow-y-auto">
                {recentUsages.map((u) => (
                  <li
                    key={u.id}
                    className="flex justify-between gap-2 text-[11px] bg-white rounded-lg px-2.5 py-1.5 border border-slate-100"
                  >
                    <span className="text-slate-700 truncate">
                      {u.inventoryItemName || u.note || u.kind}
                      <span className="text-slate-400 ml-1">· {u.date}</span>
                    </span>
                    <span className="font-black text-slate-900 tabular-nums shrink-0">−{Math.round(u.grams)}g</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">No usage logged yet — prints deduct automatically.</p>
          )}

          {spool.note && <p className="text-[11px] text-slate-500 italic">{spool.note}</p>}
        </div>
      )}
    </div>
  );
}

const FilamentStockPanel: React.FC<Props> = ({ selectedSpoolId, onSelectSpool, pendingGrams = 0, onAddExpense }) => {
  const [stock, setStock] = useState<FilamentStockState>(() => loadFilamentStock());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const [addSource, setAddSource] = useState<FilamentPurchaseSource>('amazon');
  const [addType, setAddType] = useState('PLA');
  const [addTypeCustom, setAddTypeCustom] = useState('');
  const [addColor, setAddColor] = useState('White');
  const [addColorCustom, setAddColorCustom] = useState('');
  const [addBrand, setAddBrand] = useState('');
  const [addWeightKg, setAddWeightKg] = useState('1');
  const [addTotalPaid, setAddTotalPaid] = useState('');
  const [addPriceKg, setAddPriceKg] = useState('');
  const [addVendor, setAddVendor] = useState('');
  const [addDate, setAddDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [addNote, setAddNote] = useState('');
  const [recordAsExpense, setRecordAsExpense] = useState(true);

  const refresh = useCallback(() => setStock(loadFilamentStock()), []);

  useEffect(() => {
    window.addEventListener('filament-stock-updated', refresh);
    return () => window.removeEventListener('filament-stock-updated', refresh);
  }, [refresh]);

  useEffect(() => {
    syncLegacyFilamentProfiles(stock.spools);
  }, [stock.spools]);

  const summary = useMemo(() => {
    const spools = stock.spools;
    const low = spools.filter(isLowStock).length;
    const totalRemaining = spools.reduce((s, sp) => s + getRemainingGrams(sp), 0);
    return { count: spools.length, low, totalRemaining };
  }, [stock.spools]);

  const selectedSpool = stock.spools.find((s) => s.id === selectedSpoolId) ?? null;

  const handleAddSpool = () => {
    const type = addType === 'CUSTOM' ? addTypeCustom.trim() : addType;
    const color = addColor === 'CUSTOM' ? addColorCustom.trim() : addColor;
    const kg = parseFloat(addWeightKg.replace(',', '.'));
    if (!type || !color || !Number.isFinite(kg) || kg <= 0) {
      alert('Type, color, and weight (kg) are required.');
      return;
    }
    const paid = parseFloat(addTotalPaid.replace(',', '.'));
    let pricePerKg = parseFloat(addPriceKg.replace(',', '.'));
    if (!Number.isFinite(pricePerKg) || pricePerKg <= 0) {
      if (Number.isFinite(paid) && paid > 0) pricePerKg = paid / kg;
      else {
        alert('Enter total paid or €/kg.');
        return;
      }
    }
    let expenseId: string | undefined;
    const amount = Number.isFinite(paid) && paid > 0 ? paid : pricePerKg * kg;
    if (recordAsExpense && onAddExpense && amount > 0) {
      const expense = buildFilamentStockExpense(
        {
          type,
          color,
          brand: addBrand.trim() || undefined,
          purchasedAt: addDate,
          vendor: addVendor.trim() || undefined,
          note: addNote.trim() || undefined,
          source: addSource,
        },
        amount
      );
      onAddExpense(expense);
      expenseId = expense.id;
    }
    const next = addFilamentSpool(stock, {
      type,
      color,
      brand: addBrand.trim() || undefined,
      pricePerKg,
      purchasedGrams: kgToGrams(kg),
      purchasedAt: addDate,
      source: addSource,
      vendor: addVendor.trim() || undefined,
      totalPaid: Number.isFinite(paid) ? paid : undefined,
      note: addNote.trim() || undefined,
      expenseId,
    });
    const withExpense = next;
    setStock(withExpense);
    const added = withExpense.spools[withExpense.spools.length - 1];
    onSelectSpool(added);
    setShowAdd(false);
    setAddTotalPaid('');
    setAddPriceKg('');
    setAddNote('');
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 sm:p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <Package size={22} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">Filament stock</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              Each spool tracks weight, €/kg, and where filament went. Amazon — manual entry here. eBay — use{' '}
              <Link to="/panel/ebay-store-pull?tab=purchases" className="text-indigo-600 font-bold hover:underline">
                eBay → Purchases
              </Link>{' '}
              tab to link buyer orders.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-center min-w-[72px]">
            <p className="text-[9px] font-black uppercase text-slate-400">Spools</p>
            <p className="text-xl font-black text-slate-900">{summary.count}</p>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-center min-w-[72px]">
            <p className="text-[9px] font-black uppercase text-slate-400">On hand</p>
            <p className="text-xl font-black text-indigo-700">{gramsToKgDisplay(summary.totalRemaining)}</p>
          </div>
          {summary.low > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-center min-w-[72px]">
              <p className="text-[9px] font-black uppercase text-amber-700">Low</p>
              <p className="text-xl font-black text-amber-800">{summary.low}</p>
            </div>
          )}
        </div>
      </div>

      {selectedSpool && pendingGrams > 0 && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-bold flex items-center gap-2 ${
            pendingGrams > getRemainingGrams(selectedSpool)
              ? 'bg-red-50 border border-red-200 text-red-800'
              : 'bg-indigo-50 border border-indigo-200 text-indigo-900'
          }`}
        >
          {pendingGrams > getRemainingGrams(selectedSpool) ? (
            <AlertTriangle size={16} className="shrink-0" />
          ) : (
            <ShoppingBag size={16} className="shrink-0" />
          )}
          This job needs {gramsToKgDisplay(pendingGrams)} from{' '}
          <span className="font-black">{spoolLabel(selectedSpool)}</span> ({gramsToKgDisplay(getRemainingGrams(selectedSpool))}{' '}
          available)
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {stock.spools.map((spool) => (
          <SpoolCard
            key={spool.id}
            spool={spool}
            selected={selectedSpoolId === spool.id}
            expanded={expandedId === spool.id}
            onSelect={() => onSelectSpool(spool)}
            onToggleExpand={() => setExpandedId((id) => (id === spool.id ? null : spool.id))}
            onRemove={() => {
              if (!confirm(`Remove spool "${spoolLabel(spool)}"? Usage history will be deleted.`)) return;
              const next = removeFilamentSpool(stock, spool.id);
              setStock(next);
              if (selectedSpoolId === spool.id) onSelectSpool(next.spools[0] ?? null);
            }}
            onAdjustRemaining={(grams) => {
              const next = setRemainingOverride(stock, spool.id, grams, 'Weighed / corrected');
              setStock(next);
            }}
            onLogWaste={(grams) => {
              const { state: next, error } = recordWasteUsage(stock, spool.id, grams);
              if (error) alert(error);
              else setStock(next);
            }}
            onUpdatePrice={(price) => {
              setStock(updateFilamentSpool(stock, spool.id, { pricePerKg: price }));
            }}
          />
        ))}

        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 hover:border-indigo-400 hover:bg-indigo-50/30 min-h-[140px] flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-indigo-700 transition-colors"
        >
          <div className="p-2 rounded-xl bg-slate-100">
            {showAdd ? <Minus size={20} /> : <Plus size={20} />}
          </div>
          <span className="text-xs font-black uppercase tracking-wide">
            {showAdd ? 'Cancel' : 'Add spool'}
          </span>
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="text-sm font-black text-slate-900">Register a new spool</h3>
          <div className="flex flex-wrap gap-2">
            {(['amazon', 'manual', 'ebay', 'other'] as FilamentPurchaseSource[]).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setAddSource(src)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border ${
                  addSource === src
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                }`}
              >
                {SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
          {addSource === 'amazon' && (
            <p className="text-[11px] text-indigo-800 bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
              Amazon has no API hook — enter order details manually from your Amazon purchase history.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Material</span>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
              >
                {FILAMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="CUSTOM">Custom…</option>
              </select>
              {addType === 'CUSTOM' && (
                <input
                  value={addTypeCustom}
                  onChange={(e) => setAddTypeCustom(e.target.value)}
                  placeholder="Material name"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              )}
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Color</span>
              <select
                value={addColor}
                onChange={(e) => setAddColor(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
              >
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="CUSTOM">Custom…</option>
              </select>
              {addColor === 'CUSTOM' && (
                <input
                  value={addColorCustom}
                  onChange={(e) => setAddColorCustom(e.target.value)}
                  placeholder="e.g. Silk gold"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              )}
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Brand</span>
              <input
                value={addBrand}
                onChange={(e) => setAddBrand(e.target.value)}
                placeholder="e.g. eSun, Polymaker"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Spool weight (kg)</span>
              <input
                value={addWeightKg}
                onChange={(e) => setAddWeightKg(e.target.value)}
                placeholder="1 or 2.5"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Total paid (€)</span>
              <input
                value={addTotalPaid}
                onChange={(e) => setAddTotalPaid(e.target.value)}
                placeholder="e.g. 18.99"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Or €/kg directly</span>
              <input
                value={addPriceKg}
                onChange={(e) => setAddPriceKg(e.target.value)}
                placeholder="auto from total ÷ kg"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Purchase date</span>
              <input
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase text-slate-500">Seller / shop</span>
              <input
                value={addVendor}
                onChange={(e) => setAddVendor(e.target.value)}
                placeholder="Amazon, eBay seller…"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
          </div>
          <input
            value={addNote}
            onChange={(e) => setAddNote(e.target.value)}
            placeholder="Optional note (order #, link…)"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
          />
          {onAddExpense && (
            <label className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={recordAsExpense}
                onChange={(e) => setRecordAsExpense(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600"
              />
              <span>
                Record linked expense as <strong>{FILAMENT_STOCK_EXPENSE_CATEGORY}</strong> (inventory — excluded from
                Betriebsausgaben / tax operating total; COGS when you print).
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={handleAddSpool}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700"
          >
            Add spool to stock
          </button>
        </div>
      )}
    </section>
  );
};

export default FilamentStockPanel;
