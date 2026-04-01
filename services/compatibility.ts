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

/** Intersect DDR types from motherboard and CPU socket (e.g. LGA1700 CPU + DDR5-only board → DDR5 only). */
function intersectRamTypes(a: string[], b: string[]): string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const normList = (xs: string[]) => xs.map((x) => normRamType(x)).filter(Boolean);
  const na = normList(a);
  const nb = normList(b);
  return na.filter((t) => nb.some((u) => t === u));
}

/**
 * Effective DDR generations allowed for this build: motherboard Memory Type ∩ CPU socket RAM types when both are known.
 */
function effectiveRamTypesAllowed(mobo: InventoryItem | undefined, cpu: InventoryItem | undefined): string[] {
  const get = (it: InventoryItem, key: string) => getSpec(it, key);
  let fromMobo: string[] = [];
  if (mobo) {
    const moboMem = get(mobo, 'Memory Type') ?? get(mobo, 'RAM Type');
    fromMobo = allowedRamTypesFromSpec(moboMem);
  }
  let fromCpu: string[] = [];
  if (cpu) {
    const cpuSocket = norm(get(cpu, 'Socket'));
    if (cpuSocket) fromCpu = ramTypesForSocket(cpuSocket);
  }
  return intersectRamTypes(fromMobo, fromCpu);
}

/**
 * Infer AMD vs Intel for a CPU from brand/vendor/name/socket (handles missing spec fields).
 */
function inferCpuPlatform(item: InventoryItem): 'amd' | 'intel' | null {
  const get = (it: InventoryItem, key: string) => getSpec(it, key);
  const brand = norm(get(item, 'Brand') || get(item, 'Vendor') || '');
  if (brand.includes('AMD') || brand.includes('RYZEN') || brand.includes('THREADRIPPER') || brand.includes('ATHLON')) return 'amd';
  if (brand.includes('INTEL') || brand.includes('CORE') || brand.includes('XEON') || brand.includes('PENTIUM') || brand.includes('CELERON')) return 'intel';
  const name = norm(item.name || '');
  if (/\bRYZEN\b|THREADRIPPER|EPYC|ATHLON|FX-\d{4}\b/i.test(name)) return 'amd';
  if (/\bINTEL\b|\bCORE\s*(I3|I5|I7|I9|ULTRA)|\bXEON\b|PENTIUM|CELERON|CORE\s*M\b/i.test(name)) return 'intel';
  const sock = norm(get(item, 'Socket'));
  if (sock) return socketVendor(sock);
  return null;
}

/**
 * Infer AMD vs Intel platform for a motherboard from Socket, chipset, or model name.
 */
function inferMoboPlatform(mobo: InventoryItem): 'amd' | 'intel' | null {
  const get = (it: InventoryItem, key: string) => getSpec(it, key);
  const sock = norm(get(mobo, 'Socket'));
  if (sock) {
    const v = socketVendor(sock);
    if (v) return v;
    if (sock.startsWith('LGA') || sock.startsWith('S')) return 'intel';
    if (sock.startsWith('AM') || sock.startsWith('TR') || sock.startsWith('STR')) return 'amd';
  }
  const chip = norm(get(mobo, 'Chipset') || '');
  const name = norm(mobo.name || '');
  const combined = `${chip} ${name}`;
  // Intel desktop chipsets (recent + common)
  if (/\b(Z890|Z790|H770|B760|H710|W680|Z690|H670|B660|H610|Z590|B560|H510|Z490|B460|H410|Z390|B365|H310|Z370|B360|H370)\b/i.test(combined)) return 'intel';
  if (/\bLGA\s*\d+/i.test(combined)) return 'intel';
  // AMD desktop chipsets
  if (/\b(X870|B850|X670E|X670|B650E|B650|A620|X570|B550|A520|X470|B450|A320|X399|TRX40|WRX80)\b/i.test(combined)) return 'amd';
  if (/\bAM[45]\b|TRX40|STRX|sTRX|WRX/i.test(combined)) return 'amd';
  const br = norm(get(mobo, 'Brand') || get(mobo, 'Vendor') || '');
  // Some vendors are mixed; prefer chipset regex above. EVGA had Intel boards.
  if (br.includes('INTEL') && !br.includes('AMD')) return 'intel';
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
      const moboPlat = inferMoboPlatform(mobo);
      const cpuPlat = inferCpuPlatform(item);
      if (moboPlat && cpuPlat && moboPlat !== cpuPlat) {
        return {
          compatible: false,
          reason: `Motherboard is ${moboPlat === 'intel' ? 'Intel' : 'AMD'} platform; this CPU is ${cpuPlat === 'intel' ? 'Intel' : 'AMD'}`,
        };
      }
      const moboSocket = norm(get(mobo, 'Socket'));
      const cpuSocket = norm(get(item, 'Socket'));
      if (moboSocket && cpuSocket) {
        if (normSocket(moboSocket) !== normSocket(cpuSocket)) {
          return { compatible: false, reason: `Motherboard is ${moboSocket}; this CPU is ${cpuSocket}` };
        }
      } else if (moboSocket && !cpuSocket) {
        return { compatible: false, reason: 'Motherboard has socket; this CPU has no Socket spec' };
      }
      return { compatible: true };
    }

    case 'MOBO': {
      if (!cpu) return { compatible: true };
      const moboPlat = inferMoboPlatform(item);
      const cpuPlat = inferCpuPlatform(cpu);
      if (moboPlat && cpuPlat && moboPlat !== cpuPlat) {
        return {
          compatible: false,
          reason: `CPU is ${cpuPlat === 'intel' ? 'Intel' : 'AMD'}; this board is ${moboPlat === 'intel' ? 'Intel' : 'AMD'} platform`,
        };
      }
      const cpuSocket = norm(get(cpu, 'Socket'));
      const moboSocket = norm(get(item, 'Socket'));
      if (cpuSocket && moboSocket) {
        if (normSocket(cpuSocket) !== normSocket(moboSocket)) {
          return { compatible: false, reason: `CPU is ${cpuSocket}; this board is ${moboSocket}` };
        }
      } else if (cpuSocket && !moboSocket) {
        return { compatible: false, reason: 'CPU has socket; this board has no Socket spec' };
      }
      return { compatible: true };
    }

    case 'RAM': {
      const ramTypeRaw = get(item, 'Memory Type') ?? get(item, 'Type') ?? get(item, 'DDR');
      const ramType = normRamType(ramTypeRaw);

      // Multiple sticks: match DDR generation already in build (avoid DDR4 + DDR5 mix on boards that list both).
      const existingSticks = parts['RAM']?.filter((r) => r.id !== item.id) ?? [];
      if (existingSticks.length > 0 && ramType) {
        const firstRaw = get(existingSticks[0], 'Memory Type') ?? get(existingSticks[0], 'Type') ?? get(existingSticks[0], 'DDR');
        const firstType = normRamType(firstRaw);
        if (firstType && ramType !== firstType) {
          return { compatible: false, reason: `This build already uses ${firstType}; add another ${firstType} module` };
        }
      }

      if (!ramType) return { compatible: true }; // no RAM spec – allow

      // Motherboard + CPU: intersection of allowed DDR (e.g. DDR5-only board + AM5 CPU → DDR5 only, not DDR4).
      const effective = effectiveRamTypesAllowed(mobo, cpu);
      if (effective.length > 0) {
        if (!ramMatches(ramTypeRaw, effective)) {
          return {
            compatible: false,
            reason: `This build allows ${effective.join('/')} (motherboard + CPU); this module is ${ramType}`,
          };
        }
        return { compatible: true };
      }

      // Only motherboard RAM spec
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

      // Only CPU socket (no mobo memory spec)
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
    const cpuPlat = inferCpuPlatform(item);
    if (socket) {
      const mobos = others.filter((i) => {
        if (!isMotherboard(i)) return false;
        const s = norm(get(i, 'Socket'));
        if (!s) return false;
        if (s !== socket) return false;
        const moboPlat = inferMoboPlatform(i);
        if (cpuPlat && moboPlat && cpuPlat !== moboPlat) return false;
        return true;
      });
      if (mobos.length > 0) result.push({ label: 'Compatible motherboards', items: mobos });
    }
  }

  if (isMotherboard(item)) {
    const moboSocket = norm(get(item, 'Socket'));
    const moboMem = norm(get(item, 'Memory Type') || get(item, 'RAM Type') || '');
    const moboPlat = inferMoboPlatform(item);
    if (moboSocket) {
      const cpus = others.filter((i) => {
        if (!isProcessor(i)) return false;
        const s = norm(get(i, 'Socket'));
        if (!s) return false;
        if (s !== moboSocket) return false;
        const cpuPlat = inferCpuPlatform(i);
        if (moboPlat && cpuPlat && moboPlat !== cpuPlat) return false;
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
