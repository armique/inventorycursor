import { ItemStatus, type InventoryItem } from '../types';

export function parseItemDateMs(d: string | undefined): number | null {
  if (!d || !String(d).trim()) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function daysBetweenMs(start: number, end: number): number {
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
};

export function getTimeGaugeRow(item: InventoryItem, nowMs: number): TimeGaugeRow | null {
  if (item.isPC || item.isBundle) return null;
  const buyMs = parseItemDateMs(item.buyDate);
  if (buyMs === null) return null;

  const sold = item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
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

/** Numeric sort key: days for display metric (stock age or days-to-sell). */
export function timeGaugeSortKey(item: InventoryItem, nowMs: number): number {
  const row = getTimeGaugeRow(item, nowMs);
  if (!row) return -1;
  if (row.missingSellDate) return 999999;
  return row.days;
}
