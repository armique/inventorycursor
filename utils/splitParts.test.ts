import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  allocateBuyAcrossParts,
  buildPartName,
  buildSplitApplyItems,
  buildSplitDrafts,
  canSplitItem,
  defaultSplitSelection,
  detectAioHints,
  shortSourceStem,
} from './splitParts';

describe('splitParts', () => {
  it('detects AIO size and fan defaults', () => {
    const hints = detectAioHints('Arctic Liquid Freezer II 360');
    expect(hints.looksLikeAio).toBe(true);
    expect(hints.radiatorMm).toBe(360);
    expect(hints.defaultFanQty).toBe(3);
  });

  it('builds short part names from brand + size', () => {
    expect(shortSourceStem('Arctic Liquid Freezer II 360 AIO RGB', 360)).toMatch(/Arctic/i);
    expect(shortSourceStem('Arctic Liquid Freezer II 360 AIO RGB', 360)).toMatch(/360/);
    expect(buildPartName('Arctic Liquid Freezer II 360', 'Radiator', { radiatorMm: 360 })).toBe(
      'Arctic LF II 360 Rad'
    );
    expect(buildPartName('Corsair H100i RGB Platinum 240', 'Fans', { fanQty: 2 })).toMatch(
      /Fans ×2$/
    );
    expect(buildPartName('NZXT Kraken 240', 'OVP', { shortLabel: 'OVP' })).toMatch(/OVP$/);
  });

  it('allocates buy cost exactly across weights', () => {
    const alloc = allocateBuyAcrossParts(61.7, [
      { key: 'lcd', weight: 30 },
      { key: 'radiator', weight: 25 },
      { key: 'fans', weight: 30 },
      { key: 'cable', weight: 5 },
    ]);
    const sum = Object.values(alloc).reduce((s, n) => s + n, 0);
    expect(Math.round(sum * 100) / 100).toBe(61.7);
    expect(alloc.lcd).toBeGreaterThan(alloc.cable);
  });

  it('pre-checks cooling presets for AIO-like items', () => {
    const sel = defaultSplitSelection({
      name: 'NZXT Kraken 240 RGB',
      buyPrice: 40,
      category: 'Components',
      subCategory: 'Cooling',
      hasOVP: true,
    } as InventoryItem);
    expect(sel.enabled.radiator).toBe(true);
    expect(sel.enabled.fans).toBe(true);
    expect(sel.enabled.ovp).toBe(true);
    expect(sel.fanQty).toBe(2);
  });

  it('creates a single fans row with quantity and respects faulty flag', () => {
    const source: InventoryItem = {
      id: 'aio-1',
      name: 'Corsair H100i 240',
      buyPrice: 50,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'Cooling',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    const sel = defaultSplitSelection(source);
    sel.enabled.controller = false;
    sel.enabled.cable = false;
    sel.enabled.lcd = false;
    sel.enabled.ovp = false;
    sel.enabled.radiator = true;
    sel.enabled.fans = true;
    sel.fanQty = 2;
    const drafts = buildSplitDrafts(source, sel);
    const fans = drafts.find((d) => d.presetId === 'fans');
    expect(fans).toBeTruthy();
    expect(fans!.quantity).toBe(2);
    expect(drafts.filter((d) => d.presetId === 'fans')).toHaveLength(1);
    expect(fans!.name).toMatch(/Fans ×2/);

    fans!.isDefective = true;
    const { parent, children } = buildSplitApplyItems(source, drafts);
    expect(parent.isBundle).toBe(true);
    const fanChild = children.find((c) => c.quantity === 2);
    expect(fanChild).toBeTruthy();
    expect(fanChild!.isDefective).toBe(true);
    expect(children.some((c) => c.name.includes('Rad'))).toBe(true);
  });

  it('canSplitItem blocks populated containers', () => {
    const stock: InventoryItem = {
      id: '1',
      name: 'AIO',
      buyPrice: 10,
      buyDate: '2026-01-01',
      category: 'Components',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    expect(canSplitItem(stock, 0)).toBe(true);
    expect(canSplitItem({ ...stock, isBundle: true }, 3)).toBe(false);
    expect(canSplitItem({ ...stock, status: ItemStatus.SOLD }, 0)).toBe(false);
  });
});
