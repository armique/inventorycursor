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
    n.match(/\b((?:Core\s*)?i[3579]-?\d{3,5}\w*|Ryzen\s*[3579]\s*\d{3,4}\w*|R[3579]\s*\d{3,4}\w*)\b/i) ||
    n.match(/\b(i[3579]-?\d{4,5}\w*)\b/i);
  return (m ? m[1] : n).replace(/\s+/g, ' ').slice(0, 18).trim();
}

function shortGpu(name: string): string {
  const m =
    name.match(/\b(RTX|GTX|RX)\s*\d{3,5}\s*(Ti|SUPER|XT|XTX)?\b/i) ||
    name.match(/\b(UHD|Iris)\s*\w*/i);
  return (m ? m[0] : name.replace(/^(MSI|ASUS|Gigabyte|Sapphire|XFX|PowerColor|EVGA)\s+/i, ''))
    .replace(/\s+/g, ' ')
    .slice(0, 16)
    .trim();
}

function ramBits(items: InventoryItem[]): string {
  if (!items.length) return '';
  let totalGb = 0;
  let type = '';
  let speed = '';
  for (const it of items) {
    const fromSpec =
      getSpec(it, 'Kit Capacity', 'Capacity', 'Size', 'Memory') ||
      (it.name.match(/(\d+)\s*GB/i) || [])[1];
    const gb = parseInt(String(fromSpec).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(gb) && gb > 0) totalGb += gb;
    if (!type) {
      type =
        getSpec(it, 'Memory Type', 'Type', 'DDR') ||
        (it.name.match(/\b(DDR[2345])\b/i) || [])[1] ||
        '';
    }
    if (!speed) {
      speed =
        getSpec(it, 'Speed', 'Frequency', 'MHz') ||
        (it.name.match(/(\d{3,5})\s*MHz/i) || [])[1] ||
        '';
      if (speed && !/mhz/i.test(speed)) speed = `${speed}MHz`;
    }
  }
  if (!totalGb && items.length) {
    const one = items[0].name.match(/(\d+)\s*GB/i);
    if (one) totalGb = parseInt(one[1]!, 10) * items.length;
  }
  const parts: string[] = [];
  if (totalGb) parts.push(`${totalGb}GB`);
  if (type) parts.push(type.toUpperCase());
  if (speed) parts.push(speed.replace(/\s+/g, ''));
  return parts.join(' ');
}

function storageBits(items: InventoryItem[]): string {
  if (!items.length) return '';
  const labels = items.map((it) => {
    const name = `${it.name} ${Object.values(it.specs || {}).join(' ')}`;
    const size = (name.match(/(\d+)\s*(TB|GB)/i) || []).slice(1, 3).join('');
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

function coolingBits(items: InventoryItem[]): string {
  if (!items.length) return '';
  const blob = items.map((i) => `${i.name} ${Object.values(i.specs || {}).join(' ')}`).join(' ');
  if (/\b(aio|liquid|wasser|water\s*cool)/i.test(blob)) return 'AIO';
  if (/\b(air|tower|luft|cooler|kühler)\b/i.test(blob)) return 'Air';
  return '';
}

function findBySlotHints(parts: InventoryItem[]): {
  cpu?: InventoryItem;
  gpu?: InventoryItem;
  ram: InventoryItem[];
  storage: InventoryItem[];
  cooling: InventoryItem[];
} {
  const cpu = parts.find(
    (p) =>
      p.subCategory === 'Processors' ||
      /\b(i[3579]|ryzen|cpu|prozessor)\b/i.test(p.name)
  );
  const gpu = parts.find(
    (p) =>
      p.subCategory === 'Graphics Cards' ||
      /\b(rtx|gtx|radeon|rx\s?\d)/i.test(p.name)
  );
  const ram = parts.filter(
    (p) => p.subCategory === 'RAM' || /\b(ddr[2345]|dimm|\d+\s*GB.*MHz)\b/i.test(p.name)
  );
  const storage = parts.filter(
    (p) =>
      p.subCategory === 'Storage (SSD/HDD)' ||
      /\b(ssd|hdd|nvme|m\.2)\b/i.test(p.name)
  );
  const cooling = parts.filter(
    (p) =>
      p.subCategory === 'Cooling' ||
      /\b(aio|cooler|kühler|liquid|wasser)\b/i.test(p.name)
  );
  return { cpu, gpu, ram, storage, cooling };
}

function truncateTitle(title: string, max = MARKETPLACE_TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/**
 * Build a marketplace-safe title for PC / Bundle / Mixed Bundle from component parts.
 * Bundle titles always include "PC Bundle" or "Aufrustkit".
 */
export function buildContainerTitle(
  kind: BuildTitleKind,
  parts: InventoryItem[],
  options?: { preferAufrustkit?: boolean; existingName?: string }
): string {
  const { cpu, gpu, ram, storage, cooling } = findBySlotHints(parts);
  const segments: string[] = [];

  if (kind === 'bundle') {
    segments.push(options?.preferAufrustkit ? 'Aufrustkit' : 'PC Bundle');
  } else if (kind === 'pc') {
    segments.push('PC');
  } else {
    segments.push('Mixed');
  }

  if (cpu) segments.push(shortCpu(cpu.name));
  if (gpu) segments.push(shortGpu(gpu.name));
  const ramStr = ramBits(ram);
  if (ramStr) segments.push(ramStr);
  const storStr = storageBits(storage);
  if (storStr) segments.push(storStr);
  const coolStr = coolingBits(cooling);
  if (coolStr) segments.push(coolStr);

  if (kind === 'mixed' && segments.length <= 1) {
    const n = parts.length;
    return truncateTitle(`Mixed Bundle ${n} Teile`);
  }

  // Ensure Bundle keyword survives truncation
  let title = segments.filter(Boolean).join(' · ');
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
