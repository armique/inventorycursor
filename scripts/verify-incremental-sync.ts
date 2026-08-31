/**
 * Incremental inventory read, tested against the TEST project.
 *
 * Drives the real fetchInventoryDelta (client injected) rather than a copy of
 * its queries, so the manifest paging, the chunked body fetch and the
 * partial-read guards are all exercised as shipped.
 *
 * The case that matters most is deletion. An "only fetch what changed" read
 * cannot see a row deleted elsewhere — it just stops appearing, which looks
 * exactly like "unchanged". Getting that wrong means a sold item deleted on the
 * phone stays in the totals on the PC forever.
 *
 * Run: npx tsx scripts/verify-incremental-sync.ts
 */
import { getTestClient } from './lib/testTarget.mjs';
import { fetchInventoryDelta } from '../services/supabaseService';

const { client, ref } = getTestClient();
console.log(`incremental sync against ${ref}\n`);

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

const delta = (known: Map<string, string>) => fetchInventoryDelta(USER_ID!, known, client as never);

/** The local cache an app would hold: id -> the updated_at it last saw. */
async function currentManifest(): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('inventory_items')
    .select('id,updated_at')
    .eq('user_id', USER_ID!);
  if (error) throw new Error(error.message);
  return new Map((data as { id: string; updated_at: string }[]).map((r) => [r.id, r.updated_at]));
}

// ---------------------------------------------------------------------------
console.log('cold start (nothing cached)');
const cold = await delta(new Map());
const total = cold.serverIds.length;
check('every row is fetched', cold.changed.length, total);
check('nothing reported unchanged', cold.unchangedCount, 0);
check('nothing reported deleted', cold.deletedIds, []);
check('rows are fully decoded', typeof cold.changed[0]?.name, 'string');
console.log(`        ${total} rows fetched on a cold start`);

// ---------------------------------------------------------------------------
console.log('\nwarm start (cache is current)');
const warm = await delta(await currentManifest());
check('no bodies fetched', warm.changed.length, 0);
check('all rows recognised as current', warm.unchangedCount, total);
check('nothing reported deleted', warm.deletedIds, []);
console.log(`        ${total} rows, 0 bodies — this is the egress saving`);

// ---------------------------------------------------------------------------
console.log('\none row edited elsewhere');
const cache = await currentManifest();
const { error: upErr } = await client
  .from('inventory_items')
  .update({ comment1: `touched ${Date.now()}` })
  .eq('id', 'fx-stock-1');
if (upErr) throw new Error(upErr.message);

const oneEdit = await delta(cache);
check('exactly one body fetched', oneEdit.changed.length, 1);
check('and it is the edited row', oneEdit.changed[0]?.id, 'fx-stock-1');
check('the rest are untouched', oneEdit.unchangedCount, total - 1);
check('nothing reported deleted', oneEdit.deletedIds, []);

// ---------------------------------------------------------------------------
console.log('\nrow deleted elsewhere');
// The failure mode this guards: a delta read cannot observe an absence. Only
// the manifest can, which is why the manifest lists every server id.
await client.from('inventory_items').upsert(
  [
    {
      id: 'fx-doomed-sync',
      user_id: USER_ID,
      name: 'Wird geloescht',
      buy_price: 10,
      buy_date: '2026-07-01',
      category: 'PC-Komponenten',
      status: 'In Stock',
      is_trash: false,
    },
  ],
  { onConflict: 'id' }
);
const cacheWithDoomed = await currentManifest();
check('doomed row is in the cache', cacheWithDoomed.has('fx-doomed-sync'), true);

await client.from('inventory_items').delete().eq('id', 'fx-doomed-sync');
const afterDelete = await delta(cacheWithDoomed);
check('deletion is detected', afterDelete.deletedIds, ['fx-doomed-sync']);
check('no bodies fetched for it', afterDelete.changed.length, 0);
check('everything else still current', afterDelete.unchangedCount, total);

// ---------------------------------------------------------------------------
console.log('\nstale cache entries do not resurrect');
// A cache holding a row the server never had must report it deleted, not
// silently keep it.
const ghost = new Map(await currentManifest());
ghost.set('fx-never-existed', '2020-01-01T00:00:00Z');
const withGhost = await delta(ghost);
check('unknown local row reported deleted', withGhost.deletedIds, ['fx-never-existed']);

// ---------------------------------------------------------------------------
console.log('\nchanged rows carry full data, not just ids');
const cache2 = await currentManifest();
await client.from('inventory_items').update({ sell_price: 777 }).eq('id', 'fx-sold-1');
const priced = await delta(cache2);
check('the money field came back', priced.changed.find((i) => i.id === 'fx-sold-1')?.sellPrice, 777);
// restore
await client.from('inventory_items').update({ sell_price: 250 }).eq('id', 'fx-sold-1');

console.log(failures === 0 ? '\nIncremental sync verified.' : `\n${failures} assertion(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
