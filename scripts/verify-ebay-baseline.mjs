/**
 * eBay baseline verification — READ-ONLY.
 *
 * Run AFTER importing the fresh Transaktionsbericht CSVs. Answers the only
 * question that matters for this migration: does every order that inventory
 * items are already linked to still exist in Supabase after the re-import?
 *
 * Linked financials live on inventory_items (ebay_order_id / sell_price /
 * sell_date / fee_amount / profit) and are never touched by an Abrechnung
 * re-import, so nothing here can require re-linking. This just surfaces
 * coverage gaps: linked orders the fresh CSVs did not bring back.
 *
 *   node scripts/verify-ebay-baseline.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

/** Supabase auth UUID for the owner. NOT the legacy Firebase UID — .env.local's
 *  SUPABASE_MIGRATION_USER_ID still holds a Firebase-format id, and keying a
 *  query on that silently matches zero rows. */
const PRIMARY_OWNER_UID = '568865df-ee65-4de7-870b-ef73cd1f9c35';
const userId = process.env.SUPABASE_OWNER_UID || PRIMARY_OWNER_UID;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

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

const norm = (s) => (s || '').toString().trim();

async function main() {
  const items = await fetchAll('inventory_items', 'id,name,status,is_trash,ebay_order_id,sell_price,sell_date,fee_amount,profit');
  const reports = await fetchAll('ebay_tx_reports', 'id,report_name,report_data');
  const orders = await fetchAll('ebay_orders', 'id,order_id');

  const linkedItems = items.filter((i) => norm(i.ebay_order_id));
  const linkedOrderIds = new Set(linkedItems.map((i) => norm(i.ebay_order_id)));

  // Order ids present in the imported report row data.
  const reportOrderIds = new Set();
  const reportMeta = [];
  for (const r of reports) {
    const rows = Array.isArray(r.report_data?.rows) ? r.report_data.rows : [];
    let n = 0;
    for (const row of rows) {
      if (row?.kind === 'order' && norm(row.orderId)) {
        reportOrderIds.add(norm(row.orderId));
        n++;
      }
    }
    reportMeta.push({
      id: r.id,
      name: r.report_name,
      start: r.report_data?.meta?.startDate || null,
      end: r.report_data?.meta?.endDate || null,
      orderRows: n,
      rowsStored: rows.length,
    });
  }

  const cloudOrderIds = new Set(orders.map((o) => norm(o.order_id)).filter(Boolean));

  const missingFromReports = [...linkedOrderIds].filter((id) => !reportOrderIds.has(id)).sort();
  const missingFromOrdersTable = [...linkedOrderIds].filter((id) => !cloudOrderIds.has(id)).sort();

  // Financial integrity of the linked set — must be unchanged by any re-import.
  const financials = linkedItems.reduce(
    (acc, i) => {
      if (i.sell_price != null) acc.withSellPrice++;
      if (i.sell_date) acc.withSellDate++;
      if (i.fee_amount != null) acc.withFeeAmount++;
      if (i.profit != null) acc.withProfit++;
      return acc;
    },
    { withSellPrice: 0, withSellDate: 0, withFeeAmount: 0, withProfit: 0 }
  );

  const result = {
    checkedAt: new Date().toISOString(),
    userId,
    linked: {
      items: linkedItems.length,
      distinctOrderIds: linkedOrderIds.size,
      financialsPresent: financials,
    },
    supabase: {
      ebay_tx_reports: reports.length,
      ebay_orders: orders.length,
      distinctOrderIdsInReports: reportOrderIds.size,
      distinctOrderIdsInOrdersTable: cloudOrderIds.size,
    },
    reports: reportMeta,
    coverageGaps: {
      linkedOrdersMissingFromReports: {
        count: missingFromReports.length,
        ids: missingFromReports,
      },
      linkedOrdersMissingFromEbayOrdersTable: {
        count: missingFromOrdersTable.length,
        sample: missingFromOrdersTable.slice(0, 50),
      },
    },
    verdict:
      missingFromReports.length === 0
        ? 'PASS — every linked order is covered by the imported reports.'
        : `REVIEW — ${missingFromReports.length} of ${linkedOrderIds.size} linked orders are not in the imported reports. Their item financials are untouched; decide per order.`,
  };

  const outDir = path.join('data', 'live-backups');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `ebay-baseline-verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  // Console summary (full id list lives in the file).
  const brief = { ...result };
  brief.coverageGaps = {
    linkedOrdersMissingFromReports: {
      count: missingFromReports.length,
      sample: missingFromReports.slice(0, 25),
    },
    linkedOrdersMissingFromEbayOrdersTable: result.coverageGaps.linkedOrdersMissingFromEbayOrdersTable,
  };
  console.log(JSON.stringify(brief, null, 2));
  console.log(`\nFull report: ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
