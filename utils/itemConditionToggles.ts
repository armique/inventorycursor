/**
 * Condition detail toggles — category-aware checklist so the AI-written listing description
 * states exactly what's true of THIS physical unit (tested? scratched? battery degraded?).
 * Distinct from ebayCondition (eBay's required New/Used/For-parts enum, see
 * utils/ebayListingReadiness.ts) and hasOVP/hasIOShield (their own dedicated fields, see
 * utils/itemAccessoryToggles.ts) — this is purely descriptive detail, multi-select, no tri-state.
 */
import type { InventoryItem } from '../types';

export type ConditionToggleId =
  | 'tested_working'
  | 'signs_of_use'
  | 'cosmetic_wear'
  | 'missing_accessories'
  | 'battery_degraded'
  | 'screen_scratches'
  | 'screen_burn_in'
  | 'fan_noise'
  | 'ports_tested'
  | 'bios_updated'
  | 'keys_worn';

export type ConditionToggleDef = {
  id: ConditionToggleId;
  label: string;
  /** Short factual phrase fed to the AI listing generator — kept neutral, not sales-y. */
  descriptionHint: string;
};

const CONDITION_TOGGLE_CATALOG: Record<ConditionToggleId, ConditionToggleDef> = {
  tested_working: { id: 'tested_working', label: 'Tested & working', descriptionHint: 'Tested and confirmed fully working before listing.' },
  signs_of_use: { id: 'signs_of_use', label: 'Signs of use', descriptionHint: 'Shows visible signs of prior use.' },
  cosmetic_wear: { id: 'cosmetic_wear', label: 'Cosmetic wear/scratches', descriptionHint: 'Has cosmetic scratches or wear marks — purely cosmetic, does not affect function.' },
  missing_accessories: { id: 'missing_accessories', label: 'Missing accessories', descriptionHint: 'Sold without original accessories/cables unless otherwise stated.' },
  battery_degraded: { id: 'battery_degraded', label: 'Battery degraded', descriptionHint: 'Battery shows reduced capacity/runtime versus new.' },
  screen_scratches: { id: 'screen_scratches', label: 'Screen scratches', descriptionHint: 'Screen has visible scratches.' },
  screen_burn_in: { id: 'screen_burn_in', label: 'Screen burn-in', descriptionHint: 'Screen shows slight burn-in/image retention.' },
  fan_noise: { id: 'fan_noise', label: 'Fan noise', descriptionHint: 'Fan(s) are audible/slightly louder than new.' },
  ports_tested: { id: 'ports_tested', label: 'All ports tested', descriptionHint: 'All ports individually tested and confirmed working.' },
  bios_updated: { id: 'bios_updated', label: 'BIOS updated', descriptionHint: 'BIOS/firmware updated to the latest available version.' },
  keys_worn: { id: 'keys_worn', label: 'Keys/keycaps worn', descriptionHint: 'Keyboard keys/keycaps show visible wear (shine) from use.' },
};

/** Every item gets these regardless of category. */
const UNIVERSAL_TOGGLES: ConditionToggleId[] = ['tested_working', 'signs_of_use', 'cosmetic_wear', 'missing_accessories'];

/** Extra toggles only relevant for certain subCategories/categories. */
const CATEGORY_EXTRA_TOGGLES: { match: (category: string, subCategory?: string) => boolean; toggles: ConditionToggleId[] }[] = [
  { match: (c) => c === 'Laptops', toggles: ['battery_degraded', 'screen_scratches', 'screen_burn_in', 'keys_worn'] },
  { match: (_c, s) => s === 'Monitors', toggles: ['screen_scratches', 'screen_burn_in'] },
  { match: (_c, s) => s === 'Graphics Cards' || s === 'Cooling' || s === 'Power Supplies', toggles: ['fan_noise'] },
  { match: (_c, s) => s === 'Motherboards', toggles: ['ports_tested', 'bios_updated'] },
  { match: (c) => c === 'PC', toggles: ['fan_noise', 'ports_tested'] },
];

/** Ordered toggle list to render for this item's category/subCategory. */
export function conditionToggleDefsForItem(item: Pick<InventoryItem, 'category' | 'subCategory'>): ConditionToggleDef[] {
  const ids = new Set<ConditionToggleId>(UNIVERSAL_TOGGLES);
  for (const rule of CATEGORY_EXTRA_TOGGLES) {
    if (rule.match(item.category, item.subCategory)) {
      for (const id of rule.toggles) ids.add(id);
    }
  }
  return Array.from(ids).map((id) => CONDITION_TOGGLE_CATALOG[id]);
}

export function conditionToggleLabel(id: string): string {
  return CONDITION_TOGGLE_CATALOG[id as ConditionToggleId]?.label || id;
}

/** Description hints for the set toggles on an item — fed into the AI listing prompt. */
export function conditionToggleHints(item: Pick<InventoryItem, 'conditionToggles'>): string[] {
  return (item.conditionToggles || [])
    .map((id) => CONDITION_TOGGLE_CATALOG[id as ConditionToggleId]?.descriptionHint)
    .filter((h): h is string => Boolean(h));
}

export function toggleConditionToggle(item: Pick<InventoryItem, 'conditionToggles'>, id: ConditionToggleId): string[] {
  const current = item.conditionToggles || [];
  return current.includes(id) ? current.filter((t) => t !== id) : [...current, id];
}
