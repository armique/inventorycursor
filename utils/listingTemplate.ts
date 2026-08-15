import type { InventoryItem } from '../types';
import { formatEUR } from './formatMoney';

export type ListingTemplate = {
  title: string;
  bullets: string[];
  klein: number;
  ebay: number;
  text: string;
};

function specBullets(item: InventoryItem): string[] {
  const specs = item.specs || {};
  const preferred = [
    'Filament Type',
    'Filament Color',
    'Filament Weight',
    'Print Time',
    'CPU',
    'GPU',
    'RAM',
    'Storage',
    'Motherboard',
    'Socket',
  ];
  const out: string[] = [];
  for (const key of preferred) {
    const val = specs[key];
    if (val == null || String(val).trim() === '') continue;
    out.push(`${key}: ${val}`);
    if (out.length >= 4) return out;
  }
  for (const [key, val] of Object.entries(specs)) {
    if (preferred.includes(key)) continue;
    if (val == null || String(val).trim() === '') continue;
    out.push(`${key}: ${val}`);
    if (out.length >= 4) break;
  }
  if (!out.length && item.comment1) {
    out.push(item.comment1.slice(0, 90));
  }
  return out.slice(0, 4);
}

export function buildListingTemplate(
  item: InventoryItem,
  prices: { klein: number; ebay: number },
): ListingTemplate {
  const title = (item.marketTitle || item.name || '').trim();
  const bullets = specBullets(item);
  const klein = Math.round(prices.klein);
  const ebay = Math.round(prices.ebay);
  const lines = [
    title,
    '',
    ...bullets.map((b) => `• ${b}`),
    '',
    `Kleinanzeigen: €${formatEUR(klein)}`,
    `eBay: €${formatEUR(ebay)}`,
  ];
  return { title, bullets, klein, ebay, text: lines.join('\n').trim() };
}

export async function copyListingTemplate(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
