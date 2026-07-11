/** Set listing price cents to .99 while keeping the euro whole part (47.54 → 47.99). */
export function roundPriceCentsTo99(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const euros = Math.floor(price);
  return Math.round((euros + 0.99) * 100) / 100;
}

export function parseEbayListingPriceValue(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
