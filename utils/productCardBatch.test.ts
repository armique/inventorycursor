import { describe, expect, it } from 'vitest';
import { buildProductCardBatchJobs, MIN_PRODUCT_CARD_BATCH } from './productCardBatch';

const STYLES = ['apple-studio-white', 'noir-editorial', 'industrial-mono', 'steel-gradient'];

describe('buildProductCardBatchJobs', () => {
  it('always returns at least 3 jobs', () => {
    expect(buildProductCardBatchJobs([], { styleId: STYLES[0], styleIds: STYLES })).toHaveLength(
      MIN_PRODUCT_CARD_BATCH
    );
    expect(
      buildProductCardBatchJobs(['a'], { styleId: STYLES[0], styleIds: STYLES })
    ).toHaveLength(MIN_PRODUCT_CARD_BATCH);
  });

  it('uses first 3 distinct photos when 5+ exist', () => {
    const photos = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const jobs = buildProductCardBatchJobs(photos, { styleId: STYLES[0], styleIds: STYLES });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.photos[0])).toEqual(['p1', 'p2', 'p3']);
    expect(jobs.every((j) => j.editFromPhoto && j.styleId === STYLES[0])).toBe(true);
  });

  it('cycles fewer photos and rotates styles', () => {
    const jobs = buildProductCardBatchJobs(['only'], {
      styleId: STYLES[0],
      styleIds: STYLES,
    });
    expect(jobs.map((j) => j.photos[0])).toEqual(['only', 'only', 'only']);
    expect(jobs[0].styleId).toBe(STYLES[0]);
    expect(jobs[1].styleId).not.toBe(STYLES[0]);
    expect(jobs[2].styleId).not.toBe(STYLES[0]);
  });
});
