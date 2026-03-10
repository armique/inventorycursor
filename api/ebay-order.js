/**
 * Vercel serverless: fetch eBay order details (buyer + shipping address).
 * POST /api/ebay-order with body: { orderId, token }
 * Requires eBay OAuth token with sell.fulfillment or sell.fulfillment.readonly scope.
 */
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
    return res.status(400).json({
      error: 'Missing orderId or token. Send POST body: { orderId, token } or use Authorization: Bearer <token>',
    });
  }

  const cleanOrderId = String(orderId).trim().replace(/\s/g, '');
  if (!cleanOrderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const ebayRes = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(cleanOrderId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (ebayRes.status === 404) {
      return res.status(404).json({ error: 'Order not found. Check the order ID.' });
    }
    if (ebayRes.status === 401) {
      return res.status(401).json({ error: 'eBay token expired or invalid. Re-authenticate.' });
    }
    if (!ebayRes.ok) {
      const errText = await ebayRes.text();
      let errMsg = `eBay API error ${ebayRes.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.errors?.[0]?.message || errJson.message || errMsg;
      } catch (_) {}
      return res.status(ebayRes.status).json({ error: errMsg });
    }

    const order = await ebayRes.json();

    // Extract shipping address (prefer shipTo, fallback to buyerRegistrationAddress)
    const shipTo =
      order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ||
      order.buyer?.buyerRegistrationAddress;
    const addr = shipTo?.contactAddress;
    const fullName =
      shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
    const addressLines = [
      addr?.addressLine1,
      addr?.addressLine2,
      [addr?.postalCode, addr?.city].filter(Boolean).join(' '),
      addr?.stateOrProvince,
      addr?.countryCode,
    ]
      .filter(Boolean)
      .join('\n');

    // First line item total (for single-item orders)
    const firstLine = order.lineItems?.[0];
    const lineTotal = firstLine?.lineItemCost?.value
      ? parseFloat(firstLine.lineItemCost.value)
      : null;
    const creationDate = order.creationDate
      ? order.creationDate.split('T')[0]
      : null;

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
      creationDate,
      lineItemTitle: firstLine?.title,
    });
  } catch (e) {
    console.error('eBay order fetch error:', e);
    return res
      .status(500)
      .json({ error: e.message || 'Failed to fetch eBay order' });
  }
}
