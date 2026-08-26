/**
 * Simulates Hub cell click → apply → Sell cell display for scraped order 08-14793-62151.
 * Run: npx tsx scripts/verify-hub-click-apply-flow.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';
import { saleColumnSplit } from '../utils/saleProceeds';
import {
  buildHubApplyRowForItem,
  buildHubSellDisplayByItemId,
  hubSellSplitDiffersFromItem,
} from '../utils/replaceItemSaleProceedsFromHub';
import { getSoldContainerDisplayTotals, roundMoney } from '../services/financialAggregation';

function resolveSellColumnBuyerTotal(
  item: InventoryItem,
  soldContainerTotals: ReturnType<typeof getSoldContainerDisplayTotals> | null
): number | null {
  const p = item.saleProceeds;
  if (p && !p.feesEstimated && p.source === 'ebay_seller_hub' && p.buyerTotalEur != null) {
    return roundMoney(p.buyerTotalEur);
  }
  const containerSell = soldContainerTotals?.sellPrice;
  if (containerSell != null && containerSell > 0.01) return containerSell;
  const sell = Number(item.sellPrice);
  return sell > 0.01 ? roundMoney(sell) : null;
}

const scrapedOrder: EbayOrderRecord = {
  orderId: '08-14793-62151',
  creationDate: '2026-06-19',
  buyer: { fullName: 'Raphael Otto' },
  lineItems: [
    {
      sku: null,
      title: 'rm4ik hat einen Bewertungspunktestand von 840',
      lineItemCost: 33.66,
    },
  ],
  grossTotal: 39.85,
  netTotal: 30.04,
  financialEvents: [
    { id: '1', date: '2026-06-19', kind: 'sale', amount: 39.85, transactionType: 'Bestellung', source: 'hub', importedAt: '' },
    { id: '2', date: '2026-06-19', kind: 'fee', amount: -3.62, transactionType: 'Transaktionsgebühren', source: 'hub', importedAt: '' },
    { id: '3', date: '2026-06-19', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '' },
  ],
  sources: ['hub'],
  importedAt: '',
};

const bundle: InventoryItem = {
  id: 'bundle-ssd',
  name: '2x 120GB Samsung SSD 840/850 EVO',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2024-04-19',
  sellPrice: 33.66,
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '08-14793-62151',
  platformSold: 'ebay.de',
};

const p1: InventoryItem = {
  id: 'p1',
  name: '120GB SSD SATA',
  buyPrice: 12,
  sellDate: '2024-04-19',
  sellPrice: 24.37,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'bundle-ssd',
  ebayOrderId: '08-14793-62151',
};

const p2: InventoryItem = {
  id: 'p2',
  name: 'Samsung SSD 850 EVO 120GB',
  buyPrice: 2.79,
  sellDate: '2024-04-19',
  sellPrice: 5.67,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'bundle-ssd',
  ebayOrderId: '08-14793-62151',
};

const catalog = [bundle, p1, p2];

const hubSplit = hubSaleColumnSplitForItem(scrapedOrder, bundle, catalog);
assert.ok(hubSellSplitDiffersFromItem(bundle, hubSplit), 'hub must differ from sell before apply');

const beforeDisplay = buildHubSellDisplayByItemId(catalog, [scrapedOrder], 'SmallBusiness');
assert.ok(beforeDisplay.has(bundle.id), 'hub sell cell visible before link');

const applyRow = buildHubApplyRowForItem(bundle, scrapedOrder, 'SmallBusiness', catalog);
const applied = applyRow.nextItem;
const nextCatalog = catalog.map((i) => (i.id === bundle.id ? applied : i));

const afterDisplay = buildHubSellDisplayByItemId(nextCatalog, [scrapedOrder], 'SmallBusiness');
assert.equal(afterDisplay.has(bundle.id), false, 'hub sell cell hidden after link');

const soldTotals = getSoldContainerDisplayTotals(applied, nextCatalog, 'SmallBusiness');
const buyerTotal = resolveSellColumnBuyerTotal(applied, soldTotals);
const sellSplit = saleColumnSplit(applied, { displaySellEur: buyerTotal ?? applied.sellPrice });

assert.equal(buyerTotal, 39.85, 'sell column buyer total after apply');
assert.ok(sellSplit);
assert.equal(sellSplit!.totalEur, 39.85, 'sell split total after apply');
assert.equal(sellSplit!.netEur, 30.04, 'sell split net after apply');

console.log('verify-hub-click-apply-flow: ok');
