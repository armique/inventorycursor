import type { BulkImportRecord, BulkImportSource, InventoryItem, Platform } from '../types';
import { isRealizedDisposal } from './itemDisposition';

export const BULK_IMPORTS_LIMIT = 200;
export const BULK_IMPORTS_STORAGE_KEY = 'bulk_imports';
export const BULK_IMPORT_BACKFILL_KEY = 'bulk_imports_backfill_v1';

/** Legacy Bulk Entry item ids: `bulk-{timestamp}-{index}`. */
const LEGACY_BULK_ITEM_ID = /^bulk-(\d+)-(\d+)$/;

export function resolveBulkImportSource(sources: Iterable<BulkImportSource>): BulkImportSource {
  const set = new Set<BulkImportSource>();
  for (const s of sources) {
    if (s === 'mixed') {
      set.add('mixed');
      continue;
    }
    set.add(s);
  }
  if (set.has('mixed')) return 'mixed';
  if (set.size === 0) return 'manual';
  if (set.size === 1) return [...set][0];
  return 'mixed';
}

export function buildBulkImportLabel(names: string[], maxNames = 3): string {
  const cleaned = names.map((n) => (n || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return 'Bulk import';
  const head = cleaned.slice(0, maxNames);
  const extra = cleaned.length - head.length;
  return extra > 0 ? `${head.join(', ')} +${extra} more` : head.join(', ');
}

export function createBulkImportRecord(params: {
  id: string;
  items: InventoryItem[];
  source: BulkImportSource;
  totalCost: number;
  buyDate: string;
  platformBought?: Platform;
  bundleId?: string;
  createdAt?: string;
  kleinanzeigenBuyChatUrl?: string;
  kleinanzeigenBuyChatImage?: string;
}): BulkImportRecord {
  const itemIds = params.items.map((i) => i.id);
  const chatUrl = (params.kleinanzeigenBuyChatUrl || '').trim();
  const chatImage = (params.kleinanzeigenBuyChatImage || '').trim();
  return {
    id: params.id,
    createdAt: params.createdAt || new Date().toISOString(),
    buyDate: params.buyDate,
    itemIds,
    itemCount: itemIds.length,
    source: params.source,
    totalCost: params.totalCost,
    platformBought: params.platformBought,
    label: buildBulkImportLabel(params.items.map((i) => i.name)),
    bundleId: params.bundleId,
    ...(chatUrl ? { kleinanzeigenBuyChatUrl: chatUrl } : {}),
    ...(chatImage ? { kleinanzeigenBuyChatImage: chatImage } : {}),
  };
}

/** Pull chat URL / screenshot from the first member item that has them. */
export function chatProofFromBulkMembers(
  itemIds: string[] | undefined,
  itemsById: Map<string, InventoryItem>
): { kleinanzeigenBuyChatUrl?: string; kleinanzeigenBuyChatImage?: string } {
  let url = '';
  let image = '';
  for (const id of itemIds || []) {
    const item = itemsById.get(id);
    if (!item) continue;
    if (!url && item.kleinanzeigenBuyChatUrl?.trim()) {
      url = item.kleinanzeigenBuyChatUrl.trim();
    }
    if (!image && item.kleinanzeigenBuyChatImage?.trim()) {
      image = item.kleinanzeigenBuyChatImage.trim();
    }
    if (url && image) break;
  }
  return {
    ...(url ? { kleinanzeigenBuyChatUrl: url } : {}),
    ...(image ? { kleinanzeigenBuyChatImage: image } : {}),
  };
}

/** Prefer durable URLs on history rows — skip huge data: URLs that bloat sync. */
function isHistorySafeChatImage(url: string | undefined): boolean {
  const s = (url || '').trim();
  if (!s) return false;
  if (s.startsWith('data:')) return false;
  return true;
}

/**
 * Fill missing chat URL / durable screenshot on history rows from member items
 * (legacy batches created before chat proof lived on BulkImportRecord).
 */
export function enrichBulkImportsWithChatProof(
  records: BulkImportRecord[],
  items: InventoryItem[]
): { records: BulkImportRecord[]; changed: boolean } {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  let changed = false;
  const next = records.map((record) => {
    const hasUrl = !!(record.kleinanzeigenBuyChatUrl || '').trim();
    const hasImage = !!(record.kleinanzeigenBuyChatImage || '').trim();
    if (hasUrl && hasImage) return record;
    const fromMembers = chatProofFromBulkMembers(record.itemIds, itemsById);
    const memberUrl = (fromMembers.kleinanzeigenBuyChatUrl || '').trim();
    const memberImage = (fromMembers.kleinanzeigenBuyChatImage || '').trim();
    if (!memberUrl && !memberImage) return record;

    const patched: BulkImportRecord = { ...record };
    if (!hasUrl && memberUrl) {
      patched.kleinanzeigenBuyChatUrl = memberUrl;
      changed = true;
    }
    if (!hasImage && isHistorySafeChatImage(memberImage)) {
      patched.kleinanzeigenBuyChatImage = memberImage;
      changed = true;
    }
    return patched;
  });
  return { records: next, changed };
}

function unionBulkImportItemIds(a?: string[], b?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...(a || []), ...(b || [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Merge two history rows so chat proof / itemIds survive either device winning. */
function mergeBulkImportPair(a: BulkImportRecord, b: BulkImportRecord): BulkImportRecord {
  const aCount = a.itemIds?.length ?? a.itemCount ?? 0;
  const bCount = b.itemIds?.length ?? b.itemCount ?? 0;
  const aTs = Date.parse(a.createdAt || '') || 0;
  const bTs = Date.parse(b.createdAt || '') || 0;
  const preferB = bCount > aCount || (bCount === aCount && bTs > aTs);
  const base = preferB ? b : a;
  const other = preferB ? a : b;
  const itemIds = unionBulkImportItemIds(a.itemIds, b.itemIds);
  return {
    ...other,
    ...base,
    itemIds,
    itemCount: Math.max(itemIds.length, base.itemCount || 0, other.itemCount || 0),
    label: base.label || other.label,
    bundleId: base.bundleId || other.bundleId,
    platformBought: base.platformBought || other.platformBought,
    buyDate: base.buyDate || other.buyDate,
    source: base.source || other.source,
    // Always union chat proof — never drop URL/screenshot because the other side has more ids.
    kleinanzeigenBuyChatUrl: base.kleinanzeigenBuyChatUrl || other.kleinanzeigenBuyChatUrl,
    kleinanzeigenBuyChatImage: base.kleinanzeigenBuyChatImage || other.kleinanzeigenBuyChatImage,
  };
}

/**
 * Union local + remote bulk-import history for cross-device sync.
 * Local-only sessions are kept; matching ids merge itemIds + chat proof from both sides.
 */
export function mergeBulkImportsFromLocal(
  remoteList: BulkImportRecord[],
  localList: BulkImportRecord[]
): BulkImportRecord[] {
  const byId = new Map<string, BulkImportRecord>();
  for (const r of remoteList) {
    if (r?.id) byId.set(r.id, r);
  }
  for (const r of localList) {
    if (!r?.id) continue;
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
      continue;
    }
    byId.set(r.id, mergeBulkImportPair(existing, r));
  }
  return [...byId.values()]
    .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
    .slice(0, BULK_IMPORTS_LIMIT);
}

/** True when merged history has data the remote snapshot is missing — needs a cloud push. */
export function localBulkImportsNeedCloudPush(
  merged: BulkImportRecord[],
  remote: BulkImportRecord[]
): boolean {
  if (merged.length > (remote?.length ?? 0)) return true;
  const remoteById = new Map((remote || []).filter((r) => r?.id).map((r) => [r.id, r]));
  for (const m of merged) {
    if (!m?.id) continue;
    const r = remoteById.get(m.id);
    if (!r) return true;
    const mIds = m.itemIds?.length ?? 0;
    const rIds = r.itemIds?.length ?? 0;
    if (mIds > rIds) return true;
    if ((m.kleinanzeigenBuyChatUrl || '').trim() && !(r.kleinanzeigenBuyChatUrl || '').trim()) return true;
    if ((m.kleinanzeigenBuyChatImage || '').trim() && !(r.kleinanzeigenBuyChatImage || '').trim()) return true;
  }
  return false;
}

/** Stamp inventory rows from history itemIds so Flags icons work on every device. */
export function stampItemsFromBulkImportRecords(
  items: InventoryItem[],
  records: BulkImportRecord[]
): { items: InventoryItem[]; changed: boolean } {
  if (!records.length || !items.length) return { items, changed: false };
  const idToImport = new Map<string, string>();
  for (const rec of records) {
    for (const id of rec.itemIds || []) {
      if (id && !idToImport.has(id)) idToImport.set(id, rec.id);
    }
  }
  if (idToImport.size === 0) return { items, changed: false };
  let changed = false;
  const next = items.map((item) => {
    if (item.bulkImportId) return item;
    const bid = idToImport.get(item.id);
    if (!bid) return item;
    changed = true;
    return { ...item, bulkImportId: bid };
  });
  return { items: next, changed };
}

export function loadBulkImportsFromStorage(): BulkImportRecord[] {
  try {
    const raw = localStorage.getItem(BULK_IMPORTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as BulkImportRecord[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, BULK_IMPORTS_LIMIT) : [];
  } catch {
    return [];
  }
}

export type BulkImportLiveCounts = {
  present: number;
  inStock: number;
  sold: number;
  missing: number;
};

export function countBulkImportItems(
  record: BulkImportRecord,
  itemsById: Map<string, InventoryItem>
): BulkImportLiveCounts {
  let present = 0;
  let inStock = 0;
  let sold = 0;
  for (const id of record.itemIds || []) {
    const item = itemsById.get(id);
    if (!item) continue;
    present += 1;
    if (isRealizedDisposal(item)) sold += 1;
    else inStock += 1;
  }
  const expected = record.itemCount || (record.itemIds?.length ?? 0);
  return {
    present,
    inStock,
    sold,
    missing: Math.max(0, expected - present),
  };
}

/**
 * Group legacy `bulk-{timestamp}-{n}` items (and optional parent `bundle-{timestamp}`)
 * into synthetic BulkImportRecords, and stamp bulkImportId onto matching items.
 */
export function backfillBulkImportsFromItems(
  items: InventoryItem[],
  existing: BulkImportRecord[]
): { items: InventoryItem[]; records: BulkImportRecord[]; changedItems: boolean } {
  const existingIds = new Set(existing.map((r) => r.id));
  const groups = new Map<
    string,
    {
      timestamp: string;
      memberIds: string[];
      names: string[];
      buyDate: string;
      totalCost: number;
      platformBought?: Platform;
      comment2?: string;
      bundleId?: string;
      kleinanzeigenBuyChatUrl?: string;
      kleinanzeigenBuyChatImage?: string;
    }
  >();

  for (const item of items) {
    if (item.bulkImportId) continue;
    const m = LEGACY_BULK_ITEM_ID.exec(item.id);
    if (!m) continue;
    const timestamp = m[1];
    const importId = `bulkimp-${timestamp}`;
    if (existingIds.has(importId)) continue;
    let g = groups.get(importId);
    if (!g) {
      g = {
        timestamp,
        memberIds: [],
        names: [],
        buyDate: item.buyDate || '',
        totalCost: 0,
        platformBought: item.platformBought,
        comment2: item.comment2,
        kleinanzeigenBuyChatUrl: item.kleinanzeigenBuyChatUrl?.trim() || undefined,
        kleinanzeigenBuyChatImage:
          item.kleinanzeigenBuyChatImage?.trim() &&
          !item.kleinanzeigenBuyChatImage.trim().startsWith('data:')
            ? item.kleinanzeigenBuyChatImage.trim()
            : undefined,
      };
      groups.set(importId, g);
    }
    g.memberIds.push(item.id);
    g.names.push(item.name);
    g.totalCost += Number(item.buyPrice) || 0;
    if (!g.buyDate && item.buyDate) g.buyDate = item.buyDate;
    if (!g.platformBought && item.platformBought) g.platformBought = item.platformBought;
    if (!g.kleinanzeigenBuyChatUrl && item.kleinanzeigenBuyChatUrl?.trim()) {
      g.kleinanzeigenBuyChatUrl = item.kleinanzeigenBuyChatUrl.trim();
    }
    if (
      !g.kleinanzeigenBuyChatImage &&
      item.kleinanzeigenBuyChatImage?.trim() &&
      !item.kleinanzeigenBuyChatImage.trim().startsWith('data:')
    ) {
      g.kleinanzeigenBuyChatImage = item.kleinanzeigenBuyChatImage.trim();
    }
  }

  // Attach optional parent bundles created in the same confirm.
  for (const item of items) {
    if (item.bulkImportId || !item.isBundle) continue;
    const bm = /^bundle-(\d+)$/.exec(item.id);
    if (!bm) continue;
    const importId = `bulkimp-${bm[1]}`;
    const g = groups.get(importId);
    if (!g) continue;
    if (!g.memberIds.includes(item.id)) {
      g.memberIds.unshift(item.id);
      g.names.unshift(item.name);
    }
    g.bundleId = item.id;
  }

  if (groups.size === 0) {
    return { items, records: existing, changedItems: false };
  }

  const stampById = new Map<string, string>();
  const newRecords: BulkImportRecord[] = [];
  for (const [importId, g] of groups) {
    // Prefer batches that look like bulk imports (comment2) or have 2+ members.
    const looksBulk =
      g.memberIds.length >= 2 ||
      (typeof g.comment2 === 'string' && g.comment2.trim().toLowerCase().startsWith('bulk import'));
    if (!looksBulk) continue;
    for (const id of g.memberIds) stampById.set(id, importId);
    const createdMs = Number(g.timestamp);
    newRecords.push({
      id: importId,
      createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString(),
      buyDate: g.buyDate || '',
      itemIds: g.memberIds,
      itemCount: g.memberIds.length,
      source: 'mixed',
      totalCost: Math.round(g.totalCost * 100) / 100,
      platformBought: g.platformBought,
      label: buildBulkImportLabel(g.names),
      bundleId: g.bundleId,
      ...(g.kleinanzeigenBuyChatUrl ? { kleinanzeigenBuyChatUrl: g.kleinanzeigenBuyChatUrl } : {}),
      ...(g.kleinanzeigenBuyChatImage
        ? { kleinanzeigenBuyChatImage: g.kleinanzeigenBuyChatImage }
        : {}),
    });
  }

  if (newRecords.length === 0) {
    return { items, records: existing, changedItems: false };
  }

  let changedItems = false;
  const nextItems = items.map((item) => {
    const bid = stampById.get(item.id);
    if (!bid || item.bulkImportId === bid) return item;
    changedItems = true;
    return { ...item, bulkImportId: bid };
  });

  const records = mergeBulkImportsFromLocal(existing, newRecords);
  return { items: nextItems, records, changedItems };
}

export function bulkImportSourceLabel(source: BulkImportSource): string {
  switch (source) {
    case 'paste_ai':
      return 'AI parse';
    case 'paste_as_is':
      return 'Paste as-is';
    case 'hardware_db':
      return 'Hardware DB';
    case 'manual':
      return 'Manual';
    case 'mixed':
    default:
      return 'Mixed';
  }
}
