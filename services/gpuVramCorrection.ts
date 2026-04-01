/**
 * Corrects AI-hallucinated GPU VRAM using product-name hints and a small
 * known-model table (e.g. RTX 5070 is 12GB, not 24GB).
 */

export function shouldApplyGpuVramCorrection(subCategory: string | undefined, productName: string): boolean {
  const sub = (subCategory || '').toLowerCase();
  if (sub.includes('graphics') || sub.includes('gpu') || sub === 'graphics cards') return true;
  const n = productName.toLowerCase();
  return /\brtx\b|\bgtx\b|\bradeon\b|\brx\s*\d{3,4}\b|\barc\s*a\d/i.test(n);
}

/** Parse "24GB", "24 GB", 24 → GB number, or null */
function parseVramGbValue(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d{1,3})\s*GB/i);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n <= 128 ? n : null;
}

/** VRAM capacity listed in the title (e.g. "RTX 5070 12GB") — strongest signal */
function extractTitleListedVramGb(full: string): number | null {
  const m = full.match(/\bRTX\s*\d{4}(?:\s*Ti)?\s+(\d{1,2})\s*GB\b/i);
  if (m) return parseInt(m[1], 10);
  const m2 = full.match(/\bRX\s*\d{4}(?:\s*XT)?\s+(\d{1,2})\s*GB\b/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

type PatternGb = { re: RegExp; gb: number };

/** Order matters: Ti / Super variants before base models */
const KNOWN_NVIDIA_GB: PatternGb[] = [
  { re: /\brtx\s*5090\b/i, gb: 32 },
  { re: /\brtx\s*5080\b/i, gb: 16 },
  { re: /\brtx\s*5070\s*ti\b/i, gb: 16 },
  { re: /\brtx\s*5070\b/i, gb: 12 },
  { re: /\brtx\s*5060\b/i, gb: 8 },
  { re: /\brtx\s*4090\b/i, gb: 24 },
  { re: /\brtx\s*4080\s*super\b/i, gb: 16 },
  { re: /\brtx\s*4080\b/i, gb: 16 },
  { re: /\brtx\s*4070\s*ti\s*super\b/i, gb: 16 },
  { re: /\brtx\s*4070\s*ti\b/i, gb: 12 },
  { re: /\brtx\s*4070\s*super\b/i, gb: 12 },
  { re: /\brtx\s*4070\b/i, gb: 12 },
  { re: /\brtx\s*4060\s*ti\b/i, gb: 16 },
  { re: /\brtx\s*4060\b/i, gb: 8 },
];

const KNOWN_AMD_GB: PatternGb[] = [
  { re: /\brx\s*9070\s*xt\b/i, gb: 16 },
  { re: /\brx\s*9070\b/i, gb: 16 },
  { re: /\brx\s*9060\s*xt\b/i, gb: 16 },
  { re: /\brx\s*9060\b/i, gb: 8 },
];

function knownVramGbFromModel(full: string): number | null {
  const s = full.replace(/\s+/g, ' ');
  for (const { re, gb } of KNOWN_NVIDIA_GB) {
    if (re.test(s)) return gb;
  }
  for (const { re, gb } of KNOWN_AMD_GB) {
    if (re.test(s)) return gb;
  }
  return null;
}

function findVramKey(specs: Record<string, string | number>): string | null {
  for (const k of Object.keys(specs)) {
    const l = k.toLowerCase();
    if (l === 'vram' || l.includes('vram') || l === 'video memory' || l === 'graphics memory') {
      return k;
    }
  }
  return null;
}

/**
 * Returns updated specs with VRAM corrected when we have a reliable GB value
 * from the title or known SKU table and the current value disagrees.
 */
export function correctGpuVramInSpecs(
  productName: string,
  standardizedName: string | undefined,
  specs: Record<string, string | number>
): Record<string, string | number> {
  const full = `${productName} ${standardizedName || ''}`.trim();
  if (!full) return { ...specs };

  const titleGb = extractTitleListedVramGb(full);
  const modelGb = knownVramGbFromModel(full);
  /** Known SKU table wins over a wrong GB in the listing title (e.g. "5070 24GB"). */
  const canonicalGb = modelGb ?? titleGb;
  if (canonicalGb === null) return { ...specs };

  const key = findVramKey(specs);
  const currentGb = key ? parseVramGbValue(specs[key]) : null;

  if (currentGb === canonicalGb) return { ...specs };

  const out = { ...specs };
  out[key || 'VRAM'] = `${canonicalGb}GB`;
  return out;
}
