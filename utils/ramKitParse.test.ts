import { describe, expect, it } from 'vitest';
import {
  buildRamKitSpecs,
  buildStrictRamStandardizedName,
  enrichRamSpecsFromText,
  extractRamKitInfo,
  extractRamSpeedMHz,
  formatRamKitDisplayName,
  formatRamStickDisplayName,
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

  it('includes Speed and Memory Type in kit specs when source text has them', () => {
    expect(
      buildRamKitSpecs(
        { modules: 2, gbPerStick: 8 },
        { sourceText: 'Crucial 2x8GB DDR4 3200MHz' }
      )
    ).toEqual({
      Modules: '2',
      'GB per Stick': '8GB',
      'Kit Capacity': '16GB',
      'Memory Type': 'DDR4',
      Speed: '3200MHz',
    });
  });

  it('formats display name with brand, kit total, module breakdown, and DDR type', () => {
    const kit = extractRamKitInfo('2×8GB Crucial DDR4');
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('2×8GB Crucial DDR4', kit!)).toBe('Crucial 16GB (2x8GB) DDR4');
  });

  it('formats name when kit pattern is in the middle', () => {
    const kit = extractRamKitInfo('crucial 2x8gb');
    expect(formatRamKitDisplayName('crucial 2x8gb', kit!)).toBe('Crucial 16GB (2x8GB) RAM');
  });

  it('formats kit name with speed when present', () => {
    const kit = extractRamKitInfo('Crucial 2x8GB DDR4 3200MHz');
    expect(formatRamKitDisplayName('Crucial 2x8GB DDR4 3200MHz', kit!)).toBe(
      'Crucial 16GB (2x8GB) DDR4 3200MHz'
    );
  });

  it('formats kit name from DDR4-2666 rating', () => {
    const kit = extractRamKitInfo('Kingston 2x8GB DDR4-2666');
    expect(formatRamKitDisplayName('Kingston 2x8GB DDR4-2666', kit!)).toBe(
      'Kingston 16GB (2x8GB) DDR4 2666MHz'
    );
  });

  it('resolves kit from original source line when AI simplified the name', () => {
    const kit = resolveRamKitInfo('Crucial DDR4', { sourceLine: '2x8GB Crucial DDR4' });
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('2x8GB Crucial DDR4', kit!)).toBe('Crucial 16GB (2x8GB) DDR4');
  });

  it('does not treat leading purchase 2x 8GB as a kit via sourceLine', () => {
    expect(
      resolveRamKitInfo('8GB Samsung 2400 MHz', {
        sourceLine: '2x 8GB Samsung 2400 MHz',
      })
    ).toBeNull();
  });

  it('formats single-stick name with speed from purchase line', () => {
    expect(
      formatRamStickDisplayName('8GB Samsung 2400 MHz', {
        sourceLine: '2x 8GB Samsung 2400 MHz',
      })
    ).toBe('Samsung 8GB 2400MHz RAM');
  });

  it('formats single-stick name with DDR and speed', () => {
    expect(formatRamStickDisplayName('Samsung 8GB DDR4 2400 MHz')).toBe('Samsung 8GB DDR4 2400MHz');
  });

  it('resolves kit from AI specs when name and line lack kit pattern', () => {
    const kit = resolveRamKitInfo('Ballistix DDR4', {
      specs: { Modules: '2', 'GB per Stick': '8GB', 'Kit Capacity': '16GB' },
    });
    expect(kit).toEqual({ modules: 2, gbPerStick: 8 });
    expect(formatRamKitDisplayName('Ballistix DDR4', kit!)).toBe('Ballistix 16GB (2x8GB) DDR4');
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

  it('extracts speed from MHz, MT/s, DDR-rated, and PC4 transfer rates', () => {
    expect(extractRamSpeedMHz('3200MHz')).toBe(3200);
    expect(extractRamSpeedMHz('2400 MHz')).toBe(2400);
    expect(extractRamSpeedMHz('2666 MT/s')).toBe(2666);
    expect(extractRamSpeedMHz('DDR4-3200')).toBe(3200);
    expect(extractRamSpeedMHz('PC4-25600')).toBe(3200);
    expect(extractRamSpeedMHz('Crucial 16GB DDR4')).toBeNull();
  });

  it('enriches specs with Speed from text without inventing it', () => {
    expect(enrichRamSpecsFromText({}, 'Crucial 2x8GB DDR4 3200MHz')).toEqual({
      'Memory Type': 'DDR4',
      Speed: '3200MHz',
    });
    expect(enrichRamSpecsFromText({ Modules: '2' }, 'Crucial 2x8GB')).toEqual({
      Modules: '2',
    });
  });

  it('builds strict standardized name from AI specs and rejects marketing rename input', () => {
    expect(
      buildStrictRamStandardizedName('Ballistix Sport LT Amazing Kit', {
        Modules: '2',
        'GB per Stick': '8GB',
        'Kit Capacity': '16GB',
        'Memory Type': 'DDR4',
        Speed: '2400MHz',
      }, 'Components / RAM')
    ).toBe('Ballistix 16GB (2x8GB) DDR4 2400MHz');
  });

  it('keeps Corsair part number when building a strict name from SKU-only input', () => {
    expect(
      buildStrictRamStandardizedName(
        'CMK8GX4M1A2400C14',
        {
          'GB per Stick': '8GB',
          'Memory Type': 'DDR4',
          Speed: '2400MHz',
        },
        'Components / RAM'
      )
    ).toBe('Corsair 8GB DDR4 2400MHz CMK8GX4M1A2400C14');
  });
});
