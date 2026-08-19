/**
 * Open eBay order lines disappear once an inventory item is linked.
 * Run: npx tsx scripts/verify-ebay-open-orders.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import {
  buildOpenEbayOrderLines,
  findItemsForOpenOrderLine,
  listOpenEbayOrderLines,
} from '../utils/ebayOpenOrders';
import { isStrongEbayOrderMatch, listEbayOrdersForItemSale } from '../utils/ebayOrderMatch';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 50,
    buyDate: '2026-01-01',
    category: 'GPU',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

const rtxOrder: EbayOrderRecord = {
  orderId: 'ord-rtx',
  creationDate: '2026-08-10',
  buyer: { username: 'buyer1' },
  lineItems: [{ sku: 'SKU-3070', title: 'ASUS Dual RTX 3070 8GB', lineItemCost: 220 }],
  sources: ['api'],
  importedAt: '2026-08-10T12:00:00.000Z',
};

const otherOrder: EbayOrderRecord = {
  orderId: 'ord-other',
  creationDate: '2026-08-11',
  buyer: { username: 'buyer2' },
  lineItems: [{ sku: null, title: 'Kingston 16GB DDR4', lineItemCost: 28 }],
  sources: ['api'],
  importedAt: '2026-08-11T12:00:00.000Z',
};

const gpu = item({ id: 'gpu-1', name: 'ASUS Dual RTX 3070 8GB GDDR6', ebaySku: 'SKU-3070' });
const ram = item({ id: 'ram-1', name: 'Kingston Fury 16GB DDR4' });

const open = buildOpenEbayOrderLines([gpu, ram], [rtxOrder, otherOrder]);
assert.equal(open.length, 2);
const rtxRow = open.find((r) => r.order.orderId === 'ord-rtx');
assert.ok(rtxRow);
assert.ok(rtxRow.suggestions.some((s) => s.item.id === 'gpu-1'));

const sold = applyEbayOrderMatchToItem(
  gpu,
  {
    order: rtxOrder,
    lineItem: rtxOrder.lineItems[0],
    matchScore: 900,
    matchKind: 'sku',
  },
  'SmallBusiness'
);
assert.equal(sold.status, ItemStatus.SOLD);
assert.equal(sold.ebayOrderId, 'ord-rtx');
assert.equal(sold.platformSold, 'ebay.de');

const after = buildOpenEbayOrderLines([sold, ram], [rtxOrder, otherOrder]);
assert.equal(after.length, 1);
assert.equal(after[0].order.orderId, 'ord-other');
assert.ok(!after.some((r) => r.order.orderId === 'ord-rtx'));
assert.ok(sold.ebayOrderLineKey);

const renamedSold = { ...sold, name: 'Box 12 — misc parts' };
const renamedOpen = listOpenEbayOrderLines([renamedSold, ram], [rtxOrder, otherOrder]);
assert.ok(
  !renamedOpen.some((r) => r.order.orderId === 'ord-rtx'),
  'already-linked sold item must hide its order even if the title no longer matches'
);

const otherGpu = item({
  id: 'gpu-2',
  name: 'ASUS Dual RTX 3070 8GB GDDR6',
  ebaySku: 'SKU-3070',
});
const suggestionsAfterSold = findItemsForOpenOrderLine(
  rtxOrder.lineItems[0],
  rtxOrder,
  [sold, otherGpu, ram]
);
assert.ok(
  !suggestionsAfterSold.some((s) => s.item.id === 'gpu-1'),
  'already-sold linked item must not appear in bind suggestions'
);

const soldStillLooksLikeStock = {
  ...sold,
  status: ItemStatus.IN_STOCK,
};
const suggestionsSoldInStockShape = findItemsForOpenOrderLine(
  otherOrder.lineItems[0],
  otherOrder,
  [soldStillLooksLikeStock, ram]
);
assert.ok(
  !suggestionsSoldInStockShape.some((s) => s.item.id === 'gpu-1'),
  'item already linked to another order must not be suggested even if status is still In Stock'
);

const linkedViaExternalId = item({
  id: 'ram-linked',
  name: 'Kingston Fury 16GB DDR4',
  status: ItemStatus.IN_STOCK,
  externalOrderId: '01-11111-22222',
});
const suggestionsExternal = findItemsForOpenOrderLine(
  otherOrder.lineItems[0],
  otherOrder,
  [linkedViaExternalId]
);
assert.equal(
  suggestionsExternal.length,
  0,
  'in-stock row with externalOrderId must not be suggested'
);

const soldPc = item({
  id: 'pc-1',
  name: 'Office PC',
  isPC: true,
  status: ItemStatus.SOLD,
  ebayOrderId: 'ord-pc',
});
const pcRam = item({
  id: 'pc-ram',
  name: 'Kingston Fury 16GB DDR4',
  parentContainerId: 'pc-1',
  status: ItemStatus.IN_STOCK,
});
const suggestionsPcChild = findItemsForOpenOrderLine(
  otherOrder.lineItems[0],
  otherOrder,
  [soldPc, pcRam]
);
assert.ok(
  !suggestionsPcChild.some((s) => s.item.id === 'pc-ram'),
  'part of a sold/linked PC must not be suggested for another order'
);

const childWithContainerDate = item({
  id: 'child-sold-date',
  name: 'Kingston Fury 16GB DDR4',
  status: ItemStatus.IN_STOCK,
  containerSoldDate: '2026-08-10',
});
const suggestionsContainerDate = findItemsForOpenOrderLine(
  otherOrder.lineItems[0],
  otherOrder,
  [childWithContainerDate]
);
assert.equal(
  suggestionsContainerDate.length,
  0,
  'row with containerSoldDate must not be suggested'
);

const twoLine: EbayOrderRecord = {
  orderId: 'ord-two',
  creationDate: '2026-08-12',
  buyer: { username: 'buyer4' },
  lineItems: [
    { sku: 'SKU-A', title: 'Item A', lineItemCost: 10 },
    { sku: 'SKU-B', title: 'Item B', lineItemCost: 20 },
  ],
  sources: ['api'],
  importedAt: '2026-08-12T12:00:00.000Z',
};
const soldA = applyEbayOrderMatchToItem(
  item({ id: 'a-1', name: 'Something else entirely', ebaySku: 'SKU-A' }),
  {
    order: twoLine,
    lineItem: twoLine.lineItems[0],
    matchScore: 900,
    matchKind: 'sku',
  },
  'SmallBusiness'
);
const twoOpen = listOpenEbayOrderLines([soldA], [twoLine]);
assert.equal(twoOpen.length, 1);
assert.equal(twoOpen[0].lineItem.sku, 'SKU-B');

const cheap = listOpenEbayOrderLines([gpu, ram], [rtxOrder, otherOrder]);
assert.equal(cheap.length, 2);
assert.ok(cheap.every((r) => r.suggestions.length === 0));

const today = new Date().toISOString().slice(0, 10);
const recentUnrelated: EbayOrderRecord = {
  orderId: 'ord-recent',
  creationDate: today,
  buyer: { username: 'buyer3' },
  lineItems: [{ sku: null, title: 'Completely unrelated garden hose', lineItemCost: 12 }],
  sources: ['api'],
  importedAt: `${today}T12:00:00.000Z`,
};
const stock = Array.from({ length: 80 }, (_, i) =>
  item({ id: `stock-${i}`, name: `Generic PC part ${i}` })
);
const recentSuggestions = findItemsForOpenOrderLine(
  recentUnrelated.lineItems[0],
  recentUnrelated,
  stock
);
assert.equal(
  recentSuggestions.length,
  0,
  'recency-only must not suggest every in-stock item'
);

const toshibaStock = item({ id: 'hdd-toshiba', name: 'Toshiba 1TB HDD' });
const toshibaOrder: EbayOrderRecord = {
  orderId: 'ord-toshiba',
  creationDate: '2026-08-18',
  buyer: { username: 'hdd-buyer' },
  lineItems: [{ sku: null, title: 'TOSHIBA 1TB 3.5" SATA Internal HDD Hard Drive', lineItemCost: 32 }],
  sources: ['api'],
  importedAt: '2026-08-18T12:00:00.000Z',
};
const newerUnrelated: EbayOrderRecord = {
  orderId: 'ord-newer-ram',
  creationDate: '2026-08-19',
  buyer: { username: 'ram-buyer' },
  lineItems: [{ sku: null, title: 'Kingston 16GB DDR4 Desktop RAM', lineItemCost: 28 }],
  sources: ['api'],
  importedAt: '2026-08-19T12:00:00.000Z',
};
const saleList = listEbayOrdersForItemSale(toshibaStock, [newerUnrelated, toshibaOrder, otherOrder]);
assert.equal(saleList[0]?.order.orderId, 'ord-toshiba', 'Toshiba 1TB HDD must rank above newer unrelated orders');
assert.ok(isStrongEbayOrderMatch(saleList[0]), 'Toshiba title match must be Bind · sold strength');

const boundToshiba = applyEbayOrderMatchToItem(
  toshibaStock,
  {
    order: toshibaOrder,
    lineItem: toshibaOrder.lineItems[0],
    matchScore: saleList[0].matchScore,
    matchKind: 'title',
  },
  'SmallBusiness'
);
assert.equal(boundToshiba.ebayOrderId, 'ord-toshiba');
const afterToshibaClaim = listEbayOrdersForItemSale(
  item({ id: 'hdd-toshiba-2', name: 'Toshiba 1TB HDD' }),
  [toshibaOrder, newerUnrelated],
  { claimedKeys: [boundToshiba.ebayOrderLineKey || ''] }
);
assert.ok(
  !afterToshibaClaim.some((m) => m.order.orderId === 'ord-toshiba'),
  'already-bound Toshiba order must not appear for a second stock row'
);

console.log('verify-ebay-open-orders: all checks passed');
