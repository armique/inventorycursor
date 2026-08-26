import { ItemStatus, type InventoryItem } from '../types';
import {
  detectBrands,
  orderItemBrandCompatible,
  orderItemCategoryCompatible,
  orderItemLinkCompatible,
} from '../utils/orderMatcherCompatibility';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(detectBrands('Corsair Vengeance 16GB DDR4 RAM').includes('corsair'), 'detect corsair');
assert(detectBrands('Kingston Fury Beast 32GB').includes('kingston'), 'detect kingston');

const corsairRam: InventoryItem = {
  id: '1',
  name: 'Corsair Vengeance LPX 16GB DDR4',
  buyPrice: 20,
  buyDate: '2026-01-01',
  category: 'RAM',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};

const kingstonRam: InventoryItem = {
  ...corsairRam,
  id: '2',
  name: 'Kingston Fury Beast 16GB DDR4',
};

const intelCpu: InventoryItem = {
  ...corsairRam,
  id: '3',
  name: 'Intel Core i7-12700K',
  category: 'CPU',
};

const orderCorsairRam = 'Corsair Vengeance RGB 16GB DDR4 3200MHz RAM';

assert(orderItemBrandCompatible(orderCorsairRam, corsairRam), 'corsair order + corsair item');
assert(!orderItemBrandCompatible(orderCorsairRam, kingstonRam), 'corsair order blocks kingston');
assert(orderItemCategoryCompatible(orderCorsairRam, corsairRam), 'ram order + ram item');
assert(!orderItemCategoryCompatible(orderCorsairRam, intelCpu), 'ram order blocks cpu');
assert(orderItemLinkCompatible(orderCorsairRam, corsairRam), 'full compatible link');
assert(!orderItemLinkCompatible(orderCorsairRam, kingstonRam), 'brand blocks link');
assert(!orderItemLinkCompatible(orderCorsairRam, intelCpu), 'category blocks link');

console.log('verify-order-matcher: ok');
