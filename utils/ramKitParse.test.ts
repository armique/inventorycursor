import { describe, expect, it } from 'vitest';
import {
  buildRamKitSpecs,
  extractRamKitInfo,
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

  it('corrects AI-style quantity=module count to one kit', () => {
    const kit = { modules: 2, gbPerStick: 8 };
    expect(resolveRamInventoryQuantity(2, kit, 1)).toBe(1);
    expect(resolveRamInventoryQuantity(3, kit, 3)).toBe(3);
  });
});
