/**
 * Public Kleinanzeigen HTML scrape (seller profile / bestandsliste, or a single ad).
 * Profile pages and ads may block bots — client falls back to paste-import.
 */

const KA_HOSTS = new Set(['kleinanzeigen.de', 'www.kleinanzeigen.de']);
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Cache-Control': 'no-cache',
  Referer: 'https://www.kleinanzeigen.de/',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (host !== 'kleinanzeigen.de') {
    return res.status(400).json({ error: 'Only kleinanzeigen.de URLs are allowed' });
  }

  const kind = classifyKaUrl(parsed);
  if (!kind) {
    return res.status(400).json({
      error: 'Expected a public seller profile / bestandsliste URL or an s-anzeige listing URL',
    });
  }

  try {
    if (kind === 'ad') {
      const listing = await fetchAdListing(parsed.toString());
      if (!listing) {
        return res.status(404).json({ error: 'Could not parse photos from that Kleinanzeigen listing.' });
      }
      const titles = listingToTitleHits([listing]);
      return res.status(200).json({
        listing,
        listings: [listing],
        titles,
        count: 1,
        fetchedAt: new Date().toISOString(),
      });
    }

    const listings = await fetchProfileListings(parsed.toString());
    const titles = listingToTitleHits(listings);
    return res.status(200).json({
      listings,
      titles,
      count: listings.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = Number(err?.status) || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: err?.message || 'Failed to fetch Kleinanzeigen page',
      blocked: status === 403 || status === 429 || err?.blocked === true,
    });
  }
}

function classifyKaUrl(parsed) {
  const pathAndSearch = `${parsed.pathname}${parsed.search}`;
  if (/\/s-anzeige\//i.test(parsed.pathname)) return 'ad';
  if (/s-bestandsliste|s-anzeigen|profil|userId=/i.test(pathAndSearch)) return 'profile';
  if (parsed.pathname.includes('/s-')) return 'profile';
  return null;
}

async function fetchHtml(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
  });
  if (!response.ok) {
    const err = new Error(`Kleinanzeigen returned ${response.status}`);
    err.status = response.status;
    err.blocked = response.status === 403 || response.status === 429;
    throw err;
  }
  return { html: await response.text(), finalUrl: response.url || pageUrl };
}

async function fetchAdListing(adUrl) {
  const { html, finalUrl } = await fetchHtml(adUrl);
  return extractListingFromAd(html, finalUrl || adUrl);
}

async function fetchProfileListings(profileUrl) {
  const { html } = await fetchHtml(profileUrl);
  const byId = new Map();
  mergeListings(byId, extractListingsFromProfile(html, profileUrl));

  const pageCount = Math.min(3, Math.max(1, detectProfilePageCount(html)));
  for (let page = 2; page <= pageCount; page += 1) {
    if (byId.size >= 200) break;
    const nextUrl = withPageNum(profileUrl, page);
    if (nextUrl === profileUrl) break;
    try {
      const next = await fetchHtml(nextUrl);
      const extra = extractListingsFromProfile(next.html, nextUrl);
      if (!extra.length) break;
      const before = byId.size;
      mergeListings(byId, extra);
      if (byId.size === before) break;
    } catch {
      break;
    }
  }

  return [...byId.values()].slice(0, 200);
}

function withPageNum(url, n) {
  try {
    const u = new URL(url);
    u.searchParams.set('pageNum', String(n));
    return u.toString();
  } catch {
    return url;
  }
}

function detectProfilePageCount(html) {
  const nums = [...html.matchAll(/[?&]pageNum=(\d+)/gi)].map((m) => Number(m[1])).filter((n) => n > 1 && n <= 20);
  if (!nums.length) return 1;
  return Math.max(...nums);
}

function mergeListings(byId, listings) {
  for (const listing of listings) {
    if (!listing?.listingId) continue;
    const prev = byId.get(listing.listingId);
    byId.set(listing.listingId, prev ? mergeListing(prev, listing) : listing);
  }
}

function mergeListing(a, b) {
  const imageUrls = uniqueUrls([...(a.imageUrls || []), ...(b.imageUrls || [])]);
  return {
    listingId: a.listingId || b.listingId,
    title: (a.title && a.title.length >= (b.title || '').length ? a.title : b.title) || a.title || b.title || '',
    listingUrl: a.listingUrl || b.listingUrl || '',
    thumbnail: a.thumbnail || b.thumbnail || imageUrls[0],
    imageUrls,
    price: a.price != null ? a.price : b.price,
  };
}

function listingToTitleHits(listings) {
  return listings
    .filter((l) => l?.title)
    .map((l) => ({
      title: l.title,
      url: l.listingUrl || undefined,
      listingId: l.listingId || undefined,
      price: l.price,
    }));
}

function extractListingsFromProfile(html, pageUrl) {
  const byId = new Map();

  const articleRe = /<article\b[^>]*>[\s\S]*?<\/article>/gi;
  let articleMatch;
  while ((articleMatch = articleRe.exec(html)) !== null) {
    const block = articleMatch[0];
    if (!/\baditem\b|data-adid=|s-anzeige/i.test(block)) continue;
    const listingId =
      (block.match(/data-adid="(\d{6,16})"/i) || [])[1] ||
      extractListingIdFromHref((block.match(/data-href="([^"]+)"/i) || [])[1] || '') ||
      extractListingIdFromHref((block.match(/href="([^"]*s-anzeige[^"]*)"/i) || [])[1] || '');
    if (!listingId) continue;
    const href =
      (block.match(/data-href="([^"]+)"/i) || [])[1] ||
      (block.match(/href="([^"]*s-anzeige[^"]*)"/i) || [])[1] ||
      '';
    const title = firstNonEmpty([
      decodeHtml((block.match(/data-testid="ad-title"[^>]*>([^<]+)/i) || [])[1] || ''),
      stripTags((block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ''),
      decodeHtml((block.match(/itemprop="name"[^>]*content="([^"]+)"/i) || [])[1] || ''),
    ]);
    if (!isUsableTitle(title)) continue;
    const imageUrls = extractKaImageUrls(block);
    const listingUrl = absolutizeKaUrl(href, pageUrl) || listingUrlFromId(listingId);
    upsertListing(byId, {
      listingId,
      title,
      listingUrl,
      thumbnail: imageUrls[0],
      imageUrls,
      price: extractNearbyPrice(block) || undefined,
    });
  }

  const jsonListings = extractListingsFromJson(html);
  mergeListings(byId, jsonListings);

  const linkRe = /href="([^"]*\/s-anzeige\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const href = linkMatch[1];
    const listingId = extractListingIdFromHref(href);
    if (!listingId) continue;
    const title = isUsableTitle(stripTags(linkMatch[2])) ? stripTags(linkMatch[2]) : '';
    const window = html.slice(linkMatch.index, linkMatch.index + 800);
    const imageUrls = extractKaImageUrls(window);
    upsertListing(byId, {
      listingId,
      title,
      listingUrl: absolutizeKaUrl(href, pageUrl) || listingUrlFromId(listingId),
      thumbnail: imageUrls[0],
      imageUrls,
      price: extractNearbyPrice(window) || undefined,
    });
  }

  return [...byId.values()].filter((l) => isUsableTitle(l.title));
}

function extractListingFromAd(html, pageUrl) {
  const listingId =
    extractListingIdFromHref(pageUrl) ||
    (html.match(/data-adid="(\d{6,16})"/i) || [])[1] ||
    (html.match(/"adId"\s*:\s*"?(\d{6,16})"?/i) || [])[1] ||
    (html.match(/"id"\s*:\s*"?(\d{6,16})"?/i) || [])[1];
  if (!listingId) return null;

  const title = firstNonEmpty([
    jsonLdProduct(html)?.name,
    decodeHtml((html.match(/property="og:title"[^>]*content="([^"]+)"/i) || [])[1] || ''),
    decodeHtml((html.match(/itemprop="name"[^>]*content="([^"]+)"/i) || [])[1] || ''),
    stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ''),
  ]);
  const imageUrls = uniqueUrls([
    ...extractKaImageUrls(html),
    ...jsonLdImages(html),
  ]);
  if (!imageUrls.length) return null;

  const price =
    jsonLdProduct(html)?.price ||
    parseEuroLoose((html.match(/property="product:price:amount"[^>]*content="([^"]+)"/i) || [])[1] || '') ||
    parseEuroLoose((html.match(/itemprop="price"[^>]*content="([^"]+)"/i) || [])[1] || '') ||
    extractNearbyPrice(html.slice(0, 80000)) ||
    undefined;

  return {
    listingId: String(listingId),
    title: isUsableTitle(title) ? title : `Kleinanzeigen ${listingId}`,
    listingUrl: absolutizeKaUrl(pageUrl, pageUrl) || listingUrlFromId(listingId),
    thumbnail: imageUrls[0],
    imageUrls,
    price: price || undefined,
  };
}

function extractListingsFromJson(html) {
  const out = [];
  const re =
    /"title"\s*:\s*"((?:\\.|[^"\\]){8,160})"[\s\S]{0,500}?"(?:url|adUrl|href|canonicalUrl)"\s*:\s*"(https?:\\?\/\\?\/[^"]*s-anzeige[^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = unescapeJsonString(m[1]);
    const url = unescapeJsonString(m[2]);
    const listingId = extractListingIdFromHref(url);
    if (!listingId || !isUsableTitle(title)) continue;
    const window = html.slice(m.index, m.index + 700);
    const imageUrls = extractKaImageUrls(window);
    const price = parseEuroLoose(
      (window.match(/"(?:priceAmount|amount|price)"\s*:\s*"?(€?\s*)?(\d+(?:[.,]\d{1,2})?)"?/) || [])[2] || '',
    );
    out.push({
      listingId,
      title,
      listingUrl: absolutizeKaUrl(url, 'https://www.kleinanzeigen.de') || listingUrlFromId(listingId),
      thumbnail: imageUrls[0],
      imageUrls,
      price: price || undefined,
    });
    if (out.length >= 200) break;
  }
  return out;
}

function jsonLdProduct(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
        for (const item of graph) {
          if (!item || typeof item !== 'object') continue;
          const type = String(item['@type'] || '');
          if (!/product|offer/i.test(type)) continue;
          const name = typeof item.name === 'string' ? decodeHtml(item.name) : '';
          const offer = item.offers && typeof item.offers === 'object' ? item.offers : null;
          const price = parseEuroLoose(offer?.price || item.price || '');
          return { name, price: price || undefined, image: item.image };
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null;
}

function jsonLdImages(html) {
  const product = jsonLdProduct(html);
  const raw = product?.image;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return uniqueUrls(list.map((entry) => (typeof entry === 'string' ? entry : entry?.url || entry?.contentUrl || '')));
}

function extractKaImageUrls(html) {
  const found = [];
  const patterns = [
    /(?:src|data-src|data-imgsrc|data-imgtoshow|content)="(https?:\/\/img\.(?:ebay-)?kleinanzeigen\.de[^"]+)"/gi,
    /(?:src|data-src)="(\/\/img\.(?:ebay-)?kleinanzeigen\.de[^"]+)"/gi,
    /"(https?:\\?\/\\?\/img\.(?:ebay-)?kleinanzeigen\.de[^"]+)"/gi,
    /https?:\/\/img\.(?:ebay-)?kleinanzeigen\.de\/[^\s"'<>\\]+/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      found.push(m[1] || m[0]);
      if (found.length >= 80) break;
    }
  }
  return uniqueUrls(found);
}

function uniqueUrls(rawUrls) {
  const byId = new Map();
  for (const raw of rawUrls) {
    const url = canonicalizeKaImageUrl(raw);
    if (!url) continue;
    const key = imageIdentity(url);
    const prev = byId.get(key);
    if (!prev || imageRank(url) >= imageRank(prev)) byId.set(key, url);
  }
  return [...byId.values()];
}

function canonicalizeKaImageUrl(raw) {
  let u = unescapeJsonString(String(raw || '')).replace(/&amp;/g, '&').trim();
  if (!u) return '';
  if (u.startsWith('//')) u = `https:${u}`;
  try {
    const parsed = new URL(u);
    if (!/^img\.(ebay-)?kleinanzeigen\.de$/i.test(parsed.hostname)) return '';
  } catch {
    return '';
  }
  if (/placeholder|\/logo|favicon|sprite|badge|avatar|icon[_-]/i.test(u)) return '';
  if (/\.svg(\?|$)/i.test(u)) return '';
  // List thumbs ($_59) → medium gallery size ($_57). Ad pages often already have larger rules.
  u = u.replace(/([?&]rule=)\$_59\./i, '$1$_57.');
  u = u.replace(/\/\$_59\./i, '/$_57.');
  return u;
}

function imageIdentity(url) {
  return url
    .replace(/([?&])rule=\$_\d+\.[A-Za-z]+/i, '')
    .replace(/[?&]$/, '')
    .replace(/\?$/, '');
}

function imageRank(url) {
  const rule = (url.match(/rule=\$_(\d+)/i) || [])[1];
  const n = Number(rule);
  if (!Number.isFinite(n)) return 50;
  // Smaller rule numbers are typically larger images on KA.
  return 100 - n;
}

function extractListingIdFromHref(href) {
  const raw = unescapeJsonString(String(href || ''));
  if (!raw) return '';
  const m =
    raw.match(/s-anzeige\/(?:[^/?#]+\/)?(\d{6,16})(?:-\d+-\d+)?/i) ||
    raw.match(/\/(\d{8,16})-\d{1,4}-\d{1,6}(?:[/?#]|$)/);
  return m?.[1] || '';
}

function listingUrlFromId(id) {
  return `https://www.kleinanzeigen.de/s-anzeige/${id}`;
}

function absolutizeKaUrl(href, baseUrl) {
  const raw = unescapeJsonString(String(href || '')).trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, baseUrl || 'https://www.kleinanzeigen.de');
    if (!KA_HOSTS.has(u.hostname) && u.hostname.replace(/^www\./, '') !== 'kleinanzeigen.de') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function upsertListing(byId, listing) {
  if (!listing?.listingId) return;
  const prev = byId.get(listing.listingId);
  byId.set(listing.listingId, prev ? mergeListing(prev, listing) : listing);
}

function isUsableTitle(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length < 8 || t.length > 180) return false;
  if (/cookie|consent|datenschutz|impressum|anzeige aufgeben/i.test(t)) return false;
  return true;
}

function firstNonEmpty(values) {
  for (const v of values) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (s) return s;
  }
  return '';
}

function stripTags(s) {
  return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractNearbyPrice(chunk) {
  const m =
    chunk.match(/€\s*(\d{1,5}(?:[.,]\d{1,2})?)/) ||
    chunk.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€/) ||
    chunk.match(/"price"\s*:\s*"?(€?\s*)?(\d+(?:[.,]\d{1,2})?)"?/);
  if (!m) return null;
  return parseEuroLoose(m[2] || m[1]);
}

function parseEuroLoose(raw) {
  const s = String(raw || '')
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .trim();
  if (!s) return null;
  let normalized = s;
  if (/^\d+,\d{1,2}$/.test(s) || /\d+\.\d{3},\d{1,2}$/.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function unescapeJsonString(s) {
  return String(s || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
