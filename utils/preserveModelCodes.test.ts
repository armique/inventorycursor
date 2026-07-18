import { describe, expect, it } from 'vitest';
import { ensureModelCodesInName, extractProductModelCodes } from './preserveModelCodes';

describe('preserveModelCodes', () => {
  it('extracts Corsair LPX part number', () => {
    expect(extractProductModelCodes('CMK8GX4M1A2400C14')).toEqual(['CMK8GX4M1A2400C14']);
  });

  it('extracts Kingston P/N with -8X suffix', () => {
    expect(extractProductModelCodes('Kingston ACR24D4U1S1ME-8X 8GB DDR4')).toEqual([
      'ACR24D4U1S1ME-8X',
    ]);
  });

  it('appends missing model code to AI marketing name', () => {
    expect(
      ensureModelCodesInName(
        'CMK8GX4M1A2400C14',
        'Corsair Vengeance LPX 8GB DDR4 2400MHz C14'
      )
    ).toBe('Corsair Vengeance LPX 8GB DDR4 2400MHz C14 CMK8GX4M1A2400C14');
  });

  it('does not duplicate model code already present', () => {
    expect(
      ensureModelCodesInName(
        'CMK8GX4M1A2400C14',
        'Corsair Vengeance LPX CMK8GX4M1A2400C14 8GB DDR4 2400MHz'
      )
    ).toBe('Corsair Vengeance LPX CMK8GX4M1A2400C14 8GB DDR4 2400MHz');
  });

  it('keeps original when AI returns empty', () => {
    expect(ensureModelCodesInName('CMK8GX4M1A2400C14', '')).toBe('CMK8GX4M1A2400C14');
  });

  it('does not treat capacity/speed tokens as model codes', () => {
    expect(extractProductModelCodes('Samsung 8GB DDR4 2400MHz')).toEqual([]);
  });
});
