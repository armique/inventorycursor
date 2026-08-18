/**
 * Run: npx tsx scripts/verify-download-invoice.ts
 */
import assert from 'node:assert/strict';
import { invoiceFileStem } from '../utils/downloadInvoice';

assert.equal(invoiceFileStem('RE-20260818-042'), 'Rechnung-RE-20260818-042');
assert.equal(invoiceFileStem('RE/2026:x'), 'Rechnung-RE-2026-x');
assert.ok(!invoiceFileStem('a/b\\c:*?"<>|').includes('/'));
assert.ok(invoiceFileStem('').startsWith('Rechnung-'));

console.log('verify-download-invoice: ok');
