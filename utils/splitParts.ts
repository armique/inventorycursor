/**
 * Split a single stock item (e.g. faulty AIO) into sellable Bundle child parts.
 */

import { InventoryItem, ItemStatus } from '../types';
import { roundMoney } from '../services/financialAggregation';
import {
  resolveSuggestedEbayList,
  suggestionPatchFromPrice,
} from './flipInsights';
import { loadFlipFees } from './flipCoach';
import { buildCostOrigin } from './costOrigin';
import { isRealizedDisposal } from './itemDisposition';
import { itemHasActiveSaleSnapshot, snapshotSaleCycle } from './itemSaleCycle';

export type SplitPartPresetId =
  | 'ovp'
  | 'lcd'
  | 'fans'
  | 'radiator'
  | 'controller'
  | 'cable'
  | 'identical'
  /** Synthetic, never user-selectable — see buildSplitDrafts. */
  | 'remainder';

export type SplitMode = 'parts' | 'identical';

export type SplitPartPreset = {
  id: SplitPartPresetId;
  label: string;
  /** Short label used in generated names. */
  shortLabel: string;
  /** Relative weight for buy-cost allocation (normalized across selected). */
  weight: number;
  category: string;
  subCategory: string;
  /** Fans support a quantity stepper → one child row with quantity. */
  hasQty?: boolean;
};

export const SPLIT_PART_PRESETS: SplitPartPreset[] = [
  {
    id: 'ovp',
    label: 'OVP',
    shortLabel: 'OVP',
    weight: 5,
    category: 'Misc',
    subCategory: 'Spare Parts',
  },
  {
    id: 'lcd',
    label: 'LCD',
    shortLabel: 'LCD',
    weight: 30,
    category: 'Components',
    subCategory: 'Cooling',
  },
  {
    id: 'fans',
    label: 'Fans',
    shortLabel: 'Fans',
    weight: 10,
    category: 'Components',
    subCategory: 'Cooling',
    hasQty: true,
  },
  {
    id: 'radiator',
    label: 'Radiator',
    shortLabel: 'Rad',
    weight: 25,
    category: 'Components',
    subCategory: 'Cooling',
  },
  {
    id: 'controller',
    label: 'Controller',
    shortLabel: 'Ctrl',
    weight: 10,
    category: 'Components',
    subCategory: 'Cooling',
  },
  {
    id: 'cable',
    label: 'Cable',
    shortLabel: 'Cable',
    weight: 5,
    category: 'Misc',
    subCategory: 'Cables',
  },
];

export type CableTypeId = 'motherboard' | 'cpu' | 'pcie' | '12vhpwr' | 'sata' | 'molex' | 'other';

export const CABLE_TYPE_OPTIONS: Array<{ id: CableTypeId; label: string; shortLabel: string }> = [
  { id: 'motherboard', label: 'Motherboard (24-pin)', shortLabel: 'MB' },
  { id: 'cpu', label: 'CPU / EPS', shortLabel: 'CPU' },
  { id: 'pcie', label: 'PCIe 6+2', shortLabel: 'PCIe' },
  { id: '12vhpwr', label: '12VHPWR', shortLabel: '12VHPWR' },
  { id: 'sata', label: 'SATA', shortLabel: 'SATA' },
  { id: 'molex', label: 'Molex', shortLabel: 'Molex' },
  { id: 'other', label: 'Other', shortLabel: 'Cable' },
];

export function cableTypeLabel(id: CableTypeId): string {
  return CABLE_TYPE_OPTIONS.find((t) => t.id === id)?.shortLabel || 'Cable';
}

/** One cable-type line under the "Cable" preset — e.g. "2x SATA" and "1x 12VHPWR" as
 *  separate rows, since a single sale can bundle several different cable types. */
export type CableLine = {
  id: string;
  type: CableTypeId;
  qty: number;
};

/** A loose cable is worth a few euros, not a proportional slice of the parent's price. */
function randomCableBuyPrice(): number {
  return roundMoney(1 + Math.random() * 2);
}

export type AioHints = {
  looksLikeAio: boolean;
  radiatorMm: number | null;
  defaultFanQty: number;
  likelyLcd: boolean;
};

const FILLER_WORDS =
  /\b(aio|all[\s-]?in[\s-]?one|wasserk(?:ue|ü)hlung|water\s*cooling|liquid\s*cooler|cpu\s*cooler|rgb|argb|white|black|blackout|edition|kit|set|defekt|faulty|broken|neu|new|ovp)\b/gi;

/** Compact brand + model/size stem for short part names (e.g. "Arctic 360", "Corsair H100i"). */
export function shortSourceStem(sourceName: string, radiatorMm?: number | null): string {
  let s = stripIdenticalQtyFromName(sourceName || '');
  if (!s) return 'Item';

  s = s.replace(FILLER_WORDS, ' ');
  s = s.replace(/[|/·•]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Prefer known short product tokens + size.
  const model =
    s.match(/\b(h100i|h115i|h150i|h170i|h100|kraken\s*z?\d*|liquid\s*freezer(?:\s*ii|\s*iii)?|lf\s*ii|lf\s*iii|castlex|galahad|ryujin|mag\s*coreliquid[^\s]*)\b/i)?.[0] ||
    '';
  const brand =
    s.match(
      /\b(arctic|corsair|nzxt|cooler\s*master|deepcool|be\s*quiet!?|noctua|asus|msi|gigabyte|ekwb|ek\b|thermaltake|fractal|lian\s*li|alphacool)\b/i
    )?.[0] || s.split(/\s+/)[0] || 'Item';

  const mm = radiatorMm ?? (s.match(/\b(120|140|240|280|360|420)\b/) ? Number(s.match(/\b(120|140|240|280|360|420)\b/)![1]) : null);

  const brandClean = brand.replace(/\s+/g, ' ').trim();
  let modelClean = model.replace(/\s+/g, ' ').trim();
  modelClean = modelClean
    .replace(/liquid\s*freezer\s*iii/i, 'LF III')
    .replace(/liquid\s*freezer\s*ii/i, 'LF II')
    .replace(/liquid\s*freezer/i, 'LF')
    .replace(/coreliquid/i, 'CL');

  let stem = brandClean;
  if (modelClean && !stem.toLowerCase().includes(modelClean.toLowerCase().slice(0, 5))) {
    stem = `${stem} ${modelClean}`.trim();
  }
  if (mm && !stem.includes(String(mm))) {
    stem = `${stem} ${mm}`.trim();
  }

  // Fallback: first 3 meaningful tokens if still too generic.
  if (stem.split(/\s+/).length < 2) {
    const tokens = s.split(/\s+/).filter((t) => t.length > 1).slice(0, 3);
    if (tokens.length) stem = tokens.join(' ');
  }

  if (stem.length > 24) stem = stem.slice(0, 24).trim();
  return stem || 'Item';
}

export function detectAioHints(
  name: string,
  specs?: Record<string, string | number>
): AioHints {
  const n = (name || '').toLowerCase();
  const specBlob = specs
    ? Object.values(specs)
        .map((v) => String(v).toLowerCase())
        .join(' ')
    : '';
  const blob = `${n} ${specBlob}`;

  const looksLikeAio =
    /\baio\b|all[\s-]?in[\s-]?one|liquid\s*freezer|wasser[\s-]?k(?:ue|ü)hl|water\s*cool|kraken|h100i|h115i|h150i|h170i|castlex|galahad|liquid\s*cooler|wak[uü]/.test(
      blob
    ) ||
    (/\bradiator\b|\b360\b|\b280\b|\b240\b|\b420\b/.test(blob) &&
      /\bcool|l[uü]fter|fan|pump|aio\b/.test(blob));

  let radiatorMm: number | null = null;
  const mmMatch = blob.match(/\b(120|140|240|280|360|420)\b/);
  if (mmMatch) radiatorMm = Number(mmMatch[1]);
  if (!radiatorMm && specs) {
    const type = String(specs.Type || specs.type || specs.Size || specs.size || '');
    const m = type.match(/\b(120|140|240|280|360|420)\b/);
    if (m) radiatorMm = Number(m[1]);
  }

  let defaultFanQty = 3;
  if (radiatorMm === 120 || radiatorMm === 140) defaultFanQty = 1;
  else if (radiatorMm === 240 || radiatorMm === 280) defaultFanQty = 2;
  else if (radiatorMm === 360) defaultFanQty = 3;
  else if (radiatorMm === 420) defaultFanQty = 3;

  const likelyLcd = /\blcd\b|\bdisplay\b|\btouch\b|elite\s*capellix|lcd\s*aio/.test(blob);

  return { looksLikeAio, radiatorMm, defaultFanQty, likelyLcd };
}

export function buildPartName(
  sourceName: string,
  partLabel: string,
  opts?: { qty?: number; radiatorMm?: number | null; shortLabel?: string; cableTypeLabel?: string }
): string {
  const stem = shortSourceStem(sourceName, opts?.radiatorMm);
  const short =
    opts?.shortLabel ||
    (partLabel === 'Radiator'
      ? 'Rad'
      : partLabel === 'Controller'
        ? 'Ctrl'
        : partLabel === 'Fans' || partLabel === 'Fan'
          ? 'Fans'
          : partLabel);

  if (short === 'Rad' && opts?.radiatorMm) {
    // Avoid "… 360 Rad 360"
    if (stem.includes(String(opts.radiatorMm))) return `${stem} Rad`;
    return `${stem} Rad ${opts.radiatorMm}`;
  }
  if (short === 'Fans') {
    const q = opts?.qty && opts.qty > 1 ? opts.qty : null;
    return q ? `${stem} Fans ×${q}` : `${stem} Fan`;
  }
  if (opts?.cableTypeLabel) {
    const q = opts?.qty && opts.qty > 1 ? opts.qty : null;
    // "Other" cable type's label already reads "Cable" — don't double it up.
    const label =
      opts.cableTypeLabel.toLowerCase() === 'cable' ? 'Cable' : `${opts.cableTypeLabel} Cable`;
    return q ? `${stem} ${label} ×${q}` : `${stem} ${label}`;
  }
  return `${stem} ${short}`;
}

export type SplitPartDraft = {
  key: string;
  presetId: SplitPartPresetId;
  label: string;
  name: string;
  buyPrice: number;
  weight: number;
  category: string;
  subCategory: string;
  /** Fans: stock quantity on the single child row. */
  quantity?: number;
  /** Per-part defective flag. */
  isDefective?: boolean;
  /** Manual override — skipped on next auto-allocate. */
  buyLocked?: boolean;
  /** User typed a custom name — cable type/qty changes stop regenerating it. */
  nameLocked?: boolean;
};

/** Weighted allocation in cents so sums match totalBuy exactly. */
export function allocateBuyAcrossParts(
  totalBuy: number,
  parts: Array<{ key: string; weight: number; buyLocked?: boolean; buyPrice?: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!parts.length) return out;

  const locked = parts.filter((p) => p.buyLocked);
  const free = parts.filter((p) => !p.buyLocked);
  let lockedCents = 0;
  for (const p of locked) {
    const c = Math.round((Number(p.buyPrice) || 0) * 100);
    out[p.key] = c / 100;
    lockedCents += c;
  }

  const totalCents = Math.round(Math.max(0, totalBuy) * 100);
  let remaining = Math.max(0, totalCents - lockedCents);

  if (!free.length) {
    if (locked.length && remaining !== 0) {
      const last = locked[locked.length - 1];
      out[last.key] = roundMoney(out[last.key] + remaining / 100);
    }
    return out;
  }

  if (remaining <= 0) {
    for (const p of free) out[p.key] = 0;
    return out;
  }

  const weights = free.map((p) => Math.max(p.weight, 0.5));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (remaining * w) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let diff = remaining - floors.reduce((a, b) => a + b, 0);
  const fracs = raw.map((x, i) => ({ i, f: x - floors[i] }));
  fracs.sort((a, b) => b.f - a.f);
  const cents = [...floors];
  for (let k = 0; k < diff; k++) cents[fracs[k % fracs.length].i] += 1;
  free.forEach((p, i) => {
    out[p.key] = cents[i] / 100;
  });
  return out;
}

export type SplitSelection = {
  enabled: Record<SplitPartPresetId, boolean>;
  fanQty: number;
  /** One row per cable type/qty — e.g. "2x SATA" and "1x 12VHPWR" as separate parts. */
  cables: CableLine[];
};

export function defaultSplitSelection(
  item: Pick<InventoryItem, 'name' | 'specs' | 'hasOVP' | 'category' | 'subCategory'>
): SplitSelection {
  const hints = detectAioHints(item.name || '', item.specs);
  const coolingish =
    hints.looksLikeAio ||
    item.subCategory === 'Cooling' ||
    item.category === 'Cooling' ||
    /cool|aio|wak[uü]|lüfter|fan/i.test(item.name || '');

  const enabled = {
    ovp: coolingish ? item.hasOVP === true : false,
    lcd: coolingish ? hints.likelyLcd : false,
    fans: coolingish,
    radiator: coolingish,
    controller: coolingish,
    cable: coolingish,
  } as Record<SplitPartPresetId, boolean>;

  if (coolingish && !hints.likelyLcd) {
    enabled.lcd = false;
  }

  return {
    enabled,
    fanQty: Math.min(6, Math.max(1, hints.defaultFanQty)),
    // Pre-load every cable type at qty 0 so the user only has to bump the ones actually
    // present instead of adding each type by hand — a 0-qty line is dropped entirely by
    // buildSplitDrafts, so unused types never turn into real inventory rows.
    cables: coolingish
      ? CABLE_TYPE_OPTIONS.map((opt, i) => ({ id: `c${i}`, type: opt.id, qty: 0 }))
      : [],
  };
}

export function buildSplitDrafts(
  source: Pick<
    InventoryItem,
    'name' | 'buyPrice' | 'specs' | 'hasOVP' | 'isDefective' | 'category' | 'subCategory'
  >,
  selection: SplitSelection,
  previous?: SplitPartDraft[]
): SplitPartDraft[] {
  const hints = detectAioHints(source.name || '', source.specs);
  const prevByKey = new Map((previous || []).map((d) => [d.key, d]));
  const drafts: SplitPartDraft[] = [];

  for (const preset of SPLIT_PART_PRESETS) {
    if (preset.id === 'cable') continue; // multi-line — handled separately below
    if (!selection.enabled[preset.id]) continue;

    if (preset.id === 'fans') {
      const qty = Math.min(6, Math.max(1, selection.fanQty || 1));
      const key = 'fans';
      const prev = prevByKey.get(key);
      drafts.push({
        key,
        presetId: 'fans',
        label: qty > 1 ? `Fans ×${qty}` : 'Fan',
        name:
          prev?.name ||
          buildPartName(source.name, 'Fans', {
            qty,
            radiatorMm: hints.radiatorMm,
            shortLabel: 'Fans',
          }),
        buyPrice: prev?.buyLocked ? prev.buyPrice : 0,
        // Scale fan weight with qty so 3 fans get a fairer share of cost.
        weight: preset.weight * qty,
        category: preset.category,
        subCategory: preset.subCategory,
        quantity: qty,
        isDefective: prev?.isDefective ?? false,
        buyLocked: prev?.buyLocked,
      });
      continue;
    }

    const key = preset.id;
    const prev = prevByKey.get(key);
    drafts.push({
      key,
      presetId: preset.id,
      label: preset.label,
      name:
        prev?.name ||
        buildPartName(source.name, preset.label, {
          radiatorMm: hints.radiatorMm,
          shortLabel: preset.shortLabel,
        }),
      buyPrice: prev?.buyLocked ? prev.buyPrice : 0,
      weight: preset.weight,
      category: preset.category,
      subCategory: preset.subCategory,
      isDefective: prev?.isDefective ?? false,
      buyLocked: prev?.buyLocked,
    });
  }

  if (selection.enabled.cable) {
    const cablePreset = SPLIT_PART_PRESETS.find((p) => p.id === 'cable')!;
    for (const line of selection.cables) {
      // Cable types are pre-loaded at qty 0 (see defaultSplitSelection) so the user only
      // has to bump the ones they actually have — a line left at 0 isn't "1 of them", it's
      // "none of these", so it never becomes a real draft/inventory row.
      if (!line.qty || line.qty <= 0) continue;
      const qty = Math.min(20, Math.max(1, line.qty));
      const key = `cable-${line.id}`;
      const prev = prevByKey.get(key);
      const typeLabel = cableTypeLabel(line.type);
      const cableLabel = typeLabel.toLowerCase() === 'cable' ? 'Cable' : `${typeLabel} Cable`;
      drafts.push({
        key,
        presetId: 'cable',
        label: qty > 1 ? `${cableLabel} ×${qty}` : cableLabel,
        // Keep regenerating the name as type/qty change — only a manual edit (nameLocked)
        // stops that, since the type picked is the whole point of this row.
        name:
          prev?.nameLocked && prev.name
            ? prev.name
            : buildPartName(source.name, 'Cable', { qty, cableTypeLabel: typeLabel }),
        // A cable is worth a small flat amount, not a weighted slice of the whole item —
        // default new lines to €1-3 and lock them so they're carved out of the total
        // instead of competing for a share of it (see the allocation step below).
        buyPrice: prev ? (prev.buyLocked ? prev.buyPrice : 0) : randomCableBuyPrice(),
        // Scale weight with qty so e.g. 4 SATA cables get a fairer share than 1 PCIe.
        weight: cablePreset.weight * qty,
        category: cablePreset.category,
        subCategory: cablePreset.subCategory,
        quantity: qty,
        isDefective: prev?.isDefective ?? false,
        buyLocked: prev ? prev.buyLocked : true,
        nameLocked: prev?.nameLocked,
      });
    }
  }

  // Cable (and any other manually-locked) parts carry a fixed value rather than a
  // weighted slice. If nothing else is selected to absorb the rest, a synthetic
  // "remainder" part — the original item under its own name — soaks up whatever's left,
  // so the parent container's buyPrice (always the sum of its parts, enforced by
  // syncContainerBuyTotalsFromComponents on every update) still reads correctly instead
  // of the small fixed values getting inflated back up to the full total.
  const hasFreeDraft = drafts.some((d) => d.presetId !== 'remainder' && !d.buyLocked);
  const hasRemainder = drafts.some((d) => d.presetId === 'remainder');
  if (drafts.length > 0 && !hasFreeDraft && !hasRemainder) {
    const prevRemainder = prevByKey.get('remainder');
    drafts.push({
      key: 'remainder',
      presetId: 'remainder',
      label: source.name,
      name: prevRemainder?.nameLocked && prevRemainder.name ? prevRemainder.name : source.name,
      buyPrice: 0,
      weight: 1,
      category: source.category || 'Components',
      subCategory: source.subCategory || '',
      isDefective: false,
      buyLocked: false,
      nameLocked: prevRemainder?.nameLocked,
    });
  }

  const buy = Number(source.buyPrice) || 0;
  const allocated = allocateBuyAcrossParts(
    buy,
    drafts.map((d) => ({
      key: d.key,
      weight: d.weight,
      buyLocked: d.buyLocked,
      buyPrice: d.buyPrice,
    }))
  );

  return drafts.map((d) => ({
    ...d,
    buyPrice: d.buyLocked ? roundMoney(d.buyPrice) : roundMoney(allocated[d.key] ?? 0),
  }));
}

/** In-stock items split into fresh un-sold parts; sold/traded/gifted items split into
 *  parts that inherit the same disposition (e.g. one combined sale later turns out to
 *  cover several separately-shipped items, each needing its own order link). */
export function canSplitItem(item: InventoryItem, childCount = 0): boolean {
  if (item.status !== ItemStatus.IN_STOCK && !isRealizedDisposal(item)) return false;
  if ((item.isPC || item.isBundle) && childCount > 0) return false;
  return true;
}

/** Clamp multi-buy lot size used in titles and identical splits. */
function clampLotQty(n: number): number | null {
  if (!Number.isFinite(n) || n < 2 || n > 48) return null;
  return Math.floor(n);
}

/**
 * Parse lot size from titles like "x8/SSD", "x8 Samsung", "8x Kingston", "SSD x8".
 * Prefer the canonical leading `xN/` form used by Add Asset.
 */
export function detectIdenticalQtyHint(name: string): number | null {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const leadingSlash = raw.match(/^x\s*(\d{1,2})\s*\//i);
  if (leadingSlash) return clampLotQty(Number(leadingSlash[1]));

  const leadingX = raw.match(/^x\s*(\d{1,2})(?:\s+|[-–—])/i);
  if (leadingX) return clampLotQty(Number(leadingX[1]));

  const leadingNx = raw.match(/^(\d{1,2})\s*[x×](?:\s*|\/)/i);
  if (leadingNx) return clampLotQty(Number(leadingNx[1]));

  const m =
    raw.match(/\b(\d{1,2})\s*[x×]\b/i) ||
    raw.match(/\b[x×]\s*(\d{1,2})\b/i) ||
    raw.match(/\b(\d{1,2})\s*pcs?\b/i) ||
    raw.match(/\b(\d{1,2})\s*stück\b/i);
  if (!m) return null;
  return clampLotQty(Number(m[1]));
}

/**
 * Strip lot multipliers from a title so children are plain unit names.
 * "x8/Samsung SSD" / "x8 Samsung SSD" / "8x Samsung SSD" / "Samsung SSD 8 pcs" → "Samsung SSD"
 */
/**
 * "32GB (2x16GB)" / "64GB (2x32GB)" style kit titles: the leading number is the
 * *total* capacity, not the per-stick one a split part should carry. Rewrite the
 * whole "TOTAL unit (Nx PART unit)" run to "PART unit (1x PART unit)" so a split
 * part reads e.g. "16GB (1x16GB)" instead of inheriting the kit's total capacity.
 */
function rewriteCapacityKitToUnit(name: string): string {
  return name.replace(
    /\b\d{1,3}(?:[.,]\d+)?\s*(TB|GB|MB)\s*\(\s*\d{1,2}\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)\s*(TB|GB|MB)?\s*\)/gi,
    (_match, totalUnit: string, partNum: string, partUnit?: string) => {
      const unit = partUnit || totalUnit;
      return `${partNum}${unit} (1x${partNum}${unit})`;
    }
  );
}

export function stripIdenticalQtyFromName(name: string): string {
  let out = String(name || '').trim();
  if (!out) return out;
  out = rewriteCapacityKitToUnit(out);
  out = out
    .replace(/^x\s*\d{1,2}\s*\//i, '')
    .replace(/^x\s*\d{1,2}(?:\s+|[-–—])/i, '')
    .replace(/^\d{1,2}\s*[x×]\s*\/?/i, '')
    // "2x16GB" / "(2x16 GB)" — multiplier glued directly to the capacity number, no
    // word boundary between the x and the digits that follow, so the two \b rules
    // below never fire on it. Strip just the "Nx" and keep the capacity number.
    // Excludes "1x" — that's the canonical single-unit marker rewriteCapacityKitToUnit
    // just inserted (e.g. "16GB (1x16GB)") and must survive this pass intact.
    .replace(/(^|[\s(])[2-9]\d?\s*[x×](?=\s*\d)/gi, '$1')
    .replace(/\b\d{1,2}\s*[x×]\b/gi, ' ')
    .replace(/\b[x×]\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s*pcs?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*stück\b/gi, ' ')
    // Per-stick working/faulty notes on the original mixed-condition lot no longer
    // apply once split — each part now carries its own faulty flag instead.
    .replace(/\(\s*\d\s*(?:work(?:ing)?|ok(?:ay)?)\s*[,;]?\s*\d\s*(?:faulty|defekt|defect)\s*\)/gi, '')
    .replace(/\(\s*\d\s*stick[s]?\s*(?:is\s*|are\s*)?(?:ok(?:ay)?|working|faulty|defekt)\s*\)/gi, '')
    .replace(/[_\-–—|/]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out || String(name || '').trim();
}

/**
 * Split parts are never visually distinguishable from each other once named the
 * same — this stamps an explicit "(Working)" / "(Faulty)" tag onto the title so
 * the condition survives at a glance (export, search, Excel) even without the
 * isDefective badge. Replaces any tag already present rather than stacking them.
 */
export function withConditionSuffix(name: string, isDefective: boolean): string {
  const base = String(name || '').replace(/\s*\((?:Working|Faulty)\)\s*$/i, '').trim();
  return `${base} (${isDefective ? 'Faulty' : 'Working'})`;
}

/**
 * Canonical multi-qty inventory title: `x8/Samsung SSD` when qty > 1.
 * Strips any existing multiplier first so qty edits stay clean.
 */
export function applyQtyNamePrefix(name: string, qty: number): string {
  const base = stripIdenticalQtyFromName(name);
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  if (n <= 1) return base;
  return base ? `x${n}/${base}` : `x${n}/`;
}

/** Best lot size from title and/or stored quantity field. */
export function resolveIdenticalLotQty(
  item: Pick<InventoryItem, 'name' | 'quantity'>
): number | null {
  const fromName = detectIdenticalQtyHint(item.name || '');
  if (fromName) return fromName;
  const q = Number(item.quantity);
  return clampLotQty(q);
}

export type SplitPriceMode = 'equal' | 'smart';

/** A faulty stick isn't worth as much as a working one — smart mode gives it a
 *  smaller share of the original buy price instead of splitting it dead even. */
export const DEFECTIVE_PART_WEIGHT = 0.5;

/**
 * N identical child drafts sharing a cleaned unit name; buy cost split equally by
 * default, or weighted down for defective parts when `priceMode` is 'smart'.
 */
export function buildIdenticalCopyDrafts(
  source: Pick<InventoryItem, 'name' | 'buyPrice' | 'category' | 'subCategory' | 'isDefective'>,
  qty: number,
  previous?: SplitPartDraft[],
  priceMode: SplitPriceMode = 'equal'
): SplitPartDraft[] {
  const count = Math.min(48, Math.max(2, Math.round(Number(qty) || 2)));
  const prevByKey = new Map((previous || []).map((d) => [d.key, d]));
  const baseName =
    stripIdenticalQtyFromName(String(source.name || '').trim()) ||
    String(source.name || '').trim() ||
    'Item';
  const drafts: SplitPartDraft[] = [];

  for (let i = 0; i < count; i++) {
    const key = `identical-${i}`;
    const prev = prevByKey.get(key);
    const isDefective = prev?.isDefective ?? Boolean(source.isDefective);
    drafts.push({
      key,
      presetId: 'identical',
      label: `#${i + 1}`,
      name: prev?.name || withConditionSuffix(baseName, isDefective),
      buyPrice: prev?.buyLocked ? prev.buyPrice : 0,
      weight: priceMode === 'smart' && isDefective ? DEFECTIVE_PART_WEIGHT : 1,
      category: source.category || 'Components',
      subCategory: source.subCategory || '',
      isDefective,
      buyLocked: prev?.buyLocked,
    });
  }

  const buy = Number(source.buyPrice) || 0;
  const allocated = allocateBuyAcrossParts(
    buy,
    drafts.map((d) => ({
      key: d.key,
      weight: d.weight,
      buyLocked: d.buyLocked,
      buyPrice: d.buyPrice,
    }))
  );

  return drafts.map((d) => ({
    ...d,
    buyPrice: d.buyLocked ? roundMoney(d.buyPrice) : roundMoney(allocated[d.key] ?? 0),
  }));
}

export type SplitApplyResult = {
  /** Null when standalone mode carved out every bit of the source's value — nothing of
   *  it is meant to survive, so the caller should delete the source rather than keep it. */
  parent: InventoryItem | null;
  children: InventoryItem[];
};

/** Divide a euro amount into N whole-cent shares that sum back exactly to the input. */
function splitEvenCents(total: number, count: number): number[] {
  const totalCents = Math.round(Math.max(0, total) * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const out = Array(count).fill(base) as number[];
  for (let i = 0; i < remainder; i++) out[i] += 1;
  return out.map((c) => c / 100);
}

/** Standalone mode: a cable/fans draft with quantity > 1 becomes N single-unit drafts
 *  instead of one row carrying a `quantity` field — e.g. "3x CPU Cable" reads as 3 actual
 *  standalone CPU Cable items in the inventory, the same way every other standalone part
 *  works, instead of a single row hiding a quantity of 3 inside it. */
function expandDraftsForStandalone(drafts: SplitPartDraft[]): SplitPartDraft[] {
  const out: SplitPartDraft[] = [];
  for (const d of drafts) {
    const qty = d.quantity && d.quantity > 1 ? d.quantity : 1;
    if ((d.presetId !== 'fans' && d.presetId !== 'cable') || qty <= 1) {
      out.push(d);
      continue;
    }
    const shares = splitEvenCents(d.buyPrice, qty);
    const unitName = d.name.replace(/\s*[x×]\s*\d+\s*$/i, '').trim() || d.name;
    for (let i = 0; i < qty; i++) {
      out.push({ ...d, key: `${d.key}-u${i}`, name: unitName, buyPrice: shares[i], quantity: undefined });
    }
  }
  return out;
}

/**
 * Convert source into a Bundle parent and create new child part rows — or, in standalone
 * mode, keep source as a normal item (just worth less) and create fully independent
 * sibling items instead of nesting them under it.
 */
export function buildSplitApplyItems(
  source: InventoryItem,
  drafts: SplitPartDraft[],
  allItems: InventoryItem[] = [],
  options?: { standalone?: boolean }
): SplitApplyResult {
  if (!drafts.length) {
    return { parent: source, children: [] };
  }
  const standalone = options?.standalone === true;

  const ts = Date.now();
  const sourceIsSold = isRealizedDisposal(source);
  // Sell price can't reuse the buy-price weighted allocator: with the remainder excluded,
  // a single extracted part is the *only* entry in that pool and would walk away with
  // 100% of the sale. Instead, prorate each extracted part's sell price by the same share
  // of the total it already got in buy price (a €2 part out of a €40 whole is worth ~5%
  // of the sale too) — the remainder gets whatever's left, same as buy price.
  const nonRemainderDrafts = drafts.filter((d) => d.presetId !== 'remainder');
  const remainderDraft = drafts.find((d) => d.presetId === 'remainder');
  // A remainder draft only ever appears when nothing but small fixed-value accessories
  // (currently: Cable) were selected — extracting a €3 cable doesn't turn the rest of a
  // PSU into a "bundle" with itself nested inside it as a same-named component. Treat
  // that case as standalone (source stays itself, cable(s) become their own new rows)
  // regardless of which As bundle/As standalone toggle is active.
  const effectiveStandalone = standalone || Boolean(remainderDraft);
  const totalBuyForSellRatio = Number(source.buyPrice) || 0;
  const totalSell = Number(source.sellPrice) || 0;
  const sellAllocated: Record<string, number> = {};
  if (sourceIsSold) {
    if (totalBuyForSellRatio > 0) {
      for (const d of nonRemainderDrafts) {
        sellAllocated[d.key] = roundMoney(totalSell * (Number(d.buyPrice) / totalBuyForSellRatio));
      }
    } else if (nonRemainderDrafts.length) {
      const evenShare = roundMoney(totalSell / nonRemainderDrafts.length);
      for (const d of nonRemainderDrafts) sellAllocated[d.key] = evenShare;
    }
  }
  const remainderSellPrice =
    sourceIsSold && remainderDraft
      ? roundMoney(
          Math.max(
            0,
            totalSell -
              roundMoney(nonRemainderDrafts.reduce((s, d) => s + (Number(sellAllocated[d.key]) || 0), 0))
          )
        )
      : undefined;

  // Standalone mode: the "remainder" draft isn't a real new item — its value just stays
  // on the source, which keeps being itself (not converted into a container) instead of
  // getting nested alongside the extracted parts.
  const extractedDrafts = effectiveStandalone ? nonRemainderDrafts : drafts;
  const mappedDrafts = effectiveStandalone ? expandDraftsForStandalone(extractedDrafts) : extractedDrafts;

  // Expansion replaces one draft key with several ("cable-c0" -> "cable-c0-u0/-u1/-u2"),
  // so a sold source's per-draft sell price (sellAllocated, keyed by the pre-expansion
  // draft) needs dividing again across those units the same way buyPrice already was.
  const unitSellPrice: Record<string, number> = {};
  if (sourceIsSold) {
    const byOrigKey = new Map<string, SplitPartDraft[]>();
    for (const d of mappedDrafts) {
      if (d.presetId === 'remainder') continue;
      const origKey = d.key.replace(/-u\d+$/, '');
      const list = byOrigKey.get(origKey) || [];
      list.push(d);
      byOrigKey.set(origKey, list);
    }
    for (const [origKey, group] of byOrigKey) {
      const shares = splitEvenCents(sellAllocated[origKey] ?? 0, group.length);
      group.forEach((d, i) => {
        unitSellPrice[d.key] = shares[i];
      });
    }
  }

  const children: InventoryItem[] = mappedDrafts.map((d, idx) => {
    const id = `split-${source.id}-${d.key}-${ts}-${idx}`;
    const siblings = extractedDrafts.map((part, partIdx) => ({
      id: `split-${source.id}-${part.key}-${ts}-${partIdx}`,
      name: part.name.trim() || buildPartName(source.name, part.label),
      allocatedEur: roundMoney(part.buyPrice),
      weight: part.weight,
      locked: Boolean(part.buyLocked),
    }));
    const kind = d.presetId === 'identical' ? 'split_identical' as const : 'split_parts' as const;
    let child: InventoryItem = {
      id,
      name: d.name.trim() || buildPartName(source.name, d.label),
      category: d.category,
      subCategory: d.subCategory,
      status: sourceIsSold ? source.status : ItemStatus.IN_COMPOSITION,
      buyPrice: roundMoney(d.buyPrice),
      buyDate: source.buyDate,
      comment1: `Split from ${source.name}`,
      comment2: '',
      parentContainerId: effectiveStandalone ? undefined : source.id,
      isSplitRemainder: d.presetId === 'remainder',
      vendor: source.vendor,
      presence: source.presence || 'present',
      isDefective: d.isDefective === true,
      // A sold source keeps its own buyer/order identity (ebayOrderId, customer,
      // saleProceeds, …) on the parent — new parts start with no order of their own so
      // each can be independently linked to a different order afterward, instead of
      // several items pointing at the same order.
      ...(sourceIsSold
        ? {
            sellDate: source.sellDate,
            sellPrice:
              d.presetId === 'remainder'
                ? roundMoney(remainderSellPrice ?? 0)
                : roundMoney(unitSellPrice[d.key] ?? 0),
            platformSold: source.platformSold,
            ...(source.paymentType ? { paymentType: source.paymentType } : {}),
          }
        : {}),
      costOrigin: buildCostOrigin({
        kind,
        addedAs: kind === 'split_identical'
          ? `Identical split ${idx + 1}/${extractedDrafts.length}`
          : `Split part (${d.label})`,
        bundleName: source.name,
        bundleId: source.id,
        sourceItemId: source.id,
        sourceItemName: source.name,
        bulkImportId: source.bulkImportId,
        lotTotalEur: Number(source.buyPrice) || 0,
        allocatedEur: roundMoney(d.buyPrice),
        allocationMethod: kind === 'split_identical' ? 'equal' : (d.buyLocked ? 'manual' : 'weighted'),
        allocationMode: kind === 'split_identical' ? 'EQUAL' : 'WEIGHTED',
        weight: d.weight,
        manualLocked: Boolean(d.buyLocked),
        siblings,
      }),
    };
    if ((d.presetId === 'fans' || d.presetId === 'cable') && d.quantity && d.quantity > 1) {
      child = { ...child, quantity: d.quantity };
    }
    if (d.presetId === 'ovp') child = { ...child, hasOVP: true };
    if (d.presetId === 'identical' && source.specs && Object.keys(source.specs).length) {
      child = { ...child, specs: { ...source.specs } };
    }
    if (d.presetId === 'identical') {
      child = {
        ...child,
        comment1: `Identical split ${idx + 1}/${extractedDrafts.length} from lot`,
        imageUrl: source.imageUrl,
        imageUrls: source.imageUrls ? [...source.imageUrls] : undefined,
        platformBought: source.platformBought,
        bulkImportId: source.bulkImportId,
      };
    }

    if (!sourceIsSold) {
      const sugg = resolveSuggestedEbayList(child, [...allItems, child], loadFlipFees(), []);
      if (sugg) {
        child = { ...child, ...suggestionPatchFromPrice(sugg) };
      }
    }
    return child;
  });

  if (effectiveStandalone) {
    if (!remainderDraft) {
      // No remainder draft means every bit of the source's value was carved into the new
      // standalone parts — there's nothing left for the source to be, so it's deleted
      // instead of lingering as a stale €0 row (e.g. splitting RAM sticks into standalone
      // Working/Faulty items shouldn't also leave the original kit behind, worthless).
      return { parent: null, children };
    }
    // A remainder draft exists (e.g. only Cable was selected) — the source keeps being
    // itself, just worth less, since only the extracted parts' value was carved out of it.
    const parent: InventoryItem = {
      ...source,
      buyPrice: roundMoney(remainderDraft.buyPrice),
      ...(sourceIsSold ? { sellPrice: roundMoney(remainderSellPrice ?? source.sellPrice ?? 0) } : {}),
    };
    return { parent, children };
  }

  const buyTotal = roundMoney(children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
  const anyDefective = children.some((c) => c.isDefective);
  const identical = drafts.every((d) => d.presetId === 'identical');
  const parent: InventoryItem = {
    ...source,
    isBundle: true,
    isPC: false,
    category: anyDefective || source.isDefective ? 'Mixed Bundle' : 'Bundle',
    status: sourceIsSold ? source.status : ItemStatus.IN_STOCK,
    buyPrice: buyTotal,
    componentIds: children.map((c) => c.id),
    splitOrigin: identical ? 'identical' : 'parts',
    comment1: identical
      ? `Split into ${children.length} identical items (equal buy share).`
      : `Split into ${children.length} parts from original item.`,
    comment2: children
      .map((c) => `- ${c.name}${c.isDefective ? ' [defekt]' : ''}`)
      .join('\n')
      .slice(0, 2000),
    marketTitle: source.marketTitle || source.name,
    vendor: source.vendor || (identical ? 'Identical Split' : 'Split Parts'),
  };
  if (identical) {
    delete (parent as { quantity?: number }).quantity;
  }
  delete (parent as { subCategory?: string }).subCategory;

  // A sold source's order/buyer identity (ebayOrderId, customer, saleProceeds, …) no
  // longer describes a single transaction once it's split into independently-sellable
  // parts — left in place, syncContainerSaleMetaToChildren (services/containerAggregates
  // consumers) would keep re-stamping every part with the same order, defeating the
  // whole point of splitting. Archive it into ebaySaleCycles (recoverable) and clear it
  // from the parent; sellPrice/sellDate/platformSold stay since those remain true facts
  // about the container total.
  let finalParent = parent;
  if (sourceIsSold && itemHasActiveSaleSnapshot(source)) {
    const cycle = snapshotSaleCycle(source, 'manual_unsold', { buyPriceAtClose: source.buyPrice });
    finalParent = {
      ...parent,
      ebaySaleCycles: [...(parent.ebaySaleCycles || []), cycle],
      ebayOrderId: undefined,
      ebayOrderLineKey: undefined,
      ebayUsername: undefined,
      ebayListingId: undefined,
      ebaySku: undefined,
      kleinanzeigenChatUrl: undefined,
      customer: undefined,
      saleProceeds: undefined,
      ebaySaleAdjustments: undefined,
      feeAmount: undefined,
      hasFee: false,
      sellerPaidShipping: false,
      sellerShippingAmount: undefined,
      invoiceNumber: undefined,
      externalOrderId: undefined,
      sourceOrderUrl: undefined,
      ebayOrderScreenshotUrl: undefined,
      originalSellPrice: undefined,
    };
  }

  return { parent: finalParent, children };
}
