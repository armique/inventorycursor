/**
 * Seeds the TEST project with synthetic fixtures.
 *
 * Deliberately synthetic, not a copy of production. The money paths that need
 * testing — sold containers, refunds, split cost origins, absorbed cancellation
 * fees — are all reproducible from invented data, and a copy of the real
 * inventory would put real customer names and buy prices in a second database
 * for no extra coverage.
 *
 * Every fixture exists to exercise one specific rule, named in its comment. The
 * expected totals are asserted in verify-money-paths.mjs, so a change in the
 * aggregation logic shows up as a failing number rather than a plausible one.
 *
 * Idempotent: re-running replaces the fixtures rather than duplicating them.
 */
import { getTestClient } from './lib/testTarget.mjs';

const { client, ref } = getTestClient();
console.log(`seeding ${ref}\n`);

// ---------------------------------------------------------------------------
// Fixture owner. A real auth.users row is required: every table's user_id is a
// foreign key to it, and RLS is written against auth.uid().
// ---------------------------------------------------------------------------
const FIXTURE_EMAIL = 'fixtures@inventory-pro.test';

async function ensureFixtureUser() {
  const { data: list, error: listErr } = await client.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const existing = list.users.find((u) => u.email === FIXTURE_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await client.auth.admin.createUser({
    email: FIXTURE_EMAIL,
    // Random and never recorded — nothing signs in as this user; the tests use
    // the service role. It exists only to satisfy the foreign keys.
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  return data.user.id;
}

const USER_ID = await ensureFixtureUser();
console.log(`fixture user: ${USER_ID}`);

const now = new Date().toISOString();

/** Column defaults, so each fixture only states what it is actually testing. */
const base = (id, name, overrides) => ({
  id,
  user_id: USER_ID,
  name,
  buy_price: 0,
  buy_date: '2026-07-01',
  category: 'PC-Komponenten',
  status: 'In Stock',
  is_trash: false,
  ...overrides,
});

const items = [
  // -- baseline -------------------------------------------------------------
  // Plain unsold stock. Contributes cost but no revenue.
  base('fx-stock-1', 'RTX 4070 (Lager)', {
    buy_price: 400,
    store_price: 620,
    sub_category: 'Grafikkarte',
  }),

  // Plain closed sale. The simplest revenue line: 250 in, 100 profit.
  base('fx-sold-1', 'Ryzen 5600X (verkauft)', {
    buy_price: 150,
    sell_price: 250,
    profit: 100,
    sell_date: '2026-08-05',
    status: 'Sold',
    platform_sold: 'Kleinanzeigen',
  }),

  // -- sold PC with children ------------------------------------------------
  // The dedup case. isSoldWithProportionalChildren() is true here, so sale
  // totals must count the parent's 900 ONCE and skip all three children.
  // If a child is counted too, revenue inflates by 900 — this is the shape
  // behind the flapping monthly profit.
  base('fx-pc-parent', 'Gaming PC Komplett', {
    buy_price: 0,
    sell_price: 900,
    sell_date: '2026-08-10',
    status: 'Sold',
    is_pc: true,
    component_ids: ['fx-pc-child-1', 'fx-pc-child-2', 'fx-pc-child-3', 'fx-pc-child-4'],
    sale_proceeds: {
      capturedAt: now,
      source: 'ebay_csv',
      itemGrossEur: 900,
      buyerShippingEur: 0,
      buyerTotalEur: 900,
      transactionFeeEur: 90,
      netPayoutEur: 810,
    },
  }),
  base('fx-pc-child-1', 'RTX 3080 (im PC)', {
    buy_price: 300,
    sell_price: 400,
    profit: 100,
    sell_date: '2026-08-10',
    container_sold_date: '2026-08-10',
    status: 'Sold',
    parent_container_id: 'fx-pc-parent',
  }),
  base('fx-pc-child-2', 'Ryzen 7700 (im PC)', {
    buy_price: 200,
    sell_price: 300,
    profit: 100,
    sell_date: '2026-08-10',
    container_sold_date: '2026-08-10',
    status: 'Sold',
    parent_container_id: 'fx-pc-parent',
  }),
  base('fx-pc-child-3', '32GB DDR5 (im PC)', {
    buy_price: 100,
    sell_price: 200,
    profit: 100,
    sell_date: '2026-08-10',
    container_sold_date: '2026-08-10',
    status: 'Sold',
    parent_container_id: 'fx-pc-parent',
  }),

  // -- the dangerous shape --------------------------------------------------
  // A fourth sold child of the same PC. It exists to be *dropped* by the
  // partial-read test, not to be odd in itself.
  //
  // Note what the database refuses to store: parent_container_id has a foreign
  // key, so a child pointing at a missing parent cannot be inserted at all. That
  // means the fail-open branch in shouldSkipSoldContainerChildForSaleTotals
  // (`if (!parent) return false` — count the child) can NEVER be reached by real
  // data. The only way to reach it is a read that returned the child but not the
  // parent. That is why the fix belongs in the read path, and why a truncating
  // read silently inflates revenue instead of erroring.
  base('fx-pc-child-4', 'SSD 2TB (im PC)', {
    buy_price: 80,
    sell_price: 140,
    profit: 60,
    sell_date: '2026-08-10',
    container_sold_date: '2026-08-10',
    status: 'Sold',
    parent_container_id: 'fx-pc-parent',
  }),

  // -- refund ---------------------------------------------------------------
  // Sold then fully refunded. Effective revenue must be 0, not 250.
  base('fx-refunded', 'Mainboard B550 (erstattet)', {
    buy_price: 90,
    sell_price: 0,
    original_sell_price: 250,
    sell_date: '2026-08-14',
    status: 'Sold',
    ebay_order_id: '11-11111-11111',
    platform_sold: 'eBay',
    ebay_sale_adjustments: [
      {
        id: 'fx-adj-refund-1',
        date: '2026-08-20',
        kind: 'refund',
        amount: -250,
        orderId: '11-11111-11111',
        reason: 'Käufer hat zurückgesendet',
        source: 'ebay_csv',
        importedAt: now,
        sellPriceBefore: 250,
        sellPriceAfter: 0,
      },
    ],
  }),

  // -- cancellation fee absorbed into buy price -----------------------------
  // eBay cancelled the order; the item returned to stock and the fee was added
  // to its cost. buy_price is 90 + 12.50, not 90.
  base('fx-cancel-fee', 'Netzteil 750W (Storno-Gebühr)', {
    buy_price: 102.5,
    status: 'In Stock',
    has_fee: true,
    fee_amount: 12.5,
    ebay_sale_adjustments: [
      {
        id: 'fx-adj-cancel-1',
        date: '2026-08-18',
        kind: 'cancellation',
        amount: -12.5,
        orderId: '22-22222-22222',
        reason: 'Verkäufer-Storno',
        source: 'ebay_api',
        importedAt: now,
        sellPriceBefore: 130,
        sellPriceAfter: 0,
        revertToStock: true,
        buyPriceBefore: 90,
        buyPriceAfter: 102.5,
        buyPriceDelta: 12.5,
      },
    ],
  }),

  // -- bundle split ---------------------------------------------------------
  // One 500 EUR lot split into two parts. The allocated costs must sum back to
  // the lot total: 320 + 180 = 500, no cost created or lost by splitting.
  base('fx-split-a', 'Konvolut Teil A', {
    buy_price: 320,
    split_origin: 'fx-lot-1',
    cost_origin: {
      kind: 'bundle_split',
      capturedAt: now,
      label: 'Konvolut · SMART · 500 EUR -> 320 EUR',
      addedAs: 'Konvolut-Teil',
      bundleName: 'Konvolut 500',
      bundleId: 'fx-lot-1',
      partCount: 2,
      lotTotalEur: 500,
      allocatedEur: 320,
      allocationMethod: 'SMART',
      allocationMode: 'SMART',
    },
  }),
  base('fx-split-b', 'Konvolut Restposten', {
    buy_price: 180,
    split_origin: 'fx-lot-1',
    is_split_remainder: true,
    cost_origin: {
      kind: 'bundle_split',
      capturedAt: now,
      label: 'Konvolut · SMART · 500 EUR -> 180 EUR',
      addedAs: 'Restposten',
      bundleName: 'Konvolut 500',
      bundleId: 'fx-lot-1',
      partCount: 2,
      lotTotalEur: 500,
      allocatedEur: 180,
      allocationMethod: 'SMART',
      allocationMode: 'SMART',
    },
  }),

  // -- composition child ----------------------------------------------------
  // Part reserved inside an unsold build. Must not appear as its own stock line.
  base('fx-build-parent', 'PC im Aufbau', {
    is_pc: true,
    component_ids: ['fx-build-child'],
  }),
  base('fx-build-child', 'RTX 4060 (im Aufbau)', {
    buy_price: 250,
    status: 'In Composition',
    parent_container_id: 'fx-build-parent',
  }),
];

const expenses = [
  {
    id: 'fx-exp-1',
    user_id: USER_ID,
    description: 'Versandmaterial',
    amount: 45.9,
    date: '2026-08-03',
    category: 'Verpackung',
  },
  {
    id: 'fx-exp-2',
    user_id: USER_ID,
    description: 'eBay Shopgebühr',
    amount: 39.95,
    date: '2026-08-01',
    category: 'Gebühren',
  },
];

const ebayOrders = [
  {
    id: 'fx-order-1',
    user_id: USER_ID,
    order_id: '11-11111-11111',
    order_data: {
      orderId: '11-11111-11111',
      creationDate: '2026-08-14T10:00:00Z',
      buyerUsername: 'test_buyer_1',
      total: 250,
      lineItems: [{ title: 'Mainboard B550', quantity: 1, lineItemCost: 250 }],
      refunded: true,
    },
  },
];

async function replace(table, rows) {
  if (rows.length) {
    const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { count } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER_ID);
  console.log(`  ${table.padEnd(18)} ${rows.length} written, ${count} total`);
}

// Parents before children: parent_container_id is a self-referencing FK.
const parentIds = new Set(['fx-pc-parent', 'fx-build-parent']);
await replace('inventory_items', items.filter((i) => parentIds.has(i.id)));
await replace('inventory_items', items.filter((i) => !parentIds.has(i.id)));
await replace('expenses', expenses);
await replace('ebay_orders', ebayOrders);

console.log('\nSeed complete.');
