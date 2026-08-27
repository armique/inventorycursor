/**
 * Unified eBay API proxy (single function for Hobby plan limit).
 * Legacy: /api/ebay-order → ?route=order, /api/ebay-orders → ?route=orders
 * Routes: order | orders | listings
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';

function getTokenFromRequest(req) {
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    return body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  }
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
}

function getListingsRequest(req) {
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    return {
      token: body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
      username: body.username || body.sellerUsername,
    };
  }
  return {
    token: (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token,
    username: req.query?.username || req.query?.sellerUsername,
  };
}

function getListingByIdRequest(req) {
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    return {
      token: body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
      username: body.username || body.sellerUsername,
      listingId: body.listingId || body.itemId || body.legacyItemId,
    };
  }
  return {
    token: (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token,
    username: req.query?.username || req.query?.sellerUsername,
    listingId: req.query?.listingId || req.query?.itemId || req.query?.legacyItemId,
  };
}

function pickEnv(name) {
  return process.env[name] || '';
}

function parseListingPrice(raw) {
  if (raw == null || raw === '') return undefined;
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function parseLineQuantity(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.round(raw));
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(1, n) : null;
  }
  if (typeof raw === 'object') {
    const candidate = raw.value ?? raw.quantity ?? raw.amount;
    const n = typeof candidate === 'string' ? parseInt(candidate, 10) : Number(candidate);
    return Number.isFinite(n) ? Math.max(1, Math.round(n)) : null;
  }
  return null;
}

function ebayAppConfig() {
  return {
    clientId: pickEnv('EBAY_CLIENT_ID'),
    clientSecret: pickEnv('EBAY_CLIENT_SECRET'),
    marketplace: pickEnv('EBAY_MARKETPLACE_ID') || 'EBAY_DE',
    ruName: pickEnv('EBAY_RUNAME') || pickEnv('EBAY_RU_NAME'),
    env: (pickEnv('EBAY_ENV') || 'production').toLowerCase(),
  };
}

/**
 * User OAuth scopes for seller order + inventory + payout/fee read, plus inventory WRITE
 * (needed to publish listings — see handleEbayPublishItem below). Changing this list means
 * existing refresh tokens were granted under the old scope set — reconnect eBay in Settings
 * ("Connect eBay") after deploying this change, or publish calls will 401 with an invalid-scope
 * error even though the read routes keep working fine.
 */
const EBAY_USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  // Read-only account policies/locations — lets Settings show a picklist of your real
  // Business Policy names instead of asking you to paste raw policyIds.
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
].join(' ');

function ebayAuthHost(env) {
  return env === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
}

function ebayApiHost(env) {
  return env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

async function ebayUserTokenRequest(body) {
  const { clientId, clientSecret, env } = ebayAppConfig();
  if (!clientId || !clientSecret) {
    throw new Error('eBay app credentials not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch(`${ebayApiHost(env)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error_description || data?.error || `eBay token request failed (${r.status})`);
  }
  return data;
}

function parseBody(req) {
  if (req.method !== 'POST') return {};
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function handleEbayOAuthAuthorizeUrl(req, res) {
  const { clientId, ruName: ruNameRaw, env } = ebayAppConfig();
  const ruName = String(ruNameRaw || '').trim();
  if (!clientId || !ruName) {
    return res.status(503).json({
      configured: false,
      error:
        'eBay Connect not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RUNAME on the server. In eBay Developer → User Tokens, set the RuName Accept URL to https://YOUR_DOMAIN/auth/ebay/callback',
    });
  }
  if (/^https?:\/\//i.test(ruName)) {
    return res.status(400).json({
      configured: false,
      error:
        'EBAY_RUNAME is set to a website URL. It must be the RuName ID from eBay (e.g. Armen_Abelian-ArmenAbe-Delnve-jkupc), not https://armiktech.com/.... Put the https callback only in eBay’s Auth Accepted URL field.',
    });
  }
  const state =
    (typeof req.query?.state === 'string' && req.query.state) ||
    `ebay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  // eBay is picky: encode scopes with %20 (not +) and pass RuName as redirect_uri.
  const qs =
    `client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(ruName)}` +
    `&scope=${encodeURIComponent(EBAY_USER_SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;
  const url = `${ebayAuthHost(env)}/oauth2/authorize?${qs}`;
  return res.status(200).json({ configured: true, url, state, env });
}

async function handleEbayOAuthExchange(req, res) {
  try {
    const body = parseBody(req);
    const codeRaw = body.code || req.query?.code;
    if (!codeRaw) return res.status(400).json({ error: 'Missing authorization code.' });
    const { ruName } = ebayAppConfig();
    if (!ruName) return res.status(503).json({ error: 'Missing EBAY_RUNAME on server.' });
    const code = decodeURIComponent(String(codeRaw)).trim();
    const data = await ebayUserTokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ruName,
      }).toString()
    );
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      refresh_token_expires_in: data.refresh_token_expires_in,
      token_type: data.token_type,
    });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'OAuth exchange failed' });
  }
}

async function handleEbayOAuthRefresh(req, res) {
  try {
    const body = parseBody(req);
    const refreshToken = body.refresh_token || body.refreshToken;
    if (!refreshToken) return res.status(400).json({ error: 'Missing refresh_token.' });
    // Do not pass `scope` here: eBay rejects a refresh whose requested scope string doesn't
    // exactly match what the refresh_token itself was granted with (seen as a bogus
    // "requested scope is invalid" 401, even when the scope IS a subset of what's granted).
    // Omitting it makes eBay reissue an access token with the same scopes as the refresh_token.
    const data = await ebayUserTokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(refreshToken).trim(),
      }).toString()
    );
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      // eBay may omit refresh_token on refresh; keep the old one client-side when missing.
      refresh_token: data.refresh_token || null,
      refresh_token_expires_in: data.refresh_token_expires_in || null,
      token_type: data.token_type,
    });
  } catch (e) {
    return res.status(401).json({ error: e instanceof Error ? e.message : 'OAuth refresh failed' });
  }
}

/**
 * eBay's "Digital Signatures for APIs" (required for the Sell Finances API for EU/UK sellers) —
 * separate from OAuth. A one-time ED25519 keypair was registered via eBay's Key Management API
 * (POST /developer/key_management/v1/signing_key); the private key + public-key-as-JWE live only
 * in env vars (eBay does not store the private key anywhere retrievable). Every signed request adds
 * a Signature/Signature-Input header pair per RFC 9421 (HTTP Message Signatures) covering
 * content-digest (body requests only) + x-ebay-signature-key + @method + @path + @authority.
 * See https://developer.ebay.com/develop/guides/digital-signatures-for-apis
 */
let ebaySigningPrivateKeyCache;
function ebaySigningPrivateKey() {
  if (ebaySigningPrivateKeyCache !== undefined) return ebaySigningPrivateKeyCache;
  const b64 = (process.env.EBAY_SIGNING_PRIVATE_KEY_B64 || '').trim();
  ebaySigningPrivateKeyCache = b64
    ? createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`)
    : null;
  return ebaySigningPrivateKeyCache;
}

/** Adds the eBay digital-signature headers to `headers` in place; no-ops if signing isn't configured. */
function applyEbaySignatureHeaders(headers, { method, path, authority, bodyString }) {
  const jwe = (process.env.EBAY_SIGNING_KEY_JWE || '').trim();
  const privateKey = ebaySigningPrivateKey();
  if (!jwe || !privateKey) return false;

  const created = Math.floor(Date.now() / 1000);
  const hasBody = bodyString != null && bodyString !== '';
  const digest = hasBody ? `sha-256=:${createHash('sha256').update(bodyString, 'utf8').digest('base64')}:` : null;

  const components = hasBody
    ? ['content-digest', 'x-ebay-signature-key', '@method', '@path', '@authority']
    : ['x-ebay-signature-key', '@method', '@path', '@authority'];
  const paramsStr = `(${components.map((c) => `"${c}"`).join(' ')});created=${created}`;

  const valueFor = (c) => {
    if (c === 'content-digest') return digest;
    if (c === 'x-ebay-signature-key') return jwe;
    if (c === '@method') return method.toUpperCase();
    if (c === '@path') return path;
    if (c === '@authority') return authority;
    return '';
  };
  const signatureBase =
    components.map((c) => `"${c}": ${valueFor(c)}`).join('\n') + `\n"@signature-params": ${paramsStr}`;

  const signature = cryptoSign(null, Buffer.from(signatureBase, 'utf8'), privateKey).toString('base64');

  headers['x-ebay-signature-key'] = jwe;
  headers['x-ebay-enforce-signature'] = 'true';
  headers['Signature-Input'] = `sig1=${paramsStr}`;
  headers['Signature'] = `sig1=:${signature}:`;
  if (digest) headers['Content-Digest'] = digest;
  return true;
}

async function getEbayAppToken() {
  const { clientId, clientSecret } = ebayAppConfig();
  if (!clientId || !clientSecret) {
    throw new Error('eBay app credentials not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || `eBay OAuth token request failed (${r.status})`);
  return data.access_token;
}

async function browseGet(appToken, url, marketplace) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${appToken}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.errors?.[0]?.message || `Browse API ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function fetchBrowseItemImages(appToken, itemId, marketplace) {
  const url = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`;
  const data = await browseGet(appToken, url, marketplace);
  const urls = [];
  const push = (u) => {
    if (u && typeof u === 'string' && !urls.includes(u)) urls.push(u);
  };
  push(data.image?.imageUrl);
  for (const img of data.additionalImages || []) push(img?.imageUrl);
  return urls;
}

async function mapPool(items, mapper, concurrency = 5) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await mapper(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return results;
}

async function fetchSellerStoreListings(sellerUsername) {
  const clean = String(sellerUsername || '').trim().replace(/^@/, '');
  if (!clean) throw new Error('Missing eBay seller username.');

  const { marketplace } = ebayAppConfig();
  const appToken = await getEbayAppToken();
  const summaries = [];
  let offset = 0;
  const limit = 200;

  for (;;) {
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', ' ');
    url.searchParams.set('filter', `sellers:{${clean}}`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const data = await browseGet(appToken, url.toString(), marketplace);
    const batch = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
    if (!batch.length) break;
    summaries.push(...batch);
    offset += batch.length;
    const total = data.total ?? summaries.length;
    if (offset >= total || batch.length < limit) break;
    if (summaries.length >= 500) break;
  }

  const listings = await mapPool(summaries, async (item) => {
    const itemId = item.itemId;
    const legacyId = item.legacyItemId || (itemId && String(itemId).split('|')[1]) || itemId;
    let imageUrls = [];
    try {
      imageUrls = await fetchBrowseItemImages(appToken, itemId, marketplace);
    } catch (_) {
      if (item.image?.imageUrl) imageUrls = [item.image.imageUrl];
    }
    if (!imageUrls.length && item.image?.imageUrl) imageUrls = [item.image.imageUrl];
    const price = parseListingPrice(item.price?.value);
    return {
      listingId: String(legacyId || itemId),
      title: item.title || '',
      thumbnail: imageUrls[0] || item.image?.imageUrl,
      imageUrls,
      listingUrl: item.itemWebUrl || (legacyId ? `https://www.ebay.de/itm/${legacyId}` : undefined),
      price,
      currency: item.price?.currency || 'EUR',
      source: 'seller_store',
    };
  });

  return listings.filter((l) => l.title || l.imageUrls.length);
}

async function fetchSellerStoreListingById(sellerUsername, listingId) {
  const cleanSeller = String(sellerUsername || '').trim().replace(/^@/, '');
  const cleanId = String(listingId || '').trim();
  if (!cleanId) throw new Error('Missing eBay listing ID.');
  if (!/^\d{9,14}$/.test(cleanId)) {
    throw new Error('Invalid eBay listing ID format.');
  }

  const { marketplace } = ebayAppConfig();
  const appToken = await getEbayAppToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id');
  url.searchParams.set('legacy_item_id', cleanId);
  const data = await browseGet(appToken, url.toString(), marketplace);
  const seller = String(data?.seller?.username || '').trim().replace(/^@/, '');
  if (cleanSeller && seller && cleanSeller.toLowerCase() !== seller.toLowerCase()) {
    throw new Error(`Listing ${cleanId} belongs to @${seller}, not @${cleanSeller}.`);
  }

  const imageUrls = [];
  const push = (u) => {
    if (u && typeof u === 'string' && !imageUrls.includes(u)) imageUrls.push(u);
  };
  push(data?.image?.imageUrl);
  for (const img of data?.additionalImages || []) push(img?.imageUrl);
  const price = parseListingPrice(data?.price?.value);

  return {
    listingId: cleanId,
    title: data?.title || '',
    thumbnail: imageUrls[0] || data?.image?.imageUrl,
    imageUrls,
    listingUrl: data?.itemWebUrl || `https://www.ebay.de/itm/${cleanId}`,
    price,
    currency: data?.price?.currency || 'EUR',
    source: 'seller_store',
  };
}

function mergeListings(primary, secondary) {
  const seen = new Set(primary.map((l) => l.listingId));
  const merged = [...primary];
  for (const l of secondary) {
    if (!seen.has(l.listingId)) {
      seen.add(l.listingId);
      merged.push(l);
    }
  }
  return merged;
}

async function ebayJsonGet(token, url) {
  const ebayRes = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'de-DE',
    },
  });
  if (ebayRes.status === 401) {
    const err = new Error('eBay token expired or invalid.');
    err.status = 401;
    throw err;
  }
  if (!ebayRes.ok) {
    const errText = await ebayRes.text();
    let message = errText.slice(0, 300);
    try {
      const parsed = JSON.parse(errText);
      const first = parsed?.errors?.[0];
      if (first) {
        message = first.longMessage || first.message || message;
        if (first.errorId === 1100 || ebayRes.status === 403) {
          message += ' — reconnect eBay in Settings (new permissions were added).';
        }
      }
    } catch {
      /* not JSON — keep raw text */
    }
    const err = new Error(message);
    err.status = ebayRes.status;
    throw err;
  }
  return ebayRes.json();
}

/** PUT/POST to the Sell Inventory API. Returns parsed JSON, or null for a 204/empty body. */
async function ebayJsonWrite(token, env, method, path, payload) {
  const ebayRes = await fetch(`${ebayApiHost(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'de-DE',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(payload),
  });
  const text = await ebayRes.text();
  const data = text ? JSON.parse(text) : null;
  if (ebayRes.status === 401) {
    const err = new Error('eBay token expired or invalid — reconnect eBay in Settings.');
    err.status = 401;
    throw err;
  }
  if (!ebayRes.ok) {
    const message =
      data?.errors?.map((e) => e.message || e.longMessage).filter(Boolean).join(' | ') ||
      text.slice(0, 500) ||
      `eBay ${method} ${path} failed (${ebayRes.status})`;
    const err = new Error(message);
    err.status = ebayRes.status;
    err.ebayErrors = data?.errors;
    throw err;
  }
  return data;
}

async function fetchInventoryListings(token) {
  const listings = [];
  const seenSku = new Set();
  let offset = 0;
  const limit = 100;

  for (;;) {
    const url = `https://api.ebay.com/sell/inventory/v1/offer?limit=${limit}&offset=${offset}&marketplace_id=EBAY_DE`;
    const data = await ebayJsonGet(token, url);
    const offers = data.offers || [];
    if (!offers.length) break;

    for (const offer of offers) {
      const published =
        offer.status === 'PUBLISHED' ||
        offer.listing?.listingStatus === 'ACTIVE' ||
        offer.listing?.listingStatus === 'PUBLISHED';
      if (!published) continue;

      const sku = offer.sku;
      if (!sku || seenSku.has(sku)) continue;
      seenSku.add(sku);

      try {
        const inv = await ebayJsonGet(
          token,
          `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`
        );
        const product = inv.product || {};
        const imageUrls = Array.isArray(product.imageUrls) ? product.imageUrls.filter(Boolean) : [];
        const listingId = String(offer.listing?.listingId || offer.offerId || sku);
        const price = parseListingPrice(
          offer.pricingSummary?.price?.value ??
            offer.pricingSummary?.originalPrice?.value ??
            offer.price?.value
        );
        listings.push({
          sku,
          offerId: offer.offerId,
          listingId,
          title: product.title || offer.listingDescription || sku,
          thumbnail: imageUrls[0],
          imageUrls,
          listingUrl: offer.listing?.listingId
            ? `https://www.ebay.de/itm/${offer.listing.listingId}`
            : undefined,
          price,
          currency:
            offer.pricingSummary?.price?.currency ||
            offer.pricingSummary?.originalPrice?.currency ||
            offer.price?.currency ||
            'EUR',
          source: 'inventory',
        });
      } catch {
        // Skip items we cannot read (missing scope, deleted SKU, etc.)
      }
    }

    if (offers.length < limit) break;
    offset += limit;
    if (offset >= 500) break;
  }

  return listings;
}

function parseTradingActiveListings(xml) {
  const listings = [];
  const itemBlocks = xml.match(/<Item>[\s\S]*?<\/Item>/gi) || [];
  for (const block of itemBlocks) {
    const itemId = block.match(/<ItemID>(\d+)<\/ItemID>/i)?.[1];
    const title = block
      .match(/<Title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Title>/i)?.[1]
      ?.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    if (!itemId || !title) continue;

    const imageUrls = [];
    const picBlock = block.match(/<PictureDetails>[\s\S]*?<\/PictureDetails>/i)?.[0];
    if (picBlock) {
      const urlMatches = picBlock.match(/<PictureURL>([\s\S]*?)<\/PictureURL>/gi) || [];
      for (const raw of urlMatches) {
        const u = raw
          .replace(/<\/?PictureURL>/gi, '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .trim();
        if (u && !imageUrls.includes(u)) imageUrls.push(u);
      }
    }

    const viewUrl = block
      .match(/<ViewItemURL>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ViewItemURL>/i)?.[1]
      ?.trim();

    const priceStr =
      block.match(/<CurrentPrice[^>]*>([\d.,]+)<\/CurrentPrice>/i)?.[1] ||
      block.match(/<BuyItNowPrice[^>]*>([\d.,]+)<\/BuyItNowPrice>/i)?.[1] ||
      block.match(/<StartPrice[^>]*>([\d.,]+)<\/StartPrice>/i)?.[1];
    const price = parseListingPrice(priceStr);

    listings.push({
      listingId: itemId,
      title,
      thumbnail: imageUrls[0],
      imageUrls,
      listingUrl: viewUrl || `https://www.ebay.de/itm/${itemId}`,
      price,
      currency: 'EUR',
      source: 'trading',
    });
  }
  return listings;
}

async function fetchTradingActiveListings(token) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

  const text = await postTradingApi('GetMyeBaySelling', xml, token);
  return parseTradingActiveListings(text);
}

function decodeTradingXmlText(raw) {
  return String(raw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function normalizeUserToken(token) {
  return String(token || '').replace(/^Bearer\s+/i, '').trim();
}

/** Trading API (XML) uses X-EBAY-API-IAF-TOKEN — not Authorization: Bearer. */
function tradingApiHeaders(callName, token) {
  return {
    'X-EBAY-API-IAF-TOKEN': normalizeUserToken(token),
    'Content-Type': 'text/xml',
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-SITEID': '77',
    'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
  };
}

function friendlyTradingError(rawMessage) {
  const msg = decodeTradingXmlText(rawMessage);
  if (/Authentifizierungs-Token|authentication token/i.test(msg)) {
    return (
      'eBay rejected the user token for Trading API (buyer purchases). ' +
      'In Settings, paste a fresh User OAuth token from eBay Developer → User Tokens (same token used for sales sync). ' +
      'If it still fails, regenerate the token and save again.'
    );
  }
  return msg;
}

async function postTradingApi(callName, xmlBody, token) {
  const ebayRes = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: tradingApiHeaders(callName, token),
    body: xmlBody,
  });

  const text = await ebayRes.text();

  if (ebayRes.status === 401) {
    const err = new Error('eBay token expired or invalid.');
    err.status = 401;
    throw err;
  }
  if (!ebayRes.ok) {
    const err = new Error(text.slice(0, 300));
    err.status = ebayRes.status;
    throw err;
  }
  if (/<Ack>\s*Failure\s*<\/Ack>/i.test(text)) {
    const msg =
      text.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/i)?.[1] ||
      text.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/i)?.[1] ||
      `${callName} failed`;
    const err = new Error(friendlyTradingError(msg));
    throw err;
  }

  return text;
}

function parseTradingBuyerPurchases(xml) {
  const purchases = [];
  const orderBlocks = xml.match(/<Order>[\s\S]*?<\/Order>/gi) || [];
  for (const orderBlock of orderBlocks) {
    const orderId = orderBlock.match(/<OrderID>([^<]+)<\/OrderID>/i)?.[1]?.trim();
    const createdTime = orderBlock.match(/<CreatedTime>([^<]+)<\/CreatedTime>/i)?.[1];
    const creationDate = createdTime ? createdTime.split('T')[0] : null;
    const txBlocks = orderBlock.match(/<Transaction>[\s\S]*?<\/Transaction>/gi) || [];
    for (const tx of txBlocks) {
      const transactionId = tx.match(/<TransactionID>([^<]+)<\/TransactionID>/i)?.[1]?.trim();
      const itemBlock = tx.match(/<Item>[\s\S]*?<\/Item>/i)?.[0] || tx;
      const itemId = itemBlock.match(/<ItemID>([^<]+)<\/ItemID>/i)?.[1]?.trim();
      const titleRaw = tx.match(/<Title>([\s\S]*?)<\/Title>/i)?.[1];
      const title = decodeTradingXmlText(titleRaw);
      const priceStr = tx.match(/<TransactionPrice[^>]*>([\d.,]+)<\/TransactionPrice>/i)?.[1];
      const unitPrice = parseListingPrice(priceStr);
      const qtyStr = tx.match(/<QuantityPurchased>(\d+)<\/QuantityPurchased>/i)?.[1];
      const quantity = qtyStr ? parseInt(qtyStr, 10) : 1;
      const sellerRaw = tx.match(/<Seller>[\s\S]*?<UserID>([\s\S]*?)<\/UserID>/i)?.[1];
      const sellerUsername = decodeTradingXmlText(sellerRaw);
      const lineKey = `${orderId || 'order'}-${transactionId || itemId || purchases.length}`;
      const totalPaid = unitPrice != null ? Math.round(unitPrice * quantity * 100) / 100 : null;
      purchases.push({
        lineKey,
        orderId: orderId || '',
        transactionId: transactionId || null,
        itemId: itemId || null,
        title,
        sellerUsername: sellerUsername || undefined,
        creationDate,
        quantity,
        unitPrice,
        totalPaid,
      });
    }
  }
  return purchases;
}

async function fetchTradingBuyerPurchases(token, fromDate, toDate) {
  const now = new Date();
  const to = toDate ? new Date(`${toDate}T23:59:59Z`) : now;
  const from = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const all = [];
  let pageNumber = 1;

  for (;;) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <OrderRole>Buyer</OrderRole>
  <OrderStatus>All</OrderStatus>
  <CreateTimeFrom>${from.toISOString()}</CreateTimeFrom>
  <CreateTimeTo>${to.toISOString()}</CreateTimeTo>
  <Pagination>
    <EntriesPerPage>100</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
</GetOrdersRequest>`;

    const text = await postTradingApi('GetOrders', xml, token);

    const batch = parseTradingBuyerPurchases(text);
    all.push(...batch);

    const hasMore = /<HasMoreOrders>\s*true\s*<\/HasMoreOrders>/i.test(text);
    if (!hasMore || batch.length === 0) break;
    pageNumber += 1;
    if (pageNumber > 50) break;
  }

  return all;
}

async function handleEbayPurchases(req, res) {
  let token, fromDate, toDate;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    fromDate = body.fromDate || body.from;
    toDate = body.toDate || body.to;
  } else {
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
    fromDate = req.query?.fromDate || req.query?.from;
    toDate = req.query?.toDate || req.query?.to;
  }
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  try {
    const purchases = await fetchTradingBuyerPurchases(token, fromDate, toDate);
    return res.status(200).json({ purchases });
  } catch (e) {
    if (e.status === 401) return res.status(401).json({ error: e.message });
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay purchases' });
  }
}

async function handleEbayListings(req, res) {
  const { token, username: rawUsername } = getListingsRequest(req);
  const username = String(rawUsername || 'rm4ik').trim().replace(/^@/, '');

  try {
    let listings = [];
    let sellerError = null;

    if (username) {
      try {
        listings = await fetchSellerStoreListings(username);
      } catch (e) {
        sellerError = e instanceof Error ? e.message : String(e);
      }
    }

    if (token) {
      let oauth = [];
      let inventoryError = null;
      try {
        oauth = await fetchInventoryListings(token);
      } catch (e) {
        inventoryError = e instanceof Error ? e.message : String(e);
        if (e.status === 401 && !listings.length) return res.status(401).json({ error: e.message });
      }

      if (!oauth.length) {
        try {
          oauth = await fetchTradingActiveListings(token);
        } catch (e) {
          if (e.status === 401 && !listings.length) return res.status(401).json({ error: e.message });
          if (!listings.length && !oauth.length) {
            return res.status(500).json({
              error:
                sellerError ||
                inventoryError ||
                (e instanceof Error ? e.message : 'Failed to fetch eBay listings.'),
            });
          }
        }
      }

      listings = mergeListings(listings, oauth);
    }

    if (!listings.length && sellerError) {
      return res.status(500).json({ error: sellerError });
    }

    const source = listings.some((l) => l.source === 'seller_store') ? 'seller_store' : 'oauth';
    return res.status(200).json({ listings, source, sellerUsername: username });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay listings' });
  }
}

async function handleEbayListingById(req, res) {
  const { token, username: rawUsername, listingId: rawListingId } = getListingByIdRequest(req);
  const username = String(rawUsername || 'rm4ik').trim().replace(/^@/, '');
  const listingId = String(rawListingId || '').trim();
  if (!listingId) return res.status(400).json({ error: 'Missing listingId.' });

  try {
    // Fast path: seller-store listing by legacy item id (works even if cache matcher missed it).
    const direct = await fetchSellerStoreListingById(username, listingId);
    if (direct?.imageUrls?.length) {
      return res.status(200).json({ listing: direct, source: 'seller_store' });
    }
  } catch (e) {
    // Fallback below tries OAuth inventory/trading merge when available.
    if (!token) {
      return res.status(404).json({
        error: e instanceof Error ? e.message : `Listing ${listingId} was not found.`,
      });
    }
  }

  if (!token) {
    return res.status(404).json({ error: `Listing ${listingId} was not found.` });
  }

  try {
    let merged = [];
    try {
      merged = await fetchInventoryListings(token);
    } catch (e) {
      if (e.status === 401) return res.status(401).json({ error: e.message });
    }
    if (!merged.length) {
      try {
        merged = await fetchTradingActiveListings(token);
      } catch (e) {
        if (e.status === 401) return res.status(401).json({ error: e.message });
      }
    }
    const listing = merged.find((l) => String(l.listingId) === listingId);
    if (!listing) {
      return res.status(404).json({ error: `Listing ${listingId} was not found in active listings.` });
    }
    return res.status(200).json({ listing, source: 'oauth' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay listing by ID' });
  }
}

async function handleEbayOrder(req, res) {
  let orderId, token;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    orderId = body.orderId;
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  } else {
    orderId = req.query?.orderId;
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
  }

  if (!orderId || !token) {
    return res.status(400).json({ error: 'Missing orderId or token.' });
  }

  const cleanOrderId = String(orderId).trim().replace(/\s/g, '');
  try {
    const ebayRes = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(cleanOrderId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (ebayRes.status === 404) return res.status(404).json({ error: 'Order not found.' });
    if (ebayRes.status === 401) return res.status(401).json({ error: 'eBay token expired or invalid.' });
    if (!ebayRes.ok) {
      const errText = await ebayRes.text();
      return res.status(ebayRes.status).json({ error: errText.slice(0, 200) });
    }
    const order = await ebayRes.json();
    const shipTo =
      order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || order.buyer?.buyerRegistrationAddress;
    const addr = shipTo?.contactAddress;
    const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
    const addressLines = [addr?.addressLine1, addr?.addressLine2, [addr?.postalCode, addr?.city].filter(Boolean).join(' '), addr?.stateOrProvince, addr?.countryCode]
      .filter(Boolean)
      .join('\n');
    const firstLine = order.lineItems?.[0];
    const lineTotal = firstLine?.lineItemCost?.value ? parseFloat(firstLine.lineItemCost.value) : null;
    const lineQuantity = parseLineQuantity(firstLine?.quantity);
    return res.status(200).json({
      orderId: order.orderId || cleanOrderId,
      buyer: {
        username: order.buyer?.username || '',
        fullName: fullName.trim() || undefined,
        address: addressLines.trim() || undefined,
        email: shipTo?.email || order.buyer?.buyerRegistrationAddress?.email,
        phone: shipTo?.primaryPhone?.phoneNumber || order.buyer?.buyerRegistrationAddress?.primaryPhone?.phoneNumber,
      },
      sellPrice: lineTotal,
      quantity: lineQuantity,
      creationDate: order.creationDate ? order.creationDate.split('T')[0] : null,
      lineItemTitle: firstLine?.title,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay order' });
  }
}

async function handleEbayOrders(req, res) {
  let token, fromDate, toDate;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    fromDate = body.fromDate || body.from;
    toDate = body.toDate || body.to;
  } else {
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
    fromDate = req.query?.fromDate || req.query?.from;
    toDate = req.query?.toDate || req.query?.to;
  }
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  const now = new Date();
  // A date-only toDate (e.g. "2026-08-27") must mean END of that day, not start of it —
  // `new Date(toDate)` parses to 00:00:00 UTC, which silently excluded every order created
  // later that same day from every routine sync until the next day's run finally covered it.
  // Clamp to `now` too: eBay's Fulfillment API rejects a window that ends in the future.
  const to = toDate ? new Date(Math.min(new Date(`${toDate}T23:59:59.999Z`).getTime(), now.getTime())) : now;
  const from = fromDate ? new Date(fromDate) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const filter = `creationdate:[${from.toISOString()}..${to.toISOString()}]`;
  const allOrders = [];
  let offset = 0;
  const limit = 100;

  try {
    for (;;) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
      const ebayRes = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (ebayRes.status === 401) return res.status(401).json({ error: 'eBay token expired or invalid.' });
      if (!ebayRes.ok) return res.status(ebayRes.status).json({ error: await ebayRes.text() });
      const data = await ebayRes.json();
      const orders = data.orders || [];
      if (orders.length === 0) break;
      for (const order of orders) {
        const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || order.buyer?.buyerRegistrationAddress;
        const addr = shipTo?.contactAddress;
        const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
        const addressLines = [addr?.addressLine1, addr?.addressLine2, [addr?.postalCode, addr?.city].filter(Boolean).join(' '), addr?.stateOrProvince, addr?.countryCode]
          .filter(Boolean)
          .join('\n');
        allOrders.push({
          orderId: order.orderId,
          creationDate: order.creationDate ? order.creationDate.split('T')[0] : null,
          lastModifiedDate: order.lastModifiedDate ? order.lastModifiedDate.split('T')[0] : null,
          orderFulfillmentStatus: order.orderFulfillmentStatus || null,
          orderPaymentStatus: order.orderPaymentStatus || null,
          cancelState: order.cancelStatus?.cancelState || order.cancelStatus?.cancelRequests?.[0]?.cancelReason || null,
          buyer: {
            username: order.buyer?.username || '',
            fullName: fullName.trim() || undefined,
            address: addressLines.trim() || undefined,
            email: shipTo?.email || order.buyer?.buyerRegistrationAddress?.email,
            phone: shipTo?.primaryPhone?.phoneNumber || order.buyer?.buyerRegistrationAddress?.primaryPhone?.phoneNumber,
          },
          lineItems: (order.lineItems || []).map((li) => ({
            sku: li.sku || li.lineItemId || null,
            title: li.title || '',
            lineItemCost: li.lineItemCost?.value ? parseFloat(li.lineItemCost.value) : null,
            listingId: li.legacyItemId || null,
            quantity: parseLineQuantity(li.quantity),
          })),
          orderTotal: order.pricingSummary?.total?.value ? parseFloat(order.pricingSummary.total.value) : null,
        });
      }
      if (orders.length < limit) break;
      offset += limit;
    }
    return res.status(200).json({ orders: allOrders });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay orders' });
  }
}

async function handleEbayFinances(req, res) {
  let token;
  let fromDate;
  let toDate;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    fromDate = body.fromDate || body.from;
    toDate = body.toDate || body.to;
  } else {
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
    fromDate = req.query?.fromDate || req.query?.from;
    toDate = req.query?.toDate || req.query?.to;
  }
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  const now = new Date();
  const to = toDate ? new Date(`${toDate}T23:59:59.999Z`) : now;
  const from = fromDate
    ? new Date(`${fromDate}T00:00:00.000Z`)
    : new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const filter = `transactionDate:[${from.toISOString()}..${to.toISOString()}]`;
  const all = [];
  let offset = 0;
  const limit = 200;

  try {
    for (;;) {
      const path = '/sell/finances/v1/transaction';
      const url = `https://apiz.ebay.com${path}?limit=${limit}&offset=${offset}&filter=${encodeURIComponent(filter)}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE',
      };
      applyEbaySignatureHeaders(headers, { method: 'GET', path, authority: 'apiz.ebay.com' });
      const ebayRes = await fetch(url, { method: 'GET', headers });
      if (ebayRes.status === 401) return res.status(401).json({ error: 'eBay token expired or invalid.' });
      if (ebayRes.status === 403) {
        const errText = await ebayRes.text();
        // A 403 here is usually eBay's "Digital Signatures for APIs" requirement (missing
        // x-ebay-signature-key) — either signing isn't configured (EBAY_SIGNING_* env vars) or the
        // registered key was rejected. Surface the real eBay error instead of guessing at scope.
        return res.status(403).json({
          error: 'eBay Finances API rejected the request (see detail) — likely a Digital Signatures for APIs (request-signing) problem.',
          code: 'forbidden',
          detail: errText.slice(0, 240),
        });
      }
      if (!ebayRes.ok) {
        const errText = await ebayRes.text();
        return res.status(ebayRes.status).json({ error: errText.slice(0, 400) });
      }
      // eBay can return 200 with an empty body for a degenerate (same-day, zero-transaction) range.
      const bodyText = await ebayRes.text();
      const data = bodyText ? JSON.parse(bodyText) : {};
      const txs = data.transactions || [];
      for (const tx of txs) all.push(tx);
      if (txs.length < limit) break;
      offset += limit;
      if (offset > 20000) break;
    }
    return res.status(200).json({ transactions: all, count: all.length });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay finances' });
  }
}

/**
 * Business config that has no per-item equivalent — set once (in eBay Seller Hub for the
 * policies themselves, then either as server env vars OR picked in Settings → eBay Selling,
 * which sends them in the request body). Body values win when present; env vars are the
 * fallback for a single-operator deploy that doesn't want to touch Settings at all.
 */
function ebayPublishConfig(body) {
  const b = body || {};
  return {
    fulfillmentPolicyId: b.fulfillmentPolicyId || pickEnv('EBAY_FULFILLMENT_POLICY_ID'),
    paymentPolicyId: b.paymentPolicyId || pickEnv('EBAY_PAYMENT_POLICY_ID'),
    returnPolicyId: b.returnPolicyId || pickEnv('EBAY_RETURN_POLICY_ID'),
    merchantLocationKey: b.merchantLocationKey || pickEnv('EBAY_MERCHANT_LOCATION_KEY'),
  };
}

/**
 * One-time (idempotent) setup: create the merchant inventory location every offer needs.
 * Safe to call repeatedly — eBay returns 409 if it already exists, which we treat as success.
 * POST { line1, city, postalCode, country? } — your address as it should appear to eBay
 * (not shown to buyers for a "warehouse" location type).
 */
async function handleEbaySetupLocation(req, res) {
  try {
    const token = await ensureUserAccessToken(req);
    const { env } = ebayAppConfig();
    const body = parseBody(req);
    const { merchantLocationKey } = ebayPublishConfig(body);
    if (!merchantLocationKey) {
      return res.status(400).json({ error: 'merchantLocationKey required (env var or request body).' });
    }
    const { line1, city, postalCode, country } = body;
    if (!line1 || !city || !postalCode) {
      return res.status(400).json({ error: 'line1, city, postalCode required.' });
    }
    try {
      await ebayJsonWrite(
        token,
        env,
        'POST',
        `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
        {
          location: { address: { addressLine1: line1, city, postalCode, country: country || 'DE' } },
          locationTypes: ['WAREHOUSE'],
          merchantLocationStatus: 'ENABLED',
        }
      );
    } catch (e) {
      if (e.status !== 409) throw e; // 409 = location already exists — fine.
    }
    return res.status(200).json({ ok: true, merchantLocationKey });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e instanceof Error ? e.message : 'Location setup failed' });
  }
}

function getUserTokenFromRequest(req) {
  if (req.method === 'POST') {
    const body = parseBody(req);
    return body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  }
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
}

async function ensureUserAccessToken(req) {
  const token = getUserTokenFromRequest(req);
  if (!token) {
    const err = new Error('No eBay access token supplied. Connect eBay in Settings first.');
    err.status = 401;
    throw err;
  }
  return token;
}

/**
 * The actual publish flow: inventory_item → offer (create or update) → publish.
 * POST { sku, title, description, imageUrls[], price, currency?, quantity, conditionId,
 *        categoryId, aspects, weightKg, existingOfferId? }
 * Returns { sku, offerId, listingId }.
 */
async function handleEbayPublishItem(req, res) {
  try {
    const token = await ensureUserAccessToken(req);
    const { env, marketplace } = ebayAppConfig();
    const body = parseBody(req);
    const { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey } = ebayPublishConfig(body);
    const missingPolicy = !fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId || !merchantLocationKey;
    if (missingPolicy) {
      return res.status(400).json({
        error:
          'eBay Business Policies not set. Pick them in Settings → eBay Selling, or set ' +
          'EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, ' +
          'EBAY_MERCHANT_LOCATION_KEY on the server (see .env.example).',
      });
    }

    const sku = String(body.sku || '').trim();
    const title = String(body.title || '').trim().slice(0, 80);
    const description = String(body.description || '').trim();
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(Boolean) : [];
    const price = parseListingPrice(body.price);
    const quantity = parseLineQuantity(body.quantity) || 1;
    const conditionId = String(body.conditionId || '3000');
    const categoryId = String(body.categoryId || '').trim();
    const aspects = body.aspects && typeof body.aspects === 'object' ? body.aspects : {};
    const ean = String(body.ean || '').trim();
    const weightKg = Number(body.weightKg);
    const shippingCostEur = parseListingPrice(body.shippingCostEur);
    const existingOfferId = body.existingOfferId ? String(body.existingOfferId) : '';

    if (!sku) return res.status(400).json({ error: 'sku required' });
    if (!title) return res.status(400).json({ error: 'title required' });
    if (!description) return res.status(400).json({ error: 'description required' });
    if (!imageUrls.length) return res.status(400).json({ error: 'At least one https image URL required.' });
    if (imageUrls.some((u) => !/^https:\/\//i.test(u))) {
      return res.status(400).json({ error: 'All imageUrls must be public https:// URLs.' });
    }
    if (price == null) return res.status(400).json({ error: 'Valid price required.' });
    if (!categoryId) return res.status(400).json({ error: 'categoryId required.' });

    // 1) Inventory item — the physical product record. PUT is create-or-replace (idempotent by sku).
    await ebayJsonWrite(token, env, 'PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      availability: { shipToLocationAvailability: { quantity } },
      condition: conditionId,
      product: {
        title,
        description,
        imageUrls,
        aspects,
        ...(ean ? { ean: [ean] } : {}),
      },
      ...(Number.isFinite(weightKg) && weightKg > 0
        ? { packageWeightAndSize: { weight: { value: weightKg, unit: 'KILOGRAM' } } }
        : {}),
    });

    // 2) Offer — the listing itself on top of that inventory item.
    const offerPayload = {
      sku,
      marketplaceId: marketplace || 'EBAY_DE',
      format: 'FIXED_PRICE',
      availableQuantity: quantity,
      categoryId,
      listingDescription: description,
      listingPolicies: {
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
        ...(shippingCostEur != null
          ? {
              shippingCostOverrides: [
                { priority: 1, shippingCost: { value: String(shippingCostEur), currency: 'EUR' } },
              ],
            }
          : {}),
      },
      pricingSummary: { price: { value: String(price), currency: 'EUR' } },
      merchantLocationKey,
    };

    let offerId = existingOfferId;
    if (offerId) {
      await ebayJsonWrite(token, env, 'PUT', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offerPayload);
    } else {
      const created = await ebayJsonWrite(token, env, 'POST', '/sell/inventory/v1/offer', offerPayload);
      offerId = created?.offerId;
      if (!offerId) throw new Error('eBay did not return an offerId.');
    }

    // 3) Publish — goes live, returns the listingId.
    const published = await ebayJsonWrite(
      token,
      env,
      'POST',
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
      {}
    );
    const listingId = published?.listingId;
    if (!listingId) throw new Error('eBay published the offer but returned no listingId.');

    return res.status(200).json({ sku, offerId, listingId });
  } catch (e) {
    return res.status(e.status || 500).json({
      error: e instanceof Error ? e.message : 'Publish failed',
      ebayErrors: e.ebayErrors,
    });
  }
}

/**
 * Lets Settings show a picklist of your real Business Policy names instead of asking you to
 * paste raw policyIds. GET, returns { fulfillmentPolicies, paymentPolicies, returnPolicies }
 * each as [{ id, name }], for the given marketplace (default EBAY_DE).
 */
async function handleEbayAccountPolicies(req, res) {
  try {
    const token = await ensureUserAccessToken(req);
    const { env, marketplace } = ebayAppConfig();
    const mp = (req.query?.marketplaceId && String(req.query.marketplaceId)) || marketplace || 'EBAY_DE';
    const host = ebayApiHost(env);
    const fetchList = async (path, listKey) => {
      const data = await ebayJsonGet(token, `${host}/sell/account/v1/${path}?marketplace_id=${encodeURIComponent(mp)}`);
      return (data[listKey] || []).map((p) => ({ id: p[`${listKey.slice(0, -1)}Id`], name: p.name }));
    };
    const [fulfillmentPolicies, paymentPolicies, returnPolicies] = await Promise.all([
      fetchList('fulfillment_policy', 'fulfillmentPolicies'),
      fetchList('payment_policy', 'paymentPolicies'),
      fetchList('return_policy', 'returnPolicies'),
    ]);
    return res.status(200).json({ fulfillmentPolicies, paymentPolicies, returnPolicies });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e instanceof Error ? e.message : 'Failed to load Business Policies' });
  }
}

/** GET merchant inventory locations already registered on the account. */
async function handleEbayAccountLocations(req, res) {
  try {
    const token = await ensureUserAccessToken(req);
    const { env } = ebayAppConfig();
    const data = await ebayJsonGet(token, `${ebayApiHost(env)}/sell/inventory/v1/location?limit=100`);
    const locations = (data.locations || []).map((l) => ({
      merchantLocationKey: l.merchantLocationKey,
      name: l.name || l.merchantLocationKey,
      address: [l.location?.address?.addressLine1, l.location?.address?.city, l.location?.address?.postalCode]
        .filter(Boolean)
        .join(', '),
    }));
    return res.status(200).json({ locations });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e instanceof Error ? e.message : 'Failed to load locations' });
  }
}

/**
 * Verifies/discovers real eBay category IDs — for confirming the hardcoded best-guess IDs
 * in utils/ebayListingReadiness.ts against your actual account's marketplace category tree.
 * GET ?q=Grafikkarten[&marketplaceId=EBAY_DE] — returns eBay's own suggested categories for
 * that search term, each with its real numeric id, full ancestor path, and whether it's a
 * leaf (only leaf categories can actually be used on a listing).
 */
async function handleEbayTaxonomySuggest(req, res) {
  try {
    const token = await ensureUserAccessToken(req);
    const { env, marketplace } = ebayAppConfig();
    const mp = (req.query?.marketplaceId && String(req.query.marketplaceId)) || marketplace || 'EBAY_DE';
    const q = String(req.query?.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q (search term) required' });
    const host = ebayApiHost(env);

    const treeData = await ebayJsonGet(
      token,
      `${host}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(mp)}`
    );
    const treeId = treeData.categoryTreeId;
    if (!treeId) return res.status(502).json({ error: 'eBay did not return a category tree id.' });

    const suggestData = await ebayJsonGet(
      token,
      `${host}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(q)}`
    );
    const suggestions = (suggestData.categorySuggestions || []).map((s) => ({
      categoryId: s.category?.categoryId,
      categoryName: s.category?.categoryName,
      isLeaf: s.category?.leafCategoryTreeNode !== false,
      ancestors: (s.categoryTreeNodeAncestors || [])
        .map((a) => a.categoryName)
        .reverse()
        .join(' > '),
    }));
    return res.status(200).json({ treeId, marketplaceId: mp, suggestions });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e instanceof Error ? e.message : 'Taxonomy lookup failed' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const route = String(req.query?.route || 'order').trim();
  if (route === 'orders') return handleEbayOrders(req, res);
  if (route === 'finances') return handleEbayFinances(req, res);
  if (route === 'purchases') return handleEbayPurchases(req, res);
  if (route === 'listings') return handleEbayListings(req, res);
  if (route === 'listing_by_id') return handleEbayListingById(req, res);
  if (route === 'oauth_authorize_url') return handleEbayOAuthAuthorizeUrl(req, res);
  if (route === 'oauth_exchange') return handleEbayOAuthExchange(req, res);
  if (route === 'oauth_refresh') return handleEbayOAuthRefresh(req, res);
  if (route === 'setup_location') return handleEbaySetupLocation(req, res);
  if (route === 'publish_item') return handleEbayPublishItem(req, res);
  if (route === 'account_policies') return handleEbayAccountPolicies(req, res);
  if (route === 'account_locations') return handleEbayAccountLocations(req, res);
  if (route === 'taxonomy_suggest') return handleEbayTaxonomySuggest(req, res);
  return handleEbayOrder(req, res);
}
