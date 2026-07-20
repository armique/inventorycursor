/**
 * Backfill empty container Acquired dates from part buyDates.
 * Run: npx tsx scripts/verify-container-buy-date-backfill.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  CONTAINER_BUY_DATE_BACKFILL_KEY,
  backfillContainerBuyDates,
  resolveContainerAcquiredDate,
} from '../utils/backfillContainerBuyDates';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 10,
    buyDate: '',
    category: 'Misc',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

/** Mirrors inventory Acquired cell: containers must show buyDate when present (not a forced dash). */
function displayAcquiredCell(item: InventoryItem): string {
  const key = (item.buyDate || '').trim();
  return key || '-';
}

function run() {
  assert.equal(CONTAINER_BUY_DATE_BACKFILL_KEY, 'container_buy_date_backfill_v2');

  const cpu = item({ id: 'c1', name: 'CPU', buyDate: '2026-03-01', category: 'CPU' });
  const ram = item({ id: 'c2', name: 'RAM', buyDate: '2026-05-10', category: 'RAM' });
  const ssd = item({ id: 'c3', name: 'SSD', buyDate: '', category: 'Storage' });
  const bundle = item({
    id: 'b1',
    name: 'Aufrustkit Ryzen',
    category: 'Bundle',
    isBundle: true,
    vendor: 'Aufrustkit',
    buyDate: '',
    componentIds: ['c1', 'c2', 'c3'],
  });
  const pc = item({
    id: 'p1',
    name: 'Office PC',
    category: 'PC',
    isPC: true,
    buyDate: '',
    componentIds: ['c1'],
  });
  const lot = item({
    id: 'm1',
    name: 'Mixed lot',
    category: 'Mixed Bundle',
    isBundle: true,
    vendor: 'Mixed Bundle',
    buyDate: '',
    componentIds: ['c2', 'c3'],
    sellDate: '2026-06-01',
  });
  const alreadySet = item({
    id: 'b2',
    name: 'Old kit',
    category: 'Bundle',
    isBundle: true,
    buyDate: '2025-12-01',
    componentIds: ['c1'],
  });

  const all = [cpu, ram, ssd, bundle, pc, lot, alreadySet];

  assert.equal(resolveContainerAcquiredDate(bundle, all), '2026-05-10', 'latest part date');
  assert.equal(resolveContainerAcquiredDate(pc, all), '2026-03-01');
  assert.equal(resolveContainerAcquiredDate(lot, all), '2026-05-10');

  const { items: next, updatedCount } = backfillContainerBuyDates(all);
  assert.equal(updatedCount, 3);
  assert.equal(next.find((i) => i.id === 'b1')?.buyDate, '2026-05-10');
  assert.equal(next.find((i) => i.id === 'p1')?.buyDate, '2026-03-01');
  assert.equal(next.find((i) => i.id === 'm1')?.buyDate, '2026-05-10');
  assert.equal(next.find((i) => i.id === 'b2')?.buyDate, '2025-12-01', 'leave existing Acquired alone');

  const again = backfillContainerBuyDates(next);
  assert.equal(again.updatedCount, 0, 'idempotent after fill');

  const filledBundle = next.find((i) => i.id === 'b1')!;
  assert.equal(displayAcquiredCell(filledBundle), '2026-05-10', 'Acquired cell must show container buyDate');
  assert.notEqual(displayAcquiredCell(filledBundle), '-', 'must not hardcode dash for bundles');

  console.log('verify-container-buy-date-backfill: all checks passed');
}

run();
