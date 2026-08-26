import React from 'react';
import { formatEUR } from '../utils/formatMoney';
import type { SaleColumnSplit } from '../utils/saleProceeds';
import {
  INV_MONEY_DEDUCTION_AD,
  INV_MONEY_DEDUCTION_EBAY,
  INV_MONEY_DEDUCTION_OTHER,
  INV_MONEY_DEDUCTION_REFUND,
  INV_MONEY_DEDUCTION_SHIPPING,
  INV_MONEY_LEDGER,
  INV_MONEY_RECEIVED,
  invMoneyNetClass,
} from './inventoryMoneyColumnStyles';

type Props = {
  split: SaleColumnSplit;
  /**
   * When false, marketplace fee rows are hidden (ship / refund still shown).
   * Kept for parity with the Price breakdown toggle.
   */
  showFees: boolean;
  /** When true, every deduction line (shipping, refund, eBay/ad/other fees) is hidden —
   *  only the sell price and the net pocket value remain. Overrides showFees. */
  hideDeductions?: boolean;
  className?: string;
};

/**
 * Sell cell: total received, colored deductions, then net income (Bestelleinnahmen).
 */
export function SellSplitLedger({ split, showFees, hideDeductions = false, className = '' }: Props) {
  const netEur = split.netEur;
  const hasDistinctNet =
    netEur != null && Number.isFinite(netEur) && Math.abs(split.totalEur - netEur) >= 0.02;

  return (
    <div
      className={`${INV_MONEY_LEDGER} max-w-[6.75rem] ${className}`.trim()}
      title={
        hasDistinctNet
          ? 'Total received and net income (Bestelleinnahmen). Click for full fee breakdown. Margin is in the Margin column.'
          : 'Buyer paid. Click for fee breakdown when available.'
      }
    >
      <span className={INV_MONEY_RECEIVED}>€{formatEUR(split.totalEur)}</span>
      {!hideDeductions && split.shippingEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_SHIPPING}>
          −€{formatEUR(split.shippingEur)} delivery
        </span>
      ) : null}
      {!hideDeductions && showFees && split.ebayFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_EBAY}>−€{formatEUR(split.ebayFeeEur)} eBay</span>
      ) : null}
      {!hideDeductions && showFees && split.adFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_AD}>−€{formatEUR(split.adFeeEur)} ads</span>
      ) : null}
      {!hideDeductions && showFees && split.otherFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_OTHER}>−€{formatEUR(split.otherFeeEur)} other</span>
      ) : null}
      {!hideDeductions && split.refundEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_REFUND}>−€{formatEUR(split.refundEur)} refund</span>
      ) : null}
      {hasDistinctNet ? (
        <span className={invMoneyNetClass(netEur)}>
          {netEur! < 0 ? '−' : ''}€{formatEUR(Math.abs(netEur!))}
        </span>
      ) : null}
    </div>
  );
}

export default SellSplitLedger;
