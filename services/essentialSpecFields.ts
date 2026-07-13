/**
 * Minimal spec field lists for the asset editor (max 10 per category).
 * Settings → "Load recommended" uses the same lists.
 */

export const MAX_ESSENTIAL_SPEC_FIELDS = 10;

export const ESSENTIAL_SPEC_FIELDS: Record<string, string[]> = {
  // PC
  'PC:Custom Built PC': ['CPU', 'GPU', 'RAM', 'Storage'],
  'PC:Pre-Built PC': ['CPU', 'GPU', 'RAM', 'Storage'],
  'PC:Server': ['CPU', 'RAM', 'Storage'],
  'PC:Workstation': ['CPU', 'GPU', 'RAM', 'Storage'],

  // Laptops
  'Laptops:Gaming Laptop': ['Screen Size', 'CPU', 'GPU', 'RAM', 'Storage'],
  'Laptops:Ultrabook': ['Screen Size', 'CPU', 'RAM', 'Storage'],
  'Laptops:MacBook': ['Screen Size', 'Chip', 'RAM', 'Storage'],
  'Laptops:Chromebook': ['Screen Size', 'CPU', 'RAM', 'Storage'],
  'Laptops:Office Laptop': ['Screen Size', 'CPU', 'RAM', 'Storage'],

  // Components — CPU / GPU / RAM per user workflow (≤10 each)
  // "Series" and "Model" instead of "Family"/"Processor" — standard tech-spec vocabulary the AI
  // naturally uses, so its output reliably lands under these exact keys.
  'Components:Processors': [
    'Socket',
    'Series',
    'Model',
    'Base Clock',
  ],
  'Components:Graphics Cards': ['VRAM', 'GPU Series', 'Boost Clock', 'TDP'],
  'Components:RAM': ['Memory Type', 'Speed', 'Latency', 'Modules', 'GB per Stick', 'Kit Capacity'],
  'Components:Motherboards': ['Socket', 'Form Factor', 'Chipset'],
  'Components:Storage (SSD/HDD)': ['Drive Type', 'Capacity', 'Interface'],
  'Components:Power Supplies': ['Wattage', 'Efficiency', 'Modularity'],
  'Components:Cases': ['Form Factor', 'Color'],
  'Components:Cooling': ['Type', 'Socket', 'TDP'],

  // Gadgets
  'Gadgets:Smartphones': ['Brand', 'Model', 'Storage'],
  'Gadgets:Tablets': ['Brand', 'Model', 'Storage'],
  'Gadgets:Smartwatches': ['Brand', 'Model'],
  'Gadgets:Consoles': ['Brand', 'Model', 'Storage'],
  'Gadgets:Cameras': ['Brand', 'Model'],
  'Gadgets:Audio': ['Brand', 'Model'],

  // Peripherals
  'Peripherals:Monitors': ['Size', 'Resolution', 'Refresh Rate'],
  'Peripherals:Keyboards': ['Brand', 'Layout'],
  'Peripherals:Mice': ['Brand', 'DPI'],
  'Peripherals:Headsets': ['Brand', 'Connection'],
  'Peripherals:Microphones': ['Brand', 'Connection'],
  'Peripherals:Webcams': ['Brand', 'Resolution'],

  // Network
  'Network:Routers': ['Speed', 'WiFi', 'Ports'],
  'Network:Switches': ['Ports', 'Speed'],
  'Network:NAS': ['Drive Bays', 'Capacity'],
  'Network:Cables': ['Type', 'Length'],

  // Software
  'Software:OS Licenses': ['Version', 'Seats'],
  'Software:Office': ['Version'],
  'Software:Antivirus': ['Seats'],

  // Bundle
  'Bundle:PC Bundle': ['CPU', 'GPU', 'RAM'],
  'Bundle:Peripheral Bundle': ['Contents'],
  'Bundle:Component Set': ['Contents'],

  // Misc
  'Misc:Cables': ['Type', 'Length'],
  'Misc:Adapters': ['Type'],
  'Misc:Tools': ['Type'],
  'Misc:Merchandise': ['Type'],
  'Misc:Spare Parts': ['Type'],
};

/**
 * Ordered list of field names for the compact asset editor for this category.
 */
export function getEssentialSpecFieldKeys(category: string, subCategory: string | undefined): string[] {
  const sub = (subCategory || '').trim();
  const k = `${category}:${sub}`;
  const list = ESSENTIAL_SPEC_FIELDS[k];
  if (list?.length) return list.slice(0, MAX_ESSENTIAL_SPEC_FIELDS);
  return [];
}

function normSpecKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Loose match so item keys like "DDR Type" still map to curated "Memory Type". */
export function specKeyMatchesEssential(specKey: string, essentialKey: string): boolean {
  const nk = normSpecKey(specKey);
  const ne = normSpecKey(essentialKey);
  if (!nk || !ne) return false;
  return nk === ne || nk.includes(ne) || ne.includes(nk);
}

/** Keep only curated essential spec rows for quick-pin sub-filters (preserves essential order). */
export function pickEssentialSpecOptions<T extends { key: string }>(
  options: T[],
  category: string,
  subCategory: string | undefined,
  fallbackKeys?: string[]
): T[] {
  let essential = getEssentialSpecFieldKeys(category, subCategory);
  if (!essential.length && fallbackKeys?.length) {
    essential = fallbackKeys.slice(0, MAX_ESSENTIAL_SPEC_FIELDS);
  }
  if (!essential.length) return options.slice(0, 5);

  const used = new Set<string>();
  const result: T[] = [];
  for (const essentialKey of essential) {
    const match = options.find((o) => !used.has(o.key) && specKeyMatchesEssential(o.key, essentialKey));
    if (match) {
      used.add(match.key);
      result.push(match);
    }
  }
  return result;
}

/** Essential keys for AI parsing / storage — curated list first, then legacy category template. */
export function resolveEssentialSpecKeys(
  category: string,
  subCategory: string | undefined,
  categoryFields?: Record<string, string[]>
): string[] {
  const essential = getEssentialSpecFieldKeys(category, subCategory);
  if (essential.length) return essential;
  if (!categoryFields) return [];
  const activeKey = `${category}:${subCategory || ''}`;
  return (categoryFields[activeKey] || categoryFields[category] || []).slice(0, MAX_ESSENTIAL_SPEC_FIELDS);
}

/** Drop geeky / extra spec keys — keep only the curated essential set (canonical key names). */
export function filterSpecsToEssentialKeys(
  specs: Record<string, string | number> | undefined,
  essentialKeys: string[]
): Record<string, string | number> {
  if (!specs) return {};
  if (!essentialKeys.length) {
    const entries = Object.entries(specs).filter(([, v]) => v !== '' && v != null);
    return Object.fromEntries(entries.slice(0, MAX_ESSENTIAL_SPEC_FIELDS));
  }
  const out: Record<string, string | number> = {};
  for (const essentialKey of essentialKeys) {
    for (const [k, v] of Object.entries(specs)) {
      if (v === undefined || v === null || v === '') continue;
      if (specKeyMatchesEssential(k, essentialKey)) {
        out[essentialKey] = v;
        break;
      }
    }
  }
  return out;
}

/** Merge AI parse into item specs — essential fields only, AI values win on conflict. */
export function mergeAiSpecsIntoEssential(
  existing: Record<string, string | number> | undefined,
  aiSpecs: Record<string, string | number> | undefined,
  category: string,
  subCategory: string | undefined,
  categoryFields?: Record<string, string[]>
): Record<string, string | number> {
  const essentialKeys = resolveEssentialSpecKeys(category, subCategory, categoryFields);
  const fromExisting = filterSpecsToEssentialKeys(existing, essentialKeys);
  const fromAi = filterSpecsToEssentialKeys(aiSpecs, essentialKeys);
  return { ...fromExisting, ...fromAi };
}
