import { TaxMode } from '../types';

/** Same profit formula used by SaleModal — kept here so other flows (eBay order apply) can reuse it. */
export function calculateSaleProfit(sell: number, buy: number, fee: number, taxMode: TaxMode): number {
  if (taxMode === 'RegularVAT') {
    const netSell = sell / 1.19;
    return netSell - buy - fee;
  }
  if (taxMode === 'DifferentialVAT') {
    const margin = sell - buy;
    if (margin <= 0) return margin - fee;
    const tax = margin - margin / 1.19;
    return margin - tax - fee;
  }
  return sell - buy - fee;
}
