import type { EbayMyListing } from '../services/ebayService';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1);
}

/** Score how well an eBay listing title matches an inventory item name (higher = better). */
export function scoreListingTitleMatch(
  itemName: string,
  listingTitle: string,
  listingSku?: string,
  itemSku?: string
): number {
  if (itemSku && listingSku && itemSku.trim().toLowerCase() === listingSku.trim().toLowerCase()) {
    return 1000;
  }

  const itemTokens = tokenize(itemName);
  const titleNorm = normalize(listingTitle);
  if (!itemTokens.length || !titleNorm) return 0;

  if (titleNorm.includes(normalize(itemName))) {
    return 500 + itemTokens.length * 10;
  }

  let matched = 0;
  for (const token of itemTokens) {
    if (titleNorm.includes(token)) matched++;
  }
  if (matched === 0) return 0;

  return Math.round(matched * 20 + (matched / itemTokens.length) * 80);
}

export function matchEbayListingsForItem(
  itemName: string,
  listings: EbayMyListing[],
  itemSku?: string,
  minScore = 40
): Array<EbayMyListing & { matchScore: number }> {
  return listings
    .map((listing) => ({
      ...listing,
      matchScore: scoreListingTitleMatch(itemName, listing.title, listing.sku, itemSku),
    }))
    .filter((listing) => listing.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 8);
}
