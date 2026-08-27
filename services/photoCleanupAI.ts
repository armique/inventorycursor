/** AI crop/clutter/card-photo suggestions for freshly-picked item photos, before upload.
 *  One /api/gemini?route=photo-cleanup call per photo — see lib/apiHandlers/photoCleanupHandler.js. */
import type { CropBox } from '../utils/cropImageToBox';

export interface PhotoCleanupSuggestion {
  cropBox: CropBox;
  hasClutter: boolean;
  clutterNote: string | null;
  cardScore: number;
}

/** Per-photo outcome — `suggestion` is null when the AI call failed, so the UI can fall back
 *  to "use as shot" for that one photo without blocking the rest of the batch. */
export type PhotoCleanupOutcome =
  | { status: 'ok'; suggestion: PhotoCleanupSuggestion }
  | { status: 'error'; message: string };

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error('Could not read image file'));
        return;
      }
      resolve({ base64: result.slice(comma + 1), mime: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

async function analyzeOnePhoto(file: File): Promise<PhotoCleanupOutcome> {
  try {
    const { base64, mime } = await fileToBase64(file);
    const res = await fetch('/api/gemini?route=photo-cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: mime }),
    });
    const data = (await res.json().catch(() => null)) as { result?: PhotoCleanupSuggestion; error?: string } | null;
    if (res.ok && data?.result) return { status: 'ok', suggestion: data.result };
    return { status: 'error', message: data?.error || `Photo cleanup failed (${res.status}).` };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Photo cleanup failed.' };
  }
}

/** Analyzes a batch of photos with a small concurrency cap — one slow/failed photo never
 *  blocks the others, and the caller gets a same-length, same-order outcome array back. */
export async function analyzePhotosForCleanup(
  files: File[],
  options?: { concurrency?: number; onProgress?: (done: number, total: number) => void }
): Promise<PhotoCleanupOutcome[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const results: PhotoCleanupOutcome[] = new Array(files.length);
  let done = 0;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= files.length) return;
      results[i] = await analyzeOnePhoto(files[i]);
      done += 1;
      options?.onProgress?.(done, files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}
