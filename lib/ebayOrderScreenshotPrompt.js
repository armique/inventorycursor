/** Shared between Vite client and Vercel API — keep in sync if edited. */
export const EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT = `You are reading an eBay or eBay.de order details screenshot. Labels may be German:
- "Bestellung" = order ID
- "Lieferadresse" / shipping section = delivery address
- "Käufer" = buyer line, often "Full Name (ebay_username)"
- "Verkauft" / "Sold" = sale date (usually on the same row or directly beside this label)

Return one JSON object only (no markdown):
{
  "ebayOrderId": string | null,
  "ebayUsername": string | null,
  "buyerFullName": string | null,
  "shippingAddress": string | null,
  "phone": string | null,
  "amountReceivedNetEur": number | null,
  "saleDate": string | null
}

Rules:
- ebayOrderId: ID like "19-11447-34715" (digits and dashes) next to Bestellung or Order.
- ebayUsername: ONLY the eBay member id. If the buyer line is "Name (handle)", use "handle". Never put the real name here.
- buyerFullName: recipient name from the shipping address block.
- shippingAddress: street, postal code + city, country as plain text; use newline characters between lines. Do not put phone here.
- phone: only if clearly shown (e.g. +49 ...).
- amountReceivedNetEur: What the **seller actually receives in EUR after all visible deductions** — eBay selling fees, promoted listing / ad fees, and similar platform charges. This is usually the **bottom / final payout line** in the payment or fee breakdown (Zahlung / Gebühren), **not** the buyer's gross order total at the top. German UI may label it like "Auszahlungsbetrag", "Sie erhalten", "Auszahlung", net amount after "Verkaufsgebühr", "Anzeigengebühr", etc. If several euro amounts appear, pick the seller's **net** total after fees (often the last or lowest summary line). Use a JSON number in euros with a dot as decimal separator (e.g. 167.23). null if not visible or ambiguous.
- saleDate: The calendar date next to "Verkauft" or "Sold" (or equivalent sold-date field). eBay.de often shows it like "Verkauft 18. Jun 2026" (day, abbreviated German month, year). Return ISO format YYYY-MM-DD (e.g. 2026-06-18). Also convert "19.06.2025" if shown numerically. null if not visible.

Use null for anything not visible. Do not invent data.`;

/** Normalize AI-extracted sale date to YYYY-MM-DD or null. */
const GERMAN_MONTH_NUM = {
  jan: 1,
  januar: 1,
  feb: 2,
  februar: 2,
  mar: 3,
  marz: 3,
  maerz: 3,
  apr: 4,
  april: 4,
  mai: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oct: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dec: 12,
  dezember: 12,
};

function monthTokenKey(token) {
  return token
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function toIsoDateParts(year, month, day) {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseExtractedSaleDate(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  let str = v.trim();
  if (!str) return null;

  str = str.replace(/^(verkauft|sold)\s+/i, '').trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return toIsoDateParts(Number(iso[1]), month, day);
  }

  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(str);
  if (de) {
    const day = Number(de[1]);
    const month = Number(de[2]);
    const yearRaw = de[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    return toIsoDateParts(year, month, day);
  }

  const named = /(\d{1,2})\.\s*([A-Za-zäÄöÖüÜß]+)\.?\s+(\d{4})/.exec(str);
  if (named) {
    const day = Number(named[1]);
    const month = GERMAN_MONTH_NUM[monthTokenKey(named[2])];
    const year = Number(named[3]);
    if (month) return toIsoDateParts(year, month, day);
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return toIsoDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}
