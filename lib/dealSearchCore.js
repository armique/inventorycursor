/**
 * Shared deal-search logic for /api/deal-search and optional server reuse.
 */

const MODEL_PRIORITY = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-exp'];

export function resolveSearchPlatform(criteria) {
  if (criteria.platform) return criteria.platform;
  return criteria.includeEbay ? 'both' : 'kleinanzeigen';
}

function buildSiteFilter(platform) {
  switch (platform) {
    case 'ebay':
      return 'site:ebay.de';
    case 'both':
      return '(site:ebay.de OR site:kleinanzeigen.de)';
    default:
      return 'site:kleinanzeigen.de';
  }
}

function matchesSearchPlatform(deal, platform) {
  const url = (deal.url || '').toLowerCase();
  if (platform === 'kleinanzeigen') {
    return deal.platform === 'Kleinanzeigen' || url.includes('kleinanzeigen');
  }
  if (platform === 'ebay') {
    return deal.platform === 'eBay' || url.includes('ebay');
  }
  return (
    deal.platform === 'Kleinanzeigen' ||
    deal.platform === 'eBay' ||
    url.includes('kleinanzeigen') ||
    url.includes('ebay')
  );
}

export function parseGermanPrice(priceStr) {
  if (!priceStr) return 0;
  let clean = String(priceStr).replace(/[^0-9,.]/g, '');
  if (clean.includes('.') && !clean.includes(',')) {
    if (clean.indexOf('.') !== clean.length - 3) {
      clean = clean.replace(/\./g, '');
    }
  } else if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(clean) || 0;
}

/**
 * @param {import('@google/genai').GoogleGenAI} ai
 * @param {string} model
 * @param {object} criteria
 * @returns {Promise<object[]>}
 */
export async function runDealSearch(ai, model, criteria) {
  const platform = resolveSearchPlatform(criteria);
  const siteFilter = buildSiteFilter(platform);
  const negativeFilters = '-suche -kaufe -"sucht" -"suche grafikkarte"';
  const googleQuery = `${criteria.query} ${siteFilter} ${negativeFilters} -intitle:Anzeige`;
  const customNote = criteria.customUrl?.trim()
    ? `\nPrefer listings from this page when possible: ${criteria.customUrl.trim()}`
    : '';
  const platformNote =
    platform === 'kleinanzeigen'
      ? 'Only include Kleinanzeigen.de listings.'
      : platform === 'ebay'
        ? 'Only include eBay.de listings.'
        : 'Include listings from both Kleinanzeigen.de and eBay.de.';

  const prompt = `
    Perform a Google Search: ${googleQuery}
    ${platformNote}${customNote}

    Extract sales listings.
    Important: Look for Price in the snippet (e.g. "50 €", "50€", "50 EUR", "VB").

    Return a list of items found.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  let deals = [];
  const text = response.text || '';

  const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\).*?([\d.,]+)\s*(?:€|EUR)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    deals.push({
      title: match[1],
      url: match[2],
      price: `€${match[3]}`,
      platform: match[2].includes('kleinanzeigen') ? 'Kleinanzeigen' : 'eBay',
      dateFound: new Date().toISOString(),
      numericPrice: parseGermanPrice(match[3]),
    });
  }

  if (deals.length === 0) {
    for (const chunk of chunks) {
      if (!chunk.web?.uri || !chunk.web?.title) continue;
      const lowerTitle = chunk.web.title.toLowerCase();
      if (lowerTitle.includes('suche') || lowerTitle.includes('kaufe')) continue;
      const priceMatch = chunk.web.title.match(/([\d.,]+)\s*(?:€|EUR)/i);
      const priceStr = priceMatch ? priceMatch[1] : null;
      const numeric = priceStr ? parseGermanPrice(priceStr) : 0;
      deals.push({
        title: chunk.web.title,
        url: chunk.web.uri,
        price: priceStr ? `€${priceStr}` : 'See Link',
        platform: chunk.web.uri.includes('kleinanzeigen')
          ? 'Kleinanzeigen'
          : chunk.web.uri.includes('ebay')
            ? 'eBay'
            : 'Web',
        dateFound: new Date().toISOString(),
        numericPrice: numeric,
      });
    }
  }

  deals = deals.filter((d) => matchesSearchPlatform(d, platform));

  const maxPrice = Number(criteria.maxPrice) || 0;
  if (maxPrice > 0) {
    deals = deals.filter((d) => !(d.numericPrice > 0 && d.numericPrice > maxPrice));
  }

  return deals
    .sort((a, b) => {
      if (a.numericPrice > 0 && b.numericPrice === 0) return -1;
      if (a.numericPrice === 0 && b.numericPrice > 0) return 1;
      return 0;
    })
    .slice(0, 25);
}

export { MODEL_PRIORITY };
