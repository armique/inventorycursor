/** Heuristic: does an eBay purchase title look like 3D printer filament? */
export function looksLikeFilamentPurchase(title: string): boolean {
  const t = title.toLowerCase();
  const signals = [
    /\bfilament\b/,
    /\bpla\b/,
    /\bpetg\b/,
    /\babs\b/,
    /\basa\b/,
    /\btpu\b/,
    /\bnylon\b/,
    /\b3d[- ]?druck/,
    /\b3d[- ]?print/,
    /\b1\s*kg\b/,
    /\b1000\s*g\b/,
    /\bspool\b/,
    /\brolle\b/,
    /\b1\.75\s*mm\b/,
  ];
  return signals.some((re) => re.test(t));
}

/** Guess material from title for pre-fill. */
export function guessFilamentType(title: string): string {
  const t = title.toUpperCase();
  if (/\bPETG\b/.test(t)) return 'PETG';
  if (/\bABS\b/.test(t)) return 'ABS';
  if (/\bASA\b/.test(t)) return 'ASA';
  if (/\bTPU\b/.test(t)) return 'TPU';
  if (/\bNYLON\b/.test(t)) return 'Nylon';
  if (/\bPVA\b/.test(t)) return 'PVA';
  return 'PLA';
}

/** Guess spool weight in kg from title (default 1). */
export function guessFilamentWeightKg(title: string): number {
  const t = title.toLowerCase();
  const kgMatch = t.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) return parseFloat(kgMatch[1].replace(',', '.')) || 1;
  if (/\b1000\s*g\b/.test(t) || /\b1\s*kg\b/.test(t)) return 1;
  if (/\b500\s*g\b/.test(t)) return 0.5;
  if (/\b2\.5\s*kg\b/.test(t) || /\b2500\s*g\b/.test(t)) return 2.5;
  return 1;
}
