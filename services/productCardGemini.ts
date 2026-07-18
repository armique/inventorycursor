import type { InventoryItem } from '../types';
import { getProductCardSpecs } from '../utils/productCardContent';
import { getItemUserPhotoUrls } from '../utils/imageImport';
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
  styleId: ProductCardStyleId | string = DEFAULT_PRODUCT_CARD_STYLE_ID,
  provider: ProductCardProviderId = 'openai'
): Promise<ProductCardGenerateResult> {
  const specs = getProductCardSpecs(item, categoryFields, 8).map((s) => ({
    label: s.label,
    value: s.value,
  }));

  const photos = getItemUserPhotoUrls(item).slice(0, 3);
  const images = photos.map((url) =>
    url.startsWith('data:') ? { imageBase64: url } : { imageUrl: url }
  );

  const res = await fetch('/api/images?route=product-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.name,
      category: item.category,
      subCategory: item.subCategory,
      comment: item.comment1 || '',
      specs,
      images,
      styleId,
      provider,
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
  return generateProductCard(item, categoryFields, styleId, 'gemini');
}
