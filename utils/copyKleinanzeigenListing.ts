import type { InventoryItem } from '../types';
import { formatEUR } from './formatMoney';

/** One-click Kleinanzeigen listing text (#14). */
export function buildKleinanzeigenListing(item: InventoryItem): { title: string; body: string; full: string } {
  const title = item.marketTitle?.trim() || item.name;
  const price = item.sellPrice ? `€${formatEUR(item.sellPrice)}` : 'VB';
  const desc = item.marketDescription?.trim() || item.storeDescription?.trim() || item.comment1 || '';
  const body = [
    desc,
    item.category ? `Kategorie: ${item.category}` : '',
    item.specs
      ? Object.entries(item.specs)
          .slice(0, 8)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '',
    '',
    `Preis: ${price}`,
    'Privatverkauf — keine Garantie/Gewährleistung bei Gebrauchtware, sofern nicht anders vereinbart.',
  ]
    .filter(Boolean)
    .join('\n');
  const full = `${title}\n\n${body}`;
  return { title, body, full };
}

export async function copyKleinanzeigenListing(item: InventoryItem): Promise<void> {
  const { full } = buildKleinanzeigenListing(item);
  await navigator.clipboard.writeText(full);
}
