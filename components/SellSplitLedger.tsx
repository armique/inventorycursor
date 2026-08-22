import React from 'react';
import { formatEUR } from '../utils/formatMoney';
import type { SaleColumnSplit } from '../utils/saleProceeds';

type Props = {
  split: SaleColumnSplit;
  /**
   * When false, marketplace fee rows are not counted toward “N deductions”
   * (ship / refund still count). Kept for parity with the Price breakdown toggle.
   */
  showFees: boolean;
  className?: string;
};

function countDeductions(split: SaleColumnSplit, showFees: boolean): number {
  let n = 0;
  if (showFees && split.adFeeEur >= 0.01) n += 1;
  if (showFees && split.ebayFeeEur >= 0.01) n += 1;
  if (showFees && split.otherFeeEur >= 0.01) n += 1;
  if (split.shippingEur >= 0.01) n += 1;
  if (split.refundEur >= 0.01) n += 1;
  return n;
}

/**
 * Sell-cell pair (variant K): buyer paid + net income, same type size, monochrome.
 * Fee detail stays in the Sell click popover — only a quiet deduction count here.
 */
export function SellSplitLedger({ split, showFees, className = '' }: Props) {
  const netEur = split.netEur;
  const deductions = countDeductions(split, showFees);
  const hasNet = netEur != null && Number.isFinite(netEur);

  return (
    <div
      className={`flex w-full min-w-[5.5rem] max-w-[6.75rem] flex-col gap-0.5 tabular-nums text-[11px] leading-snug ${className}`.trim()}
      title={
        hasNet
          ? 'Buyer paid and net income (Bestelleinnahmen). Click for full fee breakdown. Margin is in the Margin column.'
          : 'Buyer paid. Click for fee breakdown when available.'
      }
    >
      <span className="font-semibold text-slate-900">€{formatEUR(split.totalEur)}</span>
      {hasNet ? (
        <span className="font-semibold text-slate-900">
          {netEur! < 0 ? '−' : ''}€{formatEUR(Math.abs(netEur!))} net
        </span>
      ) : null}
      {deductions > 0 ? (
        <span className="font-medium text-slate-400">
          {deductions} deduction{deductions === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );
}

export default SellSplitLedger;
