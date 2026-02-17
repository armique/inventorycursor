
import { InventoryItem, Expense, ItemStatus, TaxMode } from '../types';

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

  // Process Inventory
  items.forEach(item => {
    // PC builds / Bundles are logical containers composed of child items.
    // Their buy/sell prices are aggregates of components, so we skip them here
    // to avoid double-counting COGS and revenue. All economics are attributed
    // to the atomic components instead.
    if (item.isPC || item.isBundle) return;

    const buyYear = item.buyDate ? new Date(item.buyDate).getFullYear() : 0;
    const sellYear = item.sellDate ? new Date(item.sellDate).getFullYear() : 0;

    // Wareneingang (Expense when bought)
    if (buyYear === year) {
      cogs += item.buyPrice || 0;
    }

    // Revenue (Income when sold)
    if ((item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) && sellYear === year) {
      let itemRevenue = item.sellPrice || 0;
      
      // If Regular VAT, we extract the net amount for "Clean Income"
      if (taxMode === 'RegularVAT') {
        const netAmount = itemRevenue / 1.19;
        const vatAmount = itemRevenue - netAmount;
        estimatedVat += vatAmount;
        itemRevenue = netAmount;
      }

      revenue += itemRevenue;
      
      // Fees associated with the sale
      if (item.hasFee && item.feeAmount) {
        fees += item.feeAmount;
      }
    }
  });

  // Process Operating Expenses
  expenses.forEach(exp => {
    const expYear = new Date(exp.date).getFullYear();
    if (expYear === year) {
      operatingExpenses += exp.amount;
    }
  });

  return {
    year,
    revenue,
    cogs,
    expenses: operatingExpenses,
    fees,
    netProfit: revenue - cogs - operatingExpenses - fees,
    vatPayable: estimatedVat
  };
};

export const generateTaxReportCSV = (items: InventoryItem[], expenses: Expense[], year: number): string => {
  const rows: string[] = [];
  const headers = ['Datum', 'Typ', 'Kategorie', 'Beschreibung', 'Betrag (Brutto)', 'Beleg/Ref'];
  rows.push(headers.join(';'));

  // 1. Inventory Purchases (Wareneingang) – only atomic items (no PC/Bundle containers)
  items
    .filter(i => !i.isPC && !i.isBundle && new Date(i.buyDate).getFullYear() === year)
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

  // 2. Inventory Sales (Erlöse) – only atomic sold items (no PC/Bundle containers)
  items
    .filter(
      i =>
        !i.isPC &&
        !i.isBundle &&
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
