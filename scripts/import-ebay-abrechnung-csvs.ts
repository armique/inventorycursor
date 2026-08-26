/**
 * Parse bundled Abrechnung CSVs and print matcher suggestion stats (no browser).
 * Run: npx tsx scripts/import-ebay-abrechnung-csvs.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildEbayTxOrderLedgers,
  isEbayTransactionReportText,
  mergeEbayTxReports,
  parseEbayTransactionReport,
} from '../utils/ebayTransactionReport';
import { buildEbayTxBulkMatchSuggestions } from '../utils/ebayTxBulkMatchSuggestions';

const CSV_DIR = path.join(process.cwd(), 'data', 'ebay-abrechnung');

function main() {
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

  const reports = files.map((name) =>
    parseEbayTransactionReport(fs.readFileSync(path.join(CSV_DIR, name), 'utf8'), name)
  );

  const merged = mergeEbayTxReports(reports);
  if (!merged?.rows?.length) {
    console.error('No rows after merge');
    process.exit(1);
  }

  const ledgers = buildEbayTxOrderLedgers(merged.rows);
  const suggestions = buildEbayTxBulkMatchSuggestions([], merged.rows, ledgers);
  const orders = new Set(
    merged.rows.filter((row) => row.kind === 'order' && row.orderId).map((row) => row.orderId)
  );

  console.log(
    JSON.stringify(
      {
        csvFiles: files,
        rowCount: merged.rows.length,
        orderCount: orders.size,
        coverage: `${merged.meta.startDate} → ${merged.meta.endDate}`,
        suggestions: suggestions.length,
        high: suggestions.filter((s) => s.confidence === 'high').length,
        medium: suggestions.filter((s) => s.confidence === 'medium').length,
        low: suggestions.filter((s) => s.confidence === 'low').length,
        none: suggestions.filter((s) => s.confidence === 'none').length,
      },
      null,
      2
    )
  );
}

main();
