/**
 * Verify Flip Coach pocket ↔ list price math + sane sold-comp matching.
 * Run: npx tsx scripts/verify-flip-coach.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  listPricesForPocket,
  maxBuyForEbayFlip,
  maxBuyForKleinFlip,
  pocketFromEbayListPrice,
  sanitizePocketAgainstBuy,
  suggestChannelPrices,
  totalEbayFeePct,
} from '../utils/flipCoach';
import {
  productModelKeys,
  soldCompsModelCompatible,
} from '../utils/inventorySoldComps';

assert.equal(totalEbayFeePct({ ebayFeePct: 10, ebayAdsPct: 12.5 }), 22.5);

const lists = listPricesForPocket(100, 25);
assert.equal(lists.kleinanzeigen, 100);
assert.equal(lists.ebay, 133.33); // 100 / 0.75

assert.equal(pocketFromEbayListPrice(133.33, 25), 100);

assert.equal(maxBuyForKleinFlip(100, 30), 70);
assert.equal(maxBuyForEbayFlip(133.33, 25, 30), 70);

assert.ok(productModelKeys('Nvidia Quadro 2000').some((k) => k.includes('quadro2000')));
assert.ok(productModelKeys('Inno3D RTX 2060').includes('rtx2060'));
assert.equal(soldCompsModelCompatible('Nvidia Quadro 2000', 'Nvidia RTX 3080'), false);
assert.equal(soldCompsModelCompatible('Inno3D RTX 2060', 'ASUS Dual RTX 3060 12GB'), false);
assert.equal(soldCompsModelCompatible('Nvidia Quadro 2000', 'Dell Quadro 2000 1GB'), true);
assert.equal(soldCompsModelCompatible('Inno3D RTX 2060', 'Gigabyte RTX 2060 OC'), true);

const crazy = sanitizePocketAgainstBuy(185, 2.6, 3);
assert.equal(crazy.clamped, true);
assert.ok(crazy.pocket < 10);

const ok = sanitizePocketAgainstBuy(120, 70, 3);
assert.equal(ok.clamped, false);
assert.equal(ok.pocket, 120);

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Graphics Cards',
    ...partial,
  } as InventoryItem;
}

const inventory: InventoryItem[] = [
  item({
    id: 'q',
    name: 'Nvidia Quadro 2000',
    buyPrice: 2.6,
    status: ItemStatus.IN_STOCK,
  }),
  item({
    id: 'sold-modern',
    name: 'Nvidia RTX 3080 Founders',
    sellPrice: 280,
    status: ItemStatus.SOLD,
    sellDate: '2026-01-01',
  }),
  item({
    id: 'sold-quadro-rtx',
    name: 'Nvidia Quadro RTX 5000',
    sellPrice: 450,
    status: ItemStatus.SOLD,
    sellDate: '2026-01-02',
  }),
];

const suggestion = suggestChannelPrices(inventory, 'Nvidia Quadro 2000', {
  ebayFeePct: 10,
  ebayAdsPct: 12.5,
}, { category: 'Components', subCategory: 'Graphics Cards' });

assert.equal(
  suggestion.compCount,
  0,
  'Quadro 2000 must not use modern Nvidia/Quadro RTX sold prices'
);

console.log('verify-flip-coach: ok');
