import type { TaxMode } from '../types';

/**
 * Cash in pocket: Sell Price − Buy Price − Fees. No VAT is deducted, in any mode.
 *
 * `taxMode` is accepted and IGNORED, deliberately. It used to divide by 1.19 for
 * RegularVAT and take 19% of the margin for DifferentialVAT (§25a); that was
 * removed in df4a0ad and the owner confirmed on 2026-08-31 that it should stay
 * removed — VAT is worked out by their Steuerberater, outside this app.
 *
 * So do not "restore" the VAT branches on the assumption this is a regression.
 * On 2026 figures, reinstating §25a here would move reported profit by roughly
 * €2,700 (see scripts/analyze-differential-vat-gap.ts). verify-critical-flows
 * asserts that every tax mode returns the same number, so a reintroduced branch
 * fails the suite rather than silently restating every sale.
 *
 * The parameter is kept only because ~8 call sites pass it; it has no effect.
 */
export function calculateSaleProfit(sell: number, buy: number, fee: number, _taxMode?: TaxMode): number {
  return (Number(sell) || 0) - (Number(buy) || 0) - (Number(fee) || 0);
}

