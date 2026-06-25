import type { InventoryItem, Expense, BusinessSettings, ActionHistoryEntry } from '../types';

/** Zip-style export bundle for Steuerberater (#70) — JSON pack (browser download). */
export async function buildSteuerberaterBundle(data: {
  items: InventoryItem[];
  expenses: Expense[];
  businessSettings: BusinessSettings;
  actionHistory: ActionHistoryEntry[];
  rangeLabel: string;
}): Promise<Blob> {
  const manifest = {
    exportedAt: new Date().toISOString(),
    rangeLabel: data.rangeLabel,
    company: data.businessSettings.companyName,
    taxMode: data.businessSettings.taxMode,
    counts: {
      items: data.items.length,
      expenses: data.expenses.length,
      sold: data.items.filter((i) => i.status === 'Sold').length,
    },
  };
  const payload = JSON.stringify(
    {
      manifest,
      businessSettings: data.businessSettings,
      items: data.items,
      expenses: data.expenses,
      actionHistory: data.actionHistory.slice(0, 500),
    },
    null,
    2
  );
  return new Blob([payload], { type: 'application/json' });
}

export function downloadSteuerberaterBundle(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
