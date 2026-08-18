export const FUEL_RECEIPT_EXTRACTION_PROMPT = `You are reading a fuel station receipt (German or English).

Return JSON only:
{
  "receiptDate": string | null,
  "fuelAmountEur": number | null,
  "stationName": string | null,
  "fuelLabel": string | null
}

Goal:
- Extract ONLY the fuel line amount (Benzin/Diesel/Super/E10/E5/Ultimate/V-Power/etc.).
- Ignore non-fuel purchases like coffee, cigarettes, snacks, car wash, shop items.

Rules:
- receiptDate: calendar date from the receipt; return YYYY-MM-DD or null.
- fuelAmountEur: amount for fuel only, as number (dot decimal). Prefer the explicit fuel line total. If multiple fuel lines exist, sum fuel lines only.
- stationName: short station/brand name if visible (e.g. ARAL, Shell, TotalEnergies) else null.
- fuelLabel: fuel product text if visible (e.g. "Super E10") else null.
- Never use grand total when non-fuel items are present unless fuel-only is clearly the only purchase.
- Use null when uncertain; do not invent.
`;

const MONTHS = {
  jan: 1,
  januar: 1,
  feb: 2,
  februar: 2,
  mar: 3,
  maerz: 3,
  marz: 3,
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
  oktober: 10,
  oct: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dezember: 12,
  dec: 12,
};

function monthKey(token) {
  return token
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function toIsoDate(y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2000 || y > 2100) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseExtractedFuelReceiptDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (de) {
    const yy = de[3].length === 2 ? 2000 + Number(de[3]) : Number(de[3]);
    return toIsoDate(yy, Number(de[2]), Number(de[1]));
  }

  const named = /(\d{1,2})\.\s*([A-Za-zäÄöÖüÜß]+)\.?\s+(\d{4})/.exec(s);
  if (named) {
    const m = MONTHS[monthKey(named[2])];
    if (!m) return null;
    return toIsoDate(Number(named[3]), m, Number(named[1]));
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;
}

export function parseExtractedFuelEurAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned = v
    .trim()
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
