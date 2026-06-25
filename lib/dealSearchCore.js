/**
 * Shared deal-search logic for /api/gemini?route=deal-search
 */

const MODEL_PRIORITY = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
];

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

function buildDealSearchPrompt(criteria) {
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

  return `
    Perform a Google Search: ${googleQuery}
    ${platformNote}${customNote}

    Extract sales listings.
    Important: Look for Price in the snippet (e.g. "50 €", "50€", "50 EUR", "VB").

    Return a list of items found.
  `.trim();
}

function parseDealsFromGeminiPayload(criteria, text, chunks) {
  const platform = resolveSearchPlatform(criteria);
  let deals = [];
  const body = text || '';

  const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\).*?([\d.,]+)\s*(?:€|EUR)/gi;
  let match;
  while ((match = regex.exec(body)) !== null) {
    deals.push({
      title: match[1],
      url: match[2],
      price: `€${match[3]}`,
      platform: match[2].includes('kleinanzeigen') ? 'Kleinanzeigen' : 'eBay',
      dateFound: new Date().toISOString(),
      numericPrice: parseGermanPrice(match[3]),
    });
  }

  if (deals.length === 0 && Array.isArray(chunks)) {
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

function isRetryableGeminiError(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('429') ||
    m.includes('exhausted') ||
    m.includes('quota') ||
    m.includes('404') ||
    m.includes('not found') ||
    m.includes('503') ||
    m.includes('unavailable')
  );
}

/**
 * @param {import('@google/genai').GoogleGenAI} ai
 */
export async function runDealSearch(ai, model, criteria) {
  const prompt = buildDealSearchPrompt(criteria);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const text = response.text || '';
  return parseDealsFromGeminiPayload(criteria, text, chunks);
}

/**
 * Direct REST call — often more reliable on Vercel than the SDK.
 */
export async function runDealSearchRest(apiKey, model, criteria) {
  const prompt = buildDealSearchPrompt(criteria);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const toolVariants = [{ google_search: {} }, { googleSearch: {} }];
  let lastErr = null;

  for (const tools of toolVariants) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [tools],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg =
          data?.error?.message || data?.error?.status || `HTTP ${res.status}`;
        lastErr = new Error(errMsg);
        if (isRetryableGeminiError(errMsg)) continue;
        throw lastErr;
      }

      const candidate = data.candidates?.[0];
      const text =
        candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
      const chunks = candidate?.groundingMetadata?.groundingChunks || [];
      return parseDealsFromGeminiPayload(criteria, text, chunks);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRetryableGeminiError(msg)) throw e;
    }
  }

  if (lastErr) throw lastErr;
  return [];
}

/** Direct marketplace search pages when AI grounding returns nothing. */
export function buildMarketplaceSearchLinks(criteria, refinedQuery) {
  const platform = resolveSearchPlatform(criteria);
  const q = String(refinedQuery || criteria.query || '').trim();
  const maxPrice = Number(criteria.maxPrice) || 0;
  const deals = [];
  const slug = q.replace(/\s+/g, '-');

  if (platform === 'kleinanzeigen' || platform === 'both') {
    const custom = criteria.customUrl?.trim();
    let url =
      custom ||
      `https://www.kleinanzeigen.de/s-${encodeURIComponent(slug)}/k0`;
    if (!custom && maxPrice > 0) {
      url += `?preis=:${maxPrice}`;
    }
    deals.push({
      title: `Open Kleinanzeigen search: ${q}${maxPrice > 0 ? ` (≤ €${maxPrice})` : ''}`,
      url,
      price: maxPrice > 0 ? `≤ €${maxPrice}` : 'Browse listings',
      platform: 'Kleinanzeigen',
      dateFound: new Date().toISOString(),
      numericPrice: 0,
      isSearchLink: true,
    });
  }

  if (platform === 'ebay' || platform === 'both') {
    let url = `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=16`;
    if (maxPrice > 0) url += `&_udhi=${maxPrice}`;
    deals.push({
      title: `Open eBay search: ${q}${maxPrice > 0 ? ` (≤ €${maxPrice})` : ''}`,
      url,
      price: maxPrice > 0 ? `≤ €${maxPrice}` : 'Browse listings',
      platform: 'eBay',
      dateFound: new Date().toISOString(),
      numericPrice: 0,
      isSearchLink: true,
    });
  }

  return deals;
}

/** Optional: Groq refines the search phrase before building marketplace links. */
export async function refineQueryWithGroq(apiKey, query) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: `Return ONLY a short German marketplace search phrase (max 6 words) for used hardware: "${query}". No quotes, no explanation.`,
        },
      ],
      max_tokens: 32,
      temperature: 0.2,
    }),
  });

  if (!res.ok) return query;
  const data = await res.json().catch(() => ({}));
  const refined = data?.choices?.[0]?.message?.content?.trim();
  return refined && refined.length < 80 ? refined : query;
}

export { MODEL_PRIORITY, isRetryableGeminiError };
