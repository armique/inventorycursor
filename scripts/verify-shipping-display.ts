/**
 * Verify seller-paid shipping surfaces in the display helpers the same way marketplace fees do.
 * Run: npx tsx scripts/verify-shipping-display.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  getItemDisplayShippingAmount,
  getSoldContainerDisplayTotals,
} from '../services/financialAggregation';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Storage',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

// Plain sold item, no shipping recorded -> 0.
const noShip = item({ id: 'a', name: 'SSD', sellPrice: 50, sellDate: '2026-02-01' });
assert.equal(getItemDisplayShippingAmount(noShip, [noShip]), 0);

// Plain sold item with seller-paid shipping -> shows the amount.
const withShip = item({
  id: 'b',
  name: 'GPU',
  sellPrice: 200,
  sellDate: '2026-02-01',
  sellerPaidShipping: true,
  sellerShippingAmount: 7.49,
});
assert.equal(getItemDisplayShippingAmount(withShip, [withShip]), 7.49);
console.log('OK: single sold item surfaces its own shipping deduction');

// Bundle with proportional children (one paid shipping) -> sums child shipping onto the container.
const containerId = 'pc-1';
const child1 = item({
  id: 'c1', name: 'CPU', status: ItemStatus.SOLD, parentContainerId: containerId,
  sellPrice: 100, sellDate: '2026-02-01', sellerPaidShipping: true, sellerShippingAmount: 5,
});
const child2 = item({
  id: 'c2', name: 'RAM', status: ItemStatus.SOLD, parentContainerId: containerId,
  sellPrice: 50, sellDate: '2026-02-01',
});
const container = item({
  id: containerId, name: 'Gaming PC', isPC: true, status: ItemStatus.SOLD,
  componentIds: [child1.id, child2.id],
});
const bundleItems = [container, child1, child2];
assert.equal(getItemDisplayShippingAmount(container, bundleItems), 5);

const totals = getSoldContainerDisplayTotals(container, bundleItems, 'SmallBusiness');
assert.equal(totals.shippingAmount, 5);
assert.equal(totals.sellPrice, 150);
console.log('OK: sold bundle sums child shipping deductions onto the container row');

console.log('\nAll shipping display checks passed.');
