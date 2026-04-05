import { ItemStatus, type InventoryItem } from '../types';

export function parseItemDateMs(d: string | undefined): number | null {
  if (!d || !String(d).trim()) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

export function daysBetweenMs(start: number, end: number): number {
  return Math.max(0, (end - start) / 86400000);
}

/** Stock sitting: longer → higher stress (0..1). ~300d → full red. */
export function stockAgeStress(buyMs: number, nowMs: number): { days: number; t: number } {
  const days = daysBetweenMs(buyMs, nowMs);
  const maxDays = 300;
  return { days, t: Math.min(1, days / maxDays) };
}

/** Sold: longer buy→sell → higher stress. ~150d → full red. */
export function daysToSellStress(buyMs: number, sellMs: number): { days: number; t: number } {
  const days = daysBetweenMs(buyMs, sellMs);
  const maxDays = 150;
  return { days, t: Math.min(1, days / maxDays) };
}

/** Interpolate green → yellow → orange → red for t in [0, 1]. */
export function stressToRgb(t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const lerp = (a: number[], b: number[], u: number) =>
    [
      Math.round(a[0]! + (b[0]! - a[0]!) * u),
      Math.round(a[1]! + (b[1]! - a[1]!) * u),
      Math.round(a[2]! + (b[2]! - a[2]!) * u),
    ];
  const green = [34, 197, 94];
  const yellow = [234, 179, 8];
  const orange = [249, 115, 22];
  const red = [239, 68, 68];
  if (clamp <= 0.33) {
    const u = clamp / 0.33;
    const [r, g, b] = lerp(green, yellow, u);
    return `rgb(${r},${g},${b})`;
  }
  if (clamp <= 0.66) {
    const u = (clamp - 0.33) / 0.33;
    const [r, g, b] = lerp(yellow, orange, u);
    return `rgb(${r},${g},${b})`;
  }
  const u = (clamp - 0.66) / 0.34;
  const [r, g, b] = lerp(orange, red, Math.min(1, u));
  return `rgb(${r},${g},${b})`;
}

export type TimeGaugeRow = {
  days: number;
  t: number;
  mode: 'stock_age' | 'days_to_sell';
  title: string;
  shortLabel: string;
  missingSellDate?: true;
  fromComponents?: true;
};

export function resolveContainerChildItems(container: InventoryItem, allItems: InventoryItem[]): InventoryItem[] {
  if (!container.isPC && !container.isBundle) return [];
  const seen = new Set<string>();
  const out: InventoryItem[] = [];
  for (const i of allItems) {
    const linked =
      (container.componentIds && container.componentIds.includes(i.id)) || i.parentContainerId === container.id;
    if (!linked || seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

/** Active bundle/PC: same idea as sold (avg buy→sell) — avg days since each part's buy date. */
function aggregateBundleStockAge(children: InventoryItem[], nowMs: number): TimeGaugeRow | null {
  const dayVals: number[] = [];
  for (const c of children) {
    const buyMs = parseItemDateMs(c.buyDate);
    if (buyMs === null) continue;
    dayVals.push(daysBetweenMs(buyMs, nowMs));
  }
  if (dayVals.length === 0) return null;
  const avgDays = dayVals.reduce((a, b) => a + b, 0) / dayVals.length;
  const t = Math.min(1, avgDays / 300);
  const d = Math.round(avgDays);
  return {
    days: avgDays,
    t,
    mode: 'stock_age',
    title: `Bundle/PC: avg ${d}d in stock across ${dayVals.length} component(s)`,
    shortLabel: `${d}d`,
    fromComponents: true,
  };
}

function aggregateBundleDaysToSell(children: InventoryItem[], container: InventoryItem): TimeGaugeRow | null {
  const spans: number[] = [];
  for (const c of children) {
    const buyMs = parseItemDateMs(c.buyDate);
    const sellMs = parseItemDateMs(c.sellDate);
    if (buyMs === null || sellMs === null) continue;
    spans.push(daysBetweenMs(buyMs, sellMs));
  }
  if (spans.length > 0) {
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    const t = Math.min(1, avg / 150);
    const d = Math.round(avg);
    return {
      days: avg,
      t,
      mode: 'days_to_sell',
      title: `Bundle/PC: avg ${d}d buy→sell across ${spans.length} component(s)`,
      shortLabel: `${d}d`,
      fromComponents: true,
    };
  }
  const buyMs = parseItemDateMs(container.buyDate);
  const sellMs = parseItemDateMs(container.sellDate);
  if (buyMs !== null && sellMs !== null) {
    const { days, t } = daysToSellStress(buyMs, sellMs);
    const d = Math.round(days);
    return {
      days,
      t,
      mode: 'days_to_sell',
      title: `${d}d buy→sell (bundle row dates)`,
      shortLabel: `${d}d`,
    };
  }
  return null;
}

export function getTimeGaugeRow(item: InventoryItem, nowMs: number, allItems?: InventoryItem[]): TimeGaugeRow | null {
  const sold = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
  const children =
    (item.isPC || item.isBundle) && allItems?.length
      ? resolveContainerChildItems(item, allItems)
      : [];

  if (item.isPC || item.isBundle) {
    if (sold) {
      if (children.length > 0) {
        const fromKids = aggregateBundleDaysToSell(children, item);
        if (fromKids) return fromKids;
      }
      const buyMs = parseItemDateMs(item.buyDate);
      const sellMs = parseItemDateMs(item.sellDate);
      if (buyMs !== null && sellMs !== null) {
        const { days, t } = daysToSellStress(buyMs, sellMs);
        const d = Math.round(days);
        return {
          days,
          t,
          mode: 'days_to_sell',
          title: `${d}d buy→sell (bundle)`,
          shortLabel: `${d}d`,
        };
      }
      return {
        days: 0,
        t: 0,
        mode: 'days_to_sell',
        title: 'No sell date on bundle or components',
        shortLabel: '—',
        missingSellDate: true,
      };
    }
    if (children.length > 0) {
      const fromKids = aggregateBundleStockAge(children, nowMs);
      if (fromKids) return fromKids;
    }
    const buyMs = parseItemDateMs(item.buyDate);
    if (buyMs === null) return null;
    const { days, t } = stockAgeStress(buyMs, nowMs);
    const d = Math.round(days);
    return {
      days,
      t,
      mode: 'stock_age',
      title: `${d}d in stock (bundle row)`,
      shortLabel: `${d}d`,
    };
  }

  const buyMs = parseItemDateMs(item.buyDate);
  if (buyMs === null) return null;

  if (sold) {
    const sellMs = parseItemDateMs(item.sellDate);
    if (sellMs === null) {
      return {
        days: 0,
        t: 0,
        mode: 'days_to_sell',
        title: 'No sell date — add sold date to see time-to-sell',
        shortLabel: '—',
        missingSellDate: true as const,
      };
    }
    const { days, t } = daysToSellStress(buyMs, sellMs);
    const d = Math.round(days);
    return {
      days,
      t,
      mode: 'days_to_sell',
      title: `${d} days from buy to sell · green = fast, red = slow`,
      shortLabel: `${d}d`,
    };
  }

  const { days, t } = stockAgeStress(buyMs, nowMs);
  const d = Math.round(days);
  return {
    days,
    t,
    mode: 'stock_age',
    title: `${d} days in stock since acquisition · green = recent, red = aging`,
    shortLabel: `${d}d`,
  };
}

export function timeGaugeSortKey(item: InventoryItem, nowMs: number, allItems?: InventoryItem[]): number {
  const row = getTimeGaugeRow(item, nowMs, allItems);
  if (!row) return -1;
  if (row.missingSellDate) return 999999;
  return row.days;
}
