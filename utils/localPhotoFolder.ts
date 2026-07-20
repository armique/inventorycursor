/**
 * Local folder photo library (iCloud for Windows / any synced Photos folder).
 * Uses the File System Access API (Chrome / Edge on Windows).
 */

const DB_NAME = 'deinventory-photo-folders';
const STORE = 'handles';
const HANDLE_KEY = 'icloud-photos';

export type LocalPhotoEntry = {
  id: string;
  name: string;
  lastModified: number;
  size: number;
  handle: FileSystemFileHandle;
  previewUrl?: string;
};

function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

export function canUseLocalPhotoFolder(): boolean {
  return supportsDirectoryPicker();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function savePhotoFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save folder handle'));
  });
  db.close();
}

export async function loadPhotoFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error || new Error('Failed to read folder handle'));
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearPhotoFolderHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear folder handle'));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

async function ensureReadPermission(handle: FileSystemHandle): Promise<boolean> {
  const h = handle as FileSystemHandle & {
    queryPermission?: (desc: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (desc: { mode: 'read' }) => Promise<PermissionState>;
  };
  if (typeof h.queryPermission === 'function') {
    const state = await h.queryPermission({ mode: 'read' });
    if (state === 'granted') return true;
    if (typeof h.requestPermission === 'function') {
      const next = await h.requestPermission({ mode: 'read' });
      return next === 'granted';
    }
    return false;
  }
  return true;
}

export async function pickPhotoFolder(): Promise<FileSystemDirectoryHandle> {
  if (!supportsDirectoryPicker()) {
    throw new Error('Folder access needs Chrome or Edge on Windows.');
  }
  const handle = await (window as any).showDirectoryPicker({
    id: 'icloud-photos',
    mode: 'read',
    startIn: 'pictures',
  });
  await savePhotoFolderHandle(handle);
  return handle as FileSystemDirectoryHandle;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tif{1,2})$/i;

function isImageEntry(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/** Recursively collect image file handles (depth-limited for large iCloud trees). */
export async function listPhotosInFolder(
  root: FileSystemDirectoryHandle,
  options?: { maxFiles?: number; maxDepth?: number }
): Promise<LocalPhotoEntry[]> {
  const maxFiles = options?.maxFiles ?? 400;
  const maxDepth = options?.maxDepth ?? 4;
  const out: LocalPhotoEntry[] = [];

  async function walk(dir: FileSystemDirectoryHandle, depth: number, prefix: string) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    // @ts-expect-error async iterator on directory handle
    for await (const [name, handle] of dir.entries()) {
      if (out.length >= maxFiles) break;
      if (handle.kind === 'file' && isImageEntry(name)) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          out.push({
            id: `${prefix}${name}:${file.lastModified}:${file.size}`,
            name,
            lastModified: file.lastModified,
            size: file.size,
            handle: handle as FileSystemFileHandle,
          });
        } catch {
          // Online-only / not downloaded iCloud placeholders often fail here.
        }
      } else if (handle.kind === 'directory' && depth < maxDepth) {
        const lower = String(name).toLowerCase();
        if (lower === 'thumbnails' || lower === '.thumbnails' || lower.startsWith('.')) continue;
        await walk(handle as FileSystemDirectoryHandle, depth + 1, `${prefix}${name}/`);
      }
    }
  }

  await walk(root, 0, '');
  out.sort((a, b) => b.lastModified - a.lastModified);
  return out;
}

export async function getOrReconnectPhotoFolder(): Promise<FileSystemDirectoryHandle | null> {
  const existing = await loadPhotoFolderHandle();
  if (!existing) return null;
  const ok = await ensureReadPermission(existing);
  if (!ok) return null;
  return existing;
}

export async function fileFromLocalPhoto(entry: LocalPhotoEntry): Promise<File> {
  return entry.handle.getFile();
}

export function revokePreviewUrls(entries: LocalPhotoEntry[]): void {
  for (const e of entries) {
    if (e.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl);
  }
}

export async function attachPreviews(
  entries: LocalPhotoEntry[],
  limit = 80
): Promise<LocalPhotoEntry[]> {
  const next = [...entries];
  for (let i = 0; i < Math.min(limit, next.length); i++) {
    const e = next[i];
    if (e.previewUrl) continue;
    try {
      const file = await e.handle.getFile();
      // Skip HEIC previews in Chromium unless decodable — still selectable.
      if (/\.heic$|\.heif$/i.test(e.name) && !file.type.startsWith('image/')) {
        continue;
      }
      e.previewUrl = URL.createObjectURL(file);
    } catch {
      /* skip */
    }
  }
  return next;
}
