/** eBay.de item conditions — IDs match LH_ItemCondition URL parameter values. */
export type DealItemCondition =
  | 'new'
  | 'new_other'
  | 'new_defects'
  | 'manufacturer_refurbished'
  | 'seller_refurbished'
  | 'used'
  | 'very_good'
  | 'good'
  | 'acceptable'
  | 'for_parts';

export interface DealConditionOption {
  id: DealItemCondition;
  /** eBay.de LH_ItemCondition value */
  ebayId: number;
  labelDe: string;
  labelEn: string;
  /** Title/snippet keywords for Kleinanzeigen post-filter (lowercase). */
  keywords: string[];
  /** Keywords that disqualify this condition when another is selected */
  excludeKeywords?: string[];
}

/** Same set as eBay.de condition filter (German labels). */
export const DEAL_CONDITION_OPTIONS: DealConditionOption[] = [
  {
    id: 'new',
    ebayId: 1000,
    labelDe: 'Neu',
    labelEn: 'New',
    keywords: [' neu ', 'neu,', 'neu.', 'unbenutzt', 'ovp', 'originalverpackung', ' new ', 'brandneu', 'neuwertig'],
  },
  {
    id: 'new_other',
    ebayId: 1500,
    labelDe: 'Neu (Sonstige)',
    labelEn: 'New (other)',
    keywords: ['neu (sonstige)', 'new other', 'neu sonstige'],
  },
  {
    id: 'new_defects',
    ebayId: 1750,
    labelDe: 'Neu mit Mängeln',
    labelEn: 'New with defects',
    keywords: ['neu mit mängeln', 'neu mit maengeln', 'new with defects'],
  },
  {
    id: 'manufacturer_refurbished',
    ebayId: 2000,
    labelDe: 'Vom Hersteller generalüberholt',
    labelEn: 'Manufacturer refurbished',
    keywords: ['generalüberholt', 'generalueberholt', 'manufacturer refurbished', 'hersteller general'],
  },
  {
    id: 'seller_refurbished',
    ebayId: 2500,
    labelDe: 'Vom Verkäufer generalüberholt',
    labelEn: 'Seller refurbished',
    keywords: ['vom verkäufer general', 'seller refurbished', 'refurbished'],
  },
  {
    id: 'used',
    ebayId: 3000,
    labelDe: 'Gebraucht',
    labelEn: 'Used',
    keywords: ['gebraucht', ' used ', 'second hand', 'gebr.', 'wenig genutzt'],
    excludeKeywords: ['defekt', 'kaputt', 'ersatzteile'],
  },
  {
    id: 'very_good',
    ebayId: 4000,
    labelDe: 'Sehr gut',
    labelEn: 'Very good',
    keywords: ['sehr gut', 'very good', 'wie neu'],
  },
  {
    id: 'good',
    ebayId: 5000,
    labelDe: 'Gut',
    labelEn: 'Good',
    keywords: [' gut ', ' good ', 'guter zustand'],
  },
  {
    id: 'acceptable',
    ebayId: 6000,
    labelDe: 'Akzeptabel',
    labelEn: 'Acceptable',
    keywords: ['akzeptabel', 'acceptable', 'gebrauchsspuren'],
  },
  {
    id: 'for_parts',
    ebayId: 7000,
    labelDe: 'Defekt / Ersatzteile',
    labelEn: 'For parts / not working',
    keywords: ['defekt', 'kaputt', 'ersatzteile', 'for parts', 'nicht funktion', 'ohne funktion', 'bastler', 'reparatur'],
  },
];

export function getConditionOption(id: DealItemCondition): DealConditionOption | undefined {
  return DEAL_CONDITION_OPTIONS.find((o) => o.id === id);
}

export function getEbayConditionIds(conditions?: DealItemCondition[]): number[] {
  if (!conditions?.length) return [];
  return conditions
    .map((id) => getConditionOption(id)?.ebayId)
    .filter((n): n is number => typeof n === 'number');
}

export function conditionLabels(conditions: DealItemCondition[] | undefined, lang: 'de' | 'en'): string {
  if (!conditions?.length) return '';
  return conditions
    .map((id) => {
      const opt = getConditionOption(id);
      return opt ? (lang === 'en' ? opt.labelEn : opt.labelDe) : id;
    })
    .join(', ');
}

/** Append eBay LH_ItemCondition params to a search URL. */
export function appendEbayConditionParams(url: string, conditions?: DealItemCondition[]): string {
  const ids = getEbayConditionIds(conditions);
  if (!ids.length) return url;
  return ids.reduce((acc, id) => `${acc}&LH_ItemCondition=${id}`, url);
}

function normalizeTitle(text: string): string {
  return ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
}

/** Keep deal if it matches any selected condition (title heuristic). Empty conditions = pass all. */
export function matchesItemConditions(
  deal: { title?: string; price?: string },
  conditions?: DealItemCondition[]
): boolean {
  if (!conditions?.length) return true;
  const hay = normalizeTitle(`${deal.title || ''} ${deal.price || ''}`);
  const opts = conditions.map((id) => getConditionOption(id)).filter(Boolean) as DealConditionOption[];

  for (const opt of opts) {
    if (opt.keywords.some((kw) => hay.includes(kw.trim().toLowerCase()))) {
      return true;
    }
  }

  // No explicit condition word — allow (many listings omit Zustand in title)
  const allKeywords = DEAL_CONDITION_OPTIONS.flatMap((o) => o.keywords);
  const mentionsAnyCondition = allKeywords.some((kw) => hay.includes(kw.trim().toLowerCase()));
  return !mentionsAnyCondition;
}

export function buildConditionPromptNote(conditions?: DealItemCondition[]): string {
  if (!conditions?.length) return '';
  const labels = conditions
    .map((id) => getConditionOption(id)?.labelDe)
    .filter(Boolean)
    .join(', ');
  return `\nPrefer listings in these conditions (Zustand): ${labels}. Skip listings clearly in other conditions.`;
}

export function toggleCondition(
  current: DealItemCondition[] | undefined,
  id: DealItemCondition
): DealItemCondition[] {
  const set = new Set(current || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return Array.from(set);
}
