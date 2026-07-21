/**
 * Sandbox checks for HEIC detection / JPEG rename helpers used by iCloud uploads.
 * Run: npx tsx scripts/verify-heic-upload.ts
 */
import assert from 'node:assert/strict';
import {
  formatCaughtError,
  isLikelyImageFile,
  looksLikeHeic,
  resolveImageMimeType,
  sniffImageKind,
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

  // heic2any rejects plain objects — must not become "[object Object]"
  assert.equal(
    formatCaughtError({ code: 'ERR_LIBHEIF', message: 'format not supported' }),
    'ERR_LIBHEIF: format not supported'
  );
  assert.equal(formatCaughtError({ code: 1, message: 'boom' }), '1: boom');
  assert.notEqual(formatCaughtError({ code: 'X', message: 'y' }), '[object Object]');

  // JPEG sniff (FF D8 FF)
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).buffer;
  assert.equal(sniffImageKind(jpeg), 'jpeg');

  // HEIC sniff (....ftypheic)
  const heic = new Uint8Array(16);
  heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  assert.equal(sniffImageKind(heic.buffer), 'heic');

  console.log('verify-heic-upload: all checks passed');
}

run();
