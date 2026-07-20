/**
 * Plan a batch of AI product-card generations from an item's gallery photos.
 * Always returns at least {@link MIN_PRODUCT_CARD_BATCH} jobs.
 * When 3+ photos exist, each of the first 3 cards uses a different source photo.
 * Extra photos beyond 3 are ignored for generation (still minimum 3 cards).
 */

export const MIN_PRODUCT_CARD_BATCH = 3;

export type ProductCardBatchJob = {
  index: number;
  /** Source photo(s) for this card — usually one for distinct compositions. */
  photos: string[];
  editFromPhoto: boolean;
  /** Style for this card (may rotate when photos are reused). */
  styleId: string;
};

function pickAlternateStyle(
  index: number,
  preferredStyleId: string,
  styleIds: string[]
): string {
  if (index === 0 || styleIds.length <= 1) return preferredStyleId;
  const others = styleIds.filter((id) => id !== preferredStyleId);
  if (!others.length) return preferredStyleId;
  return others[(index - 1) % others.length];
}

/**
 * Build generation jobs for a product-card batch.
 * @param sourcePhotos Gallery / upload photos (order preserved). Only the first
 *   {@link MIN_PRODUCT_CARD_BATCH} unique photos are used when more exist.
 */
export function buildProductCardBatchJobs(
  sourcePhotos: string[],
  opts: {
    styleId: string;
    styleIds: string[];
    count?: number;
  }
): ProductCardBatchJob[] {
  const count = Math.max(MIN_PRODUCT_CARD_BATCH, opts.count ?? MIN_PRODUCT_CARD_BATCH);
  const photos = (sourcePhotos || []).filter((u) => typeof u === 'string' && u.trim());
  const uniqueForBatch = photos.slice(0, count);

  const jobs: ProductCardBatchJob[] = [];
  for (let i = 0; i < count; i++) {
    if (uniqueForBatch.length === 0) {
      jobs.push({
        index: i,
        photos: [],
        editFromPhoto: false,
        // Vary style so 3 no-photo cards still look different
        styleId: pickAlternateStyle(i, opts.styleId, opts.styleIds),
      });
      continue;
    }

    if (uniqueForBatch.length >= count) {
      jobs.push({
        index: i,
        photos: [uniqueForBatch[i]],
        editFromPhoto: true,
        styleId: opts.styleId,
      });
      continue;
    }

    // Fewer than count photos: cycle photos and rotate style for variety
    const photo = uniqueForBatch[i % uniqueForBatch.length];
    jobs.push({
      index: i,
      photos: [photo],
      editFromPhoto: true,
      styleId: pickAlternateStyle(i, opts.styleId, opts.styleIds),
    });
  }
  return jobs;
}
