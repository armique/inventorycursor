/**
 * Replace DAK Gesundheit history with the bank-accurate 10 payments, then
 * start AOK Bayern as a monthly recurring debit on the 17th.
 */
import type { Expense, RecurringExpense } from '../types';

export const AOK_RECURRING_ID = 'recurring-aok-bayern-v1';
export const AOK_START_DATE = '2026-08-17';
export const AOK_MONTHLY = 264.19;
export const DAK_TOTAL_EUR = 2811;
export const HEALTH_INSURANCE_CATEGORY = 'Office';

const DAK_ID_PREFIX = 'exp-dak-gesundheit-';

type DakRow = { date: string; amount: number };

/**
 * 6 × €269.64 from 1 Jul 2025, then 4 × €297.54 ending 28 Jul 2026.
 * Last debit is €300.54 so the ten rows sum to the bank total €2,811.00
 * (€3 remainder vs 6×269.64 + 4×297.54 = €2,808.00).
 */
export const DAK_PAYMENTS: DakRow[] = [
  { date: '2025-07-01', amount: 269.64 },
  { date: '2025-08-01', amount: 269.64 },
  { date: '2025-09-01', amount: 269.64 },
  { date: '2025-10-01', amount: 269.64 },
  { date: '2025-11-01', amount: 269.64 },
  { date: '2025-12-01', amount: 269.64 },
  { date: '2026-04-28', amount: 297.54 },
  { date: '2026-05-28', amount: 297.54 },
  { date: '2026-06-28', amount: 297.54 },
  { date: '2026-07-28', amount: 300.54 },
];

export function dakExpenseId(date: string): string {
  return `${DAK_ID_PREFIX}${date}`;
}

export function aokExpenseId(date: string): string {
  return `exp-recurring-${AOK_RECURRING_ID}-${date}`;
}

export function looksLikeDakGesundheit(text: string | undefined): boolean {
  return /dak/i.test(String(text || ''));
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dakExpenseRow(row: DakRow): Expense {
  return {
    id: dakExpenseId(row.date),
    description: 'DAK Gesundheit',
    amount: round2(row.amount),
    date: row.date,
    category: HEALTH_INSURANCE_CATEGORY,
  };
}

function aokRecurring(): RecurringExpense {
  return {
    id: AOK_RECURRING_ID,
    description: 'AOK Bayern',
    monthlyAmount: AOK_MONTHLY,
    startDate: AOK_START_DATE,
    category: HEALTH_INSURANCE_CATEGORY,
    lastGeneratedDate: AOK_START_DATE,
  };
}

function aokAugustExpense(): Expense {
  return {
    id: aokExpenseId(AOK_START_DATE),
    description: 'AOK Bayern',
    amount: AOK_MONTHLY,
    date: AOK_START_DATE,
    category: HEALTH_INSURANCE_CATEGORY,
    recurringExpenseId: AOK_RECURRING_ID,
  };
}

export function dakPaymentsTotal(): number {
  return round2(DAK_PAYMENTS.reduce((sum, row) => sum + row.amount, 0));
}

export function applyHealthInsuranceLedger(
  expenses: Expense[],
  recurring: RecurringExpense[]
): { expenses: Expense[]; recurring: RecurringExpense[]; changed: boolean } {
  const dakRows = DAK_PAYMENTS.map(dakExpenseRow);
  const dakIds = new Set(dakRows.map((row) => row.id));
  const aokExp = aokAugustExpense();
  const aokRec = aokRecurring();

  const nextExpenses: Expense[] = [];
  const seen = new Set<string>();
  for (const expense of expenses) {
    if (looksLikeDakGesundheit(expense.description) || expense.id.startsWith(DAK_ID_PREFIX)) continue;
    if (expense.id === aokExp.id) continue;
    if (seen.has(expense.id)) continue;
    seen.add(expense.id);
    nextExpenses.push(expense);
  }
  for (const row of dakRows) {
    nextExpenses.push(row);
    seen.add(row.id);
  }
  nextExpenses.push(aokExp);

  const nextRecurring: RecurringExpense[] = [];
  const seenRec = new Set<string>();
  for (const row of recurring) {
    if (looksLikeDakGesundheit(row.description) || row.id === AOK_RECURRING_ID) continue;
    if (seenRec.has(row.id)) continue;
    seenRec.add(row.id);
    nextRecurring.push(row);
  }
  nextRecurring.push(aokRec);

  const expensesChanged =
    nextExpenses.length !== expenses.length ||
    dakRows.some((row) => {
      const old = expenses.find((e) => e.id === row.id);
      return !old || old.amount !== row.amount || old.date !== row.date || old.description !== row.description;
    }) ||
    expenses.some((e) => looksLikeDakGesundheit(e.description) && !dakIds.has(e.id)) ||
    !expenses.some((e) => e.id === aokExp.id && e.amount === AOK_MONTHLY && e.date === AOK_START_DATE);

  const recurringChanged =
    !recurring.some(
      (r) =>
        r.id === AOK_RECURRING_ID &&
        r.monthlyAmount === AOK_MONTHLY &&
        r.startDate === AOK_START_DATE &&
        r.description === 'AOK Bayern'
    ) || recurring.some((r) => looksLikeDakGesundheit(r.description));

  return {
    expenses: nextExpenses,
    recurring: nextRecurring,
    changed: expensesChanged || recurringChanged,
  };
}
