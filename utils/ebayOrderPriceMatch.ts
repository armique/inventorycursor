import type { LinePayout } from './ebayOrderPayout';

const PRICE_EXACT = 0.03;
const PRICE_VERY_CLOSE = 0.1;
const PRICE_CLOSE = 0.5;

/** Score boost when inventory sell price aligns with order line payout (net or gross). */
export function sellPriceMatchBonus(itemSell: number, payout: LinePayout): number {
  if (!Number.isFinite(itemSell) || itemSell <= 0) return 0;

  const refs = new Set<number>();
  if (Number.isFinite(payout.sellPrice) && payout.sellPrice > 0) refs.add(payout.sellPrice);
  if (payout.net != null && payout.net > 0) refs.add(payout.net);
  if (payout.gross != null && payout.gross > 0) refs.add(payout.gross);

  let best = 0;
  for (const ref of refs) {
    const delta = Math.abs(itemSell - ref);
    if (delta <= PRICE_EXACT) best = Math.max(best, 100);
    else if (delta <= PRICE_VERY_CLOSE) best = Math.max(best, 85);
    else if (delta <= PRICE_CLOSE) best = Math.max(best, 55);
    else if (delta <= 2) best = Math.max(best, 25);
  }
  return best;
}

export function sellPriceAlignsWithPayout(itemSell: number, payout: LinePayout): boolean {
  return sellPriceMatchBonus(itemSell, payout) >= 85;
}
