const STORAGE_KEY = 'inventory_photo_thumbs_v1';
const MAX_ENTRIES = 2000;

const thumbs = new Map<string, string>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [original, thumb] of Object.entries(parsed)) {
      if (original && thumb) thumbs.set(original, thumb);
    }
  } catch {
    /* quota / private mode / corrupt */
  }
}

function persist(): void {
  try {
    if (thumbs.size > MAX_ENTRIES) {
      const extra = thumbs.size - MAX_ENTRIES;
      const keys = thumbs.keys();
      for (let i = 0; i < extra; i++) {
        const k = keys.next().value;
        if (k) thumbs.delete(k);
      }
    }
    const obj: Record<string, string> = {};
    for (const [k, v] of thumbs) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota */
  }
}

export function rememberPhotoThumb(originalUrl: string, thumbUrl: string): void {
  const original = originalUrl.trim();
  const thumb = thumbUrl.trim();
  if (!original || !thumb || original === thumb) return;
  hydrate();
  thumbs.set(original, thumb);
  persist();
}

export function lookupPhotoThumb(originalUrl: string): string | undefined {
  const original = originalUrl.trim();
  if (!original) return undefined;
  hydrate();
  return thumbs.get(original);
}
