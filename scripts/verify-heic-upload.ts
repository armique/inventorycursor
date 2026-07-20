/**
 * Sandbox checks for HEIC detection / JPEG rename helpers used by iCloud uploads.
 * Run: npx tsx scripts/verify-heic-upload.ts
 */
import assert from 'node:assert/strict';
import {
  isLikelyImageFile,
  looksLikeHeic,
  resolveImageMimeType,
} from '../utils/localImageFile';

function run() {
  assert.equal(looksLikeHeic({ name: 'IMG_2360.HEIC', type: '' }), true);
  assert.equal(looksLikeHeic({ name: 'IMG_2360.heic', type: 'image/heic' }), true);
  assert.equal(looksLikeHeic({ name: 'shot.HEIF', type: '' }), true);
  assert.equal(looksLikeHeic({ name: 'photo.jpg', type: 'image/jpeg' }), false);
  assert.equal(looksLikeHeic({ name: 'photo.png', type: '' }), false);

  assert.equal(resolveImageMimeType({ name: 'IMG_2360.HEIC', type: '' }), 'image/heic');
  assert.equal(resolveImageMimeType({ name: 'IMG_2360.HEIC', type: 'image/heic' }), 'image/heic');
  assert.equal(isLikelyImageFile({ name: 'IMG_2360.HEIC', type: '' }), true);

  // JPEG rename used after conversion
  const renamed = 'IMG_2360.HEIC'.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
  assert.equal(renamed, 'IMG_2360.jpg');

  console.log('verify-heic-upload: all checks passed');
}

run();
