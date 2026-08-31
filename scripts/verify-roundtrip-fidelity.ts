/**
 * Write → read round trip against the TEST project.
 *
 * Every existing undo-sale test is in-memory: it proves applyUnsoldRestock
 * returns the right objects, not that those objects survive being saved. A field
 * that mapItemToRow forgets, or a column the schema lacks, is dropped silently on
 * every single save and no in-memory test can see it.
 *
 * Two parts:
 *   1. a heavily populated item is written and read back, field by field
 *   2. a real undo-sale is performed, persisted, re-read, and re-checked
 *
 * Run: npx tsx scripts/verify-roundtrip-fidelity.ts
 */
import { getTestClient } from './lib/testTarget.mjs';
import { mapRowToItem, mapItemToRow } from '../services/supabaseService';
import { applyUnsoldRestock } from '../services/saleRevert';
import { ItemStatus, type InventoryItem } from '../types';

const { client, ref } = getTestClient();
console.log(`round trip against ${ref}\n`);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const { data: users } = await client.auth.admin.listUsers({ perPage: 200 });
const USER_ID = users.users.find((u) => u.email === 'fixtures@inventory-pro.test')?.id;
if (!USER_ID) throw new Error('Fixture user missing — run seed-test-data.mjs first.');

async function save(items: InventoryItem[]): Promise<void> {
  const rows = items.map((i) => mapItemToRow(i, USER_ID!, false));
  const { error } = await client.from('inventory_items').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`save failed: ${error.message}`);
}

async function load(ids?: string[]): Promise<InventoryItem[]> {
  let q = client.from('inventory_items').select('*').eq('user_id', USER_ID!);
  if (ids) q = q.in('id', ids);
  const { data, error } = await q;
  if (error) throw new Error(`load failed: ${error.message}`);
  return (data as Record<string, unknown>[]).map(mapRowToItem);
}

// ---------------------------------------------------------------------------
console.log('part 1 — nothing is lost on save');

// Populated across every kind of column: scalars, arrays, nested JSONB, money,
// dates and booleans. If any of these fail to come back, saves are lossy.
const rich: InventoryItem = {
  id: 'fx-roundtrip',
  name: 'Round-Trip Testartikel',
  buyPrice: 123.45,
  sellPrice: 299.99,
  storePrice: 349,
  profit: 176.54,
  buyDate: '2026-06-01',
  sellDate: '2026-08-15',
  category: 'PC-Komponenten',
  subCategory: 'Grafikkarte',
  status: ItemStatus.SOLD,
  comment1: 'Kommentar eins',
  comment2: 'Kommentar zwei [Returned 01.08.2026]',
  imageUrls: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
  vendor: 'Testhändler',
  platformBought: 'Kleinanzeigen',
  platformSold: 'eBay',
  ebayOrderId: '33-33333-33333',
  ebayUsername: 'test_buyer',
  ebayListingId: '1234567890',
  ebaySku: 'SKU-RT-1',
  shippingWeightKg: 2.35,
  conditionToggles: ['OVP', 'Rechnung'],
  ean: '4011234567890',
  originalSellPrice: 320,
  hasFee: true,
  feeAmount: 29.99,
  sellerPaidShipping: true,
  sellerShippingAmount: 5.49,
  hasReceipt: true,
  invoiceNumber: 'RE-2026-0042',
  usesDifferentialVat: true,
  isPC: false,
  isBundle: false,
  isDefective: false,
  quantity: 3,
  specs: { chipsatz: 'AD104', speicher: '12GB GDDR6X' },
  customer: { name: 'Max Mustermann', city: 'Berlin' } as InventoryItem['customer'],
  saleProceeds: {
    capturedAt: '2026-08-15T10:00:00.000Z',
    source: 'ebay_seller_hub',
    itemGrossEur: 299.99,
    buyerShippingEur: 5.49,
    buyerTotalEur: 305.48,
    transactionFeeEur: 29.99,
    netPayoutEur: 275.49,
    feesEstimated: false,
  },
  priceHistory: [{ at: '2026-07-01T00:00:00.000Z', from: 340, to: 299.99 }] as InventoryItem['priceHistory'],
  movementHistory: [{ at: '2026-06-01T00:00:00.000Z', kind: 'added' }] as InventoryItem['movementHistory'],
  ebaySaleAdjustments: [],
  ebaySaleCycles: [],
  storeVisible: true,
  storeBadge: 'Neu eingetroffen',
};

await save([rich]);
const [readBack] = await load(['fx-roundtrip']);

/**
 * Postgres `jsonb` stores objects normalised and does not preserve key insertion
 * order, so a saved {name, city} reads back as {city, name}. The values are
 * identical; only the key order moved. Comparison therefore sorts object keys —
 * but never array elements, whose order IS data.
 *
 * Worth knowing beyond this test: any change-detection that hashes or string-
 * compares raw item JSON will see every JSONB field as "changed" after a round
 * trip, and re-upload rows that did not actually change.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

// Compare only what was actually set — mapRowToItem legitimately fills defaults
// for columns this fixture left blank.
const drifted: string[] = [];
for (const key of Object.keys(rich) as (keyof InventoryItem)[]) {
  const before = JSON.stringify(canonical(rich[key]));
  const after = JSON.stringify(canonical(readBack[key]));
  if (before !== after) drifted.push(`${String(key)}: sent ${before}, got ${after}`);
}
check('every populated field survives the round trip', drifted, []);
if (drifted.length) drifted.forEach((d) => console.log(`        ${d}`));

// Key order moves, so anything comparing raw JSON must normalise first.
check(
  'jsonb key order is not preserved (comparisons must normalise)',
  JSON.stringify(readBack.customer) === JSON.stringify(rich.customer),
  false
);

// Money must not drift by a cent through NUMERIC(12,2) and back.
check('buy price exact', readBack.buyPrice, 123.45);
check('sell price exact', readBack.sellPrice, 299.99);
check('nested payout survives', readBack.saleProceeds?.netPayoutEur, 275.49);
check('array order preserved', readBack.conditionToggles, ['OVP', 'Rechnung']);

// ---------------------------------------------------------------------------
console.log('\npart 2 — undo a sale, then reload it');

// Put the PC fixture back into its sold state first. This test reverts a sale,
// which permanently changes the fixture — without a reset the second run would
// find an already-restocked PC and fail for the wrong reason.
const soldPcState = [
  {
    id: 'fx-pc-parent',
    sell_price: 900,
    sell_date: '2026-08-10',
    status: 'Sold',
    comment2: '',
    ebay_sale_cycles: [],
    component_ids: ['fx-pc-child-1', 'fx-pc-child-2', 'fx-pc-child-3', 'fx-pc-child-4'],
  },
  { id: 'fx-pc-child-1', sell_price: 400, buy_price: 300 },
  { id: 'fx-pc-child-2', sell_price: 300, buy_price: 200 },
  { id: 'fx-pc-child-3', sell_price: 200, buy_price: 100 },
  { id: 'fx-pc-child-4', sell_price: 140, buy_price: 80 },
].map((patch) => ({
  sell_date: '2026-08-10',
  container_sold_date: '2026-08-10',
  status: 'Sold',
  comment2: '',
  ebay_sale_cycles: [],
  parent_container_id: patch.id === 'fx-pc-parent' ? null : 'fx-pc-parent',
  ...patch,
}));

async function resetSoldPc(): Promise<void> {
  for (const patch of soldPcState) {
    const { id, ...fields } = patch;
    const { error } = await client.from('inventory_items').update(fields).eq('id', id);
    if (error) throw new Error(`reset ${id} failed: ${error.message}`);
  }
}

await resetSoldPc();

const before = await load();
const pc = before.find((i) => i.id === 'fx-pc-parent')!;
check('fixture starts sold', pc.status, ItemStatus.SOLD);
const childrenBefore = before.filter((i) => i.parentContainerId === 'fx-pc-parent');
check('with four parts', childrenBefore.length, 4);

const { updates, deleteIds } = applyUnsoldRestock(before, ['fx-pc-parent']);
check('nothing scheduled for deletion', deleteIds, []);
await save(updates);

// The whole point: reload from the database rather than trusting the objects.
const after = await load();
const pcAfter = after.find((i) => i.id === 'fx-pc-parent')!;
const childrenAfter = after.filter((i) => i.parentContainerId === 'fx-pc-parent');

check('PC is back in stock', pcAfter.status, ItemStatus.IN_STOCK);
check('sale fields cleared', [pcAfter.sellDate, pcAfter.sellPrice], [undefined, undefined]);
check('previous sale archived', (pcAfter.ebaySaleCycles ?? []).length, 1);
check('archived sale kept its price', pcAfter.ebaySaleCycles?.[0]?.sellPrice, 900);
check('return note written', /\[Returned /.test(pcAfter.comment2 ?? ''), true);

check('all four parts still attached', childrenAfter.length, 4);
check(
  'parts moved to In Composition',
  [...new Set(childrenAfter.map((c) => c.status))],
  [ItemStatus.IN_COMPOSITION]
);
check(
  'component list intact',
  [...(pcAfter.componentIds ?? [])].sort(),
  ['fx-pc-child-1', 'fx-pc-child-2', 'fx-pc-child-3', 'fx-pc-child-4']
);
check(
  'part costs unchanged by the revert',
  childrenAfter.map((c) => c.buyPrice).sort((a, b) => a - b),
  [80, 100, 200, 300]
);
check(
  'each part archived its own sale',
  childrenAfter.every((c) => (c.ebaySaleCycles ?? []).length === 1),
  true
);

// Leave the fixtures as we found them. This test is the only one that mutates
// shared state, and verify-money-paths asserts exact euro totals against the PC
// being sold — an un-restored fixture fails that suite instead of this one, which
// is a confusing way to find out.
await resetSoldPc();

// fx-roundtrip is scratch, not a fixture. Left behind it becomes a real August
// sale worth 305.48, which silently inflates the revenue total that
// verify-money-paths asserts — it did exactly that before this line existed.
const { error: cleanupErr } = await client.from('inventory_items').delete().eq('id', 'fx-roundtrip');
if (cleanupErr) throw new Error(`cleanup failed: ${cleanupErr.message}`);
console.log('\nfixtures restored, scratch row removed');

console.log(failures === 0 ? '\nRound trip verified.' : `\n${failures} assertion(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
