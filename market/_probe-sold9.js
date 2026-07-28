const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

const re = /<li class="s-card[^"]*"([^>]*)>([\s\S]*?)<\/li>/g;
let match;
const cards = [];
while ((match = re.exec(html))) {
  const attrs = match[1];
  const id = (attrs.match(/data-listingid=([^\s>]+)/i) || [])[1];
  if (!id || id.length < 8) continue;
  if (!/ebay\.de\/itm\//i.test(match[2])) continue;
  cards.push({ id, attrs, body: match[2] });
}

console.log('real cards', cards.length);
const body = cards[0].body;
fs.writeFileSync(path.join(__dirname, '_sold-card-real.html'), body);

const priceMatches = [...body.matchAll(/s-card__price[^>]*>([\s\S]*?)<\/span>/gi)];
console.log('price matches', priceMatches.map(m => m[1]));
console.log('EUR anywhere', body.match(/[\d.,]+\s*EUR/g));
console.log('attr rows', [...body.matchAll(/s-card__attribute-row[\s\S]{0,200}/g)].slice(0, 6).map(m => m[0].replace(/\s+/g, ' ')));
console.log('Verkauft', body.match(/Verkauft[^<]{0,60}/g));
console.log('shipping', body.match(/[\d.,]+\s*EUR Versand|Kostenloser Versand|\+\s*[\d.,]+\s*EUR/gi));
