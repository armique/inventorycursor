/**
 * Unified eBay API proxy (single function for Hobby plan limit).
 * Legacy: /api/ebay-order → ?route=order, /api/ebay-orders → ?route=orders
 * Routes: order | orders | listings
 */

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

function pickEnv(name) {
  return process.env[name] || '';
}

function parseListingPrice(raw) {
  if (raw == null || raw === '') return undefined;
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function ebayAppConfig() {
  return {
    clientId: pickEnv('EBAY_CLIENT_ID'),
    clientSecret: pickEnv('EBAY_CLIENT_SECRET'),
    marketplace: pickEnv('EBAY_MARKETPLACE_ID') || 'EBAY_DE',
  };
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
    const err = new Error(errText.slice(0, 300));
    err.status = ebayRes.status;
    throw err;
  }
  return ebayRes.json();
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

  const ebayRes = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
    },
    body: xml,
  });

  if (ebayRes.status === 401) {
    const err = new Error('eBay token expired or invalid.');
    err.status = 401;
    throw err;
  }
  if (!ebayRes.ok) {
    const errText = await ebayRes.text();
    const err = new Error(errText.slice(0, 300));
    err.status = ebayRes.status;
    throw err;
  }

  const text = await ebayRes.text();
  return parseTradingActiveListings(text);
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
  const to = toDate ? new Date(toDate) : now;
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
          })),
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
  if (route === 'listings') return handleEbayListings(req, res);
  return handleEbayOrder(req, res);
}
