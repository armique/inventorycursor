/**
 * List Ready queue — saleReady inventory → Claude drafts on KA + eBay (never publish).
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { getItemUserPhotoUrls } from './imageImport';
import { analyzeItemPhotos } from './photoQc';
import {
  loadFlipFees,
  totalEbayFeePct,
  type FlipFeeSettings,
} from './flipCoach';
import { resolveSuggestedEbayList } from './flipInsights';
import { roundMoney } from '../services/financialAggregation';

export const LIST_READY_STORAGE_KEY = 'deinv_list_ready_v1';

export type ListReadyDraftStatus =
  | 'queued'
  | 'blocked'
  | 'drafted_ka'
  | 'drafted_ebay'
  | 'drafted_both'
  | 'already_listed'
  | 'skipped';

export type ListReadyRow = {
  itemId: string;
  inventoryName: string;
  category: string;
  subCategory: string;
  buyPrice: number;
  priceKa: number | null;
  priceEbay: number | null;
  currency: 'EUR';
  photoUrls: string[];
  photoCount: number;
  conditionHint: string;
  inventoryNote: string;
  blockers: string[];
  status: ListReadyDraftStatus;
  draftKaUrl?: string;
  draftEbayUrl?: string;
  listedOnEbay: boolean;
  listedOnKleinanzeigen: boolean;
};

export type ListReadyPlan = {
  generatedAt: string;
  feePct: number;
  rows: ListReadyRow[];
};

type StoredDraftMeta = {
  status?: ListReadyDraftStatus;
  draftKaUrl?: string;
  draftEbayUrl?: string;
  updatedAt?: string;
};

type StoredState = {
  updatedAt: string;
  byItemId: Record<string, StoredDraftMeta>;
};

function loadStored(): StoredState {
  try {
    const raw = localStorage.getItem(LIST_READY_STORAGE_KEY);
    if (!raw) return { updatedAt: new Date().toISOString(), byItemId: {} };
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed?.byItemId || typeof parsed.byItemId !== 'object') {
      return { updatedAt: new Date().toISOString(), byItemId: {} };
    }
    return parsed;
  } catch {
    return { updatedAt: new Date().toISOString(), byItemId: {} };
  }
}

function saveStored(state: StoredState): void {
  localStorage.setItem(LIST_READY_STORAGE_KEY, JSON.stringify(state));
}

export function isListReadyCandidate(item: InventoryItem): boolean {
  return (
    Boolean(item.saleReady) &&
    (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) &&
    !item.isDefective &&
    !item.isDraft &&
    !item.parentContainerId
  );
}

function conditionHint(item: InventoryItem): string {
  if (item.isDefective) return 'defective — do not list';
  const bits: string[] = [];
  if (item.hasOVP) bits.push('with OVP/box');
  if (item.ioIncluded) bits.push('IO/accessories included');
  return bits.length ? bits.join(', ') : 'used — as shown in photos';
}

function inventoryNote(item: InventoryItem): string {
  return [item.comment1, item.comment2]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
}

function computeBlockers(item: InventoryItem, priceKa: number | null, priceEbay: number | null): string[] {
  const blockers: string[] = [];
  const photos = getItemUserPhotoUrls(item);
  if (!photos.length) blockers.push('no_photos');
  const qc = analyzeItemPhotos(item);
  for (const issue of qc) {
    if (issue.level === 'error') blockers.push(`photo:${issue.code}`);
  }
  if (!(priceKa != null && priceKa > 0) && !(priceEbay != null && priceEbay > 0)) {
    blockers.push('no_price');
  }
  if (/re-shoot|PHOTO CHECK|missing:/i.test(inventoryNote(item))) {
    blockers.push('prep_note_blocker');
  }
  return blockers;
}

function deriveStatus(
  item: InventoryItem,
  blockers: string[],
  stored?: StoredDraftMeta,
): ListReadyDraftStatus {
  if (blockers.length) return 'blocked';
  if (item.listedOnEbay && item.listedOnKleinanzeigen) return 'already_listed';
  if (stored?.status === 'skipped') return 'skipped';
  if (stored?.draftKaUrl && stored?.draftEbayUrl) return 'drafted_both';
  if (stored?.status === 'drafted_both') return 'drafted_both';
  if (stored?.status === 'drafted_ka' || stored?.draftKaUrl) {
    if (stored?.draftEbayUrl || stored?.status === 'drafted_ebay') return 'drafted_both';
    return 'drafted_ka';
  }
  if (stored?.status === 'drafted_ebay' || stored?.draftEbayUrl) return 'drafted_ebay';
  if (item.listedOnEbay || item.listedOnKleinanzeigen) {
    return 'queued';
  }
  return 'queued';
}

export function buildListReadyPlan(
  items: InventoryItem[],
  fees?: FlipFeeSettings,
): ListReadyPlan {
  const feeSettings = fees ?? loadFlipFees();
  const feePct = totalEbayFeePct(feeSettings);
  const stored = loadStored();
  const candidates = items.filter(isListReadyCandidate);

  const rows: ListReadyRow[] = candidates.map((item) => {
    const suggestion = resolveSuggestedEbayList(item, items, feeSettings);
    const priceKa =
      item.suggestedKleinListPrice != null && item.suggestedKleinListPrice > 0
        ? Math.round(item.suggestedKleinListPrice)
        : suggestion?.kleinList != null
          ? Math.round(suggestion.kleinList)
          : null;
    const priceEbay =
      item.suggestedEbayListPrice != null && item.suggestedEbayListPrice > 0
        ? roundMoney(item.suggestedEbayListPrice)
        : suggestion?.ebayList != null
          ? roundMoney(suggestion.ebayList)
          : null;
    const photoUrls = getItemUserPhotoUrls(item);
    const blockers = computeBlockers(item, priceKa, priceEbay);
    const meta = stored.byItemId[item.id];
    const status = deriveStatus(item, blockers, meta);

    return {
      itemId: item.id,
      inventoryName: item.name,
      category: item.category || '',
      subCategory: item.subCategory || '',
      buyPrice: Number(item.buyPrice) || 0,
      priceKa,
      priceEbay,
      currency: 'EUR',
      photoUrls,
      photoCount: photoUrls.length,
      conditionHint: conditionHint(item),
      inventoryNote: inventoryNote(item),
      blockers,
      status,
      draftKaUrl: meta?.draftKaUrl,
      draftEbayUrl: meta?.draftEbayUrl,
      listedOnEbay: Boolean(item.listedOnEbay),
      listedOnKleinanzeigen: Boolean(item.listedOnKleinanzeigen),
    };
  });

  rows.sort((a, b) => {
    const order: Record<ListReadyDraftStatus, number> = {
      queued: 0,
      drafted_ka: 1,
      drafted_ebay: 1,
      blocked: 2,
      drafted_both: 3,
      already_listed: 4,
      skipped: 5,
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.inventoryName.localeCompare(b.inventoryName);
  });

  return {
    generatedAt: new Date().toISOString(),
    feePct,
    rows,
  };
}

export function markListReadyDraft(
  itemId: string,
  patch: {
    status?: ListReadyDraftStatus;
    draftKaUrl?: string;
    draftEbayUrl?: string;
  },
): void {
  const stored = loadStored();
  const prev = stored.byItemId[itemId] || {};
  const next: StoredDraftMeta = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (next.draftKaUrl && next.draftEbayUrl) next.status = 'drafted_both';
  else if (next.draftKaUrl && !next.draftEbayUrl) next.status = next.status === 'drafted_ebay' ? 'drafted_both' : 'drafted_ka';
  else if (next.draftEbayUrl && !next.draftKaUrl) next.status = next.status === 'drafted_ka' ? 'drafted_both' : 'drafted_ebay';
  if (patch.status) next.status = patch.status;
  stored.byItemId[itemId] = next;
  stored.updatedAt = new Date().toISOString();
  saveStored(stored);
}

export function markListReadyMany(
  itemIds: string[],
  status: ListReadyDraftStatus,
): void {
  for (const id of itemIds) markListReadyDraft(id, { status });
}

/** Rows Claude should draft now (not blocked / already done / live both). */
export function exportListReadyAgentPayload(plan: ListReadyPlan): {
  generatedAt: string;
  feePct: number;
  mode: 'drafts_only';
  safety: { rule: string };
  rows: Array<{
    itemId: string;
    inventoryName: string;
    category: string;
    subCategory: string;
    title: string;
    priceKa: number | null;
    priceEbay: number | null;
    currency: 'EUR';
    kaWholeEurosOnly: true;
    photoUrls: string[];
    conditionHint: string;
    inventoryNote: string;
    skipKa: boolean;
    skipEbay: boolean;
  }>;
} {
  const rows = plan.rows
    .filter((r) => r.status === 'queued' || r.status === 'drafted_ka' || r.status === 'drafted_ebay')
    .filter((r) => r.blockers.length === 0)
    .map((r) => ({
      itemId: r.itemId,
      inventoryName: r.inventoryName,
      category: r.category,
      subCategory: r.subCategory,
      title: r.inventoryName,
      priceKa: r.priceKa,
      priceEbay: r.priceEbay,
      currency: 'EUR' as const,
      kaWholeEurosOnly: true as const,
      photoUrls: r.photoUrls,
      conditionHint: r.conditionHint,
      inventoryNote: r.inventoryNote,
      skipKa: r.listedOnKleinanzeigen || r.status === 'drafted_ka' || r.status === 'drafted_both',
      skipEbay: r.listedOnEbay || r.status === 'drafted_ebay' || r.status === 'drafted_both',
    }))
    .filter((r) => !r.skipKa || !r.skipEbay);

  return {
    generatedAt: plan.generatedAt,
    feePct: plan.feePct,
    mode: 'drafts_only',
    safety: {
      rule:
        'Create DRAFTS only on Kleinanzeigen and eBay. NEVER publish / activate / Veröffentlichen. User will review and publish eBay (and KA) themselves.',
    },
    rows,
  };
}

export const CLAUDE_LIST_READY_STARTER = `Open DeInventory → /panel/list-ready?agent=1, read #list-ready-agent-brief and #list-ready-agent-json yourself, then create DRAFTS only on KA + eBay for each row. NEVER publish. I will publish after review.`;

export const CLAUDE_LIST_READY_PROMPT = `You are my listing-draft operator for DeInventory (Germany).

GOAL
For each row in the List Ready JSON, create marketplace DRAFTS on kleinanzeigen.de and ebay.de using the exact title, prices, and photo URLs from the JSON.
I will review every draft myself and publish later (especially eBay). You must NEVER publish or make a listing active.

DO NOT invent titles, prices, or photos. DO NOT use APIs. Use Chrome like a human seller.
DO NOT ask me to paste the JSON — read it from the DeInventory page.

BOOTSTRAP (every run)
1. Open Chrome (same profile as DeInventory).
2. Go to: /panel/list-ready?agent=1
3. Wait until data-list-ready-syncing is not "true" and #list-ready-agent-json has JSON.
4. If rows are empty: stop and say “no queued drafts”.
5. Read #list-ready-agent-brief and parse #list-ready-agent-json.
6. Work ONLY from JSON.rows. Ignore chat history.

HARD RULE — DRAFTS ONLY
- Kleinanzeigen: save as Entwurf / draft / “Anzeige speichern” without publishing if the UI offers a draft path. If the only save path would publish immediately, STOP on that item and list it under NEEDS_MANUAL — do not click Veröffentlichen / Anzeige aufgeben that goes live.
- eBay: save as Draft / similar listing draft / “Als Entwurf speichern”. NEVER Publish / Listen / Angebot einstellen to active.
- Prefer leaving the editor on the review/draft screen with the draft saved.
- If you are unsure whether a button publishes — DO NOT click it; SKIP and note NEEDS_MANUAL.

SPEED
- Target ≤1–2 minutes per item when photos upload cleanly.
- Minimal narration. One-line log per channel.
- If stuck >60s on one step → SKIP that channel for the item.

PER ROW WORKFLOW
1. Open photoUrls in order (first = main / product card). Download or keep tabs ready for upload.
2. Kleinanzeigen (unless skipKa):
   - Neue Anzeige → pick best category from category/subCategory
   - Upload photos in JSON order
   - Title = title (inventoryName)
   - Preis = priceKa as WHOLE euros only (49 not 49.53). If null → skip KA
   - Beschreibung: short factual text from conditionHint + inventoryNote (no hype)
   - Save as DRAFT only
   - Record draft URL/id if visible
3. eBay.de (unless skipEbay):
   - Create listing / Sell similar → Draft
   - Same photos in order
   - Title = title
   - Price = priceEbay (cents OK). If null → skip eBay
   - Condition/notes from conditionHint
   - Save as DRAFT only — never Publish
   - Record draft URL/id if visible
4. Return to DeInventory List Ready and mark the item drafted (Mark drafted KA / eBay / both) when possible.

SAFETY
- Captcha / 2FA / login → STOP and ask me once.
- Wrong category uncertainty → use closest PC components category; note in SKIPPED.
- Never edit already-active listings in this job (that is Price Drop).
- Never raise or invent prices. Never list blocked rows (they are not in JSON).
- Prefer SKIP over publishing.

OUTPUT
Start with one line: counts (to draft N · skipKa · skipEbay).
Then execute KA-first or eBay-first consistently (finish all KA drafts, then all eBay — or per item both drafts; pick one and stick to it).
End with tables:
- DRAFTED[] itemId · channel · draftUrl/id
- NEEDS_MANUAL[] itemId · reason
- SKIPPED[] itemId · reason

Tell me to open List Ready and mark drafted rows, then I will publish eBay myself after review.

START
Open /panel/list-ready?agent=1 now. Read brief + JSON. Do not ask for paste. Create drafts only.
`;
