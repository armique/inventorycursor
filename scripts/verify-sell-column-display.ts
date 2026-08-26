/**
 * Sell cell must show distinct total vs net + deduction count after Hub apply.
 * Run: npx tsx scripts/verify-sell-column-display.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { applyHubPayoutBreakdownToSoldItem } from '../utils/replaceItemSaleProceedsFromHub';
import { resolveSellColumnSplit, sellColumnSplitHasDistinctNet } from '../utils/sellColumnDisplay';

const order = {
  orderId: '08-14793-62151',
  creationDate: '2026-06-19',
  buyer: { username: 'ropah-3038' },
  lineItems: [
    { sku: 'a', title: 'a', lineItemCost: 24.37 },
    { sku: 'b', title: 'b', lineItemCost: 5.67 },
  ],
  grossTotal: 39.85,
  netTotal: 17.79,
  sources: ['hub'],
  importedAt: '',
  financialEvents: [
    { id: '1', date: '', kind: 'sale', amount: 39.85, transactionType: 'Bestellung', source: 'hub', importedAt: '' },
    { id: '2', date: '', kind: 'fee', amount: -1.2, transactionType: 'Transaktionsgebühren', source: 'hub', importedAt: '' },
    { id: '3', date: '', kind: 'fee', amount: -0.8, transactionType: 'Anzeigengebühr Basis', source: 'hub', importedAt: '' },
    { id: '4', date: '', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '' },
    { id: '5', date: '', kind: 'fee', amount: -13.87, transactionType: 'Transaktionsgebühren', source: 'hub', importedAt: '' },
  ],
} as EbayOrderRecord;

const bundle = {
  id: 'b1',
  name: '2x SSD',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2026-06-19',
  sellPrice: 30.04,
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '08-14793-62151',
} as InventoryItem;

const p1 = {
  id: 'p1',
  sellPrice: 24.37,
  parentContainerId: 'b1',
  status: ItemStatus.SOLD,
  buyPrice: 12,
  buyDate: '',
  category: '',
  comment1: '',
  comment2: '',
} as InventoryItem;

const p2 = {
  id: 'p2',
  sellPrice: 5.67,
  parentContainerId: 'b1',
  status: ItemStatus.SOLD,
  buyPrice: 2.79,
  buyDate: '',
  category: '',
  comment1: '',
  comment2: '',
} as InventoryItem;

const catalog = [bundle, p1, p2];

const before = resolveSellColumnSplit(bundle, catalog, 'SmallBusiness');
assert.ok(before);
assert.equal(before!.totalEur, 30.04);
assert.equal(sellColumnSplitHasDistinctNet(before), false, 'before hub link, total=net is expected');

const applied = applyHubPayoutBreakdownToSoldItem(
  bundle,
  order,
  { sku: 'a', title: 'x', lineItemCost: 30.04 },
  'SmallBusiness',
  catalog
);
const nextCatalog = catalog.map((i) => (i.id === 'b1' ? applied : i));

const after = resolveSellColumnSplit(applied, nextCatalog, 'SmallBusiness');
assert.ok(after);
assert.equal(after!.totalEur, 39.85, 'after hub apply — total received');
assert.equal(after!.netEur, 30.04, 'after hub apply — net pocket');
assert.equal(sellColumnSplitHasDistinctNet(after), true);
assert.equal(after!.shippingEur, 6.19);
assert.equal(after!.ebayFeeEur, 3.62);

console.log('verify-sell-column-display: ok');
