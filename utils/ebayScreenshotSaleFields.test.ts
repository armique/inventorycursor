import { describe, expect, it } from 'vitest';
import { ebayScreenshotSaleFields } from './ebayScreenshotSaleFields';
import type { ParsedEbayOrderScreenshot } from '../services/ebayOrderScreenshotAI';

function base(partial: Partial<ParsedEbayOrderScreenshot> = {}): ParsedEbayOrderScreenshot {
  return {
    ebayOrderId: null,
    ebayUsername: null,
    buyerFullName: null,
    shippingAddress: null,
    ...partial,
  };
}

describe('ebayScreenshotSaleFields', () => {
  it('uses sold price ex shipping as the primary amount and totals fees', () => {
    const money = ebayScreenshotSaleFields(
      base({
        soldPriceExShippingEur: 189,
        buyerShippingEur: 6.49,
        ebayFeeEur: 18.9,
        adFeeEur: 12.5,
        amountReceivedNetEur: 157.6,
      })
    );
    expect(money.soldPriceExShippingEur).toBe(189);
    expect(money.totalFeesEur).toBeCloseTo(31.4);
    expect(money.hasFee).toBe(true);
    expect(money.amountReceivedNetEur).toBeCloseTo(157.6);
  });

  it('does not fall back to Auszahlung when sold price is missing', () => {
    const money = ebayScreenshotSaleFields(
      base({
        amountReceivedNetEur: 100,
        ebayFeeEur: 10,
      })
    );
    expect(money.soldPriceExShippingEur).toBeNull();
    expect(money.totalFeesEur).toBe(10);
  });
});
