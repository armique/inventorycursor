import React from 'react';
import { Gauge } from 'lucide-react';
import type { ThreeDPrintCalculatorResult } from '../utils/threeDPrintCalculator';

type Props = {
  quote: ThreeDPrintCalculatorResult;
  isAdmin: boolean;
  chargedPricePerPart?: number | null;
  productionCostTotal: number;
  showStockHint?: React.ReactNode;
  children?: React.ReactNode;
};

const Row: React.FC<{ label: string; value: string; strong?: boolean; muted?: boolean }> = ({
  label,
  value,
  strong,
  muted,
}) => (
  <div className={`flex justify-between items-center text-sm ${strong ? 'font-semibold' : ''}`}>
    <span className="text-slate-400">{label}</span>
    <span className={`font-mono ${muted ? 'text-slate-400' : 'text-white font-bold'}`}>{value}</span>
  </div>
);

export const ThreeDPrintQuoteSummary: React.FC<Props> = ({
  quote,
  isAdmin,
  chargedPricePerPart,
  productionCostTotal,
  showStockHint,
  children,
}) => {
  const fmt = (n: number) => `€${n.toFixed(2)}`;
  const charged =
    chargedPricePerPart != null && Number.isFinite(chargedPricePerPart) && chargedPricePerPart > 0
      ? chargedPricePerPart
      : null;
  const chargedTotal = charged != null ? charged * quote.quantity : null;
  const actualProfitTotal = chargedTotal != null ? chargedTotal - productionCostTotal : null;
  const actualProfitPerPart = charged != null ? charged - quote.productionCostPerPart : null;
  const vsRecommended = chargedTotal != null ? chargedTotal - quote.finalPrice : null;

  return (
    <div className="bg-slate-900 text-slate-100 rounded-3xl p-6 shadow-xl border border-slate-800 space-y-6">
      <h2 className="text-lg font-black flex items-center gap-2 border-b border-slate-800 pb-3 text-white">
        <Gauge size={18} className="text-brand-400" />
        {isAdmin ? 'Cost & price summary' : 'Ergebnis'}
      </h2>

      <div className="rounded-2xl bg-brand-500/15 border border-brand-400/30 p-4 text-center space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-200">
          {charged != null ? 'Charged price' : isAdmin ? 'Recommended price' : 'Estimated price'}
        </p>
        <p className="text-3xl font-black text-white font-mono tabular-nums">
          {fmt(chargedTotal ?? quote.finalPrice)}
        </p>
        {quote.quantity > 1 && (
          <p className="text-xs font-semibold text-brand-100">
            {quote.quantity} parts × {fmt(charged ?? quote.effectivePricePerPart)}
          </p>
        )}
        {charged != null && (
          <p className="text-[11px] font-semibold text-brand-100/80">
            Recommended {fmt(quote.finalPrice)}
            {vsRecommended != null && vsRecommended !== 0
              ? ` · ${vsRecommended > 0 ? '+' : ''}${fmt(vsRecommended)} vs quote`
              : ''}
          </p>
        )}
      </div>

      {quote.valid && charged != null && actualProfitPerPart != null && actualProfitTotal != null && (
        <div className="space-y-2 text-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Your result</p>
          <Row label="Charged / part" value={fmt(charged)} />
          <Row label="Production cost / part" value={fmt(quote.productionCostPerPart)} />
          <Row label="Profit / part" value={fmt(actualProfitPerPart)} />
          {quote.quantity > 1 && <Row label="Charged total" value={fmt(chargedTotal ?? 0)} />}
          <div className="border-t border-slate-800 my-2 pt-2">
            <Row label="Your profit" value={fmt(actualProfitTotal)} strong />
          </div>
        </div>
      )}

      {quote.valid && (
        <div className="space-y-2 text-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {charged != null ? 'Recommended calculation' : 'Calculation'}
          </p>
          <Row label="Material" value={fmt(quote.materialCostWithWaste)} />
          {quote.wasteAmount > 0 && <Row label=" incl. waste" value={fmt(quote.wasteAmount)} muted />}
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
            <Row label="Recommended price" value={fmt(quote.finalPrice)} strong />
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
