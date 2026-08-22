/**
 * Visual tones for PC component kinds in inventory (standalone + nested parts).
 * Containers (PC / bundle) keep their own indigo/violet styling.
 */
import type { InventoryItem } from '../types';

export type ComponentPartKind =
  | 'cpu'
  | 'motherboard'
  | 'gpu'
  | 'ram'
  | 'storage'
  | 'psu'
  | 'case'
  | 'cooling'
  | 'other';

export type ComponentPartTone = {
  kind: ComponentPartKind;
  /** Short label for pills */
  shortLabel: string;
  /** Hex for inline borders when Tailwind cannot see dynamic classes */
  accentHex: string;
  /** Inset left bar on table rows */
  rowAccentClass: string;
  /** Category / nested pill colors only (bg / text / border) */
  pillClass: string;
};

/** Shared geometry so every part pill is the same shape. */
export const COMPONENT_PART_PILL_SHELL =
  'inline-flex h-5 w-[4.5rem] shrink-0 items-center justify-center truncate rounded border px-1 text-[9px] font-bold uppercase leading-none tracking-tight';

const TONES: Record<ComponentPartKind, ComponentPartTone> = {
  cpu: {
    kind: 'cpu',
    shortLabel: 'CPU',
    accentHex: '#4f46e5',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#4f46e5]',
    pillClass: 'bg-indigo-100 text-indigo-950 border-indigo-300',
  },
  motherboard: {
    kind: 'motherboard',
    shortLabel: 'Mobo',
    accentHex: '#1e293b',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#1e293b]',
    pillClass: 'bg-slate-800 text-white border-slate-900',
  },
  gpu: {
    kind: 'gpu',
    shortLabel: 'GPU',
    accentHex: '#ea580c',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#ea580c]',
    pillClass: 'bg-orange-100 text-orange-950 border-orange-300',
  },
  ram: {
    kind: 'ram',
    shortLabel: 'RAM',
    accentHex: '#0d9488',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#0d9488]',
    pillClass: 'bg-teal-100 text-teal-950 border-teal-300',
  },
  storage: {
    kind: 'storage',
    shortLabel: 'SSD/HDD',
    accentHex: '#059669',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#059669]',
    pillClass: 'bg-emerald-100 text-emerald-950 border-emerald-300',
  },
  psu: {
    kind: 'psu',
    shortLabel: 'PSU',
    accentHex: '#d97706',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#d97706]',
    pillClass: 'bg-amber-100 text-amber-950 border-amber-300',
  },
  case: {
    kind: 'case',
    shortLabel: 'Case',
    accentHex: '#64748b',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#64748b]',
    pillClass: 'bg-slate-200 text-slate-800 border-slate-400',
  },
  cooling: {
    kind: 'cooling',
    shortLabel: 'Cooling',
    accentHex: '#0284c7',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#0284c7]',
    pillClass: 'bg-sky-100 text-sky-950 border-sky-300',
  },
  other: {
    kind: 'other',
    shortLabel: 'Part',
    accentHex: '#94a3b8',
    rowAccentClass: 'shadow-[inset_3px_0_0_0_#94a3b8]',
    pillClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

function norm(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

/**
 * Map inventory category/subCategory (and light name hints) to a part kind.
 * Returns null for PC/bundle shells so they keep container colors.
 */
export function resolveComponentPartKind(
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'name' | 'isPC' | 'isBundle'>
): ComponentPartKind | null {
  if (item.isPC || item.isBundle) return null;

  const sub = norm(item.subCategory);
  const cat = norm(item.category);
  const name = norm(item.name);
  const blob = `${cat} ${sub} ${name}`;

  if (
    includesAny(sub, ['processor', 'cpu']) ||
    (cat === 'components' && includesAny(name, ['ryzen', 'core i3', 'core i5', 'core i7', 'core i9', 'xeon']))
  ) {
    return 'cpu';
  }
  if (includesAny(sub, ['motherboard', 'mainboard', 'mobo'])) return 'motherboard';
  if (
    includesAny(sub, ['graphics', 'gpu', 'grafik']) ||
    sub === 'gpu' ||
    includesAny(name, ['rtx ', 'gtx ', 'radeon', 'geforce'])
  ) {
    return 'gpu';
  }
  if (includesAny(sub, ['ram', 'memory', 'dimm']) || sub === 'ddr4' || sub === 'ddr5') return 'ram';
  if (
    includesAny(sub, ['storage', 'ssd', 'hdd', 'nvme', 'm 2', 'm2']) ||
    includesAny(blob, ['nvme', ' solid state'])
  ) {
    return 'storage';
  }
  if (includesAny(sub, ['power supply', 'power supplies', 'psu', 'netzteil'])) return 'psu';
  if (includesAny(sub, ['case', 'gehause', 'chassis'])) return 'case';
  if (includesAny(sub, ['cooling', 'cooler', 'kuhler', 'aio', 'fan'])) return 'cooling';

  // Other PC-ish components still get a quiet slate accent.
  if (cat === 'components' || cat === 'component') return 'other';
  return null;
}

export function resolveComponentPartTone(
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'name' | 'isPC' | 'isBundle'>
): ComponentPartTone | null {
  const kind = resolveComponentPartKind(item);
  return kind ? TONES[kind] : null;
}

/** Fixed-size pill classes + short label (or truncated subcategory when no tone). */
export function componentPartPillProps(
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'name' | 'isPC' | 'isBundle'>
): { className: string; label: string; title: string } | null {
  const sub = String(item.subCategory || '').trim();
  if (!sub) return null;
  const tone = resolveComponentPartTone(item);
  if (tone) {
    return {
      className: `${COMPONENT_PART_PILL_SHELL} ${tone.pillClass}`,
      label: tone.shortLabel,
      title: `${tone.shortLabel} · ${sub}`,
    };
  }
  return {
    className: `${COMPONENT_PART_PILL_SHELL} border-slate-200 bg-slate-100 text-slate-600`,
    label: sub,
    title: sub,
  };
}

export function componentPartRowAccentClass(
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'name' | 'isPC' | 'isBundle'>
): string {
  return resolveComponentPartTone(item)?.rowAccentClass || '';
}
