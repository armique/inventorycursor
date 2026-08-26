import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  allocateBuyAcrossParts,
  applyQtyNamePrefix,
  buildIdenticalCopyDrafts,
  buildPartName,
  buildSplitApplyItems,
  buildSplitDrafts,
  canSplitItem,
  defaultSplitSelection,
  detectAioHints,
  detectIdenticalQtyHint,
  resolveIdenticalLotQty,
  shortSourceStem,
  stripIdenticalQtyFromName,
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
    expect(buildPartName('Corsair H100i RGB Platinum 240', 'Fans', { qty: 2 })).toMatch(
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

  it('splits identical copies with equal buy prices', () => {
    const source: InventoryItem = {
      id: 'lot-ssd',
      name: '8x Kingston NV2 1TB SSD',
      buyPrice: 200,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'Storage (SSD/HDD)',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    expect(detectIdenticalQtyHint(source.name)).toBe(8);
    expect(detectIdenticalQtyHint('x8/Samsung SSD')).toBe(8);
    expect(detectIdenticalQtyHint('x7/Arctic P12')).toBe(7);
    expect(stripIdenticalQtyFromName('x8 Samsung SSD')).toBe('Samsung SSD');
    expect(stripIdenticalQtyFromName('x8/Samsung SSD')).toBe('Samsung SSD');
    expect(stripIdenticalQtyFromName('8x Samsung SSD')).toBe('Samsung SSD');
    expect(stripIdenticalQtyFromName('Samsung SSD x8')).toBe('Samsung SSD');
    expect(applyQtyNamePrefix('Samsung SSD', 8)).toBe('x8/Samsung SSD');
    expect(applyQtyNamePrefix('x8/Samsung SSD', 1)).toBe('Samsung SSD');
    expect(applyQtyNamePrefix('x8/Samsung SSD', 7)).toBe('x7/Samsung SSD');
    expect(resolveIdenticalLotQty({ name: 'Samsung SSD', quantity: 8 })).toBe(8);
    expect(resolveIdenticalLotQty({ name: 'x8/Samsung SSD', quantity: 3 })).toBe(8);
    const drafts = buildIdenticalCopyDrafts({ ...source, name: 'x8/Kingston NV2 1TB SSD' }, 8);
    expect(drafts).toHaveLength(8);
    expect(drafts.every((d) => d.name === 'Kingston NV2 1TB SSD')).toBe(true);
    const sum = drafts.reduce((s, d) => s + d.buyPrice, 0);
    expect(Math.round(sum * 100) / 100).toBe(200);
    expect(drafts.every((d) => d.buyPrice === 25)).toBe(true);

    const { parent, children } = buildSplitApplyItems(
      { ...source, name: 'x8/Kingston NV2 1TB SSD', quantity: 8 },
      drafts
    );
    expect(parent?.isBundle).toBe(true);
    expect(parent?.quantity).toBeUndefined();
    expect(children).toHaveLength(8);
    expect(children.every((c) => c.buyPrice === 25)).toBe(true);
    expect(children.every((c) => c.name === 'Kingston NV2 1TB SSD')).toBe(true);
    expect(Number(parent?.buyPrice)).toBe(200);
  });

  it('standalone identical split deletes the source instead of leaving a €0 husk', () => {
    const source: InventoryItem = {
      id: 'ram-1',
      name: '2x16GB Corsair Vengeance DDR4',
      buyPrice: 40,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'RAM',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    const drafts = buildIdenticalCopyDrafts(source, 2);
    const { parent, children } = buildSplitApplyItems(source, drafts, [], { standalone: true });
    expect(parent).toBeNull();
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.parentContainerId === undefined)).toBe(true);
    expect(Number(children.reduce((s, c) => s + c.buyPrice, 0))).toBe(40);
  });

  it('cable-only split never wraps into a bundle and never nests a same-named remainder', () => {
    const source: InventoryItem = {
      id: 'psu-1',
      name: 'Corsair RM850x PSU',
      buyPrice: 60,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'PSU',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    const sel = defaultSplitSelection(source);
    sel.enabled.cable = true;
    sel.cables = [{ id: 'c0', type: 'cpu', qty: 1 }];
    const drafts = buildSplitDrafts(source, sel);
    // Even with the "As bundle" toggle (the default), a cable-only extraction should not
    // wrap the PSU in a Bundle or create a remainder child named after the PSU itself.
    const { parent, children } = buildSplitApplyItems(source, drafts, [], { standalone: false });
    expect(parent?.isBundle).toBeFalsy();
    expect(parent?.id).toBe(source.id);
    expect(children).toHaveLength(1);
    expect(children.some((c) => c.name === source.name)).toBe(false);
    expect(children.every((c) => c.parentContainerId === undefined)).toBe(true);
  });

  it('standalone mode expands a multi-qty cable line into N separate single items', () => {
    const source: InventoryItem = {
      id: 'psu-2',
      name: 'Corsair RM850x PSU',
      buyPrice: 60,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'PSU',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    const sel = defaultSplitSelection(source);
    sel.enabled.cable = true;
    sel.cables = [{ id: 'c0', type: 'cpu', qty: 3 }];
    const drafts = buildSplitDrafts(source, sel);
    const { children } = buildSplitApplyItems(source, drafts, [], { standalone: true });
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.quantity == null)).toBe(true);
    expect(children.every((c) => c.name.includes('CPU'))).toBe(true);
  });

  it('a zero-qty cable line is dropped and never becomes a draft', () => {
    const source: InventoryItem = {
      id: 'aio-2',
      name: 'NZXT Kraken 240 RGB',
      buyPrice: 60,
      buyDate: '2026-01-01',
      category: 'Components',
      subCategory: 'Cooling',
      status: ItemStatus.IN_STOCK,
      comment1: '',
      comment2: '',
    };
    // defaultSplitSelection pre-loads every cable type at qty 0 for cooling-ish items —
    // the user only has to bump the ones actually present.
    const sel = defaultSplitSelection(source);
    expect(sel.cables.length).toBeGreaterThan(1);
    expect(sel.cables.every((c) => c.qty === 0)).toBe(true);
    const drafts = buildSplitDrafts(source, sel);
    expect(drafts.filter((d) => d.presetId === 'cable')).toHaveLength(0);
  });
});
