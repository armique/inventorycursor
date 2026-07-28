/**
 * Trade-history CSV export (section 4.2) — clean structured data for handing to an accountant /
 * Steuerberater. No tax calculations or tax advice happen here, only formatting of already-computed
 * numbers (computeItemProfitBeforeOverhead, the same profit figure used everywhere else in the app).
 */
import type { InventoryItem, TaxMode } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import { resolveSalePlatform } from './salePlatform';

const CSV_HEADERS = ['Buy date', 'Sell date', 'Name', 'Category', 'Buy price', 'Sell price', 'Profit', 'Platform'];

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildTradeHistoryCsv(items: InventoryItem[], taxMode: TaxMode): string {
  const rows = items
    .filter((i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0)
    .sort((a, b) => new Date(a.sellDate || 0).getTime() - new Date(b.sellDate || 0).getTime())
    .map((i) => [
      i.buyDate || '',
      i.sellDate || '',
      i.name,
      i.subCategory || i.category || 'Other',
      roundMoney(Number(i.buyPrice) || 0),
      roundMoney(Number(i.sellPrice) || 0),
      roundMoney(computeItemProfitBeforeOverhead(i, taxMode)),
      resolveSalePlatform(i),
    ]);

  const lines = [CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(','));
  return lines.join('\r\n');
}

/** Triggers a browser download — same Blob + object URL pattern used elsewhere in the app for
 * generated files (e.g. services/finanzamtExportService.ts's xlsx export). */
export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
