/**
 * RAM kit patterns like "2x8GB", "8x4 GB", "2×16gb" in a product name.
 * Must NOT match model suffixes such as "ACR24D4U1S1ME-8X 8GB" (the -8X is part of the P/N).
 */
const RAM_KIT_IN_NAME = /(?<![A-Za-z0-9-])(\d+)\s*[x×]\s*(\d+)\s*gb\b/i;

/**
 * Leading glued kit prefix only: "2x8GB Crucial" = one kit.
 * Spaced "2x 8GB Samsung" is a purchase count of 2× 8GB sticks (qty always leads in bulk paste).
 */
const RAM_KIT_LINE_PREFIX = /^(\d+)[x×](\d+)\s*(gb|tb)\b/i;

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

/** Model P/N tails like "-8X" must never be read as kit module counts. */
const MODEL_PN_X_SUFFIX = /-[0-9]+x\b/i;

export function resolveRamKitInfo(
  name: string,
  options?: { sourceLine?: string; specs?: Record<string, string | number> }
): RamKitInfo | null {
  const fromName = extractRamKitInfo(name);
  if (fromName) return fromName;

  // Kit patterns only in the product name AFTER stripping leading purchase "Nx".
  // Otherwise "2x 8GB Samsung" (qty 2) is misread as a 2x8GB kit via the source line.
  if (options?.sourceLine) {
    const { name: afterPurchaseQty } = parseBulkLineQuantityAndName(options.sourceLine);
    const fromLine = extractRamKitInfo(afterPurchaseQty);
    if (fromLine) return fromLine;
  }

  const blob = `${name} ${options?.sourceLine || ''}`;
  if (MODEL_PN_X_SUFFIX.test(blob)) return null;

  return extractRamKitFromSpecs(options?.specs);
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
  return null;
}

function extractMemoryType(name: string): string | null {
  const match = name.match(/\b(ddr[2345])\b/i);
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * Extract RAM speed in MHz from free text / spec values.
 * Accepts: 3200MHz, 3200 MHz, 3200MT/s, DDR4-3200, PC4-25600, etc.
 * Does not invent a speed when none is present.
 */
export function extractRamSpeedMHz(text: string): number | null {
  if (!text?.trim()) return null;
  const t = text.replace(/\s+/g, ' ');

  const mhz = t.match(/\b([1-9]\d{2,4})\s*MHz\b/i);
  if (mhz) {
    const n = parseInt(mhz[1]!, 10);
    if (n >= 800 && n <= 10000) return n;
  }

  const mts = t.match(/\b([1-9]\d{2,4})\s*MT\/?s\b/i);
  if (mts) {
    const n = parseInt(mts[1]!, 10);
    if (n >= 800 && n <= 10000) return n;
  }

  const ddrRated = t.match(/\bDDR[2345][- ](\d{3,5})\b/i);
  if (ddrRated) {
    const n = parseInt(ddrRated[1]!, 10);
    if (n >= 800 && n <= 10000) return n;
  }

  // PC3-12800 ≈ 1600, PC4-25600 ≈ 3200 (transfer rate / 8)
  const pc = t.match(/\bPC([34])[- ]?(\d{3,5})\b/i);
  if (pc) {
    const transfer = parseInt(pc[2]!, 10);
    if (Number.isFinite(transfer) && transfer >= 6400) {
      const speed = Math.round(transfer / 8);
      if (speed >= 800 && speed <= 10000) return speed;
    }
  }

  return null;
}

/** Prefer Speed from AI/user specs, then fall back to free-text extraction. */
export function extractRamSpeedFromSpecs(
  specs: Record<string, string | number> | undefined,
  ...texts: Array<string | undefined | null>
): number | null {
  if (specs) {
    for (const [key, value] of Object.entries(specs)) {
      if (!/speed|frequency|takt|clock/i.test(key)) continue;
      const fromSpec = extractRamSpeedMHz(String(value ?? ''));
      if (fromSpec) return fromSpec;
    }
  }
  for (const text of texts) {
    if (!text) continue;
    const fromText = extractRamSpeedMHz(text);
    if (fromText) return fromText;
  }
  return null;
}

function extractSingleStickCapacityGb(text: string): number | null {
  // Prefer standalone "8GB" not part of a kit pattern already handled elsewhere
  const m = text.match(/\b(\d+)\s*GB\b/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return n > 0 ? n : null;
}

/**
 * Strict inventory name from parsed RAM facts only — no marketing rewrite.
 * Kit:   Crucial 16GB (2x8GB) DDR4 3200MHz
 * Stick: Samsung 8GB DDR4 2400MHz
 */
export function formatRamInventoryName(opts: {
  brand?: string | null;
  capacityGb: number;
  modules?: number;
  gbPerStick?: number;
  memoryType?: string | null;
  speedMhz?: number | null;
}): string {
  const brand = (opts.brand || '').trim() || null;
  const memoryType = (opts.memoryType || '').trim().toUpperCase() || null;
  const speedMhz =
    opts.speedMhz != null && Number.isFinite(opts.speedMhz) && opts.speedMhz > 0
      ? Math.round(opts.speedMhz)
      : null;

  const modules = opts.modules ?? 1;
  const gbPerStick = opts.gbPerStick ?? opts.capacityGb;
  const isKit = modules >= 2;

  const parts: string[] = [];
  if (brand) parts.push(brand);

  if (isKit) {
    parts.push(`${opts.capacityGb}GB (${modules}x${gbPerStick}GB)`);
  } else {
    parts.push(`${opts.capacityGb}GB`);
  }

  if (memoryType) parts.push(memoryType);
  if (speedMhz) parts.push(`${speedMhz}MHz`);
  // Only add generic "RAM" when we have no DDR type (keeps the name informative)
  if (!memoryType) parts.push('RAM');

  return parts.join(' ');
}

/**
 * Build a strict display name from raw text + kit info.
 * Uses only brand / kit size / DDR / speed found in the text (or optional overrides).
 */
export function formatRamKitDisplayName(
  rawName: string,
  kit: RamKitInfo,
  options?: {
    sourceLine?: string;
    specs?: Record<string, string | number>;
    speedMhz?: number | null;
    memoryType?: string | null;
    brand?: string | null;
  }
): string {
  const blob = [rawName, options?.sourceLine].filter(Boolean).join(' ');
  const remainder = rawName
    .replace(RAM_KIT_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const brand =
    options?.brand ||
    extractRamBrand(remainder) ||
    extractRamBrand(rawName) ||
    extractRamBrand(blob);
  const memoryType =
    options?.memoryType ||
    extractMemoryType(remainder) ||
    extractMemoryType(rawName) ||
    extractMemoryType(blob) ||
    (options?.specs
      ? extractMemoryType(String(options.specs['Memory Type'] ?? options.specs.memoryType ?? ''))
      : null);
  const speedMhz =
    options?.speedMhz ??
    extractRamSpeedFromSpecs(options?.specs, rawName, options?.sourceLine, blob);

  return formatRamInventoryName({
    brand,
    capacityGb: kit.modules * kit.gbPerStick,
    modules: kit.modules,
    gbPerStick: kit.gbPerStick,
    memoryType,
    speedMhz,
  });
}

/**
 * Strict name for a single-stick (non-kit) RAM line.
 * Returns null if capacity/brand facts can't be extracted.
 */
export function formatRamStickDisplayName(
  rawName: string,
  options?: {
    sourceLine?: string;
    specs?: Record<string, string | number>;
    speedMhz?: number | null;
  }
): string | null {
  const blob = [rawName, options?.sourceLine].filter(Boolean).join(' ');
  if (!looksLikeRamProduct(blob) && !looksLikeRamProduct(rawName)) return null;

  const capacityGb =
    parseGbValue(options?.specs?.['GB per Stick']) ||
    parseGbValue(options?.specs?.Capacity) ||
    parseGbValue(options?.specs?.['Kit Capacity']) ||
    extractSingleStickCapacityGb(rawName) ||
    extractSingleStickCapacityGb(blob);
  if (!capacityGb) return null;

  const brand = extractRamBrand(rawName) || extractRamBrand(blob);
  const memoryType =
    extractMemoryType(rawName) ||
    extractMemoryType(blob) ||
    (options?.specs
      ? extractMemoryType(String(options.specs['Memory Type'] ?? options.specs.memoryType ?? ''))
      : null);
  const speedMhz =
    options?.speedMhz ??
    extractRamSpeedFromSpecs(options?.specs, rawName, options?.sourceLine, blob);

  return formatRamInventoryName({
    brand,
    capacityGb,
    modules: 1,
    gbPerStick: capacityGb,
    memoryType,
    speedMhz,
  });
}

export function buildRamKitSpecs(
  kit: RamKitInfo,
  options?: {
    speedMhz?: number | null;
    memoryType?: string | null;
    sourceText?: string;
  }
): Record<string, string> {
  const kitCapacityGb = kit.modules * kit.gbPerStick;
  const specs: Record<string, string> = {
    Modules: String(kit.modules),
    'GB per Stick': `${kit.gbPerStick}GB`,
    'Kit Capacity': `${kitCapacityGb}GB`,
  };

  const memoryType =
    options?.memoryType ||
    (options?.sourceText ? extractMemoryType(options.sourceText) : null);
  if (memoryType) specs['Memory Type'] = memoryType;

  const speed =
    options?.speedMhz ??
    (options?.sourceText ? extractRamSpeedMHz(options.sourceText) : null);
  if (speed) specs.Speed = `${speed}MHz`;

  return specs;
}

/** Merge Speed / Memory Type into specs from text. Never invents missing speed. */
export function enrichRamSpecsFromText(
  specs: Record<string, string | number> | undefined,
  ...texts: Array<string | undefined | null>
): Record<string, string | number> {
  const next: Record<string, string | number> = { ...(specs || {}) };
  const joined = texts.filter(Boolean).join(' ');

  if (!String(next['Memory Type'] ?? '').trim()) {
    const mt = extractMemoryType(joined);
    if (mt) next['Memory Type'] = mt;
  }

  const existingSpeed = extractRamSpeedMHz(String(next.Speed ?? next.speed ?? ''));
  const parsedSpeed = extractRamSpeedFromSpecs(next, ...texts);
  if (parsedSpeed) {
    next.Speed = `${parsedSpeed}MHz`;
  } else if (existingSpeed) {
    next.Speed = `${existingSpeed}MHz`;
  }

  return next;
}

/**
 * Split a bulk line into purchase quantity vs product name.
 * Purchase qty is always the leading "Nx …". Everything else (model -8X, mid-line 2x8GB kits) is ignored for qty.
 * "3x Crucial 2x8GB" → qty 3, name "Crucial 2x8GB"
 * "2x 8GB Samsung" → qty 2, name "8GB Samsung" (not a kit)
 * "2x8GB Crucial" → qty 1 (glued kit prefix only)
 */
export function parseBulkLineQuantityAndName(rawLine: string): { name: string; quantity: number } {
  const trimmed = rawLine.trim();
  if (!trimmed) return { name: '', quantity: 1 };

  // Glued kit at line start only (2x8GB…), not spaced "2x 8GB …"
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

/**
 * After AI specs parse: force a strict RAM name from parsed facts (never keep a free AI rename).
 * Returns undefined when the item does not look like RAM / lacks capacity facts.
 */
export function buildStrictRamStandardizedName(
  originalName: string,
  specs?: Record<string, string | number>,
  categoryContext?: string
): string | undefined {
  const isRamContext =
    /ram/i.test(categoryContext || '') ||
    looksLikeRamProduct(originalName) ||
    !!(specs && (specs.Modules != null || specs['Kit Capacity'] != null || specs['GB per Stick'] != null));

  if (!isRamContext) return undefined;

  const kit = resolveRamKitInfo(originalName, { specs });
  if (kit) {
    return formatRamKitDisplayName(originalName, kit, { specs });
  }

  const stick = formatRamStickDisplayName(originalName, { specs });
  return stick || undefined;
}
