/**
 * Which accessory toggles to show under an inventory item name.
 * All items: OVP + Rechnung. Motherboards also get IO Blende.
 */

import type { InventoryItem } from '../types';

export function isMotherboardItem(
  item: Pick<InventoryItem, 'category' | 'subCategory'>
): boolean {
  return item.category === 'Motherboards' || item.subCategory === 'Motherboards';
}

export type AccessoryToggleId = 'ovp' | 'io' | 'rechnung';

export function accessoryTogglesForItem(
  item: Pick<InventoryItem, 'category' | 'subCategory'>
): AccessoryToggleId[] {
  if (isMotherboardItem(item)) return ['ovp', 'io', 'rechnung'];
  return ['ovp', 'rechnung'];
}

export function accessoryTogglePresent(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield' | 'hasReceipt'>,
  id: AccessoryToggleId
): boolean {
  switch (id) {
    case 'ovp':
      return item.hasOVP === true;
    case 'io':
      return item.hasIOShield === true;
    case 'rechnung':
      return item.hasReceipt === true;
  }
}

export function accessoryTogglePatch(
  id: AccessoryToggleId,
  nextPresent: boolean
): Partial<InventoryItem> {
  switch (id) {
    case 'ovp':
      return { hasOVP: nextPresent };
    case 'io':
      return { hasIOShield: nextPresent };
    case 'rechnung':
      return { hasReceipt: nextPresent };
  }
}

export function accessoryToggleLabel(id: AccessoryToggleId): string {
  switch (id) {
    case 'ovp':
      return 'OVP';
    case 'io':
      return 'IO Blende';
    case 'rechnung':
      return 'Rechnung';
  }
}
