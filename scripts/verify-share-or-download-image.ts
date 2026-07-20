/**
 * Smoke-check helpers for iPhone share-to-Photos path (no DOM share in Node).
 */
import assert from 'node:assert/strict';
import { prefersShareImageToPhotos, productCardSaveActionLabel } from '../services/productCardGallery.ts';

// Node / non-iOS environment → classic download labels
assert.equal(prefersShareImageToPhotos(), false);
assert.equal(productCardSaveActionLabel(), 'Download');

console.log('verify-share-or-download-image: ok');
