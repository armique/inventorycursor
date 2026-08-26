/**
 * Calendar day key YYYY-MM-DD in local timezone for bucketing charts and filters.
 * Date-only strings (YYYY-MM-DD) are used as-is to avoid UTC shift from `new Date('2026-04-04')`.
 */
export function toLocalCalendarDateKey(raw: string | Date | undefined | null): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** YYYY-MM for monthly rollups; keeps date-only YYYY-MM-DD calendar-accurate (no UTC day shift). */
export function yearMonthKeyFromDate(raw: string | Date | undefined | null): string {
  const day = toLocalCalendarDateKey(raw);
  return day.length >= 7 ? day.slice(0, 7) : '';
}

export function currentLocalYearMonth(ref: Date = new Date()): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

/** Today's calendar day as YYYY-MM-DD (local timezone) — used as Acquired for newly composed PC/bundles. */
export function todayLocalDateKey(ref: Date = new Date()): string {
  return toLocalCalendarDateKey(ref);
}

/**
 * Mean calendar day across a set of dates, as YYYY-MM-DD — used as Acquired for a bundle
 * built from parts bought on different days, instead of stamping the day it was composed.
 * Falls back to today when none of the inputs parse to a real date.
 */
export function averageDateKey(dates: (string | Date | undefined | null)[]): string {
  const dayIndexes = dates
    .map((raw) => toLocalCalendarDateKey(raw))
    .filter((key): key is string => Boolean(key))
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 86400000;
    });
  if (!dayIndexes.length) return todayLocalDateKey();
  const avgIndex = Math.round(dayIndexes.reduce((a, b) => a + b, 0) / dayIndexes.length);
  const avg = new Date(avgIndex * 86400000);
  return `${avg.getUTCFullYear()}-${String(avg.getUTCMonth() + 1).padStart(2, '0')}-${String(avg.getUTCDate()).padStart(2, '0')}`;
}

const DISPLAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact table display: `22 Aug 26` from ISO or date input. */
export function formatInventoryDisplayDate(raw: string | Date | undefined | null): string {
  const key = toLocalCalendarDateKey(raw);
  if (!key) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const day = parseInt(m[3], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const month = DISPLAY_MONTHS[monthIdx] ?? m[2];
  return `${day} ${month} ${m[1].slice(2)}`;
}
