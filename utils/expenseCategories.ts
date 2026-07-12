import type { Expense, ExpenseCategory } from '../types';

/** Inventory / stock purchase — COGS hits when filament is used on prints, not at purchase. */
export const FILAMENT_STOCK_EXPENSE_CATEGORY = '3D Filament (stock)' as const;

export type InventoryExpenseCategory = typeof FILAMENT_STOCK_EXPENSE_CATEGORY;

export function isFilamentStockExpense(category: ExpenseCategory | string | undefined): boolean {
  return String(category || '').trim() === FILAMENT_STOCK_EXPENSE_CATEGORY;
}

/** Operating expenses (Betriebsausgaben) — excludes inventory stock purchases. */
export function isOperatingExpense(category: ExpenseCategory | string | undefined): boolean {
  return !isFilamentStockExpense(category);
}

export function filterOperatingExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter((e) => isOperatingExpense(e.category));
}

export function filterInventoryStockExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter((e) => isFilamentStockExpense(e.category));
}

export function sumOperatingExpenseAmount(expenses: Expense[]): number {
  return filterOperatingExpenses(expenses).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function sumInventoryStockExpenseAmount(expenses: Expense[]): number {
  return filterInventoryStockExpenses(expenses).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}
