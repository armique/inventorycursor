/**
 * Run: npx tsx scripts/verify-health-insurance-ledger.ts
 */
import assert from 'node:assert/strict';
import type { Expense, RecurringExpense } from '../types';
import {
  AOK_MONTHLY,
  AOK_RECURRING_ID,
  AOK_START_DATE,
  DAK_PAYMENTS,
  DAK_TOTAL_EUR,
  applyHealthInsuranceLedger,
  dakPaymentsTotal,
} from '../utils/healthInsuranceLedger';
import { generateExpensesFromRecurring } from '../services/recurringExpenseService';

assert.equal(DAK_PAYMENTS.length, 10);
assert.equal(dakPaymentsTotal(), DAK_TOTAL_EUR);
assert.equal(DAK_PAYMENTS[0]?.date, '2025-07-01');
assert.equal(DAK_PAYMENTS[5]?.amount, 269.64);
assert.equal(DAK_PAYMENTS[6]?.amount, 297.54);
assert.equal(DAK_PAYMENTS[9]?.date, '2026-07-28');

const oldDak: Expense = {
  id: 'exp-old-dak',
  description: 'DAK Gesundheit Beitrag',
  amount: 200,
  date: '2025-06-01',
  category: 'Office',
};
const other: Expense = {
  id: 'exp-dhl',
  description: 'DHL',
  amount: 12,
  date: '2026-08-01',
  category: 'Shipping',
};
const oldRecurring: RecurringExpense = {
  id: 'recurring-dak-old',
  description: 'DAK Gesundheit',
  monthlyAmount: 269.64,
  startDate: '2025-07-01',
  category: 'Office',
};

const first = applyHealthInsuranceLedger([oldDak, other], [oldRecurring]);
assert.equal(first.changed, true);
assert.ok(!first.expenses.some((e) => e.id === 'exp-old-dak'));
assert.ok(first.expenses.some((e) => e.id === 'exp-dhl'));
assert.equal(first.expenses.filter((e) => e.description === 'DAK Gesundheit').length, 10);
assert.equal(
  Math.round(
    first.expenses.filter((e) => e.description === 'DAK Gesundheit').reduce((s, e) => s + e.amount, 0) * 100
  ) / 100,
  DAK_TOTAL_EUR
);
assert.ok(!first.recurring.some((r) => /dak/i.test(r.description)));
const aok = first.recurring.find((r) => r.id === AOK_RECURRING_ID);
assert.ok(aok);
assert.equal(aok?.monthlyAmount, AOK_MONTHLY);
assert.equal(aok?.startDate, AOK_START_DATE);
const august = first.expenses.find((e) => e.date === AOK_START_DATE && e.recurringExpenseId === AOK_RECURRING_ID);
assert.ok(august);
assert.equal(august?.amount, 264.19);

const second = applyHealthInsuranceLedger(first.expenses, first.recurring);
assert.equal(second.changed, false);

const now = new Date(2026, 7, 18); // 18 Aug 2026
const gen = generateExpensesFromRecurring(aok!, first.expenses, now);
assert.equal(gen.expenses.length, 0, 'August already booked — do not duplicate before 17 Sep');

const aokFresh: RecurringExpense = { ...aok!, lastGeneratedDate: undefined };
const genFresh = generateExpensesFromRecurring(aokFresh, [], now);
assert.equal(genFresh.expenses.length, 1);
assert.equal(genFresh.expenses[0]?.date, '2026-08-17');
assert.equal(genFresh.expenses[0]?.amount, 264.19);

const firstOfMonth: RecurringExpense = {
  id: 'rent',
  description: 'Rent',
  monthlyAmount: 100,
  startDate: '2026-06-01',
  category: 'Office',
};
const rentGen = generateExpensesFromRecurring(firstOfMonth, [], now);
assert.equal(rentGen.expenses.map((e) => e.date).join(','), '2026-06-01,2026-07-01,2026-08-01');

console.log('verify-health-insurance-ledger: ok');
