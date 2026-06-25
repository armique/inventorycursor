import type { InventoryItem, Expense, BusinessSettings } from '../types';

/** GDPR-style data export for buyers / personal data in inventory (#146). */
export function buildGdprExportBlob(data: {
  items: InventoryItem[];
  expenses: Expense[];
  businessSettings: BusinessSettings;
}): Blob {
  const buyers = new Map<string, { name: string; sales: { item: string; date?: string; price?: number }[] }>();

  for (const item of data.items) {
    if (!item.customer?.name?.trim()) continue;
    const key = item.customer.name.trim().toLowerCase();
    const entry = buyers.get(key) || { name: item.customer.name.trim(), sales: [] };
    entry.sales.push({
      item: item.name,
      date: item.sellDate,
      price: item.sellPrice,
    });
    buyers.set(key, entry);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    purpose: 'GDPR data export — buyer personal data stored in this app',
    company: data.businessSettings.companyName,
    buyers: Array.from(buyers.values()),
    note: 'Does not include cloud/Firebase data from other users. Delete buyer fields on items to erase personal data.',
  };

  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function downloadGdprExport(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gdpr-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
