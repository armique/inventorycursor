/**
 * Sold PC/bundle parts follow parent Gesamtbetrag + Hub net.
 * Run: npx tsx scripts/verify-container-child-sold-display.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  containerBuyerTotalForParts,
  containerChildProfitDisplayMap,
  containerChildSoldDisplayMap,
  containerNetTotalForParts,
  expandSoldContainerPriceSync,
  syncSoldContainerFamily,
  withUpdatedContainerSellPrice,
} from '../utils/containerChildSoldDisplay';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id'>): InventoryItem {
  return {
    name: partial.name || partial.id,
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    buyDate: '2025-01-01',
    sellDate: '2026-08-01',
    ...partial,
  } as InventoryItem;
}

const ram1 = item({
  id: 'ram-1',
  name: 'Samsung DDR4 8GB',
  buyPrice: 6.88,
  sellPrice: 50.71,
  profit: 35.09,
  parentContainerId: 'pc-1',
});
const ram2 = item({
  id: 'ram-2',
  name: 'Samsung DDR4 8GB',
  buyPrice: 6.88,
  sellPrice: 50.71,
  profit: 35.09,
  parentContainerId: 'pc-1',
});
const cpu = item({
  id: 'cpu-1',
  name: 'Intel Core i9-9900K',
  buyPrice: 9.15,
  sellPrice: 67.44,
  profit: 46.67,
  parentContainerId: 'pc-1',
});
const mb = item({
  id: 'mb-1',
  name: 'ASUS Prime Z390-A',
  buyPrice: 19.83,
  sellPrice: 146.15,
  profit: 101.13,
  parentContainerId: 'pc-1',
});
const children = [ram1, ram2, cpu, mb];
const container = item({
  id: 'pc-1',
  name: 'PC - ASUS Z390-A - i9-9900K - 16GB',
  isPC: true,
  componentIds: children.map((c) => c.id),
  buyPrice: 42.74,
  sellPrice: 322.69,
  profit: 0,
  saleProceeds: {
    capturedAt: '2026-08-01T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 322.69,
    netPayoutEur: 260.7,
    shippingLabelEur: 7.69,
    transactionFeeEur: 19.74,
    adFeeEur: 34.56,
  },
});
const catalog = [container, ...children];

assert.equal(containerBuyerTotalForParts(container, children), 322.69);
assert.equal(containerNetTotalForParts(container, children), 260.7);

const sold = containerChildSoldDisplayMap(container, children);
const profits = containerChildProfitDisplayMap(container, children);
const soldSum = Math.round([...sold.values()].reduce((s, n) => s + n, 0) * 100) / 100;
const profitSum = Math.round([...profits.values()].reduce((s, n) => s + n, 0) * 100) / 100;
assert.equal(soldSum, 322.69);
assert.equal(profitSum, 217.96);
assert.ok(Math.abs((profits.get('ram-1') || 0) - 35.09) < 0.03, 'RAM margin follows net − EK');

const synced = syncSoldContainerFamily(container, children);
const persistedSold = Math.round(synced.children.reduce((s, c) => s + (c.sellPrice || 0), 0) * 100) / 100;
const persistedProfit = Math.round(synced.children.reduce((s, c) => s + (c.profit || 0), 0) * 100) / 100;
assert.equal(persistedSold, 322.69);
assert.equal(persistedProfit, 217.96);
assert.notEqual(synced.children[0].sellPrice, 50.71);

const afterSell = expandSoldContainerPriceSync(
  { ...container, sellPrice: 400 },
  'sellPrice',
  catalog
);
const soldParent = afterSell.find((i) => i.id === 'pc-1')!;
assert.equal(soldParent.sellPrice, 400);
assert.equal(soldParent.saleProceeds?.buyerTotalEur, 400);
assert.equal(soldParent.saleProceeds?.netPayoutEur, 338.01);
const afterSellKids = afterSell.filter((i) => i.id !== 'pc-1');
assert.equal(afterSellKids.length, 4);
assert.equal(
  Math.round(afterSellKids.reduce((s, c) => s + (c.sellPrice || 0), 0) * 100) / 100,
  400
);
assert.equal(
  Math.round(afterSellKids.reduce((s, c) => s + (c.profit || 0), 0) * 100) / 100,
  295.27
);

const afterBuy = expandSoldContainerPriceSync({ ...ram1, buyPrice: 16.88 }, 'buyPrice', catalog);
const buyParent = afterBuy.find((i) => i.id === 'pc-1')!;
assert.equal(buyParent.buyPrice, 52.74);
const afterBuySold = Math.round(
  afterBuy.filter((i) => i.id !== 'pc-1').reduce((s, c) => s + (c.sellPrice || 0), 0) * 100
) / 100;
assert.equal(afterBuySold, 322.69);
const ramAfterBuy = afterBuy.find((i) => i.id === 'ram-1')!;
const ram2AfterBuy = afterBuy.find((i) => i.id === 'ram-2')!;
assert.ok(
  (ramAfterBuy.sellPrice || 0) > (ram2AfterBuy.sellPrice || 0),
  'higher EK must take a larger sold share'
);

const scaledBuy = expandSoldContainerPriceSync({ ...container, buyPrice: 80 }, 'buyPrice', catalog);
assert.equal(scaledBuy.find((i) => i.id === 'pc-1')!.buyPrice, 80);
assert.equal(
  Math.round(scaledBuy.filter((i) => i.id !== 'pc-1').reduce((s, c) => s + (c.buyPrice || 0), 0) * 100) / 100,
  80
);

const touched = new Set(afterSell.map((i) => i.id));
assert.ok(touched.has('pc-1') && touched.has('ram-1') && touched.has('mb-1'));
assert.equal(touched.size, 5, 'only this sold family is rewritten');

const rewritten = withUpdatedContainerSellPrice(container, 322.69);
assert.equal(rewritten.saleProceeds?.netPayoutEur, 260.7);

console.log(
  `verify-container-child-sold-display: ok (sold €${soldSum}, margin €${profitSum}, RAM €${sold.get('ram-1')} / +€${profits.get('ram-1')})`
);
