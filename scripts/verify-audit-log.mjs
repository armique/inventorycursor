/**
 * Verifies the durable audit log against the TEST project.
 *
 * The point of this table is that the record outlives the item and survives a
 * failed upload. Both of those are design claims, so both are asserted here
 * rather than assumed:
 *
 *   - a retried flush must not duplicate entries (the writer upserts on id)
 *   - deleting the item must NOT delete its history (item_id has no foreign key)
 *   - the three query shapes the UI needs must actually be answerable
 *
 * Rows are written in exactly the shape services/itemAuditLog.ts produces.
 */
import { getTestClient } from './lib/testTarget.mjs';

const { client, ref } = getTestClient();
console.log(`audit log against ${ref}\n`);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const { data: users } = await client.auth.admin.listUsers({ perPage: 200 });
const USER_ID = users.users.find((u) => u.email === 'fixtures@inventory-pro.test')?.id;
if (!USER_ID) throw new Error('Fixture user missing — run seed-test-data.mjs first.');

// Start clean so counts are exact.
await client.from('item_audit_log').delete().eq('user_id', USER_ID);

const at = (d) => `2026-08-${d}T12:00:00.000Z`;
const entries = [
  {
    id: 'fx-audit-1',
    user_id: USER_ID,
    item_id: 'fx-sold-1',
    item_name: 'Ryzen 5600X (verkauft)',
    action: 'price_change',
    title: 'Verkaufspreis geändert',
    details: '230 EUR -> 250 EUR',
    actor: 'manual',
    diffs: [{ field: 'sellPrice', from: 230, to: 250, label: 'Verkaufspreis' }],
    occurred_at: at('04'),
  },
  {
    id: 'fx-audit-2',
    user_id: USER_ID,
    item_id: 'fx-sold-1',
    item_name: 'Ryzen 5600X (verkauft)',
    action: 'sale',
    title: 'Verkauft',
    details: '250 EUR',
    actor: 'manual',
    diffs: [{ field: 'status', from: 'In Stock', to: 'Sold', label: 'Status' }],
    occurred_at: at('05'),
  },
  {
    id: 'fx-audit-3',
    user_id: USER_ID,
    item_id: 'fx-refunded',
    item_name: 'Mainboard B550 (erstattet)',
    action: 'refund',
    title: 'Erstattung',
    details: '-250 EUR',
    actor: 'ebay_sync',
    diffs: [{ field: 'sellPrice', from: 250, to: 0, label: 'Verkaufspreis' }],
    occurred_at: at('20'),
  },
  {
    id: 'fx-audit-4',
    user_id: USER_ID,
    // Deliberately points at an item that will be deleted below.
    item_id: 'fx-doomed-item',
    item_name: 'Gelöschtes Teil',
    action: 'delete',
    title: 'Endgültig gelöscht',
    details: 'Artikel entfernt',
    actor: 'manual',
    diffs: [],
    occurred_at: at('22'),
  },
];

// --- write ------------------------------------------------------------------
console.log('writing');
const { error: insErr } = await client.from('item_audit_log').upsert(entries, { onConflict: 'id' });
if (insErr) throw new Error(`insert failed: ${insErr.message}`);
const { count: afterFirst } = await client
  .from('item_audit_log')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', USER_ID);
check('4 entries written', afterFirst, 4);

// --- retry safety -----------------------------------------------------------
console.log('\nretry after a failed flush');
// The writer keeps entries queued when a flush fails and sends them again. If
// that produced duplicates, every network blip would inflate the history.
await client.from('item_audit_log').upsert(entries, { onConflict: 'id' });
await client.from('item_audit_log').upsert(entries, { onConflict: 'id' });
const { count: afterRetries } = await client
  .from('item_audit_log')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', USER_ID);
check('re-sending the same entries adds nothing', afterRetries, 4);

// --- survives deletion ------------------------------------------------------
console.log('\nhistory outlives the item');
// item_id is TEXT with no foreign key precisely so this works. Insert a real
// item, log against it, delete it, and confirm the log entry is still there.
await client.from('inventory_items').upsert(
  [
    {
      id: 'fx-doomed-item',
      user_id: USER_ID,
      name: 'Gelöschtes Teil',
      buy_price: 50,
      buy_date: '2026-07-15',
      category: 'PC-Komponenten',
      status: 'In Stock',
      is_trash: false,
    },
  ],
  { onConflict: 'id' }
);
const { error: delErr } = await client.from('inventory_items').delete().eq('id', 'fx-doomed-item');
if (delErr) throw new Error(`delete failed: ${delErr.message}`);

const { data: itemGone } = await client
  .from('inventory_items')
  .select('id')
  .eq('id', 'fx-doomed-item');
check('item is gone', itemGone.length, 0);

const { data: survivor } = await client
  .from('item_audit_log')
  .select('id, item_name, action')
  .eq('item_id', 'fx-doomed-item');
check('its history survived', survivor.length, 1);
check('and is still readable', survivor[0]?.item_name, 'Gelöschtes Teil');

// --- the queries the UI needs ----------------------------------------------
console.log('\nquery shapes');
const { data: timeline } = await client
  .from('item_audit_log')
  .select('id, occurred_at')
  .eq('user_id', USER_ID)
  .order('occurred_at', { ascending: false });
check('timeline is newest first', timeline.map((r) => r.id), [
  'fx-audit-4',
  'fx-audit-3',
  'fx-audit-2',
  'fx-audit-1',
]);

const { data: perItem } = await client
  .from('item_audit_log')
  .select('id')
  .eq('user_id', USER_ID)
  .eq('item_id', 'fx-sold-1')
  .order('occurred_at', { ascending: false });
check('everything that happened to one item', perItem.map((r) => r.id), ['fx-audit-2', 'fx-audit-1']);

const { data: refunds } = await client
  .from('item_audit_log')
  .select('id, details')
  .eq('user_id', USER_ID)
  .eq('action', 'refund')
  .gte('occurred_at', '2026-08-01')
  .lt('occurred_at', '2026-09-01');
check('every refund in August', refunds.map((r) => r.id), ['fx-audit-3']);

// --- old and new values both recoverable ------------------------------------
console.log('\nfield-level detail');
const { data: priceChange } = await client
  .from('item_audit_log')
  .select('diffs')
  .eq('id', 'fx-audit-1')
  .single();
check('diff keeps the old value', priceChange.diffs[0].from, 230);
check('diff keeps the new value', priceChange.diffs[0].to, 250);

console.log(failures === 0 ? '\nAudit log verified.' : `\n${failures} assertion(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
