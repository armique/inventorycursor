import { RecurringExpense, Expense } from '../types';

function toDateOnlyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmd(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function ymd(year: number, month1to12: number, day: number): string {
  const d = Math.min(Math.max(1, day), daysInMonth(year, month1to12));
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Billing day from startDate (e.g. 2026-08-17 → 17). */
export function recurringDayOfMonth(recurring: Pick<RecurringExpense, 'startDate'>): number {
  const parsed = parseYmd(recurring.startDate);
  if (!parsed || parsed.d < 1) return 1;
  return Math.min(31, parsed.d);
}

/**
 * Generate monthly expense entries from a recurring expense.
 *
 * Uses the day-of-month from startDate (not always the 1st).
 * If startDate is in the future, generates nothing until that date arrives.
 */
export function generateExpensesFromRecurring(
  recurring: RecurringExpense,
  existingExpenses: Expense[],
  now: Date = new Date()
): { expenses: Expense[]; lastGeneratedDate: string } {
  const start = parseYmd(recurring.startDate);
  if (!start) {
    return { expenses: [], lastGeneratedDate: recurring.lastGeneratedDate || recurring.startDate };
  }

  const todayStr = toDateOnlyLocal(now);
  const day = recurringDayOfMonth(recurring);

  let year = start.y;
  let month = start.m;
  const lastGen = parseYmd(recurring.lastGeneratedDate || '');
  if (lastGen) {
    year = lastGen.y;
    month = lastGen.m + 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const existingByDate = new Set(
    existingExpenses.filter((e) => e.recurringExpenseId === recurring.id).map((e) => e.date)
  );

  const generated: Expense[] = [];
  let cursorYear = year;
  let cursorMonth = month;
  for (let i = 0; i < 48; i++) {
    const dateStr = ymd(cursorYear, cursorMonth, day);
    if (dateStr > todayStr) break;
    if (dateStr >= recurring.startDate && !existingByDate.has(dateStr)) {
      generated.push({
        id: `exp-recurring-${recurring.id}-${dateStr}`,
        description: recurring.description,
        amount: recurring.monthlyAmount,
        date: dateStr,
        category: recurring.category,
        recurringExpenseId: recurring.id,
      });
    }
    cursorMonth += 1;
    if (cursorMonth > 12) {
      cursorMonth = 1;
      cursorYear += 1;
    }
  }

  const lastGenerated =
    generated.length > 0
      ? generated[generated.length - 1].date
      : recurring.lastGeneratedDate || recurring.startDate;

  return { expenses: generated, lastGeneratedDate: lastGenerated };
}

export function generateAllRecurringExpenses(
  recurringExpenses: RecurringExpense[],
  existingExpenses: Expense[],
  now: Date = new Date()
): Expense[] {
  const allGenerated: Expense[] = [];
  for (const recurring of recurringExpenses) {
    const { expenses } = generateExpensesFromRecurring(recurring, existingExpenses, now);
    allGenerated.push(...expenses);
  }
  return allGenerated;
}
