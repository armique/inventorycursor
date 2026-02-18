import { RecurringExpense, Expense } from '../types';

/**
 * Generate monthly expense entries from a recurring expense.
 * 
 * - If startDate is in the past, generates all months from startDate to current month
 * - If startDate is in the future, generates nothing until that month arrives
 * - Uses lastGeneratedDate to avoid regenerating months that were already created
 * 
 * @param recurring The recurring expense definition
 * @param existingExpenses Existing expenses (to check for duplicates)
 * @returns Array of generated Expense objects and the updated lastGeneratedDate
 */
export function generateExpensesFromRecurring(
  recurring: RecurringExpense,
  existingExpenses: Expense[]
): { expenses: Expense[]; lastGeneratedDate: string } {
  const startDate = new Date(recurring.startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Determine where to start generating from
  let generateFrom = new Date(startDate);
  if (recurring.lastGeneratedDate) {
    const lastGen = new Date(recurring.lastGeneratedDate);
    // Start from the month after lastGeneratedDate
    generateFrom = new Date(lastGen.getFullYear(), lastGen.getMonth() + 1, 1);
  }
  
  // Don't generate if start date is in the future
  if (generateFrom > today) {
    return { expenses: [], lastGeneratedDate: recurring.lastGeneratedDate || recurring.startDate };
  }
  
  // Generate up to current month (inclusive)
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Last day of current month
  
  const generated: Expense[] = [];
  const existingByDate = new Set(
    existingExpenses
      .filter(e => e.recurringExpenseId === recurring.id)
      .map(e => e.date)
  );
  
  let current = new Date(generateFrom);
  current.setDate(1); // First day of month
  
  while (current <= endDate) {
    // Use first day of month for the expense date
    const expenseDate = new Date(current.getFullYear(), current.getMonth(), 1);
    const dateStr = expenseDate.toISOString().split('T')[0];
    
    // Skip if this month's expense already exists
    if (!existingByDate.has(dateStr)) {
      generated.push({
        id: `exp-recurring-${recurring.id}-${dateStr}`,
        description: recurring.description,
        amount: recurring.monthlyAmount,
        date: dateStr,
        category: recurring.category,
        recurringExpenseId: recurring.id,
      });
    }
    
    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }
  
  // Update lastGeneratedDate to the last month we processed
  const lastGenerated = generated.length > 0
    ? generated[generated.length - 1].date
    : (recurring.lastGeneratedDate || recurring.startDate);
  
  return { expenses: generated, lastGeneratedDate: lastGenerated };
}

/**
 * Generate expenses for all recurring expenses.
 * 
 * @param recurringExpenses Array of recurring expense definitions
 * @param existingExpenses Existing expenses (to avoid duplicates)
 * @returns Array of all generated Expense objects
 */
export function generateAllRecurringExpenses(
  recurringExpenses: RecurringExpense[],
  existingExpenses: Expense[]
): Expense[] {
  const allGenerated: Expense[] = [];
  
  for (const recurring of recurringExpenses) {
    const { expenses } = generateExpensesFromRecurring(recurring, existingExpenses);
    allGenerated.push(...expenses);
  }
  
  return allGenerated;
}
