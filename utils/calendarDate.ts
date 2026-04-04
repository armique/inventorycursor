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
