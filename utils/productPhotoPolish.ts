/**
 * Client-side product photo polish (always available fallback).
 * Composites transparent PNG on studio background; applies mild clarity for JPEG sources.
 */

export interface LocalPolishOptions {
  backgroundFrom?: string;
  backgroundTo?: string;
  paddingRatio?: number;
}

const DEFAULT_OPTS: Required<LocalPolishOptions> = {
  backgroundFrom: '#f3f4f6',
  backgroundTo: '#e8eaef',
  paddingRatio: 0.08,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function applyClarity(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 0.35) {
  if (amount <= 0) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const copy = new Uint8ClampedArray(d);
  const w4 = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur =
          (copy[i - w4 + c] +
            copy[i + w4 + c] +
            copy[i - 4 + c] +
            copy[i + 4 + c] +
            copy[i + c] * 4) /
          8;
        d[i + c] = Math.min(255, Math.max(0, copy[i + c] + (copy[i + c] - blur) * amount));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function boostExposure(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * 1.03 + 2);
    d[i + 1] = Math.min(255, d[i + 1] * 1.03 + 2);
    d[i + 2] = Math.min(255, d[i + 2] * 1.03 + 2);
  }
  ctx.putImageData(imageData, 0, 0);
}

export async function polishProductPhotoLocally(
  sourceUrl: string,
  opts: LocalPolishOptions = {}
): Promise<string> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const img = await loadImage(sourceUrl);
  const pad = Math.round(Math.max(img.width, img.height) * o.paddingRatio);
  const cw = img.width + pad * 2;
  const ch = img.height + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');

  const grad = ctx.createLinearGradient(0, 0, cw, ch);
  grad.addColorStop(0, o.backgroundFrom);
  grad.addColorStop(1, o.backgroundTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  ctx.drawImage(img, pad, pad, img.width, img.height);
  applyClarity(ctx, cw, ch, 0.28);
  boostExposure(ctx, cw, ch);

  return canvas.toDataURL('image/jpeg', 0.92);
}

export async function compositeTransparentOnStudio(
  pngDataUrl: string,
  opts: LocalPolishOptions = {}
): Promise<string> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const img = await loadImage(pngDataUrl);
  const pad = Math.round(Math.max(img.width, img.height) * o.paddingRatio);
  const cw = img.width + pad * 2;
  const ch = img.height + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');

  const grad = ctx.createLinearGradient(0, 0, cw, ch);
  grad.addColorStop(0, o.backgroundFrom);
  grad.addColorStop(1, o.backgroundTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const scale = Math.min((cw - pad * 2) / img.width, (ch - pad * 2) / img.height, 1);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);

  return canvas.toDataURL('image/jpeg', 0.92);
}

export function base64ToDataUrl(base64: string, mime: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:${mime};base64,${base64}`;
}
