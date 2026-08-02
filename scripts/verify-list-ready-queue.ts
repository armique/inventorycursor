/**
 * List Ready queue checks.
 * Run: npx tsx scripts/verify-list-ready-queue.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildListReadyPlan,
  exportListReadyAgentPayload,
  isListReadyCandidate,
} from '../utils/listReadyQueue';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'GPU',
    buyDate: '2026-06-01',
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

const ready = item({
  id: '1',
  name: 'RTX 3060 12GB',
  buyPrice: 150,
  saleReady: true,
  imageUrl: 'https://example.com/a.jpg',
  imageUrls: ['https://example.com/b.jpg'],
  suggestedKleinListPrice: 220,
  suggestedEbayListPrice: 293,
});

const notReady = item({ id: '2', name: 'Hidden', buyPrice: 10, saleReady: false, imageUrl: 'https://x.com/a.jpg' });
const noPhotos = item({
  id: '3',
  name: 'No photos',
  buyPrice: 40,
  saleReady: true,
  suggestedKleinListPrice: 80,
});

assert.equal(isListReadyCandidate(ready), true);
assert.equal(isListReadyCandidate(notReady), false);

const plan = buildListReadyPlan([ready, notReady, noPhotos], { ebayFeePct: 12.5, ebayAdsPct: 12.5 });
assert.equal(plan.rows.length, 2);
const blocked = plan.rows.find((r) => r.itemId === '3');
assert.equal(blocked?.status, 'blocked');
assert.ok(blocked?.blockers.includes('no_photos'));

const queued = plan.rows.find((r) => r.itemId === '1');
assert.equal(queued?.status, 'queued');
assert.equal(queued?.priceKa, 220);

const payload = exportListReadyAgentPayload(plan);
assert.equal(payload.mode, 'drafts_only');
assert.equal(payload.rows.length, 1);
assert.equal(payload.rows[0].itemId, '1');
assert.match(payload.safety.rule, /DRAFTS only/i);
console.log('OK: list ready queue filters saleReady + blockers; drafts_only export');

console.log('\nAll list-ready checks passed.');
