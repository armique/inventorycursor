/**
 * Detects "1 working, 1 defekt" (or "defekt sold for €N") phrasing in an item's name — a lot
 * that was never split into separate rows, so a real order for just the faulty half has
 * nothing to link to. Suggest-only: this never mutates anything itself, it just tells the
 * match picker whether to offer a pre-filled split suggestion (utils/splitParts.ts does the
 * actual draft-building once the user confirms).
 */

export type WorkingDefektDetection = {
  /** Explicit price the defekt part was said to go for, if the title mentions one. */
  defektPriceEur?: number;
};

const WORKING_RE = /\b(\d+)?\s*x?\s*(funktioniert|working|intakt)\b/i;
const DEFEKT_WORD = '(?:defekt\\w*|defective|kaputt|broken)';
const DEFEKT_RE = new RegExp(`\\b(\\d+)?\\s*x?\\s*${DEFEKT_WORD}\\b`, 'i');
/** Any €-adjacent number in the title — "defekt für 15€" / "defective for €20" / "20€ kaputt".
 *  Only consulted once both WORKING_RE and DEFEKT_RE already matched, so these short listing
 *  titles realistically only mention one price and proximity-matching isn't worth the fragility. */
const MONEY_NEAR_EUR_RE = /€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*€/;

export function detectWorkingDefektSplit(name: string): WorkingDefektDetection | null {
  const n = (name || '').trim();
  if (!n) return null;
  if (!WORKING_RE.test(n) || !DEFEKT_RE.test(n)) return null;

  const priceMatch = MONEY_NEAR_EUR_RE.exec(n);
  const raw = priceMatch ? priceMatch[1] || priceMatch[2] : undefined;
  const defektPriceEur = raw ? parseFloat(raw.replace(',', '.')) : undefined;

  return {
    defektPriceEur: defektPriceEur != null && Number.isFinite(defektPriceEur) ? defektPriceEur : undefined,
  };
}
