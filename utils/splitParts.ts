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

export type SplitPartPresetId =
  | 'ovp'
  | 'lcd'
  | 'fans'
  | 'radiator'
  | 'controller'
  | 'cable';

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
  let s = (sourceName || '').trim();
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
  opts?: { fanQty?: number; radiatorMm?: number | null; shortLabel?: string }
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
    const q = opts?.fanQty && opts.fanQty > 1 ? opts.fanQty : null;
    return q ? `${stem} Fans ×${q}` : `${stem} Fan`;
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
  };
}

export function buildSplitDrafts(
  source: Pick<InventoryItem, 'name' | 'buyPrice' | 'specs' | 'hasOVP' | 'isDefective'>,
  selection: SplitSelection,
  previous?: SplitPartDraft[]
): SplitPartDraft[] {
  const hints = detectAioHints(source.name || '', source.specs);
  const prevByKey = new Map((previous || []).map((d) => [d.key, d]));
  const drafts: SplitPartDraft[] = [];

  for (const preset of SPLIT_PART_PRESETS) {
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
            fanQty: qty,
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

export function canSplitItem(item: InventoryItem, childCount = 0): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if ((item.isPC || item.isBundle) && childCount > 0) return false;
  return true;
}

export type SplitApplyResult = {
  parent: InventoryItem;
  children: InventoryItem[];
};

/**
 * Convert source into a Bundle parent and create new child part rows.
 */
export function buildSplitApplyItems(
  source: InventoryItem,
  drafts: SplitPartDraft[],
  allItems: InventoryItem[] = []
): SplitApplyResult {
  if (!drafts.length) {
    return { parent: source, children: [] };
  }

  const ts = Date.now();
  const children: InventoryItem[] = drafts.map((d, idx) => {
    const id = `split-${source.id}-${d.key}-${ts}-${idx}`;
    let child: InventoryItem = {
      id,
      name: d.name.trim() || buildPartName(source.name, d.label),
      category: d.category,
      subCategory: d.subCategory,
      status: ItemStatus.IN_COMPOSITION,
      buyPrice: roundMoney(d.buyPrice),
      buyDate: source.buyDate,
      comment1: `Split from ${source.name}`,
      comment2: '',
      parentContainerId: source.id,
      vendor: source.vendor,
      presence: source.presence || 'present',
      isDefective: d.isDefective === true,
    };
    if (d.presetId === 'fans' && d.quantity && d.quantity > 1) {
      child = { ...child, quantity: d.quantity };
    }
    if (d.presetId === 'ovp') child = { ...child, hasOVP: true };

    const sugg = resolveSuggestedEbayList(child, [...allItems, child], loadFlipFees(), []);
    if (sugg) {
      child = { ...child, ...suggestionPatchFromPrice(sugg) };
    }
    return child;
  });

  const buyTotal = roundMoney(children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
  const anyDefective = children.some((c) => c.isDefective);
  const parent: InventoryItem = {
    ...source,
    isBundle: true,
    isPC: false,
    category: anyDefective || source.isDefective ? 'Mixed Bundle' : 'Bundle',
    status: ItemStatus.IN_STOCK,
    buyPrice: buyTotal,
    componentIds: children.map((c) => c.id),
    comment1: `Split into ${children.length} parts from original item.`,
    comment2: children
      .map((c) => `- ${c.name}${c.isDefective ? ' [defekt]' : ''}`)
      .join('\n')
      .slice(0, 2000),
    marketTitle: source.marketTitle || source.name,
    vendor: source.vendor || 'Split Parts',
  };
  delete (parent as { subCategory?: string }).subCategory;

  return { parent, children };
}
