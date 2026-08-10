/**
 * Bulk import category / subcategory inference and reconciliation against the live Settings tree.
 */

export type AddCategoryFn = (category: string, subcategory?: string) => void;

const MOTHERBOARD_PATTERN =
  /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i;

const GPU_PATTERN =
  /\b(rtx|gtx|radeon|rx\s?\d{3,5}|quadro|tesla|firepro|nvidia\s+[qkmt]|geforce|graphics\s+card|grafikkarte)\b/i;

const DISPLAY_PATTERN =
  /\b(monitor|display|bildschirm|screen|ultragear|odyssey|rog\s*swift|nano\s*ips|ultrawide|curved\s*(?:monitor|display)?|viewsonic|benq|aoc\s+\d|dell\s+(?:u|p|s)\d|lg\s+\d{2}|samsung\s+(?:lc|odyssey|view)\b)\b/i;

const DISPLAY_SIZE_PATTERN = /\b\d{2,3}\s*(?:inch|in|"|''|zoll)\b/i;

const DISPLAY_RES_PATTERN =
  /\b(?:4k|uhd|wqhd|qhd|fhd|1440p|2160p)\s*(?:monitor|display|gaming|panel)?\b/i;

const HIGH_REFRESH_PATTERN = /\b(?:144|165|240|360)\s*hz\b/i;

/** Alternate names for subcategories (all lowercase keys). */
const SUB_ALIASES: Record<string, string[]> = {
  'graphics cards': ['gpu', 'video card', 'grafikkarte', 'graphics card'],
  processors: ['cpu', 'prozessor', 'processor'],
  'storage (ssd/hdd)': ['storage', 'ssd', 'hdd', 'nvme', 'solid state'],
  'power supplies': ['psu', 'netzteil', 'power supply'],
  displays: ['monitor', 'monitors', 'display', 'screens', 'bildschirm'],
  monitors: ['display', 'displays', 'monitor', 'screens'],
  motherboards: ['motherboard', 'mainboard', 'mobo'],
  ram: ['memory', 'arbeitsspeicher', 'ddr'],
  cooling: ['cooler', 'kühler', 'kuehler', 'aio', 'lüfter', 'lufter'],
  cases: ['case', 'gehäuse', 'gehaeuse', 'chassis'],
};

const CANONICAL_SUB_LABELS: Record<string, string> = {
  displays: 'Displays',
  monitors: 'Monitors',
  gpu: 'Graphics Cards',
  'graphics cards': 'Graphics Cards',
  cpu: 'Processors',
  processors: 'Processors',
  prozessor: 'Processors',
  motherboard: 'Motherboards',
  motherboards: 'Motherboards',
  mainboard: 'Motherboards',
  mobo: 'Motherboards',
  storage: 'Storage (SSD/HDD)',
  ssd: 'Storage (SSD/HDD)',
  hdd: 'Storage (SSD/HDD)',
  nvme: 'Storage (SSD/HDD)',
  psu: 'Power Supplies',
  netzteil: 'Power Supplies',
  ram: 'RAM',
  memory: 'RAM',
};

export function looksLikeDisplayOrMonitor(name: string): boolean {
  const n = name.toLowerCase();
  if (DISPLAY_PATTERN.test(n)) return true;
  if (DISPLAY_SIZE_PATTERN.test(n)) return true;
  if (DISPLAY_RES_PATTERN.test(n)) return true;
  if (HIGH_REFRESH_PATTERN.test(n) && !GPU_PATTERN.test(n)) return true;
  if (/\b(ips|va|tn|oled)\b/.test(n) && /\b(panel|monitor|display|\d{2,3}\s*")\b/.test(n)) return true;
  return false;
}

export function looksLikeGpu(name: string): boolean {
  if (looksLikeDisplayOrMonitor(name)) return false;
  return GPU_PATTERN.test(name);
}

function canonicalSubLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (CANONICAL_SUB_LABELS[key]) return CANONICAL_SUB_LABELS[key];
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function aliasKeysForSub(sub: string): string[] {
  const lower = sub.trim().toLowerCase();
  const keys = new Set<string>([lower]);
  for (const [canonical, aliases] of Object.entries(SUB_ALIASES)) {
    if (canonical === lower || aliases.includes(lower)) {
      keys.add(canonical);
      aliases.forEach((a) => keys.add(a));
    }
  }
  return [...keys];
}

function findSubInList(subs: string[], wanted: string): string | undefined {
  const keys = aliasKeysForSub(wanted);
  return subs.find((s) => keys.includes(s.toLowerCase()));
}

function findSubAcrossTree(
  categories: Record<string, string[]>,
  wanted: string
): { category: string; subCategory: string } | null {
  const keys = aliasKeysForSub(wanted);
  for (const [category, subs] of Object.entries(categories || {})) {
    for (const sub of subs || []) {
      if (keys.includes(sub.toLowerCase())) {
        return { category, subCategory: sub };
      }
    }
  }
  return null;
}

/** Where standalone monitors / displays should land in the user's tree. */
export function inferDisplayPlacement(
  categories: Record<string, string[]>
): { category: string; subCategory: string } {
  const peripherals = categories['Peripherals'] || [];
  const monitors = findSubInList(peripherals, 'Monitors');
  if (monitors) return { category: 'Peripherals', subCategory: monitors };

  const components = categories['Components'] || [];
  const displays = findSubInList(components, 'Displays');
  if (displays) return { category: 'Components', subCategory: displays };

  if (categories['Components']) return { category: 'Components', subCategory: 'Displays' };
  if (categories['Peripherals']) return { category: 'Peripherals', subCategory: 'Monitors' };
  return { category: 'Components', subCategory: 'Displays' };
}

export function normalizeCategory(
  input: string | undefined,
  categories: Record<string, string[]>
): string {
  const keys = Object.keys(categories || {});
  const fallback = keys.includes('Components') ? 'Components' : keys[0] || 'Components';
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return fallback;
  const match = keys.find((c) => c.toLowerCase() === raw);
  return match || fallback;
}

function safeFallbackSub(category: string, categories: Record<string, string[]>): string {
  const options = categories[category] || [];
  if (!options.length) return '';
  const spare = options.find((s) => /spare|misc|other/i.test(s));
  if (spare) return spare;
  return '';
}

/**
 * Resolve a subcategory against the live tree. Creates missing subs when `onAddCategory` is provided.
 */
export function resolveSubCategory(
  category: string,
  sub: string | undefined,
  categories: Record<string, string[]>,
  onAddCategory?: AddCategoryFn
): string {
  const options = categories[category] || [];
  if (!options.length) return '';

  const raw = (sub || '').trim();
  if (!raw) return safeFallbackSub(category, categories);

  const inCategory = findSubInList(options, raw);
  if (inCategory) return inCategory;

  const canonical = canonicalSubLabel(raw);
  const inCategoryCanonical = findSubInList(options, canonical);
  if (inCategoryCanonical) return inCategoryCanonical;

  if (onAddCategory) {
    onAddCategory(category, canonical);
    return canonical;
  }

  return safeFallbackSub(category, categories);
}

export function clampToLiveCategories(
  selection: { category: string; subCategory: string },
  categories: Record<string, string[]>,
  onAddCategory?: AddCategoryFn
): { category: string; subCategory: string } {
  const category = normalizeCategory(selection.category, categories);
  const subCategory = resolveSubCategory(category, selection.subCategory, categories, onAddCategory);
  return { category, subCategory };
}

/** Heuristic category intent from product title (before tree reconciliation). */
export function inferCategoryFromName(name: string): { category: string; subCategory: string } {
  const n = name.toLowerCase();

  if (/(prodesk|optiplex|elitedesk|business\s*pc|desktop\s*pc|mini\s*pc)\b/i.test(n)) {
    return { category: 'PC', subCategory: 'Pre-Built PC' };
  }
  if (/(dvd|bluray|blu-ray|optical|oddd|gud\d)/i.test(n)) {
    return { category: 'Misc', subCategory: 'Spare Parts' };
  }
  if (looksLikeDisplayOrMonitor(name)) {
    return { category: 'Components', subCategory: 'Displays' };
  }
  if (looksLikeGpu(name)) {
    return { category: 'Components', subCategory: 'Graphics Cards' };
  }
  if (
    /\b(i[3579]|intel\s*core|ryzen|threadripper|cpu|prozessor)\b/i.test(n) &&
    !/mainboard|motherboard|prodesk|optiplex|elitedesk|business\s*pc/i.test(n)
  ) {
    return { category: 'Components', subCategory: 'Processors' };
  }
  if (MOTHERBOARD_PATTERN.test(n) || /socket\s?(am|lga)/i.test(n)) {
    return { category: 'Components', subCategory: 'Motherboards' };
  }
  if (
    /(ddr[2345]|ram\b|memory\b|\d+\s*[x×]\s*\d+\s*gb|12800u|10600u|1333u|2rx8|1rx8|jedec|hynix|samsung m\d|kingston (?:khx|acr)|sk hynix|crucial|mhz)/i.test(
      n
    ) &&
    !/prodesk|optiplex|elitedesk|business\s*pc|mainboard|motherboard/i.test(n)
  ) {
    return { category: 'Components', subCategory: 'RAM' };
  }
  if (/(ssd|hdd|nvme|m\.2|\b\d+\s*tb\b)/i.test(n) && !looksLikeDisplayOrMonitor(name)) {
    return { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
  }
  if (/(netzteil|power supply|psu|watt|80\+)/i.test(n)) {
    return { category: 'Components', subCategory: 'Power Supplies' };
  }
  if (/(geh[aä]use|case|micro-atx|matx|atx case)/i.test(n)) {
    return { category: 'Components', subCategory: 'Cases' };
  }
  if (/(aio|k[uü]hler|cooler|liquid freezer|fan|l[uü]fter|120mm|140mm)/i.test(n)) {
    return { category: 'Components', subCategory: 'Cooling' };
  }
  if (/(laptop|notebook|macbook)/i.test(n)) {
    return { category: 'Laptops', subCategory: 'Gaming Laptop' };
  }
  return { category: 'Misc', subCategory: 'Spare Parts' };
}

function reconcileDisplayCategory(
  name: string,
  categories: Record<string, string[]>,
  onAddCategory?: AddCategoryFn
): { category: string; subCategory: string } {
  const placement = inferDisplayPlacement(categories);
  return clampToLiveCategories(placement, categories, onAddCategory);
}

export function reconcileBulkCategory(
  name: string,
  category: string | undefined,
  subCategory: string | undefined,
  categories: Record<string, string[]>,
  onAddCategory?: AddCategoryFn
): { category: string; subCategory: string } {
  const guessed = inferCategoryFromName(name);
  const n = name.toLowerCase();

  if (looksLikeDisplayOrMonitor(name)) {
    return reconcileDisplayCategory(name, categories, onAddCategory);
  }

  let resolvedCategory = normalizeCategory(category || guessed.category, categories);
  let resolvedSub = (subCategory || guessed.subCategory || '').trim();

  if (/(prodesk|optiplex|elitedesk|business\s*pc|desktop\s*pc|mini\s*pc)\b/i.test(n)) {
    resolvedCategory = 'PC';
    resolvedSub = 'Pre-Built PC';
  } else if (/(dvd|bluray|blu-ray|optical|oddd|gud\d)/i.test(n)) {
    resolvedCategory = 'Misc';
    resolvedSub = 'Spare Parts';
  } else if (
    /\b(i[3579]|intel\s*core|ryzen|threadripper|cpu|prozessor)\b/i.test(n) &&
    !/mainboard|motherboard|prodesk|optiplex|elitedesk|business\s*pc/i.test(n)
  ) {
    resolvedCategory = 'Components';
    resolvedSub = 'Processors';
  } else if (/(ssd|nvme|m\.2|hdd|sata)/i.test(n) && !looksLikeDisplayOrMonitor(name)) {
    resolvedCategory = 'Components';
    resolvedSub = 'Storage (SSD/HDD)';
  } else if (
    /(ddr4|ddr5|ram|memory|\d+\s*[x×]\s*\d+\s*gb|crucial)/i.test(n) &&
    !/mainboard|motherboard|prodesk|business\s*pc/i.test(n)
  ) {
    resolvedCategory = 'Components';
    resolvedSub = 'RAM';
  } else if (MOTHERBOARD_PATTERN.test(n)) {
    resolvedCategory = 'Components';
    resolvedSub = 'Motherboards';
  } else if (looksLikeGpu(name)) {
    resolvedCategory = 'Components';
    resolvedSub = 'Graphics Cards';
  } else if (resolvedCategory === 'Components' && /^graphics cards$/i.test(resolvedSub) && guessed.subCategory !== 'Graphics Cards') {
    resolvedCategory = guessed.category;
    resolvedSub = guessed.subCategory;
  } else if (guessed.category === 'PC' && resolvedCategory !== 'PC') {
    resolvedCategory = guessed.category;
    resolvedSub = guessed.subCategory;
  } else if (resolvedCategory !== guessed.category && guessed.category === 'Components' && !category?.trim()) {
    resolvedCategory = guessed.category;
    resolvedSub = guessed.subCategory;
  }

  const aiSubLower = (subCategory || '').trim().toLowerCase();
  if (
    resolvedCategory === 'Components' &&
    (aiSubLower === 'displays' || aiSubLower === 'display' || aiSubLower === 'monitors' || aiSubLower === 'monitor')
  ) {
    return reconcileDisplayCategory(name, categories, onAddCategory);
  }

  const cross = resolvedSub ? findSubAcrossTree(categories, resolvedSub) : null;
  if (cross && cross.category !== resolvedCategory) {
    const inRequested = findSubInList(categories[resolvedCategory] || [], resolvedSub);
    if (!inRequested) {
      resolvedCategory = cross.category;
      resolvedSub = cross.subCategory;
    }
  }

  return clampToLiveCategories(
    { category: resolvedCategory, subCategory: resolvedSub },
    categories,
    onAddCategory
  );
}

/** Build category/sub hints for the bulk-parse AI prompt from the live tree. */
export function formatCategoryTreeForPrompt(categories: Record<string, string[]>): string {
  return Object.entries(categories || {})
    .map(([cat, subs]) => {
      const subList = (subs || []).length ? subs.join(', ') : '(no subcategories)';
      return `- ${cat}: ${subList}`;
    })
    .join('\n');
}
