import { describe, expect, it } from 'vitest';
import {
  buildRamKitSpecs,
  extractRamKitInfo,
  formatRamKitDisplayName,
  parseBulkLineQuantityAndName,
  resolveRamInventoryQuantity,
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

  it('corrects AI-style quantity=module count to one kit', () => {
    const kit = { modules: 2, gbPerStick: 8 };
    expect(resolveRamInventoryQuantity(2, kit, 1)).toBe(1);
    expect(resolveRamInventoryQuantity(3, kit, 3)).toBe(3);
  });
});
