const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '_sold-sample.html'), 'utf8');

console.log('len', html.length);
const i = html.indexOf('"items":');
console.log('items at', i);
console.log(html.slice(i, i + 800));

// try to extract a balanced JSON array after "items":
function extractJsonArray(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  let idx = source.indexOf('[', start);
  if (idx < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let p = idx; p < source.length; p++) {
    const ch = source[p];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(idx, p + 1);
    }
  }
  return null;
}

const arrText = extractJsonArray(html, '"items":');
console.log('array len', arrText && arrText.length);
if (arrText) {
  try {
    const items = JSON.parse(arrText);
    console.log('parsed items', items.length);
    console.log(JSON.stringify(items[0], null, 2).slice(0, 2000));
    fs.writeFileSync(path.join(__dirname, '_sold-item0.json'), JSON.stringify(items[0], null, 2));
    fs.writeFileSync(path.join(__dirname, '_sold-items-meta.json'), JSON.stringify({
      count: items.length,
      keys: Object.keys(items[0] || {}),
      sampleTitles: items.slice(0, 5).map(x => x.title || x.itemTitle || x.name || Object.keys(x)),
    }, null, 2));
  } catch (error) {
    console.error('parse fail', error.message);
    fs.writeFileSync(path.join(__dirname, '_sold-items-raw.txt'), arrText.slice(0, 5000));
  }
}

// Find surrounding context for items key
const ctx = html.lastIndexOf('<script', i);
console.log('script ctx', html.slice(ctx, ctx + 200));
