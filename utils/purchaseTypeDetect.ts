/**
 * Guess a durable purchase-library type from an eBay buyer title.
 * Used to organize the purchase archive beyond disposition workflow.
 */

import { looksLikeFilamentPurchase } from './filamentTitleDetect';

export type EbayPurchaseType =
  | 'unclassified'
  | 'filament'
  | 'pc_parts'
  | 'gpu'
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'motherboard'
  | 'psu'
  | 'cooler'
  | 'case'
  | 'tools'
  | 'consumable'
  | 'shipping'
  | 'personal'
  | 'other';

export const PURCHASE_TYPE_LABELS: Record<EbayPurchaseType, string> = {
  unclassified: 'Unclassified',
  filament: 'Filament',
  pc_parts: 'PC parts',
  gpu: 'GPU',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  motherboard: 'Motherboard',
  psu: 'PSU',
  cooler: 'Cooler',
  case: 'Case',
  tools: 'Tools',
  consumable: 'Consumable',
  shipping: 'Shipping',
  personal: 'Personal',
  other: 'Other',
};

export const PURCHASE_TYPE_ORDER: EbayPurchaseType[] = [
  'unclassified',
  'filament',
  'gpu',
  'cpu',
  'ram',
  'storage',
  'motherboard',
  'psu',
  'cooler',
  'case',
  'pc_parts',
  'tools',
  'consumable',
  'shipping',
  'personal',
  'other',
];

const RULES: { type: EbayPurchaseType; re: RegExp }[] = [
  { type: 'shipping', re: /\b(versandetikett|shipping\s*label|dhl\s*label|paketmarke|porto)\b/i },
  { type: 'gpu', re: /\b(rtx|gtx|rx\s?\d{3,4}|radeon|geforce|quadro|arc\s*a\d)\b/i },
  { type: 'cpu', re: /\b(ryzen|threadripper|xeon|core\s*i[3579]|i[3579]-\d|amd\s*fx|pentium|celeron)\b/i },
  { type: 'ram', re: /\b(ddr[345]|dimm|so-?dimm|arbeitsspeicher|ram\s*\d|\d\s*gb\s*ddr)\b/i },
  { type: 'storage', re: /\b(nvme|m\.?2|ssd|hdd|festplatte|samsung\s*99[0-9]|wd[_\s-]?black|crucial\s*p\d)\b/i },
  { type: 'motherboard', re: /\b(mainboard|motherboard|mobo|b\d{3}|x\d{3}|z\d{3}|h\d{2,3}|a\d{3})\b/i },
  { type: 'psu', re: /\b(netzteil|power\s*supply|\bpsu\b|\d{3,4}\s*w\b)/i },
  { type: 'cooler', re: /\b(kühler|kuehler|aio|wasserkühl|cpu\s*cooler|noctua|arctic\s*liquid)\b/i },
  { type: 'case', re: /\b(pc\s*gehäuse|gehaeuse|midi\s*tower|atx\s*case|fractal|lian\s*li|nzxt\s*h\d)\b/i },
  { type: 'tools', re: /\b(schraubenzieher|werkzeug|tool\s*kit|multimeter|lötkolben|loetkolben|crimp)\b/i },
  { type: 'consumable', re: /\b(thermal\s*paste|wärmeleit|waermeleit|isopropy|reiniger|kabelbinder|schrauben)\b/i },
  {
    type: 'pc_parts',
    re: /\b(pc|computer|grafikkarte|prozessor|mainboard|netzteil|lüfter|luefter|gehäuse)\b/i,
  },
];

/** Best-effort type from listing title (never personal — that is a user disposition). */
export function guessPurchaseType(title: string): EbayPurchaseType {
  const t = (title || '').trim();
  if (!t) return 'unclassified';
  if (looksLikeFilamentPurchase(t)) return 'filament';
  for (const rule of RULES) {
    if (rule.re.test(t)) return rule.type;
  }
  return 'unclassified';
}
