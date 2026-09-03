/**
 * Title quantity helpers (Part C Rule 11).
 *
 * quantityFromTitle — may guess (pre-fill only).
 * statedQuantity — number only when the title says so outright; enforce only this.
 */
export type SplitPartHint = {
  key: string;
  label?: string;
  /** e.g. 'ram_stick' | 'fan' | 'cable' */
  kind?: string;
};

/** Guess for pre-filling. May infer. Never use to refuse a split. */
export function quantityFromTitle(part: SplitPartHint, title: string): number | undefined {
  const stated = statedQuantity(part, title);
  if (stated != null) return stated;

  const t = String(title || '');
  const kind = (part.kind || part.key || '').toLowerCase();

  // Soft inference only — e.g. 360mm AIO often means 3 fans.
  if (kind.includes('fan')) {
    if (/\b360\b/.test(t)) return 3;
    if (/\b240\b|\b280\b/.test(t)) return 2;
    if (/\b120\b|\b140\b/.test(t)) return 1;
    if (/\b420\b/.test(t)) return 3;
  }
  return undefined;
}

/**
 * Returns a number only when the title states it outright.
 * Examples: 2x16GB → 2 sticks; 360mm radiator → 3 fans; "x8/SSD" → 8.
 */
export function statedQuantity(part: SplitPartHint, title: string): number | undefined {
  const t = String(title || '').trim();
  if (!t) return undefined;
  const kind = (part.kind || part.key || part.label || '').toLowerCase();

  const clamp = (n: number): number | undefined =>
    Number.isFinite(n) && n >= 1 && n <= 48 ? Math.floor(n) : undefined;

  // Explicit Nx / xN for sticks / identical lots.
  if (kind.includes('ram') || kind.includes('stick') || kind.includes('identical') || kind.includes('lot')) {
    const kit = t.match(/\b(\d{1,2})\s*[x×]\s*\d+\s*gb\b/i);
    if (kit) return clamp(Number(kit[1]));
    const leading = t.match(/^x\s*(\d{1,2})\s*\//i);
    if (leading) return clamp(Number(leading[1]));
    const trailing = t.match(/\b[x×]\s*(\d{1,2})\b/i);
    if (trailing) return clamp(Number(trailing[1]));
    const prefix = t.match(/\b(\d{1,2})\s*[x×]\b/i);
    if (prefix) return clamp(Number(prefix[1]));
  }

  if (kind.includes('fan')) {
    const explicitFans = t.match(/\b(\d{1,2})\s*[x×]?\s*(?:l[uü]fter|fans?)\b/i);
    if (explicitFans) return clamp(Number(explicitFans[1]));
    // Radiator size states fan count in AIO conventions.
    if (/\b360\s*mm\b|\b360\b/.test(t) && /\b(aio|liquid|wasser|cooler|radiator|rad)\b/i.test(t)) {
      return 3;
    }
    if (/\b240\s*mm\b|\b280\s*mm\b|\b240\b|\b280\b/.test(t) && /\b(aio|liquid|wasser|cooler|radiator|rad)\b/i.test(t)) {
      return 2;
    }
  }

  if (kind.includes('cable')) {
    const m = t.match(/\b(\d{1,2})\s*[x×]\s*(?:sata|molex|pcie|eps|cable|kabel)/i);
    if (m) return clamp(Number(m[1]));
  }

  return undefined;
}

/** Assert both agree wherever both speak — used by tests. */
export function quantityHelpersAgree(part: SplitPartHint, title: string): boolean {
  const stated = statedQuantity(part, title);
  if (stated == null) return true;
  const guessed = quantityFromTitle(part, title);
  return guessed === stated;
}
