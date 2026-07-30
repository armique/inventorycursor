const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const from = code.indexOf('const blockedPatterns');
const to = code.indexOf('async function searchListings');
const chunk = code.slice(from, to)
  // Drop the env guard and everything until sold helpers by keeping filter helpers + image helpers + sold helpers
  .replace(/if \(!EBAY_CLIENT_ID[\s\S]*?function buildEbayFilter/, 'function buildEbayFilter');

// Still has too much store code. Build a tighter bundle instead.
const parts = [
  code.slice(code.indexOf('const blockedPatterns'), code.indexOf('if (!EBAY_CLIENT_ID')),
  code.slice(code.indexOf('function ebayImageRank'), code.indexOf('function berlinDate')),
  code.slice(code.indexOf('function buildSoldSearchUrl'), code.indexOf('async function searchListings')),
].join('\n');

const snippet = `${parts}
(async () => {
  const query = { search: 'NVIDIA GeForce RTX 2080', maxPrice: 200, minFeedback: 90, condition: 'used' };
  const result = await searchSoldListings(query);
  console.log(JSON.stringify({
    scanned: result.scanned,
    kept: result.items.length,
    rejected: result.rejected,
    median: result.median,
    sample: result.items.slice(0, 6).map(i => ({ title: i.title.slice(0, 70), total: i.total, soldLabel: i.soldLabel })),
  }, null, 2));
})().catch(err => { console.error(String(err)); });
`;

vm.runInNewContext(snippet, {
  console,
  fetch,
  URLSearchParams,
  setTimeout,
  clearTimeout,
});
