/**
 * Abrechnung list CSV export for daily project-folder copy.
 * Run: npx tsx scripts/verify-ebay-tx-report-csv-export.ts
 */
import assert from 'node:assert/strict';
import {
  buildEbayTxReportListCsv,
  buildEbayTxRowsCsv,
  EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
  ebayTxDailyExportFileName,
} from '../utils/ebayTxReportCsvExport';
import type { EbayTxReport } from '../utils/ebayTransactionReport';

const report: EbayTxReport = {
  meta: {
    id: 'r1',
    seller: 'test',
    startDate: '01.02.2025',
    endDate: '02.02.2026',
    fileName: 'tx.csv',
    importedAt: '2026-08-23T00:00:00.000Z',
  },
  rows: [
    {
      id: '1',
      createdAt: '15.03.2026',
      createdSort: '2026-03-15',
      typeRaw: 'Bestellung',
      kind: 'order',
      orderId: '11-22222-33333',
      buyerUsername: 'buyer1',
      buyerName: 'Buyer One',
      city: 'Berlin',
      zip: '10115',
      country: 'DE',
      netEur: 48,
      payoutDate: '',
      payoutId: '',
      payoutMethod: '',
      payoutStatus: '',
      listingId: '123',
      transactionId: '',
      title: 'Test RAM',
      sku: 'RAM-1',
      quantity: 1,
      itemSubtotalEur: 55,
      shippingEur: 7.19,
      sellerTaxEur: null,
      ebayTaxEur: null,
      fixedFeeEur: 5,
      variableFeeEur: 2,
      otherOrderFeeEur: null,
      grossEur: 62.19,
      currency: 'EUR',
      reference: '',
      description: '',
    },
  ],
  summary: {
    rowCount: 1,
    orderCount: 1,
    uniqueOrders: 1,
    salesGrossEur: 62.19,
    itemSubtotalEur: 55,
    buyerShippingEur: 7.19,
    sellerTaxEur: 0,
    refundGrossEur: 0,
    caseGrossEur: 0,
    disputeGrossEur: 0,
    refundsTotalEur: 0,
    feeRowsEur: 0,
    orderEmbeddedFeesEur: 7,
    feesTotalEur: 7,
    labelsEur: 0,
    costsTotalEur: 7,
    payoutsEur: 0,
    walletNetEur: 48,
    byKind: [],
    feeSlices: [],
  },
};

const { csv, rowCount, coverage } = buildEbayTxReportListCsv([report]);
assert.equal(rowCount, 1);
assert.ok(coverage.includes('2025'));
assert.ok(csv.includes('Date,Type,Kind,Source,Row ID,Order'));
assert.ok(csv.includes('11-22222-33333'));
assert.ok(csv.includes('Test RAM'));
assert.ok(csv.includes(',csv,1,'));
assert.equal(ebayTxDailyExportFileName('2026-08-23'), EBAY_ABRECHNUNG_BACKUP_FILE_NAME);
assert.equal(EBAY_ABRECHNUNG_BACKUP_FILE_NAME, 'ebay-abrechnung-backup.csv');
assert.equal(buildEbayTxRowsCsv(report.rows).rowCount, 1);

console.log('verify-ebay-tx-report-csv-export: ok');
