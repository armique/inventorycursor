/**
 * Repair rows where buyDate > sellDate.
 * Run: npx tsx scripts/verify-repair-impossible-buy-dates.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buyDateAfterSellDate,
  countBuyDateAfterSellDate,
  repairBuyDateBeforeSellDate,
  repairImpossibleBuyDates,
} from '../utils/repairImpossibleBuyDates';
import { backfillContainerBuyDates } from '../utils/backfillContainerBuyDates';
import { syncContainerBuyDatesFromComponents } from '../services/containerAggregates';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 10,
    buyDate: '2026-01-01',
    category: 'Misc',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

function run() {
  const cpu = item({ id: 'c1', name: 'CPU', buyDate: '2025-08-01' });
  const gpu = item({ id: 'c2', name: 'GPU', buyDate: '2026-05-10' });
  const soldPc = item({
    id: 'pc1',
    name: 'Gaming PC',
    isPC: true,
    status: ItemStatus.SOLD,
    sellDate: '2025-11-20',
    buyDate: '2026-05-10',
    componentIds: ['c1', 'c2'],
  });

  assert.equal(buyDateAfterSellDate(soldPc), true);
  assert.equal(
    repairBuyDateBeforeSellDate(soldPc, [cpu, gpu]),
    '2025-08-01',
    'use latest child on/before sell, not GPU bought after sale'
  );

  const { items: fixed, repairedCount } = repairImpossibleBuyDates([cpu, gpu, soldPc]);
  assert.equal(repairedCount, 1);
  assert.equal(fixed.find((i) => i.id === 'pc1')?.buyDate, '2025-08-01');
  assert.equal(countBuyDateAfterSellDate(fixed), 0);

  const synced = syncContainerBuyDatesFromComponents(fixed, ['c2']);
  assert.equal(
    synced.find((i) => i.id === 'pc1')?.buyDate,
    '2025-08-01',
    'sold containers are not re-synced from children'
  );

  const backfilled = backfillContainerBuyDates(synced);
  assert.equal(
    backfilled.items.find((i) => i.id === 'pc1')?.buyDate,
    '2025-08-01',
    'sold containers skipped by backfill'
  );

  console.log('verify-repair-impossible-buy-dates: all checks passed');
}

run();
