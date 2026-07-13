import type { InventoryItem } from '../types';
import {
  DEFAULT_USPS,
  detectProductCardFamily,
  type ProductCardFamily,
} from '../utils/productCardContent';

export interface ProductCardTheme {
  bgFrom: string;
  bgTo: string;
  accent: string;
  accentSoft: string;
  text: string;
  textMuted: string;
  surface: string;
  surfaceBorder: string;
}

export interface ProductCardTemplate {
  id: string;
  name: string;
  family: ProductCardFamily;
  theme: ProductCardTheme;
  usps: string[];
  layout: 'hero-left' | 'hero-center' | 'hero-showcase';
  /** Canvas backdrop preset (hero-showcase). */
  backgroundId?: import('./productCardBackgrounds').ProductCardBackgroundId;
  /** Premium canvas treatment — deeper shadows, glass surfaces, editorial typography. */
  variant?: 'standard' | 'premium';
  showPrice: boolean;
  showSpecs: boolean;
  maxSpecs: number;
  createdAt: string;
  isBuiltin?: boolean;
  /** Optional marketing line under title (AI or manual). */
  tagline?: string;
  /** Which AI created this template, if any. */
  aiMeta?: {
    provider: string;
    providerId: string;
    model?: string;
    generatedAt: string;
    variantStyle?: string;
  };
}

const STORAGE_KEY = 'product_card_templates_v1';

const THEMES: Record<ProductCardFamily, ProductCardTheme> = {
  pc: {
    bgFrom: '#0c1222',
    bgTo: '#1a2744',
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.18)',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    surface: 'rgba(255, 255, 255, 0.06)',
    surfaceBorder: 'rgba(255, 255, 255, 0.1)',
  },
  '3d': {
    bgFrom: '#0a1628',
    bgTo: '#0f2d24',
    accent: '#10b981',
    accentSoft: 'rgba(16, 185, 129, 0.2)',
    text: '#f0fdf4',
    textMuted: '#86efac',
    surface: 'rgba(255, 255, 255, 0.07)',
    surfaceBorder: 'rgba(16, 185, 129, 0.25)',
  },
  generic: {
    bgFrom: '#111827',
    bgTo: '#1f2937',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.15)',
    text: '#f9fafb',
    textMuted: '#9ca3af',
    surface: 'rgba(255, 255, 255, 0.06)',
    surfaceBorder: 'rgba(255, 255, 255, 0.1)',
  },
};

function builtinTemplate(
  id: string,
  name: string,
  family: ProductCardFamily,
  layout: ProductCardTemplate['layout'] = 'hero-left',
  variant: ProductCardTemplate['variant'] = 'standard'
): ProductCardTemplate {
  return {
    id,
    name,
    family,
    theme: { ...THEMES[family] },
    usps: [...DEFAULT_USPS[family]],
    layout,
    variant,
    showPrice: true,
    showSpecs: true,
    maxSpecs: 6,
    createdAt: 'builtin',
    isBuiltin: true,
  };
}

const LIGHT_TEXT_THEME = {
  bgFrom: '#ffffff',
  bgTo: '#eef4fb',
  accent: '#2563eb',
  accentSoft: 'rgba(37, 99, 235, 0.12)',
  text: '#0f172a',
  textMuted: '#64748b',
  surface: 'rgba(15, 23, 42, 0.04)',
  surfaceBorder: 'rgba(148, 163, 184, 0.35)',
} satisfies ProductCardTheme;

export const PREMIUM_NOIR_EDITORIAL_TEMPLATE: ProductCardTemplate = {
  id: 'premium-noir-editorial',
  name: 'Premium Showcase — Center Hero',
  family: 'generic',
  theme: { ...LIGHT_TEXT_THEME },
  usps: [
    '3D-Druck aus Deutschland',
    'ATX & Micro ATX Support',
    'PLA+ Premium Material',
    'Schneller Versand 2–3 Werktage',
  ],
  layout: 'hero-showcase',
  variant: 'premium',
  backgroundId: 'warm-wood',
  showPrice: true,
  showSpecs: true,
  maxSpecs: 4,
  createdAt: 'builtin',
  isBuiltin: true,
};

export const BUILTIN_PRODUCT_CARD_TEMPLATES: ProductCardTemplate[] = [
  PREMIUM_NOIR_EDITORIAL_TEMPLATE,
  builtinTemplate('pc-dark', 'PC Hardware — Premium Dark', 'pc', 'hero-left'),
  builtinTemplate('pc-center', 'PC Hardware — Hero Center', 'pc', 'hero-center'),
  builtinTemplate('3d-emerald', '3D Print — Emerald Premium', '3d', 'hero-left'),
  builtinTemplate('3d-center', '3D Print — Showcase', '3d', 'hero-center'),
  builtinTemplate('generic-gold', 'Universal — Gold Accent', 'generic', 'hero-left'),
];

export function suggestTemplateForItem(item: InventoryItem): ProductCardTemplate {
  const family = detectProductCardFamily(item);
  const premium = BUILTIN_PRODUCT_CARD_TEMPLATES.find((t) => t.id === 'premium-noir-editorial');
  if (premium) {
    return {
      ...premium,
      usps: [...DEFAULT_USPS[family]],
      family,
    };
  }
  const match =
    BUILTIN_PRODUCT_CARD_TEMPLATES.find((t) => t.family === family && t.layout === 'hero-left') ||
    BUILTIN_PRODUCT_CARD_TEMPLATES.find((t) => t.family === family) ||
    BUILTIN_PRODUCT_CARD_TEMPLATES[0];
  return { ...match, usps: [...match.usps] };
}

export function loadSavedProductCardTemplates(): ProductCardTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => t?.id && t?.name && t?.theme);
  } catch {
    return [];
  }
}

export function saveProductCardTemplate(template: ProductCardTemplate): ProductCardTemplate[] {
  const saved = loadSavedProductCardTemplates().filter((t) => t.id !== template.id);
  const next = [{ ...template, isBuiltin: false, createdAt: new Date().toISOString() }, ...saved].slice(0, 24);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteSavedProductCardTemplate(id: string): ProductCardTemplate[] {
  const next = loadSavedProductCardTemplates().filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function cloneTemplateAsCustom(base: ProductCardTemplate, name?: string): ProductCardTemplate {
  return {
    ...base,
    id: `custom-${Date.now()}`,
    name: name || `${base.name} (Custom)`,
    theme: { ...base.theme },
    usps: [...base.usps],
    isBuiltin: false,
    createdAt: new Date().toISOString(),
  };
}

export function listAllProductCardTemplates(): ProductCardTemplate[] {
  const saved = loadSavedProductCardTemplates();
  const builtinIds = new Set(BUILTIN_PRODUCT_CARD_TEMPLATES.map((t) => t.id));
  return [...saved, ...BUILTIN_PRODUCT_CARD_TEMPLATES.filter((t) => !saved.some((s) => s.id === t.id))];
}
