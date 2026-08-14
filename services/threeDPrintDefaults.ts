/** Persisted admin defaults for the 3D print price calculator (localStorage). */

export type QuantityDiscountTier = {
  minQty: number;
  /** Inclusive upper bound; omit or null = no upper limit. */
  maxQty: number | null;
  discountPct: number;
};

/** Extensible material catalog — add PETG/ABS/etc. without rewriting the calculator. */
export type FilamentMaterialEntry = {
  key: string;
  label: string;
  /** Default €/kg when no per-color override applies. */
  pricePerKg: number;
  /** Optional per-color €/kg overrides (e.g. Black vs White). */
  colorPrices?: Record<string, number>;
};

export type ThreeDPrintCalculatorSettings = {
  materials: FilamentMaterialEntry[];
  electricityPricePerKwh: number;
  printerPowerW: number;
  printerCost: number;
  printerLifetimeHours: number;
  additionalCostPerPart: number;
  wastePct: number;
  profitMarkupPct: number;
  minimumOrderPrice: number;
  quantityDiscountEnabled: boolean;
  quantityDiscountTiers: QuantityDiscountTier[];
};

export const THREE_D_PRINT_DEFAULTS_KEY = 'three_d_print_calculator_defaults_v1';

export const DEFAULT_MATERIALS: FilamentMaterialEntry[] = [
  {
    key: 'PLA',
    label: 'PLA',
    pricePerKg: 13,
    colorPrices: { Black: 13, White: 13 },
  },
];

export const DEFAULT_QUANTITY_DISCOUNT_TIERS: QuantityDiscountTier[] = [
  { minQty: 1, maxQty: 4, discountPct: 0 },
  { minQty: 5, maxQty: 9, discountPct: 5 },
  { minQty: 10, maxQty: 24, discountPct: 10 },
  { minQty: 25, maxQty: null, discountPct: 15 },
];

export const DEFAULT_THREE_D_PRINT_SETTINGS: ThreeDPrintCalculatorSettings = {
  materials: DEFAULT_MATERIALS,
  electricityPricePerKwh: 0.32,
  printerPowerW: 100,
  printerCost: 400,
  printerLifetimeHours: 5000,
  additionalCostPerPart: 0.3,
  wastePct: 10,
  profitMarkupPct: 100,
  minimumOrderPrice: 10,
  quantityDiscountEnabled: true,
  quantityDiscountTiers: DEFAULT_QUANTITY_DISCOUNT_TIERS,
};

function clampNonNegative(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeTiers(raw: unknown): QuantityDiscountTier[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_QUANTITY_DISCOUNT_TIERS;
  const out: QuantityDiscountTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const row = t as Partial<QuantityDiscountTier>;
    const minQty = Math.max(1, Math.round(Number(row.minQty) || 1));
    const maxQty =
      row.maxQty == null || row.maxQty === undefined
        ? null
        : Math.max(minQty, Math.round(Number(row.maxQty) || minQty));
    const discountPct = Math.min(100, Math.max(0, Number(row.discountPct) || 0));
    out.push({ minQty, maxQty, discountPct });
  }
  return out.length ? out : DEFAULT_QUANTITY_DISCOUNT_TIERS;
}

function normalizeMaterials(raw: unknown): FilamentMaterialEntry[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_MATERIALS;
  const out: FilamentMaterialEntry[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Partial<FilamentMaterialEntry>;
    const key = String(row.key || row.label || '').trim();
    if (!key) continue;
    const label = String(row.label || key).trim();
    const pricePerKg = clampNonNegative(Number(row.pricePerKg), 13);
    const colorPrices =
      row.colorPrices && typeof row.colorPrices === 'object'
        ? Object.fromEntries(
            Object.entries(row.colorPrices).map(([c, v]) => [c, clampNonNegative(Number(v), pricePerKg)]),
          )
        : undefined;
    out.push({ key, label, pricePerKg, ...(colorPrices ? { colorPrices } : {}) });
  }
  return out.length ? out : DEFAULT_MATERIALS;
}

export function loadThreeDPrintSettings(): ThreeDPrintCalculatorSettings {
  try {
    const raw = localStorage.getItem(THREE_D_PRINT_DEFAULTS_KEY);
    if (!raw) return { ...DEFAULT_THREE_D_PRINT_SETTINGS, materials: [...DEFAULT_MATERIALS], quantityDiscountTiers: [...DEFAULT_QUANTITY_DISCOUNT_TIERS] };
    const parsed = JSON.parse(raw) as Partial<ThreeDPrintCalculatorSettings>;
    return {
      materials: normalizeMaterials(parsed.materials),
      electricityPricePerKwh: clampNonNegative(Number(parsed.electricityPricePerKwh), 0.32),
      printerPowerW: Math.max(1, Number(parsed.printerPowerW) || 100),
      printerCost: clampNonNegative(Number(parsed.printerCost), 400),
      printerLifetimeHours: Math.max(1, Number(parsed.printerLifetimeHours) || 5000),
      additionalCostPerPart: clampNonNegative(Number(parsed.additionalCostPerPart), 0.3),
      wastePct: Math.min(100, Math.max(0, Number(parsed.wastePct) ?? 10)),
      profitMarkupPct: Math.min(500, Math.max(0, Number(parsed.profitMarkupPct) ?? 100)),
      minimumOrderPrice: clampNonNegative(Number(parsed.minimumOrderPrice), 10),
      quantityDiscountEnabled: parsed.quantityDiscountEnabled !== false,
      quantityDiscountTiers: normalizeTiers(parsed.quantityDiscountTiers),
    };
  } catch {
    return { ...DEFAULT_THREE_D_PRINT_SETTINGS, materials: [...DEFAULT_MATERIALS], quantityDiscountTiers: [...DEFAULT_QUANTITY_DISCOUNT_TIERS] };
  }
}

export function saveThreeDPrintSettings(settings: ThreeDPrintCalculatorSettings): void {
  try {
    localStorage.setItem(THREE_D_PRINT_DEFAULTS_KEY, JSON.stringify(settings));
  } catch {
    /* quota / private mode */
  }
}

/** Resolve €/kg for a material + color pair (extensible for future materials). */
export function resolveFilamentPricePerKg(
  settings: ThreeDPrintCalculatorSettings,
  materialKey: string,
  color: string,
  overridePerKg?: number,
): number {
  if (overridePerKg != null && Number.isFinite(overridePerKg) && overridePerKg >= 0) {
    return overridePerKg;
  }
  const mat =
    settings.materials.find((m) => m.key.toLowerCase() === materialKey.toLowerCase()) ||
    settings.materials[0];
  if (!mat) return 13;
  const colorPrice = mat.colorPrices?.[color];
  if (colorPrice != null && Number.isFinite(colorPrice)) return colorPrice;
  return mat.pricePerKg;
}

export const FILAMENT_COLOR_OPTIONS = ['Black', 'White'] as const;
export type FilamentColorOption = (typeof FILAMENT_COLOR_OPTIONS)[number];
