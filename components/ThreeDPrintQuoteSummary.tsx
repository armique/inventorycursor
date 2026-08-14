import React from 'react';
import { Gauge } from 'lucide-react';
import type { ThreeDPrintCalculatorResult } from '../utils/threeDPrintCalculator';

type Props = {
  quote: ThreeDPrintCalculatorResult;
  isAdmin: boolean;
  showStockHint?: React.ReactNode;
  children?: React.ReactNode;
};

const Row: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className={`flex justify-between items-center text-sm ${strong ? 'font-semibold' : ''}`}>
    <span className="text-slate-400">{label}</span>
    <span className={`font-mono ${strong ? 'text-white font-bold' : 'text-white font-bold'}`}>{value}</span>
  </div>
);

export const ThreeDPrintQuoteSummary: React.FC<Props> = ({ quote, isAdmin, showStockHint, children }) => {
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  return (
    <div className="bg-slate-900 text-slate-100 rounded-3xl p-6 shadow-xl border border-slate-800 space-y-6">
      <h2 className="text-lg font-black flex items-center gap-2 border-b border-slate-800 pb-3 text-white">
        <Gauge size={18} className="text-brand-400" />
        {isAdmin ? 'Cost & price summary' : 'Ergebnis'}
      </h2>

      <div className="rounded-2xl bg-brand-500/15 border border-brand-400/30 p-4 text-center space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-200">
          {isAdmin ? 'Recommended price' : 'Estimated price'}
        </p>
        <p className="text-3xl font-black text-white font-mono tabular-nums">{fmt(quote.finalPrice)}</p>
        {quote.quantity > 1 && (
          <p className="text-xs font-semibold text-brand-100">
            {quote.quantity} parts × {fmt(quote.effectivePricePerPart)}
          </p>
        )}
      </div>

      {quote.valid && (
        <div className="space-y-2 text-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Calculation</p>
          <Row label="Material" value={fmt(quote.materialCostWithWaste)} />
          {quote.wasteAmount > 0 && (
            <Row label=" incl. waste" value={fmt(quote.wasteAmount)} />
          )}
          <Row label="Electricity" value={fmt(quote.electricityCost)} />
          <Row label="Printer depreciation" value={fmt(quote.depreciationCost)} />
          <Row label="Other costs" value={fmt(quote.additionalCost)} />
          <div className="border-t border-slate-800 my-2 pt-2">
            <Row label="Production cost" value={fmt(quote.productionCostPerPart)} strong />
          </div>
          <Row label="Profit" value={fmt(quote.profitPerPart)} />
          <Row label="Price per part" value={fmt(quote.pricePerPart)} />
          {quote.quantity > 1 && (
            <>
              <Row label="Quantity" value={String(quote.quantity)} />
              <Row label="Subtotal" value={fmt(quote.subtotalBeforeDiscount)} />
            </>
          )}
          {quote.discountPct > 0 && (
            <Row label={`Quantity discount (${quote.discountPct}%)`} value={`−${fmt(quote.discountAmount)}`} />
          )}
          {quote.minimumOrderAdjustment > 0 && (
            <Row label="Minimum order adjustment" value={fmt(quote.minimumOrderAdjustment)} />
          )}
          <div className="border-t border-slate-800 my-2 pt-2">
            <Row label="Final price" value={fmt(quote.finalPrice)} strong />
          </div>
        </div>
      )}

      {!quote.valid && (
        <p className="text-sm font-semibold text-amber-300">
          Enter valid weight, print time, and quantity to see the price breakdown.
        </p>
      )}

      {showStockHint}

      {children}
    </div>
  );
};

export default ThreeDPrintQuoteSummary;
