import type { InventoryItem } from '../types';
import { getProductCardSpecs } from '../utils/productCardContent';
import { getItemUserPhotoUrls } from '../utils/imageImport';

export interface GeminiProductCardResult {
  dataUrl: string;
  provider: string;
  model?: string;
  note?: string;
}

/**
 * Generate a premium product card via server Gemini image models.
 * Needs GEMINI_API_KEY / VITE_GEMINI_API_KEY (AI Studio API key — not Gemini app Pro alone).
 */
export async function generateGeminiProductCard(
  item: InventoryItem,
  categoryFields?: string[]
): Promise<GeminiProductCardResult> {
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
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.imageBase64) {
    throw new Error(
      data.error ||
        data.hint ||
        `Gemini card failed (${res.status}). Set GEMINI_API_KEY from Google AI Studio.`
    );
  }

  const mime = data.mimeType || 'image/png';
  return {
    dataUrl: `data:${mime};base64,${data.imageBase64}`,
    provider: data.provider || 'Gemini',
    model: data.model,
    note: data.note,
  };
}
