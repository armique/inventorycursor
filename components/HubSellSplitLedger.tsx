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
  className?: string;
};

/**
 * Hub sell column — mirrors the eBay order payout block:
 * total received, each deduction, then net income (Bestelleinnahmen).
 */
export function HubSellSplitLedger({ split, className = '' }: Props) {
  const hasNet = split.netEur != null && Number.isFinite(split.netEur);

  return (
    <div
      className={`${INV_MONEY_LEDGER} ${className}`.trim()}
      title="Seller Hub: total received, deductions, net income (Bestelleinnahmen)"
    >
      <span className={INV_MONEY_RECEIVED}>€{formatEUR(split.totalEur)}</span>
      {split.shippingEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_SHIPPING}>
          −€{formatEUR(split.shippingEur)} delivery
        </span>
      ) : null}
      {split.ebayFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_EBAY}>−€{formatEUR(split.ebayFeeEur)} eBay</span>
      ) : null}
      {split.adFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_AD}>−€{formatEUR(split.adFeeEur)} ads</span>
      ) : null}
      {split.otherFeeEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_OTHER}>−€{formatEUR(split.otherFeeEur)} other</span>
      ) : null}
      {split.refundEur >= 0.01 ? (
        <span className={INV_MONEY_DEDUCTION_REFUND}>−€{formatEUR(split.refundEur)} refund</span>
      ) : null}
      {hasNet ? (
        <span className={invMoneyNetClass(split.netEur)}>
          {split.netEur! < 0 ? '−' : ''}€{formatEUR(Math.abs(split.netEur!))}
        </span>
      ) : null}
    </div>
  );
}

export default HubSellSplitLedger;
