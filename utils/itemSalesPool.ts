/**
 * Item-level sales data pool: comps & analytics keyed by atomic parts,
 * never by bundle/PC titles. Bundle sales attribute sell/fees by buy-weight.
 */

import { InventoryItem, ItemStatus, Platform } from '../types';
import {
  roundMoney,
  isSoldWithProportionalChildren,
  isBundleSoldOnParentOnly,
  getChildren,
} from '../services/financialAggregation';
import { bundleComponentBreakdown } from './bundleProfitBreakdown';
import { productModelKeys, nameSimilarity, soldCompsModelCompatible } from './inventorySoldComps';
import { resolveSalePlatform } from './salePlatform';

export const ITEM_SALES_POOL_KEY = 'item_sales_pool_v1';

export type ItemSaleSource = 'standalone' | 'bundle_attribution' | 'split_child';

export type ItemSaleEvent = {
  eventId: string;
  partItemId: string;
  name: string;
  modelKey: string;
  category: string;
  buyPrice: number;
  allocatedSell: number;
  allocatedFee: number;
  pocket: number;
  marginPct: number;
  platform: Platform | 'unknown';
  soldAt: string;
  daysHeld: number;
  source: ItemSaleSource;
  containerId?: string;
};

export type ItemSalesPoolSnapshot = {
  version: 1;
  updatedAt: string;
  events: ItemSaleEvent[];
};

function modelKeyFor(name: string): string {
  const keys = productModelKeys(name || '');
  if (keys[0]) return keys[0];
  return (name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

function daysBetween(buyDate?: string, sellDate?: string): number {
  if (!buyDate || !sellDate) return 0;
  const a = new Date(buyDate).getTime();
  const b = new Date(sellDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function isLeafPart(item: InventoryItem): boolean {
  return !item.isPC && !item.isBundle && !item.isDraft;
}

function isSplitChild(item: InventoryItem): boolean {
  return Boolean(item.id?.startsWith('split-') || item.parentContainerId);
}

/**
 * Build attributed sale events from current inventory (leaf parts only).
 */
export function buildItemSaleEvents(items: InventoryItem[]): ItemSaleEvent[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const events: ItemSaleEvent[] = [];
  const attributedChildIds = new Set<string>();

  // 1) Parent kits sold → buy-weight attribution to parts (proportional or parent-only)
  for (const container of items) {
    if (!container.isPC && !container.isBundle) continue;
    if (container.status !== ItemStatus.SOLD && container.status !== ItemStatus.TRADED) continue;
    const proportional = isSoldWithProportionalChildren(container, items);
    const parentOnly = isBundleSoldOnParentOnly(container, items);
    if (!proportional && !parentOnly) continue;

    let breakdown = bundleComponentBreakdown(container, items);
    if (!breakdown.length) {
      // Parent-only: componentIds may still point at in-composition children
      const children = getChildren(container, items);
      if (!children.length) continue;
      const totalBuy = children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
      const containerSell = Number(container.sellPrice) || 0;
      breakdown = children.map((child) => {
        const buyPrice = Number(child.buyPrice) || 0;
        const share = totalBuy > 0 ? buyPrice / totalBuy : 1 / children.length;
        return {
          item: child,
          buyPrice,
          allocatedSell: containerSell * share,
          profit: 0,
        };
      });
    }
    if (!breakdown.length) continue;

    const containerSell = Number(container.sellPrice) || 0;
    const containerFee = Number(container.feeAmount) || 0;
    const soldAt =
      container.sellDate ||
      container.containerSoldDate ||
      container.suggestedPriceUpdatedAt ||
      new Date().toISOString().slice(0, 10);
    const platform = resolveSalePlatform(container);

    for (const row of breakdown) {
      const child = row.item;
      if (!isLeafPart(child)) continue;
      attributedChildIds.add(child.id);
      const buy = row.buyPrice;
      const allocatedSell = roundMoney(row.allocatedSell);
      const share = containerSell > 0 ? row.allocatedSell / containerSell : 1 / breakdown.length;
      const allocatedFee = roundMoney(containerFee * share);
      const pocket = roundMoney(Math.max(0, allocatedSell - allocatedFee));
      const marginPct = buy > 0 ? roundMoney(((pocket - buy) / buy) * 100) : 0;
      const daysHeld = daysBetween(child.buyDate, soldAt);

      events.push({
        eventId: `bundle:${container.id}:${child.id}`,
        partItemId: child.id,
        name: child.name,
        modelKey: modelKeyFor(child.name),
        category: child.subCategory || child.category || 'Other',
        buyPrice: buy,
        allocatedSell,
        allocatedFee,
        pocket,
        marginPct,
        platform,
        soldAt,
        daysHeld,
        source: 'bundle_attribution',
        containerId: container.id,
      });
    }
  }

  // 2) Standalone / split-child sold rows (not already attributed via parent)
  for (const item of items) {
    if (!isLeafPart(item)) continue;
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    if (attributedChildIds.has(item.id)) continue;

    // Skip children of a sold proportional parent even if status wasn't synced
    if (item.parentContainerId) {
      const parent = byId.get(item.parentContainerId);
      if (parent && isSoldWithProportionalChildren(parent, items)) continue;
    }

    const sell = Number(item.sellPrice) || 0;
    if (sell <= 0) continue;
    const fee = Number(item.feeAmount) || 0;
    const buy = Number(item.buyPrice) || 0;
    const pocket = roundMoney(Math.max(0, sell - fee));
    const soldAt = item.sellDate || item.containerSoldDate || '';
    if (!soldAt) continue;
    const marginPct = buy > 0 ? roundMoney(((pocket - buy) / buy) * 100) : 0;
    const source: ItemSaleSource =
      isSplitChild(item) && item.id.startsWith('split-') ? 'split_child' : 'standalone';

    events.push({
      eventId: `part:${item.id}`,
      partItemId: item.id,
      name: item.name,
      modelKey: modelKeyFor(item.name),
      category: item.subCategory || item.category || 'Other',
      buyPrice: buy,
      allocatedSell: roundMoney(sell),
      allocatedFee: roundMoney(fee),
      pocket,
      marginPct,
      platform: resolveSalePlatform(item),
      soldAt,
      daysHeld: daysBetween(item.buyDate, soldAt),
      source,
      containerId: item.parentContainerId,
    });
  }

  return events;
}

export function rebuildItemSalesPool(items: InventoryItem[]): ItemSalesPoolSnapshot {
  const snapshot: ItemSalesPoolSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    events: buildItemSaleEvents(items),
  };
  try {
    localStorage.setItem(ITEM_SALES_POOL_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
  return snapshot;
}

export function loadItemSalesPool(): ItemSalesPoolSnapshot | null {
  try {
    const raw = localStorage.getItem(ITEM_SALES_POOL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ItemSalesPoolSnapshot;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Prefer cache; rebuild if missing/stale empty while inventory has sales. */
export function getOrRebuildItemSalesPool(items: InventoryItem[]): ItemSalesPoolSnapshot {
  const cached = loadItemSalesPool();
  if (cached && cached.events.length > 0) return cached;
  return rebuildItemSalesPool(items);
}

export type PoolCompHit = {
  event: ItemSaleEvent;
  sim: number;
};

/**
 * Match pool events to a product name for channel pricing.
 */
export function findPoolComps(
  events: ItemSaleEvent[],
  name: string,
  opts?: { category?: string; subCategory?: string; limit?: number }
): PoolCompHit[] {
  const q = name.trim();
  if (q.length < 3 || !events.length) return [];
  const queryHasModel = productModelKeys(q).length > 0;
  const minSim = queryHasModel ? 0.28 : 0.45;
  const limit = opts?.limit ?? 16;

  return events
    .map((ev) => {
      if (!soldCompsModelCompatible(q, ev.name)) return { event: ev, sim: 0 };
      let sim = nameSimilarity(q, ev.name);
      if (opts?.subCategory && ev.category === opts.subCategory) sim += 0.12;
      else if (opts?.category && ev.category === opts.category) sim += 0.06;
      if (queryHasModel && sim >= 0.28) sim = Math.max(sim, 0.45);
      return { event: ev, sim: Math.min(1, sim) };
    })
    .filter((x) => x.sim >= minSim && x.event.pocket > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
}

export type PriceLabSummary = {
  eventCount: number;
  standaloneCount: number;
  bundleAttributedCount: number;
  splitChildCount: number;
  avgMarginPct: number | null;
  avgDaysHeld: number | null;
  modelCoverage: Array<{
    modelKey: string;
    label: string;
    count: number;
    avgMarginPct: number;
    standaloneShare: number;
  }>;
  marginByAgeBucket: Array<{
    label: string;
    count: number;
    avgMarginPct: number;
    targetMarginPct: number;
  }>;
  openStockTargetByAge: Array<{
    label: string;
    count: number;
    avgTargetMarginPct: number;
  }>;
};

function ageBucket(days: number): { label: string; target: number } {
  if (days < 2) return { label: '0–1d', target: 60 };
  if (days < 4) return { label: '2–3d', target: 55 };
  if (days < 6) return { label: '4–5d', target: 50 };
  if (days < 8) return { label: '6–7d', target: 45 };
  if (days < 10) return { label: '8–9d', target: 40 };
  if (days < 12) return { label: '10–11d', target: 35 };
  return { label: '12d+', target: 30 };
}

export function summarizePriceLab(
  items: InventoryItem[],
  pool?: ItemSalesPoolSnapshot | null
): PriceLabSummary {
  const snapshot = pool ?? getOrRebuildItemSalesPool(items);
  const events = snapshot.events;
  const standaloneCount = events.filter((e) => e.source === 'standalone').length;
  const bundleAttributedCount = events.filter((e) => e.source === 'bundle_attribution').length;
  const splitChildCount = events.filter((e) => e.source === 'split_child').length;

  const avgMarginPct = events.length
    ? roundMoney(events.reduce((s, e) => s + e.marginPct, 0) / events.length)
    : null;
  const avgDaysHeld = events.length
    ? Math.round(events.reduce((s, e) => s + e.daysHeld, 0) / events.length)
    : null;

  const byModel = new Map<
    string,
    { label: string; margins: number[]; standalone: number; total: number }
  >();
  for (const e of events) {
    const key = e.modelKey || e.name.slice(0, 24);
    const b = byModel.get(key) || { label: e.name, margins: [], standalone: 0, total: 0 };
    if (e.name.length < b.label.length) b.label = e.name;
    b.margins.push(e.marginPct);
    b.total += 1;
    if (e.source === 'standalone') b.standalone += 1;
    byModel.set(key, b);
  }
  const modelCoverage = Array.from(byModel.entries())
    .map(([modelKey, b]) => ({
      modelKey,
      label: b.label,
      count: b.total,
      avgMarginPct: roundMoney(b.margins.reduce((a, v) => a + v, 0) / b.margins.length),
      standaloneShare: roundMoney((b.standalone / b.total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const ageMap = new Map<string, { margins: number[]; target: number }>();
  for (const e of events) {
    const { label, target } = ageBucket(e.daysHeld);
    const b = ageMap.get(label) || { margins: [], target };
    b.margins.push(e.marginPct);
    ageMap.set(label, b);
  }
  const bucketOrder = ['0–1d', '2–3d', '4–5d', '6–7d', '8–9d', '10–11d', '12d+'];
  const marginByAgeBucket = bucketOrder
    .filter((l) => ageMap.has(l))
    .map((label) => {
      const b = ageMap.get(label)!;
      return {
        label,
        count: b.margins.length,
        avgMarginPct: roundMoney(b.margins.reduce((a, v) => a + v, 0) / b.margins.length),
        targetMarginPct: b.target,
      };
    });

  const now = Date.now();
  const openBuckets = new Map<string, { targets: number[] }>();
  for (const item of items) {
    if (item.isPC || item.isBundle || item.isDraft) continue;
    if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) continue;
    const days = item.buyDate
      ? Math.max(0, Math.round((now - new Date(item.buyDate).getTime()) / 86400000))
      : 0;
    const { label, target } = ageBucket(days);
    const b = openBuckets.get(label) || { targets: [] };
    b.targets.push(target);
    openBuckets.set(label, b);
  }
  const openStockTargetByAge = bucketOrder
    .filter((l) => openBuckets.has(l))
    .map((label) => {
      const b = openBuckets.get(label)!;
      return {
        label,
        count: b.targets.length,
        avgTargetMarginPct: roundMoney(
          b.targets.reduce((a, v) => a + v, 0) / b.targets.length
        ),
      };
    });

  return {
    eventCount: events.length,
    standaloneCount,
    bundleAttributedCount,
    splitChildCount,
    avgMarginPct,
    avgDaysHeld,
    modelCoverage,
    marginByAgeBucket,
    openStockTargetByAge,
  };
}
