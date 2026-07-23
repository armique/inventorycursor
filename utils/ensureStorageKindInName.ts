/**
 * Ensure SSD/HDD inventory names state whether the drive is NVMe, (SATA) SSD, or HDD.
 */

export type StorageKind = 'NVMe' | 'SSD' | 'HDD';

const STORAGE_SUB_RE = /storage\s*\(ssd\/hdd\)|\bssd\b|\bhdd\b|\bnvme\b|\bm\.?2\b|festplatte/i;

export function isStorageItem(
  category?: string,
  subCategory?: string,
  name?: string
): boolean {
  const blob = `${category || ''} ${subCategory || ''} ${name || ''}`;
  if (/storage\s*\(ssd\/hdd\)/i.test(subCategory || '')) return true;
  if (/^storage$/i.test(category || '') || /^storage$/i.test(subCategory || '')) return true;
  return STORAGE_SUB_RE.test(blob);
}

function specBlob(specs?: Record<string, string | number>): string {
  if (!specs) return '';
  return Object.entries(specs)
    .map(([k, v]) => `${k} ${v}`)
    .join(' ');
}

/** Infer NVMe / SSD / HDD from listing title, name, and specs. */
export function inferStorageKind(
  text: string,
  specs?: Record<string, string | number>
): StorageKind | null {
  const blob = `${text || ''} ${specBlob(specs)}`.toLowerCase();
  if (!blob.trim()) return null;

  const looksStorage =
    /\b(ssd|hdd|nvme|m\.?2|festplatte|solid\s*state|hard\s*disk|sata|pcie)\b/.test(blob) ||
    /drive\s*type|interface|capacity/.test(blob);
  if (!looksStorage) return null;

  const isHdd =
    /\b(hdd|hard\s*disk|hard\s*drive)\b/.test(blob) ||
    (/\bfestplatte\b/.test(blob) && !/\b(ssd|nvme|m\.?2)\b/.test(blob)) ||
    /\b\d{4,5}\s*rpm\b/.test(blob) ||
    /\b3\.5\s*("|''|zoll|inch)?\b/.test(blob);

  const isNvme =
    /\bnvme\b/.test(blob) ||
    /\bm\.?2\b/.test(blob) ||
    /\bpcie\s*[345](\.0)?\b/.test(blob) ||
    (/\bpcie\b/.test(blob) && /\b(ssd|drive)\b/.test(blob));

  const isSataSsd =
    /\bsata\b/.test(blob) ||
    /\b2\.5\s*("|''|zoll|inch)?\b/.test(blob);

  // Prefer explicit protocol: NVMe > HDD > SATA SSD > generic SSD
  if (isNvme && !/\bhdd\b/.test(blob)) return 'NVMe';
  if (isHdd && !isNvme) return 'HDD';
  if (isSataSsd && !isNvme) return 'SSD';
  if (/\bssd\b/.test(blob) && !isNvme) return 'SSD';
  return null;
}

function nameAlreadyHasKind(name: string, kind: StorageKind): boolean {
  const n = name || '';
  if (kind === 'NVMe') return /\bnvme\b|\bm\.?2\b/i.test(n);
  if (kind === 'HDD') return /\bhdd\b/i.test(n);
  // SSD: plain SSD is enough; "NVMe SSD" counts as NVMe path instead
  return /\bssd\b/i.test(n) && !/\bnvme\b/i.test(n);
}

/** Append NVMe / SSD / HDD to the product name when missing. */
export function ensureStorageKindInName(name: string, kind: StorageKind | null): string {
  let base = String(name || '').replace(/\s+/g, ' ').trim();
  if (!base || !kind) return base;

  // Prefer explicit NVMe over a bare "SSD" label when kind is NVMe
  if (kind === 'NVMe' && /\bssd\b/i.test(base) && !/\bnvme\b|\bm\.?2\b/i.test(base)) {
    base = base.replace(/\bssd\b/i, '').replace(/\s+/g, ' ').trim();
  }

  if (nameAlreadyHasKind(base, kind)) return base;
  return `${base} ${kind}`.replace(/\s+/g, ' ').trim();
}

export function storageDriveTypeLabel(kind: StorageKind): string {
  if (kind === 'NVMe') return 'NVMe SSD';
  if (kind === 'HDD') return 'HDD';
  return 'SATA SSD';
}

/**
 * For storage items: fix standardized name + Drive Type from title/specs signals.
 */
export function applyStorageKindToParsedItem(input: {
  name: string;
  category?: string;
  subCategory?: string;
  specs?: Record<string, string | number>;
  /** Original listing / purchase title for stronger signals */
  sourceText?: string;
}): { name: string; specs: Record<string, string | number> } {
  const specs = { ...(input.specs || {}) };
  const nameIn = String(input.name || '').trim();
  if (!isStorageItem(input.category, input.subCategory, nameIn) && !isStorageItem(undefined, undefined, input.sourceText)) {
    return { name: nameIn, specs };
  }

  const kind = inferStorageKind(
    `${input.sourceText || ''} ${nameIn}`,
    specs
  );
  const name = ensureStorageKindInName(nameIn, kind);
  if (kind) {
    const existing = String(specs['Drive Type'] || specs['Type'] || '').trim();
    const label = storageDriveTypeLabel(kind);
    const existingMatches =
      (kind === 'NVMe' && /nvme/i.test(existing)) ||
      (kind === 'SSD' && /sata|ssd/i.test(existing) && !/nvme/i.test(existing)) ||
      (kind === 'HDD' && /hdd/i.test(existing));
    if (!existingMatches) specs['Drive Type'] = label;
    if (!specs['Interface']) {
      specs['Interface'] = kind === 'NVMe' ? 'NVMe' : 'SATA';
    }
  }
  return { name, specs };
}
