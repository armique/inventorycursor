/**
 * eBay baseline backup + audit — READ-ONLY.
 *
 * Run BEFORE any Abrechnung wipe. Dumps, to data/live-backups/ebay-baseline-<ts>/:
 *   - linked-items.json      every inventory_items row that carries an ebay_order_id
 *                            (id, name, ebay_order_id, sell_price, sell_date, fee_amount,
 *                             profit, status + the JSONB sale fields) — this is the set that
 *                             MUST survive the wipe and be re-matched by the CSV import.
 *   - ebay_tx_reports.json   full current contents (so a wipe is reversible)
 *   - ebay_orders.json       full current contents (so a wipe is reversible)
 *   - audit.json             counts + the order-id overlap analysis
 *
 * This script never writes to Supabase. Run:
 *   node scripts/ebay-baseline-backup.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const PRIMARY_OWNER_UID = '568865df-ee65-4de7-870b-ef73cd1f9c35';
const userId = process.env.SUPABASE_MIGRATION_USER_ID || PRIMARY_OWNER_UID;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

/** Supabase caps a select at 1000 rows; page until exhausted. */
async function fetchAll(table, columns = '*') {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join('data', 'live-backups', `ebay-baseline-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Reading Supabase for user ${userId} ...`);

  const items = await fetchAll(
    'inventory_items',
    [
      'id', 'name', 'status', 'is_trash',
      'ebay_order_id', 'ebay_order_line_key', 'ebay_listing_id', 'ebay_sku', 'ebay_username',
      'sell_price', 'sell_date', 'fee_amount', 'profit', 'original_sell_price',
      'buy_price', 'buy_date', 'platform_sold', 'payment_type',
      'sale_proceeds', 'ebay_sale_adjustments', 'ebay_sale_cycles', 'customer',
      'parent_container_id', 'component_ids', 'is_pc', 'is_bundle',
      'updated_at',
    ].join(',')
  );

  const linked = items.filter((i) => (i.ebay_order_id || '').trim());
  const reports = await fetchAll('ebay_tx_reports');
  const orders = await fetchAll('ebay_orders');

  const linkedOrderIds = new Set(linked.map((i) => i.ebay_order_id.trim()));
  const cloudOrderIds = new Set(orders.map((o) => (o.order_id || '').trim()).filter(Boolean));
  const linkedNotInCloud = [...linkedOrderIds].filter((id) => !cloudOrderIds.has(id));

  const audit = {
    generatedAt: new Date().toISOString(),
    userId,
    counts: {
      inventory_items_total: items.length,
      inventory_items_trash: items.filter((i) => i.is_trash).length,
      inventory_items_linked_to_ebay_order: linked.length,
      distinct_linked_order_ids: linkedOrderIds.size,
      ebay_tx_reports: reports.length,
      ebay_orders: orders.length,
      distinct_cloud_order_ids: cloudOrderIds.size,
    },
    linkedItemsByStatus: linked.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    }, {}),
    /** Linked order ids with no matching row in ebay_orders — these rely entirely on the
     *  CSV re-import covering them, so they are the ones to verify after the import. */
    linkedOrderIdsMissingFromCloudOrders: {
      count: linkedNotInCloud.length,
      sample: linkedNotInCloud.slice(0, 25),
    },
    reportSummaries: reports.map((r) => ({
      id: r.id,
      report_name: r.report_name,
      startDate: r.report_data?.meta?.startDate || null,
      endDate: r.report_data?.meta?.endDate || null,
      orderCount: r.report_data?.summary?.orderCount ?? null,
      rowsStored: Array.isArray(r.report_data?.rows) ? r.report_data.rows.length : 0,
    })),
  };

  const write = (name, data) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2), 'utf8');

  write('linked-items.json', linked);
  write('inventory-items-ebay-fields.json', items);
  write('ebay_tx_reports.json', reports);
  write('ebay_orders.json', orders);
  write('audit.json', audit);

  console.log(`\nBackup written to ${outDir}\n`);
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((err) => {
  console.error('Backup FAILED — do not proceed with any wipe.');
  console.error(err);
  process.exit(1);
});
