/**
 * Read local image Files reliably — especially iCloud / OneDrive online-only
 * placeholders on Windows, which often arrive with empty MIME type and fail
 * the first read until the OS finishes downloading.
 *
 * HEIC/HEIF (iPhone / iCloud) is converted to JPEG in-browser via heic2any.
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

function heicFailHint(fileName: string): string {
  return (
    `Could not convert "${fileName}" from HEIC. Wait until iCloud finishes downloading ` +
    `(green check, not cloud icon), then try again — or export as JPEG from Photos.`
  );
}

function jpegNameFromHeic(name: string): string {
  return name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
}

/** Convert iPhone/iCloud HEIC/HEIF to a JPEG File Chrome can decode. */
export async function convertHeicFileToJpeg(file: File): Promise<File> {
  try {
    const { default: heic2any } = await import('heic2any');
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob || !(blob instanceof Blob) || blob.size < 32) {
      throw new LocalImageReadError(heicFailHint(file.name), 'heic');
    }
    return new File([blob], jpegNameFromHeic(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    });
  } catch (err) {
    if (err instanceof LocalImageReadError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new LocalImageReadError(
      `${heicFailHint(file.name)}${msg ? ` (${msg})` : ''}`,
      'heic'
    );
  }
}

/**
 * Force the OS to hydrate an online-only cloud file by reading its bytes,
 * then return a new File with a correct MIME type (HEIC → JPEG when needed).
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
  const heic = looksLikeHeic(file);

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

      let materialized = new File([buffer], file.name, {
        type: mime,
        lastModified: file.lastModified || Date.now(),
      });

      if (heic) {
        // Chromium cannot decode HEIC — convert before compress/upload.
        materialized = await convertHeicFileToJpeg(materialized);
      }

      try {
        await assertImageDecodable(materialized);
        return materialized;
      } catch (decodeErr) {
        // Some files are HEIC despite a .jpg name from iCloud — try convert once.
        if (!heic && attempt === 0) {
          try {
            const converted = await convertHeicFileToJpeg(materialized);
            await assertImageDecodable(converted);
            return converted;
          } catch {
            /* fall through */
          }
        }
        throw decodeErr;
      }
    } catch (err) {
      lastError = err;
      if (err instanceof LocalImageReadError && err.code === 'type') {
        throw err;
      }
      // HEIC conversion failures: retry a few times in case iCloud was still hydrating.
      if (
        err instanceof LocalImageReadError &&
        err.code === 'heic' &&
        attempt >= Math.min(3, attempts - 1)
      ) {
        throw err;
      }
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  if (lastError instanceof LocalImageReadError) throw lastError;
  throw new LocalImageReadError(
    heic ? heicFailHint(file.name) : cloudHint(file.name),
    heic ? 'heic' : 'cloud'
  );
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
          looksLikeHeic(file) ? heicFailHint(file.name) : cloudHint(file.name),
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
    if (/not an image|failed to decode|could not read|empty|heic/i.test(m)) {
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
