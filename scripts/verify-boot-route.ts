import { shouldBootPanel } from '../utils/bootRoute';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

assert(shouldBootPanel('/panel/inventory') === true, 'panel inventory boots panel');
assert(shouldBootPanel('/panel') === true, 'panel root boots panel');
assert(shouldBootPanel('/upload/abc') === true, 'phone upload boots panel');
assert(shouldBootPanel('/auth/ebay/callback') === true, 'oauth callback boots panel');
assert(shouldBootPanel('/') === false, 'storefront home does not boot panel');
assert(shouldBootPanel('/item/xyz') === false, 'product page does not boot panel');
assert(shouldBootPanel('/impressum') === false, 'legal page does not boot panel');
assert(shouldBootPanel('/dealwatch') === false, 'static dealwatch is not the React panel');

if (failed) {
  console.error(`verify-boot-route: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-boot-route: ${passed} passed`);
