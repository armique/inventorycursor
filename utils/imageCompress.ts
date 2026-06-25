/** Resize + JPEG compress inventory photos before storing in local/cloud JSON. */

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  /** Target max encoded data URL length (~bytes × 4/3). */
  maxEncodedChars?: number;
}

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.82;
/** ~280 KB JPEG — keeps Firestore/local JSON lean while staying sharp in the table. */
const DEFAULT_MAX_ENCODED_CHARS = 380_000;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image file'));
    };
    img.src = url;
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

function scaleDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) return { width, height };
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function encodeCanvasToJpeg(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality);
}

function drawImageToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function compressLoadedImage(
  img: HTMLImageElement,
  options?: CompressImageOptions
): string {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_DIMENSION;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_DIMENSION;
  const maxEncodedChars = options?.maxEncodedChars ?? DEFAULT_MAX_ENCODED_CHARS;
  let quality = options?.quality ?? DEFAULT_QUALITY;

  let { width, height } = scaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, maxWidth, maxHeight);
  let canvas = drawImageToCanvas(img, width, height);
  let dataUrl = encodeCanvasToJpeg(canvas, quality);

  while (dataUrl.length > maxEncodedChars && quality > 0.52) {
    quality -= 0.08;
    dataUrl = encodeCanvasToJpeg(canvas, quality);
  }

  while (dataUrl.length > maxEncodedChars && width > 480 && height > 480) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    canvas = drawImageToCanvas(img, width, height);
    dataUrl = encodeCanvasToJpeg(canvas, quality);
  }

  return dataUrl;
}

export async function compressImageFile(
  file: File,
  options?: CompressImageOptions
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file');
  }
  const img = await loadImageFromFile(file);
  return compressLoadedImage(img, options);
}

export async function compressDataUrl(dataUrl: string, options?: CompressImageOptions): Promise<string> {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('data:image/svg')) return trimmed;
  const img = await loadImageFromDataUrl(trimmed);
  return compressLoadedImage(img, options);
}

/** Keep https/http/imgur links; compress embedded data URLs only. */
export async function prepareInventoryPhotoUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('data:image/svg')) return trimmed;
  if (trimmed.length < 100_000) return trimmed;
  try {
    return await compressDataUrl(trimmed);
  } catch {
    return trimmed;
  }
}

export async function prepareInventoryPhotoUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(prepareInventoryPhotoUrl));
}
