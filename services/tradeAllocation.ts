/**
 * Split the non-cash portion of a trade (deal value minus net cash) across
 * incoming items — either equally or with heuristic weights (CPU tier, GPU hints, etc.).
 */

export type TradeSplitMode = 'manual' | 'equal' | 'smart';

export interface TradeAllocationItemInput {
  id: string;
  name: string;
  category: string;
  /** Key from LOCAL_HARDWARE_INDEX when added via DB search (e.g. Processors, Graphics Cards). */
  hardwareDbType?: string;
  specs?: Record<string, string | number>;
}

/** Relative weight for "smart" split; higher = larger share of remainder. */
export function tradeItemSmartWeight(item: TradeAllocationItemInput): number {
  const name = (item.name || '').toLowerCase();
  const t = item.hardwareDbType || '';

  if (t === 'Processors') {
    const cores = Number(item.specs?.cores);
    if (Number.isFinite(cores) && cores > 0) return 42 + cores * 9;
    if (/i9|ryzen\s*9|threadripper|core\s*ultra\s*9|ultra\s*9\b/.test(name)) return 118;
    if (/i7|ryzen\s*7|core\s*ultra\s*7|ultra\s*7\b/.test(name)) return 82;
    if (/i5|ryzen\s*5|core\s*ultra\s*5|ultra\s*5\b/.test(name)) return 58;
    if (/i3|ryzen\s*3|core\s*ultra\s*3|ultra\s*3\b/.test(name)) return 38;
    if (/pentium|celeron|athlon/.test(name)) return 22;
    return 48;
  }

  if (t === 'Graphics Cards') {
    const vramStr = String(
      item.specs?.['VRAM'] ?? item.specs?.vram ?? item.specs?.memory ?? ''
    );
    const m = vramStr.match(/(\d+)/);
    if (m) return 36 + Math.min(parseInt(m[1], 10), 24) * 2.2;
    if (/4090|7900\s*xtx|4080\s*super|4080\b/.test(name)) return 105;
    if (/4070|7800\s*xt|3080|3090/.test(name)) return 78;
    if (/4060|7700|6700|3070/.test(name)) return 58;
    return 52;
  }

  if (t === 'Laptops') return 72;
  if (t === 'Motherboards') return 34;
  if (t === 'RAM') return 16;
  if (t === 'Storage (SSD/HDD)') return 20;
  if (t === 'Power Supplies') return 24;
  if (t === 'Cases') return 18;
  if (t === 'Cooling') return 20;
  if (t === 'Monitors') return 38;
  if (['Gadgets', 'Smartphones', 'Tablets', 'Consoles'].includes(t)) return 44;

  if (item.category === 'PC Components') {
    if (/\bcpu\b|processor|ryzen|core\s*i/.test(name)) return tradeItemSmartWeight({ ...item, hardwareDbType: 'Processors' });
    if (/rtx|radeon|gtx|graphics|gpu|grafikkarte/.test(name)) return tradeItemSmartWeight({ ...item, hardwareDbType: 'Graphics Cards' });
  }

  return 20;
}

/**
 * Allocate `remainderEuros` across `items` in cents so the sum matches exactly (within rounding).
 */
export function allocateRemainderEuros(
  remainderEuros: number,
  items: TradeAllocationItemInput[],
  mode: 'equal' | 'smart'
): number[] {
  if (items.length === 0) return [];
  const cents = Math.round(remainderEuros * 100);
  if (cents <= 0) return items.map(() => 0);

  if (mode === 'equal') {
    const n = items.length;
    const base = Math.floor(cents / n);
    const extra = cents - base * n;
    return items.map((_, i) => (base + (i < extra ? 1 : 0)) / 100);
  }

  const weights = items.map((it) => Math.max(tradeItemSmartWeight(it), 0.5));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const rawCents = weights.map((w) => (cents * w) / sumW);
  const floors = rawCents.map((x) => Math.floor(x));
  let diff = cents - floors.reduce((a, b) => a + b, 0);
  const fracs = rawCents.map((x, i) => ({ i, f: x - floors[i] }));
  fracs.sort((a, b) => b.f - a.f);
  const result = [...floors];
  const nF = fracs.length;
  for (let k = 0; k < diff; k++) {
    result[fracs[k % nF].i] += 1;
  }
  return result.map((c) => c / 100);
}
