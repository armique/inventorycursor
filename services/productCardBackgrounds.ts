import type { ProductCardTheme } from './productCardTemplates';

export type ProductCardBackgroundId =
  | 'warm-wood'
  | 'ice-studio'
  | 'studio-white'
  | 'soft-slate'
  | 'midnight';

export interface ProductCardBackgroundPreset {
  id: ProductCardBackgroundId;
  name: string;
  /** Outer frame behind the inner product card */
  outerFrom: string;
  outerTo: string;
  outerStyle: 'wood' | 'gradient';
  /** Inner card surface */
  innerFrom: string;
  innerTo: string;
  theme: ProductCardTheme;
}

const LIGHT_TEXT_THEME: ProductCardTheme = {
  bgFrom: '#ffffff',
  bgTo: '#eef4fb',
  accent: '#2563eb',
  accentSoft: 'rgba(37, 99, 235, 0.12)',
  text: '#0f172a',
  textMuted: '#64748b',
  surface: 'rgba(15, 23, 42, 0.04)',
  surfaceBorder: 'rgba(148, 163, 184, 0.35)',
};

export const PRODUCT_CARD_BACKGROUNDS: ProductCardBackgroundPreset[] = [
  {
    id: 'warm-wood',
    name: 'Warm Wood Studio',
    outerFrom: '#c4a574',
    outerTo: '#8b6914',
    outerStyle: 'wood',
    innerFrom: '#ffffff',
    innerTo: '#e8f0fa',
    theme: { ...LIGHT_TEXT_THEME },
  },
  {
    id: 'ice-studio',
    name: 'Ice Blue Studio',
    outerFrom: '#dbeafe',
    outerTo: '#93c5fd',
    outerStyle: 'gradient',
    innerFrom: '#ffffff',
    innerTo: '#eff6ff',
    theme: { ...LIGHT_TEXT_THEME, accent: '#1d4ed8' },
  },
  {
    id: 'studio-white',
    name: 'Clean White',
    outerFrom: '#f1f5f9',
    outerTo: '#e2e8f0',
    outerStyle: 'gradient',
    innerFrom: '#ffffff',
    innerTo: '#f8fafc',
    theme: { ...LIGHT_TEXT_THEME, accent: '#0f172a' },
  },
  {
    id: 'soft-slate',
    name: 'Soft Slate',
    outerFrom: '#334155',
    outerTo: '#1e293b',
    outerStyle: 'gradient',
    innerFrom: '#f8fafc',
    innerTo: '#e2e8f0',
    theme: { ...LIGHT_TEXT_THEME },
  },
  {
    id: 'midnight',
    name: 'Midnight Studio',
    outerFrom: '#09090b',
    outerTo: '#18181b',
    outerStyle: 'gradient',
    innerFrom: '#18181b',
    innerTo: '#27272a',
    theme: {
      bgFrom: '#18181b',
      bgTo: '#27272a',
      accent: '#fafafa',
      accentSoft: 'rgba(255, 255, 255, 0.08)',
      text: '#fafafa',
      textMuted: '#a1a1aa',
      surface: 'rgba(255, 255, 255, 0.06)',
      surfaceBorder: 'rgba(255, 255, 255, 0.12)',
    },
  },
];

export function getProductCardBackground(id?: ProductCardBackgroundId): ProductCardBackgroundPreset {
  return PRODUCT_CARD_BACKGROUNDS.find((b) => b.id === id) ?? PRODUCT_CARD_BACKGROUNDS[0];
}
