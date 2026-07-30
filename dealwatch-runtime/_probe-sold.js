(async () => {
  const url = 'https://www.ebay.de/sch/i.html?' + new URLSearchParams({
    _nkw: 'NVIDIA GeForce RTX 2080',
    LH_Sold: '1',
    LH_Complete: '1',
    LH_ItemCondition: '3000',
    _udhi: '200',
    _sop: '13',
    rt: 'nc',
  });
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      Accept: 'text/html',
    },
  });
  const html = await res.text();
  console.log('status', res.status, 'len', html.length);
  console.log('has NEXT_DATA', html.includes('__NEXT_DATA__'));
  console.log('has s-item', html.includes('s-item'));
  console.log('has itemId', html.includes('itemId'));

  const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    const data = JSON.parse(next[1]);
    console.log('NEXT keys', Object.keys(data));
    const str = JSON.stringify(data);
    console.log('NEXT size', str.length);
    fsWrite('next.json', str.slice(0, 20000));
  }

  // Find JSON blobs with item arrays
  const markers = ['itemSummaries', 'items', 'listingId', 'itemId', 'syt'];
  for (const m of markers) {
    console.log(m, html.includes(m));
  }

  // Extract s-item blocks count
  const titles = [...html.matchAll(/s-item__title[^>]*>([\s\S]*?)<\/div>/g)].slice(0, 3);
  console.log('title samples', titles.map(t => t[1].replace(/<[^>]+>/g, '').trim().slice(0, 80)));

  const prices = [...html.matchAll(/s-item__price[^>]*>([\s\S]*?)<\/span>/g)].slice(0, 5);
  console.log('price samples', prices.map(p => p[1].replace(/<[^>]+>/g, '').trim()));

  const links = [...html.matchAll(/href="(https:\/\/www\.ebay\.de\/itm\/[^"]+)"/g)].slice(0, 5);
  console.log('link samples', links.map(l => l[1]));

  // Look for embedded JSON in script tags
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  console.log('script tags', scripts.length);
  for (const s of scripts) {
    const body = s[1];
    if (body.includes('itemId') && body.length > 500 && body.length < 5000000) {
      console.log('script with itemId len', body.length, 'start', body.slice(0, 120).replace(/\s+/g, ' '));
    }
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

function fsWrite(name, data) {
  require('fs').writeFileSync(require('path').join(__dirname, name), data);
}
