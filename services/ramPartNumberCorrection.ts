/**
 * Correct AI-hallucinated RAM specs from OEM part numbers.
 * Classic failure: SK Hynix HMT351U6EFR8C → model invents "8GB DDR4"
 * (the "8" is organization/revision, not capacity; HMT3… is DDR3; 351 = 4GB).
 */

export type RamDecode = {
  memoryType: 'DDR2' | 'DDR3' | 'DDR4' | 'DDR5';
  capacityGb: number;
  formFactor?: 'UDIMM' | 'SODIMM' | 'RDIMM';
  speedMhz?: number;
};

function findSpecKey(specs: Record<string, string | number>, candidates: string[]): string | null {
  const keys = Object.keys(specs);
  for (const cand of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === cand.toLowerCase());
    if (hit) return hit;
  }
  for (const cand of candidates) {
    const hit = keys.find((k) => k.toLowerCase().includes(cand.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function parseGb(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d{1,3})\s*GB/i);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n <= 256 ? n : null;
}

function parseDdrGen(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).toUpperCase();
  const m = s.match(/DDR\s*([2-5])/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Decode common SK Hynix module P/Ns (HMT…).
 * Density codes from Hynix DDR3/DDR4 UDIMM naming (widely used desktop sticks).
 */
export function decodeSkHynixModulePn(pn: string): RamDecode | null {
  const u = pn.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // HMT351U6EFR8C / HMT41GU6AFR8A / HMT451U6AMR8C / HMT82GS6AFR8C
  // Family code is 3 chars after HMT (351, 41G, 451…) then package letter U/S/R.
  const m = u.match(/^HMT([34](?:\d{2}|[1-9]G))([USR])([0-9A-Z]+)/);
  if (!m) return null;

  const family = m[1]; // 351, 41G, 451, 112, …
  const packageCode = m[2];

  /** Known family → { gen, GB }. Prefer this over guessing from the leading digit. */
  const exact: Record<string, { type: RamDecode['memoryType']; gb: number }> = {
    '112': { type: 'DDR3', gb: 1 },
    '125': { type: 'DDR3', gb: 2 },
    '251': { type: 'DDR3', gb: 2 },
    '325': { type: 'DDR3', gb: 2 },
    '351': { type: 'DDR3', gb: 4 }, // HMT351U6EFR8C — 4GB DDR3 (NOT 8GB DDR4)
    '41G': { type: 'DDR3', gb: 8 }, // HMT41GU6… — 8GB DDR3
    '451': { type: 'DDR4', gb: 4 },
    '51G': { type: 'DDR4', gb: 8 },
    '81G': { type: 'DDR4', gb: 8 },
    '82G': { type: 'DDR4', gb: 8 },
  };

  const known = exact[family];
  let memoryType: RamDecode['memoryType'];
  let capacityGb: number;
  if (known) {
    memoryType = known.type;
    capacityGb = known.gb;
  } else if (family.startsWith('3')) {
    memoryType = 'DDR3';
    if (/^16G/i.test(family)) capacityGb = 16;
    else if (/G$/i.test(family) || /^8/i.test(family)) capacityGb = 8;
    else if (/^4|^35/i.test(family)) capacityGb = 4;
    else if (/^2|^12|^25/i.test(family)) capacityGb = 2;
    else capacityGb = 1;
  } else if (family.startsWith('4')) {
    memoryType = 'DDR4';
    if (/^16G/i.test(family)) capacityGb = 16;
    else if (/G$/i.test(family) || /^8/i.test(family)) capacityGb = 8;
    else capacityGb = 4;
  } else {
    return null;
  }

  let formFactor: RamDecode['formFactor'];
  if (packageCode === 'U') formFactor = 'UDIMM';
  else if (packageCode === 'S') formFactor = 'SODIMM';
  else if (packageCode === 'R') formFactor = 'RDIMM';

  let speedMhz: number | undefined;
  if (/-PB/i.test(pn)) speedMhz = 1600;

  return { memoryType, capacityGb, formFactor, speedMhz };
}

/** Samsung M378B… (DDR3) / M378A… (DDR4) common desktop modules. */
export function decodeSamsungModulePn(pn: string): RamDecode | null {
  const u = pn.toUpperCase().replace(/\s+/g, '');
  // M378B5273… = 4GB DDR3; M378B1G73… = 8GB DDR3; M378A1K43… = 8GB DDR4
  if (/^M378B5273/i.test(u)) return { memoryType: 'DDR3', capacityGb: 4, formFactor: 'UDIMM' };
  if (/^M378B1G73/i.test(u)) return { memoryType: 'DDR3', capacityGb: 8, formFactor: 'UDIMM' };
  if (/^M378B5173/i.test(u)) return { memoryType: 'DDR3', capacityGb: 4, formFactor: 'UDIMM' };
  if (/^M378A1K43/i.test(u)) return { memoryType: 'DDR4', capacityGb: 8, formFactor: 'UDIMM' };
  if (/^M378A5244/i.test(u)) return { memoryType: 'DDR4', capacityGb: 8, formFactor: 'UDIMM' };
  if (/^M471B5273/i.test(u)) return { memoryType: 'DDR3', capacityGb: 4, formFactor: 'SODIMM' };
  if (/^M471B1G73/i.test(u)) return { memoryType: 'DDR3', capacityGb: 8, formFactor: 'SODIMM' };
  return null;
}

export function extractOemRamPartNumber(text: string): string | null {
  const s = text.toUpperCase();
  const hynix = s.match(/\b(HMT[34][A-Z0-9]{6,})\b/);
  if (hynix) return hynix[1];
  const samsung = s.match(/\b(M378[AB][A-Z0-9]{5,}|M471[AB][A-Z0-9]{5,})\b/);
  if (samsung) return samsung[1];
  return null;
}

export function decodeRamPartNumber(pn: string): RamDecode | null {
  return decodeSkHynixModulePn(pn) || decodeSamsungModulePn(pn);
}

export function shouldApplyRamPartCorrection(categoryContext: string, productName: string): boolean {
  const c = (categoryContext || '').toLowerCase();
  if (c.includes('ram') || c.includes('memory') || c.includes('arbeitsspeicher')) return true;
  const n = productName.toLowerCase();
  return (
    /\bhmt[34]/i.test(n) ||
    /\bm378[ab]/i.test(n) ||
    /\bm471[ab]/i.test(n) ||
    /\bddr\s*[23]\b/i.test(n) ||
    /\bsk\s*hynix\b/i.test(n) ||
    /\bhynix\b/i.test(n)
  );
}

/**
 * Overwrite Memory Type / capacity fields when OEM P/N decoding disagrees with the AI.
 */
export function correctRamSpecsFromPartNumber(
  productName: string,
  standardizedName: string | undefined,
  specs: Record<string, string | number>,
  categoryContext = ''
): Record<string, string | number> {
  const full = `${productName} ${standardizedName || ''}`.trim();
  if (!full) return { ...specs };
  if (!shouldApplyRamPartCorrection(categoryContext, full) && !extractOemRamPartNumber(full)) {
    return { ...specs };
  }

  const pn = extractOemRamPartNumber(full);
  if (!pn) return { ...specs };
  const decoded = decodeRamPartNumber(pn);
  if (!decoded) return { ...specs };

  const out = { ...specs };
  const typeKey =
    findSpecKey(out, ['Memory Type', 'RAM Type', 'Type', 'DDR']) ||
    (Object.keys(out).length ? null : 'Memory Type');
  const gbStickKey = findSpecKey(out, ['GB per Stick', 'Capacity per Module', 'Module Size']);
  const kitKey = findSpecKey(out, ['Kit Capacity', 'Capacity', 'Size', 'Total Capacity']);
  const speedKey = findSpecKey(out, ['Speed', 'Frequency', 'Clock']);

  const wantType = decoded.memoryType;
  const wantGb = decoded.capacityGb;

  if (typeKey) {
    const curGen = parseDdrGen(out[typeKey]);
    const wantGen = parseInt(wantType.replace(/\D/g, ''), 10);
    if (curGen !== wantGen) out[typeKey] = wantType;
    else if (!String(out[typeKey]).toUpperCase().includes(wantType)) out[typeKey] = wantType;
  } else {
    out['Memory Type'] = wantType;
  }

  const gbLabel = `${wantGb}GB`;
  if (gbStickKey) {
    const cur = parseGb(out[gbStickKey]);
    if (cur !== wantGb) out[gbStickKey] = gbLabel;
  } else if (!kitKey) {
    out['GB per Stick'] = gbLabel;
  }

  if (kitKey) {
    const cur = parseGb(out[kitKey]);
    // Only force kit capacity when it looks like a single-module listing (or AI invented wrong GB).
    const modulesKey = findSpecKey(out, ['Modules', 'Sticks', 'Rank']);
    const modulesRaw = modulesKey ? String(out[modulesKey]) : '';
    const multi = /x\s*[2-8]|2\s*x|kit/i.test(modulesRaw) || /2x|4x|kit/i.test(full);
    if (!multi && cur !== wantGb) out[kitKey] = gbLabel;
    else if (cur != null && cur !== wantGb && cur === 8 && wantGb === 4) out[kitKey] = gbLabel;
  }

  if (decoded.speedMhz && speedKey) {
    const cur = String(out[speedKey] || '');
    if (!/\d{3,5}/.test(cur)) out[speedKey] = `${decoded.speedMhz} MHz`;
  }

  return out;
}
