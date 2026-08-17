import { toHeroImageUrl, toListImageUrl } from '../utils/displayImageUrl';

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

assert(
  toListImageUrl('https://i.ebayimg.com/images/g/abc/s-l1600.jpg') ===
    'https://i.ebayimg.com/images/g/abc/s-l225.jpg',
  'ebay s-l1600 becomes s-l225 for list'
);
assert(
  toHeroImageUrl('https://i.ebayimg.com/images/g/abc/s-l1600.jpg') ===
    'https://i.ebayimg.com/images/g/abc/s-l960.jpg',
  'ebay hero uses s-l960'
);
assert(
  toListImageUrl('https://i.ebayimg.com/images/g/abc/s-l1600.jpg?foo=1') ===
    'https://i.ebayimg.com/images/g/abc/s-l225.jpg?foo=1',
  'ebay query string is preserved'
);
assert(
  toListImageUrl('https://i.ebayimg.com/00/s-l1600.png') ===
    'https://i.ebayimg.com/00/s-l225.png',
  'ebay png list rewrite'
);
assert(
  toListImageUrl('https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/abc/$_57.JPG').endsWith('$_1.JPG'),
  'ebay dollar-size rewrite'
);
assert(
  toListImageUrl('https://i.imgur.com/abcDEFg.jpg') === 'https://i.imgur.com/abcDEFgm.jpg',
  'imgur original becomes medium'
);
assert(
  toListImageUrl('https://i.imgur.com/abcDEFgl.jpg') === 'https://i.imgur.com/abcDEFgm.jpg',
  'imgur large becomes medium'
);
assert(
  toListImageUrl('https://firebasestorage.googleapis.com/v0/b/x/o/hash.jpg?alt=media&token=abc') ===
    'https://firebasestorage.googleapis.com/v0/b/x/o/hash.jpg?alt=media&token=abc',
  'firebase URLs pass through without a cached thumb'
);
assert(toListImageUrl('data:image/jpeg;base64,aaa') === 'data:image/jpeg;base64,aaa', 'data URLs pass through');
assert(toListImageUrl('') === '', 'empty stays empty');

if (failed) {
  console.error(`verify-display-image-url: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-display-image-url: ${passed} passed`);
