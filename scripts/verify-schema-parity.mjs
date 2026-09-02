/**
 * Compares the TEST project's schema against PRODUCTION, column by column.
 *
 * This exists because of a real miss: the test project was built from
 * `20260828000000_initial_schema.sql` alone, so it lacked `inventory_items.history`
 * — a column the app writes on every single save. Tests would have passed against
 * a database the real client cannot write to, which is worse than no tests.
 *
 * Both sides are read through PostgREST's OpenAPI document, which lists the exact
 * columns each project actually exposes — the same surface the app talks to, not
 * what the migration files claim.
 *
 * Production is only ever READ here (the spec document, no table data).
 */
import dotenv from 'dotenv';
import { PRODUCTION_REF } from './lib/testTarget.mjs';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function columnsOf(url, key, label) {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`${label}: OpenAPI fetch failed ${res.status} ${await res.text()}`);
  const spec = await res.json();
  const out = new Map();
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    out.set(name, new Set(Object.keys(def.properties || {})));
  }
  return out;
}

const prodUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testUrl = process.env.TEST_SUPABASE_URL;
const testKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!prodUrl || !prodKey) throw new Error('Missing production credentials.');
if (!testUrl || !testKey) throw new Error('Missing test credentials (.env.test).');
if (new URL(testUrl).hostname.startsWith(PRODUCTION_REF)) {
  throw new Error('TEST_SUPABASE_URL points at production — nothing to compare.');
}

const [prod, test] = await Promise.all([
  columnsOf(prodUrl, prodKey, 'production'),
  columnsOf(testUrl, testKey, 'test'),
]);

let problems = 0;

for (const [table, prodCols] of [...prod].sort()) {
  const testCols = test.get(table);
  if (!testCols) {
    problems++;
    console.log(`MISSING TABLE  ${table}`);
    continue;
  }
  const missing = [...prodCols].filter((c) => !testCols.has(c)).sort();
  const extra = [...testCols].filter((c) => !prodCols.has(c)).sort();
  if (missing.length || extra.length) {
    problems++;
    console.log(`DIFFERS  ${table}`);
    if (missing.length) console.log(`   missing in test: ${missing.join(', ')}`);
    if (extra.length) console.log(`   only in test:    ${extra.join(', ')}`);
  } else {
    console.log(`ok       ${table.padEnd(24)} ${prodCols.size} columns`);
  }
}

for (const table of [...test.keys()].sort()) {
  if (!prod.has(table)) {
    problems++;
    console.log(`EXTRA TABLE in test  ${table}`);
  }
}

console.log(problems === 0 ? '\nSchemas match.' : `\n${problems} difference(s).`);
process.exitCode = problems === 0 ? 0 : 1;
