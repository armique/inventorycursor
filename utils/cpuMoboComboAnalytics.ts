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
  /** Normalized socket key used in comboKey (e.g. AM4, LGA1700). */
  socketKey: string;
  cpuLabel: string;
  moboLabel: string;
  cpuPartKey: string;
  moboPartKey: string;
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
  skippedKits: SkippedComboKit[];
  uniqueCombos: number;
  avgDaysToSell: number | null;
  totalProfit: number;
  fastest: CpuMoboComboRow | null;
  topProfit: CpuMoboComboRow | null;
  topEurPerDay: CpuMoboComboRow | null;
  mostSold: CpuMoboComboRow | null;
  rows: CpuMoboComboRow[];
}

export type SkippedComboReason = 'no_components' | 'missing_cpu' | 'missing_mobo' | 'missing_both';

export interface SkippedComboChild {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  detectedAs: 'cpu' | 'mobo' | 'other';
}

export interface SkippedComboKit {
  containerId: string;
  containerName: string;
  kind: ContainerKind | null;
  sellDate: string | null;
  reason: SkippedComboReason;
  reasonLabel: string;
  children: SkippedComboChild[];
}

function skippedReasonLabel(reason: SkippedComboReason): string {
  switch (reason) {
    case 'no_components':
      return 'No components linked';
    case 'missing_cpu':
      return 'Has board, missing CPU';
    case 'missing_mobo':
      return 'Has CPU, missing board';
    case 'missing_both':
      return 'No CPU or board detected';
  }
}

function describeSkippedKit(container: InventoryItem, items: InventoryItem[]): SkippedComboKit {
  const kind = getContainerKind(container);
  const children = getChildren(container, items);
  const childRows: SkippedComboChild[] = children.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category || '',
    subCategory: c.subCategory || '',
    detectedAs: isProcessorItem(c) ? 'cpu' : isMotherboardItem(c) ? 'mobo' : 'other',
  }));
  const hasCpu = childRows.some((c) => c.detectedAs === 'cpu');
  const hasMobo = childRows.some((c) => c.detectedAs === 'mobo');
  let reason: SkippedComboReason;
  if (children.length === 0) reason = 'no_components';
  else if (!hasCpu && !hasMobo) reason = 'missing_both';
  else if (!hasCpu) reason = 'missing_cpu';
  else reason = 'missing_mobo';

  return {
    containerId: container.id,
    containerName: container.name,
    kind,
    sellDate: sellDateIso(container, children),
    reason,
    reasonLabel: skippedReasonLabel(reason),
    children: childRows,
  };
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

/** Score how “display-ready” a label looks (spaces + proper case beat compact keys). */
function labelQuality(label: string): number {
  const s = (label || '').trim();
  if (!s) return -1;
  let score = 0;
  if (/\s/.test(s)) score += 4;
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) score += 3;
  else if (/[A-Z]/.test(s)) score += 2;
  if (!/^[a-z0-9]+$/.test(s)) score += 2;
  if (/^(Core|Ryzen|Xeon|Threadripper|Pentium|Celeron)\b/i.test(s)) score += 3;
  if (/^[ABHXZ]\d{2,3}/i.test(s)) score += 2;
  // Penalize compacted model keys like i74790 / ryzen33200g
  if (/^(i[3579]\d{3,5}k?|ryzen[3579]\d{3,4}[a-z]{0,3})$/i.test(s)) score -= 8;
  score += Math.min(s.length, 40) / 40;
  return score;
}

function preferNicerLabel(current: string, candidate: string): string {
  return labelQuality(candidate) > labelQuality(current) ? candidate.trim() : current.trim();
}

/** Chipset-only display: B450, Z790, H97 (no brand prefixes). */
export function formatChipsetDisplay(raw: string | number | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const stripped = text.replace(/^(Intel|AMD|Asus|ASUS|ASRock|MSI|Gigabyte|Biostar|Maxsun)\s+/i, '');
  const m = stripped.match(/\b([ABHXZ])\s*-?\s*(\d{2,3})([A-Za-z]?)\b/i);
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const nums = m[2]!;
  const suffix = (m[3] || '').toUpperCase();
  // Keep common board suffixes (M/I) when present; drop lone marketing "P" on old Z97P-style
  if (suffix === 'P' && nums.length === 2) return `${letter}${nums}`;
  return `${letter}${nums}${suffix}`;
}

/** Human CPU label: "Core i7-4790K", "Ryzen 5 5600". */
export function formatCpuDisplayLabel(item: InventoryItem): string {
  const fromName = extractPrettyCpu(item.name || '');
  if (fromName) return fromName;

  const series = String(getSpec(item, 'Series') || '').trim();
  const model = String(getSpec(item, 'Model') || '').trim();
  if (series || model) {
    const joined = [series, model].filter(Boolean).join(' ').trim();
    const fromSpecs = extractPrettyCpu(joined) || extractPrettyCpu(`${series} ${model}`);
    if (fromSpecs) return fromSpecs;
    if (joined && labelQuality(joined) >= 3) return tidySpaces(joined);
  }

  return tidyPartFallback(item.name || 'CPU');
}

/** Human motherboard/chipset label: "B550", "Z790". */
export function formatMoboDisplayLabel(item: InventoryItem): string {
  const chip = formatChipsetDisplay(getSpec(item, 'Chipset'));
  if (chip) return chip;
  const fromName = formatChipsetDisplay(item.name);
  if (fromName) return fromName;
  const model = formatChipsetDisplay(getSpec(item, 'Model'));
  if (model) return model;
  return tidyPartFallback(item.name || 'Motherboard');
}

function tidySpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function tidyPartFallback(name: string): string {
  let s = tidySpaces(name);
  s = s.replace(/\b(NEW|NEU|OVP|Defekt|Defective|ohne\s*K[uü]hler)\b/gi, '');
  s = s.replace(/\b(Motherboard|Mainboard|CPU|Prozessor|Processor)\b/gi, '');
  s = tidySpaces(s);
  // Title-case short leftovers if all lowercase compact-ish
  if (/^[a-z0-9\s\-]+$/.test(s) && s.length <= 28) {
    s = s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return s.slice(0, 56) || 'Unknown';
}

function extractPrettyCpu(text: string): string | null {
  if (!text) return null;
  const t = text;

  const thread = t.match(/\b(?:AMD\s+)?Threadripper\s*(\d{4}[A-Za-z]?)\b/i);
  if (thread) return `Threadripper ${thread[1]!.toUpperCase()}`;

  const xeon = t.match(/\bXeon\s+([A-Z0-9-]{3,})\b/i);
  if (xeon) return `Xeon ${xeon[1]!.toUpperCase()}`;

  const ryzen = t.match(/\b(?:AMD\s+)?Ryzen\s*([3579])\s*[-\s]?\s*(\d{3,4}[A-Za-z]{0,3})\b/i);
  if (ryzen) {
    const model = ryzen[2]!.toUpperCase();
    return `Ryzen ${ryzen[1]} ${model}`;
  }

  const core = t.match(/\b(?:Intel\s+)?(?:Core\s+)?(i[3579])[\s-]?(\d{3,5})([Kk]?)\b/i);
  if (core) {
    const gen = core[1]!.toLowerCase();
    const num = core[2]!;
    const k = core[3] ? 'K' : '';
    return `Core ${gen}-${num}${k}`;
  }

  const pentium = t.match(/\bPentium\s+([A-Z0-9-]{2,})\b/i);
  if (pentium) return `Pentium ${pentium[1]!.toUpperCase()}`;

  const celeron = t.match(/\bCeleron\s+([A-Z0-9-]{2,})\b/i);
  if (celeron) return `Celeron ${celeron[1]!.toUpperCase()}`;

  // Compact blobs: ryzen55600g / i74790k
  const compact = t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cRyzen = compact.match(/ryzen([3579])(\d{3,4}[a-z]{0,3})/);
  if (cRyzen) return `Ryzen ${cRyzen[1]} ${cRyzen[2]!.toUpperCase()}`;
  const cIntel = compact.match(/(i[3579])(\d{3,5})(k?)/);
  if (cIntel) return `Core ${cIntel[1]}-${cIntel[2]}${cIntel[3] ? 'K' : ''}`;

  return null;
}

function shortPartLabel(item: InventoryItem): string {
  if (isMotherboardItem(item)) return formatMoboDisplayLabel(item);
  if (isProcessorItem(item)) return formatCpuDisplayLabel(item);
  return tidyPartFallback(item.name || 'Part');
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

function parseComboKeyParts(key: string): {
  socketKey: string;
  cpuPartKey: string;
  moboPartKey: string;
} {
  const [socketKey = '', cpuPartKey = '', moboPartKey = ''] = key.split('::');
  return { socketKey, cpuPartKey, moboPartKey };
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
  const skippedKits: SkippedComboKit[] = [];
  let soldKitsWithCpuMobo = 0;

  for (const item of items) {
    if (!item.isPC && !item.isBundle) continue;
    if (!isRealizedDisposal(item)) continue;
    const id = extractComboIdentity(item, items);
    if (!id) {
      // Still respect kind/date filters so the skip list matches the current view.
      const kitKind = getContainerKind(item);
      if (kindFilter !== 'ALL' && kitKind !== kindFilter) continue;
      const kids = getChildren(item, items);
      const sellMs = sellDateMs(item, kids);
      if (!inDateRange(sellMs, dateRange, now)) continue;
      skippedMissingPair += 1;
      skippedKits.push(describeSkippedKit(item, items));
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
      bucket.cpuLabel = preferNicerLabel(bucket.cpuLabel, id.cpuLabel);
      bucket.moboLabel = preferNicerLabel(bucket.moboLabel, id.moboLabel);
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
      socketKey: bucket.socket || 'NOSOCKET',
      cpuLabel: bucket.cpuLabel,
      moboLabel: bucket.moboLabel,
      cpuPartKey: parseComboKeyParts(key).cpuPartKey,
      moboPartKey: parseComboKeyParts(key).moboPartKey,
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
    skippedKits: skippedKits.sort(
      (a, b) => (Date.parse(b.sellDate || '') || 0) - (Date.parse(a.sellDate || '') || 0)
    ),
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

function isFreeActivePart(item: InventoryItem): boolean {
  if (item.isPC || item.isBundle) return false;
  if (item.isDefective) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.parentContainerId) return false;
  return true;
}

function partSocketKey(item: InventoryItem): string {
  return normalizeSocket(getSpec(item, 'Socket'));
}

function socketsCompatible(comboSocket: string, partSocket: string): boolean {
  if (!comboSocket || comboSocket === 'NOSOCKET') return true;
  if (!partSocket) return true;
  return comboSocket === partSocket;
}

function fingerprint(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Loose match: stable key, display label, model-token overlap, or chipset. */
function partMatchesComboRole(
  item: InventoryItem,
  role: 'cpu' | 'mobo',
  row: CpuMoboComboRow
): boolean {
  const socketKey = row.socketKey || parseComboKeyParts(row.comboKey).socketKey;
  if (!socketsCompatible(socketKey, partSocketKey(item))) return false;

  const wantKey = role === 'cpu' ? row.cpuPartKey : row.moboPartKey;
  const haveKey = partStableKey(item, role);
  if (wantKey && haveKey && wantKey === haveKey) return true;

  const wantLabel = role === 'cpu' ? row.cpuLabel : row.moboLabel;
  const haveLabel = role === 'cpu' ? formatCpuDisplayLabel(item) : formatMoboDisplayLabel(item);
  const a = fingerprint(haveLabel);
  const b = fingerprint(wantLabel);
  if (a && b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b)))) {
    return true;
  }

  if (role === 'cpu') {
    const itemKeys = productModelKeys(item.name || '');
    const labelKeys = productModelKeys(wantLabel);
    if (itemKeys.some((k) => labelKeys.includes(k) || b.includes(k))) return true;
    if (b.length >= 5 && fingerprint(item.name || '').includes(b)) return true;
  }

  if (role === 'mobo') {
    const chip =
      formatChipsetDisplay(getSpec(item, 'Chipset')) ||
      formatChipsetDisplay(item.name) ||
      formatChipsetDisplay(getSpec(item, 'Model'));
    if (chip && fingerprint(chip) === b) return true;
  }

  return false;
}

export type ComboRebuyNeed = 'cpu' | 'mobo' | 'both' | 'assemble';

export interface ComboRebuySuggestion {
  comboKey: string;
  label: string;
  socket: string;
  cpuLabel: string;
  moboLabel: string;
  need: ComboRebuyNeed;
  title: string;
  reason: string;
  avgProfit: number;
  eurPerDay: number | null;
  avgDaysToSell: number | null;
  soldCount: number;
  freeCpuCount: number;
  freeMoboCount: number;
  inStockKits: number;
  /** Higher = more urgent / profitable opportunity. */
  score: number;
  searchQuery: string;
}

export interface ComboRebuyAnalysis {
  suggestions: ComboRebuySuggestion[];
  freeCpuTotal: number;
  freeMoboTotal: number;
  profitableCombos: number;
  combosWithNoStock: number;
}

/**
 * Compare top-performing sold combos with free (unassigned) CPU/board stock
 * and suggest what to rebuy — or assemble — next.
 */
export function suggestComboRebuys(
  items: InventoryItem[],
  comboRows: CpuMoboComboRow[],
  opts?: { limit?: number; minAvgProfit?: number }
): ComboRebuySuggestion[] {
  return analyzeComboRebuys(items, comboRows, opts).suggestions;
}

export function analyzeComboRebuys(
  items: InventoryItem[],
  comboRows: CpuMoboComboRow[],
  opts?: { limit?: number; minAvgProfit?: number }
): ComboRebuyAnalysis {
  const limit = opts?.limit ?? 8;
  const minAvgProfit = opts?.minAvgProfit ?? 0;

  const freeCpus = items.filter((i) => isFreeActivePart(i) && isProcessorItem(i));
  const freeMobos = items.filter((i) => isFreeActivePart(i) && isMotherboardItem(i));

  type Tagged = { item: InventoryItem; used: boolean };
  const cpuPool: Tagged[] = freeCpus.map((item) => ({ item, used: false }));
  const moboPool: Tagged[] = freeMobos.map((item) => ({ item, used: false }));

  const ranked = [...comboRows]
    .filter((r) => r.avgProfit >= minAvgProfit)
    .sort((a, b) => {
      const ea = a.eurPerDay ?? a.avgProfit / Math.max(a.avgDaysToSell || 30, 1);
      const eb = b.eurPerDay ?? b.avgProfit / Math.max(b.avgDaysToSell || 30, 1);
      return eb - ea || b.avgProfit - a.avgProfit || b.soldCount - a.soldCount;
    });

  const matchPool = (pool: Tagged[], row: CpuMoboComboRow, role: 'cpu' | 'mobo') =>
    pool.filter((p) => !p.used && partMatchesComboRole(p.item, role, row));

  const markUsed = (hits: Tagged[], n: number) => {
    for (let i = 0; i < n && i < hits.length; i++) hits[i]!.used = true;
  };

  const out: ComboRebuySuggestion[] = [];
  const combosWithNoStock = ranked.filter((r) => r.inStockCount === 0).length;

  for (let rankIndex = 0; rankIndex < ranked.length; rankIndex++) {
    const row = ranked[rankIndex]!;
    if (out.length >= limit * 2) break;

    const cpuHits = matchPool(cpuPool, row, 'cpu');
    const moboHits = matchPool(moboPool, row, 'mobo');
    const freeCpuCount = cpuHits.length;
    const freeMoboCount = moboHits.length;
    const pairsPossible = Math.min(freeCpuCount, freeMoboCount);
    const kits = row.inStockCount;

    const velocity = row.eurPerDay ?? row.avgProfit / Math.max(row.avgDaysToSell || 30, 1);
    let score = velocity * (1 + Math.log10(1 + row.soldCount)) + row.avgProfit / 100;

    let need: ComboRebuyNeed | null = null;
    let title = '';
    let reason = '';
    let searchQuery = '';

    if (pairsPossible > 0 && kits === 0) {
      need = 'assemble';
      title = `Build ${row.cpuLabel} + ${row.moboLabel}`;
      reason = `You already have ${pairsPossible} matching CPU/board pair${pairsPossible === 1 ? '' : 's'} loose in stock. This combo averaged €${Math.round(row.avgProfit)} profit${row.avgDaysToSell != null ? ` in ~${Math.round(row.avgDaysToSell)}d` : ''}.`;
      searchQuery = row.cpuLabel;
      score += 40;
      markUsed(cpuHits, pairsPossible);
      markUsed(moboHits, pairsPossible);
    } else if (freeCpuCount > freeMoboCount) {
      const orphans = freeCpuCount - freeMoboCount;
      need = 'mobo';
      title = `Rebuy ${row.moboLabel}`;
      reason = `You have ${freeCpuCount}× ${row.cpuLabel} free but only ${freeMoboCount} matching ${row.moboLabel}. Past kits ~€${Math.round(row.avgProfit)} avg${row.eurPerDay != null ? ` (€${row.eurPerDay.toFixed(1)}/day)` : ''}.`;
      searchQuery = `${row.socket !== 'Unknown' ? row.socket + ' ' : ''}${row.moboLabel}`.trim();
      score += 25 + orphans * 5;
      markUsed(cpuHits, freeCpuCount);
      markUsed(moboHits, freeMoboCount);
    } else if (freeMoboCount > freeCpuCount) {
      const orphans = freeMoboCount - freeCpuCount;
      need = 'cpu';
      title = `Rebuy ${row.cpuLabel}`;
      reason = `You have ${freeMoboCount}× ${row.moboLabel} free but only ${freeCpuCount} matching ${row.cpuLabel}. Past kits ~€${Math.round(row.avgProfit)} avg${row.eurPerDay != null ? ` (€${row.eurPerDay.toFixed(1)}/day)` : ''}.`;
      searchQuery = row.cpuLabel;
      score += 25 + orphans * 5;
      markUsed(cpuHits, freeCpuCount);
      markUsed(moboHits, freeMoboCount);
    } else if (kits === 0 && freeCpuCount === 0 && freeMoboCount === 0) {
      if (rankIndex > 11) continue;
      if (row.avgProfit < 1) continue;
      need = 'both';
      title = `Restock ${row.cpuLabel} + ${row.moboLabel}`;
      reason = `Strong seller (${row.soldCount}×, ~€${Math.round(row.avgProfit)} avg${row.avgDaysToSell != null ? `, ${Math.round(row.avgDaysToSell)}d` : ''}) and you have none in stock.`;
      searchQuery = `${row.cpuLabel} ${row.moboLabel}`;
      score += 8 + Math.max(0, 6 - rankIndex);
    } else {
      continue;
    }

    out.push({
      comboKey: row.comboKey,
      label: row.label,
      socket: row.socket,
      cpuLabel: row.cpuLabel,
      moboLabel: row.moboLabel,
      need,
      title,
      reason,
      avgProfit: row.avgProfit,
      eurPerDay: row.eurPerDay,
      avgDaysToSell: row.avgDaysToSell,
      soldCount: row.soldCount,
      freeCpuCount,
      freeMoboCount,
      inStockKits: kits,
      score,
      searchQuery,
    });
  }

  return {
    suggestions: out.sort((a, b) => b.score - a.score).slice(0, limit),
    freeCpuTotal: freeCpus.length,
    freeMoboTotal: freeMobos.length,
    profitableCombos: ranked.length,
    combosWithNoStock,
  };
}
