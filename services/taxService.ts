import { InventoryItem, Expense, ItemStatus, TaxMode } from '../types';
import {
  shouldSkipCompositionChild,
  shouldSkipContainerRow,
  shouldSkipContainerForPurchaseCogs,
} from './financialAggregation';

function itemCountsForTaxExport(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.isDraft) return false;
  if (shouldSkipCompositionChild(item, items)) return false;
  if (shouldSkipContainerRow(item, items)) return false;
  return true;
}

export interface TaxSummary {
  year: number;
  revenue: number;
  cogs: number; // Wareneingang (Cost of Goods Purchased)
  expenses: number; // Operating Expenses
  fees: number;
  netProfit: number;
  vatPayable?: number;
}

// EÜR (Einnahmenüberschussrechnung) Logic:
// 1. Revenue = Money received in the calendar year (sellDate).
// 2. Wareneingang = Money spent on goods in the calendar year (buyDate), regardless of sold status.
// 3. Expenses = Operating expenses paid in the calendar year.
export const calculateTaxSummary = (items: InventoryItem[], expenses: Expense[], year: number, taxMode: TaxMode = 'SmallBusiness'): TaxSummary => {
  let revenue = 0;
  let cogs = 0;
  let fees = 0;
  let operatingExpenses = 0;
  let estimatedVat = 0;

  // Pass 1 — Wareneingang: count each purchase once (children of bundles/PCs, not duplicate container total).
  items.forEach((item) => {
    if (item.isDraft) return;
    if (shouldSkipContainerForPurchaseCogs(item, items)) return;
    const buyYear = item.buyDate ? new Date(item.buyDate).getFullYear() : 0;
    if (buyYear === year) {
      cogs += Number(item.buyPrice) || 0;
    }
  });

  // Pass 2 — Erlöse & Gebühren: same lines as Finanzamt / Dashboard (incl. retro bundle on parent, proportional on children).
  items.forEach((item) => {
    if (item.isDraft) return;
    if (shouldSkipCompositionChild(item, items)) return;
    if (shouldSkipContainerRow(item, items)) return;

    const sellYear = item.sellDate ? new Date(item.sellDate).getFullYear() : 0;
    if (sellYear !== year) return;
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return;

    let itemRevenue = Number(item.sellPrice) || 0;

    if (taxMode === 'RegularVAT') {
      const netAmount = itemRevenue / 1.19;
      const vatAmount = itemRevenue - netAmount;
      estimatedVat += vatAmount;
      itemRevenue = netAmount;
    }

    revenue += itemRevenue;

    if (item.hasFee && item.feeAmount) {
      fees += Number(item.feeAmount) || 0;
    }
  });

  // Process Operating Expenses
  expenses.forEach(exp => {
    const expYear = new Date(exp.date).getFullYear();
    if (expYear === year) {
      operatingExpenses += exp.amount;
    }
  });

  const netProfit =
    Math.round((revenue - cogs - operatingExpenses - fees + Number.EPSILON) * 100) / 100;

  return {
    year,
    revenue: Math.round((revenue + Number.EPSILON) * 100) / 100,
    cogs: Math.round((cogs + Number.EPSILON) * 100) / 100,
    expenses: Math.round((operatingExpenses + Number.EPSILON) * 100) / 100,
    fees: Math.round((fees + Number.EPSILON) * 100) / 100,
    netProfit,
    vatPayable: Math.round((estimatedVat + Number.EPSILON) * 100) / 100,
  };
};

export const generateTaxReportCSV = (items: InventoryItem[], expenses: Expense[], year: number): string => {
  const rows: string[] = [];
  const headers = ['Datum', 'Typ', 'Kategorie', 'Beschreibung', 'Betrag (Brutto)', 'Beleg/Ref'];
  rows.push(headers.join(';'));

  // 1. Inventory Purchases (Wareneingang) – same rows as COGS in calculateTaxSummary
  items
    .filter(
      (i) =>
        !i.isDraft &&
        !shouldSkipContainerForPurchaseCogs(i, items) &&
        i.buyDate &&
        new Date(i.buyDate).getFullYear() === year
    )
    .forEach(i => {
    rows.push([
      i.buyDate,
      'Ausgabe',
      'Wareneingang',
      `Kauf: ${i.name}`,
      `-${i.buyPrice.toFixed(2).replace('.', ',')}`,
      i.id
    ].map(c => `"${c}"`).join(';'));
  });

  // 2. Inventory Sales (Erlöse) – same lines as dashboard / tax revenue pass
  items
    .filter(
      (i) =>
        itemCountsForTaxExport(i, items) &&
        (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
        i.sellDate &&
        new Date(i.sellDate).getFullYear() === year
    )
    .forEach(i => {
    rows.push([
      i.sellDate || '',
      'Einnahme',
      'Umsatzerlöse',
      `Verkauf: ${i.name}`,
      `${(i.sellPrice || 0).toFixed(2).replace('.', ',')}`,
      i.invoiceNumber || i.id
    ].map(c => `"${c}"`).join(';'));

    // Fees for this sale
    if (i.hasFee && i.feeAmount) {
      rows.push([
        i.sellDate || '',
        'Ausgabe',
        'Verkaufsgebühren',
        `Gebühr: ${i.name}`,
        `-${i.feeAmount.toFixed(2).replace('.', ',')}`,
        i.id
      ].map(c => `"${c}"`).join(';'));
    }
  });

  // 3. Operating Expenses
  expenses.filter(e => new Date(e.date).getFullYear() === year).forEach(e => {
    rows.push([
      e.date,
      'Ausgabe',
      e.category,
      e.description,
      `-${e.amount.toFixed(2).replace('.', ',')}`,
      e.id
    ].map(c => `"${c}"`).join(';'));
  });

  return rows.join('\n');
};
