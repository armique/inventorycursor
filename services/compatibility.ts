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

/** Normalize socket for equality (e.g. "LGA 1155" and "LGA1155" match). */
function normSocket(s: string): string {
  return norm(s).replace(/\s+/g, '').replace(/-/g, '');
}

/** AMD sockets (CPU must be AMD). */
const AMD_SOCKETS = new Set(['AM4', 'AM5', 'TR4', 'STRX4', 'STR5']);
/** Intel sockets (CPU must be Intel). */
const INTEL_SOCKETS = new Set(['LGA1155', 'LGA1150', 'LGA1151', 'LGA1200', 'LGA1700', 'LGA1851', 'LGA2066', 'LGA2011', 'LGA20113']);

/** Socket → supported RAM types. AM4/AM5 fixed; Intel LGA1700 supports both DDR4 and DDR5 (board-dependent). */
const SOCKET_RAM_TYPES: Record<string, string[]> = {
  AM4: ['DDR4'],
  AM5: ['DDR5'],
  TR4: ['DDR4'],
  STRX4: ['DDR4'],
  STR5: ['DDR5'],
  LGA1155: ['DDR3'],
  LGA1150: ['DDR3'],
  LGA2011: ['DDR3'],
  LGA1151: ['DDR4'],
  LGA20113: ['DDR4'],
  LGA1200: ['DDR4'],
  LGA1700: ['DDR4', 'DDR5'],
  LGA1851: ['DDR5'],
  LGA2066: ['DDR4'],
};

function socketVendor(socket: string): 'amd' | 'intel' | null {
  const u = normSocket(socket);
  if (AMD_SOCKETS.has(u)) return 'amd';
  if (INTEL_SOCKETS.has(u)) return 'intel';
  if (u.startsWith('AM')) return 'amd';
  if (u.startsWith('LGA') || u.startsWith('S')) return 'intel';
  return null;
}

/** Get supported RAM types for a socket (e.g. AM4 → [DDR4]). */
function ramTypesForSocket(socket: string): string[] {
  const u = normSocket(socket);
  return SOCKET_RAM_TYPES[u] ?? [];
}

/** Extract DDR generation from spec value (e.g. "DDR4 3200" → "DDR4", "DDR3L" → "DDR3"). */
function normRamType(s: string | number | undefined): string {
  const raw = norm(s);
  if (!raw) return '';
  if (raw.includes('DDR5')) return 'DDR5';
  if (raw.includes('DDR4')) return 'DDR4';
  if (raw.includes('DDR3')) return 'DDR3';
  return raw;
}

/** Parse "DDR4", "DDR4, DDR5" etc. into list of normalized types. */
function allowedRamTypesFromSpec(spec: string | number | undefined): string[] {
  const raw = norm(spec);
  if (!raw) return [];
  return raw.split(/[,/]/).map((s) => normRamType(s)).filter(Boolean);
}

/** True if RAM spec value matches one of the allowed types (e.g. "DDR4 3200" matches allowed "DDR4"). */
function ramMatches(ramSpecValue: string | number | undefined, allowedTypes: string[]): boolean {
  const r = normRamType(ramSpecValue);
  if (!r || allowedTypes.length === 0) return true;
  return allowedTypes.some((a) => r === a || r.includes(a) || a.includes(r));
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
      // When motherboard has socket (e.g. AM4), only show CPUs with matching socket
      if (cpuSocket) {
        if (normSocket(moboSocket) !== normSocket(cpuSocket)) {
          return { compatible: false, reason: `Motherboard is ${moboSocket}; this CPU is ${cpuSocket}` };
        }
      } else {
        return { compatible: false, reason: 'Motherboard has socket; this CPU has no Socket spec' };
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
      // When CPU has socket, only show motherboards with matching socket (e.g. i7-2600 LGA1155 → only LGA1155 boards)
      if (cpuSocket) {
        if (!moboSocket) return { compatible: false, reason: 'CPU has socket; this board has no Socket spec' };
        if (normSocket(cpuSocket) !== normSocket(moboSocket)) {
          return { compatible: false, reason: `CPU is ${cpuSocket}; this board is ${moboSocket}` };
        }
      }
      // Intel vs AMD: if CPU has socket or brand, only show matching boards
      const cpuVendor = cpuSocket ? socketVendor(cpuSocket) : null;
      const cpuBrand = norm(get(cpu, 'Brand') || get(cpu, 'Vendor') || '');
      const cpuIsAMD = cpuBrand.includes('AMD') || cpuBrand.includes('RYZEN') || cpuBrand.includes('THREADRIPPER');
      const cpuIsIntel = cpuBrand.includes('INTEL') || cpuBrand.includes('CORE');
      const moboBrand = norm(get(item, 'Brand') || get(item, 'Chipset') || get(item, 'Vendor') || '');
      const moboIsAMD = moboBrand.includes('AMD') || moboBrand.includes('B550') || moboBrand.includes('B650') || moboBrand.includes('X570') || moboBrand.includes('X670');
      const moboIsIntel = moboBrand.includes('INTEL') || moboBrand.includes('B660') || moboBrand.includes('Z690') || moboBrand.includes('B760') || moboBrand.includes('Z790');
      if (cpuVendor === 'amd' && moboIsIntel) return { compatible: false, reason: 'CPU is AMD; this is an Intel motherboard' };
      if (cpuVendor === 'intel' && moboIsAMD) return { compatible: false, reason: 'CPU is Intel; this is an AMD motherboard' };
      if (cpuIsAMD && moboIsIntel) return { compatible: false, reason: 'CPU is AMD; this is an Intel motherboard' };
      if (cpuIsIntel && moboIsAMD) return { compatible: false, reason: 'CPU is Intel; this is an AMD motherboard' };
      return { compatible: true };
    }

    case 'RAM': {
      const ramTypeRaw = get(item, 'Memory Type') ?? get(item, 'Type') ?? get(item, 'DDR');
      const ramType = normRamType(ramTypeRaw);
      if (!ramType) return { compatible: true }; // no RAM spec – allow

      // Primary: motherboard defines supported RAM (DDR3/DDR4/DDR5; may list multiple e.g. "DDR4, DDR5")
      if (mobo) {
        const moboMem = get(mobo, 'Memory Type') ?? get(mobo, 'RAM Type');
        const allowedByMobo = allowedRamTypesFromSpec(moboMem);
        if (allowedByMobo.length > 0) {
          if (!ramMatches(ramTypeRaw, allowedByMobo)) {
            return { compatible: false, reason: `Motherboard supports ${norm(moboMem)}; this is ${ramType}` };
          }
          return { compatible: true };
        }
      }

      // No MOBO or MOBO has no memory spec: when CPU is selected, filter by CPU socket's supported RAM (AM4→DDR4, AM5→DDR5, LGA1155→DDR3, LGA1700→DDR4/DDR5, etc.)
      if (cpu) {
        const cpuSocket = norm(get(cpu, 'Socket'));
        if (cpuSocket) {
          const allowed = ramTypesForSocket(cpuSocket);
          if (allowed.length > 0 && !ramMatches(ramTypeRaw, allowed)) {
            return { compatible: false, reason: `CPU socket ${cpuSocket} supports ${allowed.join('/')}; this is ${ramType}` };
          }
        }
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
