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
} from './splitParts';

describe('splitParts', () => {
  it('detects AIO size and fan defaults', () => {
    const hints = detectAioHints('Arctic Liquid Freezer II 360');
    expect(hints.looksLikeAio).toBe(true);
    expect(hints.radiatorMm).toBe(360);
    expect(hints.defaultFanQty).toBe(3);
  });

  it('builds part names with radiator size and fan index', () => {
    expect(buildPartName('Arctic LF II 360', 'Radiator', { radiatorMm: 360 })).toBe(
      'Arctic LF II 360 · Radiator 360mm'
    );
    expect(
      buildPartName('Arctic LF II 360', 'Fans', { fanIndex: 2, fanTotal: 3 })
    ).toBe('Arctic LF II 360 · Fan 2/3');
  });

  it('allocates buy cost exactly across weights', () => {
    const alloc = allocateBuyAcrossParts(61.7, [
      { key: 'lcd', weight: 30 },
      { key: 'radiator', weight: 25 },
      { key: 'fans-1', weight: 10 },
      { key: 'fans-2', weight: 10 },
      { key: 'fans-3', weight: 10 },
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

  it('builds drafts and apply payload converting source to bundle parent', () => {
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
    sel.enabled.cable = true;
    sel.enabled.lcd = false;
    const drafts = buildSplitDrafts(source, sel);
    expect(drafts.length).toBeGreaterThan(0);
    const sum = drafts.reduce((s, d) => s + d.buyPrice, 0);
    expect(Math.round(sum * 100) / 100).toBe(50);

    const { parent, children } = buildSplitApplyItems(source, drafts);
    expect(parent.isBundle).toBe(true);
    expect(parent.id).toBe('aio-1');
    expect(parent.componentIds).toHaveLength(children.length);
    expect(children.every((c) => c.status === ItemStatus.IN_COMPOSITION)).toBe(true);
    expect(children.every((c) => c.parentContainerId === 'aio-1')).toBe(true);
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
