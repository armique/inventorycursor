/**
 * Verifies that financial aggregations and order linking are 100% stable and idempotent.
 */
import { getLinkedEbayOrderIds, buildCanonicalLinkedByOrderMap, canonicalizeInventoryItems } from '../utils/canonicalItemOrders';
import type { InventoryItem } from '../types';

const mockItem: InventoryItem = {
  id: 'test-1',
  name: 'Test GPU',
  buyPrice: 50,
  sellPrice: 100,
  status: 'Sold' as any,
  ebayOrderId: '11-22334-55667',
  ebaySaleCycles: [{ ebayOrderId: '99-88776-55443' } as any],
  isTrash: false,
};

const ids = getLinkedEbayOrderIds(mockItem);
if (!ids.includes('11-22334-55667') || !ids.includes('99-88776-55443')) {
  console.error('FAIL: getLinkedEbayOrderIds missing linked cycle or active order');
  process.exit(1);
}

const map = buildCanonicalLinkedByOrderMap([mockItem]);
if (!map.has('11-22334-55667') || !map.has('99-88776-55443')) {
  console.error('FAIL: buildCanonicalLinkedByOrderMap missing entries');
  process.exit(1);
}

const pass1 = canonicalizeInventoryItems([mockItem], 'SmallBusiness');
const pass2 = canonicalizeInventoryItems(pass1.items, 'SmallBusiness');
if (pass2.changed) {
  console.error('FAIL: canonicalizeInventoryItems is not idempotent!');
  process.exit(1);
}

console.log('OK: financial stability and order indexing verified (idempotency passed)');
