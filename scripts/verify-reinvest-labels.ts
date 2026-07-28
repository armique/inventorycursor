/**
 * Verify capacity-tier bucketing and brand-free label prettification (componentKeyExtractor.ts),
 * plus the restock/stocked/skip verdict classification (reinvestAnalysis.ts).
 * Run: npx tsx scripts/verify-reinvest-labels.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { extractPrimaryComponentKey, prettifyComponentKey } from '../utils/componentKeyExtractor';
import { buildReinvestData } from '../utils/reinvestAnalysis';

function key(name: string): string | undefined {
  return extractPrimaryComponentKey(name)?.componentKey;
}
function pretty(name: string): string | null {
  const k = key(name);
  return k ? prettifyComponentKey(k) : null;
}

// --- Capacity tier bucketing: near-standard sizes snap to one canonical group ---
assert.equal(key('Samsung 970 EVO Plus SSD 480GB'), 'storage:ssd-512gb');
assert.equal(key('Crucial MX500 500GB SATA SSD'), 'storage:ssd-512gb');
assert.equal(key('WD Blue 512GB SSD'), 'storage:ssd-512gb');
assert.equal(key('Kingston A400 240GB SSD'), 'storage:ssd-256gb');
assert.equal(key('Team Group 250GB SSD'), 'storage:ssd-256gb');
assert.equal(key('Some Drive 750GB SSD'), 'storage:ssd-750gb', 'genuinely odd size should not be forced onto a tier');
console.log('OK: SSD capacity snaps 480/500->512GB and 240/250->256GB, leaves odd sizes alone');

// --- Brand-free, generic labels ---
assert.equal(pretty('Samsung 970 EVO Plus SSD 480GB'), 'SSD 512GB');
assert.equal(pretty('WD Blue 512GB NVMe'), 'NVMe SSD 512GB');
assert.equal(pretty('ASUS Dual RTX 3070 OC 8GB'), 'RTX 3070');
assert.equal(pretty('MSI GTX 1660 Super Gaming'), 'GTX 1660 Super');
assert.equal(pretty('Intel Core i7-4790K'), 'i7-4790K');
assert.equal(pretty('AMD Ryzen 5 5600X Box'), 'Ryzen 5 5600X');
console.log('OK: labels are generic and brand-free (no Samsung/ASUS/MSI/Intel/AMD leaking through)');

// --- RAM speed is ignored, only DDR generation + capacity matter ---
assert.equal(key('Corsair Vengeance 8GB DDR4 2400MHz'), key('G.Skill Ripjaws 8GB DDR4 3200MHz'));
assert.equal(pretty('Kingston FURY Beast DDR5 16GB 5200MT/s'), 'DDR5 16GB RAM');
console.log('OK: RAM groups by DDR generation + capacity only, MHz speed never enters the key');

// --- Verdict classification ---
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

const losingItems: InventoryItem[] = [0, 1, 2].map((i) =>
  item({
    id: `loss-${i}`,
    name: 'Broken HDD 1TB',
    buyPrice: 20,
    sellPrice: 16,
    buyDate: '2026-01-01',
    sellDate: `2026-01-1${i}`,
  }),
);
const skipData = buildReinvestData(losingItems);
const skipGroup = skipData.variants.find((g) => g.key === 'storage:hdd-1tb');
assert.equal(skipGroup?.verdict, 'skip');
assert.ok(skipGroup?.skipReason?.includes('loss'));
console.log(`OK: net-losing group gets verdict 'skip' — "${skipGroup?.skipReason}"`);

const restockItems: InventoryItem[] = [0, 1, 2, 3].map((i) =>
  item({
    id: `good-${i}`,
    name: 'SSD 512GB Drive',
    buyPrice: 25,
    sellPrice: 45,
    buyDate: '2026-01-01',
    sellDate: `2026-0${(i % 6) + 1}-05`,
  }),
);
const restockData = buildReinvestData(restockItems);
const restockGroup = restockData.variants.find((g) => g.key === 'storage:ssd-512gb');
assert.equal(restockGroup?.verdict, 'restock', 'profitable + currently out of stock -> restock');
assert.ok(restockGroup!.profitPerDay > 0);
console.log(`OK: profitable understocked group gets verdict 'restock', profitPerDay=${restockGroup?.profitPerDay}`);

console.log('\nAll reinvest label/verdict checks passed.');
