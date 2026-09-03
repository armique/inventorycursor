const MANIFEST_KEY = 'inventory_revision_manifest_v1';

function storageKey(userId: string): string {
  return `${MANIFEST_KEY}_${userId}`;
}

/** id -> server updated_at last seen for that row. */
export function loadInventoryRevisionManifest(userId: string): Map<string, string> {
  if (!userId) return new Map();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveInventoryRevisionManifest(userId: string, revisions: Record<string, string>): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(revisions));
  } catch {
    /* quota */
  }
}

export function saveInventoryRevisionManifestFromMap(userId: string, manifest: Map<string, string>): void {
  saveInventoryRevisionManifest(userId, Object.fromEntries(manifest));
}

export function patchInventoryRevisionManifest(
  userId: string,
  patch: { revisions?: Record<string, string>; deletedIds?: string[] }
): Map<string, string> {
  const next = loadInventoryRevisionManifest(userId);
  for (const id of patch.deletedIds ?? []) next.delete(id);
  if (patch.revisions) {
    for (const [id, rev] of Object.entries(patch.revisions)) next.set(id, rev);
  }
  saveInventoryRevisionManifestFromMap(userId, next);
  return next;
}
