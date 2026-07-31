/**
 * Exact product-card parent matching (maker + model + Ti).
 * Run: npx tsx scripts/verify-product-card-parent-match.ts
 */
import assert from 'node:assert/strict';
import {
  extractProductMaker,
  findExactProductCardParent,
  productCardIdentityFingerprint,
  resolveProductCardGalleryOwner,
} from '../utils/productCardParentMatch';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    buyDate: '2024-01-01',
    category: 'Components',
    subCategory: 'Graphics Cards',
    status: ItemStatus.SOLD,
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

assert.equal(extractProductMaker({ name: 'ASUS Dual GTX 1080 8GB' }), 'asus');
assert.equal(extractProductMaker({ name: 'MSI Gaming X GTX 1080 Ti' }), 'msi');
assert.equal(
  productCardIdentityFingerprint({ name: 'ASUS Dual GTX 1080 8GB' }),
  'asus|gpu:gtx1080'
);
assert.equal(
  productCardIdentityFingerprint({ name: 'ASUS Dual GTX 1080 Ti 11GB' }),
  'asus|gpu:gtx1080ti'
);
assert.notEqual(
  productCardIdentityFingerprint({ name: 'ASUS Dual GTX 1080 8GB' }),
  productCardIdentityFingerprint({ name: 'ASUS Dual GTX 1080 Ti 11GB' })
);

const inventory = [
  item({ id: 'old-asus-1080', name: 'ASUS Dual GTX 1080 8GB', buyDate: '2023-01-01', status: ItemStatus.SOLD }),
  item({ id: 'msi-1080', name: 'MSI Armor GTX 1080 8GB', buyDate: '2023-06-01', status: ItemStatus.SOLD }),
  item({ id: 'asus-1080ti', name: 'ASUS ROG GTX 1080 Ti', buyDate: '2023-03-01', status: ItemStatus.SOLD }),
];

const draft = item({
  id: 'draft-new',
  name: 'ASUS Dual GTX 1080 8GB OC',
  buyDate: '2026-07-01',
  status: ItemStatus.IN_STOCK,
});

const parent = findExactProductCardParent(inventory, draft);
assert.ok(parent);
assert.equal(parent!.id, 'old-asus-1080');

const owner = resolveProductCardGalleryOwner(inventory, draft);
assert.equal(owner.ownerId, 'old-asus-1080');
assert.equal(owner.isSharedParent, true);

const wrongMaker = findExactProductCardParent(inventory, item({ id: 'x', name: 'MSI Armor GTX 1080 8GB' }));
assert.equal(wrongMaker?.id, 'msi-1080');

const tiMismatch = findExactProductCardParent(
  inventory,
  item({ id: 'y', name: 'ASUS Strix GTX 1080 Ti 11GB' })
);
assert.equal(tiMismatch?.id, 'asus-1080ti');

const noMaker = productCardIdentityFingerprint({ name: 'GTX 1080 8GB' });
assert.equal(noMaker, null);

console.log('verify-product-card-parent-match: ok');
