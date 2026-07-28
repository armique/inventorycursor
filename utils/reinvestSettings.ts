/** Per-group desired-margin overrides for the Reinvest Assistant, keyed by ReinvestGroup.key.
 * Mirrors the localStorage settings pattern in utils/flipCoach.ts. */

const REINVEST_MARGIN_OVERRIDES_KEY = 'reinvest_margin_overrides_v1';

export function loadReinvestMarginOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(REINVEST_MARGIN_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveReinvestMarginOverride(groupKey: string, marginPct: number): void {
  const overrides = loadReinvestMarginOverrides();
  overrides[groupKey] = Math.min(80, Math.max(10, Math.round(marginPct / 5) * 5));
  try {
    localStorage.setItem(REINVEST_MARGIN_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    /* quota / private mode */
  }
}

export function clearReinvestMarginOverride(groupKey: string): void {
  const overrides = loadReinvestMarginOverrides();
  if (!(groupKey in overrides)) return;
  delete overrides[groupKey];
  try {
    localStorage.setItem(REINVEST_MARGIN_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    /* quota / private mode */
  }
}
