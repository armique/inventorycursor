/**
 * Named Gemini product-card design styles (typed client wrapper).
 */
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES as STYLES_RAW,
  getProductCardStyle as getStyleRaw,
} from '../lib/productCardStyles.js';

export type ProductCardStyleId =
  | 'apple-studio-white'
  | 'noir-editorial'
  | 'tech-spec-grid'
  | 'marketplace-hero'
  | 'soft-nordic'
  | 'frosted-glass'
  | 'industrial-mono'
  | 'steel-gradient'
  | 'catalog-classic'
  | 'blueprint-precision';

export interface ProductCardStyle {
  id: ProductCardStyleId;
  name: string;
  blurb: string;
  prompt: string;
}

export { DEFAULT_PRODUCT_CARD_STYLE_ID };

export const PRODUCT_CARD_STYLES = STYLES_RAW as ProductCardStyle[];

export function getProductCardStyle(id?: string | null): ProductCardStyle {
  return getStyleRaw(id) as ProductCardStyle;
}
