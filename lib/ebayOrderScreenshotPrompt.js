/** Shared between Vite client and Vercel API — keep in sync if edited. */
export const EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT = `You are reading an eBay or eBay.de order details screenshot. Labels may be German:
- "Bestellung" = order ID
- "Lieferadresse" / shipping section = delivery address
- "Käufer" = buyer line, often "Full Name (ebay_username)"
- "Verkauft" / "Sold" = sale date (usually on the same row or directly beside this label)
- Payment / Gebühren section may show: item price, Versand (shipping), Verkaufsgebühr (selling fee), Anzeigengebühr / Werbekosten (ad / promoted listing fee), and Auszahlung / Sie erhalten (net payout)

Return one JSON object only (no markdown):
{
  "ebayOrderId": string | null,
  "ebayUsername": string | null,
  "buyerFullName": string | null,
  "shippingAddress": string | null,
  "phone": string | null,
  "soldPriceExShippingEur": number | null,
  "buyerShippingEur": number | null,
  "ebayFeeEur": number | null,
  "adFeeEur": number | null,
  "amountReceivedNetEur": number | null,
  "saleDate": string | null
}

Rules:
- ebayOrderId: ID like "19-11447-34715" (digits and dashes) next to Bestellung or Order.
- ebayUsername: ONLY the eBay member id. If the buyer line is "Name (handle)", use "handle". Never put the real name here.
- buyerFullName: recipient name from the shipping address block.
- shippingAddress: street, postal code + city, country as plain text; use newline characters between lines. Do not put phone here.
- phone: only if clearly shown (e.g. +49 ...).
- soldPriceExShippingEur: The **item sold price in EUR that the buyer paid for the goods**, **excluding shipping/Versand**. This is the article / Artikelpreis / Verkaufspreis of the item itself — NOT the order grand total that includes Versand, and NOT the seller's Auszahlung after fees. If the UI shows "Artikelpreis" / line item cost / sold-for price separate from "Versand", use that item amount. If only a total with shipping is visible and shipping is also visible, compute: total − shipping. Use a JSON number with a dot decimal (e.g. 189.00). null if not visible or ambiguous.
- buyerShippingEur: Versand / shipping the buyer paid (if shown). null if not visible. Do not invent.
- ebayFeeEur: eBay selling fee only ("Verkaufsgebühr", "Verkaufsprovision", fixed+%-fee for the sale). Absolute EUR amount as a positive number. null if not visible. Do not include ad fees here.
- adFeeEur: Promoted listings / ads fee only ("Anzeigengebühr", "Werbekosten", "Promoted Listing"). Absolute EUR amount as a positive number. null if not visible. Do not include Verkaufsgebühr here.
- amountReceivedNetEur: What the **seller actually receives** after fees ("Auszahlungsbetrag", "Sie erhalten", "Auszahlung"). Informational only — do NOT confuse this with soldPriceExShippingEur. null if not visible.
- saleDate: The calendar date next to "Verkauft" or "Sold" (or equivalent sold-date field). eBay.de often shows it like "Verkauft 18. Jun 2026" (day, abbreviated German month, year). Return ISO format YYYY-MM-DD (e.g. 2026-06-18). Also convert "19.06.2025" if shown numerically. null if not visible.

Use null for anything not visible. Do not invent data. Prefer soldPriceExShippingEur over guessing from Auszahlung.`;

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

/** Parse AI euro amounts (number or German/English string) to a finite number or null. */
export function parseExtractedEurAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
