/**
 * Read local image Files reliably — especially iCloud / OneDrive online-only
 * placeholders on Windows, which often arrive with empty MIME type and fail
 * the first read until the OS finishes downloading.
 */

const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

export class LocalImageReadError extends Error {
  readonly code: 'cloud' | 'heic' | 'empty' | 'decode' | 'type' | 'unknown';

  constructor(
    message: string,
    code: LocalImageReadError['code'] = 'unknown'
  ) {
    super(message);
    this.name = 'LocalImageReadError';
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionOf(name: string): string {
  const m = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] || '';
}

export function looksLikeHeic(file: Pick<File, 'name' | 'type'>): boolean {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  const ext = extensionOf(file.name);
  return ext === 'heic' || ext === 'heif';
}

/** Infer a usable image MIME when the OS/picker leaves `file.type` empty (common with iCloud). */
export function resolveImageMimeType(file: Pick<File, 'name' | 'type'>): string | null {
  const type = (file.type || '').trim().toLowerCase();
  if (type.startsWith('image/')) return type;
  const ext = extensionOf(file.name);
  return IMAGE_EXT_MIME[ext] || null;
}

export function isLikelyImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return resolveImageMimeType(file) !== null;
}

function cloudHint(fileName: string): string {
  return (
    `Could not read "${fileName}". If it shows a cloud icon in File Explorer, ` +
    `right-click → Always keep on this device (wait for the green check), then try again.`
  );
}

function heicHint(fileName: string): string {
  return (
    `Could not read "${fileName}" (HEIC). Convert to JPEG in Photos / export Most Compatible, ` +
    `or right-click in Explorer → Always keep on this device and re-save as JPG.`
  );
}

/**
 * Force the OS to hydrate an online-only cloud file by reading its bytes,
 * then return a new File with a correct MIME type.
 */
export async function materializeLocalImageFile(
  file: File,
  options?: { attempts?: number; delayMs?: number }
): Promise<File> {
  const mime = resolveImageMimeType(file);
  if (!mime) {
    throw new LocalImageReadError(
      `"${file.name}" is not a supported image type.`,
      'type'
    );
  }

  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 600;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (file.size === 0) {
        throw new LocalImageReadError(cloudHint(file.name), 'empty');
      }

      // Reading bytes triggers Windows Cloud Files / iCloud hydration.
      const buffer = await file.arrayBuffer();
      if (!buffer.byteLength) {
        throw new LocalImageReadError(cloudHint(file.name), 'empty');
      }

      // Partial / stub reads sometimes return a tiny header before download finishes.
      if (file.size > 8_192 && buffer.byteLength < 512) {
        throw new LocalImageReadError(cloudHint(file.name), 'cloud');
      }

      const materialized = new File([buffer], file.name, {
        type: mime,
        lastModified: file.lastModified || Date.now(),
      });

      try {
        await assertImageDecodable(materialized);
        return materialized;
      } catch (decodeErr) {
        if (looksLikeHeic(materialized)) {
          throw new LocalImageReadError(heicHint(file.name), 'heic');
        }
        throw decodeErr;
      }
    } catch (err) {
      lastError = err;
      if (err instanceof LocalImageReadError && (err.code === 'heic' || err.code === 'type')) {
        throw err;
      }
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  if (lastError instanceof LocalImageReadError) throw lastError;
  throw new LocalImageReadError(cloudHint(file.name), 'cloud');
}

function assertImageDecodable(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new LocalImageReadError(`Could not decode "${file.name}".`, 'decode'));
        return;
      }
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new LocalImageReadError(
          looksLikeHeic(file) ? heicHint(file.name) : cloudHint(file.name),
          looksLikeHeic(file) ? 'heic' : 'decode'
        )
      );
    };
    img.src = url;
  });
}

/** Friendly message for any upload/read failure (including non-LocalImageReadError). */
export function localImageReadErrorMessage(err: unknown, fallback = 'Could not read one or more image files.'): string {
  if (err instanceof LocalImageReadError) return err.message;
  if (err instanceof Error && err.message.trim()) {
    const m = err.message;
    if (/not an image|failed to decode|could not read|empty/i.test(m)) {
      return (
        `${m} If the photo has a cloud icon in iCloud Drive, right-click → ` +
        `Always keep on this device, then try again.`
      );
    }
    return m;
  }
  return (
    `${fallback} If the photo has a cloud icon in iCloud Drive, right-click → ` +
    `Always keep on this device, then try again.`
  );
}
