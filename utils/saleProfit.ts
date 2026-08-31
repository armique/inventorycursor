import type { TaxMode } from '../types';

/** Pure clean profit formula: Sell Price - Buy Price - Fees */
export function calculateSaleProfit(sell: number, buy: number, fee: number, _taxMode?: TaxMode): number {
  return (Number(sell) || 0) - (Number(buy) || 0) - (Number(fee) || 0);
}

