/**
 * Archive JSON field map + payout identity.
 * Reads the desktop Hub dump when present.
 * Run: npx tsx scripts/verify-hub-archive-fields.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHubArchiveJson, HUB_ARCHIVE_KIND } from '../utils/ebayHubArchiveFile';
import {
  hubArchivePayoutFromOrder,
  hubArchivePayoutReconciles,
} from '../utils/hubArchiveFields';

const sample = JSON.stringify({
  kind: HUB_ARCHIVE_KIND,
  version: 1,
  orders: [
    {
      orderId: '05-12610-90130',
      creationDate: '2025-01-20',
      buyer: { username: 'selv_demi' },
      lineItems: [],
      grossTotal: 66.99,
      netTotal: 51.33,
      feeTotal: 15.66,
      shippingCost: 7.69,
      financialEvents: [
        { id: 's', date: '2025-01-20', kind: 'sale', amount: 66.99, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
        { id: 'a', date: '2025-01-20', kind: 'fee', amount: -7.97, transactionType: 'Anzeigengebühr Basis', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
        { id: 'l', date: '2025-01-20', kind: 'fee', amount: -7.69, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
      ],
      sources: ['hub'],
      importedAt: '2026-08-19T00:00:00.000Z',
    },
  ],
});

const parsed = parseHubArchiveJson(sample);
assert.equal(parsed.orders.length, 1);
const first = hubArchivePayoutFromOrder(parsed.orders[0]);
assert.equal(first.buyerTotalEur, 66.99);
assert.equal(first.adFeeEur, 7.97);
assert.equal(first.shippingLabelEur, 7.69);
assert.equal(first.transactionFeeEur, 0);
assert.equal(first.netPayoutEur, 51.33);
assert.equal(first.feeTotalEur, 15.66);
assert.equal(hubArchivePayoutReconciles(parsed.orders[0]), true);

const desktopCandidates = [
  'C:/Users/ADMIN/Desktop/ebay-order-archive/ebay-order-archive.json',
  path.join(process.env.USERPROFILE || '', 'Desktop', 'ebay-order-archive', 'ebay-order-archive.json'),
];
const desktopPath = desktopCandidates.find((p) => p && fs.existsSync(p));
if (desktopPath) {
  const doc = parseHubArchiveJson(fs.readFileSync(desktopPath, 'utf8'));
  assert.ok(doc.orders.length > 100, `expected a full Hub dump, got ${doc.orders.length}`);
  let mismatches = 0;
  for (const order of doc.orders) {
    if (!hubArchivePayoutReconciles(order)) mismatches += 1;
  }
  assert.ok(
    mismatches / doc.orders.length < 0.05,
    `${mismatches}/${doc.orders.length} archive rows fail Gesamtbetrag − fees = Bestelleinnahmen`
  );
  const jan = doc.orders.find((o) => o.orderId === '05-12610-90130');
  if (jan) {
    const p = hubArchivePayoutFromOrder(jan);
    assert.equal(p.buyerTotalEur, 66.99);
    assert.equal(p.netPayoutEur, 51.33);
    assert.equal(p.shippingLabelEur, 7.69);
  }
  console.log(`verify-hub-archive-fields: ok (${doc.orders.length} desktop orders, ${mismatches} slack)`);
} else {
  console.log('verify-hub-archive-fields: ok (sample only — desktop dump not found)');
}
