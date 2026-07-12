/**
 * Create a linked expense when registering filament stock (inventory, not Betriebsausgabe).
 */
import type { Expense } from '../types';
import { FILAMENT_STOCK_EXPENSE_CATEGORY } from '../utils/expenseCategories';
import { spoolLabel, type FilamentSpool } from './filamentStock';

export function buildFilamentStockExpense(
  spoolInput: {
    type: string;
    color: string;
    brand?: string;
    totalPaid?: number;
    purchasedAt?: string;
    vendor?: string;
    note?: string;
    source?: string;
  },
  amount: number
): Expense {
  const label = [spoolInput.brand, spoolInput.type, spoolInput.color].filter(Boolean).join(' · ');
  const vendor = spoolInput.vendor?.trim();
  const desc = `Filament stock: ${label}${vendor ? ` (${vendor})` : ''}`;
  return {
    id: `exp-fil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: desc,
    amount: Math.round(amount * 100) / 100,
    date: spoolInput.purchasedAt || new Date().toISOString().split('T')[0],
    category: FILAMENT_STOCK_EXPENSE_CATEGORY,
  };
}

export function buildFilamentStockExpenseFromSpool(spool: FilamentSpool): Expense {
  return buildFilamentStockExpense(
    {
      type: spool.type,
      color: spool.color,
      brand: spool.brand,
      totalPaid: spool.totalPaid,
      purchasedAt: spool.purchasedAt,
      vendor: spool.vendor,
      note: spool.note,
      source: spool.source,
    },
    spool.totalPaid ?? spool.pricePerKg * (spool.purchasedGrams / 1000)
  );
}

export function expenseDescriptionForEbayPurchase(title: string, orderId: string): string {
  const short = title.length > 80 ? `${title.slice(0, 77)}…` : title;
  return `eBay purchase: ${short} (#${orderId})`;
}
