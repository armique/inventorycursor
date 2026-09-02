/**
 * Server-side eBay order sync — Fulfillment + Finances APIs → Supabase `ebay_orders`
 * and rebuilt `api-sync` Abrechnung report in `ebay_tx_reports`.
 *
 * Used by the Vercel Cron handler (lib/apiHandlers/ebayOrderSyncHandler.js) so orders
 * with fee breakdowns and line-item titles stay current even when the panel app is closed.
 *
 * OAuth refresh tokens are read from `user_profiles.ebay_oauth_refresh_token` (same
 * tokens the browser mirrors via marketplaceCredentialsSync).
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';

const API_SYNC_REPORT_ID = 'api-sync';
const DEFAULT_LOOKBACK_DAYS = 30;

function pickEnv(name) {
  return process.env[name] || '';
}

function roundMoney(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ebaySafeNowMs() {
  return Date.now() - 120_000;
}

function parseEbayDateOnlyUtc(d) {
  return new Date(`${String(d).slice(0, 10)}T00:00:00.000Z`);
}

function buildEbayCreationDateFilter(fromDate, toDate, defaultLookbackDays = 7) {
  const ebayNow = ebaySafeNowMs();
  const to = toDate
    ? new Date(Math.min(parseEbayDateOnlyUtc(toDate).getTime() + 86400000 - 1, ebayNow))
    : new Date(ebayNow);
  let from = fromDate
    ? parseEbayDateOnlyUtc(fromDate)
    : new Date(to.getTime() - defaultLookbackDays * 86400000);
  if (from.getTime() > to.getTime()) {
    from = new Date(to.getTime() - defaultLookbackDays * 86400000);
  }
  return `creationdate:[${from.toISOString()}..${to.toISOString()}]`;
}

function buildEbayTransactionDateFilter(fromDate, toDate, defaultLookbackDays = 14) {
  const ebayNow = ebaySafeNowMs();
  const to = toDate
    ? new Date(Math.min(parseEbayDateOnlyUtc(toDate).getTime() + 86400000 - 1, ebayNow))
    : new Date(ebayNow);
  let from = fromDate
    ? parseEbayDateOnlyUtc(fromDate)
    : new Date(to.getTime() - defaultLookbackDays * 86400000);
  if (from.getTime() > to.getTime()) {
    from = new Date(to.getTime() - defaultLookbackDays * 86400000);
  }
  return `transactionDate:[${from.toISOString()}..${to.toISOString()}]`;
}

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}

function ebayAppConfig() {
  return {
    clientId: pickEnv('EBAY_CLIENT_ID'),
    clientSecret: pickEnv('EBAY_CLIENT_SECRET'),
    env: (pickEnv('EBAY_ENV') || 'production').toLowerCase(),
  };
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
    throw new Error(data.error_description || data.error || `OAuth token request failed (${r.status})`);
  }
  return data;
}

export async function refreshEbayAccessToken(refreshToken) {
  const data = await ebayUserTokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken).trim(),
    }).toString()
  );
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token || refreshToken,
    refreshExpiresIn: data.refresh_token_expires_in || null,
  };
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

let ebaySigningPrivateKeyCache;
function ebaySigningPrivateKey() {
  if (ebaySigningPrivateKeyCache !== undefined) return ebaySigningPrivateKeyCache;
  const b64 = (pickEnv('EBAY_SIGNING_PRIVATE_KEY_B64') || '').trim();
  ebaySigningPrivateKeyCache = b64
    ? createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`)
    : null;
  return ebaySigningPrivateKeyCache;
}

function applyEbaySignatureHeaders(headers, { method, path, authority, bodyString }) {
  const jwe = (pickEnv('EBAY_SIGNING_KEY_JWE') || '').trim();
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

/** Fulfillment API — buyer, address, line items, gross total. */
export async function fetchEbayFulfillmentOrders(token, fromDate, toDate) {
  const filter = buildEbayCreationDateFilter(fromDate, toDate, 7);
  const allOrders = [];
  let offset = 0;
  const limit = 100;

  for (;;) {
    const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
    const ebayRes = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (ebayRes.status === 401) throw new Error('eBay token expired or invalid.');
    if (!ebayRes.ok) throw new Error(await ebayRes.text());
    const data = await ebayRes.json();
    const orders = data.orders || [];
    if (!orders.length) break;

    for (const order of orders) {
      const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || order.buyer?.buyerRegistrationAddress;
      const addr = shipTo?.contactAddress;
      const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
      const addressLines = [
        addr?.addressLine1,
        addr?.addressLine2,
        [addr?.postalCode, addr?.city].filter(Boolean).join(' '),
        addr?.stateOrProvince,
        addr?.countryCode,
      ]
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

  return allOrders;
}

/** Sell Finances API — fee breakdown per order (requires digital signing for EU sellers). */
export async function fetchEbayFinanceTransactions(token, fromDate, toDate) {
  const filter = buildEbayTransactionDateFilter(fromDate, toDate, 14);
  const all = [];
  let offset = 0;
  const limit = 200;

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
    if (ebayRes.status === 401) throw new Error('eBay token expired or invalid.');
    if (ebayRes.status === 403) {
      const errText = await ebayRes.text();
      const err = new Error(
        'eBay Finances API rejected the request — likely missing EBAY_SIGNING_* env vars.'
      );
      err.code = 'finances_forbidden';
      err.detail = errText.slice(0, 240);
      throw err;
    }
    if (!ebayRes.ok) throw new Error(await ebayRes.text());
    const bodyText = await ebayRes.text();
    const data = bodyText ? JSON.parse(bodyText) : {};
    const txs = data.transactions || [];
    for (const tx of txs) all.push(tx);
    if (txs.length < limit) break;
    offset += limit;
    if (offset > 20000) break;
  }

  return all;
}

export function fulfillmentSummaryToRecord(o, importedAt = new Date().toISOString()) {
  const lineTotal = (o.lineItems || []).reduce((sum, li) => sum + (li.lineItemCost || 0), 0);
  return {
    orderId: o.orderId,
    creationDate: o.creationDate,
    buyer: { ...(o.buyer || {}) },
    lineItems: (o.lineItems || []).map((li) => ({
      sku: li.sku,
      title: li.title,
      lineItemCost: li.lineItemCost,
      listingId: li.listingId ?? null,
      quantity: li.quantity ?? null,
    })),
    grossTotal: o.orderTotal ?? (lineTotal || null),
    orderFulfillmentStatus: o.orderFulfillmentStatus ?? null,
    orderPaymentStatus: o.orderPaymentStatus ?? null,
    cancelState: o.cancelState ?? null,
    lastModifiedDate: o.lastModifiedDate ?? null,
    sources: ['api'],
    importedAt,
  };
}

function moneyOf(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? roundMoney(raw) : null;
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? roundMoney(n) : null;
  }
  if (typeof raw === 'object' && raw !== null && 'value' in raw) return moneyOf(raw.value);
  return null;
}

function financeOrderId(tx) {
  const direct = String(tx.orderId || '').trim();
  if (direct) return direct;
  for (const ref of tx.references || []) {
    if (String(ref.referenceType || '').toUpperCase() === 'ORDER_ID' && ref.referenceId) {
      return String(ref.referenceId).trim();
    }
  }
  return null;
}

function financeFeeBucketLabel(feeType, memo) {
  const t = `${feeType || ''} ${memo || ''}`;
  if (/SHIPPING_LABEL|versandetikett|shipping\s*label|versandlabel/i.test(t)) return 'Versandetikett';
  if (/AD_FEE|PROMOTED|MARKETING|ANZEIGE|ADS|WERBUNG/i.test(t)) return 'Anzeigengebühr Basis';
  if (/FINAL_VALUE|PAYMENT_PROCESSING|REGULATORY|TRANSAKTION|PROVISION|VERKAUFSGEB/i.test(t)) {
    return 'Transaktionsgebühren';
  }
  return (memo || '').trim() || feeType || 'Weitere Gebühren';
}

function financialEventId(parts) {
  const desc = (parts.description || '').slice(0, 40).toLowerCase();
  return `${parts.orderId}::${parts.date || 'na'}::${parts.amount.toFixed(2)}::${parts.kind}::${desc}`;
}

function financeEvent(orderId, date, kind, amount, transactionType, description, importedAt) {
  return {
    id: financialEventId({ orderId, date, amount, kind, description: `${transactionType}:${description}` }),
    date,
    kind,
    amount,
    transactionType,
    description,
    source: 'api',
    importedAt,
  };
}

function txKind(rawType) {
  const t = rawType.toUpperCase();
  if (t.includes('REFUND') || t.includes('RETURN') || t.includes('DISPUTE')) return 'refund';
  if (t.includes('CANCEL')) return 'cancellation';
  if (t === 'SALE' || t === 'CREDIT') return 'sale';
  if (t.includes('SHIPPING_LABEL') || t.includes('NON_SALE_CHARGE') || t.includes('FEE') || t.includes('ADJUSTMENT')) {
    return 'fee';
  }
  return 'unknown';
}

function skipFinanceType(rawType) {
  const t = rawType.toUpperCase();
  return t === 'TRANSFER' || t === 'WITHDRAWAL' || t === 'PAYOUT' || t === 'LOAN_REPAYMENT' || t === 'PURCHASE';
}

export function financeTransactionsToOrderRecords(transactions, importedAt = new Date().toISOString()) {
  const byId = new Map();

  const ensure = (orderId) => {
    let row = byId.get(orderId);
    if (!row) {
      row = { dates: [], username: undefined, events: [], gross: null };
      byId.set(orderId, row);
    }
    return row;
  };

  for (const tx of transactions) {
    const orderId = financeOrderId(tx);
    if (!orderId) continue;
    const type = String(tx.transactionType || '').trim();
    if (skipFinanceType(type)) continue;

    const row = ensure(orderId);
    const date = tx.transactionDate ? tx.transactionDate.slice(0, 10) : null;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) row.dates.push(date);
    if (!row.username && tx.buyer?.username) row.username = tx.buyer.username;

    const kind = txKind(type);
    const isDebit = String(tx.bookingEntry || '').toUpperCase() === 'DEBIT';
    const marketplaceFees = (tx.orderLineItems || []).flatMap((li) => li.marketplaceFees || []);

    if (kind === 'sale' && !isDebit) {
      const basis = moneyOf(tx.totalFeeBasisAmount);
      const totalFee = moneyOf(tx.totalFeeAmount);
      const netAmt = moneyOf(tx.amount);
      const gross =
        basis != null && basis > 0
          ? basis
          : netAmt != null && totalFee != null
            ? roundMoney(Math.abs(netAmt) + Math.abs(totalFee))
            : netAmt != null
              ? Math.abs(netAmt)
              : null;
      if (gross != null && gross > 0) {
        row.gross = row.gross == null ? gross : Math.max(row.gross, gross);
        row.events.push(financeEvent(orderId, date, 'sale', roundMoney(gross), 'Bestellung', 'eBay Finances SALE', importedAt));
      }
      if (marketplaceFees.length) {
        for (const fee of marketplaceFees) {
          const amt = moneyOf(fee.amount);
          if (amt == null || Math.abs(amt) < 0.01) continue;
          const label = financeFeeBucketLabel(fee.feeType, fee.feeMemo);
          row.events.push(
            financeEvent(orderId, date, 'fee', -Math.abs(amt), label, fee.feeMemo || fee.feeType || label, importedAt)
          );
        }
      } else if (totalFee != null && Math.abs(totalFee) >= 0.01) {
        row.events.push(
          financeEvent(orderId, date, 'fee', -Math.abs(totalFee), 'Transaktionsgebühren', 'eBay Finances totalFeeAmount', importedAt)
        );
      }
      continue;
    }

    const rawAmt = moneyOf(tx.amount);
    if (rawAmt == null) continue;
    const mag = Math.abs(rawAmt);
    if (mag < 0.001) continue;
    const signed = isDebit ? -mag : mag;

    if (kind === 'refund' || kind === 'cancellation') {
      const amt = signed > 0 ? -Math.abs(signed) : signed;
      row.events.push(financeEvent(orderId, date, kind, amt, type || 'REFUND', tx.transactionMemo || type || 'eBay refund', importedAt));
      continue;
    }

    const label = financeFeeBucketLabel(tx.feeType || type, tx.transactionMemo);
    const feeAmt = signed > 0 ? -Math.abs(signed) : signed;
    row.events.push(financeEvent(orderId, date, 'fee', feeAmt, label, tx.transactionMemo || tx.feeType || type || label, importedAt));
  }

  const out = [];
  for (const [orderId, row] of byId) {
    if (!row.events.length && row.gross == null) continue;
    const feeTotal = roundMoney(
      row.events.filter((e) => e.kind === 'fee' && e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0)
    );
    const net = roundMoney(row.events.reduce((s, e) => s + e.amount, 0));
    const dates = [...row.dates].sort();
    out.push({
      orderId,
      creationDate: dates[0] || null,
      buyer: { username: row.username },
      lineItems: [],
      grossTotal: row.gross,
      netTotal: net,
      feeTotal: feeTotal > 0 ? feeTotal : null,
      financialEvents: row.events,
      sources: ['api'],
      importedAt,
    });
  }
  return out;
}

function mergeFinancialEvents(existing, incoming) {
  const byId = new Map();
  for (const e of existing || []) byId.set(e.id, e);
  for (const e of incoming || []) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function sumFinancialEventNet(events) {
  if (!events?.length) return null;
  const total = events.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0);
  return roundMoney(total);
}

function mergeLineItems(a, b) {
  const out = [...(a || [])];
  for (const li of b || []) {
    const key = (li.sku || li.title || '').trim().toLowerCase();
    const idx = out.findIndex((x) => (x.sku || x.title || '').trim().toLowerCase() === key);
    if (idx === -1) {
      out.push(li);
    } else {
      const existing = out[idx];
      out[idx] = {
        sku: existing.sku || li.sku,
        title: existing.title || li.title,
        lineItemCost: existing.lineItemCost ?? li.lineItemCost,
        listingId: existing.listingId || li.listingId,
        quantity: existing.quantity ?? li.quantity,
      };
    }
  }
  return out;
}

export function mergeOrderRecords(existing, incoming) {
  const financialEvents = mergeFinancialEvents(existing.financialEvents, incoming.financialEvents || []);
  const eventNet = sumFinancialEventNet(financialEvents);

  const mergedNet =
    eventNet != null
      ? eventNet
      : incoming.netTotal != null && existing.netTotal != null
        ? incoming.importedAt >= existing.importedAt
          ? incoming.netTotal
          : existing.netTotal
        : existing.netTotal ?? incoming.netTotal;

  const mergedFee =
    incoming.feeTotal != null && existing.feeTotal != null
      ? incoming.importedAt >= existing.importedAt
        ? incoming.feeTotal
        : existing.feeTotal
      : existing.feeTotal ?? incoming.feeTotal;

  return {
    orderId: existing.orderId,
    creationDate: existing.creationDate || incoming.creationDate,
    buyer: {
      username: existing.buyer?.username || incoming.buyer?.username,
      fullName: existing.buyer?.fullName || incoming.buyer?.fullName,
      address: existing.buyer?.address || incoming.buyer?.address,
      email: existing.buyer?.email || incoming.buyer?.email,
      phone: existing.buyer?.phone || incoming.buyer?.phone,
    },
    lineItems: mergeLineItems(existing.lineItems, incoming.lineItems),
    grossTotal: existing.grossTotal ?? incoming.grossTotal,
    netTotal: mergedNet,
    feeTotal: mergedFee,
    shippingCost: existing.shippingCost ?? incoming.shippingCost,
    taxTotal: existing.taxTotal ?? incoming.taxTotal,
    financialEvents: financialEvents.length ? financialEvents : undefined,
    orderFulfillmentStatus: incoming.orderFulfillmentStatus || existing.orderFulfillmentStatus,
    orderPaymentStatus: incoming.orderPaymentStatus || existing.orderPaymentStatus,
    cancelState: incoming.cancelState || existing.cancelState,
    lastModifiedDate: incoming.lastModifiedDate || existing.lastModifiedDate,
    sources: Array.from(new Set([...(existing.sources || []), ...(incoming.sources || [])])),
    importedAt: incoming.importedAt > existing.importedAt ? incoming.importedAt : existing.importedAt,
  };
}

export function upsertOrdersInMap(byId, newOrders) {
  let added = 0;
  let merged = 0;
  const changed = [];
  for (const inc of newOrders) {
    const existing = byId.get(inc.orderId);
    if (existing) {
      const mergedRecord = mergeOrderRecords(existing, inc);
      byId.set(inc.orderId, mergedRecord);
      changed.push(mergedRecord);
      merged++;
    } else {
      byId.set(inc.orderId, inc);
      changed.push(inc);
      added++;
    }
  }
  return { added, merged, changed, total: byId.size };
}

function baseTxRow(order, day) {
  const lineItems = order.lineItems || [];
  return {
    id: `api-${order.orderId}`,
    createdAt: day,
    createdSort: day,
    typeRaw: 'Bestellung',
    kind: 'order',
    orderId: order.orderId,
    buyerUsername: order.buyer?.username || '',
    buyerName: order.buyer?.fullName || '',
    city: '',
    zip: '',
    country: '',
    netEur: null,
    payoutDate: '',
    payoutId: '',
    payoutMethod: '',
    payoutStatus: '',
    listingId: lineItems[0]?.listingId || '',
    transactionId: '',
    title: '',
    sku: lineItems[0]?.sku || '',
    quantity: null,
    itemSubtotalEur: null,
    shippingEur: null,
    sellerTaxEur: null,
    ebayTaxEur: order.taxTotal ?? null,
    fixedFeeEur: null,
    variableFeeEur: null,
    otherOrderFeeEur: null,
    grossEur: null,
    currency: 'EUR',
    reference: '',
    description: '',
  };
}

function orderRecordToTxRows(order) {
  const lineItems = order.lineItems || [];
  const title = lineItems.map((li) => li.title).filter(Boolean).join(' + ') || '';
  const lineItemSubtotal = lineItems.reduce((sum, li) => sum + (Number(li.lineItemCost) || 0), 0) || null;
  const quantity = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0) || null;
  const day = order.creationDate || '';
  const events = order.financialEvents || [];
  const feeEvents = events.filter((e) => e.kind === 'fee');
  const hasFinancesData = feeEvents.length > 0;

  if (!hasFinancesData) {
    const row = baseTxRow(order, day);
    row.title = title;
    row.quantity = quantity;
    row.itemSubtotalEur = lineItemSubtotal ?? order.grossTotal ?? null;
    row.shippingEur = order.shippingCost ?? null;
    row.netEur = order.netTotal ?? null;
    row.variableFeeEur = order.feeTotal != null ? -Math.abs(order.feeTotal) : null;
    row.grossEur = order.grossTotal ?? null;
    return [row];
  }

  const saleGross =
    events.filter((e) => e.kind === 'sale').reduce((sum, e) => sum + (Number(e.amount) || 0), 0) ||
    order.grossTotal ||
    0;

  let fvfEur = 0;
  const extraRows = [];
  feeEvents.forEach((e, idx) => {
    const amt = -Math.abs(Number(e.amount) || 0);
    const bucket = e.transactionType || '';
    if (bucket === 'Transaktionsgebühren') {
      fvfEur = roundMoney(fvfEur + amt);
      return;
    }
    const isLabel = bucket === 'Versandetikett';
    const isAd = bucket === 'Anzeigengebühr Basis';
    const row = baseTxRow(order, e.date || day);
    row.id = `api-fee-${order.orderId}-${idx}`;
    row.typeRaw = isLabel ? 'Versandetikett' : isAd ? 'Anzeigengebühr' : bucket || 'Sonstige Gebühr';
    row.kind = isLabel ? 'label' : 'other_fee';
    row.netEur = amt;
    row.grossEur = amt;
    row.description = isAd ? e.description || 'Anzeigengebühr Basis' : e.description || bucket || 'Gebühr';
    extraRows.push(row);
  });

  const impliedShipping =
    lineItemSubtotal != null && saleGross - lineItemSubtotal > 0.01
      ? roundMoney(saleGross - lineItemSubtotal)
      : lineItemSubtotal != null
        ? 0
        : null;

  const orderRow = baseTxRow(order, day);
  orderRow.title = title;
  orderRow.quantity = quantity;
  orderRow.itemSubtotalEur = lineItemSubtotal ?? saleGross;
  orderRow.shippingEur = order.shippingCost ?? impliedShipping;
  orderRow.grossEur = roundMoney(saleGross);
  orderRow.variableFeeEur = fvfEur || null;
  orderRow.netEur = roundMoney(saleGross + fvfEur);

  return [orderRow, ...extraRows];
}

function summarizeEbayTxRows(rows) {
  let orderCount = 0;
  let salesGross = 0;
  const unique = new Set();
  for (const row of rows) {
    if (row.orderId) unique.add(row.orderId);
    if (row.kind === 'order') {
      orderCount += 1;
      salesGross += row.grossEur ?? 0;
    }
  }
  return {
    rowCount: rows.length,
    orderCount,
    uniqueOrders: unique.size,
    salesGrossEur: roundMoney(salesGross),
  };
}

export function rebuildApiSyncReport(allOrders, existingReports) {
  const reports = existingReports || [];
  const previousApiReport = reports.find((r) => r.meta?.id === API_SYNC_REPORT_ID);
  const previousApiOrderIds = new Set(
    (previousApiReport?.rows || []).filter((r) => r.kind === 'order').map((r) => r.orderId)
  );

  const csvOrderIds = new Set();
  for (const report of reports) {
    if (report.meta?.id === API_SYNC_REPORT_ID) continue;
    for (const row of report.rows || []) {
      if (row.kind === 'order' && row.orderId) csvOrderIds.add(row.orderId);
    }
  }

  const apiOrders = allOrders.filter(
    (o) => (o.sources || []).includes('api') && o.orderId && !csvOrderIds.has(o.orderId)
  );

  let rows = apiOrders.flatMap(orderRecordToTxRows);

  const seenOrderIds = new Set(rows.filter((r) => r.kind === 'order' && r.orderId).map((r) => r.orderId));
  if (previousApiReport) {
    for (const row of previousApiReport.rows || []) {
      if (!row.orderId) continue;
      if (csvOrderIds.has(row.orderId)) continue;
      if (seenOrderIds.has(row.orderId)) continue;
      rows.push(row);
    }
  }

  rows.sort((a, b) => (b.createdSort || '').localeCompare(a.createdSort || ''));
  const days = rows.map((r) => r.createdSort).filter(Boolean).sort();

  const report = {
    meta: {
      id: API_SYNC_REPORT_ID,
      seller: '',
      startDate: days[0] || '',
      endDate: days[days.length - 1] || '',
      fileName: 'eBay API sync',
      importedAt: new Date().toISOString(),
    },
    rows,
    summary: summarizeEbayTxRows(rows),
  };

  const newOrderIds = apiOrders.map((o) => o.orderId).filter((id) => id && !previousApiOrderIds.has(id));

  return { report, newOrderIds };
}

async function fetchAllCloudOrders(sb, userId) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('ebay_orders')
      .select('id, order_data')
      .eq('user_id', userId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ebay_orders: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      if (row.order_data) out.push(row.order_data);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function fetchAllCloudTxReports(sb, userId) {
  const { data, error } = await sb
    .from('ebay_tx_reports')
    .select('id, report_name, report_data')
    .eq('user_id', userId);
  if (error) throw new Error(`ebay_tx_reports: ${error.message}`);
  return (data || []).map((r) => r.report_data).filter(Boolean);
}

async function upsertCloudOrders(sb, userId, orders) {
  if (!orders.length) return;
  const rows = orders.map((o) => ({
    id: o.orderId,
    user_id: userId,
    order_data: o,
    updated_at: new Date().toISOString(),
  }));
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await sb.from('ebay_orders').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`ebay_orders upsert: ${error.message}`);
  }
}

async function upsertCloudTxReport(sb, userId, report) {
  const row = {
    id: report.meta.id,
    user_id: userId,
    report_name: report.meta.fileName || report.meta.id,
    report_data: report,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('ebay_tx_reports').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`ebay_tx_reports upsert: ${error.message}`);
}

/**
 * Full server-side sync: refresh token → Fulfillment orders → Finances fees → Supabase.
 */
export async function runEbayOrderCloudSync(sb, userId, options = {}) {
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const fromDate = options.fromDate ?? isoDateDaysAgo(lookbackDays);
  const toDate = options.toDate ?? isoDateDaysAgo(0);
  const importedAt = new Date().toISOString();

  const { data: profile, error: profErr } = await sb
    .from('user_profiles')
    .select(
      'id, ebay_oauth_refresh_token, ebay_oauth_token, ebay_oauth_expires_at, ebay_seller_username, dashboard_prefs'
    )
    .eq('id', userId)
    .maybeSingle();
  if (profErr) throw new Error(`user_profiles: ${profErr.message}`);

  const refreshToken = (profile?.ebay_oauth_refresh_token || '').trim();
  if (!refreshToken) {
    return { ok: false, skipped: true, reason: 'no_ebay_refresh_token' };
  }

  const tokenData = await refreshEbayAccessToken(refreshToken);
  const accessToken = tokenData.accessToken;
  if (!accessToken) throw new Error('OAuth refresh returned no access token');

  const expiresAt = tokenData.expiresIn
    ? Date.now() + Number(tokenData.expiresIn) * 1000
    : profile?.ebay_oauth_expires_at;

  const profilePatch = {
    ebay_oauth_token: accessToken,
    ebay_oauth_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  if (tokenData.refreshToken && tokenData.refreshToken !== refreshToken) {
    profilePatch.ebay_oauth_refresh_token = tokenData.refreshToken;
  }
  if (tokenData.refreshExpiresIn) {
    profilePatch.ebay_oauth_refresh_expires_at = Date.now() + Number(tokenData.refreshExpiresIn) * 1000;
  }

  const existingOrders = await fetchAllCloudOrders(sb, userId);
  const byId = new Map(existingOrders.map((o) => [o.orderId, o]));

  const fulfillmentSummaries = await fetchEbayFulfillmentOrders(accessToken, fromDate, toDate);
  const fulfillmentRecords = fulfillmentSummaries.map((o) => fulfillmentSummaryToRecord(o, importedAt));
  const fulfillmentResult = upsertOrdersInMap(byId, fulfillmentRecords);

  let feesWarning;
  try {
    const financeTxs = await fetchEbayFinanceTransactions(accessToken, fromDate, toDate);
    const financeRecords = financeTransactionsToOrderRecords(financeTxs, importedAt);
    upsertOrdersInMap(byId, financeRecords);
  } catch (e) {
    feesWarning =
      e?.code === 'finances_forbidden'
        ? `Fee breakdown skipped: ${e.message} (${e.detail || 'no detail'})`
        : `Fee breakdown incomplete: ${e instanceof Error ? e.message : 'Sell Finances API failed'}`;
  }

  const allOrders = Array.from(byId.values());
  const changedIds = new Set(fulfillmentResult.changed.map((o) => o.orderId));
  for (const o of allOrders) {
    if (o.importedAt === importedAt) changedIds.add(o.orderId);
  }
  const changedOrders = allOrders.filter((o) => changedIds.has(o.orderId));

  await upsertCloudOrders(sb, userId, changedOrders.length ? changedOrders : fulfillmentResult.changed);

  const existingReports = await fetchAllCloudTxReports(sb, userId);
  const { report, newOrderIds } = rebuildApiSyncReport(allOrders, existingReports);
  await upsertCloudTxReport(sb, userId, report);

  const syncMeta = {
    lastRunAt: importedAt,
    fromDate,
    toDate,
    ordersFetched: fulfillmentSummaries.length,
    ordersAdded: fulfillmentResult.added,
    ordersMerged: fulfillmentResult.merged,
    newOrderIds: newOrderIds.slice(0, 50),
    newOrderCount: newOrderIds.length,
    reportOrderCount: report.summary?.orderCount ?? 0,
    feesWarning: feesWarning || null,
  };

  const prefs = (profile?.dashboard_prefs && typeof profile.dashboard_prefs === 'object')
    ? profile.dashboard_prefs
    : {};
  await sb
    .from('user_profiles')
    .update({
      ...profilePatch,
      dashboard_prefs: { ...prefs, ebayOrderCronSync: syncMeta },
    })
    .eq('id', userId);

  return {
    ok: true,
    skipped: false,
    syncedAt: importedAt,
    ...syncMeta,
  };
}
