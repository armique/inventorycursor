import type { Expense, InventoryItem } from '../types';

/** Presets for Finanzamt / sheet exports (local calendar where noted). */
export type FinanzamtExportRangePreset =
  | 'all'
  | 'last_month'
  | 'last_3_months'
  | 'this_year'
  | 'last_year'
  | 'custom_year'
  | 'custom_range';

export type DateBounds = { start: string; end: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(y: number, m0: number): Date {
  return new Date(y, m0, 1);
}

function endOfMonth(y: number, m0: number): Date {
  return new Date(y, m0 + 1, 0);
}

/** First 10 chars as YYYY-MM-DD, or null if unusable. */
export function normalizeToYMD(s: string | undefined | null): string | null {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

export function ymdInRange(ymd: string | null, start: string, end: string): boolean {
  if (!ymd) return false;
  return ymd >= start && ymd <= end;
}

/**
 * Resolve inclusive calendar bounds for a preset. Returns null = export everything.
 */
export function resolveFinanzamtDateBounds(
  preset: FinanzamtExportRangePreset,
  opts: { customYear?: number; customStart?: string; customEnd?: string },
  now = new Date()
): DateBounds | null {
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'all':
      return null;
    case 'last_month': {
      const ref = m === 0 ? new Date(y - 1, 11, 1) : new Date(y, m - 1, 1);
      const sy = ref.getFullYear();
      const sm = ref.getMonth();
      return { start: toYMD(startOfMonth(sy, sm)), end: toYMD(endOfMonth(sy, sm)) };
    }
    case 'last_3_months': {
      const start = startOfMonth(y, m - 2);
      return { start: toYMD(start), end: toYMD(now) };
    }
    case 'this_year':
      return { start: `${y}-01-01`, end: toYMD(now) };
    case 'last_year': {
      const ly = y - 1;
      return { start: `${ly}-01-01`, end: `${ly}-12-31` };
    }
    case 'custom_year': {
      const cy = opts.customYear ?? y;
      return { start: `${cy}-01-01`, end: `${cy}-12-31` };
    }
    case 'custom_range': {
      const a = normalizeToYMD(opts.customStart);
      const b = normalizeToYMD(opts.customEnd);
      if (!a || !b) return null;
      return a <= b ? { start: a, end: b } : { start: b, end: a };
    }
    default:
      return null;
  }
}

export function formatBoundsGerman(bounds: DateBounds): string {
  return `${bounds.start} bis ${bounds.end}`;
}

export function formatBoundsForFilename(bounds: DateBounds): string {
  return `${bounds.start}_bis_${bounds.end}`;
}

export function itemTouchesExportRange(item: InventoryItem, start: string, end: string): boolean {
  const buy = normalizeToYMD(item.buyDate);
  const sell = normalizeToYMD(item.sellDate);
  const container = normalizeToYMD(item.containerSoldDate);
  return ymdInRange(buy, start, end) || ymdInRange(sell, start, end) || ymdInRange(container, start, end);
}

/**
 * Include ancestors (containers) and all siblings under any bundle/PC in the set so Finanzamt row logic stays consistent.
 */
export function expandItemsForBundledClosure(items: InventoryItem[], seedIds: Set<string>): InventoryItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set(seedIds);

  for (const id of [...out]) {
    let cur = byId.get(id);
    while (cur?.parentContainerId) {
      out.add(cur.parentContainerId);
      cur = byId.get(cur.parentContainerId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...out]) {
      const item = byId.get(id);
      if (item && (item.isBundle || item.isPC)) {
        for (const ch of items) {
          if (ch.parentContainerId === id && !out.has(ch.id)) {
            out.add(ch.id);
            changed = true;
          }
        }
      }
    }
  }

  return items.filter((i) => out.has(i.id));
}

export function filterInventoryForFinanzamtRange(items: InventoryItem[], bounds: DateBounds): InventoryItem[] {
  const list = items.filter((i) => !i.isDraft);
  const seed = new Set(list.filter((i) => itemTouchesExportRange(i, bounds.start, bounds.end)).map((i) => i.id));
  return expandItemsForBundledClosure(list, seed);
}

export function filterExpensesForRange(expenses: Expense[], bounds: DateBounds): Expense[] {
  return expenses.filter((e) => ymdInRange(normalizeToYMD(e.date), bounds.start, bounds.end));
}
