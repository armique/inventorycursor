const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

for (const marker of [
  'Verkauft',
  'verkauft',
  'ebay.de/itm/',
  'i.ebayimg.com',
  's-item__title',
  'POSITIVE',
  'feedbackPercentage',
  'shippingCost',
  'STRIKETHROUGH',
  'priceWithDiscount',
  'displayPrice',
  'TextualDisplay',
  'legacyItemId',
]) {
  const count = (html.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(marker, count);
}

// Find real itm urls without quotes style
const itm = [...html.matchAll(/ebay\.de\/itm\/(\d{6,16})/g)].map(m => m[1]);
console.log('itm ids', itm.length, [...new Set(itm)].slice(0, 20));

const imgs = [...html.matchAll(/i\.ebayimg\.com\/[^"'\\\s]+/g)].slice(0, 10).map(m => m[0]);
console.log('imgs', imgs);

// Search results count text
const m = html.match(/[\d.]+\s*Ergebnisse/);
console.log('results text', m && m[0]);
console.log('srp-results slice', html.slice(html.indexOf('srp-results'), html.indexOf('srp-results') + 500));

// Look for ajax endpoint
const ajax = [...html.matchAll(/https:\/\/www\.ebay\.de\/[^"']+ajax[^"']*/gi)].slice(0, 10);
console.log('ajax', ajax.map(a => a[0]));
const sync = html.match(/"useAjaxUrl":true[\s\S]{0,400}/);
console.log('ajax cfg', sync && sync[0]);
