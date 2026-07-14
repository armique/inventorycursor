/** RAM kit patterns like "2x8GB", "8x4 GB", "2×16gb" embedded in a product name. */
const RAM_KIT_IN_NAME = /(\d+)\s*[x×]\s*(\d+)\s*gb\b/i;

/** Leading kit prefix — not a purchase quantity (e.g. "2x8GB Crucial" is one kit, not two items). */
const RAM_KIT_LINE_PREFIX = /^(\d+)\s*[x×]\s*(\d+)\s*(gb|tb)\b/i;

const RAM_NAME_HINT =
  /(ddr[2345]|ram\b|memory\b|dimm|sodimm|rdimm|jedec|12800|10600|1333|2rx8|1rx8|crucial|kingston|corsair|g\.?skill|hynix|micron|samsung|vengeance|trident|ballistix)/i;

export interface RamKitInfo {
  modules: number;
  gbPerStick: number;
}

export function looksLikeRamProduct(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return RAM_NAME_HINT.test(n) || RAM_KIT_IN_NAME.test(n);
}

export function extractRamKitInfo(name: string): RamKitInfo | null {
  const trimmed = name.trim();
  if (!trimmed || !looksLikeRamProduct(trimmed)) return null;

  const kit = trimmed.match(RAM_KIT_IN_NAME);
  if (!kit) return null;

  const modules = Math.max(1, parseInt(kit[1]!, 10) || 1);
  const gbPerStick = Math.max(1, parseInt(kit[2]!, 10) || 0);
  if (!gbPerStick) return null;

  return { modules, gbPerStick };
}

export function buildRamKitSpecs(kit: RamKitInfo): Record<string, string> {
  const kitCapacityGb = kit.modules * kit.gbPerStick;
  return {
    Modules: String(kit.modules),
    'GB per Stick': `${kit.gbPerStick}GB`,
    'Kit Capacity': `${kitCapacityGb}GB`,
  };
}

/**
 * Split a bulk line into purchase quantity vs product name.
 * "3x Crucial 2x8GB" → qty 3, name "Crucial 2x8GB"
 * "2x8GB Crucial" → qty 1 (kit size, not two inventory rows)
 */
export function parseBulkLineQuantityAndName(rawLine: string): { name: string; quantity: number } {
  const trimmed = rawLine.trim();
  if (!trimmed) return { name: '', quantity: 1 };

  if (RAM_KIT_LINE_PREFIX.test(trimmed)) {
    return { name: trimmed, quantity: 1 };
  }

  const m = trimmed.match(/^(\d+)\s*[x×]\s*(.+)$/i);
  if (!m) return { name: trimmed, quantity: 1 };

  return {
    quantity: Math.max(1, parseInt(m[1]!, 10) || 1),
    name: m[2]!.trim(),
  };
}

/**
 * Resolve how many inventory rows to create. AI often sets quantity = module count (e.g. 2 for 2x8GB).
 */
export function resolveRamInventoryQuantity(
  requestedQty: number,
  kit: RamKitInfo | null,
  lineQuantity = 1
): number {
  const qty = Math.max(1, Math.floor(requestedQty) || 1);
  if (!kit) return qty;
  if (qty === kit.modules && lineQuantity === 1) return 1;
  return qty;
}
