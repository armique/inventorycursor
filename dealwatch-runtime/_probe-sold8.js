const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

function extractCards(source) {
  const cards = [];
  const re = /<li class="s-card[^"]*"([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(source))) {
    const attrs = match[1];
    const body = match[2];
    if (!/data-listingid=/i.test(attrs) && !/data-listingid=/i.test(body)) continue;
    cards.push({ attrs, body });
  }
  return cards;
}

const cards = extractCards(html);
console.log('cards', cards.length);

function decode(htmlText) {
  return htmlText
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function strip(htmlText) {
  return decode(htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

const parsed = cards.slice(0, 8).map(({ attrs, body }) => {
  const id = (attrs.match(/data-listingid=([^\s>]+)/i) || [])[1];
  const href = (body.match(/href=(https:\/\/www\.ebay\.de\/itm\/[^>\s]+)/i) || [])[1];
  const title = strip((body.match(/class="?s-card__title[^"]*"?[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
  const price = strip((body.match(/class="?s-card__price[^"]*"?[^>]*>([\s\S]*?)<\/span>/i) || body.match(/([\d.,]+)\s*EUR/) || [])[1] || '');
  const img = (body.match(/src=(https:\/\/i\.ebayimg\.com\/[^>\s]+)/i) || body.match(/data-defer-load=(https:\/\/i\.ebayimg\.com\/[^>\s]+)/i) || [])[1];
  const sold = strip((body.match(/Verkauft[^<]{0,40}/i) || [])[0] || '');
  return { id, href: href && decode(href), title: title.slice(0, 120), price, img, sold };
});

console.log(JSON.stringify(parsed, null, 2));

// dump first card body snippet for selectors
fs.writeFileSync(path.join(__dirname, '_sold-card0.html'), cards[0].body.slice(0, 8000));
