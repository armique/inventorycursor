/**
 * Shared Bulk Entry / bulk-import history cost splitting (EQUAL + SMART).
 */

export type BulkCostSplitMode = 'EQUAL' | 'SMART';

export type BulkCostSplitInput = {
  id: string;
  name?: string;
  category?: string;
  subCategory?: string;
  isDefective?: boolean;
  /** Locked share — excluded from auto pool. */
  manualCost?: number;
};

/** Relative weight for SMART split (same heuristics as Bulk Entry). */
export function estimateBulkItemWeight(item: BulkCostSplitInput): number {
  const sub = (item.subCategory || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  const bySub: Record<string, number> = {
    'graphics cards': 6.0,
    processors: 4.2,
    motherboards: 2.6,
    ram: 1.8,
    'storage (ssd/hdd)': 1.6,
    'power supplies': 1.4,
    cases: 1.1,
    cooling: 1.0,
    monitors: 1.7,
    'gaming laptop': 5.0,
    consoles: 3.2,
  };
  let w = bySub[sub] ?? 1.0;

  if (/(rtx|radeon|rx\s?\d{4,5}|gtx)/i.test(name)) w *= 1.35;
  if (/(i9|i7|ryzen\s?9|ryzen\s?7)/i.test(name)) w *= 1.2;
  if (/(4090|5090|4080|5080|7900\s?xtx)/i.test(name)) w *= 1.35;
  if (/(64gb|48gb|32gb|2tb|4tb)/i.test(name)) w *= 1.1;
  if (item.isDefective) w *= 0.6;

  return Math.max(0.3, w);
}

/**
 * Split `totalCost` across items. Manual costs are locked; remainder is auto-split.
 * Returns a map of id → euros (2dp via cents for auto rows; manuals kept as given).
 */
export function splitBulkImportCosts(
  items: BulkCostSplitInput[],
  totalCost: number,
  mode: BulkCostSplitMode = 'SMART'
): Record<string, number> {
  const total = Math.max(0, Number(totalCost) || 0);
  const out: Record<string, number> = {};
  let allocatedManual = 0;
  const withoutManual: BulkCostSplitInput[] = [];

  for (const item of items) {
    if (item.manualCost !== undefined && Number.isFinite(item.manualCost)) {
      const m = Math.max(0, item.manualCost);
      out[item.id] = Math.round(m * 100) / 100;
      allocatedManual += out[item.id];
    } else {
      withoutManual.push(item);
    }
  }

  const unallocated = Math.max(0, total - allocatedManual);
  if (withoutManual.length === 0) return out;

  if (mode === 'EQUAL' || unallocated <= 0) {
    if (unallocated <= 0) {
      for (const item of withoutManual) out[item.id] = 0;
      return out;
    }
    const totalCents = Math.round(unallocated * 100);
    const base = Math.floor(totalCents / withoutManual.length);
    let remain = totalCents - base * withoutManual.length;
    withoutManual.forEach((item, i) => {
      const cents = base + (i < remain ? 1 : 0);
      out[item.id] = cents / 100;
    });
    return out;
  }

  const weighted = withoutManual.map((i) => ({ id: i.id, weight: estimateBulkItemWeight(i) }));
  const weightSum = weighted.reduce((s, x) => s + x.weight, 0) || 1;
  const totalCents = Math.round(unallocated * 100);
  const withRaw = weighted.map((x) => {
    const rawCents = (totalCents * x.weight) / weightSum;
    const base = Math.floor(rawCents);
    const frac = rawCents - base;
    return { ...x, base, frac };
  });
  let used = withRaw.reduce((s, x) => s + x.base, 0);
  let remain = totalCents - used;
  withRaw.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < withRaw.length && remain > 0; i++, remain--) {
    withRaw[i].base += 1;
  }
  for (const x of withRaw) out[x.id] = x.base / 100;
  return out;
}
