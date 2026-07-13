/** Shared text filter for eBay Tools list/table views. */
export function normalizeEbayToolSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesEbayToolSearch(
  query: string,
  parts: Array<string | number | null | undefined>
): boolean {
  const q = normalizeEbayToolSearchQuery(query);
  if (!q) return true;
  const hay = parts
    .filter((p) => p != null && String(p).trim())
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function filterByEbayToolSearch<T>(
  rows: T[],
  query: string,
  partsForRow: (row: T) => Array<string | number | null | undefined>
): T[] {
  const q = normalizeEbayToolSearchQuery(query);
  if (!q) return rows;
  return rows.filter((row) => matchesEbayToolSearch(q, partsForRow(row)));
}
