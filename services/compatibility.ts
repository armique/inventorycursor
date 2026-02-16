import { InventoryItem, ItemStatus } from '../types';

/** Get a spec value from item (case-insensitive key match). */
export function getSpec(item: InventoryItem | undefined, key: string): string | number | undefined {
  if (!item?.specs) return undefined;
  const k = Object.keys(item.specs).find(
    (x) => x.toLowerCase() === key.toLowerCase()
  );
  return k != null ? item.specs[k] : undefined;
}

/** Normalize socket for comparison (e.g. "AM4" vs "am4"). */
function norm(s: string | number | undefined): string {
  if (s === undefined || s === null) return '';
  return String(s).trim().toUpperCase();
}

/** AMD sockets (CPU must be AMD). */
const AMD_SOCKETS = new Set(['AM4', 'AM5', 'TR4', 'STRX4', 'STR5']);
/** Intel sockets (CPU must be Intel). */
const INTEL_SOCKETS = new Set(['LGA1151', 'LGA1200', 'LGA1700', 'LGA1851', 'LGA2066', 'LGA2011-3']);

function socketVendor(socket: string): 'amd' | 'intel' | null {
  const u = socket.toUpperCase();
  if (AMD_SOCKETS.has(u)) return 'amd';
  if (INTEL_SOCKETS.has(u)) return 'intel';
  if (u.startsWith('AM')) return 'amd';
  if (u.startsWith('LGA') || u.startsWith('S')) return 'intel';
  return null;
}

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Check if an item is compatible with the current build when added to the given slot.
 * Used by PC Builder to grey out incompatible options (e.g. Intel CPU when AM4 motherboard is selected).
 */
export function isCompatibleWithBuild(
  item: InventoryItem,
  slotId: string,
  parts: Record<string, InventoryItem[]>
): CompatibilityResult {
  const specs = item.specs || {};
  const get = (it: InventoryItem, key: string) => getSpec(it, key);

  const mobo = parts['MOBO']?.[0];
  const cpu = parts['CPU']?.[0];

  switch (slotId) {
    case 'CPU': {
      if (!mobo) return { compatible: true };
      const moboSocket = norm(get(mobo, 'Socket'));
      const cpuSocket = norm(get(item, 'Socket'));
      if (!moboSocket) return { compatible: true };
      if (!cpuSocket) return { compatible: true }; // no spec – allow
      if (moboSocket !== cpuSocket) {
        return { compatible: false, reason: `Motherboard is ${moboSocket}; this CPU is ${cpuSocket}` };
      }
      const vendor = socketVendor(moboSocket);
      if (vendor) {
        const brand = norm(get(item, 'Brand') || get(item, 'Vendor') || '');
        const isAMD = brand.includes('AMD') || brand.includes('RYZEN') || brand.includes('THREADRIPPER');
        const isIntel = brand.includes('INTEL') || brand.includes('CORE');
        if (vendor === 'amd' && isIntel) return { compatible: false, reason: 'Motherboard is AMD socket; this is an Intel CPU' };
        if (vendor === 'intel' && isAMD) return { compatible: false, reason: 'Motherboard is Intel socket; this is an AMD CPU' };
      }
      return { compatible: true };
    }

    case 'MOBO': {
      if (!cpu) return { compatible: true };
      const cpuSocket = norm(get(cpu, 'Socket'));
      const moboSocket = norm(get(item, 'Socket'));
      if (!cpuSocket) return { compatible: true };
      if (!moboSocket) return { compatible: true };
      if (moboSocket !== cpuSocket) {
        return { compatible: false, reason: `CPU is ${cpuSocket}; this board is ${moboSocket}` };
      }
      return { compatible: true };
    }

    case 'RAM': {
      if (!mobo) return { compatible: true };
      const moboMem = norm(get(mobo, 'Memory Type') || get(mobo, 'RAM Type') || '');
      const ramType = norm(get(item, 'Memory Type') || get(item, 'Type') || get(item, 'DDR') || '');
      if (!moboMem) return { compatible: true };
      if (!ramType) return { compatible: true };
      // Allow if one contains the other (e.g. "DDR4" vs "DDR4 3200")
      if (moboMem.includes(ramType) || ramType.includes(moboMem)) return { compatible: true };
      if (moboMem !== ramType) {
        return { compatible: false, reason: `Motherboard supports ${moboMem}; this is ${ramType}` };
      }
      return { compatible: true };
    }

    default:
      return { compatible: true };
  }
}

/** Category/subcategory checks for compatibility beyond PC Builder. */
function isProcessor(item: InventoryItem): boolean {
  return item.subCategory === 'Processors' || item.category === 'Processors';
}
function isMotherboard(item: InventoryItem): boolean {
  return item.subCategory === 'Motherboards' || item.category === 'Motherboards';
}
function isRAM(item: InventoryItem): boolean {
  return item.subCategory === 'RAM' || item.category === 'RAM';
}

export interface CompatibleGroup {
  label: string;
  items: InventoryItem[];
}

/**
 * Get inventory items that are compatible with this item (by specs: socket, memory type).
 * Use in ItemForm, inventory detail, etc. — not only in PC Builder.
 */
export function getCompatibleItemsForItem(
  item: InventoryItem,
  allItems: InventoryItem[]
): CompatibleGroup[] {
  const others = allItems.filter((i) => i.id !== item.id && i.status !== ItemStatus.SOLD && i.status !== ItemStatus.TRADED);
  const get = (i: InventoryItem, key: string) => getSpec(i, key);
  const result: CompatibleGroup[] = [];

  if (isProcessor(item)) {
    const socket = norm(get(item, 'Socket'));
    if (socket) {
      const mobos = others.filter((i) => {
        if (!isMotherboard(i)) return false;
        const s = norm(get(i, 'Socket'));
        if (!s) return false;
        if (s !== socket) return false;
        const vendor = socketVendor(s);
        if (vendor) {
          const brand = norm(get(item, 'Brand') || get(item, 'Vendor') || '');
          const isAMD = brand.includes('AMD') || brand.includes('RYZEN') || brand.includes('THREADRIPPER');
          const isIntel = brand.includes('INTEL') || brand.includes('CORE');
          if (vendor === 'amd' && isIntel) return false;
          if (vendor === 'intel' && isAMD) return false;
        }
        return true;
      });
      if (mobos.length > 0) result.push({ label: 'Compatible motherboards', items: mobos });
    }
  }

  if (isMotherboard(item)) {
    const moboSocket = norm(get(item, 'Socket'));
    const moboMem = norm(get(item, 'Memory Type') || get(item, 'RAM Type') || '');
    if (moboSocket) {
      const cpus = others.filter((i) => {
        if (!isProcessor(i)) return false;
        const s = norm(get(i, 'Socket'));
        if (!s) return false;
        if (s !== moboSocket) return false;
        const vendor = socketVendor(moboSocket);
        if (vendor) {
          const brand = norm(get(i, 'Brand') || get(i, 'Vendor') || '');
          const isAMD = brand.includes('AMD') || brand.includes('RYZEN') || brand.includes('THREADRIPPER');
          const isIntel = brand.includes('INTEL') || brand.includes('CORE');
          if (vendor === 'amd' && isIntel) return false;
          if (vendor === 'intel' && isAMD) return false;
        }
        return true;
      });
      if (cpus.length > 0) result.push({ label: 'Compatible CPUs', items: cpus });
    }
    if (moboMem) {
      const rams = others.filter((i) => {
        if (!isRAM(i)) return false;
        const ramType = norm(get(i, 'Memory Type') || get(i, 'Type') || get(i, 'DDR') || '');
        if (!ramType) return false;
        if (moboMem.includes(ramType) || ramType.includes(moboMem)) return true;
        return moboMem === ramType;
      });
      if (rams.length > 0) result.push({ label: 'Compatible RAM', items: rams });
    }
  }

  if (isRAM(item)) {
    const ramType = norm(get(item, 'Memory Type') || get(item, 'Type') || get(item, 'DDR') || '');
    if (ramType) {
      const mobos = others.filter((i) => {
        if (!isMotherboard(i)) return false;
        const moboMem = norm(get(i, 'Memory Type') || get(i, 'RAM Type') || '');
        if (!moboMem) return false;
        if (moboMem.includes(ramType) || ramType.includes(moboMem)) return true;
        return moboMem === ramType;
      });
      if (mobos.length > 0) result.push({ label: 'Compatible motherboards', items: mobos });
    }
  }

  return result;
}
