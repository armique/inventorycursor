import { normalizeImgurImageUrl } from '../services/ebayOrderScreenshotAI';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import { filterUsableImageUrls } from '../services/storefrontImageUtils';
import type { InventoryItem } from '../types';

export function normalizeImageList(urls: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const u = (raw || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

const CATEGORY_PLACEHOLDER_IMAGES = new Set(Object.values(CATEGORY_IMAGES));

export function isCategoryPlaceholderImage(url: string): boolean {
  return CATEGORY_PLACEHOLDER_IMAGES.has(url.trim());
}

/** Real item photos only — excludes empty URLs and category SVG placeholders. */
export function getItemUserPhotoUrls(item: Pick<InventoryItem, 'imageUrl' | 'imageUrls'>): string[] {
  return filterUsableImageUrls([item.imageUrl, ...(item.imageUrls || [])]).filter(
    (u) => !isCategoryPlaceholderImage(u)
  );
}

export function itemHasUserPhotos(item: Pick<InventoryItem, 'imageUrl' | 'imageUrls'>): boolean {
  return getItemUserPhotoUrls(item).length > 0;
}

export function getItemUserPhotoCount(item: Pick<InventoryItem, 'imageUrl' | 'imageUrls'>): number {
  return getItemUserPhotoUrls(item).length;
}

export function isImgurAlbumOrGalleryUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'imgur.com') return false;
    return u.pathname.startsWith('/a/') || u.pathname.startsWith('/gallery/');
  } catch {
    return false;
  }
}

function extractImgurCollectionId(url: string): { type: 'album' | 'gallery'; id: string } | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'imgur.com') return null;
    const m = u.pathname.match(/^\/(?:a|gallery)\/([a-zA-Z0-9]+)/);
    if (!m?.[1]) return null;
    return { type: u.pathname.startsWith('/gallery/') ? 'gallery' : 'album', id: m[1] };
  } catch {
    return null;
  }
}

export async function fetchImgurAlbumImageUrls(albumOrGalleryUrl: string): Promise<string[]> {
  const parsed = extractImgurCollectionId(albumOrGalleryUrl);
  if (!parsed) {
    throw new Error('Paste a valid Imgur album or gallery link (imgur.com/a/… or /gallery/…).');
  }

  const envId = import.meta.env.VITE_IMGUR_CLIENT_ID;
  const clientId = typeof envId === 'string' && envId.trim() ? envId.trim() : '546c25a59c58ad7';
  const path = parsed.type === 'gallery' ? `gallery/${parsed.id}` : `album/${parsed.id}`;

  const res = await fetch(`https://api.imgur.com/3/${path}/images`, {
    headers: { Authorization: `Client-ID ${clientId}` },
  });
  if (!res.ok) {
    throw new Error(`Imgur album could not be loaded (${res.status}). Try direct image URLs or upload instead.`);
  }
  const data = await res.json();
  const images = Array.isArray(data?.data) ? data.data : [];
  const urls = images
    .map((img: { link?: string; type?: string }) => (img?.type === 'video/mp4' ? null : img?.link))
    .filter(Boolean) as string[];
  if (!urls.length) throw new Error('No images found in that Imgur album.');
  return normalizeImageList(urls.map((u) => normalizeImgurImageUrl(u)));
}

export async function resolveImageUrlsFromInput(input: string): Promise<string[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];

  for (const line of lines) {
    if (isImgurAlbumOrGalleryUrl(line)) {
      out.push(...(await fetchImgurAlbumImageUrls(line)));
    } else {
      out.push(normalizeImgurImageUrl(line));
    }
  }

  return normalizeImageList(out);
}

export async function filesToDataUrls(files: File[]): Promise<string[]> {
  const toDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  const urls = await Promise.all(files.map(toDataUrl));
  return normalizeImageList(urls);
}

export type ItemPresenceCycleState = 'unknown' | 'present' | 'lost' | 'defective';

export function getItemPresenceCycleState(item: {
  presence?: 'present' | 'lost';
  isDefective?: boolean;
}): ItemPresenceCycleState {
  if (item.isDefective) return 'defective';
  if (item.presence === 'lost') return 'lost';
  if (item.presence === 'present') return 'present';
  return 'unknown';
}

export function cycleInventoryItemPresence(item: InventoryItem): InventoryItem {
  const state = getItemPresenceCycleState(item);
  const updated: InventoryItem = { ...item };

  switch (state) {
    case 'unknown':
      updated.presence = 'present';
      updated.isDefective = false;
      break;
    case 'present':
      updated.presence = 'lost';
      updated.isDefective = false;
      break;
    case 'lost':
      delete updated.presence;
      updated.isDefective = true;
      break;
    case 'defective':
      delete updated.presence;
      updated.isDefective = false;
      break;
  }

  return updated;
}
