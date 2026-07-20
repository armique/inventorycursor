import type { InventoryItem } from '../types';
import { getProductCardSpecs } from '../utils/productCardContent';
import { getItemUserPhotoUrls } from '../utils/imageImport';
import { resolveProductCardAccessoryHints } from '../utils/itemAccessories';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  type ProductCardStyleId,
} from './productCardStyles';

export type ProductCardProviderId = 'openai' | 'gemini';

export interface ProductCardGenerateResult {
  dataUrl: string;
  provider: string;
  model?: string;
  note?: string;
  styleId?: string;
  styleName?: string;
}

export interface ProductCardProviderInfo {
  id: ProductCardProviderId;
  name: string;
  available: boolean;
  blurb: string;
}

export interface GenerateProductCardOptions {
  styleId?: ProductCardStyleId | string;
  provider?: ProductCardProviderId;
  /** Override photos (data URLs or http). Empty = no photos. Undefined = use item photos. */
  photos?: string[] | null;
  /** Force edit-from-photo wording even if only one photo */
  editFromPhoto?: boolean;
  /**
   * Full inventory — used to OR OVP / IO-Blende from PC/Bundle children
   * when generating a card for a container item.
   */
  allItems?: InventoryItem[] | null;
  /** Override specs shown on this card (batch variants). */
  specs?: { label: string; value: string }[] | null;
  /** Marketing perks unique to this card variant. */
  perks?: string[] | null;
  /** Prompt hint so sibling cards don't look identical. */
  variantFocus?: string | null;
  /** Override accessory badges for this card variant. */
  hasOVP?: boolean;
  hasIOShield?: boolean;
  cardIndex?: number;
  cardCount?: number;
}

export async function fetchProductCardProviders(): Promise<ProductCardProviderInfo[]> {
  try {
    const res = await fetch('/api/images?route=product-card-providers');
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.providers)) {
      return data.providers as ProductCardProviderInfo[];
    }
  } catch {
    /* fall through */
  }
  return [
    { id: 'openai', name: 'OpenAI', available: true, blurb: 'GPT Image' },
    { id: 'gemini', name: 'Gemini', available: true, blurb: 'Flash Image' },
  ];
}

/**
 * Generate a premium product card via server image models (OpenAI or Gemini).
 */
export async function generateProductCard(
  item: InventoryItem,
  categoryFields?: string[],
  styleIdOrOptions: ProductCardStyleId | string | GenerateProductCardOptions = DEFAULT_PRODUCT_CARD_STYLE_ID,
  providerArg: ProductCardProviderId = 'openai'
): Promise<ProductCardGenerateResult> {
  const opts: GenerateProductCardOptions =
    typeof styleIdOrOptions === 'object' && styleIdOrOptions !== null
      ? styleIdOrOptions
      : { styleId: styleIdOrOptions as string, provider: providerArg };

  const styleId = opts.styleId || DEFAULT_PRODUCT_CARD_STYLE_ID;
  const provider = opts.provider || 'openai';

  const specs =
    opts.specs != null
      ? opts.specs.map((s) => ({ label: s.label, value: s.value }))
      : getProductCardSpecs(item, categoryFields, 8).map((s) => ({
          label: s.label,
          value: s.value,
        }));

  const photoUrls =
    opts.photos !== undefined && opts.photos !== null
      ? opts.photos.slice(0, 3)
      : getItemUserPhotoUrls(item).slice(0, 3);

  const images = photoUrls.map((url) =>
    url.startsWith('data:') ? { imageBase64: url } : { imageUrl: url }
  );

  const accessories = resolveProductCardAccessoryHints(item, opts.allItems);
  const hasOVP = opts.hasOVP !== undefined ? opts.hasOVP === true : accessories.hasOVP;
  const hasIOShield =
    opts.hasIOShield !== undefined ? opts.hasIOShield === true : accessories.hasIOShield;

  const res = await fetch('/api/images?route=product-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.name,
      category: item.category,
      subCategory: item.subCategory,
      comment: item.comment1 || '',
      specs,
      perks: opts.perks || [],
      variantFocus: opts.variantFocus || '',
      cardIndex: opts.cardIndex ?? 0,
      cardCount: opts.cardCount ?? 1,
      images,
      styleId,
      provider,
      editFromPhoto: opts.editFromPhoto ?? images.length > 0,
      hasOVP,
      hasIOShield,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.imageBase64) {
    throw new Error(
      data.error ||
        data.hint ||
        `Product card failed (${res.status}). Check ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}.`
    );
  }

  const mime = data.mimeType || 'image/png';
  return {
    dataUrl: `data:${mime};base64,${data.imageBase64}`,
    provider: data.provider || provider,
    model: data.model,
    note: data.note,
    styleId: data.styleId,
    styleName: data.styleName,
  };
}

/** @deprecated use generateProductCard */
export async function generateGeminiProductCard(
  item: InventoryItem,
  categoryFields?: string[],
  styleId: ProductCardStyleId | string = DEFAULT_PRODUCT_CARD_STYLE_ID
): Promise<ProductCardGenerateResult> {
  return generateProductCard(item, categoryFields, { styleId, provider: 'gemini' });
}
