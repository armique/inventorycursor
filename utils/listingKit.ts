import type { InventoryItem } from '../types';
import { formatEUR } from './formatMoney';
import { getItemUserPhotoUrls } from './imageImport';

export type ListingKitDraft = {
  title: string;
  bullets: string[];
  photoUrls: string[];
  body: string;
};

function shortSpecLine(item: InventoryItem): string | null {
  const name = (item.name || '').trim();
  if (!name) return null;
  const sub = item.subCategory || item.category || '';
  const defect = item.isDefective ? ' (Defekt)' : '';
  return `${sub ? `${sub}: ` : ''}${name}${defect}`;
}

/** Build a marketplace-ready listing draft from a PC or lot container + its parts. */
export function buildListingKitDraft(
  parent: InventoryItem,
  parts: InventoryItem[]
): ListingKitDraft {
  const isLot = parent.isBundle || parent.subCategory === 'Lot Bundle';
  const title =
    parent.marketTitle?.trim() ||
    parent.name?.trim() ||
    (isLot ? `Lot Bundle (${parts.length} Teile)` : 'PC Build');

  const bulletsFromParts = parts
    .map(shortSpecLine)
    .filter((x): x is string => Boolean(x))
    .slice(0, 12);

  const specBullets = parts.flatMap((p) => {
    if (!p.specs) return [] as string[];
    return Object.entries(p.specs)
      .slice(0, 2)
      .map(([k, v]) => `${p.name}: ${k} ${v}`);
  }).slice(0, 6);

  const bullets =
    parent.marketDescription
      ?.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12) ||
    (bulletsFromParts.length ? bulletsFromParts : specBullets);

  const photoUrls =
    getItemUserPhotoUrls(parent).length > 0
      ? getItemUserPhotoUrls(parent)
      : parts.flatMap((p) => getItemUserPhotoUrls(p)).slice(0, 12);

  const total = parts.reduce((s, p) => s + Number(p.buyPrice || 0), 0);
  const body = [
    isLot ? 'Lot / Bundle:' : 'PC Build:',
    ...bullets.map((b) => `• ${b}`),
    '',
    parent.sellPrice
      ? `Preis: €${formatEUR(Number(parent.sellPrice))}`
      : `EK gesamt: €${formatEUR(total)}`,
    'Privatverkauf — keine Garantie/Gewährleistung bei Gebrauchtware, sofern nicht anders vereinbart.',
  ].join('\n');

  return { title: title.slice(0, 80), bullets, photoUrls, body };
}

export function applyListingKitToItem(
  parent: InventoryItem,
  kit: ListingKitDraft
): InventoryItem {
  const description = kit.bullets.map((b) => `• ${b}`).join('\n');
  return {
    ...parent,
    name: kit.title.trim() || parent.name,
    marketTitle: kit.title.trim() || parent.marketTitle,
    marketDescription: description || parent.marketDescription,
    imageUrl: kit.photoUrls[0] || parent.imageUrl,
    imageUrls: kit.photoUrls.length ? kit.photoUrls : parent.imageUrls,
  };
}

export function listingKitToClipboardText(kit: ListingKitDraft): string {
  return `${kit.title}\n\n${kit.body}`;
}
