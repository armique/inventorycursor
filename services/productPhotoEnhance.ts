import {
  base64ToDataUrl,
  compositeTransparentOnStudio,
  polishProductPhotoLocally,
} from '../utils/productPhotoPolish';

export interface PhotoEnhanceResult {
  dataUrl: string;
  provider: string;
  note?: string;
  usedLocalFallback?: boolean;
}

export interface EnhanceProviderInfo {
  id: string;
  label: string;
  tier: string;
  features: string[];
}

export async function listPhotoEnhanceProviders(): Promise<EnhanceProviderInfo[]> {
  try {
    const res = await fetch('/api/images?route=enhance-providers');
    const data = await res.json().catch(() => ({}));
    return data.providers || [{ id: 'local', label: 'Local polish', tier: 'free', features: ['sharpen'] }];
  } catch {
    return [{ id: 'local', label: 'Local polish', tier: 'free', features: ['sharpen'] }];
  }
}

export async function enhanceProductPhoto(sourceUrl: string): Promise<PhotoEnhanceResult> {
  let body: { imageUrl?: string; imageBase64?: string } = { imageUrl: sourceUrl };
  if (sourceUrl.startsWith('data:')) {
    body = { imageBase64: sourceUrl };
  }

  try {
    const res = await fetch('/api/images?route=enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.imageBase64) {
      const raw = base64ToDataUrl(data.imageBase64, data.mimeType || 'image/png');
      const isPng = (data.mimeType || '').includes('png') || data.provider === 'remove.bg';
      const dataUrl = isPng ? await compositeTransparentOnStudio(raw) : raw;
      return {
        dataUrl,
        provider: data.provider || 'AI',
        note: data.note,
      };
    }

    if (data.fallback === 'local' || res.status === 503) {
      const details = Array.isArray(data.details) ? data.details : [];
      const had429 = details.some((d: string) => /429|quota/i.test(String(d)));
      const dataUrl = await polishProductPhotoLocally(sourceUrl);
      return {
        dataUrl,
        provider: 'Local polish',
        note: had429
          ? 'Gemini quota exceeded — using local polish. Set REMOVE_BG_API_KEY on Vercel for reliable background removal.'
          : 'Add REMOVE_BG_API_KEY or GEMINI_API_KEY for AI background removal & cleanup',
        usedLocalFallback: true,
      };
    }

    throw new Error(data.error || `Enhance failed (${res.status})`);
  } catch (e) {
    const dataUrl = await polishProductPhotoLocally(sourceUrl);
    return {
      dataUrl,
      provider: 'Local polish',
      note: e instanceof Error ? e.message : 'Server enhance unavailable',
      usedLocalFallback: true,
    };
  }
}
