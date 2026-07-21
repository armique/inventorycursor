import type { EbayMyListing } from '../services/ebayService';

export function normalizeListingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeListingText(text)
    .split(' ')
    .filter((t) => t.length > 1);
}

/** CPU/GPU/RAM/mobo/storage model fragments — e.g. i7-4790k, Ryzen 5 5600, B550, 1TB */
export function extractModelTokens(text: string): string[] {
  const compact = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = new Set<string>();
  const patterns = [
    /\bi[3579][\s-]?\d{3,5}k?\b/gi,
    /\b\d{4,5}k\b/gi,
    /\bryzen\s*[3579]\s*\d{3,4}[a-z]{0,3}\b/gi,
    /\br[3579][\s-]?\d{3,4}[a-z]{0,3}\b/gi,
    /\bthreadripper\s*\d{4}[a-z]?\b/gi,
    /\bxeon\s*[e\-]?\d{4,5}[a-z0-9\-]*\b/gi,
    /\brtx\s?\d{4}(?:\s?(?:ti|super|s))?\b/gi,
    /\bgtx\s?\d{3,4}(?:\s?ti)?\b/gi,
    /\brx\s?\d{4}(?:\s?xt)?\b/gi,
    // Legacy / pro GPUs — Quadro 2000 must not match Quadro RTX 5000
    /\bquadro\s*[a-z]?\s*\d{3,4}[a-z]?\b/gi,
    /\btesla\s*[a-z]?\s*\d{3,4}\b/gi,
    /\bfirepro\s*[a-z]?\s*\d{3,4}\b/gi,
    /\barc\s*a\d{3,4}\b/gi,
    /\bct\d{2}g[a-z0-9]+\b/gi,
    // Chipset / board codes: B450, H81M-K, X570, Z690
    /\b(?:a|b|h|x|z)\d{2,3}[a-z]?(?:-[a-z0-9]+)?\b/gi,
    // Board product lines with chipset
    /\b(?:prime|tuf|rog|strix|pro|gaming|aorus|mag|mpg|tomahawk|steel\s*legend)\s+[a-z0-9\-]+\b/gi,
    // Storage capacity
    /\b\d+\s*(?:gb|tb)\b/gi,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      for (const hit of m) out.add(hit.replace(/\s+/g, '').replace(/-/g, '').toLowerCase());
    }
  }
  if (compact.length >= 5 && compact.length <= 28) out.add(compact);
  return [...out];
}

export function titleContainsModel(titleNorm: string, model: string): boolean {
  const titleCompact = titleNorm.replace(/\s/g, '');
  const modelCompact = model.replace(/\s/g, '').replace(/-/g, '');
  if (modelCompact.length < 4) return false;
  return titleCompact.includes(modelCompact);
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
  const titleNorm = normalizeListingText(listingTitle);
  if (!itemTokens.length || !titleNorm) return 0;

  const itemNorm = normalizeListingText(itemName);
  if (titleNorm.includes(itemNorm) || itemNorm.includes(titleNorm)) {
    return 500 + itemTokens.length * 10;
  }

  const itemCompact = itemNorm.replace(/\s/g, '');
  const titleCompact = titleNorm.replace(/\s/g, '');
  if (itemCompact.length >= 5 && titleCompact.includes(itemCompact)) {
    return 420 + itemCompact.length;
  }
  if (titleCompact.length >= 5 && itemCompact.includes(titleCompact)) {
    return 400 + titleCompact.length;
  }

  for (const model of extractModelTokens(itemName)) {
    if (titleContainsModel(titleNorm, model)) {
      return 380 + Math.min(model.length * 8, 80);
    }
  }

  const allTokens = [...new Set([...itemTokens, ...extractModelTokens(itemName)])];
  let matched = 0;
  for (const token of allTokens) {
    if (titleNorm.includes(token) || titleContainsModel(titleNorm, token)) matched++;
  }
  if (matched === 0) return 0;

  return Math.round(matched * 20 + (matched / allTokens.length) * 80);
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
