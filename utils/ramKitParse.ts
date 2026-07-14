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

function parseGbValue(value: unknown): number | null {
  const match = String(value ?? '').match(/(\d+)\s*gb\b/i);
  return match ? Math.max(1, parseInt(match[1]!, 10) || 0) || null : null;
}

function parseModuleCount(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const kit = raw.match(/(\d+)\s*[x×]/i);
  if (kit) return Math.max(1, parseInt(kit[1]!, 10) || 0) || null;
  const num = parseInt(raw.replace(/x$/i, ''), 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** Build kit info from AI specs when the simplified name dropped "2x8GB". */
export function extractRamKitFromSpecs(specs?: Record<string, string | number>): RamKitInfo | null {
  if (!specs) return null;

  for (const value of Object.values(specs)) {
    const fromKitField = extractRamKitInfo(String(value));
    if (fromKitField) return fromKitField;
  }

  const modules =
    parseModuleCount(specs.Modules ?? specs.modules) ??
    parseModuleCount(specs.Kit ?? specs.kit);
  const gbPerStick = parseGbValue(
    specs['GB per Stick'] ?? specs['GB Per Stick'] ?? specs['Gb per Stick'] ?? specs.Capacity ?? specs.capacity
  );
  const kitCapacityGb = parseGbValue(specs['Kit Capacity'] ?? specs['Kit capacity']);

  if (modules && gbPerStick) return { modules, gbPerStick };
  if (modules && kitCapacityGb && kitCapacityGb % modules === 0) {
    return { modules, gbPerStick: kitCapacityGb / modules };
  }
  if (gbPerStick && kitCapacityGb && kitCapacityGb % gbPerStick === 0) {
    return { modules: kitCapacityGb / gbPerStick, gbPerStick };
  }

  return null;
}

export function resolveRamKitInfo(
  name: string,
  options?: { sourceLine?: string; specs?: Record<string, string | number> }
): RamKitInfo | null {
  return (
    extractRamKitInfo(name) ??
    (options?.sourceLine ? extractRamKitInfo(options.sourceLine) : null) ??
    extractRamKitFromSpecs(options?.specs)
  );
}

const RAM_BRANDS = [
  'sk hynix',
  'g.skill',
  'gskill',
  'teamgroup',
  'silicon power',
  'crucial',
  'kingston',
  'corsair',
  'hynix',
  'micron',
  'samsung',
  'vengeance',
  'ballistix',
  'patriot',
  'adata',
  'xpg',
  'lexar',
  'apacer',
  'transcend',
  'geil',
  'pny',
  'fury',
  'trident',
];

function titleCaseBrand(brand: string): string {
  return brand
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractRamBrand(name: string): string | null {
  const lower = name.toLowerCase();
  const sorted = [...RAM_BRANDS].sort((a, b) => b.length - a.length);
  for (const brand of sorted) {
    const re = new RegExp(`\\b${brand.replace(/\./g, '\\.')}\\b`, 'i');
    const match = name.match(re);
    if (match) return titleCaseBrand(match[0]);
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (/^ddr\d$/i.test(token)) continue;
    if (/^\d/.test(token)) continue;
    if (/gb$/i.test(token)) continue;
    if (/^[x×]$/i.test(token)) continue;
    return titleCaseBrand(token);
  }
  return null;
}

function extractMemoryType(name: string): string | null {
  const match = name.match(/\b(ddr[2345])\b/i);
  return match ? match[1]!.toUpperCase() : null;
}

export function formatRamKitDisplayName(rawName: string, kit: RamKitInfo): string {
  const remainder = rawName
    .replace(RAM_KIT_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const brand = extractRamBrand(remainder) || extractRamBrand(rawName);
  const memoryType = extractMemoryType(remainder) || extractMemoryType(rawName);
  const kitTotalGb = kit.modules * kit.gbPerStick;
  const kitPart = `${kit.modules}x${kit.gbPerStick}GB`;

  const parts: string[] = [];
  if (brand) parts.push(brand);
  parts.push(`${kitTotalGb}GB`);
  parts.push(`(${kitPart})`);
  if (memoryType) parts.push(memoryType);
  parts.push('RAM');

  return parts.join(' ');
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
