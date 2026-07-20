import type { InventoryItem } from '../types';

/** Kleinanzeigen ~65; eBay.de 80 — use the stricter shared limit for auto names. */
export const MARKETPLACE_TITLE_MAX = 65;

export type BuildTitleKind = 'pc' | 'bundle' | 'mixed';

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function getSpec(item: InventoryItem, ...keys: string[]): string {
  const specs = item.specs || {};
  for (const key of keys) {
    const hit = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
    if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return '';
}

function shortCpu(name: string): string {
  const n = name.replace(/^(AMD|Intel)\s+/i, '').trim();
  const m =
    n.match(/\b(i[3579]-?\d{3,5}\w*)\b/i) ||
    n.match(/\b(Ryzen\s*[3579]\s*\d{3,4}\w*|R[3579]\s*\d{3,4}\w*)\b/i) ||
    n.match(/\b((?:Core\s*)?i[3579]-?\d{3,5}\w*)\b/i);
  const raw = (m ? m[1] : n).replace(/^Core\s+/i, '').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 16);
}

/**
 * Short motherboard label for titles — brand + chipset/model (e.g. MSI A320M, ASRock H81M).
 */
export function shortMobo(name: string): string {
  const cleaned = name
    .replace(/\b(motherboard|mainboard|mobo|platine|主板)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const brandMatch = cleaned.match(
    /\b(MSI|ASUS|ASRock|Gigabyte|Biostar|ECS|NZXT|Intel|Supermicro|Colorful)\b/i
  );
  const brand = brandMatch ? brandMatch[1] : '';
  const rest = brand ? cleaned.replace(new RegExp(`\\b${brand}\\b`, 'i'), '').trim() : cleaned;

  const chip =
    rest.match(
      /\b([A-Z]{0,2}(?:A|B|H|X|Z|Q|W)\d{2,3}[A-Z]?(?:-[A-Z0-9]{1,8})?)\b/i
    ) ||
    rest.match(/\b((?:PRIME|ROG|TUF|MAG|MPG|PRO|AORUS|GAMING|PRO\s*WS)\s+[A-Z0-9-]+)\b/i) ||
    rest.match(/\b([A-Z]{1,3}\d{2,4}[A-Z]?(?:-[A-Z0-9]+)?)\b/i);

  if (brand && chip) return `${brand} ${chip[1]}`.replace(/\s+/g, ' ').slice(0, 24).trim();
  if (chip) return String(chip[1]).replace(/\s+/g, ' ').slice(0, 20).trim();
  if (brand && rest) return `${brand} ${rest}`.replace(/\s+/g, ' ').slice(0, 24).trim();
  return cleaned.slice(0, 22).trim();
}

function parseGb(raw: string): number {
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*(TB|GB)?/i);
  if (!m) return 0;
  let n = parseFloat(m[1]!);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if ((m[2] || '').toUpperCase() === 'TB') n *= 1024;
  return Math.round(n);
}

function stickCapacityGb(item: InventoryItem): number {
  const fromSpec = getSpec(
    item,
    'Capacity',
    'Size',
    'Module Capacity',
    'Density',
    'Memory',
    'Kit Capacity'
  );
  if (fromSpec) {
    // Kit Capacity like "16GB (2x8GB)" → prefer per-stick if NxM present
    const kit = fromSpec.match(/(\d+)\s*[x×]\s*(\d+)\s*GB/i);
    if (kit) return parseInt(kit[2]!, 10);
    const gb = parseGb(fromSpec);
    if (gb > 0) {
      // If Kit Capacity is total for multi-stick kit sold as one inventory row
      const modules = getSpec(item, 'Modules', 'Module Count', 'Sticks', 'Quantity');
      const modN = parseInt(modules.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(modN) && modN > 1 && gb % modN === 0) return gb / modN;
      // Single stick items usually store per-module capacity
      if (!/kit/i.test(fromSpec) || !kit) return gb;
    }
  }
  const nameKit = item.name.match(/(\d+)\s*[x×]\s*(\d+)\s*GB/i);
  if (nameKit) return parseInt(nameKit[2]!, 10);
  const nameGb = item.name.match(/(\d+)\s*GB/i);
  if (nameGb) return parseInt(nameGb[1]!, 10);
  return 0;
}

/**
 * RAM title segment:
 * total + (NxMGB config) + DDR type + speed — e.g. "8GB (2×4GB) DDR3 1600MHz"
 */
export function ramBits(items: InventoryItem[]): string {
  if (!items.length) return '';

  const perStick: number[] = [];
  let type = '';
  let speed = '';

  for (const it of items) {
    // Multi-module kit sold as one inventory row (any N×M): "3x4GB" → 12GB (3×4GB).
    // Matches name or Kit Capacity / Capacity specs like "16GB (2x8GB)".
    const kitMatch =
      getSpec(it, 'Kit Capacity', 'Capacity').match(/(\d+)\s*[x×]\s*(\d+)\s*GB/i) ||
      it.name.match(/(\d+)\s*[x×]\s*(\d+)\s*GB/i);
    if (kitMatch) {
      const modules = Math.max(1, parseInt(kitMatch[1]!, 10) || 1);
      const each = parseInt(kitMatch[2]!, 10);
      if (each > 0) {
        for (let i = 0; i < modules; i++) perStick.push(each);
      }
    } else {
      const gb = stickCapacityGb(it);
      if (gb > 0) {
        const modulesRaw = getSpec(it, 'Modules', 'Module Count', 'Sticks', 'Quantity');
        const modN = parseInt(String(modulesRaw).replace(/[^\d]/g, ''), 10);
        const modules = Number.isFinite(modN) && modN > 1 ? modN : 1;
        for (let i = 0; i < modules; i++) perStick.push(gb);
      }
    }

    if (!type) {
      type =
        getSpec(it, 'Memory Type', 'Type', 'DDR', 'RAM Type') ||
        (it.name.match(/\b(DDR[2345])\b/i) || [])[1] ||
        '';
    }
    if (!speed) {
      speed =
        getSpec(it, 'Speed', 'Frequency', 'Clock', 'MHz') ||
        (it.name.match(/(\d{3,5})\s*MHz/i) || [])[1] ||
        '';
      if (speed && !/mhz/i.test(speed)) speed = `${String(speed).replace(/[^\d]/g, '')}MHz`;
    }
  }

  // Fallback: one GB figure × item count
  if (!perStick.length) {
    for (const it of items) {
      const one = it.name.match(/(\d+)\s*GB/i);
      if (one) perStick.push(parseInt(one[1]!, 10));
    }
  }

  const stickCount = perStick.length || items.length;
  const totalGb = perStick.reduce((s, n) => s + n, 0);
  const parts: string[] = [];

  if (totalGb > 0) {
    parts.push(`${totalGb}GB`);
    if (stickCount > 0 && perStick.length) {
      const allSame = perStick.every((g) => g === perStick[0]);
      if (allSame) {
        parts.push(`(${stickCount}×${perStick[0]}GB)`);
      } else {
        parts.push(`(${perStick.map((g) => `${g}GB`).join('+')})`);
      }
    } else if (stickCount > 1) {
      parts.push(`(${stickCount} sticks)`);
    }
  } else if (stickCount > 0) {
    parts.push(`${stickCount}×RAM`);
  }

  if (type) parts.push(type.toUpperCase().replace(/\s+/g, ''));
  if (speed) parts.push(speed.replace(/\s+/g, ''));
  return parts.join(' ');
}

function storageBits(items: InventoryItem[]): string {
  if (!items.length) return '';
  const labels = items.map((it) => {
    const name = `${it.name} ${Object.values(it.specs || {}).join(' ')}`;
    const sizeMatch = name.match(/(\d+)\s*(TB|GB)/i);
    const size = sizeMatch ? `${sizeMatch[1]}${(sizeMatch[2] || 'GB').toUpperCase()}` : '';
    const isM2 = /\bm\.?2\b|nvme/i.test(name);
    const isHdd = /\bhdd\b|hard\s*disk/i.test(name);
    const kind = isM2 ? 'M.2' : isHdd ? 'HDD' : 'SSD';
    return [size, kind].filter(Boolean).join(' ');
  });
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1) return `${items.length}×Storage`;
  return '';
}

function findBySlotHints(parts: InventoryItem[]): {
  mobo?: InventoryItem;
  cpu?: InventoryItem;
  ram: InventoryItem[];
  storage: InventoryItem[];
} {
  const mobo = parts.find(
    (p) =>
      p.subCategory === 'Motherboards' ||
      p.category === 'Motherboards' ||
      /\b(motherboard|mainboard|mobo)\b/i.test(p.name) ||
      /\b((?:A|B|H|X|Z)\d{2,3}[A-Z]?(?:-[A-Z0-9]+)?)\b/i.test(p.name)
  );
  const cpu = parts.find(
    (p) =>
      p.subCategory === 'Processors' ||
      /\b(i[3579]|ryzen|cpu|prozessor)\b/i.test(p.name)
  );
  const ram = parts.filter(
    (p) => p.subCategory === 'RAM' || /\b(ddr[2345]|dimm|\d+\s*GB.*MHz)\b/i.test(p.name)
  );
  const storage = parts.filter(
    (p) =>
      p.subCategory === 'Storage (SSD/HDD)' ||
      /\b(ssd|hdd|nvme|m\.2)\b/i.test(p.name)
  );
  return { mobo, cpu, ram, storage };
}

function truncateTitle(title: string, max = MARKETPLACE_TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/**
 * Marketplace title for PC / Bundle / Mixed from parts.
 *
 * Bundle order:
 * 1) PC Bundle | Aufrustkit
 * 2) Motherboard (short)
 * 3) CPU
 * 4) RAM total (NxMGB) DDR speed
 * 5) Storage if present
 */
export function buildContainerTitle(
  kind: BuildTitleKind,
  parts: InventoryItem[],
  options?: { preferAufrustkit?: boolean; existingName?: string }
): string {
  const { mobo, cpu, ram, storage } = findBySlotHints(parts);
  const segments: string[] = [];

  if (kind === 'bundle') {
    segments.push(options?.preferAufrustkit ? 'Aufrustkit' : 'PC Bundle');
  } else if (kind === 'pc') {
    segments.push('PC');
  } else {
    segments.push('Mixed');
  }

  if (mobo) segments.push(shortMobo(mobo.name));
  if (cpu) segments.push(shortCpu(cpu.name));
  const ramStr = ramBits(ram);
  if (ramStr) segments.push(ramStr);
  const storStr = storageBits(storage);
  if (storStr) segments.push(storStr);

  if (kind === 'mixed' && segments.length <= 1) {
    return truncateTitle(`Mixed Bundle ${parts.length} Teile`);
  }

  // Prefer keeping type + mobo + CPU + RAM; drop storage first if over limit
  const join = (partsSeg: string[]) => partsSeg.filter(Boolean).join(' · ');
  let title = join(segments);
  if (title.length > MARKETPLACE_TITLE_MAX && storStr && segments[segments.length - 1] === storStr) {
    title = join(segments.slice(0, -1));
  }
  if (kind === 'bundle') {
    const tag = options?.preferAufrustkit ? 'Aufrustkit' : 'PC Bundle';
    if (!title.toLowerCase().includes(tag.toLowerCase())) {
      title = `${tag} · ${title}`;
    }
  }

  return truncateTitle(title);
}

export function ensureBundleTitleTag(name: string, preferAufrustkit = false): string {
  const tag = preferAufrustkit ? 'Aufrustkit' : 'PC Bundle';
  if (new RegExp(tag, 'i').test(name)) return truncateTitle(name);
  return truncateTitle(`${tag} · ${name}`);
}
