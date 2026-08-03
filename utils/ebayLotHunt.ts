/**
 * eBay Lot Hunt — Claude one-shot search: query + price band → filtered real listings on armiktech.
 * Like Dealwatch sourcing, but manual query + computer-use scrape (no publish / no buy).
 */
export const EBAY_LOT_HUNT_STORAGE_KEY = 'deinv_ebay_lot_hunt_v1';

export type EbayLotHuntQuery = {
  query: string;
  priceMin: number | null;
  priceMax: number | null;
  /** Soft cap of listings to keep after junk filter. */
  maxKeep: number;
  marketplace: 'ebay.de';
  /** Optional: only Buy It Now / auction / both */
  listingType: 'all' | 'bin' | 'auction';
};

export type EbayLotHuntHit = {
  itemId: string;
  title: string;
  price: number;
  shipping: number | null;
  currency: 'EUR';
  url: string;
  condition: string;
  seller: string;
  thumbnailUrl?: string;
  /** Why this passed the junk filter */
  keptReason: string;
};

export type EbayLotHuntRejected = {
  title: string;
  reason: string;
  url?: string;
  price?: number;
};

export type EbayLotHuntRun = {
  id: string;
  createdAt: string;
  query: EbayLotHuntQuery;
  kept: EbayLotHuntHit[];
  rejectedCount: number;
  rejectedSamples: EbayLotHuntRejected[];
  notes: string;
};

type Store = {
  updatedAt: string;
  /** Active query Claude should hunt now */
  activeQuery: EbayLotHuntQuery;
  runs: EbayLotHuntRun[];
};

export const DEFAULT_EBAY_LOT_HUNT_QUERY: EbayLotHuntQuery = {
  query: '',
  priceMin: null,
  priceMax: null,
  maxKeep: 12,
  marketplace: 'ebay.de',
  listingType: 'all',
};

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(EBAY_LOT_HUNT_STORAGE_KEY);
    if (!raw) {
      return {
        updatedAt: new Date().toISOString(),
        activeQuery: { ...DEFAULT_EBAY_LOT_HUNT_QUERY },
        runs: [],
      };
    }
    const parsed = JSON.parse(raw) as Store;
    return {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      activeQuery: { ...DEFAULT_EBAY_LOT_HUNT_QUERY, ...(parsed.activeQuery || {}) },
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      activeQuery: { ...DEFAULT_EBAY_LOT_HUNT_QUERY },
      runs: [],
    };
  }
}

function saveStore(store: Store): void {
  localStorage.setItem(
    EBAY_LOT_HUNT_STORAGE_KEY,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }),
  );
}

export function loadEbayLotHuntQuery(): EbayLotHuntQuery {
  return loadStore().activeQuery;
}

export function saveEbayLotHuntQuery(query: EbayLotHuntQuery): void {
  const store = loadStore();
  store.activeQuery = {
    ...DEFAULT_EBAY_LOT_HUNT_QUERY,
    ...query,
    query: String(query.query || '').trim(),
    priceMin: query.priceMin != null && query.priceMin > 0 ? query.priceMin : null,
    priceMax: query.priceMax != null && query.priceMax > 0 ? query.priceMax : null,
    maxKeep: Math.max(3, Math.min(40, Math.round(query.maxKeep || 12))),
  };
  saveStore(store);
}

export function loadEbayLotHuntRuns(): EbayLotHuntRun[] {
  return loadStore().runs;
}

export function deleteEbayLotHuntRun(runId: string): void {
  const store = loadStore();
  store.runs = store.runs.filter((r) => r.id !== runId);
  saveStore(store);
}

export function clearEbayLotHuntRuns(): void {
  const store = loadStore();
  store.runs = [];
  saveStore(store);
}

function newRunId(): string {
  return `hunt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export type EbayLotHuntImportPayload = {
  query?: Partial<EbayLotHuntQuery>;
  kept: EbayLotHuntHit[];
  rejectedCount?: number;
  rejectedSamples?: EbayLotHuntRejected[];
  notes?: string;
};

function normalizeHit(raw: Partial<EbayLotHuntHit>, idx: number): EbayLotHuntHit | null {
  const url = String(raw.url || '').trim();
  const title = String(raw.title || '').trim();
  const price = Number(raw.price);
  if (!title || !url || !Number.isFinite(price) || price <= 0) return null;
  let itemId = String(raw.itemId || '').trim();
  if (!itemId) {
    const m = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/i) || url.match(/[?&]item=(\d{9,15})/i);
    itemId = m?.[1] || `unknown_${idx}`;
  }
  return {
    itemId,
    title: title.slice(0, 200),
    price: Math.round(price * 100) / 100,
    shipping:
      raw.shipping == null || raw.shipping === ('' as unknown)
        ? null
        : Number.isFinite(Number(raw.shipping))
          ? Math.round(Number(raw.shipping) * 100) / 100
          : null,
    currency: 'EUR',
    url,
    condition: String(raw.condition || '').trim().slice(0, 80),
    seller: String(raw.seller || '').trim().slice(0, 80),
    thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl).trim() : undefined,
    keptReason: String(raw.keptReason || 'passed junk filter').trim().slice(0, 240),
  };
}

/** Import Claude's JSON result as a new run (newest first). */
export function importEbayLotHuntPayload(
  payload: EbayLotHuntImportPayload,
  fallbackQuery?: EbayLotHuntQuery,
): EbayLotHuntRun {
  const store = loadStore();
  const q: EbayLotHuntQuery = {
    ...DEFAULT_EBAY_LOT_HUNT_QUERY,
    ...(fallbackQuery || store.activeQuery),
    ...(payload.query || {}),
  };
  q.query = String(q.query || '').trim();
  const kept = (payload.kept || [])
    .map((h, i) => normalizeHit(h, i))
    .filter((h): h is EbayLotHuntHit => Boolean(h))
    .slice(0, Math.max(3, Math.min(40, q.maxKeep || 12)));

  const run: EbayLotHuntRun = {
    id: newRunId(),
    createdAt: new Date().toISOString(),
    query: q,
    kept,
    rejectedCount: Math.max(0, Number(payload.rejectedCount) || 0),
    rejectedSamples: (payload.rejectedSamples || []).slice(0, 20).map((r) => ({
      title: String(r.title || '').slice(0, 160),
      reason: String(r.reason || '').slice(0, 200),
      url: r.url ? String(r.url) : undefined,
      price: r.price != null && Number.isFinite(Number(r.price)) ? Number(r.price) : undefined,
    })),
    notes: String(payload.notes || '').trim().slice(0, 1000),
  };

  store.runs = [run, ...store.runs].slice(0, 30);
  store.activeQuery = q;
  saveStore(store);
  return run;
}

export function buildEbaySearchUrl(query: EbayLotHuntQuery): string {
  const params = new URLSearchParams();
  params.set('_nkw', query.query.trim());
  params.set('_sacat', '0');
  params.set('LH_ItemCondition', '4'); // Used — Claude may widen if needed
  params.set('rt', 'nc');
  params.set('LH_PrefLoc', '1');
  if (query.priceMin != null) params.set('_udlo', String(Math.floor(query.priceMin)));
  if (query.priceMax != null) params.set('_udhi', String(Math.ceil(query.priceMax)));
  if (query.listingType === 'bin') params.set('LH_BIN', '1');
  if (query.listingType === 'auction') params.set('LH_Auction', '1');
  return `https://www.ebay.de/sch/i.html?${params.toString()}`;
}

export function exportEbayLotHuntAgentPayload(query: EbayLotHuntQuery): {
  mode: 'ebay_lot_hunt';
  marketplace: 'ebay.de';
  searchUrl: string;
  query: EbayLotHuntQuery;
  importTarget: string;
  safety: { rule: string };
} {
  return {
    mode: 'ebay_lot_hunt',
    marketplace: 'ebay.de',
    searchUrl: buildEbaySearchUrl(query),
    query: {
      ...query,
      query: query.query.trim(),
    },
    importTarget:
      'Paste results JSON into #ebay-hunt-results-paste on /panel/ebay-hunt?agent=1 then click Import results',
    safety: {
      rule: 'Search + filter only. Do not buy, bid, message sellers, or list. One run per click.',
    },
  };
}

export const CLAUDE_EBAY_LOT_HUNT_STARTER = `Open DeInventory /panel/ebay-hunt?agent=1, read #ebay-hunt-agent-brief and #ebay-hunt-agent-json, hunt ebay.de for the query (price min/max), filter junk lots, paste kept listings JSON into #ebay-hunt-results-paste and click Import results. Do not buy or message sellers.`;

export const CLAUDE_EBAY_LOT_HUNT_PROMPT = `You are my DeInventory eBay LOT HUNT operator (Germany). Computer use via Chrome. ONE run = ONE click / ONE chat turn goal.

GOAL
Find real, buyable eBay.de listings for the product I configured on armiktech (DeInventory Lot Hunt page). Filter out junk / misleading lots. Import the clean list back into DeInventory with title, price, link.

THIS JOB ONLY
- Search ebay.de
- Filter junk
- Import results JSON into DeInventory Lot Hunt
NEVER: buy, bid, make offer, message sellers, checkout, list, price-drop, inventory inbound, publish.

BOOTSTRAP (every run)
1. Open Chrome (same profile as DeInventory / armiktech).
2. Go to: /panel/ebay-hunt?agent=1
3. Read #ebay-hunt-agent-brief and parse #ebay-hunt-agent-json.
4. If query.query is empty → STOP and say “set query + price on Lot Hunt page first”.
5. Use JSON.searchUrl as the starting search (or rebuild the same filters on ebay.de).
6. Work ONLY this hunt. Ignore other automations.

SEARCH
- Marketplace: ebay.de
- Keywords = query.query (exact product intent: model / part type)
- Price: _udlo = priceMin, _udhi = priceMax when set
- Prefer Used / Gebraucht unless the query clearly asks neu/OVP-neu
- Scan the first 2–4 result pages OR until you have enough KEEP candidates (maxKeep from JSON, default 12)
- Open a listing only when the SERP card is ambiguous (to confirm model / what’s included)

JUNK FILTER — REJECT (do not keep)
- Wrong product / wrong generation / wrong capacity (e.g. RTX 3060 when query is 3070; 8GB when query is 16GB kit)
- Mixed Konvolut / mystery lots where the queried item is not clearly the main sellable unit
- Empty box / only accessories / screws / cables / bracket / IO-Blende alone when query is a full part
- “Defekt / for parts / Bastler / gerissen / Wasserschaden” unless query explicitly wants defect
- Digital items, licenses, accounts, PDFs
- Obvious spam, replicas, “inspired by”, fake model numbers
- Completely unrelated category (tools, clothing, etc.)
- Bundle/PC that buries the part with no clear extractable value matching the query
- Price outside band (including shipping if shipping is required and pushes total far past max — note it)
- Duplicate same itemId

KEEP — only real matching goods
- Title/model clearly matches the hunt intent
- Photos look like the actual product
- Price (+ shipping if shown) inside min/max when set
- Condition readable
- Direct item URL (ebay.de/itm/…)

OUTPUT TO IMPORT (required)
Build ONE JSON object (no markdown fences) shaped like:
{
  "query": { "query": "...", "priceMin": 0, "priceMax": 0, "maxKeep": 12 },
  "kept": [
    {
      "itemId": "123456789012",
      "title": "...",
      "price": 49.00,
      "shipping": 5.49,
      "currency": "EUR",
      "url": "https://www.ebay.de/itm/...",
      "condition": "Gebraucht",
      "seller": "...",
      "thumbnailUrl": optional,
      "keptReason": "exact model · price in band · clear photos"
    }
  ],
  "rejectedCount": 37,
  "rejectedSamples": [
    { "title": "...", "reason": "konvolut mixed", "url": "...", "price": 20 }
  ],
  "notes": "short summary"
}
Rules: kept.length ≤ maxKeep; prices as numbers; urls absolute https.

IMPORT BACK TO ARMIKTECH
1. Return to /panel/ebay-hunt?agent=1
2. Paste the JSON into #ebay-hunt-results-paste
3. Click the button “Import results” (or press the Import control)
4. Confirm the new run appears in the list with links

SPEED
- Target ≤8–12 minutes for a full run
- Minimal narration; one-line progress
- If captcha / login wall → STOP and ask me once

OUTPUT CHAT SUMMARY
KEPT n · REJECTED n · query · price band
Then list kept titles + prices + urls briefly.

START
Open /panel/ebay-hunt?agent=1 now. Read brief + JSON. Hunt once. Import. Do not buy.
`;
