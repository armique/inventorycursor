import type { InventoryItem } from '../types';

/** Flatten an item into a row object for Excel. */
function itemToRow(item: InventoryItem): Record<string, string | number> {
  return {
    Name: item.name,
    Category: item.category || '',
    SubCategory: item.subCategory || '',
    Status: item.status,
    'Buy Price': item.buyPrice ?? '',
    'Sell Price': item.sellPrice ?? '',
    Profit: item.profit ?? '',
    'Buy Date': item.buyDate || '',
    'Sell Date': item.sellDate || '',
    Vendor: item.vendor || '',
    Comment: (item.comment1 || '').slice(0, 200),
    'Customer Name': item.customer?.name || '',
    'Platform Sold': item.platformSold || '',
    'eBay Order ID': item.ebayOrderId || '',
    'eBay Username': item.ebayUsername || '',
    HasFee: item.hasFee ? 'Yes' : '',
    FeeAmount: item.feeAmount ?? '',
    'Payment Type': item.paymentType || '',
  };
}

/**
 * Export inventory items to .xlsx and trigger download.
 * xlsx is loaded on demand so it stays out of the inventory first-paint chunk.
 */
export async function exportInventoryToExcel(items: InventoryItem[]): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = items.map(itemToRow);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
