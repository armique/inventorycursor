/**
 * eBay DE Sold Pulse — filtered sold-search URLs + local watchlist.
 * Prices are entered by you after looking at real eBay sold results (AI is optional helper only).
 */

export const SOLD_PULSE_STORAGE_KEY = 'ebay_sold_pulse_watchlist_v1';

export type SoldPulseCategory =
  | 'GPU'
  | 'CPU'
  | 'RAM'
  | 'SSD'
  | 'Motherboard'
  | 'PSU'
  | 'Cooler'
  | 'Case'
  | 'Other';

export type SoldPulseWatchItem = {
  id: string;
  query: string;
  category: SoldPulseCategory;
  /** Optional note to yourself */
  note?: string;
  /** Your read of the market after opening eBay sold (buyer-paid euros). */
  low?: number;
  median?: number;
  high?: number;
  lastCheckedAt?: string;
  createdAt: string;
};

export type SoldPulseLinkKind = 'used_bin' | 'used_all' | 'for_parts';

/**
 * Minus-words baked into working-goods sold searches so results skew to
 * standalone, non-faulty parts (Defekt / bundles / PCs filtered in the query).
 */
export const SOLD_PULSE_WORKING_EXCLUDES: readonly string[] = [
  'defekt',
  'bastler',
  'defective',
  'kaputt',
  'fürteile',
  'fuerteile',
  'ersatzteil',
  'forparts',
  'for parts',
  'bundle',
  'komplettsystem',
  'gamingpc',
  'gaming pc',
  'allinone',
  'all in one',
  'mining',
  'schrott',
];

function excludeToken(word: string): string {
  return /\s/.test(word) ? `-"${word}"` : `-${word}`;
}

/** Query text for eBay: user terms + working-goods excludes (unless for_parts). */
export function buildSoldPulseSearchQuery(
  query: string,
  kind: SoldPulseLinkKind = 'used_bin'
): string {
  const base = query.trim().replace(/\s+/g, ' ');
  if (!base) return '';
  if (kind === 'for_parts') return base;

  const lower = base.toLowerCase();
  const extras = SOLD_PULSE_WORKING_EXCLUDES.filter((w) => {
    const token = excludeToken(w).toLowerCase();
    return !lower.includes(token) && !lower.includes(`-${w.toLowerCase()}`);
  }).map(excludeToken);

  return extras.length ? `${base} ${extras.join(' ')}` : base;
}

/** Starter PC-part queries — edit/delete freely in the UI. */
export const DEFAULT_SOLD_PULSE_PRESETS: Array<Pick<SoldPulseWatchItem, 'query' | 'category'>> = [
  { query: 'RTX 3060 12GB', category: 'GPU' },
  { query: 'RTX 4060', category: 'GPU' },
  { query: 'RX 6600', category: 'GPU' },
  { query: 'Ryzen 5 5600', category: 'CPU' },
  { query: 'Ryzen 5 5600X', category: 'CPU' },
  { query: 'Core i5-12400F', category: 'CPU' },
  { query: 'DDR4 32GB Kit', category: 'RAM' },
  { query: 'DDR5 32GB Kit', category: 'RAM' },
  { query: '1TB NVMe SSD', category: 'SSD' },
  { query: 'B550 Motherboard', category: 'Motherboard' },
  { query: '850W 80+ Gold PSU', category: 'PSU' },
];

export function buildEbaySoldUrl(query: string, kind: SoldPulseLinkKind = 'used_bin'): string {
  const q = buildSoldPulseSearchQuery(query, kind);
  const params = new URLSearchParams();
  params.set('_nkw', q);
  params.set('LH_Sold', '1');
  params.set('LH_Complete', '1');
  // Newest sold first — scroll for ~last month of sales
  params.set('_sop', '13');
  // More rows per page so you can copy a full month sample, not 2–3
  params.set('_ipg', '240');

  if (kind === 'for_parts') {
    // 7000 = for parts / not working
    params.append('LH_ItemCondition', '7000');
  } else {
    // 3000 = Used (Gebraucht)
    params.append('LH_ItemCondition', '3000');
    if (kind === 'used_bin') {
      // Buy It Now only — fewer weird auction outliers
      params.set('LH_BIN', '1');
    }
  }

  return `https://www.ebay.de/sch/i.html?${params.toString()}`;
}

/** Checklist copied when opening a clean sold search (manual month sample). */
export function buildSoldPulseChecklist(
  query: string,
  kind: SoldPulseLinkKind = 'used_bin'
): string {
  const url = buildEbaySoldUrl(query, kind);
  const label =
    kind === 'for_parts'
      ? 'For parts / Defekt'
      : kind === 'used_all'
        ? 'Used + auctions (clean)'
        : 'Used + Buy It Now (clean)';
  return [
    `Sold Pulse — ${query}`,
    `Link (${label}):`,
    url,
    '',
    'Checklist:',
    '1. Page should already be Sold + Completed, Used, newest first, 240/page.',
    '2. Scroll ~1 month of “Verkauft …” dates (not just the top 2–3).',
    '3. Skip wrong models / OVP unicorns / lots still in the list.',
    '4. Select a big block of titles + € prices (aim 15–30).',
    '5. Copy → paste into Sold Pulse → Read paste → Save.',
  ].join('\n');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function loadSoldPulseWatchlist(): SoldPulseWatchItem[] {
  try {
    const raw = localStorage.getItem(SOLD_PULSE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.id === 'string' && typeof x.query === 'string');
  } catch {
    return [];
  }
}

export function saveSoldPulseWatchlist(items: SoldPulseWatchItem[]): void {
  localStorage.setItem(SOLD_PULSE_STORAGE_KEY, JSON.stringify(items.slice(0, 80)));
}

export function seedSoldPulsePresetsIfEmpty(): SoldPulseWatchItem[] {
  const existing = loadSoldPulseWatchlist();
  if (existing.length > 0) return existing;
  const now = new Date().toISOString();
  const seeded: SoldPulseWatchItem[] = DEFAULT_SOLD_PULSE_PRESETS.map((p, i) => ({
    id: `preset-${i}-${Date.now()}`,
    query: p.query,
    category: p.category,
    createdAt: now,
  }));
  saveSoldPulseWatchlist(seeded);
  return seeded;
}

export function upsertSoldPulseItem(
  list: SoldPulseWatchItem[],
  patch: Partial<SoldPulseWatchItem> & { query: string; category: SoldPulseCategory }
): SoldPulseWatchItem[] {
  const q = patch.query.trim();
  if (!q) return list;
  const now = new Date().toISOString();
  const id = patch.id || `pulse-${Date.now()}`;
  const existingIdx = list.findIndex((x) => x.id === id || x.query.toLowerCase() === q.toLowerCase());
  const nextItem: SoldPulseWatchItem = {
    id,
    query: q,
    category: patch.category,
    note: patch.note,
    low: patch.low,
    median: patch.median,
    high: patch.high,
    lastCheckedAt: patch.lastCheckedAt,
    createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
  };
  if (existingIdx >= 0) {
    const copy = [...list];
    copy[existingIdx] = { ...list[existingIdx], ...nextItem, id: list[existingIdx].id };
    saveSoldPulseWatchlist(copy);
    return copy;
  }
  const next = [nextItem, ...list];
  saveSoldPulseWatchlist(next);
  return next;
}

export function removeSoldPulseItem(list: SoldPulseWatchItem[], id: string): SoldPulseWatchItem[] {
  const next = list.filter((x) => x.id !== id);
  saveSoldPulseWatchlist(next);
  return next;
}

export function markSoldPulseChecked(
  list: SoldPulseWatchItem[],
  id: string,
  prices?: { low?: number; median?: number; high?: number; note?: string }
): SoldPulseWatchItem[] {
  const now = new Date().toISOString();
  const next = list.map((x) =>
    x.id === id
      ? {
          ...x,
          lastCheckedAt: now,
          ...(prices?.low != null ? { low: prices.low } : {}),
          ...(prices?.median != null ? { median: prices.median } : {}),
          ...(prices?.high != null ? { high: prices.high } : {}),
          ...(prices?.note != null ? { note: prices.note } : {}),
        }
      : x
  );
  saveSoldPulseWatchlist(next);
  return next;
}

/** Pull euro amounts from pasted eBay sold text / titles. */
export function extractPricesFromPaste(text: string): number[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const found: number[] = [];
  // 123,45 € | €123.45 | EUR 99 | 99€
  const re =
    /(?:EUR|€)\s*(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|EUR)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const token = (m[1] || m[2] || '').replace(',', '.');
    const n = Number(token);
    if (Number.isFinite(n) && n >= 5 && n <= 5000) found.push(Math.round(n * 100) / 100);
  }
  return found;
}

export function summarizePriceList(prices: number[]): {
  count: number;
  low: number;
  high: number;
  median: number;
  average: number;
} | null {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  // Drop extreme outliers (top/bottom 10%) when we have enough samples
  let use = sorted;
  if (sorted.length >= 8) {
    const trim = Math.floor(sorted.length * 0.1);
    use = sorted.slice(trim, sorted.length - trim || sorted.length);
  }
  if (!use.length) use = sorted;
  const mid = Math.floor(use.length / 2);
  const median = use.length % 2 ? use[mid] : (use[mid - 1] + use[mid]) / 2;
  const average = use.reduce((s, p) => s + p, 0) / use.length;
  return {
    count: use.length,
    low: Math.round(use[0] * 100) / 100,
    high: Math.round(use[use.length - 1] * 100) / 100,
    median: Math.round(median * 100) / 100,
    average: Math.round(average * 100) / 100,
  };
}

export function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

export function sortWatchlistForCheck(items: SoldPulseWatchItem[]): SoldPulseWatchItem[] {
  return [...items].sort((a, b) => {
    const da = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
    const db = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
    return da - db; // never checked first
  });
}
