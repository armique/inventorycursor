import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildEbayTxOrderLedgers,
  isEbayTransactionReportText,
  mergeEbayTxReports,
  parseEbayTransactionReport,
} from '../utils/ebayTransactionReport';
import { buildEbayTxBulkMatchSuggestions } from '../utils/ebayTxBulkMatchSuggestions';

// Credentials come from the environment ONLY. Never hardcode a service role key
// as a fallback: it bypasses all Row Level Security, and a literal committed
// here is a full read/write credential published to the repo.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRIMARY_OWNER_UID = '568865df-ee65-4de7-870b-ef73cd1f9c35';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).');
  process.exit(1);
}

const CSV_DIR = path.join(process.cwd(), 'data', 'ebay-abrechnung');

async function main() {
  console.log('=== Abrechnung CSV Import to Supabase ===');
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!fs.existsSync(CSV_DIR)) {
    console.error('Missing data/ebay-abrechnung');
    process.exit(1);
  }
  const files = fs
    .readdirSync(CSV_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .filter((name) => {
      const text = fs.readFileSync(path.join(CSV_DIR, name), 'utf8');
      return isEbayTransactionReportText(text);
    })
    .sort();
  if (!files.length) {
    console.error('No eBay Transaktionsbericht CSV files found in data/ebay-abrechnung');
    process.exit(1);
  }

  console.log('Found CSV files:', files);

  const reports = files.map((name) =>
    parseEbayTransactionReport(fs.readFileSync(path.join(CSV_DIR, name), 'utf8'), name)
  );

  // 1. Upload reports to ebay_tx_reports
  console.log('\n1. Uploading reports to ebay_tx_reports table...');
  for (const report of reports) {
    const reportId = report.meta.id || path.basename(report.meta.fileName || 'report', '.csv');
    const { error } = await sb.from('ebay_tx_reports').upsert(
      {
        id: reportId,
        user_id: PRIMARY_OWNER_UID,
        report_name: report.meta.fileName || reportId,
        report_data: {
          meta: report.meta,
          summary: report.summary,
          rows: report.rows,
        },
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      console.error(`Error uploading report ${reportId}:`, error);
    } else {
      console.log(`  ✓ Report ${reportId} (${report.rows.length} rows) saved to Supabase.`);
    }
  }

  // 2. Extract and upload all individual orders to ebay_orders
  console.log('\n2. Extracting and uploading individual orders to ebay_orders table...');
  const merged = mergeEbayTxReports(reports);
  if (!merged?.rows?.length) {
    console.error('No rows after merge');
    process.exit(1);
  }

  const ledgers = buildEbayTxOrderLedgers(merged.rows);
  const orderRows = merged.rows.filter((r) => r.kind === 'order' && (r.orderId || '').trim());

  const ordersById = new Map<string, any>();
  for (const row of orderRows) {
    const orderId = row.orderId.trim();
    const ledger = ledgers.get(orderId) || null;
    if (!ordersById.has(orderId)) {
      ordersById.set(orderId, {
        id: orderId,
        user_id: PRIMARY_OWNER_UID,
        order_id: orderId,
        order_data: {
          orderId,
          title: row.title || row.description,
          buyerUsername: row.buyerUsername,
          buyerName: row.buyerName,
          date: row.createdSort || row.createdAt,
          itemSubtotalEur: row.itemSubtotalEur,
          shippingEur: row.shippingEur,
          grossEur: row.grossEur,
          netEur: row.netEur,
          ledger,
          source: 'csv',
        },
        updated_at: new Date().toISOString(),
      });
    }
  }

  const orderEntries = Array.from(ordersById.values());
  console.log(`Total unique orders extracted: ${orderEntries.length}`);

  const BATCH_SIZE = 100;
  for (let i = 0; i < orderEntries.length; i += BATCH_SIZE) {
    const batch = orderEntries.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from('ebay_orders').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Error uploading orders batch:`, error);
    } else {
      console.log(`  ✓ Uploaded orders batch ${Math.floor(i / BATCH_SIZE) + 1} (${Math.min(i + BATCH_SIZE, orderEntries.length)} / ${orderEntries.length})`);
    }
  }

  console.log(`\n✓ All ${orderEntries.length} orders successfully written to ebay_orders table in Supabase!`);
  console.log('=== Migration Finished ===');
}

main().catch(console.error);
