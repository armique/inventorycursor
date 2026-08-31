/**
 * Money-path tests against the TEST project.
 *
 * These assert exact euro amounts through the app's OWN aggregation functions and
 * the app's OWN row decoder — not reimplementations. A test that recomputes the
 * maths itself only proves the test agrees with the test.
 *
 * Run: npx tsx scripts/verify-money-paths.ts
 */
import { getTestClient } from './lib/testTarget.mjs';
import { mapRowToItem } from '../services/supabaseService';
import {
  resolvedSaleRevenue,
  shouldSkipForAggregatedSaleLine,
  shouldSkipForInventoryCostLine,
  shouldSkipContainerForPurchaseCogs,
  isSoldWithProportionalChildren,
  roundMoney,
} from '../services/financialAggregation';
import type { InventoryItem } from '../types';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** August 2026 sale revenue, the number that was flapping on the dashboard. */
function augustRevenue(items: InventoryItem[]): number {
  return roundMoney(
    items
      .filter((i) => i.sellDate?.startsWith('2026-08'))
      .filter((i) => !shouldSkipForAggregatedSaleLine(i, items))
      .reduce((sum, i) => sum + resolvedSaleRevenue(i), 0)
  );
}

const { client, ref } = getTestClient();
console.log(`money paths against ${ref}\n`);

const { data: rows, error } = await client.from('inventory_items').select('*');
if (error) throw new Error(`read failed: ${error.message}`);

const items = (rows as Record<string, unknown>[]).map(mapRowToItem);
const byId = (id: string) => items.find((i) => i.id === id)!;

console.log(`${items.length} fixtures loaded\n`);

// ---------------------------------------------------------------------------
console.log('sold container dedup');
// The PC sold for 900. Its four parts also carry sell prices (400+300+200+140),
// but those are the internal split of the same 900 the buyer paid. Counting both
// would report 1980 for a sale that brought in 1150.
const pc = byId('fx-pc-parent');
check('PC counts as proportional-children container', isSoldWithProportionalChildren(pc, items), true);
check('PC parent is counted', shouldSkipForAggregatedSaleLine(pc, items), false);
for (const id of ['fx-pc-child-1', 'fx-pc-child-2', 'fx-pc-child-3', 'fx-pc-child-4']) {
  check(`${id} is skipped`, shouldSkipForAggregatedSaleLine(byId(id), items), true);
}
// 250 (plain sale) + 900 (PC total) + 0 (fully refunded) = 1150
check('August revenue', augustRevenue(items), 1150);

// ---------------------------------------------------------------------------
console.log('\npartial data cannot be trusted');
// Drop only the parent — exactly what a truncated page-2 read produces. The four
// children stop being deduped, because the dedup cannot find their parent.
const withoutParent = items.filter((i) => i.id !== 'fx-pc-parent');
const partial = augustRevenue(withoutParent);
check('partial read inflates revenue', partial > 1150, true);
// 250 + 400 + 300 + 200 + 140 = 1290
check('partial read total', partial, 1290);
console.log(`        a single missing row moves the month by EUR ${roundMoney(partial - 1150)}`);
console.log('        -> this is why fetchPaginatedTable throws instead of returning short');

// ---------------------------------------------------------------------------
console.log('\nrefund');
const refunded = byId('fx-refunded');
const adjustments = refunded.ebaySaleAdjustments ?? [];
check('refund recorded', adjustments.length, 1);
check('refund is a clawback', adjustments[0].amount, -250);
check('original sale price kept', refunded.originalSellPrice, 250);
check('effective sell price is zero', refunded.sellPrice, 0);
check(
  'original + adjustments = current',
  roundMoney((refunded.originalSellPrice ?? 0) + adjustments.reduce((s, a) => s + a.amount, 0)),
  refunded.sellPrice
);
check('refunded sale adds no revenue', resolvedSaleRevenue(refunded), 0);

// ---------------------------------------------------------------------------
console.log('\ncancellation fee absorbed into cost');
const cancelled = byId('fx-cancel-fee');
const adj = (cancelled.ebaySaleAdjustments ?? [])[0];
check('item returned to stock', cancelled.status, 'In Stock');
check('fee flagged', cancelled.hasFee, true);
check('fee amount', cancelled.feeAmount, 12.5);
check(
  'buy price absorbed the fee',
  cancelled.buyPrice,
  roundMoney((adj.buyPriceBefore ?? 0) + (adj.buyPriceDelta ?? 0))
);
check('no revenue from a cancelled sale', cancelled.sellPrice ?? 0, 0);

// ---------------------------------------------------------------------------
console.log('\nbundle split conserves cost');
// Splitting a lot must neither create nor destroy cost.
const a = byId('fx-split-a');
const b = byId('fx-split-b');
check('lot total agrees on both parts', a.costOrigin?.lotTotalEur, b.costOrigin?.lotTotalEur);
check(
  'allocated parts sum to the lot',
  roundMoney((a.costOrigin?.allocatedEur ?? 0) + (b.costOrigin?.allocatedEur ?? 0)),
  a.costOrigin?.lotTotalEur
);
check('buy prices match allocations', roundMoney(a.buyPrice + b.buyPrice), 500);
check('one part is the remainder', b.isSplitRemainder, true);

// ---------------------------------------------------------------------------
console.log('\nstock is not double counted');
// A part reserved inside an unsold build belongs to the build, not the shelf.
check(
  'composition child excluded from stock value',
  shouldSkipForInventoryCostLine(byId('fx-build-child'), items),
  true
);
check(
  'loose stock is counted',
  shouldSkipForInventoryCostLine(byId('fx-stock-1'), items),
  false
);
// Purchase COGS lives on the child rows, so a container with children is skipped.
check('sold PC skipped for purchase COGS', shouldSkipContainerForPurchaseCogs(pc, items), true);
check(
  'unsold build skipped for purchase COGS',
  shouldSkipContainerForPurchaseCogs(byId('fx-build-parent'), items),
  true
);

// ---------------------------------------------------------------------------
console.log('\ndeterminism');
// The reported bug was a number that changed between refreshes. Row order from
// Postgres is not guaranteed, so the same data in a different order must still
// produce the same euro amount.
const totals = new Set<number>();
for (let i = 0; i < 20; i++) {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  totals.add(augustRevenue(shuffled));
}
check('20 shuffled orderings give one total', [...totals], [1150]);

console.log(failures === 0 ? '\nAll money paths verified.' : `\n${failures} assertion(s) failed.`);
// Set the code and let the loop drain; process.exit() here kills the Supabase
// client's open handles mid-flight and Node aborts with a crash code.
process.exitCode = failures === 0 ? 0 : 1;
