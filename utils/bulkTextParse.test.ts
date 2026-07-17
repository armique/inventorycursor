import { describe, expect, it } from 'vitest';
import {
  formatDefectSplitNote,
  lineHasDefectKeyword,
  parseWorkingDefectSplit,
  resolveDefectCounts,
  stripConditionAnnotations,
} from './bulkTextParse';

describe('bulkTextParse', () => {
  it('detects defect keywords in multiple languages', () => {
    expect(lineHasDefectKeyword('2 defekt')).toBe(true);
    expect(lineHasDefectKeyword('not working')).toBe(true);
    expect(lineHasDefectKeyword('не работает')).toBe(true);
    expect(lineHasDefectKeyword('for parts')).toBe(true);
    expect(lineHasDefectKeyword('NO AD')).toBe(false);
    expect(lineHasDefectKeyword('Samsung 8GB')).toBe(false);
  });

  it('parses working/defekt splits', () => {
    expect(parseWorkingDefectSplit('(2 working, 2 defekt)')).toEqual({
      working: 2,
      defective: 2,
    });
    expect(parseWorkingDefectSplit('(1 working, 1 defekt)')).toEqual({
      working: 1,
      defective: 1,
    });
    expect(parseWorkingDefectSplit('2 defekt, 2 working')).toEqual({
      working: 2,
      defective: 2,
    });
  });

  it('strips condition annotations from names', () => {
    expect(
      stripConditionAnnotations('Kingston 8GB DDR4 2666MHz (2 working, 2 defekt)')
    ).toBe('Kingston 8GB DDR4 2666MHz');
  });

  it('resolves per-row defect counts for individual expand', () => {
    expect(
      resolveDefectCounts(4, '4x Kingston (2 working, 2 defekt)')
    ).toEqual({ working: 2, defective: 2 });
    expect(resolveDefectCounts(2, 'item not working')).toEqual({
      working: 0,
      defective: 2,
    });
    expect(resolveDefectCounts(2, 'Samsung 4GB')).toEqual({
      working: 2,
      defective: 0,
    });
  });

  it('formats split notes', () => {
    expect(formatDefectSplitNote(2, 2)).toBe('2 working, 2 defekt');
    expect(formatDefectSplitNote(0, 2)).toBe('2 defekt');
    expect(formatDefectSplitNote(2, 0)).toBe('');
  });
});
