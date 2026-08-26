import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { formatEUR } from '../utils/formatMoney';
import type { SaleColumnSplit } from '../utils/saleProceeds';
import type { HubMarginMathCheck } from '../utils/replaceItemSaleProceedsFromHub';
import { HubSellSplitLedger } from './HubSellSplitLedger';

type Props = {
  split: SaleColumnSplit;
  marginCheck: HubMarginMathCheck | null;
  className?: string;
};

/** Hub sell ledger + tick when net − buy = margin. */
export function HubSellCellContent({ split, marginCheck, className = '' }: Props) {
  return (
    <div className={`flex items-start gap-2.5 min-w-0 w-fit mx-auto text-left ${className}`.trim()}>
      <HubSellSplitLedger split={split} className="min-w-0" />
      {marginCheck?.expectedMarginEur != null ? (
        <span
          className="shrink-0 pl-0.5 pr-1 self-start"
          aria-hidden
          title={
            marginCheck.matches
              ? `Net − buy = margin (€${formatEUR(marginCheck.expectedMarginEur!)})`
              : marginCheck.storedMarginEur != null
                ? `Expected margin €${formatEUR(marginCheck.expectedMarginEur!)} · stored €${formatEUR(marginCheck.storedMarginEur)}`
                : `Expected margin €${formatEUR(marginCheck.expectedMarginEur!)}`
          }
        >
          {marginCheck.matches ? (
            <Check size={14} strokeWidth={2.75} className="text-emerald-600 mt-0.5" />
          ) : (
            <AlertTriangle size={14} strokeWidth={2.25} className="text-amber-600 mt-0.5" />
          )}
        </span>
      ) : null}
    </div>
  );
}

export default HubSellCellContent;
