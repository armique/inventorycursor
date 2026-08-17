/**
 * Open eBay order lines disappear once an inventory item is linked.
 * Run: npx tsx scripts/verify-ebay-open-orders.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { buildOpenEbayOrderLines } from '../utils/ebayOpenOrders';

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

console.log('verify-ebay-open-orders: all checks passed');
