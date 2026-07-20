/**
 * Resize + compress inventory photos before Firebase Storage / local fallback.
 * Prefers WebP when the browser can encode it and the result is smaller than JPEG.
 */

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  /** Target max encoded data URL length (~bytes × 4/3). */
  maxEncodedChars?: number;
  /** Target max encoded blob size in bytes (Storage uploads). */
  maxBlobBytes?: number;
  /** Prefer WebP when smaller than JPEG (default true for Storage). */
  preferWebp?: boolean;
}

/**
 * Cloud Storage uploads — sharp enough for eBay/Kleinanzeigen, sized for free-tier quota.
 * ~1600px long edge, WebP when available, soft cap ~360KB.
 */
export const INVENTORY_PHOTO_STORAGE_OPTIONS: CompressImageOptions = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  maxBlobBytes: 360_000,
  preferWebp: true,
};

/** Fallback when signed out — compressed data URL in localStorage. */
export const INVENTORY_PHOTO_LOCAL_OPTIONS: CompressImageOptions = {
  maxWidth: 1280,
  maxHeight: 1280,
  quality: 0.78,
  maxEncodedChars: 280_000,
  preferWebp: true,
};

const DEFAULT_MAX_DIMENSION = INVENTORY_PHOTO_LOCAL_OPTIONS.maxWidth!;
const DEFAULT_QUALITY = INVENTORY_PHOTO_LOCAL_OPTIONS.quality!;
const DEFAULT_MAX_ENCODED_CHARS = INVENTORY_PHOTO_LOCAL_OPTIONS.maxEncodedChars!;
const DEFAULT_MAX_BLOB_BYTES = INVENTORY_PHOTO_STORAGE_OPTIONS.maxBlobBytes!;

let webpEncodeSupported: boolean | null = null;

/** Detect canvas WebP encoding once per session. */
export function supportsWebpEncode(): boolean {
  if (webpEncodeSupported != null) return webpEncodeSupported;
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    webpEncodeSupported = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpEncodeSupported = false;
  }
  return webpEncodeSupported;
}

export function fileExtensionForImageBlob(blob: Blob): 'jpg' | 'webp' {
  return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

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

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
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

function encodeCanvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number): string {
  return canvas.toDataURL(mime, quality);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`${mime} encode failed`))),
      mime,
      quality
    );
  });
}

function drawImageToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  // White underlay so transparent PNGs don't become black in JPEG/WebP.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function encodeCanvasBest(
  canvas: HTMLCanvasElement,
  quality: number,
  preferWebp: boolean
): Promise<Blob> {
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (!preferWebp || !supportsWebpEncode()) return jpeg;
  try {
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    if (webp.type === 'image/webp' && webp.size > 32 && webp.size <= jpeg.size) {
      return webp;
    }
  } catch {
    /* JPEG fallback */
  }
  return jpeg;
}

function encodeCanvasBestDataUrl(
  canvas: HTMLCanvasElement,
  quality: number,
  preferWebp: boolean
): string {
  const jpegUrl = encodeCanvasToDataUrl(canvas, 'image/jpeg', quality);
  if (!preferWebp || !supportsWebpEncode()) return jpegUrl;
  try {
    const webpUrl = encodeCanvasToDataUrl(canvas, 'image/webp', quality);
    if (webpUrl.startsWith('data:image/webp') && webpUrl.length > 32 && webpUrl.length <= jpegUrl.length) {
      return webpUrl;
    }
  } catch {
    /* JPEG fallback */
  }
  return jpegUrl;
}

function compressLoadedImage(img: HTMLImageElement, options?: CompressImageOptions): string {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_DIMENSION;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_DIMENSION;
  const maxEncodedChars = options?.maxEncodedChars ?? DEFAULT_MAX_ENCODED_CHARS;
  const preferWebp = options?.preferWebp !== false;
  let quality = options?.quality ?? DEFAULT_QUALITY;

  let { width, height } = scaleDimensions(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxWidth,
    maxHeight
  );
  let canvas = drawImageToCanvas(img, width, height);
  let dataUrl = encodeCanvasBestDataUrl(canvas, quality, preferWebp);

  while (dataUrl.length > maxEncodedChars && quality > 0.5) {
    quality -= 0.07;
    dataUrl = encodeCanvasBestDataUrl(canvas, quality, preferWebp);
  }

  while (dataUrl.length > maxEncodedChars && width > 480 && height > 480) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    canvas = drawImageToCanvas(img, width, height);
    dataUrl = encodeCanvasBestDataUrl(canvas, quality, preferWebp);
  }

  return dataUrl;
}

async function compressLoadedImageToBlob(
  img: HTMLImageElement,
  options?: CompressImageOptions
): Promise<Blob> {
  const maxWidth = options?.maxWidth ?? INVENTORY_PHOTO_STORAGE_OPTIONS.maxWidth!;
  const maxHeight = options?.maxHeight ?? INVENTORY_PHOTO_STORAGE_OPTIONS.maxHeight!;
  const maxBlobBytes = options?.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const preferWebp = options?.preferWebp !== false;
  let quality = options?.quality ?? INVENTORY_PHOTO_STORAGE_OPTIONS.quality!;

  let { width, height } = scaleDimensions(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxWidth,
    maxHeight
  );
  let canvas = drawImageToCanvas(img, width, height);
  let blob = await encodeCanvasBest(canvas, quality, preferWebp);

  while (blob.size > maxBlobBytes && quality > 0.52) {
    quality -= 0.06;
    blob = await encodeCanvasBest(canvas, quality, preferWebp);
  }

  while (blob.size > maxBlobBytes && width > 640 && height > 640) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    canvas = drawImageToCanvas(img, width, height);
    blob = await encodeCanvasBest(canvas, quality, preferWebp);
  }

  return blob;
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

export async function compressImageFileToBlob(
  file: File,
  options?: CompressImageOptions
): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file');
  }
  const img = await loadImageFromFile(file);
  return compressLoadedImageToBlob(img, options);
}

export async function compressBlobToJpeg(
  blob: Blob,
  options?: CompressImageOptions
): Promise<Blob> {
  const img = await loadImageFromBlob(blob);
  return compressLoadedImageToBlob(img, options);
}

export async function compressDataUrl(
  dataUrl: string,
  options?: CompressImageOptions
): Promise<string> {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('data:image/svg')) return trimmed;
  const img = await loadImageFromDataUrl(trimmed);
  return compressLoadedImage(img, options);
}

export async function compressDataUrlToBlob(
  dataUrl: string,
  options?: CompressImageOptions
): Promise<Blob> {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/')) {
    throw new Error('Not a data URL image');
  }
  const img = await loadImageFromDataUrl(trimmed);
  return compressLoadedImageToBlob(img, options);
}

/** Keep hosted URLs; compress embedded data URLs only. */
export async function prepareInventoryPhotoUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('data:image/svg')) return trimmed;
  if (trimmed.length < 80_000) return trimmed;
  try {
    return await compressDataUrl(trimmed, INVENTORY_PHOTO_LOCAL_OPTIONS);
  } catch {
    return trimmed;
  }
}

export async function prepareInventoryPhotoUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(prepareInventoryPhotoUrl));
}

export async function dataUrlFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image blob'));
    reader.readAsDataURL(blob);
  });
}

export async function compressBlobToLocalDataUrl(
  blob: Blob,
  options?: CompressImageOptions
): Promise<string> {
  const compressed = await compressBlobToJpeg(blob, options ?? INVENTORY_PHOTO_LOCAL_OPTIONS);
  return dataUrlFromBlob(compressed);
}

/** Human-readable summary of active Storage compression (for Settings UI). */
export function describeInventoryPhotoCompression(): string {
  const o = INVENTORY_PHOTO_STORAGE_OPTIONS;
  const fmt = o.preferWebp ? 'WebP (JPEG fallback)' : 'JPEG';
  const kb = Math.round((o.maxBlobBytes || 0) / 1024);
  return `Photos are resized to max ${o.maxWidth}×${o.maxHeight}px and compressed as ${fmt} (target ≤${kb} KB) before Firebase Storage upload.`;
}
