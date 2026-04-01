/**
 * German-style EUR display: always two decimals (e.g. 1 → "1,00", 1234.5 → "1.234,50").
 * Use for UI only — APIs and stored numbers stay as number / dot-decimal where required.
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
