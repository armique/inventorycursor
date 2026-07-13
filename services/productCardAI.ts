import type { InventoryItem } from '../types';
import {
  type AIProviderId,
  formatAIProviderError,
  getAIProviderLabel,
  getDefaultCardStudioProviderIds,
  requestAIJsonFromProvider,
} from './specsAI';
import {
  cloneTemplateAsCustom,
  suggestTemplateForItem,
  type ProductCardTemplate,
  type ProductCardTheme,
} from './productCardTemplates';
import {
  DEFAULT_USPS,
  detectProductCardFamily,
  getProductCardSpecs,
  type ProductCardFamily,
} from '../utils/productCardContent';

const VARIANT_STYLES = [
  { id: 'minimal', label: 'Minimal & clean', hint: 'Lots of whitespace, 3 short USPs, subtle colors' },
  { id: 'bold', label: 'Bold marketplace', hint: 'High contrast, strong accent, 4 punchy German USPs' },
  { id: 'luxury', label: 'Premium luxury', hint: 'Dark elegant gradient, refined typography feel, premium tone' },
] as const;

interface AIDesignJson {
  name?: string;
  tagline?: string;
  layout?: 'hero-left' | 'hero-center';
  theme?: Partial<ProductCardTheme>;
  usps?: string[];
  showPrice?: boolean;
  showSpecs?: boolean;
  maxSpecs?: number;
}

function buildDesignPrompt(
  item: InventoryItem,
  family: ProductCardFamily,
  variantStyle: (typeof VARIANT_STYLES)[number],
  specsPreview: string[]
): string {
  const defaultUsps = DEFAULT_USPS[family].join(' · ');
  return `You are a senior e-commerce art director for German marketplace listings (eBay.de, Kleinanzeigen).
Design a product CARD TEMPLATE (layout + colors + marketing badges). Do NOT invent product specs — only visual/marketing template.

Product context:
- Name: ${item.name}
- Category: ${item.category}${item.subCategory ? ` / ${item.subCategory}` : ''}
- Family: ${family === '3d' ? '3D printed models' : family === 'pc' ? 'PC hardware / components' : 'general'}
- Key specs on card: ${specsPreview.slice(0, 5).join(', ') || 'none yet'}
- Default USP ideas: ${defaultUsps}

Style direction: ${variantStyle.label} — ${variantStyle.hint}

Return ONLY valid JSON (no markdown):
{
  "name": "short template name in English",
  "tagline": "optional German marketing line max 60 chars",
  "layout": "hero-left" or "hero-center",
  "theme": {
    "bgFrom": "#hex dark",
    "bgTo": "#hex dark",
    "accent": "#hex",
    "accentSoft": "rgba(...)",
    "text": "#hex light",
    "textMuted": "#hex",
    "surface": "rgba(255,255,255,0.06)",
    "surfaceBorder": "rgba(...)"
  },
  "usps": ["German USP 1", "German USP 2", "German USP 3", "German USP 4"],
  "showPrice": true,
  "showSpecs": true,
  "maxSpecs": 6
}

Rules:
- USPs must be in German, short (max 35 chars each), realistic for this product type.
- For 3D print family prefer: Made in Germany, delivery time, color choice, filament quality.
- For PC hardware prefer: tested hardware, shipping DE, ready to ship, warranty-style trust.
- Colors must have strong contrast for mobile listing thumbnails.
- layout hero-center for product-forward showcase; hero-left for spec-heavy hardware.`;
}

function sanitizeHex(color: string | undefined, fallback: string): string {
  if (!color || typeof color !== 'string') return fallback;
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return c;
  return fallback;
}

function mergeTheme(base: ProductCardTheme, partial?: Partial<ProductCardTheme>): ProductCardTheme {
  return {
    bgFrom: sanitizeHex(partial?.bgFrom, base.bgFrom),
    bgTo: sanitizeHex(partial?.bgTo, base.bgTo),
    accent: sanitizeHex(partial?.accent, base.accent),
    accentSoft: partial?.accentSoft || base.accentSoft,
    text: sanitizeHex(partial?.text, base.text),
    textMuted: sanitizeHex(partial?.textMuted, base.textMuted),
    surface: partial?.surface || base.surface,
    surfaceBorder: partial?.surfaceBorder || base.surfaceBorder,
  };
}

function aiJsonToTemplate(
  json: AIDesignJson,
  base: ProductCardTemplate,
  provider: AIProviderId,
  variantStyle: string
): ProductCardTemplate {
  const usps = (json.usps || []).map((u) => String(u).trim()).filter(Boolean).slice(0, 5);
  const custom = cloneTemplateAsCustom(base, json.name?.trim() || `AI · ${getAIProviderLabel(provider)}`);
  return {
    ...custom,
    layout: json.layout === 'hero-center' ? 'hero-center' : 'hero-left',
    theme: mergeTheme(base.theme, json.theme),
    usps: usps.length >= 2 ? usps : base.usps,
    tagline: json.tagline?.trim() || undefined,
    showPrice: json.showPrice !== false,
    showSpecs: json.showSpecs !== false,
    maxSpecs: Math.min(8, Math.max(3, json.maxSpecs ?? base.maxSpecs)),
    aiMeta: {
      provider: getAIProviderLabel(provider),
      providerId: provider,
      generatedAt: new Date().toISOString(),
      variantStyle,
    },
  };
}

export interface GenerateDesignResult {
  template: ProductCardTemplate;
  provider: AIProviderId;
  variantStyle: string;
  error?: string;
}

/** Generate one AI design variant for a specific provider. */
export async function generateProductCardDesign(
  item: InventoryItem,
  provider: AIProviderId,
  variantIndex = 0,
  categoryFields?: string[]
): Promise<ProductCardTemplate> {
  const family = detectProductCardFamily(item);
  const base = suggestTemplateForItem(item);
  const variant = VARIANT_STYLES[variantIndex % VARIANT_STYLES.length];
  const specs = getProductCardSpecs(item, categoryFields, 5).map((s) => `${s.label}: ${s.value}`);
  const prompt = buildDesignPrompt(item, family, variant, specs);
  const json = await requestAIJsonFromProvider<AIDesignJson>(provider, prompt, { maxTokens: 1400 });
  return aiJsonToTemplate(json, base, provider, variant.id);
}

/** Generate designs from multiple providers in parallel (compare mode). */
export async function generateProductCardDesignBatch(
  item: InventoryItem,
  providers: AIProviderId[],
  categoryFields?: string[]
): Promise<GenerateDesignResult[]> {
  const tasks = providers.map(async (provider, idx) => {
    try {
      const template = await generateProductCardDesign(item, provider, idx, categoryFields);
      return { template, provider, variantStyle: VARIANT_STYLES[idx % VARIANT_STYLES.length].id };
    } catch (e) {
      return {
        template: suggestTemplateForItem(item),
        provider,
        variantStyle: VARIANT_STYLES[idx % VARIANT_STYLES.length].id,
        error: formatAIProviderError(provider, e),
      };
    }
  });
  return Promise.all(tasks);
}

export { VARIANT_STYLES, getDefaultCardStudioProviderIds };
