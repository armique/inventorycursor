/**
 * Verify firestore.rules against the local emulator: owner-only writes on the public storefront
 * collections, validated public creates on storeInquiries, and no regression on users/{uid}.
 * Requires the emulator suite running (npm run emulators). Run: npx tsx scripts/verify-firestore-rules.ts
 */
import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const OWNER_UID = '4LFiPziIiTW3K0kdMC9dt7Qi2SZ2';
const OTHER_UID = 'some-other-signed-in-user';

async function main() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'inventorycursor-e9000',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await testEnv.clearFirestore();

  const owner = testEnv.authenticatedContext(OWNER_UID).firestore();
  const other = testEnv.authenticatedContext(OTHER_UID).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  // storeCatalog: public read, owner-only write.
  await assertSucceeds(owner.doc('storeCatalog/public').set({ hello: 'world' }));
  await assertFails(other.doc('storeCatalog/public').set({ hacked: true }));
  await assertFails(anon.doc('storeCatalog/public').set({ hacked: true }));
  await assertSucceeds(anon.doc('storeCatalog/public').get());
  console.log('OK: storeCatalog — public read, owner-only write, other signed-in users blocked');

  // storefrontConfig: same shape.
  await assertSucceeds(owner.doc('storefrontConfig/public').set({ theme: 'dark' }));
  await assertFails(other.doc('storefrontConfig/public').set({ theme: 'defaced' }));
  console.log('OK: storefrontConfig — owner-only write, other signed-in users blocked');

  // productPhotoCache: owner-only read AND write now (admin-only feature).
  await assertSucceeds(owner.doc('productPhotoCache/some-part').set({ imageUrl: 'https://x' }));
  await assertFails(other.doc('productPhotoCache/some-part').get());
  await assertFails(other.doc('productPhotoCache/some-part').set({ imageUrl: 'https://evil' }));
  console.log('OK: productPhotoCache — owner-only read and write');

  // storeInquiries: validated public create; owner-only read/update/delete.
  const validInquiry = {
    itemId: 'item-1',
    itemName: 'RTX 3070',
    message: 'Is this still available?',
    createdAt: new Date().toISOString(),
    read: false,
    status: 'new',
  };
  await assertSucceeds(anon.collection('storeInquiries').add(validInquiry));
  console.log('OK: storeInquiries — valid public create succeeds');

  await assertFails(anon.collection('storeInquiries').add({ ...validInquiry, message: '' }));
  console.log('OK: storeInquiries — empty message rejected');

  await assertFails(anon.collection('storeInquiries').add({ ...validInquiry, message: 'x'.repeat(6000) }));
  console.log('OK: storeInquiries — oversized message rejected');

  await assertFails(anon.collection('storeInquiries').add({ ...validInquiry, read: true }));
  console.log('OK: storeInquiries — spoofed read:true on create rejected');

  const { itemId: _drop, ...missingItemId } = validInquiry;
  await assertFails(anon.collection('storeInquiries').add(missingItemId));
  console.log('OK: storeInquiries — missing required field rejected');

  await assertFails(other.collection('storeInquiries').get());
  await assertSucceeds(owner.collection('storeInquiries').get());
  console.log('OK: storeInquiries — only the owner can list/read inquiries');

  // users/{uid}: unchanged regression check.
  await assertSucceeds(owner.doc(`users/${OWNER_UID}/syncPack/core`).set({ ok: true }));
  await assertFails(other.doc(`users/${OWNER_UID}/syncPack/core`).set({ ok: false }));
  console.log('OK: users/{uid} — still scoped to the owning user only (no regression)');

  await testEnv.cleanup();
  console.log('\nAll Firestore rules checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
