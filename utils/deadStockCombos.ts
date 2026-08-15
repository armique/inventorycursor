import { ItemStatus, type InventoryItem } from '../types';
import { cheapSuggestLists } from './listingWatch';
import { itemAgeDays } from './sellToday';
import { roundMoney } from '../services/financialAggregation';

export type DeadStockCombo = {
  id: string;
  items: InventoryItem[];
  days: number[];
  lockedEuro: number;
  separateKa: number;
  bundleKa: number;
  liftNote: string;
};

const PAIRS: Array<[RegExp, RegExp, string]> = [
  [/graphic|gpu|vga/i, /cooler|cooling|case|3d printed|misc/i, 'GPU + mount / cooler'],
  [/processor|cpu/i, /motherboard|mainboard/i, 'CPU + board'],
  [/motherboard|mainboard/i, /ram|memory/i, 'Board + RAM'],
  [/power suppl|psu|netzteil/i, /case|gehäuse/i, 'PSU + case'],
  [/case|gehäuse/i, /cooler|cooling|kühler/i, 'Case + cooler'],
];

function bucket(item: InventoryItem): string {
  return `${item.category} ${item.subCategory || ''}`;
}

function sittingParts(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => {
    if (item.status !== ItemStatus.IN_STOCK) return false;
    if (item.isDraft || item.isDefective || item.reserved) return false;
    if (item.isPC || item.isBundle || item.parentContainerId) return false;
    return itemAgeDays(item) >= 14;
  });
}

export function suggestDeadStockCombos(items: InventoryItem[], limit = 4): DeadStockCombo[] {
  const pool = sittingParts(items).sort((a, b) => itemAgeDays(b) - itemAgeDays(a));
  const used = new Set<string>();
  const out: DeadStockCombo[] = [];

  for (const [aRe, bRe, label] of PAIRS) {
    if (out.length >= limit) break;
    const a = pool.find((i) => !used.has(i.id) && aRe.test(bucket(i)));
    const b = pool.find((i) => !used.has(i.id) && i.id !== a?.id && bRe.test(bucket(i)));
    if (!a || !b) continue;
    used.add(a.id);
    used.add(b.id);
    const pair = [a, b];
    const days = pair.map((i) => itemAgeDays(i));
    const lockedEuro = roundMoney(pair.reduce((s, i) => s + (Number(i.buyPrice) || 0), 0));
    const separateKa = roundMoney(
      pair.reduce((s, i) => s + (cheapSuggestLists(i, items)?.klein || Number(i.sellPrice) || 0), 0),
    );
    const bundleKa = roundMoney(separateKa * 0.95);
    out.push({
      id: `${a.id}+${b.id}`,
      items: pair,
      days,
      lockedEuro,
      separateKa,
      bundleKa,
      liftNote: `${label} · sat ${days[0]}d + ${days[1]}d · €${lockedEuro.toFixed(0)} locked`,
    });
  }

  return out;
}
