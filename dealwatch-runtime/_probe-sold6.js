const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

const vp = html.indexOf('Verkaufspreis');
console.log('Verkaufspreis count', (html.match(/Verkaufspreis/g) || []).length);
console.log(html.slice(vp - 400, vp + 600).replace(/\s+/g, ' '));

console.log('\n--- s-card sample ---');
const sc = html.indexOf('s-card');
console.log(html.slice(sc, sc + 2000).replace(/\s+/g, ' '));

console.log('\n--- su-card sample ---');
const su = html.indexOf('su-card-container');
console.log(html.slice(su, su + 2500).replace(/\s+/g, ' '));

// Count item links
const itm = [...html.matchAll(/href="(https:\/\/www\.ebay\.de\/itm\/[^"?]+)/g)].map(m => m[1]);
console.log('\nitm links', itm.length, [...new Set(itm)].slice(0, 8));

// Look for TextualDisplay with EUR
const euros = [...html.matchAll(/"text":"([\d.,]+\s*EUR)"/g)].slice(0, 20).map(m => m[1]);
console.log('EUR texts', euros);

const titles = [...html.matchAll(/"text":"([^"]{20,120})"/g)]
  .map(m => m[1])
  .filter(t => /RTX|GeForce|2080|GTX/i.test(t))
  .slice(0, 15);
console.log('title-like', titles);
