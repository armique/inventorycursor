/**
 * Rule-based free-text -> componentKey extractor for PC parts.
 * No canonical component identity existed anywhere in the codebase before this
 * (dealwatch-runtime/data/*-specs.json has its own unconnected slug ids; hardwareDB.ts
 * matches by lowercased string; ebayListingMatch/cpuMoboComboAnalytics build
 * ad-hoc tokens per call). This is the shared key going forward.
 */

export type ComponentCategory =
  | 'gpu'
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'motherboard'
  | 'psu'
  | 'case'
  | 'cooler';

export type ComponentKeyMatch = {
  componentKey: string;
  category: ComponentCategory;
  confidence: 'high' | 'medium' | 'low';
};

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function normalize(text: string): string {
  return String(text || '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mirrors dealwatch-runtime/server.js's parseGpuSearch — duplicated deliberately across the
 * CommonJS/TS runtime boundary (see architecture decision on classifyLotType). */
function extractGpu(haystack: string): ComponentKeyMatch | null {
  let match = haystack.match(/\b(rtx|gtx|rx)\s*(\d{3,4})\s*(ti|super)?\b/);
  if (!match) match = haystack.match(/\b(rtx|gtx|rx)(\d{3,4})(ti|super)?\b/);
  if (!match) return null;
  const [, series, model, suffix] = match;
  return {
    componentKey: `gpu:${series}${model}${suffix || ''}`,
    category: 'gpu',
    confidence: 'high',
  };
}

function extractCpu(haystack: string): ComponentKeyMatch | null {
  // "Ryzen 5 5500" (family digit given) vs colloquial "Ryzen 7800X3D" (family digit omitted).
  let match = haystack.match(/\bryzen\s*(\d)\s+(\d{4}[a-z0-9]*)\b/);
  if (match) {
    return { componentKey: `cpu:ryzen${match[1]}-${match[2]}`, category: 'cpu', confidence: 'high' };
  }
  match = haystack.match(/\bryzen\s*(\d{4,5}[a-z0-9]*)\b/);
  if (match) {
    return { componentKey: `cpu:ryzen-${match[1]}`, category: 'cpu', confidence: 'high' };
  }
  match = haystack.match(/\b(i[3579])[\s-]*(\d{4,5}[a-z]*)\b/);
  if (match) {
    return { componentKey: `cpu:${match[1]}-${match[2]}`, category: 'cpu', confidence: 'high' };
  }
  match = haystack.match(/\bcore\s*(i[3579])\b/);
  if (match) {
    return { componentKey: `cpu:${match[1]}`, category: 'cpu', confidence: 'medium' };
  }
  if (/\b(ryzen|pentium|celeron|athlon|xeon)\b/.test(haystack)) {
    const family = (haystack.match(/\b(ryzen|pentium|celeron|athlon|xeon)\b/) || [])[1];
    return { componentKey: `cpu:${family}`, category: 'cpu', confidence: 'low' };
  }
  return null;
}

/**
 * A title with several components (whole-PC teardown) can contain several
 * "<number>GB"/"<number>TB" mentions — one per component. Picking the FIRST
 * one anywhere in the string silently grabs the wrong component's capacity.
 * Pick the one closest to the category's own anchor keyword instead.
 */
function nearestSizeMatch(haystack: string, anchorIndex: number): { value: string; unit: string } | null {
  // Exclude interface transfer-rate mentions ("SATA 6Gb/s" -> "6gb s" once slashes are
  // normalized to spaces) — those are not capacities, and would otherwise beat a farther-away
  // real capacity just by being textually closer to the "ssd"/"hdd" anchor keyword.
  const pattern = /\b(\d{1,5})\s*(gb|tb)\b(?!\s*s\b)/g;
  let best: { value: string; unit: string; dist: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack))) {
    const dist = Math.abs((match.index ?? 0) - anchorIndex);
    if (!best || dist < best.dist) {
      best = { value: match[1], unit: match[2], dist };
    }
  }
  return best ? { value: best.value, unit: best.unit } : null;
}

/** Standard capacity ladder (binary GB). Marketing/formatting shaves a few % off these
 * (512GB NAND sold as "480GB" or "500GB"), so raw sizes get snapped to the nearest rung
 * instead of fragmenting one real product line into three near-identical groups. */
const CAPACITY_TIERS_GB = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
const CAPACITY_SNAP_TOLERANCE = 0.12;

function toRawGb(value: string, unit: string): number {
  const n = Number(value);
  return unit === 'tb' ? n * 1000 : n;
}

/** Snaps to the nearest standard tier when within ~12% (covers 480/500->512, 240/250->256,
 * 960/1000->1024, ...); otherwise keeps the raw value so genuinely odd sizes aren't distorted. */
function canonicalCapacityGb(rawGb: number): number {
  let best = CAPACITY_TIERS_GB[0];
  let bestDiff = Infinity;
  for (const tier of CAPACITY_TIERS_GB) {
    const diff = Math.abs(rawGb - tier) / tier;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = tier;
    }
  }
  return bestDiff <= CAPACITY_SNAP_TOLERANCE ? best : Math.round(rawGb);
}

function formatCapacityKey(canonicalGb: number): string {
  if (canonicalGb >= 1024 && canonicalGb % 1024 === 0) return `${canonicalGb / 1024}tb`;
  return `${canonicalGb}gb`;
}

function extractRam(haystack: string): ComponentKeyMatch | null {
  const ddrMatch = haystack.match(/\bddr(\d)\b/);
  const ramKeywordMatch = haystack.match(/\b(ram|arbeitsspeicher|sodimm|so dimm|dimm)\b/);
  const anchorMatch = ddrMatch || ramKeywordMatch;
  if (!anchorMatch) return null;
  const size = nearestSizeMatch(haystack, anchorMatch.index ?? 0);
  if (!size || size.unit !== 'gb') return null;
  const capacityKey = formatCapacityKey(canonicalCapacityGb(toRawGb(size.value, size.unit)));
  const gen = ddrMatch ? ddrMatch[1] : '';
  return {
    componentKey: gen ? `ram:ddr${gen}-${capacityKey}` : `ram:${capacityKey}`,
    category: 'ram',
    confidence: ddrMatch ? 'high' : 'medium',
  };
}

function extractStorage(haystack: string): ComponentKeyMatch | null {
  // NVMe is the more specific term when a title mentions both ("NVMe SSD") — check it first
  // regardless of word order, then anchor the size search on whichever keyword actually matched.
  const typeMatch = haystack.match(/\bnvme\b/) || haystack.match(/\bssd\b/) || haystack.match(/\bhdd\b/);
  if (!typeMatch) return null;
  const type = typeMatch[0];
  const size = nearestSizeMatch(haystack, typeMatch.index ?? 0);
  if (!size) return { componentKey: `storage:${type}`, category: 'storage', confidence: 'low' };
  const capacityKey = formatCapacityKey(canonicalCapacityGb(toRawGb(size.value, size.unit)));
  return {
    componentKey: `storage:${type}-${capacityKey}`,
    category: 'storage',
    confidence: 'high',
  };
}

const CHIPSETS = ['b450', 'b550', 'b650', 'b850', 'x470', 'x570', 'x670', 'x870', 'z390', 'z490', 'z590', 'z690', 'z790', 'h410', 'h510', 'h610', 'h710'];

function extractMotherboard(haystack: string): ComponentKeyMatch | null {
  for (const chipset of CHIPSETS) {
    if (new RegExp(`\\b${chipset}\\b`).test(haystack)) {
      return { componentKey: `motherboard:${chipset}`, category: 'motherboard', confidence: 'high' };
    }
  }
  if (/\b(mainboard|motherboard)\b/.test(haystack)) {
    return { componentKey: 'motherboard:unknown', category: 'motherboard', confidence: 'low' };
  }
  return null;
}

function extractPsu(haystack: string): ComponentKeyMatch | null {
  const wattMatch = haystack.match(/\b(\d{3,4})\s*w(?:att)?\b/);
  if (!/\b(netzteil|power supply|psu)\b/.test(haystack)) return null;
  return {
    componentKey: wattMatch ? `psu:${wattMatch[1]}w` : 'psu:unknown',
    category: 'psu',
    confidence: wattMatch ? 'medium' : 'low',
  };
}

function extractCase(haystack: string): ComponentKeyMatch | null {
  if (!/\b(gehaeuse|case|tower|midi tower|big tower)\b/.test(haystack)) return null;
  return { componentKey: 'case:unknown', category: 'case', confidence: 'low' };
}

function extractCooler(haystack: string): ComponentKeyMatch | null {
  if (!/\b(kuehler|cooler|aio|wasserkuehlung|luftkuehler|radiator)\b/.test(haystack)) return null;
  const mmMatch = haystack.match(/\b(120|140|240|280|360|420)\s*mm\b/);
  return {
    componentKey: mmMatch ? `cooler:${mmMatch[1]}mm` : 'cooler:unknown',
    category: 'cooler',
    confidence: mmMatch ? 'medium' : 'low',
  };
}

const EXTRACTORS = [extractGpu, extractCpu, extractRam, extractStorage, extractMotherboard, extractPsu, extractCase, extractCooler];

/** All components found in the text — used by the (future) teardown parser for whole-PC lots. */
export function extractComponentKeys(text: string): ComponentKeyMatch[] {
  const haystack = normalize(text);
  if (!haystack) return [];
  const matches: ComponentKeyMatch[] = [];
  for (const extractor of EXTRACTORS) {
    const match = extractor(haystack);
    if (match) matches.push(match);
  }
  return matches;
}

/** Best single match — used to tag a plain single-component listing/query. */
export function extractPrimaryComponentKey(text: string): ComponentKeyMatch | null {
  const matches = extractComponentKeys(text);
  if (!matches.length) return null;
  const order: Record<ComponentKeyMatch['confidence'], number> = { high: 0, medium: 1, low: 2 };
  return [...matches].sort((a, b) => order[a.confidence] - order[b.confidence])[0];
}

/** Uppercases a trailing letter suffix only ("4790k" -> "4790K"), leaving the rest as-is —
 * matches how these models are actually branded (lowercase "i7", uppercase "K"/"X" suffix). */
function upperSuffix(s: string): string {
  return s.replace(/[a-z]+$/, (m) => m.toUpperCase());
}

/** Turns a componentKey back into a natural, brand-free phrase — used as the display label AND
 * the search query for a Reinvest group, so "buy a 512GB SSD" never narrows to one specific
 * product someone happened to sell before (see reinvestAnalysis.ts). Returns null for keys that
 * aren't a recognized componentKey shape (category-name fallback keys are already generic). */
export function prettifyComponentKey(key: string): string | null {
  const sep = key.indexOf(':');
  if (sep < 0) return null;
  const prefix = key.slice(0, sep);
  const rest = key.slice(sep + 1);

  switch (prefix as ComponentCategory) {
    case 'gpu': {
      const m = rest.match(/^(rtx|gtx|rx)(\d{3,4})(ti|super)?$/);
      if (!m) return null;
      const suffix = m[3] ? ` ${m[3][0].toUpperCase()}${m[3].slice(1)}` : '';
      return `${m[1].toUpperCase()} ${m[2]}${suffix}`;
    }
    case 'cpu': {
      let m = rest.match(/^(i[3579])-(.+)$/);
      if (m) return `${m[1]}-${upperSuffix(m[2])}`;
      m = rest.match(/^ryzen(\d)-(.+)$/);
      if (m) return `Ryzen ${m[1]} ${upperSuffix(m[2])}`;
      m = rest.match(/^ryzen-(.+)$/);
      if (m) return `Ryzen ${upperSuffix(m[1])}`;
      m = rest.match(/^(i[3579])$/);
      if (m) return `Core ${m[1]}`;
      if (rest) return `${rest[0].toUpperCase()}${rest.slice(1)}`;
      return null;
    }
    case 'ram': {
      const m = rest.match(/^(?:ddr(\d)-)?(\d+)(gb|tb)$/);
      if (!m) return null;
      const gen = m[1] ? `DDR${m[1]} ` : '';
      return `${gen}${m[2]}${m[3].toUpperCase()} RAM`;
    }
    case 'storage': {
      const m = rest.match(/^(nvme|ssd|hdd)(?:-(\d+)(gb|tb))?$/);
      if (!m) return null;
      const typeLabel = m[1] === 'nvme' ? 'NVMe SSD' : m[1].toUpperCase();
      return m[2] ? `${typeLabel} ${m[2]}${m[3].toUpperCase()}` : typeLabel;
    }
    case 'motherboard':
      return rest === 'unknown' ? 'Motherboard' : `${rest.toUpperCase()} Motherboard`;
    case 'psu': {
      const m = rest.match(/^(\d+)w$/);
      return m ? `${m[1]}W PSU` : 'PSU';
    }
    case 'case':
      return 'PC Case';
    case 'cooler': {
      const m = rest.match(/^(\d+)mm$/);
      return m ? `${m[1]}mm Cooler` : 'CPU Cooler';
    }
    default:
      return null;
  }
}
