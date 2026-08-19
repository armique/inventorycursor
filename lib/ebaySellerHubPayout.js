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

const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const BUYER_STOP =
  /^(käufer|kaeufer|buyer|name|adresse|versand|bestellung|gesamtbetrag|lieferadresse|versandadresse|shipping|user|e-?mail|telefon|phone|deutschland|germany)$/i;

function labeledCapture(src, labelRe, valueRe) {
  const re = new RegExp(`(?:${labelRe.source})\\s*[:.]?\\s*(?:\\n\\s*)?(${valueRe.source})`, 'i');
  const m = src.match(re);
  return m ? String(m[1]).trim() : null;
}

function addressFromJsonLabels(src) {
  const line1 =
    src.match(/address\s*Line\s*1\s+([^\n]+)/i)?.[1]?.trim() ||
    src.match(/addressLine1\s+([^\n]+)/i)?.[1]?.trim();
  const line2 =
    src.match(/address\s*Line\s*2\s+([^\n]+)/i)?.[1]?.trim() ||
    src.match(/addressLine2\s+([^\n]+)/i)?.[1]?.trim();
  const postal =
    src.match(/postal\s*Code\s+([^\n]+)/i)?.[1]?.trim() ||
    src.match(/postalCode\s+([^\n]+)/i)?.[1]?.trim();
  const city = src.match(/\bcity(?:\s*Name)?\s+([^\n]+)/i)?.[1]?.trim();
  const country = src.match(/country(?:\s*Code|\s*Name)?\s+([A-Za-zÄÖÜäöüß .-]{2,40})/i)?.[1]?.trim();
  const parts = [line1, line2, [postal, city].filter(Boolean).join(' '), country].filter(Boolean);
  return parts.length >= 2 ? parts.join('\n') : parts[0] || null;
}

function sectionLines(text, startRe, endRe) {
  const block = sliceSection(text, startRe, endRe);
  if (!block) return [];
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1);
}

/**
 * Username, legal name, and Lieferadresse from a Seller Hub order page (or labeled JSON dump).
 * @param {string} text
 * @returns {{ username: string | null, fullName: string | null, address: string | null }}
 */
export function extractHubBuyer(text) {
  const src = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n');
  if (!src.trim()) return { username: null, fullName: null, address: null };

  let username = labeledCapture(
    src,
    /eBay[-\s]?Nutzername|Nutzername|Benutzername|User\s*name|buyer\.?user(?:Name)?|buyerUserName|(?:^|\n)username/i,
    /[A-Za-z0-9._-]{3,64}/
  );
  if (username && BUYER_STOP.test(username)) username = null;

  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!username) {
    const kaIdx = lines.findIndex((l) => /^(Käufer|Buyer)$/i.test(l));
    const next = kaIdx >= 0 ? lines[kaIdx + 1] : '';
    if (next && USERNAME_RE.test(next) && !BUYER_STOP.test(next)) username = next;
  }

  let fullName = labeledCapture(
    src,
    /Vollständiger Name|Name des Käufers|Buyer name|fullName|full[_ ]?name|buyer\.fullName/i,
    /[^\n]{3,80}/
  );
  if (fullName && (/€|EUR|\d{2}-\d{4,}/.test(fullName) || BUYER_STOP.test(fullName))) fullName = null;

  const addrLines = sectionLines(
    src,
    /(?:^|\n)\s*(?:Lieferadresse|Versandadresse|Lieferanschrift|Shipping address|Ship to|Versand an)\b/i,
    /Ihr Verkaufserlös|Bestelleinnahmen|Zahlungs|Tracking|Sendungsnr|Vom Käufer|Verkaufserlös|Transaktionsgebühren|Your earnings/i
  ).filter((l) => l !== username && !BUYER_STOP.test(l) && !/^(Lieferadresse|Versandadresse|Shipping address|Ship to)$/i.test(l));

  let address = addrLines.length ? addrLines.slice(0, 8).join('\n') : null;
  if (!fullName && addrLines[0] && /[A-Za-zÄÖÜäöüß]{2,}\s+[A-Za-zÄÖÜäöüß]{2,}/.test(addrLines[0])) {
    fullName = addrLines[0];
  }

  if (!address) {
    const kaLines = sectionLines(
      src,
      /(?:^|\n)\s*(?:Käufer|Buyer)\s*$/m,
      /Ihr Verkaufserlös|Bestelleinnahmen|Lieferadresse|Zahlungs|Vom Käufer|Verkaufserlös|Transaktionsgebühren/i
    ).filter((l) => l !== username && !BUYER_STOP.test(l));
    if (!fullName && kaLines[0] && /[A-Za-zÄÖÜäöüß]/.test(kaLines[0]) && kaLines[0].includes(' ')) {
      fullName = kaLines[0];
    }
    if (kaLines.length >= 2) address = kaLines.slice(0, 8).join('\n');
  }

  if (!address) address = addressFromJsonLabels(src);

  if (looksLikeJunkPerson(username)) username = null;
  if (looksLikeJunkPerson(fullName)) fullName = null;
  if (looksLikeJunkPerson(address)) address = null;

  return {
    username: username || null,
    fullName: fullName || null,
    address: address || null,
  };
}

/** Hub JSON dumps sometimes land in buyer fields as TextualDisplay blobs. */
export function looksLikeJunkPerson(value) {
  const t = String(value || '').trim();
  if (!t) return true;
  if (t.length > 120) return true;
  if (/[{}\[\]]/.test(t) && /_type|TextualDisplay|TextSpan|":\{/.test(t)) return true;
  if (/^[:{"]/.test(t)) return true;
  return false;
}

/** Inclusive date when eBay.de started charging this seller business transaction fees. */
export const EBAY_DE_BUSINESS_TX_FEE_FROM = '2025-07-01';
export const EBAY_DE_BUSINESS_TX_FEE_FROM_ORDER = '03-13278-56411';

const HUB_MONTHS = {
  jan: 1,
  januar: 1,
  january: 1,
  feb: 2,
  februar: 2,
  february: 2,
  mär: 3,
  märz: 3,
  mar: 3,
  mrz: 3,
  march: 3,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oct: 10,
  oktober: 10,
  october: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dec: 12,
  dezember: 12,
  december: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(y, mo, d) {
  if (y < 100) y += 2000;
  if (y < 2020 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** Parse Hub list/details dates: 01.07.2025, 1. Jul. 2025, 2025-07-01. */
export function parseGermanHubDate(str) {
  if (!str) return null;
  const src = String(str).replace(/\u00a0/g, ' ');
  const iso = src.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return ymd(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10));
  const dotted = src.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/);
  if (dotted) return ymd(parseInt(dotted[3], 10), parseInt(dotted[2], 10), parseInt(dotted[1], 10));
  const named = src.match(/\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]{3,12})\.?\s+(\d{4})\b/);
  if (named) {
    const key = named[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const month = HUB_MONTHS[named[2].toLowerCase()] || HUB_MONTHS[key] || HUB_MONTHS[key.slice(0, 3)];
    if (month) return ymd(parseInt(named[3], 10), month, parseInt(named[1], 10));
  }
  return null;
}

/**
 * Cancelled / refunded / date from a Hub list row or details page.
 * @param {string} text
 * @returns {{
 *   creationDate: string | null,
 *   status: 'cancelled' | 'refunded_full' | 'refunded_partial' | 'active' | 'unknown',
 *   refundEur: number | null,
 *   cancelState: string | null,
 *   orderFulfillmentStatus: string | null,
 *   orderPaymentStatus: string | null,
 * }}
 */
export function extractHubOrderLifecycle(text) {
  const src = String(text || '').replace(/\u00a0/g, ' ');
  const creationDate = parseGermanHubDate(src);
  const refundEur = absMoney(
    amountAfter(src, /Erstattet(?:er)?\s+Betrag|Rückerstattungsbetrag|Refund(?:ed)?\s+amount|Amount refunded/i) ??
      amountAfter(src, /(?:^|\n)\s*Erstattet\b/i)
  );

  let status = 'unknown';
  if (/teilweise\s+erstattet|partial(?:ly)?\s+refund/i.test(src)) status = 'refunded_partial';
  else if (/vollständig\s+erstattet|full(?:y)?\s+refund/i.test(src)) status = 'refunded_full';
  else if (/\bstorniert\b|\bcancelled\b|\bcanceled\b|\bannulliert\b/i.test(src)) status = 'cancelled';
  else if (/\berstattet\b|rückerstattung|\brefunded\b/i.test(src)) status = 'refunded_full';
  else if (/bezahlt|verschickt|versendet|shipped|paid|geliefert/i.test(src)) status = 'active';

  if (status === 'refunded_full' && refundEur != null) {
    const total =
      amountAfter(src, /Gesamtbetrag|Order\s*total|Total\s*amount/i) ??
      amountAfter(src, /Zwischensumme|Subtotal/i);
    if (total != null && refundEur + 0.05 < Math.abs(total)) status = 'refunded_partial';
  }

  const cancelled = status === 'cancelled';
  const refunded = status === 'refunded_full' || status === 'refunded_partial';
  return {
    creationDate,
    status,
    refundEur,
    cancelState: cancelled ? 'CANCELED' : null,
    orderFulfillmentStatus: cancelled ? 'CANCELLED' : null,
    orderPaymentStatus: status === 'refunded_full' ? 'FULLY_REFUNDED' : status === 'refunded_partial' ? 'PARTIALLY_REFUNDED' : null,
  };
}

/**
 * Sale/transaction fees only apply from 2025-07-01 (business account).
 * Orders before that date are still kept in full; we only drop TX fee lines
 * because this seller was not charged them yet. Ads, labels, and net stay.
 */
export function applyBusinessTxFeePolicy(payout, creationDate) {
  if (!payout) return payout;
  if (!creationDate || creationDate >= EBAY_DE_BUSINESS_TX_FEE_FROM) return payout;
  if (payout.transactionFeeEur == null || payout.transactionFeeEur < 0.01) return payout;
  return { ...payout, transactionFeeEur: 0 };
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
 *   username: string | null,
 *   fullName: string | null,
 *   address: string | null,
 *   rawMatched: boolean,
 * }}
 */
export function parseEbaySellerHubPayoutText(text) {
  const src = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n');
  const buyer = extractHubBuyer(src);
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
    username: buyer.username,
    fullName: buyer.fullName,
    address: buyer.address,
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
    username: buyer.username,
    fullName: buyer.fullName,
    address: buyer.address,
    rawMatched,
  };
}

export function payoutLooksComplete(payout) {
  if (!payout?.rawMatched) return false;
  return payout.buyerTotalEur != null || payout.itemGrossEur != null || payout.netPayoutEur != null;
}

export const HUB_PAYOUT_VISION_PROMPT = `You are reading an eBay.de Seller Hub order details screenshot.
Labels are German. Return one JSON object only:
{
  "buyerTotalEur": number | null,
  "itemGrossEur": number | null,
  "buyerShippingEur": number | null,
  "transactionFeeEur": number | null,
  "adFeeEur": number | null,
  "shippingLabelEur": number | null,
  "netPayoutEur": number | null,
  "orderId": string | null,
  "username": string | null,
  "fullName": string | null,
  "address": string | null
}
Rules:
- buyerTotalEur = Gesamtbetrag (what the buyer paid).
- itemGrossEur = Zwischensumme / Artikelpreis if shown.
- buyerShippingEur = Versand the buyer paid (not Versandetikett).
- transactionFeeEur = Transaktionsgebühren / Verkaufsgebühr, positive number.
- adFeeEur = Anzeigengebühr Basis, positive number.
- shippingLabelEur = Versandetikett, positive number.
- netPayoutEur = Bestelleinnahmen / Auszahlung.
- orderId like 03-12345-67890.
- username = eBay member id only, never the legal name.
- fullName = recipient name from Lieferadresse.
- address = Lieferadresse as plain text with newlines.
Use JSON numbers with a dot decimal. null if not visible. Do not invent.`;

function numField(raw) {
  const n = parseEbayMoney(raw);
  return n == null ? null : absMoney(n);
}

function strField(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t : null;
}

/** Map a Seller Hub vision-JSON object onto the same payout shape as the text parser. */
export function payoutFromHubVisionJson(raw, orderId) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const buyerTotalEur = numField(o.buyerTotalEur);
  const itemGrossEur = numField(o.itemGrossEur);
  const buyerShippingEur = numField(o.buyerShippingEur);
  const transactionFeeEur = numField(o.transactionFeeEur);
  const adFeeEur = numField(o.adFeeEur);
  const shippingLabelEur = numField(o.shippingLabelEur);
  const otherFeeEur = numField(o.otherFeeEur);
  let netPayoutEur = numField(o.netPayoutEur);
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
  const username = strField(o.username);
  const fullName = strField(o.fullName);
  const address = strField(o.address);
  const id = strField(o.orderId) || orderId || null;
  const rawMatched = [
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur,
    netPayoutEur,
    username,
    address,
  ].some((v) => v != null);
  return {
    itemGrossEur,
    buyerShippingEur,
    buyerTotalEur: resolvedTotal,
    transactionFeeEur,
    adFeeEur,
    shippingLabelEur,
    otherFeeEur,
    netPayoutEur,
    orderId: id,
    username,
    fullName,
    address,
    rawMatched,
  };
}

function payoutFieldScore(payout) {
  if (!payout) return 0;
  return [
    payout.buyerTotalEur,
    payout.itemGrossEur,
    payout.transactionFeeEur,
    payout.adFeeEur,
    payout.shippingLabelEur,
    payout.netPayoutEur,
  ].filter((v) => v != null && Number.isFinite(v)).length;
}

const JSON_KEY_LABELS = [
  [/final\s*value|transaction\s*fee|^fvf$|verkaufsgeb/i, 'Transaktionsgebühren'],
  [/ad\s*fee|promoted|anzeigengeb|insertion/i, 'Anzeigengebühr Basis'],
  [/shipping\s*label|versandetikett|label\s*fee/i, 'Versandetikett'],
  [/order\s*earnings|net\s*payout|bestelleinnahmen|seller\s*proceeds|amount\s*due\s*seller|^netamount$/i, 'Bestelleinnahmen'],
  [/buyer\s*total|order\s*total|grand\s*total|gesamtbetrag|buyer\s*paid|^totalamount$/i, 'Gesamtbetrag'],
];

function humanizeKey(key) {
  const s = String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.[\]]+/g, ' ')
    .trim();
  for (const [re, label] of JSON_KEY_LABELS) {
    if (re.test(s) || re.test(String(key || ''))) return label;
  }
  return s;
}

/** Flatten JSON (and { value } money objects) into label/amount lines the text parser understands. */
export function labeledTextFromUnknown(value) {
  const lines = [];
  const walk = (v, path) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      if ('value' in v && (typeof v.value === 'number' || typeof v.value === 'string')) {
        lines.push(`${humanizeKey(path)} ${v.value}`);
      }
      for (const [k, val] of Object.entries(v)) {
        walk(val, path ? `${path}.${k}` : k);
      }
      return;
    }
    if (typeof v === 'number' || typeof v === 'string') {
      lines.push(`${humanizeKey(path)} ${v}`);
    }
  };
  walk(value, '');
  return lines.join('\n');
}

function tryJsonParse(raw) {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? raw : null;
  const t = raw.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function buyerFromUnknown(value, acc = { username: null, fullName: null, address: null }) {
  if (!value || typeof value !== 'object') return acc;
  if (Array.isArray(value)) {
    for (const item of value) buyerFromUnknown(item, acc);
    return acc;
  }
  const obj = value;
  const user = obj.username || obj.userName || obj.buyerUserName || obj.user_name;
  if (typeof user === 'string' && USERNAME_RE.test(user.trim()) && !BUYER_STOP.test(user.trim())) {
    acc.username = acc.username || user.trim();
  }
  const name = obj.fullName || obj.legalName || obj.buyerName;
  if (typeof name === 'string' && name.trim().length >= 3 && /[A-Za-zÄÖÜäöüß]/.test(name) && name.includes(' ')) {
    acc.fullName = acc.fullName || name.trim();
  }
  const ship = obj.shippingAddress || obj.shipToAddress || obj.deliveryAddress || obj.shipTo;
  if (ship && typeof ship === 'object' && !Array.isArray(ship)) {
    const parts = [
      ship.addressLine1 || ship.address1,
      ship.addressLine2 || ship.address2,
      [ship.postalCode || ship.zip, ship.city].filter(Boolean).join(' '),
      ship.countryCode || ship.country,
    ]
      .map((p) => (p == null ? '' : String(p).trim()))
      .filter(Boolean);
    if (parts.length) acc.address = acc.address || parts.join('\n');
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') buyerFromUnknown(v, acc);
  }
  return acc;
}

/** Best-effort payout from a network JSON body or page text dump. */
export function harvestPayoutFromCapturedPayload(raw) {
  const chunks = [];
  if (typeof raw === 'string' && raw.trim()) chunks.push(raw);
  const obj = tryJsonParse(raw);
  if (obj) chunks.push(labeledTextFromUnknown(obj));
  let best = parseEbaySellerHubPayoutText('');
  for (const chunk of chunks) {
    best = pickRicherPayout(best, parseEbaySellerHubPayoutText(chunk)) || best;
  }
  if (obj) {
    const fromObj = buyerFromUnknown(obj);
    const address =
      (fromObj.address && (!best.address || fromObj.address.length > best.address.length))
        ? fromObj.address
        : best.address || fromObj.address;
    best = {
      ...best,
      username: best.username || fromObj.username,
      fullName: best.fullName || fromObj.fullName,
      address,
    };
  }
  return best;
}

const ORDER_ID_RE = /^\d{2}-\d{5}-\d{5}$/;
const TITLE_FIELD_KEYS =
  /^(title|itemTitle|listingTitle|offerTitle|lineItemTitle|displayTitle|itemName|translatedTitle|originalTitle)$/i;
const TITLE_SKIP =
  /^(einzelheiten zum kauf|view purchase details|bestellung ansehen|order details|kaufdetails|mehr anzeigen|show more|bestellung|bestellnummer|bestellnr\.?|verkauft am|käufer|buyer|versand|menge|preis|artikel|stück|qty|quantity|gesamtbetrag|zwischensumme|bestelleinnahmen|verkaufserlös|verkaufskosten|transaktionsgebühren|anzeigengebühr(?: basis)?|versandetikett|lieferadresse|nutzername|e-?mail|telefon|erstattet|storniert|bezahlt|versendet|geliefert|cancelled|refunded|shipped|paid|teilweise erstattet|deutschland|germany|ebay)$/i;
const TITLE_SKIP_PREFIX =
  /^(gesamtbetrag|zwischensumme|bestelleinnahmen|verkaufserlös|verkaufskosten|transaktionsgebühren|anzeigengebühr|versandetikett|versand(?:kosten)?|vom käufer|erstatteter betrag|lieferadresse)\b/i;
const TITLE_DATE_ONLY =
  /^(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\.\s*[A-Za-zÄÖÜäöüß]{3,12}\.?\s+\d{4}|20\d{2}-\d{2}-\d{2})$/i;

function cleanTitleCandidate(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b\d{2}-\d{5}-\d{5}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 8 || t.length > 180) return '';
  if (TITLE_SKIP.test(t)) return '';
  if (TITLE_SKIP_PREFIX.test(t)) return '';
  if (TITLE_DATE_ONLY.test(t)) return '';
  if (/^(?:€|EUR)?\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})\s*(?:€|EUR)?$/i.test(t)) return '';
  if (/^https?:/i.test(t)) return '';
  if (!/[A-Za-zÄÖÜäöüß]/.test(t)) return '';
  return t.slice(0, 180);
}

function pickTitleFromObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && TITLE_FIELD_KEYS.test(k)) {
      const t = cleanTitleCandidate(v);
      if (t) return t;
    }
  }
  const nested = obj.listing || obj.item || obj.offer;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && typeof nested.title === 'string') {
    const t = cleanTitleCandidate(nested.title);
    if (t) return t;
  }
  const lines = obj.lineItems || obj.lineItem || obj.items;
  const first = Array.isArray(lines) ? lines[0] : lines;
  if (first && typeof first === 'object' && typeof first.title === 'string') {
    return cleanTitleCandidate(first.title);
  }
  return '';
}

function pickOrderIdFromObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  for (const k of ['orderId', 'order_id', 'legacyOrderId', 'orderNumber']) {
    const v = obj[k];
    if (typeof v === 'string' && ORDER_ID_RE.test(v.trim())) return v.trim();
  }
  return '';
}

function titleFromSnippet(snippet) {
  let s = String(snippet || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  s = s.replace(/\b\d{2}-\d{5}-\d{5}\b/g, ' ');
  s = s.replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ');
  s = s.replace(/\b\d{1,2}\.\s*[A-Za-zÄÖÜäöüß]{3,12}\.?\s+\d{4}\b/g, ' ');
  s = s.replace(
    /(?:€|EUR)\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d{1,3}(?:\.\d{3})*(?:,\d{2})\s*(?:€|EUR)/gi,
    ' '
  );
  s = s.replace(
    /\b(?:erstattet|storniert|versendet|bezahlt|geliefert|cancelled|refunded|shipped|paid|teilweise erstattet)\b/gi,
    ' '
  );
  s = s.replace(/[·|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleanTitleCandidate(s);
}

function titleFromDetailsText(text) {
  const src = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n');
  const labeled = src.match(
    /(?:Artikelbezeichnung|Angebotstitel|Item title|Artikeltitel|Listing title)\s*[:\n]\s*([^\n]+)/i
  );
  if (labeled) {
    const t = cleanTitleCandidate(labeled[1]);
    if (t) return t;
  }
  const flattened = src.match(/\b(?:item\s*)?title\s+([^\n]{8,180})/i);
  if (flattened) {
    const t = cleanTitleCandidate(flattened[1]);
    if (t) return t;
  }
  const lines = src
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const stopAt = lines.findIndex((l) =>
    /^(Käufer|Buyer|Lieferadresse|Ihr Verkaufserlös|Vom Käufer bezahlt)$/i.test(l)
  );
  const window = stopAt > 0 ? lines.slice(0, stopAt) : lines;
  for (let i = 0; i < window.length; i++) {
    if (/^(Artikel(?:bezeichnung)?|Angebotstitel|Item title|Artikeltitel)$/i.test(window[i])) {
      for (let j = i + 1; j < Math.min(i + 4, window.length); j++) {
        const t = cleanTitleCandidate(window[j]);
        if (t) return t;
      }
    }
  }
  let best = '';
  for (const line of window) {
    const t = cleanTitleCandidate(line);
    if (!t) continue;
    const scored =
      (/\d/.test(t) ? 2 : 0) + (t.split(/\s+/).length >= 4 ? 2 : 0) + Math.min(t.length, 80) / 80;
    const bestScore =
      (/\d/.test(best) ? 2 : 0) + (best.split(/\s+/).length >= 4 ? 2 : 0) + Math.min(best.length, 80) / 80;
    if (!best || scored > bestScore) best = t;
  }
  return best;
}

function titlesFromPayloads(payloads, orderId) {
  const rows = [];
  for (const raw of payloads || []) {
    const obj = tryJsonParse(raw) || (raw && typeof raw === 'object' ? raw : null);
    if (obj) rows.push(...hubOrderRowsFromUnknown(obj));
    else if (typeof raw === 'string') {
      const t = titleFromDetailsText(raw) || titleFromSnippet(raw);
      if (t) rows.push({ orderId: orderId || '', snippet: t, href: '' });
    }
  }
  if (orderId) {
    const hit = rows.find((r) => r.orderId === orderId && r.snippet);
    if (hit) return hit.snippet;
  }
  const untitled = rows.find((r) => r.snippet && (!orderId || !r.orderId || r.orderId === orderId));
  return untitled?.snippet || '';
}

/**
 * Pair order IDs with listing titles inside a Seller Hub JSON payload (list or details).
 * @param {unknown} value
 * @returns {Array<{ orderId: string, snippet: string, href: string }>}
 */
export function hubOrderRowsFromUnknown(value) {
  const rows = [];
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const id = pickOrderIdFromObject(v);
    const title = pickTitleFromObject(v);
    if (id && !seen.has(id)) {
      seen.add(id);
      rows.push({
        orderId: id,
        snippet: title || '',
        href: `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(id)}`,
      });
    } else if (id && title) {
      const prev = rows.find((r) => r.orderId === id);
      if (prev && (!prev.snippet || title.length > prev.snippet.length)) prev.snippet = title;
    }
    for (const child of Object.values(v)) walk(child);
  };
  if (typeof value === 'string') {
    const obj = tryJsonParse(value);
    if (obj) walk(obj);
    else {
      const re = /\b(\d{2}-\d{5}-\d{5})\b/g;
      let m;
      while ((m = re.exec(value))) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        rows.push({
          orderId: m[1],
          snippet: '',
          href: `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(m[1])}`,
        });
      }
    }
    return rows;
  }
  walk(value);
  return rows;
}

/**
 * Listing title from a Seller Hub details page, list-row snippet, or captured JSON.
 * @param {string} text
 * @param {{ snippet?: string, payloads?: unknown[], candidates?: string[], orderId?: string }} [extras]
 * @returns {string}
 */
export function extractHubListingTitle(text, extras) {
  const extra = extras && typeof extras === 'object' ? extras : {};
  const labeled = titleFromDetailsText(text);
  if (labeled) return labeled;
  for (const c of extra.candidates || []) {
    const t = cleanTitleCandidate(c);
    if (t) return t;
  }
  const fromJson = titlesFromPayloads(extra.payloads, extra.orderId);
  if (fromJson) return fromJson;
  return titleFromSnippet(extra.snippet);
}

function mergeBuyerFields(a, b) {
  return {
    username: a?.username || b?.username || null,
    fullName: a?.fullName || b?.fullName || null,
    address: a?.address || b?.address || null,
  };
}

export function pickRicherPayout(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const money = payoutFieldScore(incoming) > payoutFieldScore(current) ? incoming : current;
  const other = money === incoming ? current : incoming;
  return { ...money, ...mergeBuyerFields(money, other) };
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
