/**
 * Restore ASUS A320M PC sold sale after accidental restock.
 * Run: npx tsx scripts/verify-asus-a320m-pc-restore.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  ASUS_A320M_PART_IDS,
  ASUS_A320M_PART_SELL,
  ASUS_A320M_PC_BUY,
  ASUS_A320M_PC_NAME,
  ASUS_A320M_PC_SELL,
  ASUS_A320M_PC_SELL_DATE,
  allocateEurosByWeights,
  restoreAsusA320mPcSale,
} from '../utils/restoreAsusA320mPcSale';
import { appendUndoHistory } from '../utils/appendUndoHistory';
import { roundMoney } from '../services/financialAggregation';

function part(id: string, name: string, buy: number): InventoryItem {
  return {
    id,
    name,
    buyPrice: buy,
    buyDate: '2025-09-01',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
  };
}

const stockParts: InventoryItem[] = [
  part(ASUS_A320M_PART_IDS[0], 'Ryzen 2600', 12.5),
  part(ASUS_A320M_PART_IDS[1], 'GTX 1080 Gigabyte FE', 80),
  part(ASUS_A320M_PART_IDS[2], 'HDD Toshiba', 15.5),
  part(ASUS_A320M_PART_IDS[3], 'ASUS A320M', 12.5),
  part(ASUS_A320M_PART_IDS[4], 'Cooler Master case', 15.5),
  part(ASUS_A320M_PART_IDS[5], 'Be quiet 500w', 10),
  part(ASUS_A320M_PART_IDS[6], 'Enermax Liqmax', 8.21),
  part(ASUS_A320M_PART_IDS[7], '3 ARGB fans', 15),
  part(ASUS_A320M_PART_IDS[8], 'Crucial 250GB SSD', 7.5),
];

const fromParts = restoreAsusA320mPcSale(stockParts);
assert.equal(fromParts.changed, true);
const shell = fromParts.items.find((i) => i.isPC);
assert.ok(shell);
assert.equal(shell!.name, ASUS_A320M_PC_NAME);
assert.equal(shell!.buyPrice, ASUS_A320M_PC_BUY);
assert.equal(shell!.sellPrice, ASUS_A320M_PC_SELL);
assert.equal(shell!.status, ItemStatus.SOLD);
assert.equal((shell!.sellDate || '').slice(0, 10), ASUS_A320M_PC_SELL_DATE);

const soldParts = fromParts.items.filter((i) =>
  ASUS_A320M_PART_IDS.includes(i.id as (typeof ASUS_A320M_PART_IDS)[number])
);
assert.equal(soldParts.length, 9);
const buySum = roundMoney(soldParts.reduce((s, p) => s + Number(p.buyPrice || 0), 0));
const sellSum = roundMoney(soldParts.reduce((s, p) => s + Number(p.sellPrice || 0), 0));
assert.equal(buySum, ASUS_A320M_PC_BUY);
assert.equal(sellSum, ASUS_A320M_PC_SELL);

const gpu = soldParts.find((p) => p.id === ASUS_A320M_PART_IDS[1])!;
assert.ok(Number(gpu.buyPrice) > 60 && Number(gpu.buyPrice) < 75, `GPU EK ${gpu.buyPrice}`);
assert.ok(Number(gpu.sellPrice) > 100, `GPU sell should be proportional, got ${gpu.sellPrice}`);
assert.notEqual(roundMoney(Number(gpu.sellPrice)), ASUS_A320M_PART_SELL);
assert.ok(Number(gpu.profit) > 0, `GPU margin should be positive, got ${gpu.profit}`);

const profitSum = roundMoney(soldParts.reduce((s, p) => s + Number(p.profit || 0), 0));
assert.equal(profitSum, roundMoney(ASUS_A320M_PC_SELL - ASUS_A320M_PC_BUY));

const again = restoreAsusA320mPcSale(fromParts.items);
assert.equal(again.changed, false);

// Equal-split leftover from first restore must be healed.
const brokenEqual: InventoryItem[] = fromParts.items.map((i) => {
  if (i.isPC) return { ...i, buyPrice: ASUS_A320M_PC_BUY };
  if (ASUS_A320M_PART_IDS.includes(i.id as (typeof ASUS_A320M_PART_IDS)[number])) {
    return {
      ...i,
      buyPrice: stockParts.find((p) => p.id === i.id)!.buyPrice,
      sellPrice: ASUS_A320M_PART_SELL,
      profit: roundMoney(ASUS_A320M_PART_SELL - Number(stockParts.find((p) => p.id === i.id)!.buyPrice)),
    };
  }
  return i;
});
const healed = restoreAsusA320mPcSale(brokenEqual);
assert.equal(healed.changed, true);
const healedGpu = healed.items.find((i) => i.id === ASUS_A320M_PART_IDS[1])!;
assert.ok(Number(healedGpu.sellPrice) > 100);
assert.ok(Number(healedGpu.profit) > 0);
const healedBuySum = roundMoney(
  healed.items
    .filter((i) => ASUS_A320M_PART_IDS.includes(i.id as (typeof ASUS_A320M_PART_IDS)[number]))
    .reduce((s, p) => s + Number(p.buyPrice || 0), 0)
);
assert.equal(healedBuySum, ASUS_A320M_PC_BUY);

const restockedPc: InventoryItem = {
  id: 'pc-live',
  name: ASUS_A320M_PC_NAME,
  buyPrice: 100,
  buyDate: '2025-09-01',
  category: 'PC',
  status: ItemStatus.IN_STOCK,
  isPC: true,
  componentIds: [...ASUS_A320M_PART_IDS],
  comment1: '',
  comment2: '',
  ebaySaleCycles: [
    {
      id: 'cycle-1',
      closedAt: '2026-08-20T12:00:00.000Z',
      reason: 'manual_unsold',
      reasonLabel: 'Marked unsold',
      sellDate: ASUS_A320M_PC_SELL_DATE,
      sellPrice: ASUS_A320M_PC_SELL,
      customer: { name: 'Test Buyer', address: '' },
      platformSold: 'ebay.de',
    },
  ],
};
const withPc = restoreAsusA320mPcSale([
  restockedPc,
  ...stockParts.map((p) => ({ ...p, parentContainerId: 'pc-live' })),
]);
assert.equal(withPc.changed, true);
const fixed = withPc.items.find((i) => i.id === 'pc-live')!;
assert.equal(fixed.buyPrice, ASUS_A320M_PC_BUY);
assert.equal(fixed.sellPrice, ASUS_A320M_PC_SELL);
assert.equal(fixed.status, ItemStatus.SOLD);
assert.equal(fixed.customer?.name, 'Test Buyer');

// Cent allocation helper
const cents = allocateEurosByWeights(10, [1, 1, 1]);
assert.equal(roundMoney(cents.reduce((a, b) => a + b, 0)), 10);

// Undo stack: restock then undo returns to sold snapshot.
const soldSnap = withPc.items;
const activeSnap = soldSnap.map((i) =>
  i.id === 'pc-live' || ASUS_A320M_PART_IDS.includes(i.id as (typeof ASUS_A320M_PART_IDS)[number])
    ? { ...i, status: ItemStatus.IN_STOCK, sellPrice: undefined, sellDate: undefined }
    : i
);
const { base, nextIdx } = appendUndoHistory(
  [],
  -1,
  { items: soldSnap, trash: [] },
  { items: activeSnap, trash: [] }
);
assert.equal(nextIdx, 1);
assert.equal(base[0].items.find((i) => i.id === 'pc-live')?.status, ItemStatus.SOLD);
assert.equal(base[1].items.find((i) => i.id === 'pc-live')?.status, ItemStatus.IN_STOCK);

console.log('verify-asus-a320m-pc-restore: ok');
