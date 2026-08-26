import { roundMoney } from '../services/financialAggregation';

/** Largest-remainder allocation so rounded cents sum exactly to `total`. */
export function allocateMoneyByWeight(
  rows: Array<{ id: string; weight: number }>,
  total: number
): Map<string, number> {
  const out = new Map<string, number>();
  if (!rows.length) return out;
  const amount = roundMoney(total);
  const weights = rows.map((r) => Math.max(0, Number(r.weight) || 0));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (!(amount > 0)) {
    for (const row of rows) out.set(row.id, 0);
    return out;
  }
  const raw = rows.map((row, i) => {
    const share = weightSum > 0 ? amount * (weights[i] / weightSum) : amount / rows.length;
    const floored = Math.floor(share * 100) / 100;
    return { id: row.id, floored, frac: share - floored };
  });
  let remainderCents = Math.round((amount - raw.reduce((s, r) => s + r.floored, 0)) * 100);
  if (remainderCents > 0) {
    const byFrac = [...raw.keys()].sort((a, b) => raw[b].frac - raw[a].frac);
    for (const idx of byFrac) {
      if (remainderCents <= 0) break;
      raw[idx].floored = roundMoney(raw[idx].floored + 0.01);
      remainderCents -= 1;
    }
  } else if (remainderCents < 0) {
    const byFracAsc = [...raw.keys()].sort((a, b) => raw[a].frac - raw[b].frac);
    for (const idx of byFracAsc) {
      if (remainderCents >= 0) break;
      raw[idx].floored = roundMoney(raw[idx].floored - 0.01);
      remainderCents += 1;
    }
  }
  for (const row of raw) out.set(row.id, row.floored);
  return out;
}
