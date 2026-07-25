/**
 * CPU + motherboard combo performance for sold PC/Bundle kits.
 * One sample = one sold container that has both a CPU and a motherboard child.
 */

import type { InventoryItem, TaxMode } from '../types';
import { ItemStatus } from '../types';
import { getSpec } from '../services/compatibility';
import {
  getChildren,
  getSoldContainerDisplayTotals,
} from '../services/financialAggregation';
import { isProcessorItem, isMotherboardItem } from './builderSlotMatch';
import { getContainerKind, type ContainerKind } from './containerMembership';
import { isRealizedDisposal } from './itemDisposition';
import { getTimeGaugeRow, parseItemDateMs } from './inventoryTimeGauge';
import { productModelKeys } from './inventorySoldComps';

export type ComboSortMode = 'eurPerDay' | 'fastest' | 'profit' | 'margin' | 'volume';

export type ComboDateRange = 'ALL' | 'LAST_90' | 'LAST_180' | 'THIS_YEAR' | 'LAST_YEAR';

export type ComboKindFilter = 'ALL' | 'pc' | 'bundle' | 'mixed';

export interface CpuMoboComboSample {
  containerId: string;
  containerName: string;
  kind: ContainerKind;
  sellDate: string | null;
  daysToSell: number | null;
  profit: number;
  sellPrice: number;
  buyCost: number;
  marginPct: number | null;
  cpuName: string;
  moboName: string;
  socket: string;
}

export interface CpuMoboComboRow {
  comboKey: string;
  socket: string;
  cpuLabel: string;
  moboLabel: string;
  label: string;
  soldCount: number;
  avgDaysToSell: number | null;
  medianDaysToSell: number | null;
  totalProfit: number;
  avgProfit: number;
  avgSellPrice: number;
  avgMarginPct: number | null;
  /** Profit ÷ days — higher = better money velocity. */
  eurPerDay: number | null;
  kinds: ContainerKind[];
  containerIds: string[];
  samples: CpuMoboComboSample[];
  /** Matching kits still in stock (same combo key). */
  inStockCount: number;
  inStockIds: string[];
}

export interface CpuMoboComboSummary {
  soldKitsWithCpuMobo: number;
  skippedMissingPair: number;
  uniqueCombos: number;
  avgDaysToSell: number | null;
  totalProfit: number;
  fastest: CpuMoboComboRow | null;
  topProfit: CpuMoboComboRow | null;
  topEurPerDay: CpuMoboComboRow | null;
  mostSold: CpuMoboComboRow | null;
  rows: CpuMoboComboRow[];
}

function normalizeSocket(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
}

function prettySocket(normalized: string): string {
  if (!normalized) return 'Unknown';
  // LGA1700 → LGA 1700 for display
  const lga = normalized.match(/^LGA(\d+)$/);
  if (lga) return `LGA ${lga[1]}`;
  return normalized;
}

function shortPartLabel(item: InventoryItem): string {
  const series = getSpec(item, 'Series');
  const model = getSpec(item, 'Model');
  const chipset = getSpec(item, 'Chipset');
  if (isMotherboardItem(item) && chipset) {
    return String(chipset).trim();
  }
  if (series || model) {
    return [series, model].filter(Boolean).map(String).join(' ').trim();
  }
  const keys = productModelKeys(item.name || '');
  if (keys.length) {
    // Prefer longest concrete key for display-ish use
    const best = [...keys].sort((a, b) => b.length - a.length)[0];
    return best;
  }
  return (item.name || 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 52);
}

function partStableKey(item: InventoryItem, role: 'cpu' | 'mobo'): string {
  if (role === 'mobo') {
    const chip = getSpec(item, 'Chipset');
    if (chip) return `chip:${normalizeSocket(String(chip)) || String(chip).toLowerCase()}`;
  }
  const keys = productModelKeys(item.name || '');
  if (keys.length) {
    return `mk:${[...keys].sort().join('|')}`;
  }
  const label = shortPartLabel(item).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `nm:${label || item.id}`;
}

function resolveSocket(cpu: InventoryItem, mobo: InventoryItem): string {
  const fromCpu = normalizeSocket(getSpec(cpu, 'Socket'));
  if (fromCpu) return fromCpu;
  const fromMobo = normalizeSocket(getSpec(mobo, 'Socket'));
  if (fromMobo) return fromMobo;
  return '';
}

function comboKey(socket: string, cpu: InventoryItem, mobo: InventoryItem): string {
  return `${socket || 'NOSOCKET'}::${partStableKey(cpu, 'cpu')}::${partStableKey(mobo, 'mobo')}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function sellDateMs(container: InventoryItem, children: InventoryItem[]): number | null {
  const fromParent = parseItemDateMs(container.sellDate);
  if (fromParent != null) return fromParent;
  const childDates = children
    .map((c) => parseItemDateMs(c.sellDate))
    .filter((x): x is number => x != null);
  if (!childDates.length) return null;
  return Math.max(...childDates);
}

function sellDateIso(container: InventoryItem, children: InventoryItem[]): string | null {
  if (container.sellDate) return container.sellDate;
  const dated = children
    .filter((c) => c.sellDate)
    .sort((a, b) => (parseItemDateMs(b.sellDate) || 0) - (parseItemDateMs(a.sellDate) || 0));
  return dated[0]?.sellDate || null;
}

function inDateRange(sellMs: number | null, range: ComboDateRange, now = new Date()): boolean {
  if (range === 'ALL') return true;
  if (sellMs == null) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start = new Date(0);
  switch (range) {
    case 'LAST_90':
      start = new Date(now);
      start.setDate(start.getDate() - 90);
      start.setHours(0, 0, 0, 0);
      break;
    case 'LAST_180':
      start = new Date(now);
      start.setDate(start.getDate() - 180);
      start.setHours(0, 0, 0, 0);
      break;
    case 'THIS_YEAR':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'LAST_YEAR':
      start = new Date(now.getFullYear() - 1, 0, 1);
      end.setFullYear(now.getFullYear() - 1, 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
  }
  return sellMs >= start.getTime() && sellMs <= end.getTime();
}

function findCpuMobo(children: InventoryItem[]): { cpu: InventoryItem; mobo: InventoryItem } | null {
  const cpus = children.filter(isProcessorItem);
  const mobos = children.filter(isMotherboardItem);
  if (!cpus.length || !mobos.length) return null;
  // Prefer first non-defective; otherwise first
  const cpu = cpus.find((c) => !c.isDefective) || cpus[0]!;
  const mobo = mobos.find((m) => !m.isDefective) || mobos[0]!;
  return { cpu, mobo };
}

function isActiveKit(item: InventoryItem): boolean {
  return (
    item.status === ItemStatus.IN_STOCK ||
    item.status === ItemStatus.ORDERED ||
    item.status === ItemStatus.IN_COMPOSITION
  );
}

function extractComboIdentity(
  container: InventoryItem,
  items: InventoryItem[]
): {
  key: string;
  socket: string;
  cpuLabel: string;
  moboLabel: string;
  cpu: InventoryItem;
  mobo: InventoryItem;
  children: InventoryItem[];
  kind: ContainerKind;
} | null {
  if (!container.isPC && !container.isBundle) return null;
  const kind = getContainerKind(container);
  if (!kind) return null;
  const children = getChildren(container, items);
  const pair = findCpuMobo(children);
  if (!pair) return null;
  const socket = resolveSocket(pair.cpu, pair.mobo);
  return {
    key: comboKey(socket, pair.cpu, pair.mobo),
    socket,
    cpuLabel: shortPartLabel(pair.cpu),
    moboLabel: shortPartLabel(pair.mobo),
    cpu: pair.cpu,
    mobo: pair.mobo,
    children,
    kind,
  };
}

export function analyzeCpuMoboCombos(
  items: InventoryItem[],
  taxMode: TaxMode = 'SmallBusiness',
  opts?: {
    dateRange?: ComboDateRange;
    kind?: ComboKindFilter;
    minSold?: number;
    sort?: ComboSortMode;
    now?: Date;
  }
): CpuMoboComboSummary {
  const dateRange = opts?.dateRange ?? 'ALL';
  const kindFilter = opts?.kind ?? 'ALL';
  const minSold = Math.max(1, opts?.minSold ?? 1);
  const sort = opts?.sort ?? 'eurPerDay';
  const now = opts?.now ?? new Date();
  const nowMs = now.getTime();

  const soldBuckets = new Map<
    string,
    {
      socket: string;
      cpuLabel: string;
      moboLabel: string;
      samples: CpuMoboComboSample[];
    }
  >();

  let skippedMissingPair = 0;
  let soldKitsWithCpuMobo = 0;

  for (const item of items) {
    if (!item.isPC && !item.isBundle) continue;
    if (!isRealizedDisposal(item)) continue;
    const id = extractComboIdentity(item, items);
    if (!id) {
      skippedMissingPair += 1;
      continue;
    }
    if (kindFilter !== 'ALL' && id.kind !== kindFilter) continue;

    const sellMs = sellDateMs(item, id.children);
    if (!inDateRange(sellMs, dateRange, now)) continue;

    const totals = getSoldContainerDisplayTotals(item, items, taxMode);
    const profit = totals.profit ?? 0;
    const sellPrice = totals.sellPrice ?? 0;
    const buyCost =
      (Number(item.buyPrice) || 0) ||
      id.children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
    const gauge = getTimeGaugeRow(item, nowMs, items);
    const daysToSell =
      gauge?.mode === 'days_to_sell' && Number.isFinite(gauge.days) ? gauge.days : null;
    const marginPct =
      sellPrice > 0 ? (profit / sellPrice) * 100 : buyCost > 0 ? (profit / buyCost) * 100 : null;

    const sample: CpuMoboComboSample = {
      containerId: item.id,
      containerName: item.name,
      kind: id.kind,
      sellDate: sellDateIso(item, id.children),
      daysToSell,
      profit,
      sellPrice,
      buyCost,
      marginPct,
      cpuName: id.cpu.name,
      moboName: id.mobo.name,
      socket: prettySocket(id.socket),
    };

    soldKitsWithCpuMobo += 1;
    const bucket = soldBuckets.get(id.key);
    if (bucket) {
      bucket.samples.push(sample);
    } else {
      soldBuckets.set(id.key, {
        socket: id.socket,
        cpuLabel: id.cpuLabel,
        moboLabel: id.moboLabel,
        samples: [sample],
      });
    }
  }

  // In-stock kits by combo key
  const stockByKey = new Map<string, string[]>();
  for (const item of items) {
    if (!item.isPC && !item.isBundle) continue;
    if (!isActiveKit(item)) continue;
    const id = extractComboIdentity(item, items);
    if (!id) continue;
    if (kindFilter !== 'ALL' && id.kind !== kindFilter) continue;
    const list = stockByKey.get(id.key) || [];
    list.push(item.id);
    stockByKey.set(id.key, list);
  }

  const rows: CpuMoboComboRow[] = [];
  for (const [key, bucket] of soldBuckets) {
    if (bucket.samples.length < minSold) continue;
    const days = bucket.samples
      .map((s) => s.daysToSell)
      .filter((d): d is number => d != null && Number.isFinite(d));
    const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
    const totalProfit = bucket.samples.reduce((s, x) => s + x.profit, 0);
    const avgProfit = totalProfit / bucket.samples.length;
    const avgSell =
      bucket.samples.reduce((s, x) => s + x.sellPrice, 0) / bucket.samples.length;
    const margins = bucket.samples
      .map((s) => s.marginPct)
      .filter((m): m is number => m != null && Number.isFinite(m));
    const avgMargin = margins.length
      ? margins.reduce((a, b) => a + b, 0) / margins.length
      : null;
    const eurPerDay =
      avgDays != null && avgDays > 0 ? avgProfit / avgDays : avgDays === 0 ? avgProfit : null;
    const kinds = [...new Set(bucket.samples.map((s) => s.kind))];
    const stockIds = stockByKey.get(key) || [];
    const socketLabel = prettySocket(bucket.socket);

    rows.push({
      comboKey: key,
      socket: socketLabel,
      cpuLabel: bucket.cpuLabel,
      moboLabel: bucket.moboLabel,
      label: `${socketLabel} · ${bucket.cpuLabel} · ${bucket.moboLabel}`,
      soldCount: bucket.samples.length,
      avgDaysToSell: avgDays,
      medianDaysToSell: median(days),
      totalProfit,
      avgProfit,
      avgSellPrice: avgSell,
      avgMarginPct: avgMargin,
      eurPerDay,
      kinds,
      containerIds: bucket.samples.map((s) => s.containerId),
      samples: bucket.samples,
      inStockCount: stockIds.length,
      inStockIds: stockIds,
    });
  }

  const sortRows = (list: CpuMoboComboRow[]): CpuMoboComboRow[] => {
    const copy = [...list];
    copy.sort((a, b) => {
      switch (sort) {
        case 'fastest':
          return (a.avgDaysToSell ?? 9999) - (b.avgDaysToSell ?? 9999) || b.soldCount - a.soldCount;
        case 'profit':
          return b.avgProfit - a.avgProfit || b.soldCount - a.soldCount;
        case 'margin':
          return (b.avgMarginPct ?? -999) - (a.avgMarginPct ?? -999) || b.soldCount - a.soldCount;
        case 'volume':
          return b.soldCount - a.soldCount || b.totalProfit - a.totalProfit;
        case 'eurPerDay':
        default:
          return (b.eurPerDay ?? -999) - (a.eurPerDay ?? -999) || b.avgProfit - a.avgProfit;
      }
    });
    return copy;
  };

  const sorted = sortRows(rows);
  const byFastest = [...rows]
    .filter((r) => r.avgDaysToSell != null)
    .sort((a, b) => (a.avgDaysToSell ?? 9999) - (b.avgDaysToSell ?? 9999));
  const byProfit = [...rows].sort((a, b) => b.avgProfit - a.avgProfit);
  const byEur = [...rows]
    .filter((r) => r.eurPerDay != null)
    .sort((a, b) => (b.eurPerDay ?? -999) - (a.eurPerDay ?? -999));
  const byVol = [...rows].sort((a, b) => b.soldCount - a.soldCount);

  const allDays = sorted
    .flatMap((r) => r.samples.map((s) => s.daysToSell))
    .filter((d): d is number => d != null);
  const totalProfit = sorted.reduce((s, r) => s + r.totalProfit, 0);

  return {
    soldKitsWithCpuMobo,
    skippedMissingPair,
    uniqueCombos: sorted.length,
    avgDaysToSell: allDays.length
      ? allDays.reduce((a, b) => a + b, 0) / allDays.length
      : null,
    totalProfit,
    fastest: byFastest.find((r) => r.avgDaysToSell != null) || null,
    topProfit: byProfit[0] || null,
    topEurPerDay: byEur.find((r) => r.eurPerDay != null) || null,
    mostSold: byVol[0] || null,
    rows: sorted,
  };
}
