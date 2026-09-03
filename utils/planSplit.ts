/**
 * Pure split planner (Part C Rules 1–4).
 * Nothing is persisted — throws if parts + remainder do not equal the purchase price.
 */
import { roundMoney } from '../services/financialAggregation';

export type PlannedPartInput = {
  /** Stable key (not display label) — Rule 10. */
  key: string;
  label: string;
  name: string;
  /** Weight for allocation — never a stored price estimate. */
  weight: number;
  /** Explicit euro lock; omit when weight-driven. */
  lockedBuyPrice?: number;
  quantity?: number;
  /** 1-based unit indexes marked defective inside the expansion (Rule 4). */
  faultyUnits?: number[];
  category?: string;
  subCategory?: string;
  /** When true and weight/locked is 0, this line is the remainder and does not join equal-split (Rule 3). */
  isRemainder?: boolean;
};

export type PlannedUnit = {
  key: string;
  parentKey: string;
  name: string;
  label: string;
  buyPrice: number;
  isDefective: boolean;
  category?: string;
  subCategory?: string;
  isRemainder: boolean;
};

export type SplitPlan = {
  originalBuyPrice: number;
  units: PlannedUnit[];
  remainder: PlannedUnit | null;
  totalAllocated: number;
};

export type PlanSplitOptions = {
  /** When every non-remainder free weight is 0, split equally among parts only (Rule 3). */
  equalSplitWhenNoWeights?: boolean;
};

function toCents(n: number): number {
  return Math.round(Math.max(0, Number(n) || 0) * 100);
}

function fromCents(c: number): number {
  return roundMoney(c / 100);
}

/**
 * Allocate `totalCents` across weights in whole cents; leftover cents go to the largest
 * fractional remainders (Hamilton). Sum is exact.
 */
export function allocateCentsByWeight(
  totalCents: number,
  parts: Array<{ key: string; weight: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!parts.length) return out;
  if (totalCents <= 0) {
    for (const p of parts) out[p.key] = 0;
    return out;
  }

  const positive = parts.filter((p) => p.weight > 0);
  const pool = positive.length ? positive : parts.map((p) => ({ ...p, weight: 1 }));
  const sumW = pool.reduce((a, b) => a + b.weight, 0);
  const raw = pool.map((p) => (totalCents * p.weight) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const fracs = raw.map((x, i) => ({ i, f: x - floors[i], line: floors[i] }));
  // Prefer larger fractional remainder; tie-break toward larger floor (largest lines).
  fracs.sort((a, b) => b.f - a.f || b.line - a.line);
  const cents = [...floors];
  for (let k = 0; k < left; k++) cents[fracs[k % fracs.length].i] += 1;
  pool.forEach((p, i) => {
    out[p.key] = cents[i];
  });
  for (const p of parts) {
    if (out[p.key] == null) out[p.key] = 0;
  }
  return out;
}

type ExpandedPart = PlannedPartInput & {
  unitIndex: number;
  unitCount: number;
  isDefectiveUnit: boolean;
};

function expandPart(part: PlannedPartInput): ExpandedPart[] {
  const qty = Math.max(1, Math.floor(Number(part.quantity) || 1));
  const faulty = new Set((part.faultyUnits || []).map((n) => Math.floor(n)));
  const out: ExpandedPart[] = [];
  for (let i = 1; i <= qty; i++) {
    const name =
      qty > 1
        ? `${part.name.replace(/\s*\(\d+\s+of\s+\d+\)\s*$/i, '').trim()} (${i} of ${qty})`
        : part.name;
    out.push({
      ...part,
      key: qty > 1 ? `${part.key}__u${i}` : part.key,
      name,
      label: qty > 1 ? `${part.label} (${i}/${qty})` : part.label,
      quantity: 1,
      weight: part.weight / qty,
      lockedBuyPrice: undefined,
      isDefectiveUnit: faulty.has(i),
      unitIndex: i,
      unitCount: qty,
    });
  }
  // Locked price on a multi-qty row: split locked euros across units in cents.
  if (part.lockedBuyPrice != null && qty > 1) {
    const shares = allocateCentsByWeight(
      toCents(part.lockedBuyPrice),
      out.map((u) => ({ key: u.key, weight: 1 }))
    );
    return out.map((u) => ({
      ...u,
      lockedBuyPrice: fromCents(shares[u.key] || 0),
      weight: part.weight / qty,
    }));
  }
  if (part.lockedBuyPrice != null && qty === 1) {
    return out.map((u) => ({ ...u, lockedBuyPrice: part.lockedBuyPrice }));
  }
  return out;
}

/**
 * Compute the whole plan. Throws if allocated total ≠ original buy price.
 */
export function planSplit(
  original: { id?: string; name?: string; buyPrice: number },
  parts: PlannedPartInput[],
  options?: PlanSplitOptions
): SplitPlan {
  if (!parts.length) {
    throw new Error('planSplit requires at least one part');
  }

  const totalBuy = roundMoney(Number(original.buyPrice) || 0);
  const totalCents = toCents(totalBuy);

  const expanded = parts.flatMap(expandPart);

  const locked = expanded.filter((p) => p.lockedBuyPrice != null);
  const free = expanded.filter((p) => p.lockedBuyPrice == null);

  let lockedCents = 0;
  const centsByKey: Record<string, number> = {};
  for (const p of locked) {
    const c = toCents(Number(p.lockedBuyPrice) || 0);
    centsByKey[p.key] = c;
    lockedCents += c;
  }

  let remaining = totalCents - lockedCents;
  if (remaining < 0) {
    throw new Error(
      `Locked part prices (€${fromCents(lockedCents).toFixed(2)}) exceed purchase price (€${totalBuy.toFixed(2)})`
    );
  }

  const freeRemainder = free.filter((p) => p.isRemainder);
  const freeParts = free.filter((p) => !p.isRemainder);

  // Rule 3: remainder with explicit zero must not join equal-split among parts.
  const remainderLockedZero = locked.some(
    (p) => p.isRemainder && toCents(Number(p.lockedBuyPrice) || 0) === 0
  );
  const noPartWeights = freeParts.every((p) => !(p.weight > 0));
  const equalMode =
    options?.equalSplitWhenNoWeights !== false &&
    (noPartWeights || freeParts.every((p) => p.weight === 0));

  if (free.length) {
    let pool = free;
    if (equalMode && (remainderLockedZero || freeRemainder.some((p) => !(p.weight > 0)))) {
      // Equal among parts only; remainder free lines get 0 from this pool.
      pool = freeParts.length ? freeParts : free.filter((p) => !p.isRemainder);
      for (const r of freeRemainder) centsByKey[r.key] = 0;
    }

    if (!pool.length && remaining > 0) {
      throw new Error('Nothing left to absorb the remaining purchase price');
    }

    if (pool.length) {
      const weights = equalMode
        ? pool.map((p) => ({ key: p.key, weight: 1 }))
        : pool.map((p) => ({ key: p.key, weight: Math.max(0, p.weight) }));
      const alloc = allocateCentsByWeight(remaining, weights);
      for (const p of pool) {
        centsByKey[p.key] = alloc[p.key] || 0;
      }
      remaining = 0;
    }
  }

  // Any leftover after locks (no free lines) is an error — do not silently drop cents.
  const allocated = Object.values(centsByKey).reduce((a, b) => a + b, 0);
  if (allocated !== totalCents) {
    // If only locked remainder at 0 and free parts absorbed all — already handled.
    // Else force exactness failure.
    if (Math.abs(allocated - totalCents) > 0) {
      throw new Error(
        `Split must total €${totalBuy.toFixed(2)} exactly (got €${fromCents(allocated).toFixed(2)})`
      );
    }
  }

  const units: PlannedUnit[] = expanded.map((p) => {
    const buyPrice = fromCents(centsByKey[p.key] || 0);
    return {
      key: p.key,
      parentKey: String(p.key).replace(/__u\d+$/, ''),
      name: p.name,
      label: p.label,
      buyPrice,
      isDefective: Boolean((p as { isDefectiveUnit?: boolean }).isDefectiveUnit),
      category: p.category,
      subCategory: p.subCategory,
      isRemainder: Boolean(p.isRemainder),
    };
  });

  const sum = roundMoney(units.reduce((s, u) => s + u.buyPrice, 0));
  if (sum !== totalBuy) {
    throw new Error(
      `Split must total €${totalBuy.toFixed(2)} exactly (got €${sum.toFixed(2)}) — same as you paid`
    );
  }

  const remainder = units.find((u) => u.isRemainder) || null;
  return {
    originalBuyPrice: totalBuy,
    units,
    remainder,
    totalAllocated: sum,
  };
}
