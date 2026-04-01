/**
 * German-style EUR display: always two decimals (e.g. 1 → "1,00", 1234.5 → "1.234,50").
 *
 * Important: this returns a **string** for labels only. Dashboard, tax, and Finanzamt math
 * all use JavaScript `number` (binary floating point). Comma/dot locale **never** flows
 * into `parseFloat`, sums, or storage — so display format cannot skew balances.
 */
const DE_TWO_DECIMALS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export function formatEUR(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('de-DE', DE_TWO_DECIMALS).format(n);
}

/** Typical app pattern: € prefix + German amount */
export function formatEURPrefix(amount: number): string {
  return `€${formatEUR(amount)}`;
}

/**
 * Locale-tolerant number parser for user inputs.
 * Accepts both comma and dot decimals ("19,04" and "19.04").
 */
export function parseLocaleNumber(value: string | number): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const normalized = raw.replace(/\s+/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/** Money parser with default fallback (for controlled inputs). */
export function parseLocaleMoney(value: string | number, fallback = 0): number {
  const n = parseLocaleNumber(value);
  return Number.isFinite(n) ? n : fallback;
}
