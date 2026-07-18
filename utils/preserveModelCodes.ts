/**
 * Keep manufacturer part numbers / model codes when AI rewrites a product name.
 * Example: "CMK8GX4M1A2400C14" must survive a rename to "Corsair Vengeance LPX 8GB DDR4…".
 */

const CAPACITY_OR_SPEED = /^(?:\d+(?:GB|TB|MB|MHz|MT\/?s|W|V)|DDR[2345]|PC[34]-?\d+|CL\d+(?:[-.]\d+){0,3})$/i;

/** Tokens that look like manufacturer P/Ns or SKUs (letters + digits, not capacity/speed). */
export function extractProductModelCodes(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  const matches = trimmed.match(/[A-Za-z][A-Za-z0-9._/-]*\d[A-Za-z0-9._/-]*/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const code = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (code.length < 5) continue;
    if (!/[A-Za-z]/.test(code) || !/\d/.test(code)) continue;
    if (CAPACITY_OR_SPEED.test(code)) continue;
    // Skip soft marketing fragments like "i7-4790" is actually useful — keep CPU models too
    // Skip year-ish or pure short mixes without enough structure
    if (/^\d{4}[A-Za-z]?$/i.test(code)) continue;

    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }

  return out;
}

function nameHasCode(name: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i').test(name);
}

/**
 * Merge AI standardized name with model codes from the original typed name.
 * If AI returns nothing useful, keep the original name.
 */
export function ensureModelCodesInName(
  originalName: string,
  standardizedName?: string | null
): string {
  const original = (originalName || '').trim();
  const standardized = (standardizedName || '').trim();
  if (!original) return standardized;
  if (!standardized) return original;

  // Same text (ignoring case/spacing) — keep original casing from typed input if it was the P/N
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(original) === norm(standardized)) return original;

  const codes = extractProductModelCodes(original);
  if (!codes.length) return standardized;

  let result = standardized;
  for (const code of codes) {
    if (nameHasCode(result, code)) continue;
    result = `${result} ${code}`;
  }
  return result.replace(/\s+/g, ' ').trim();
}
