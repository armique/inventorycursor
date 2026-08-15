import React from 'react';
import { Clock, Shield } from 'lucide-react';
import type { ThreeDPrintCalculatorResult } from '../utils/threeDPrintCalculator';

type Props = {
  quote: ThreeDPrintCalculatorResult;
  isAdmin: boolean;
  chargedPricePerPart?: number | null;
  productionCostTotal: number;
  showStockHint?: React.ReactNode;
  children?: React.ReactNode;
};

const Row: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex justify-between items-center text-sm">
    <span className={strong ? 'text-white font-semibold' : 'text-slate-400'}>{label}</span>
    <span className={`font-mono tabular-nums ${strong ? 'text-white font-bold' : 'text-slate-200'}`}>{value}</span>
  </div>
);

export const ThreeDPrintQuoteSummary: React.FC<Props> = ({
  quote,
  chargedPricePerPart,
  productionCostTotal,
  showStockHint,
  children,
}) => {
  const fmt = (n: number) => `${n.toFixed(2)} €`;
  const charged =
    chargedPricePerPart != null && Number.isFinite(chargedPricePerPart) && chargedPricePerPart > 0
      ? chargedPricePerPart
      : null;
  const chargedTotal = charged != null ? charged * quote.quantity : null;
  const displayTotal = chargedTotal ?? quote.finalPrice;
  const actualProfitTotal = chargedTotal != null ? chargedTotal - productionCostTotal : null;

  return (
    <aside className="rounded-2xl bg-[#151d2e] border border-white/10 p-5 space-y-5 h-full">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-300">Estimated total</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Live
        </span>
      </div>

      <div>
        <p className="text-4xl font-semibold tracking-tight text-white tabular-nums">{fmt(displayTotal)}</p>
        {quote.quantity > 1 && (
          <p className="mt-1 text-xs text-slate-400">
            {quote.quantity} parts × {fmt(charged ?? quote.effectivePricePerPart)}
          </p>
        )}
        {charged != null && (
          <p className="mt-1 text-xs text-slate-500">Recommended {fmt(quote.finalPrice)}</p>
        )}
      </div>

      {quote.valid && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <Row label="Production" value={fmt(quote.productionCostPerPart * quote.quantity)} />
          {charged != null && actualProfitTotal != null ? (
            <Row label="Your profit" value={fmt(actualProfitTotal)} />
          ) : (
            <Row label="Profit" value={fmt(quote.profitPerPart * quote.quantity)} />
          )}
          <Row label="Total" value={fmt(displayTotal)} strong />
        </div>
      )}

      {quote.valid && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Cost breakdown</summary>
          <div className="mt-3 space-y-1.5">
            <Row label="Material" value={fmt(quote.materialCostWithWaste)} />
            <Row label="Electricity" value={fmt(quote.electricityCost)} />
            <Row label="Depreciation" value={fmt(quote.depreciationCost)} />
            <Row label="Other" value={fmt(quote.additionalCost)} />
            {quote.discountPct > 0 && (
              <Row label={`Discount ${quote.discountPct}%`} value={`−${fmt(quote.discountAmount)}`} />
            )}
            {quote.minimumOrderAdjustment > 0 && (
              <Row label="Minimum order" value={fmt(quote.minimumOrderAdjustment)} />
            )}
          </div>
        </details>
      )}

      {!quote.valid && (
        <p className="text-sm text-amber-300">Enter weight and print time to see a live estimate.</p>
      )}

      <div className="space-y-2">
        <div className="flex gap-2.5 rounded-xl bg-[#1a2438] px-3 py-2.5 text-[11px] text-slate-400">
          <Shield size={14} className="text-brand-400 shrink-0 mt-0.5" />
          <p>
            <span className="block text-slate-200 font-semibold">Quote updates live</span>
            Machine time is included — not weight alone.
          </p>
        </div>
        <div className="flex gap-2.5 rounded-xl bg-[#1a2438] px-3 py-2.5 text-[11px] text-slate-400">
          <Clock size={14} className="text-slate-300 shrink-0 mt-0.5" />
          <p>Estimate refreshes as soon as you change a field.</p>
        </div>
      </div>

      {showStockHint}
      {children}
    </aside>
  );
};

export default ThreeDPrintQuoteSummary;
