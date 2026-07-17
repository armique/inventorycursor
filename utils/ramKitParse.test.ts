import { describe, expect, it } from 'vitest';
import {
  buildRamKitSpecs,
  extractRamKitInfo,
  formatRamKitDisplayName,
  parseBulkLineQuantityAndName,
  resolveRamInventoryQuantity,
  resolveRamKitInfo,
} from './ramKitParse';

describe('ramKitParse', () => {
  it('parses embedded kit size from crucial 2x8gb', () => {
    expect(extractRamKitInfo('crucial 2x8gb')).toEqual({ modules: 2, gbPerStick: 8 });
  });

  it('does not treat leading 2x8GB as purchase quantity', () => {
    expect(parseBulkLineQuantityAndName('2x8GB Crucial')).toEqual({
      name: '2x8GB Crucial',
      quantity: 1,
    });
  });

  it('parses purchase quantity before kit name', () => {
    expect(parseBulkLineQuantityAndName('3x Crucial 2x8GB')).toEqual({
      name: 'Crucial 2x8GB',
      quantity: 3,
    });
  });

  it('builds essential RAM spec fields', () => {
    expect(buildRamKitSpecs({ modules: 2, gbPerStick: 8 })).toEqual({
      Modules: '2',
      'GB per Stick': '8GB',
      'Kit Capacity': '16GB',
    });
  });

  it('formats display name with brand, kit total, module breakdown, and DDR type', () => {
    const kit = extractRamKitInfo('2×8GB Crucial DDR4');
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('2×8GB Crucial DDR4', kit!)).toBe('Crucial 16GB (2x8GB) DDR4 RAM');
  });

  it('formats name when kit pattern is in the middle', () => {
    const kit = extractRamKitInfo('crucial 2x8gb');
    expect(formatRamKitDisplayName('crucial 2x8gb', kit!)).toBe('Crucial 16GB (2x8GB) RAM');
  });

  it('resolves kit from original source line when AI simplified the name', () => {
    const kit = resolveRamKitInfo('Crucial DDR4', { sourceLine: '2x8GB Crucial DDR4' });
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('2x8GB Crucial DDR4', kit!)).toBe('Crucial 16GB (2x8GB) DDR4 RAM');
  });

  it('does not treat leading purchase 2x 8GB as a kit via sourceLine', () => {
    expect(
      resolveRamKitInfo('8GB Samsung 2400 MHz', {
        sourceLine: '2x 8GB Samsung 2400 MHz',
      })
    ).toBeNull();
  });

  it('resolves kit from AI specs when name and line lack kit pattern', () => {
    const kit = resolveRamKitInfo('Ballistix DDR4', {
      specs: { Modules: '2', 'GB per Stick': '8GB', 'Kit Capacity': '16GB' },
    });
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('Ballistix DDR4', kit!)).toBe('Ballistix 16GB (2x8GB) DDR4 RAM');
  });

  it('corrects AI-style quantity=module count to one kit', () => {
    const kit = { modules: 2, gbPerStick: 8 };
    expect(resolveRamInventoryQuantity(2, kit, 1)).toBe(1);
    expect(resolveRamInventoryQuantity(3, kit, 3)).toBe(3);
  });

  it('does not treat model suffix -8X before 8GB as an 8x8GB kit', () => {
    expect(extractRamKitInfo('Kingston ACR24D4U1S1ME-8X 8GB DDR4 2133MHz')).toBeNull();
    expect(extractRamKitInfo('Kingston ACRE2D4U251ME-8X 8GB DDR4 2666MHz')).toBeNull();
    expect(
      resolveRamKitInfo('Kingston ACR24D4U1S1ME-8X 8GB DDR4', {
        sourceLine: '2x Kingston ACR24D4U1S1ME-8X 8GB DDR4 2133MHz (1 working, 1 defekt)',
      })
    ).toBeNull();
  });

  it('treats spaced 2x 8GB as purchase qty, not a kit line', () => {
    expect(parseBulkLineQuantityAndName('2x 8GB Samsung 2400 MHz')).toEqual({
      name: '8GB Samsung 2400 MHz',
      quantity: 2,
    });
    expect(extractRamKitInfo('8GB Samsung 2400 MHz')).toBeNull();
  });

  it('still recognizes glued 2x8GB kit prefix and mid-name kits', () => {
    expect(parseBulkLineQuantityAndName('2x8GB Crucial DDR4')).toEqual({
      name: '2x8GB Crucial DDR4',
      quantity: 1,
    });
    expect(extractRamKitInfo('Crucial 2x8GB DDR4')).toEqual({ modules: 2, gbPerStick: 8 });
  });
});
