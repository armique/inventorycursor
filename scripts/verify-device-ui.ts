/**
 * Verify phone UI helpers used for native photo / layout choices.
 * Run: npx tsx scripts/verify-device-ui.ts
 */
import assert from 'node:assert/strict';
import { isPhoneUi, prefersNativePhotoCapture } from '../utils/deviceUi';

// Node has no window — helpers must be safe and return false.
assert.equal(isPhoneUi(), false);
assert.equal(prefersNativePhotoCapture(), false);

console.log('verify-device-ui: ok');
