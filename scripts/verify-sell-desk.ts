/**
 * Run: npx tsx scripts/verify-sell-desk.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { quoteMaxBuy } from '../utils/maxBuyCeiling';
import { computeRepeatWinners } from '../utils/repeatWinners';
import { buildListingTemplate } from '../utils/listingTemplate';
import { weeklyLaneItems } from '../utils/sellDesk';
import { dealwatchFilterHitRates, type DealwatchVerdict } from '../utils/dealwatchVerdicts';
import { freeToSpend, untouchableCapital } from '../utils/capitalReserve';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    buyDate: '2026-01-01',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

{
  const q = quoteMaxBuy([], 'RTX 3070', { askPrice: 200, fulfillment: 'pickup' });
  assert.equal(q.verdict, 'no_comps');
  assert.equal(q.maxBuy, 0);
}

{
  const locked = untouchableCapital({ taxReserve: 100, filamentReserve: 40, livingWeekly: 50, weeks: 2 });
  assert.equal(locked, 240);
  assert.equal(freeToSpend(300, { taxReserve: 100, filamentReserve: 40, livingWeekly: 50, weeks: 2 }), 60);
}

{
  const winners = computeRepeatWinners([
    item({
      id: 's1',
      name: 'SSD 1TB',
      status: ItemStatus.SOLD,
      buyPrice: 40,
      sellPrice: 70,
      buyDate: '2026-07-01',
      sellDate: '2026-07-08',
    }),
    item({
      id: 's2',
      name: 'SSD 1TB',
      status: ItemStatus.SOLD,
      buyPrice: 42,
      sellPrice: 68,
      buyDate: '2026-07-10',
      sellDate: '2026-07-20',
    }),
  ]);
  assert.ok(winners.some((w) => w.label.includes('SSD')));
}

{
  const tpl = buildListingTemplate(
    item({
      id: 'p1',
      name: 'GPU Bracket',
      specs: { 'Filament Weight': '80g', 'Print Time': '3 h', 'Filament Type': 'PETG' },
    }),
    { klein: 12, ebay: 16 },
  );
  assert.match(tpl.text, /80g/);
  assert.match(tpl.text, /Kleinanzeigen: €12/);
}

{
  const lanes = weeklyLaneItems([
    item({ id: 'a', name: 'No photo', photosReady: false }),
    item({
      id: 'b',
      name: 'Ready',
      photosReady: true,
      listedOnEbay: false,
      listedOnKleinanzeigen: false,
    }),
  ]);
  assert.equal(lanes.photos[0]?.id, 'a');
  assert.equal(lanes.list[0]?.id, 'b');
}

{
  const rates = dealwatchFilterHitRates([
    { id: '1', title: 'x', filter: 'rtx 3070', verdict: 'bought', createdAt: '2026-01-01' },
    { id: '2', title: 'y', filter: 'rtx 3070', verdict: 'expensive', createdAt: '2026-01-02' },
  ] as DealwatchVerdict[]);
  assert.equal(rates[0].bought, 1);
  assert.equal(rates[0].total, 2);
}

console.log('verify-sell-desk: all checks passed');
