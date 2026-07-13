import type { ProductCardFamily } from './productCardContent';
import type { ProductCardTemplate, ProductCardTheme } from '../services/productCardTemplates';

export const TEMPLATE_JSON_SCHEMA_VERSION = 1;

export interface ProductCardTemplateExport {
  schemaVersion: number;
  name: string;
  family: ProductCardFamily;
  layout: 'hero-left' | 'hero-center';
  variant?: 'standard' | 'premium';
  theme: ProductCardTheme;
  usps: string[];
  tagline?: string;
  showPrice?: boolean;
  showSpecs?: boolean;
  maxSpecs?: number;
  author?: string;
  source?: string;
}

function isValidTheme(t: unknown): t is ProductCardTheme {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.bgFrom === 'string' &&
    typeof o.bgTo === 'string' &&
    typeof o.accent === 'string' &&
    typeof o.text === 'string'
  );
}

export function parseProductCardTemplateJson(raw: unknown): ProductCardTemplate {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('Invalid JSON');

  const obj = data as ProductCardTemplateExport;
  if (!obj.name?.trim()) throw new Error('Template name is required');
  if (!['pc', '3d', 'generic'].includes(obj.family)) throw new Error('family must be pc, 3d, or generic');
  if (!isValidTheme(obj.theme)) throw new Error('Invalid theme colors');

  return {
    id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: obj.name.trim(),
    family: obj.family,
    layout: obj.layout === 'hero-center' ? 'hero-center' : 'hero-left',
    variant: obj.variant === 'premium' ? 'premium' : 'standard',
    theme: {
      bgFrom: obj.theme.bgFrom,
      bgTo: obj.theme.bgTo,
      accent: obj.theme.accent,
      accentSoft: obj.theme.accentSoft || 'rgba(99,102,241,0.15)',
      text: obj.theme.text,
      textMuted: obj.theme.textMuted || '#94a3b8',
      surface: obj.theme.surface || 'rgba(255,255,255,0.06)',
      surfaceBorder: obj.theme.surfaceBorder || 'rgba(255,255,255,0.1)',
    },
    usps: Array.isArray(obj.usps) ? obj.usps.map(String).filter(Boolean).slice(0, 6) : [],
    tagline: obj.tagline?.trim(),
    showPrice: obj.showPrice !== false,
    showSpecs: obj.showSpecs !== false,
    maxSpecs: Math.min(8, Math.max(3, obj.maxSpecs ?? 6)),
    createdAt: new Date().toISOString(),
    isBuiltin: false,
    aiMeta: obj.source
      ? {
          provider: obj.author || 'Imported',
          providerId: 'import',
          generatedAt: new Date().toISOString(),
          variantStyle: obj.source,
        }
      : undefined,
  };
}

export function exportProductCardTemplateJson(template: ProductCardTemplate): string {
  const payload: ProductCardTemplateExport = {
    schemaVersion: TEMPLATE_JSON_SCHEMA_VERSION,
    name: template.name,
    family: template.family,
    layout: template.layout,
    variant: template.variant,
    theme: template.theme,
    usps: template.usps,
    tagline: template.tagline,
    showPrice: template.showPrice,
    showSpecs: template.showSpecs,
    maxSpecs: template.maxSpecs,
    source: template.aiMeta?.variantStyle || template.aiMeta?.provider,
  };
  return JSON.stringify(payload, null, 2);
}

/** Built-in pack filenames served from /product-card-templates/ */
export const BUILTIN_TEMPLATE_PACK_FILES = [
  'premium-noir-editorial.json',
  'kleinanzeigen-minimal.json',
  'ebay-bold-orange.json',
  '3d-print-soft-mint.json',
  'pc-hardware-steel.json',
] as const;

export async function loadBuiltinTemplatePack(): Promise<ProductCardTemplate[]> {
  const out: ProductCardTemplate[] = [];
  for (const file of BUILTIN_TEMPLATE_PACK_FILES) {
    try {
      const res = await fetch(`/product-card-templates/${file}`);
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseProductCardTemplateJson(json);
      const stableId = file.replace(/\.json$/i, '');
      out.push({
        ...parsed,
        id: stableId,
        isBuiltin: true,
        createdAt: 'builtin-pack',
      });
    } catch {
      /* skip broken pack file */
    }
  }
  return out;
}
