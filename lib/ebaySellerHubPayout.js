/** Seller Hub payout text (German/English) → structured EUR fields. Shared by Vite, API, Playwright. */

export const EBAY_SELLER_HUB_ORDERS_URL =
  'https://www.ebay.de/sh/ord/?filter=status%3AALL_ORDERS%2Ctimerange%3ACURRENTYEAR';

const STOP = new Set([
  'der',
  'die',
  'das',
  'und',
  'fur',
  'für',
  'mit',
  'von',
  'the',
  'and',
  'for',
  'with',
  'new',
  'neu',
  'ebay',
]);

const EURO_TOKEN =
  '[-−–]?\\s*(?:€|EUR)?\\s*\\d{1,3}(?:\\.\\d{3})*(?:,\\d{2})(?:\\s*€|\\s*EUR)?|[-−–]?\\s*(?:€|EUR)?\\s*\\d+(?:[.,]\\d{1,2})?(?:\\s*€|\\s*EUR)?';

/**
 * @param {string | null | undefined} raw
 * @returns {number | null}
 */
export function parseEbayMoney(raw) {
  if (raw == null) return null;
  let s = String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/[€]|EUR/gi, '')
    .replace(/[−–]/g, '-')
    .trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let n;
  if (hasComma && hasDot) {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  } else if (hasComma) {
    n = parseFloat(s.replace(',', '.'));
  } else if (hasDot) {
    const frac = s.split('.')[1] || '';
    n = frac.length === 3 ? parseFloat(s.replace(/\./g, '')) : parseFloat(s);
  } else {
    n = parseFloat(s);
  }
  if (!Number.isFinite(n)) return null;
  const value = Math.round((neg ? -n : n) * 100) / 100;
  return value;
}

function absMoney(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100) / 100;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {string} hay
 * @param {RegExp} label
 * @returns {number | null}
 */
function amountAfter(hay, label) {
  const skip = '[^\\d€\\-−–]{0,80}';
  const re = new RegExp(`(?:${label.source})${skip}(${EURO_TOKEN})`, 'i');
  const m = hay.match(re);
  return m ? parseEbayMoney(m[1]) : null;
}

function sliceSection(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = endRe ? rest.slice(8).search(endRe) : -1;
  return end >= 0 ? rest.slice(0, end + 8) : rest.slice(0, 1600);
}

function orderIdFromText(text) {
  const m =
    text.match(/\b(\d{2}-\d{4,}-\d{4,})\b/) ||
    text.match(/(?:Bestell(?:nr\.?|ung|nummer)|Order(?:\s*(?:number|ID))?)\s*[:#]?\s*(\d{2}-\d{4,}-\d{4,})/i);
  return m ? m[1] : null;
}

/**
 * @param {string} text
 * @returns {{
 *   itemGrossEur: number | null,
 *   buyerShippingEur: number | null,
 *   buyerTotalEur: number | null,
 *   transactionFeeEur: number | null,
 *   adFeeEur: number | null,
 *   shippingLabelEur: number | null,
 *   otherFeeEur: number | null,
 *   netPayoutEur: number | null,
 *   orderId: string | null,
 *   rawMatched: boolean,
 * }}
 */
export function parseEbaySellerHubPayoutText(text) {
  const src = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n');
  const empty = {
    itemGrossEur: null,
    buyerShippingEur: null,
    buyerTotalEur: null,
    transactionFeeEur: null,
    adFeeEur: null,
    shippingLabelEur: null,
    otherFeeEur: null,
    netPayoutEur: null,
    orderId: orderIdFromText(src),
    rawMatched: false,
  };
  if (!src.trim()) return empty;

  const buyerSection =
    sliceSection(src, /Vom Käufer bezahlt|Buyer paid|Amount the buyer paid/i, /Ihr Verkaufserlös|Your earnings|Verkaufserlös/i) ||
    src;
  const sellerSection =
    sliceSection(src, /Ihr Verkaufserlös|Your earnings|Transaktionsgebühren|Transaction fees/i, null) || src;

  const itemGrossEur =
    amountAfter(buyerSection, /Zwischensumme|Subtotal|Artikelpreis|Item\s*price/i) ??
    amountAfter(src, /Zwischensumme|Artikelpreis/i);

  const buyerShippingEur =
    amountAfter(buyerSection, /Versand(?!\s*etikett)|Buyer\s*shipping|(?<![A-Za-z])Shipping(?!\s*label)/i) ??
    amountAfter(src, /(?:^|\n)\s*Versand(?!\s*etikett)\b/i);

  const buyerTotalEur =
    amountAfter(buyerSection, /Gesamtbetrag|Order\s*total|Total\s*amount|Grand\s*total/i) ??
    amountAfter(src, /Gesamtbetrag/i);

  const transactionFeeEur = absMoney(
    amountAfter(sellerSection, /Transaktionsgebühren|Verkaufsgebühr|Final\s*value\s*fee|Transaction\s*fees?/i) ??
      amountAfter(src, /Transaktionsgebühren|Verkaufsgebühr/i)
  );

  const adFeeEur = absMoney(
    amountAfter(sellerSection, /Anzeigengebühr(?:\s*Basis)?|Promoted\s*listing|Ad\s*fee|Werbekosten/i) ??
      amountAfter(src, /Anzeigengebühr(?:\s*Basis)?/i)
  );

  const shippingLabelEur = absMoney(
    amountAfter(sellerSection, /Versandetikett|Shipping\s*label|Versandlabel/i) ??
      amountAfter(src, /Versandetikett/i)
  );

  const otherFeeEur = absMoney(
    amountAfter(sellerSection, /Weitere Gebühren|Other fees|Regulierte Waren/i)
  );

  let netPayoutEur =
    amountAfter(sellerSection, /Bestelleinnahmen|Order\s*earnings|Auszahlungsbetrag|Sie erhalten/i) ??
    amountAfter(src, /Bestelleinnahmen|Auszahlungsbetrag/i);

  const resolvedTotal =
    buyerTotalEur ??
    (itemGrossEur != null || buyerShippingEur != null
      ? roundMoney((itemGrossEur ?? 0) + (buyerShippingEur ?? 0))
      : null);

  if (netPayoutEur == null && resolvedTotal != null) {
    const deducted =
      (transactionFeeEur ?? 0) + (adFeeEur ?? 0) + (shippingLabelEur ?? 0) + (otherFeeEur ?? 0);
    if (deducted > 0) netPayoutEur = roundMoney(resolvedTotal - deducted);
  }

  const rawMatched = [
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur,
    netPayoutEur,
  ].some((v) => v != null);

  return {
    itemGrossEur: itemGrossEur != null ? absMoney(itemGrossEur) : null,
    buyerShippingEur: buyerShippingEur != null ? absMoney(buyerShippingEur) : null,
    buyerTotalEur: resolvedTotal != null ? absMoney(resolvedTotal) : null,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur,
    otherFeeEur,
    netPayoutEur: netPayoutEur != null ? roundMoney(netPayoutEur) : null,
    orderId: orderIdFromText(src),
    rawMatched,
  };
}

export function payoutLooksComplete(payout) {
  if (!payout?.rawMatched) return false;
  return payout.buyerTotalEur != null || payout.itemGrossEur != null || payout.netPayoutEur != null;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
export function tokenizeMatchQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/**
 * @param {{ orderId?: string, snippet?: string, href?: string }} row
 * @param {{ orderId?: string, sku?: string, listingId?: string, title?: string, query?: string }} query
 */
export function scoreSellerHubOrderRow(row, query) {
  const hay = `${row.orderId || ''} ${row.snippet || ''} ${row.href || ''}`.toLowerCase();
  let score = 0;
  const orderId = query.orderId?.trim();
  if (orderId && hay.includes(orderId.toLowerCase())) score += 10000;
  const sku = query.sku?.trim();
  if (sku && hay.includes(sku.toLowerCase())) score += 2000;
  const listingId = query.listingId?.trim();
  if (listingId && hay.includes(listingId.toLowerCase())) score += 3000;
  const tokens = [
    ...tokenizeMatchQuery(query.title),
    ...tokenizeMatchQuery(query.query),
  ];
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (hay.includes(t)) score += Math.min(90, 12 + t.length * 6);
  }
  return score;
}

/**
 * @param {Array<{ orderId: string, snippet?: string, href?: string }>} rows
 * @param {{ orderId?: string, sku?: string, listingId?: string, title?: string, query?: string }} query
 */
export function pickSellerHubMatch(rows, query) {
  const scored = (rows || [])
    .map((row) => ({ ...row, score: scoreSellerHubOrderRow(row, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (query.orderId?.trim()) {
    const want = query.orderId.trim().toLowerCase();
    const exact = scored.find((row) => String(row.orderId).toLowerCase() === want);
    if (exact) return { status: 'exact', match: exact, candidates: scored.slice(0, 8) };
  }

  if (!scored.length) return { status: 'none', match: null, candidates: [] };

  const best = scored[0];
  const second = scored[1];
  const unique =
    best.score >= 80 && (!second || best.score >= second.score + 25 || second.score < 50);
  if (unique) return { status: 'exact', match: best, candidates: scored.slice(0, 8) };
  return { status: 'ambiguous', match: null, candidates: scored.slice(0, 8) };
}
