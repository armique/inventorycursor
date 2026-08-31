/**
 * Confirms the test project has the full schema, reached through the production
 * guard rather than the dashboard — the dashboard proves a query ran, not that
 * the app's own client can reach the tables.
 */
import { getTestClient } from './lib/testTarget.mjs';

const TABLES = [
  'user_profiles',
  'inventory_items',
  'expenses',
  'recurring_expenses',
  'ebay_orders',
  'ebay_tx_reports',
  'store_inquiries',
  'product_photo_cache',
  'action_history',
  'bulk_imports',
  'item_audit_log',
];

const { client, ref } = getTestClient();
console.log(`target: ${ref}\n`);

let bad = 0;
for (const t of TABLES) {
  const { error, count } = await client.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    bad++;
    console.log(`  MISSING  ${t.padEnd(22)} ${error.message}`);
  } else {
    console.log(`  ok       ${t.padEnd(22)} ${count} rows`);
  }
}

console.log(bad === 0 ? '\nAll tables present.' : `\n${bad} table(s) missing.`);
process.exitCode = bad === 0 ? 0 : 1;
