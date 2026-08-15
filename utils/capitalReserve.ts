const KEY = 'capital_reserve_v1';

export type CapitalReserveSettings = {
  taxReserve: number;
  filamentReserve: number;
  livingWeekly: number;
  weeks: number;
};

export const DEFAULT_CAPITAL_RESERVE: CapitalReserveSettings = {
  taxReserve: 0,
  filamentReserve: 40,
  livingWeekly: 0,
  weeks: 2,
};

export function loadCapitalReserve(): CapitalReserveSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CAPITAL_RESERVE };
    const parsed = JSON.parse(raw) as Partial<CapitalReserveSettings>;
    return {
      taxReserve: Math.max(0, Number(parsed.taxReserve) || 0),
      filamentReserve: Math.max(0, Number(parsed.filamentReserve) || 0),
      livingWeekly: Math.max(0, Number(parsed.livingWeekly) || 0),
      weeks: Math.max(1, Math.round(Number(parsed.weeks) || 2)),
    };
  } catch {
    return { ...DEFAULT_CAPITAL_RESERVE };
  }
}

export function saveCapitalReserve(next: CapitalReserveSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export function untouchableCapital(s: CapitalReserveSettings): number {
  return Math.max(0, s.taxReserve + s.filamentReserve + s.livingWeekly * s.weeks);
}

export function freeToSpend(cashOnHand: number, s: CapitalReserveSettings): number {
  return Math.max(0, Math.round((cashOnHand - untouchableCapital(s)) * 100) / 100);
}
