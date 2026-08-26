/**
 * Verify Samsung EVO 840 refund + cash resale patch.
 * Run: npx tsx scripts/verify-samsung-evo840-refund-resale.ts
 */
import { ItemStatus } from '../types';
import type { InventoryItem } from '../types';
import {
  applySamsungEvo840RefundResale,
  SAMSUNG_EVO840_CASH_BUYER,
  SAMSUNG_EVO840_CASH_SELL,
  SAMSUNG_EVO840_ORDER_ID,
  SAMSUNG_EVO840_REFUND_LOSS,
} from '../utils/applySamsungEvo840RefundResale';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ebaySold: InventoryItem = {
  id: 'test-samsung-evo840',
  name: 'Samsung Samsung EVO 840 SSD 500GB SATA',
  category: 'Components',
  subCategory: 'SSD/HDD',
  buyPrice: 25.63,
  buyDate: '2025-06-01',
  status: ItemStatus.SOLD,
  sellPrice: 59.99,
  sellDate: '2026-08-18',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: SAMSUNG_EVO840_ORDER_ID,
  ebayUsername: 'hafra09',
  customer: { name: 'Franz Haselbeck', address: 'Test' },
  comment1: '',
  comment2: '',
  profit: 17.81,
};

const first = applySamsungEvo840RefundResale([ebaySold]);
assert(first.changed, 'first pass should change item');
const item = first.items[0];
assert(item.status === ItemStatus.SOLD, 'should be sold after cash resale');
assert(item.customer?.name?.includes('Natasha'), 'buyer should be Natasha');
assert(Math.round(item.buyPrice * 100) === Math.round((25.63 + SAMSUNG_EVO840_REFUND_LOSS) * 100), 'EK should include refund loss');
assert(item.sellPrice === SAMSUNG_EVO840_CASH_SELL, 'cash sell price');
assert((item.ebaySaleCycles || []).length >= 1, 'eBay sale archived');
assert(String(item.ebaySaleCycles?.[0]?.ebayOrderId || '').includes(SAMSUNG_EVO840_ORDER_ID), 'archived order id');
assert(!item.ebayOrderId, 'live sale should not keep eBay order id');
assert(String(item.comment2 || '').includes('Returned'), 'return note');
assert(String(item.comment2 || '').includes('Hub Erstattet'), 'refund EK note');

const second = applySamsungEvo840RefundResale(first.items);
assert(!second.changed, 'second pass should be idempotent');

console.log('verify-samsung-evo840-refund-resale: OK');
console.log(`  buyer=${item.customer?.name} sell=€${item.sellPrice} buy=€${item.buyPrice} profit=€${item.profit}`);
