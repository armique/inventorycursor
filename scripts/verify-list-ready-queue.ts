/**
 * List Ready + listing prep checklist.
 * Run: npx tsx scripts/verify-list-ready-queue.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildListReadyPlan,
  exportListReadyAgentPayload,
  isListReadyCandidate,
} from '../utils/listReadyQueue';
import {
  canMarkSaleReady,
  getListingPrepChecklist,
} from '../utils/listingPrepChecklist';

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
  marketTitle: 'NVIDIA GeForce RTX 3060 12GB GDDR6 Grafikkarte',
  marketDescription:
    'Gebrauchte RTX 3060 12GB in gutem Zustand. Getestet, ohne OVP. Versand möglich.',
  imageUrl: 'https://example.com/a.jpg',
  imageUrls: ['https://example.com/b.jpg'],
  suggestedKleinListPrice: 220,
  suggestedEbayListPrice: 293,
});

const saleReadyIncomplete = item({
  id: '1b',
  name: 'Incomplete checklist',
  buyPrice: 100,
  saleReady: true,
  imageUrl: 'https://example.com/a.jpg',
});

const notReady = item({
  id: '2',
  name: 'Hidden',
  buyPrice: 10,
  saleReady: false,
  imageUrl: 'https://x.com/a.jpg',
  marketTitle: 'Hidden GPU listing title here',
  marketDescription: 'Long enough description text for the checklist gate to pass if marked ready.',
});

const noPhotos = item({
  id: '3',
  name: 'No photos',
  buyPrice: 40,
  saleReady: true,
  marketTitle: 'Some GPU without photos yet title',
  marketDescription: 'Has title and description but missing product photos on the inventory item.',
  suggestedKleinListPrice: 80,
});

assert.equal(getListingPrepChecklist(ready).complete, true);
assert.equal(canMarkSaleReady(ready), true);
assert.equal(canMarkSaleReady(saleReadyIncomplete), false);
assert.equal(isListReadyCandidate(ready), true);
assert.equal(isListReadyCandidate(saleReadyIncomplete), false);
assert.equal(isListReadyCandidate(notReady), false);

const plan = buildListReadyPlan([ready, saleReadyIncomplete, notReady, noPhotos], {
  ebayFeePct: 12.5,
  ebayAdsPct: 12.5,
});
assert.equal(plan.rows.length, 1, 'only checklist-complete saleReady items');
const queued = plan.rows.find((r) => r.itemId === '1');
assert.equal(queued?.status, 'queued');
assert.equal(queued?.priceKa, 220);
assert.equal(queued?.listingTitle, ready.marketTitle);
assert.ok((queued?.listingDescription.length || 0) > 40);

const payload = exportListReadyAgentPayload(plan);
assert.equal(payload.mode, 'drafts_only');
assert.equal(payload.rows.length, 1);
assert.equal(payload.rows[0].itemId, '1');
assert.equal(payload.rows[0].title, ready.marketTitle);
assert.equal(payload.rows[0].description, ready.marketDescription);
assert.match(payload.safety.rule, /DRAFTS only/i);
console.log('OK: checklist gates saleReady queue; export uses marketTitle + description');

console.log('\nAll list-ready checks passed.');
