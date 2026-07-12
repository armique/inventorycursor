/**
 * Filament spool inventory: purchase weight, remaining stock, usage log, €/kg for calculator.
 * Persists in localStorage (`filament_stock_v1`). Migrates legacy `3d_print_filaments` profiles.
 */

export type FilamentPurchaseSource = 'manual' | 'amazon' | 'ebay' | 'other';

export type FilamentUsageKind = 'print' | 'waste' | 'manual' | 'adjustment';

export interface FilamentUsageRecord {
  id: string;
  spoolId: string;
  grams: number;
  date: string;
  kind: FilamentUsageKind;
  inventoryItemId?: string;
  inventoryItemName?: string;
  note?: string;
}

export interface FilamentSpool {
  id: string;
  type: string;
  color: string;
  brand?: string;
  pricePerKg: number;
  /** Total filament on the spool when bought (grams). */
  purchasedGrams: number;
  /** Manual override — when set, tracks remaining directly (still logs usages). */
  remainingGramsOverride?: number | null;
  purchasedAt: string;
  source: FilamentPurchaseSource;
  vendor?: string;
  totalPaid?: number;
  expenseId?: string;
  ebayOrderId?: string;
  /** Stable key for a purchase line (order + item). */
  ebayLineKey?: string;
  note?: string;
  archived?: boolean;
  usages: FilamentUsageRecord[];
  createdAt: string;
}

export interface FilamentStockState {
  spools: FilamentSpool[];
  updatedAt: string;
}

const STORAGE_KEY = 'filament_stock_v1';
const LEGACY_KEY = '3d_print_filaments';

export function roundGrams(n: number): number {
  return Math.round(Math.max(0, n) * 10) / 10;
}

export function kgToGrams(kg: number): number {
  return roundGrams(kg * 1000);
}

export function gramsToKgDisplay(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${Math.round(grams)} g`;
}

function emptyState(): FilamentStockState {
  return { spools: [], updatedAt: new Date().toISOString() };
}

function saveState(state: FilamentStockState): void {
  const next = { ...state, updatedAt: new Date().toISOString() };
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('filament-stock-updated'));
    }
  } catch {
    /* ignore in non-browser environments */
  }
}

function migrateLegacyProfiles(): FilamentSpool[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const legacy = JSON.parse(raw) as { id: string; type: string; color: string; price: number }[];
    if (!Array.isArray(legacy)) return [];
    return legacy.map((p) => ({
      id: p.id.startsWith('fil-') || p.id.startsWith('spool-') ? p.id : `fil-${p.id}`,
      type: p.type,
      color: p.color,
      pricePerKg: p.price,
      purchasedGrams: 0,
      remainingGramsOverride: null,
      purchasedAt: new Date().toISOString().split('T')[0],
      source: 'manual' as const,
      note: 'Migrated from legacy profile — set spool weight when known.',
      usages: [],
      createdAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export function loadFilamentStock(): FilamentStockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FilamentStockState;
      if (Array.isArray(parsed?.spools)) {
        return {
          spools: parsed.spools.filter((s) => !s.archived),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      }
    }
    const migrated = migrateLegacyProfiles();
    if (migrated.length) {
      const state = { spools: migrated, updatedAt: new Date().toISOString() };
      saveState(state);
      return state;
    }
  } catch {
    /* fall through */
  }
  return emptyState();
}

export function getUsedGrams(spool: FilamentSpool): number {
  return roundGrams(spool.usages.filter((u) => u.kind !== 'adjustment' || u.grams > 0).reduce((sum, u) => sum + u.grams, 0));
}

export function getRemainingGrams(spool: FilamentSpool): number {
  if (spool.remainingGramsOverride != null && Number.isFinite(spool.remainingGramsOverride)) {
    return roundGrams(spool.remainingGramsOverride);
  }
  const remaining = spool.purchasedGrams - getUsedGrams(spool);
  return roundGrams(Math.max(0, remaining));
}

export function getRemainingPercent(spool: FilamentSpool): number {
  if (spool.purchasedGrams <= 0) return 0;
  return Math.min(100, Math.max(0, (getRemainingGrams(spool) / spool.purchasedGrams) * 100));
}

export function isLowStock(spool: FilamentSpool): boolean {
  const remaining = getRemainingGrams(spool);
  if (spool.purchasedGrams > 0 && remaining / spool.purchasedGrams < 0.1) return true;
  return remaining > 0 && remaining < 200;
}

export interface AddSpoolInput {
  type: string;
  color: string;
  brand?: string;
  pricePerKg: number;
  purchasedGrams: number;
  purchasedAt?: string;
  source: FilamentPurchaseSource;
  vendor?: string;
  totalPaid?: number;
  note?: string;
  expenseId?: string;
  ebayOrderId?: string;
  ebayLineKey?: string;
}

export function findSpoolByEbayLineKey(lineKey: string, state?: FilamentStockState): FilamentSpool | undefined {
  const stock = state ?? loadFilamentStock();
  return stock.spools.find((s) => s.ebayLineKey === lineKey);
}

export function addFilamentSpool(state: FilamentStockState, input: AddSpoolInput): FilamentStockState {
  if (input.ebayLineKey && findSpoolByEbayLineKey(input.ebayLineKey, state)) {
    throw new Error('A spool for this eBay purchase line already exists.');
  }
  const spool: FilamentSpool = {
    id: `spool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: input.type.trim(),
    color: input.color.trim(),
    brand: input.brand?.trim() || undefined,
    pricePerKg: input.pricePerKg,
    purchasedGrams: roundGrams(input.purchasedGrams),
    remainingGramsOverride: null,
    purchasedAt: input.purchasedAt || new Date().toISOString().split('T')[0],
    source: input.source,
    vendor: input.vendor?.trim() || undefined,
    totalPaid: input.totalPaid,
    note: input.note?.trim() || undefined,
    expenseId: input.expenseId,
    ebayOrderId: input.ebayOrderId,
    ebayLineKey: input.ebayLineKey,
    usages: [],
    createdAt: new Date().toISOString(),
  };
  const next = { spools: [...state.spools, spool], updatedAt: new Date().toISOString() };
  saveState(next);
  return next;
}

export function updateFilamentSpool(
  state: FilamentStockState,
  spoolId: string,
  patch: Partial<Pick<FilamentSpool, 'type' | 'color' | 'brand' | 'pricePerKg' | 'purchasedGrams' | 'note' | 'vendor'>>
): FilamentStockState {
  const next = {
    spools: state.spools.map((s) => (s.id === spoolId ? { ...s, ...patch } : s)),
    updatedAt: new Date().toISOString(),
  };
  saveState(next);
  return next;
}

export function setRemainingOverride(
  state: FilamentStockState,
  spoolId: string,
  remainingGrams: number | null,
  note?: string
): FilamentStockState {
  const spools = state.spools.map((s) => {
    if (s.id !== spoolId) return s;
    const usage: FilamentUsageRecord = {
      id: `use-${Date.now()}`,
      spoolId,
      grams: 0,
      date: new Date().toISOString().split('T')[0],
      kind: 'adjustment',
      note: `Manual stock set to ${gramsToKgDisplay(remainingGrams ?? 0)}${note ? `: ${note}` : ''}`,
    };
    return {
      ...s,
      remainingGramsOverride: remainingGrams != null ? roundGrams(remainingGrams) : null,
      usages: [...s.usages, usage],
    };
  });
  const next = { spools, updatedAt: new Date().toISOString() };
  saveState(next);
  return next;
}

export function recordFilamentUsage(
  state: FilamentStockState,
  spoolId: string,
  grams: number,
  meta: {
    kind?: FilamentUsageKind;
    inventoryItemId?: string;
    inventoryItemName?: string;
    note?: string;
    date?: string;
  }
): { state: FilamentStockState; error?: string } {
  const spool = state.spools.find((s) => s.id === spoolId);
  if (!spool) return { state, error: 'Spool not found.' };
  const totalGrams = roundGrams(grams);
  if (totalGrams <= 0) return { state, error: 'Usage must be greater than 0 g.' };

  const remaining = getRemainingGrams(spool);
  if (spool.purchasedGrams > 0 && totalGrams > remaining + 0.5) {
    return {
      state,
      error: `Not enough filament — only ${gramsToKgDisplay(remaining)} left on this spool.`,
    };
  }

  const usage: FilamentUsageRecord = {
    id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    spoolId,
    grams: totalGrams,
    date: meta.date || new Date().toISOString().split('T')[0],
    kind: meta.kind || 'print',
    inventoryItemId: meta.inventoryItemId,
    inventoryItemName: meta.inventoryItemName,
    note: meta.note,
  };

  let updatedSpool: FilamentSpool = {
    ...spool,
    usages: [...spool.usages, usage],
  };

  if (spool.remainingGramsOverride != null) {
    updatedSpool = {
      ...updatedSpool,
      remainingGramsOverride: roundGrams(Math.max(0, spool.remainingGramsOverride - totalGrams)),
    };
  }

  const next = {
    spools: state.spools.map((s) => (s.id === spoolId ? updatedSpool : s)),
    updatedAt: new Date().toISOString(),
  };
  saveState(next);
  return { state: next };
}

export function recordWasteUsage(
  state: FilamentStockState,
  spoolId: string,
  grams: number,
  note?: string
): { state: FilamentStockState; error?: string } {
  return recordFilamentUsage(state, spoolId, grams, { kind: 'waste', note: note || 'Waste / test print' });
}

export function removeFilamentSpool(state: FilamentStockState, spoolId: string): FilamentStockState {
  const next = {
    spools: state.spools.filter((s) => s.id !== spoolId),
    updatedAt: new Date().toISOString(),
  };
  saveState(next);
  return next;
}

export function spoolLabel(spool: FilamentSpool): string {
  const parts = [spool.type, spool.color];
  if (spool.brand) parts.unshift(spool.brand);
  return parts.join(' · ');
}

export const SOURCE_LABELS: Record<FilamentPurchaseSource, string> = {
  manual: 'Manual',
  amazon: 'Amazon',
  ebay: 'eBay',
  other: 'Other',
};

export function syncLegacyFilamentProfiles(spools: FilamentSpool[]): void {
  const profiles = spools.map((s) => ({
    id: s.id,
    type: s.type,
    color: s.color,
    price: s.pricePerKg,
  }));
  localStorage.setItem(LEGACY_KEY, JSON.stringify(profiles));
}

export function colorToDotStyle(colorName: string): string {
  const c = colorName.toLowerCase();
  const map: Record<string, string> = {
    black: '#1e293b',
    white: '#f1f5f9',
    grey: '#94a3b8',
    gray: '#94a3b8',
    silver: '#cbd5e1',
    red: '#ef4444',
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308',
    orange: '#f97316',
    purple: '#a855f7',
    pink: '#ec4899',
    gold: '#d97706',
    transparent: 'linear-gradient(135deg, #e2e8f0 50%, #fff 50%)',
  };
  for (const [key, val] of Object.entries(map)) {
    if (c.includes(key)) return val;
  }
  return '#6366f1';
}
