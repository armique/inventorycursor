/**
 * Parse the Seller Hub Transaktionsbericht and print Hub-style totals.
 * Run: npx tsx scripts/verify-ebay-transaction-report.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeEbayTxReports,
  parseDeMoney,
  parseEbayTransactionReport,
  parseEbayTxDate,
} from '../utils/ebayTransactionReport';

assert.equal(parseDeMoney('-6,19'), -6.19);
assert.equal(parseDeMoney('1.234,56'), 1234.56);
assert.equal(parseDeMoney('38,59'), 38.59);
assert.equal(parseEbayTxDate('2. Feb 2026').sort, '2026-02-02');

const paths = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'C:/Users/ADMIN/Downloads/Transaction-Aug-23-2026-01_33_51-0700-12340842606.csv',
      'C:/Users/ADMIN/Downloads/Transaction-Aug-23-2026-01_34_44-0700-11329376017.csv',
    ];
const reports = paths.map((csvPath) => {
  const text = readFileSync(csvPath, 'utf8');
  const parsed = parseEbayTransactionReport(text, csvPath.split(/[/\\]/).pop() || 'report.csv');
  console.log(
    `${parsed.meta.id}: ${parsed.summary.rowCount} rows · Verkaufserlös €${parsed.summary.salesGrossEur.toFixed(2)}`
  );
  return parsed;
});
const report = mergeEbayTxReports(reports)!;
assert.ok(reports.length >= 1);
if (reports.length === 2) {
  assert.notEqual(reports[0].meta.id, reports[1].meta.id, 'the two CSVs must stay as separate periods');
}
const s = report.summary;

assert.ok(s.rowCount > 100, `expected a full report, got ${s.rowCount} rows`);
assert.ok(s.orderCount > 0);
assert.ok(s.salesGrossEur > 1000);
assert.equal(report.meta.seller.toLowerCase().includes('rm4ik') || report.meta.seller.length > 0, true);

console.log(`seller: ${report.meta.seller}`);
console.log(`period: ${report.meta.startDate} → ${report.meta.endDate}`);
console.log(`rows: ${s.rowCount} · orders: ${s.orderCount} · unique: ${s.uniqueOrders}`);
console.log(`Verkaufserlös: €${s.salesGrossEur.toFixed(2)}`);
console.log(`  item: €${s.itemSubtotalEur.toFixed(2)} · ship: €${s.buyerShippingEur.toFixed(2)}`);
console.log(`Rückerstattungen: €${s.refundsTotalEur.toFixed(2)}`);
console.log(`Kosten: €${s.costsTotalEur.toFixed(2)} (fees ${s.feesTotalEur.toFixed(2)} · labels ${s.labelsEur.toFixed(2)})`);
console.log(`  fee rows: €${s.feeRowsEur.toFixed(2)} · FVF on order: €${s.orderEmbeddedFeesEur.toFixed(2)}`);
console.log(`Auszahlungen: €${s.payoutsEur.toFixed(2)}`);
console.log(`Wallet net: €${s.walletNetEur.toFixed(2)}`);
console.log('by kind:');
for (const b of s.byKind) {
  console.log(`  ${b.label}: ${b.count}  gross €${b.grossEur.toFixed(2)}  net €${b.netEur.toFixed(2)}`);
}
console.log('verify-ebay-transaction-report: ok');
