/**
 * Verify Buy Helper fee / VAT / max-buy math.
 * Run: npx tsx scripts/verify-buy-helper.ts
 */
import assert from 'node:assert/strict';
import {
  analyzeBuyHelperItem,
  channelNet,
  maxBuyForNetMargin,
  pocketFromEbayList,
  type BuyHelperFees,
  type BuyHelperItem,
} from '../utils/buyHelper';

const fees: BuyHelperFees = { ebayFeePct: 12.5, ebayAdsPct: 12.5, vatOnProfitPct: 19 };

// eBay 100 list → 75 pocket after 25% cut
assert.equal(pocketFromEbayList(100, fees), 75);

// Max buy for 35% net margin after 19% VAT on profit, pocket 75:
// buy = 75 * 0.81 / (0.35 + 0.81) = 60.75 / 1.16 ≈ 52.37
const maxBuy = maxBuyForNetMargin(75, 35, 19);
assert.ok(maxBuy > 52 && maxBuy < 53, `maxBuy=${maxBuy}`);

const ebayNet = channelNet(100, maxBuy, 'ebay', fees, 35);
assert.ok(ebayNet.hitsMargin, `margin=${ebayNet.marginPct}`);
assert.ok(ebayNet.marginPct >= 34.5 && ebayNet.marginPct <= 36, `margin=${ebayNet.marginPct}`);

const item: BuyHelperItem = {
  id: 't1',
  query: 'RTX 3060 12GB',
  category: 'GPU',
  buyPrice: maxBuy,
  sellKa: 75,
  sellEbay: 100,
  desiredMarginPct: 35,
  createdAt: new Date().toISOString(),
};
const analysis = analyzeBuyHelperItem(item, fees);
assert.equal(analysis.verdict, 'BUY');

const tooExpensive: BuyHelperItem = { ...item, buyPrice: 70 };
assert.equal(analyzeBuyHelperItem(tooExpensive, fees).verdict, 'SKIP');

console.log('verify-buy-helper: ok');
