import type { InventoryItem } from '../types';

/**
 * Fix UTF-8 mojibake: text that was stored as UTF-8 but was at some point
 * interpreted as Latin-1/Windows-1252 (e.g. "Ð¢Ð¾Ñ‚Ð°Ð»" → "Тотал").
 * Only applies fix when the decoded result contains Cyrillic or other
 * typical "recovered" characters so we don't break already-correct text.
 */
function decodeUtf8FromLatin1(str: string): string {
  if (typeof str !== 'string' || !str) return str;
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      bytes[i] = c > 255 ? 0x3f : c; // replace non-Latin-1 with ?
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return str;
  }
}

/** Returns true if string looks like it could be fixed (has typical mojibake bytes). */
function looksLikeMojibake(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x80 && c <= 0xBF) return true; // common in UTF-8-as-Latin1
    if (c >= 0xC0 && c <= 0xFF) return true;
  }
  return false;
}

/** Returns true if string contains Cyrillic letters. */
function hasCyrillic(str: string): boolean {
  return /[\u0400-\u04FF]/.test(str);
}

/** Returns true if string contains Latin extended (e.g. ü, ö, ß, ñ) — typical after fixing German/Spanish etc. */
function hasLatinExtended(str: string): boolean {
  return /[\u00C0-\u024F\u1E00-\u1EFF]/.test(str);
}

/**
 * Fix a single string if it appears to be UTF-8 mojibake.
 * Applies when decoding yields Cyrillic, Latin extended (ü, ß, etc.), or CJK.
 */
export function fixStringEncoding(str: string): string {
  if (typeof str !== 'string' || !str.trim()) return str;
  if (!looksLikeMojibake(str)) return str;
  const decoded = decodeUtf8FromLatin1(str);
  if (decoded === str) return str;
  if (hasCyrillic(decoded)) return decoded;
  if (hasLatinExtended(decoded)) return decoded; // German ü, ß, etc.
  if (/[\u4e00-\u9fff]/.test(decoded)) return decoded; // CJK
  return str;
}

/**
 * Fix encoding on all text fields of an item (name, vendor, comments, spec string values).
 * Returns a new item; does not mutate.
 */
export function fixItemEncoding(item: InventoryItem): InventoryItem {
  const name = fixStringEncoding(item.name);
  const vendor = item.vendor ? fixStringEncoding(item.vendor) : undefined;
  const comment1 = item.comment1 ? fixStringEncoding(item.comment1) : '';
  const comment2 = item.comment2 ? fixStringEncoding(item.comment2) : '';
  let specs = item.specs;
  if (specs && typeof specs === 'object') {
    const next: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(specs)) {
      if (typeof v === 'string') next[k] = fixStringEncoding(v);
      else next[k] = v;
    }
    specs = next;
  }
  return {
    ...item,
    name,
    vendor,
    comment1,
    comment2,
    specs,
  };
}

/**
 * Fix encoding for an array of items. Returns new array; does not mutate.
 */
export function fixItemsEncoding(items: InventoryItem[]): InventoryItem[] {
  return items.map((i) => fixItemEncoding(i));
}
