const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

const listingIdx = [];
let from = 0;
while (true) {
  const i = html.indexOf('"listingId"', from);
  if (i < 0) break;
  listingIdx.push(i);
  from = i + 1;
  if (listingIdx.length > 5) break;
}
console.log('listingId positions', listingIdx.length, listingIdx.slice(0, 5));
console.log(html.slice(listingIdx[0] - 200, listingIdx[0] + 800));

const itemIdIdx = html.indexOf('"itemId"');
console.log('\nitemId ctx\n', html.slice(itemIdIdx - 150, itemIdIdx + 600));

// Search for sold price patterns
for (const marker of ['"price"', 'Verkaufspreis', 'soldPrice', 'bidPrice', 'currentPrice', 's-card', 'su-card-container', 'srp-results']) {
  console.log(marker, html.includes(marker), html.indexOf(marker));
}

// Find large model objects with keyword
const modelIdx = html.indexOf('"keyword":"RTX 2080"');
console.log('model keyword at', modelIdx);
console.log(html.slice(modelIdx, modelIdx + 1500));
