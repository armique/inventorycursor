/**
 * Accessory toggles under an inventory item name / Add Asset toolbar.
 * OVP for all items; IO Blende only when motherboard-relevant.
 * Tri-state: present (true) | missing (false) | unspecified (undefined).
 * Confirmed states feed AI listing text and AI product-card prompts.
 */

import type { InventoryItem } from '../types';

export type AccessoryToggleId = 'ovp' | 'io';

/** present = green, missing = red, unspecified = purple */
export type AccessoryTriState = 'present' | 'missing' | 'unspecified';

export type AccessoryItemRef = Pick<
  InventoryItem,
  'category' | 'subCategory' | 'isBundle' | 'isPC' | 'name' | 'componentIds' | 'hasOVP' | 'hasIOShield'
>;

export type AccessoryChildRef = Pick<
  InventoryItem,
  'category' | 'subCategory' | 'name' | 'hasIOShield'
>;

export function isMotherboardItem(
  item: Pick<InventoryItem, 'category' | 'subCategory'>
): boolean {
  return item.category === 'Motherboards' || item.subCategory === 'Motherboards';
}

/** IO Blende only for standalone motherboards or bundles/PCs that include a motherboard. */
export function isIOShieldRelevant(
  item: AccessoryItemRef,
  children?: AccessoryChildRef[]
): boolean {
  if (isMotherboardItem(item)) return true;
  if (children?.some((c) => isMotherboardItem(c))) return true;

  const isContainer =
    item.isPC === true ||
    item.isBundle === true ||
    item.category === 'PC' ||
    item.category === 'Bundle' ||
    item.category === 'Mixed Bundle';

  if (isContainer && /\b(motherboard|mainboard|mobo|trägerplatine)\b/i.test(item.name || '')) {
    return true;
  }
  return false;
}

export function accessoryTogglesForItem(
  item: AccessoryItemRef,
  children?: AccessoryChildRef[]
): AccessoryToggleId[] {
  if (isIOShieldRelevant(item, children)) return ['ovp', 'io'];
  return ['ovp'];
}

export function accessoryFieldValue(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield'>,
  id: AccessoryToggleId
): boolean | undefined {
  return id === 'ovp' ? item.hasOVP : item.hasIOShield;
}

export function accessoryToggleState(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield'>,
  id: AccessoryToggleId
): AccessoryTriState {
  const v = accessoryFieldValue(item, id);
  if (v === true) return 'present';
  if (v === false) return 'missing';
  return 'unspecified';
}

/** @deprecated Prefer accessoryToggleState — true only when present. */
export function accessoryTogglePresent(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield' | 'hasReceipt'>,
  id: AccessoryToggleId | 'rechnung'
): boolean {
  if (id === 'rechnung') return item.hasReceipt === true;
  return accessoryToggleState(item, id) === 'present';
}

export function accessoryTogglePatch(
  id: AccessoryToggleId,
  next: boolean | undefined
): Partial<InventoryItem> {
  if (id === 'ovp') return { hasOVP: next };
  return { hasIOShield: next };
}

/** Cycle unspecified → present → missing → unspecified. */
export function cycleAccessoryTogglePatch(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield'>,
  id: AccessoryToggleId
): Partial<InventoryItem> {
  const state = accessoryToggleState(item, id);
  if (state === 'unspecified') return accessoryTogglePatch(id, true);
  if (state === 'present') return accessoryTogglePatch(id, false);
  return accessoryTogglePatch(id, undefined);
}

export function accessoryToggleLabel(id: AccessoryToggleId): string {
  return id === 'ovp' ? 'OVP' : 'IO Blende';
}

export function accessoryToggleTitle(id: AccessoryToggleId, state: AccessoryTriState): string {
  const label = accessoryToggleLabel(id);
  if (state === 'present') return `${label}: present — click for missing`;
  if (state === 'missing') return `${label}: missing — click for not specified`;
  return `${label}: not specified — click for present`;
}

export function accessoryStateLabel(state: AccessoryTriState): string {
  if (state === 'present') return 'Present';
  if (state === 'missing') return 'Missing';
  return 'Not set';
}

/**
 * IO Blende tri-state for listing: parent flag first, else motherboard child flag
 * (bundles often store IO on the mobo part or on the kit itself).
 */
export function resolveIoShieldTriState(
  item: AccessoryItemRef,
  children?: AccessoryChildRef[],
  override?: boolean
): AccessoryTriState | 'na' {
  if (!isIOShieldRelevant(item, children)) return 'na';
  if (override !== undefined) {
    return override ? 'present' : 'missing';
  }
  const own = accessoryToggleState(item, 'io');
  if (own !== 'unspecified') return own;
  for (const child of children || []) {
    if (!isMotherboardItem(child)) continue;
    const st = accessoryToggleState(child, 'io');
    if (st !== 'unspecified') return st;
  }
  return 'unspecified';
}

/**
 * AI listing / card studio may run only after required accessory icons are confirmed
 * (not left on purple / unspecified).
 */
export function listingAccessoriesReady(
  item: AccessoryItemRef,
  children?: AccessoryChildRef[]
): { ok: boolean; reason?: string } {
  if (accessoryToggleState(item, 'ovp') === 'unspecified') {
    return {
      ok: false,
      reason: 'Confirm OVP first (green = present, red = missing). Purple means not set yet.',
    };
  }
  if (isIOShieldRelevant(item, children)) {
    const io = resolveIoShieldTriState(item, children);
    if (io === 'unspecified') {
      return {
        ok: false,
        reason: 'Confirm IO Blende first (green = present, red = missing). Purple means not set yet.',
      };
    }
  }
  return { ok: true };
}

/** Short lines for AI prompts / product-card notes. */
export function formatAccessoryHintsForAI(
  item: AccessoryItemRef,
  children?: AccessoryChildRef[]
): string[] {
  const lines: string[] = [];
  const ovp = accessoryToggleState(item, 'ovp');
  if (ovp === 'present') lines.push('OVP: YES — Originalverpackung vorhanden');
  else if (ovp === 'missing') lines.push('OVP: NO — Ohne Originalverpackung');
  else lines.push('OVP: UNSPECIFIED');

  const io = resolveIoShieldTriState(item, children);
  if (io === 'present') lines.push('IO-Blende: YES — IO-Blende inklusive (MUST state in Lieferumfang)');
  else if (io === 'missing') lines.push('IO-Blende: NO — Ohne IO-Blende (MUST state in Lieferumfang)');
  else if (io === 'unspecified') lines.push('IO-Blende: UNSPECIFIED');
  else lines.push('IO-Blende: NOT APPLICABLE — do not mention IO-Blende / IO Shield at all');
  return lines;
}
