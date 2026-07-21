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

/** heic2any rejects plain `{ code, message }` objects — never use String(err). */
export function formatCaughtError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const msg =
      (typeof o.message === 'string' && o.message) ||
      (typeof o.Message === 'string' && o.Message) ||
      (typeof o.error === 'string' && o.error) ||
      '';
    const code = o.code ?? o.Code;
    if (msg.trim()) {
      return code != null && String(code).trim() ? `${String(code)}: ${msg.trim()}` : msg.trim();
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}' && json !== 'null') return json;
    } catch {
      /* ignore */
    }
  }
  if (err == null) return '';
  const s = String(err);
  return s === '[object Object]' ? '' : s;
}

function cloudHint(fileName: string): string {
  return (
    `Could not read "${fileName}". If it shows a cloud icon in File Explorer, ` +
    `right-click → Always keep on this device (wait for the green check), then try again.`
  );
}

function heicFailHint(fileName: string, detail?: string): string {
  const base =
    `Could not convert "${fileName}" from HEIC. Wait until iCloud finishes downloading ` +
    `(green check, not cloud icon), then try again — or export as JPEG from Photos.`;
  const d = (detail || '').trim();
  if (!d || d === '[object Object]') return base;
  return `${base} (${d})`;
}

function jpegNameFromHeic(name: string): string {
  return name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
}

/**
 * Sniff real container from bytes — iCloud often keeps a .HEIC name on JPEG data,
 * or returns a tiny stub before download finishes.
 */
export function sniffImageKind(
  buffer: ArrayBuffer
): 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'unknown' {
  const u8 = new Uint8Array(buffer);
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpeg';
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return 'png';
  }
  if (
    u8.length >= 6 &&
    u8[0] === 0x47 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46
  ) {
    return 'gif';
  }
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return 'webp';
  }
  if (u8.length >= 12) {
    const brand = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
    if (brand === 'ftyp') {
      const head = String.fromCharCode(...u8.slice(8, Math.min(u8.length, 32))).toLowerCase();
      if (/heic|heix|hevf|heif|mif1|msf1|heim|heis|avic/.test(head)) return 'heic';
    }
  }
  return 'unknown';
}

function fileFromBuffer(
  buffer: ArrayBuffer,
  name: string,
  type: string,
  lastModified?: number
): File {
  return new File([buffer], name, {
    type,
    lastModified: lastModified || Date.now(),
  });
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
    const detail = formatCaughtError(err);
    // heic2any: file is already JPEG/PNG despite .HEIC name — treat as success path upstream.
    if (/already browser readable/i.test(detail)) {
      throw new LocalImageReadError(detail, 'decode');
    }
    throw new LocalImageReadError(heicFailHint(file.name, detail), 'heic');
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
  const namedHeic = looksLikeHeic(file);

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

      const kind = sniffImageKind(buffer);

      // Named HEIC but still a cloud stub / incomplete download.
      if (namedHeic && kind === 'unknown' && buffer.byteLength < 8_192) {
        throw new LocalImageReadError(cloudHint(file.name), 'cloud');
      }

      // iCloud sometimes keeps .HEIC extension on already-JPEG bytes.
      if (kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'gif') {
        const realMime =
          kind === 'jpeg'
            ? 'image/jpeg'
            : kind === 'png'
              ? 'image/png'
              : kind === 'webp'
                ? 'image/webp'
                : 'image/gif';
        const realName =
          namedHeic && kind === 'jpeg' ? jpegNameFromHeic(file.name) : file.name;
        const ready = fileFromBuffer(buffer, realName, realMime, file.lastModified);
        await assertImageDecodable(ready);
        return ready;
      }

      let materialized = fileFromBuffer(buffer, file.name, mime, file.lastModified);

      if (namedHeic || kind === 'heic') {
        try {
          materialized = await convertHeicFileToJpeg(materialized);
        } catch (convErr) {
          // Already-readable per heic2any — retry as JPEG.
          if (
            convErr instanceof LocalImageReadError &&
            convErr.code === 'decode' &&
            /already browser readable/i.test(convErr.message)
          ) {
            const asJpeg = fileFromBuffer(
              buffer,
              jpegNameFromHeic(file.name),
              'image/jpeg',
              file.lastModified
            );
            await assertImageDecodable(asJpeg);
            return asJpeg;
          }
          throw convErr;
        }
      }

      try {
        await assertImageDecodable(materialized);
        return materialized;
      } catch (decodeErr) {
        // Some files are HEIC despite a .jpg name from iCloud — try convert once.
        if (!namedHeic && kind !== 'heic' && attempt === 0) {
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
        attempt >= Math.min(4, attempts - 1)
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
    namedHeic
      ? heicFailHint(file.name, formatCaughtError(lastError))
      : cloudHint(file.name),
    namedHeic ? 'heic' : 'cloud'
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
export function localImageReadErrorMessage(
  err: unknown,
  fallback = 'Could not read one or more image files.'
): string {
  if (err instanceof LocalImageReadError) return err.message;
  const detail = formatCaughtError(err);
  if (detail) {
    if (/not an image|failed to decode|could not read|empty|heic|libheif/i.test(detail)) {
      return (
        `${detail} If the photo has a cloud icon in iCloud Drive, right-click → ` +
        `Always keep on this device, then try again.`
      );
    }
    return detail;
  }
  return (
    `${fallback} If the photo has a cloud icon in iCloud Drive, right-click → ` +
    `Always keep on this device, then try again.`
  );
}
