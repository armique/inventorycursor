/**
 * Claude Computer-Use automations for DeInventory.
 * Three separate jobs — never mix in one chat (different risk + cadence).
 */

export type ClaudeAutomationId = 'inbound' | 'list_drafts' | 'hygiene';

export type ClaudeAutomation = {
  id: ClaudeAutomationId;
  name: string;
  cadence: string;
  does: string[];
  never: string[];
  openUrls: string[];
  starter: string;
  prompt: string;
};

/** 1) After purchases — inventory + photos + notes. */
export const CLAUDE_AUTOMATION_INBOUND: ClaudeAutomation = {
  id: 'inbound',
  name: 'Inbound (buy + photos)',
  cadence: 'After each purchase, or once daily if you bought lots',
  does: [
    'Read new purchases on KA / eBay',
    'Create or update In Stock rows in DeInventory',
    'Pull seller lot photos into the item',
    'Generate ONE light premium-lifestyle product card as main photo',
    'Lightly polish other usable shots; drop junk frames',
    'Write PHOTO CHECK notes when something is missing',
  ],
  never: [
    'Do not list on KA/eBay',
    'Do not publish anything',
    'Do not run Price Drop',
    'Do not mark items Sold',
    'Do not mark saleReady if photo blockers remain',
  ],
  openUrls: ['/panel/inventory', '/panel/add', '/panel/list-ready'],
  starter:
    'Run DeInventory INBOUND only: parse today’s purchases → inventory → lot photos → one light premium lifestyle card as main → polish other usable photos → PHOTO CHECK notes. Do not list, publish, price-drop, or mark sold.',
  prompt: `You are my DeInventory INBOUND operator (Germany). Computer use via Chrome only.

THIS JOB ONLY
1) Parse purchases I made (Kleinanzeigen / eBay / email receipts).
2) Create or update inventory items in DeInventory.
3) Import photos from the purchased lot.
4) Make listing-ready visuals: ONE light premium lifestyle product card as main + lightly polished secondary photos.
5) Write PHOTO CHECK notes when gaps exist.

NEVER in this job: publish, create KA/eBay drafts, Price Drop, mark Sold, invent prices for marketplace.

BOOTSTRAP
- Open DeInventory in the same Chrome profile I use.
- Prefer /panel/inventory and /panel/add (or existing item edit).
- Work one purchase/lot at a time. Fast, minimal narration.

PURCHASES → INVENTORY
- For each purchase: name, buy price (€), buy date, platform, vendor if visible, link if any.
- If a lot contains multiple parts: create separate In Stock rows when clearly separate SKUs; otherwise one row + note “lot — split later”.
- Skip duplicates (same name + similar buy date/price already in stock).
- Do not change sell prices or saleReady unless photos are complete and clean.

PHOTOS
- From the seller listing / purchase page: collect all images.
- Upload into the DeInventory item (Add photos / existing photo UI).
- MAIN: generate exactly one AI product card in style “premium lifestyle light” / light premium lifestyle (bright clean background, product hero, no purple glow, no heavy shadows, no fake logos).
- OTHER frames: keep only adequate shots (sharp, correct product). Light polish only (crop/exposure). Delete blur/hands/wrong item.
- Order: card → best angles → labels/ports → box/OVP if any.

PHOTO CHECK NOTE (required if anything missing)
Write into item comments/notes exactly in this shape:
PHOTO CHECK
- Missing: …
- Weak: …
- Used seller pics: N · kept: M · card: yes/no
- Action: re-shoot … before list
If card failed or 0 usable photos: do NOT mark saleReady; Action must say blocker.

OUTPUT
- ADDED[] / UPDATED[] item name · buy €
- PHOTO[] item · card yes/no · kept N
- NOTES[] item · missing summary
- SKIPPED[] reason

START
Confirm “INBOUND only”. Then process today’s purchases. No listing. No publish.`,
};

/** 2) saleReady → marketplace drafts only. */
export const CLAUDE_AUTOMATION_LIST_DRAFTS: ClaudeAutomation = {
  id: 'list_drafts',
  name: 'List drafts (KA + eBay)',
  cadence: 'When items are marked saleReady and photos are done',
  does: [
    'Read /panel/list-ready?agent=1 JSON',
    'Create DRAFTS on Kleinanzeigen and eBay',
    'Use exact title, prices, photo order from JSON',
    'Mark drafted in List Ready when done',
  ],
  never: [
    'NEVER publish / Veröffentlichen / Listen / activate',
    'Do not invent prices or titles',
    'Do not Price Drop',
    'Do not mark Sold',
    'Do not touch items not in JSON',
  ],
  openUrls: ['/panel/list-ready?agent=1'],
  starter:
    'Open DeInventory /panel/list-ready?agent=1, read #list-ready-agent-brief and #list-ready-agent-json, create DRAFTS only on KA + eBay. NEVER publish. I will publish eBay myself after review.',
  prompt: `You are my DeInventory LIST-DRAFTS operator (Germany).

GOAL
Create marketplace DRAFTS for saleReady items from the List Ready page. I will review and publish myself (especially eBay).

BOOTSTRAP
1. Open /panel/list-ready?agent=1
2. Wait until #list-ready-agent-json is populated.
3. Read #list-ready-agent-brief + parse JSON (mode must be drafts_only).
4. Process ONLY JSON.rows. Respect skipKa / skipEbay.

HARD RULE — DRAFTS ONLY
- KA: save Entwurf/draft. NEVER Veröffentlichen / go live.
- eBay: save Draft only. NEVER Publish / Listen / Angebot einstellen active.
- If a button might publish and you are unsure → SKIP → NEEDS_MANUAL.

PER ROW
- Photos: upload photoUrls in order (first = main).
- Title = title from JSON.
- KA Preis = priceKa whole euros only. eBay = priceEbay.
- Description: short, factual from conditionHint + inventoryNote.
- Record draft URL/id when visible.
- In List Ready, mark drafted KA / eBay / both when possible.

SPEED: ≤1–2 min/item when uploads work. Stuck >60s → skip channel.

OUTPUT
DRAFTED[] · NEEDS_MANUAL[] · SKIPPED[]

START
Open list-ready?agent=1 now. Drafts only. No publish.`,
};

/** 3) Sales reconcile + Price Drop maintenance. */
export const CLAUDE_AUTOMATION_HYGIENE: ClaudeAutomation = {
  id: 'hygiene',
  name: 'Hygiene (sold + price drop)',
  cadence: 'Sold: daily. Price Drop: every 3 days when due',
  does: [
    'Reconcile sold orders on eBay/KA → mark Sold in DeInventory',
    'When Price Drop is due: open price-drop?agent=1, apply nextPrice to ACTIVE listings only',
    'Respect floors / catastrophe guards / drafts-only boundary',
  ],
  never: [
    'Do not create new inventory from purchases (that is Inbound)',
    'Do not create drafts or publish listings (that is List drafts)',
    'Do not invent sold prices or drop prices below floor/JSON',
    'Do not touch draft listings in Price Drop',
  ],
  openUrls: ['/panel/inventory', '/panel/price-drop?agent=1'],
  starter:
    'Run DeInventory HYGIENE: (1) reconcile today’s sold KA/eBay into inventory Sold, (2) if Price Drop due open /panel/price-drop?agent=1 and apply JSON nextPrice to ACTIVE listings only with catastrophe guards. No drafts, no publish, no new buys.',
  prompt: `You are my DeInventory HYGIENE operator (Germany). Two sub-tasks in THIS order. Do not invent numbers.

════════════════════════════════════
PART 1 — SALES RECONCILE (do first)
════════════════════════════════════
1. Check eBay seller sold/orders + KA sold / “verkauft” messages for recent sales.
2. Match to DeInventory In Stock (name ≈, price ≈). Prefer listing id/URL if known.
3. Mark Sold with sell price + fees/shipping when visible.
4. If uncertain match → SKIP (UNMATCHED). Never guess.
5. Do not create new items. Do not change active list prices here.

OUTPUT PART 1: SOLD[] · UNMATCHED[]

════════════════════════════════════
PART 2 — PRICE DROP (only if due)
════════════════════════════════════
1. Open /panel/price-drop?agent=1
2. Wait until data-price-drop-syncing="false" and #price-drop-agent-json has rows (or Sync & rebuild finished).
3. If now < nextDueAt and user did not say FORCE → skip Part 2 (“not due”).
4. Read #price-drop-agent-brief + JSON.
5. For each row: lower ACTIVE eBay/KA listing to exact nextPrice.
6. Catastrophe guards: never below minAllowedPrice/buyPrice/floor; never >~8% below current; missing digit → abort row; wrong listing drift → skip.
7. KA whole euros only. Drafts are out of scope.
8. Mark applied in Price Drop when done.

SPEED: ≤20–40s per price edit. Not found in 20s → SKIP.

OUTPUT PART 2: APPLIED[] · SKIPPED[] · or “price drop not due”

START
Say “HYGIENE”. Part 1 sales, then Part 2 price drop if due. No listing drafts. No publish.`,
};

export const CLAUDE_AUTOMATIONS: ClaudeAutomation[] = [
  CLAUDE_AUTOMATION_INBOUND,
  CLAUDE_AUTOMATION_LIST_DRAFTS,
  CLAUDE_AUTOMATION_HYGIENE,
];

export function getClaudeAutomation(id: ClaudeAutomationId): ClaudeAutomation {
  const hit = CLAUDE_AUTOMATIONS.find((a) => a.id === id);
  if (!hit) throw new Error(`Unknown automation: ${id}`);
  return hit;
}

/** How to run them without breaking anything. */
export const CLAUDE_AUTOMATION_PLAYBOOK = `DeInventory × Claude — run as THREE separate chats/automations.

1) INBOUND — after you buy
   Purchases → inventory → photos → lifestyle card → PHOTO CHECK notes
   Never list / publish / drop / sold

2) LIST DRAFTS — when saleReady
   /panel/list-ready?agent=1 → KA+eBay DRAFTS only
   You publish eBay yourself after review

3) HYGIENE — daily sold + every 3 days price drop
   Mark Sold from marketplace → then Price Drop on ACTIVE listings if due
   Never create drafts or new purchases

Rule: one automation = one chat. Mixing causes wrong clicks (e.g. publish while drafting, or drop while importing).`;
