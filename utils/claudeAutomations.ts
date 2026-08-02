/**
 * Claude Computer-Use automations for DeInventory / armiktech.
 * ONE automation = ONE Claude chat. Never mix jobs.
 */
import {
  CLAUDE_EBAY_LOT_HUNT_PROMPT,
  CLAUDE_EBAY_LOT_HUNT_STARTER,
} from './ebayLotHunt';

export type ClaudeAutomationId =
  | 'inbound'
  | 'list_drafts'
  | 'hygiene'
  | 'ebay_hunt';

export type ClaudeAutomation = {
  id: ClaudeAutomationId;
  number: number;
  name: string;
  cadence: string;
  does: string[];
  never: string[];
  /** Page Claude must open and read (agent brief lives there). */
  openUrls: string[];
  starter: string;
  prompt: string;
};

/** Universal: tell Claude to open the hub and follow what's on the page. */
export const CLAUDE_HUB_STARTER = `Open DeInventory /panel/automations?agent=1, read #claude-automations-playbook and #claude-automations-setup. Create a SEPARATE Claude automation/chat for EACH job listed (never mix). For the job I name, open that job’s URL (?agent=1), read its brief + JSON on the page, and execute ONLY that job.`;

/** 1) After purchases — inventory + photos + listing text. */
export const CLAUDE_AUTOMATION_INBOUND: ClaudeAutomation = {
  id: 'inbound',
  number: 1,
  name: 'Inbound (buy + photos + listing text)',
  cadence: 'After each purchase, or once daily if you bought lots',
  does: [
    'Read new purchases on KA / eBay',
    'Create or update In Stock rows in DeInventory',
    'Pull seller lot photos into the item (stored on the item — imageUrls)',
    'Generate ONE light premium-lifestyle product card as main photo',
    'Lightly polish other usable shots; drop junk frames',
    'Generate marketTitle + marketDescription on the item (listing checklist)',
    'Write PHOTO CHECK notes when something is missing',
  ],
  never: [
    'Do not list on KA/eBay',
    'Do not publish anything',
    'Do not create marketplace drafts (that is List drafts)',
    'Do not run Price Drop or Lot Hunt',
    'Do not mark items Sold',
    'Do not mark List Ready / saleReady unless title + description + photos are all done',
  ],
  openUrls: ['/panel/automations?agent=1&job=inbound', '/panel/inventory', '/panel/add'],
  starter:
    'Open DeInventory /panel/automations?agent=1&job=inbound, read the active job brief on that page, then run INBOUND only: purchases → inventory → photos → lifestyle card → marketTitle + marketDescription → PHOTO CHECK. No drafts, publish, price-drop, lot hunt, or sold.',
  prompt: `You are my DeInventory INBOUND operator (Germany). Computer use via Chrome only.

HOW YOU WERE STARTED
You should have opened /panel/automations?agent=1&job=inbound (or been given this job only).
Do NOT run other automations in this chat.

THIS JOB ONLY
1) Parse purchases I made (Kleinanzeigen / eBay / email receipts).
2) Create or update inventory items in DeInventory.
3) Import photos from the purchased lot onto the item (Add photos / item image fields). Photos live on the inventory item in DeInventory (Firebase URLs).
4) Make listing-ready visuals: ONE light premium lifestyle product card as main + lightly polished secondary photos.
5) Fill listing prep: marketTitle + marketDescription.
6) Write PHOTO CHECK notes when gaps exist.

LISTING PREP CHECKLIST (required before List Ready)
✓ marketTitle · ✓ marketDescription · ✓ ≥1 product photo
Leave List Ready OFF unless I ask and checklist is green.

NEVER: publish, KA/eBay drafts, Price Drop, Lot Hunt, mark Sold, invent marketplace prices.

BOOTSTRAP
- Prefer /panel/inventory and /panel/add.
- Work one purchase/lot at a time. Fast, minimal narration.

PHOTOS
- Upload into the item. MAIN = premium lifestyle light card. Order: card → angles → labels → OVP.

TITLE + DESCRIPTION
- Use Flags “Listing” button when available, or Listing Studio / write marketTitle + marketDescription.
- Default condition Gebraucht unless Defective.

OUTPUT: ADDED[] · PHOTO[] · LISTING[] · NOTES[] · SKIPPED[]

START
Confirm “INBOUND only”. Process today’s purchases.`,
};

/** 2) List Ready → marketplace drafts only. */
export const CLAUDE_AUTOMATION_LIST_DRAFTS: ClaudeAutomation = {
  id: 'list_drafts',
  number: 2,
  name: 'List drafts (KA + eBay)',
  cadence: 'When items show List Ready (checklist: title + description + photos)',
  does: [
    'Open /panel/list-ready?agent=1 and read brief + JSON on the page',
    'Download photoUrls to PC then upload',
    'Create DRAFTS on Kleinanzeigen and eBay',
    'Use exact title + description + prices + photo order from JSON',
    'Mark drafted in List Ready when done',
  ],
  never: [
    'NEVER publish / Veröffentlichen / Listen / activate',
    'Do not invent prices, titles, or descriptions',
    'Do not Price Drop / Lot Hunt / Inbound',
    'Do not mark Sold',
    'Do not touch items not in JSON',
  ],
  openUrls: ['/panel/list-ready?agent=1', '/panel/automations?agent=1&job=list_drafts'],
  starter:
    'Open DeInventory /panel/list-ready?agent=1, read #list-ready-agent-brief and #list-ready-agent-json yourself, create DRAFTS only on KA + eBay. NEVER publish. I will publish eBay after review.',
  prompt: `You are my DeInventory LIST-DRAFTS operator (Germany).

HOW YOU WERE STARTED
Open /panel/list-ready?agent=1 and READ the brief + JSON on the page. Do not ask me to paste.
This chat = List drafts ONLY.

GOAL
Create marketplace DRAFTS for List Ready items. I publish myself later.

HARD RULE — DRAFTS ONLY
- KA: Entwurf/draft. NEVER Veröffentlichen.
- eBay: Draft only. NEVER Publish / Listen active.
- Unsure if a button publishes → SKIP → NEEDS_MANUAL.

PER ROW
- Download photoUrls then upload from disk.
- Title + description from JSON.
- KA whole euros; eBay = priceEbay.

OUTPUT: DRAFTED[] · NEEDS_MANUAL[] · SKIPPED[]

START
Open list-ready?agent=1 now. Read page. Drafts only.`,
};

/** 3) Sales reconcile + Price Drop. */
export const CLAUDE_AUTOMATION_HYGIENE: ClaudeAutomation = {
  id: 'hygiene',
  number: 3,
  name: 'Hygiene (sold + price drop)',
  cadence: 'Sold: daily. Price Drop: every 3 days when due',
  does: [
    'Reconcile sold orders on eBay/KA → mark Sold in DeInventory',
    'When due: open /panel/price-drop?agent=1, read JSON, apply nextPrice to ACTIVE listings',
    'Respect floors / catastrophe guards',
  ],
  never: [
    'Do not create new inventory (Inbound)',
    'Do not create drafts or publish (List drafts)',
    'Do not run Lot Hunt',
    'Do not invent sold or drop prices',
    'Do not touch draft listings in Price Drop',
  ],
  openUrls: ['/panel/price-drop?agent=1', '/panel/automations?agent=1&job=hygiene', '/panel/inventory'],
  starter:
    'Open DeInventory /panel/automations?agent=1&job=hygiene, then run HYGIENE only: (1) reconcile today’s sold into inventory, (2) if Price Drop due open /panel/price-drop?agent=1 and apply JSON nextPrice to ACTIVE listings only. No drafts, publish, inbound, or lot hunt.',
  prompt: `You are my DeInventory HYGIENE operator (Germany). This chat = Hygiene ONLY.

PART 1 — SALES RECONCILE
Match eBay/KA sold → DeInventory Sold. Uncertain → SKIP. Never invent.

PART 2 — PRICE DROP (if due)
Open /panel/price-drop?agent=1. Read #price-drop-agent-brief + JSON on the page.
Apply nextPrice to ACTIVE listings only. Catastrophe guards. KA whole euros.

NEVER: drafts, publish, inbound, lot hunt, List Ready changes.

START
Say “HYGIENE”. Part 1 then Part 2 if due.`,
};

/** 4) eBay lot hunt → filtered list on armiktech. */
export const CLAUDE_AUTOMATION_EBAY_HUNT: ClaudeAutomation = {
  id: 'ebay_hunt',
  number: 4,
  name: 'eBay Lot Hunt (filter junk → list on armiktech)',
  cadence: 'On demand — one hunt per click / chat run',
  does: [
    'Read query + price min/max from /panel/ebay-hunt?agent=1',
    'Search ebay.de for matching lots',
    'Reject junk / wrong / konvolut / defect (unless asked)',
    'Keep only real matching listings with price + link',
    'Paste JSON into #ebay-hunt-results-paste and Import on armiktech',
  ],
  never: [
    'Do not buy, bid, offer, or message sellers',
    'Do not list / publish / price-drop',
    'Do not run Inbound or List drafts in this chat',
    'Do not invent listings — only real ebay.de URLs',
  ],
  openUrls: ['/panel/ebay-hunt?agent=1', '/panel/automations?agent=1&job=ebay_hunt'],
  starter: CLAUDE_EBAY_LOT_HUNT_STARTER,
  prompt: CLAUDE_EBAY_LOT_HUNT_PROMPT,
};

export const CLAUDE_AUTOMATIONS: ClaudeAutomation[] = [
  CLAUDE_AUTOMATION_INBOUND,
  CLAUDE_AUTOMATION_LIST_DRAFTS,
  CLAUDE_AUTOMATION_HYGIENE,
  CLAUDE_AUTOMATION_EBAY_HUNT,
];

export function getClaudeAutomation(id: ClaudeAutomationId): ClaudeAutomation {
  const hit = CLAUDE_AUTOMATIONS.find((a) => a.id === id);
  if (!hit) throw new Error(`Unknown automation: ${id}`);
  return hit;
}

export function parseClaudeAutomationJobParam(
  raw: string | null | undefined,
): ClaudeAutomationId | null {
  const id = String(raw || '').trim() as ClaudeAutomationId;
  return CLAUDE_AUTOMATIONS.some((a) => a.id === id) ? id : null;
}

/** How to run them without breaking anything. */
export const CLAUDE_AUTOMATION_PLAYBOOK = `DeInventory × Claude — FOUR separate automations (one chat each).

HOW YOU USE THIS (human → Claude)
1. Open /panel/automations?agent=1 on armiktech / DeInventory.
2. Tell Claude only: “Go to that page, read the playbook, and set up / run what it says.”
3. Or name one job: “Run ebay_hunt” / “Run inbound” — Claude opens that job’s URL and reads the brief ON THE PAGE (no paste needed).

RULE: one automation = one Claude chat/automation. Mixing causes wrong clicks.

JOBS
1) INBOUND — after you buy
   Purchases → inventory → photos → lifestyle card → marketTitle + description → PHOTO CHECK
   Never drafts / publish / drop / hunt / sold

2) LIST DRAFTS — when List Ready
   /panel/list-ready?agent=1 → KA+eBay DRAFTS only (you publish eBay later)

3) HYGIENE — daily sold + every 3 days price drop
   Mark Sold → /panel/price-drop?agent=1 if due
   Never drafts / inbound / hunt

4) EBAY LOT HUNT — on demand (Dealwatch-style, one shot)
   Set product + min/max on /panel/ebay-hunt → Claude searches ebay.de → filters junk → imports clean list with links onto armiktech
   Never buy / message sellers

LISTING PREP (inventory)
  Before List Ready: marketTitle · marketDescription · photos on item`;

/** Teach Claude (and you) to create each Claude automation separately. */
export const CLAUDE_AUTOMATION_SETUP = `CREATE EACH CLAUDE AUTOMATION SEPARATELY (do this once, then reuse)

In Claude (Computer Use / Automations product):
For EACH job below, create a NEW automation (or a dedicated Project/chat). Name it clearly. Paste ONLY that job’s starter (or tell it to open the URL). Do not put two jobs in one automation.

Automation A — name: “DeInventory Inbound”
  Starter / first message:
  Open /panel/automations?agent=1&job=inbound on my DeInventory site, read the active job brief, execute INBOUND only.

Automation B — name: “DeInventory List Drafts”
  Starter:
  Open /panel/list-ready?agent=1, read #list-ready-agent-brief and #list-ready-agent-json, create DRAFTS only. Never publish.

Automation C — name: “DeInventory Hygiene”
  Starter:
  Open /panel/automations?agent=1&job=hygiene, run HYGIENE only (sold reconcile, then price-drop?agent=1 if due).

Automation D — name: “DeInventory eBay Lot Hunt”
  Starter:
  Open /panel/ebay-hunt?agent=1, read #ebay-hunt-agent-brief and #ebay-hunt-agent-json, hunt once, import JSON into #ebay-hunt-results-paste. Do not buy.

BEFORE Lot Hunt runs: you (human) fill Product name + Min/Max € on /panel/ebay-hunt and save (fields autosave).

DAY-TO-DAY
- Say: “Run Lot Hunt” → Claude uses Automation D only.
- Say: “Go to /panel/automations?agent=1 and follow the playbook” → Claude reads the hub; if you named a job, it opens that job’s page and executes.
- Never ask one chat to “do inbound then drafts then hunt”.`;

export function exportClaudeAutomationsHubPayload(activeJob: ClaudeAutomationId): {
  mode: 'claude_automations_hub';
  rule: string;
  activeJob: ClaudeAutomationId;
  jobs: Array<{
    id: ClaudeAutomationId;
    number: number;
    name: string;
    openUrls: string[];
    starter: string;
  }>;
} {
  return {
    mode: 'claude_automations_hub',
    rule: 'One job = one Claude automation/chat. Open the job URL and read the brief on the page.',
    activeJob,
    jobs: CLAUDE_AUTOMATIONS.map((a) => ({
      id: a.id,
      number: a.number,
      name: a.name,
      openUrls: a.openUrls,
      starter: a.starter,
    })),
  };
}
