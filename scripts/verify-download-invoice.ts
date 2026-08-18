/**
 * Run: npx tsx scripts/verify-download-invoice.ts
 */
import assert from 'node:assert/strict';
import { invoiceFileStem, fitInvoiceImageOnA4 } from '../utils/downloadInvoice';

assert.equal(invoiceFileStem('RE-20260818-042'), 'Rechnung-RE-20260818-042');
assert.equal(invoiceFileStem('RE/2026:x'), 'Rechnung-RE-2026-x');
assert.ok(!invoiceFileStem('a/b\\c:*?"<>|').includes('/'));
assert.ok(invoiceFileStem('').startsWith('Rechnung-'));

{
  const a4 = { w: 210, h: 297 };
  const short = fitInvoiceImageOnA4(800, 600, a4.w, a4.h);
  assert.equal(short.width, a4.w);
  assert.ok(short.height < a4.h);

  const tall = fitInvoiceImageOnA4(800, 2000, a4.w, a4.h);
  assert.equal(tall.height, a4.h);
  assert.ok(tall.width < a4.w);
}

console.log('verify-download-invoice: ok');
