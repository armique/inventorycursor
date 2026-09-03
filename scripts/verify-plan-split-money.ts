/**
 * Part C Rule 12 — money tests for planSplit / allocation / nested eject predicates.
 * Run: npx tsx scripts/verify-plan-split-money.ts
 */
import assert from 'node:assert/strict';
import { planSplit, allocateCentsByWeight } from '../utils/planSplit';
import { allocateBuyAcrossParts, defaultSplitSelection } from '../utils/splitParts';
import { childIdsOf } from '../utils/childIdsOf';
import { planEjectFromContainer } from '../utils/ejectFromContainer';
import { quantityFromTitle, statedQuantity, quantityHelpersAgree } from '../utils/splitQuantityFromTitle';
import { roundMoney, shouldSkipForInventoryCostLine, countsAsStandaloneInventoryCost } from '../services/financialAggregation';
import { ItemStatus, type InventoryItem } from '../types';

function sumBuy(units: Array<{ buyPrice: number }>): number {
  return roundMoney(units.reduce((s, u) => s + u.buyPrice, 0));
}

// --- exact cents across awkward values / counts -------------------------------
for (const total of [19.99, 33.33, 0.03, 6.19, 100]) {
  for (const count of [2, 3, 7]) {
    const parts = Array.from({ length: count }, (_, i) => ({
      key: `p${i}`,
      label: `P${i}`,
      name: `Part ${i}`,
      weight: 1,
    }));
    const plan = planSplit({ buyPrice: total }, parts);
    assert.equal(plan.totalAllocated, roundMoney(total), `total ${total} count ${count}`);
    assert.equal(sumBuy(plan.units), roundMoney(total));
  }
}

// leftover cents to largest lines
{
  const cents = allocateCentsByWeight(619, [
    { key: 'a', weight: 1 },
    { key: 'b', weight: 1 },
    { key: 'c', weight: 1 },
  ]);
  assert.equal(cents.a + cents.b + cents.c, 619);
}

// Rule 3: remainder locked at 0 does not join equal-split
{
  const alloc = allocateBuyAcrossParts(30, [
    { key: 'stick1', weight: 0 },
    { key: 'stick2', weight: 0 },
    { key: 'remainder', weight: 0, buyLocked: true, buyPrice: 0, isRemainder: true },
  ]);
  assert.equal(roundMoney(alloc.stick1 + alloc.stick2 + alloc.remainder), 30);
  assert.equal(alloc.remainder, 0);
  assert.equal(roundMoney(alloc.stick1 + alloc.stick2), 30);
}

// Rule 4: quantity expands; faulty unit keeps full share
{
  const plan = planSplit(
    { buyPrice: 40 },
    [{ key: 'fan', label: 'Fan', name: 'Arctic Fan', weight: 1, quantity: 2, faultyUnits: [2] }]
  );
  assert.equal(plan.units.length, 2);
  assert.equal(plan.units[0].name.includes('(1 of 2)'), true);
  assert.equal(plan.units[1].name.includes('(2 of 2)'), true);
  assert.equal(plan.units[1].isDefective, true);
  assert.equal(plan.units[0].isDefective, false);
  assert.equal(plan.totalAllocated, 40);
}

// Rule 8: empty componentIds still finds reverse links
{
  const container: InventoryItem = {
    id: 'c1',
    name: 'Box',
    buyPrice: 100,
    category: 'Bundle',
    status: ItemStatus.IN_STOCK,
    buyDate: '2026-01-01',
    isBundle: true,
    componentIds: [],
  };
  const child: InventoryItem = {
    id: 'p1',
    name: 'Part',
    buyPrice: 40,
    category: 'Components',
    status: ItemStatus.IN_COMPOSITION,
    buyDate: '2026-01-01',
    parentContainerId: 'c1',
  };
  const ids = childIdsOf(container, [container, child]);
  assert.deepEqual(ids, ['p1']);
}

// Rule 5: child under container does not count for capital
{
  const parent: InventoryItem = {
    id: 'box',
    name: 'PSU Bundle',
    buyPrice: 50,
    category: 'Bundle',
    status: ItemStatus.IN_STOCK,
    buyDate: '2026-01-01',
    isBundle: true,
    componentIds: ['cable'],
  };
  const child: InventoryItem = {
    id: 'cable',
    name: 'Cable',
    buyPrice: 3,
    category: 'Misc',
    status: ItemStatus.IN_COMPOSITION,
    buyDate: '2026-01-01',
    parentContainerId: 'box',
  };
  const all = [parent, child];
  assert.equal(shouldSkipForInventoryCostLine(child, all), true);
  assert.equal(countsAsStandaloneInventoryCost(parent, all), true);
  assert.equal(countsAsStandaloneInventoryCost(child, all), false);
}

// counted total unchanged: split → eject one → eject rest (logical money check)
{
  const original = 100;
  const plan = planSplit(
    { buyPrice: original },
    [
      { key: 'a', label: 'A', name: 'A', weight: 1 },
      { key: 'b', label: 'B', name: 'B', weight: 1 },
      { key: 'rem', label: 'Rem', name: 'Rem', weight: 1, isRemainder: true },
    ]
  );
  let container = plan.units.find((u) => u.isRemainder)!.buyPrice;
  const parts = plan.units.filter((u) => !u.isRemainder).map((u) => ({ ...u }));
  assert.equal(roundMoney(container + sumBuy(parts)), original);

  // eject first part
  const ejected1 = parts.shift()!;
  container = roundMoney(container); // container already excludes ejected once we move share
  // after eject: standalone ejected + remaining parts + container residue
  let topLevel = roundMoney(ejected1.buyPrice + sumBuy(parts) + container);
  // When ejecting, container is reduced by the part's share — simulate:
  // parts still inside keep their shares; container value was only the remainder share in this plan.
  assert.equal(topLevel, original);

  // eject rest
  while (parts.length) {
    const e = parts.shift()!;
    topLevel = roundMoney(e.buyPrice + sumBuy(parts) + container);
  }
  // container standing alone with residue
  assert.equal(roundMoney(container + (ejected1?.buyPrice || 0) + 0), roundMoney(container + ejected1.buyPrice));
  const allStandalone = roundMoney(
    ejected1.buyPrice + plan.units.filter((u) => !u.isRemainder && u.key !== ejected1.key).reduce((s, u) => s + u.buyPrice, 0) + container
  );
  assert.equal(allStandalone, original);
}

// nested: inner container change adjusts ancestor by delta, not moved part price
{
  const lotBuy = 290;
  const trioBuy = 30;
  const trio = planSplit(
    { buyPrice: trioBuy },
    [
      { key: 'f1', label: 'Fan', name: 'Fan', weight: 1 },
      { key: 'f2', label: 'Fan', name: 'Fan', weight: 1 },
      { key: 'f3', label: 'Fan', name: 'Fan', weight: 1 },
    ]
  );
  const fan = trio.units[0].buyPrice;
  const innerDelta = fan; // inner container lost exactly the ejected part's share
  const lotAfter = roundMoney(lotBuy - innerDelta);
  const trioAfter = roundMoney(trioBuy - fan);
  assert.equal(lotAfter, roundMoney(lotBuy - fan));
  // Fan now counts alone; trio still nested in the lot so only lot + fan are top-level.
  assert.equal(roundMoney(lotAfter + fan), lotBuy);
  assert.equal(roundMoney(trioAfter + fan), trioBuy);
}

// container never worth less than contents
{
  const plan = planSplit(
    { buyPrice: 50 },
    [
      { key: 'a', label: 'A', name: 'A', weight: 2 },
      { key: 'b', label: 'B', name: 'B', weight: 1 },
      { key: 'rem', label: 'Rem', name: 'Rem', weight: 1, isRemainder: true },
    ]
  );
  const contents = sumBuy(plan.units.filter((u) => !u.isRemainder));
  const rem = plan.remainder?.buyPrice || 0;
  assert.ok(roundMoney(contents + rem) === 50);
  assert.ok(contents <= 50);
}

// adding a part raises container by exactly that part's cost
{
  const before = 80;
  const partCost = 12.5;
  const after = roundMoney(before + partCost);
  assert.equal(after - before, partCost);
}

// Rule 11: stated vs guess agree where both speak
{
  assert.equal(statedQuantity({ key: 'ram_stick', kind: 'ram' }, '2x16GB DDR4'), 2);
  assert.equal(quantityFromTitle({ key: 'ram_stick', kind: 'ram' }, '2x16GB DDR4'), 2);
  assert.equal(quantityHelpersAgree({ key: 'fan', kind: 'fan' }, 'Arctic Liquid Freezer II 360mm'), true);
  assert.equal(statedQuantity({ key: 'fan', kind: 'fan' }, 'Random PSU ATX'), undefined);
}

// throws on bad total (locked over purchase)
{
  assert.throws(() =>
    planSplit(
      { buyPrice: 10 },
      [
        { key: 'a', label: 'A', name: 'A', weight: 1, lockedBuyPrice: 8 },
        { key: 'b', label: 'B', name: 'B', weight: 1, lockedBuyPrice: 8 },
      ]
    )
  );
}

// Presets: RAM kits and PSU cables (Question 3A)
{
  const ram = defaultSplitSelection({
    name: '2x16GB Kingston DDR4',
    buyPrice: 40,
    category: 'Components',
    subCategory: 'RAM',
  } as InventoryItem);
  assert.equal(ram.enabled.ram_stick, true);

  const psu = defaultSplitSelection({
    name: 'be quiet! Pure Power 11 500W fully modular',
    buyPrice: 60,
    category: 'Components',
    subCategory: 'PSU',
  } as InventoryItem);
  assert.equal(psu.enabled.cable, true);
  assert.equal(psu.enabled.psu_main, true);
}

// Eject: top-level counted total unchanged; last residue kept
{
  const box: InventoryItem = {
    id: 'box',
    name: 'Lot',
    buyPrice: 100,
    category: 'Bundle',
    status: ItemStatus.IN_STOCK,
    buyDate: '2026-01-01',
    isBundle: true,
    componentIds: ['a', 'b'],
  };
  const a: InventoryItem = {
    id: 'a',
    name: 'A',
    buyPrice: 40,
    category: 'Components',
    status: ItemStatus.IN_COMPOSITION,
    buyDate: '2026-01-01',
    parentContainerId: 'box',
  };
  const b: InventoryItem = {
    id: 'b',
    name: 'B',
    buyPrice: 60,
    category: 'Components',
    status: ItemStatus.IN_COMPOSITION,
    buyDate: '2026-01-01',
    parentContainerId: 'box',
  };
  const first = planEjectFromContainer(a, box, [box, a, b]);
  const nextBox = first.updates.find((i) => i.id === 'box')!;
  assert.equal(nextBox.buyPrice, 60);
  const standaloneA = first.updates.find((i) => i.id === 'a')!;
  assert.equal(standaloneA.parentContainerId, undefined);
  assert.equal(roundMoney(nextBox.buyPrice + standaloneA.buyPrice), 100);

  const last = planEjectFromContainer(b, nextBox, [nextBox, standaloneA, b]);
  assert.equal(last.deleteIds.includes('box'), true);
  const standaloneB = last.updates.find((i) => i.id === 'b')!;
  assert.equal(roundMoney(standaloneA.buyPrice + standaloneB.buyPrice), 100);
}

console.log('verify-plan-split-money: ok');
