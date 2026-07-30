const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'https://www.ebay.de/sch/i.html?' + new URLSearchParams({
    _nkw: 'RTX 2080',
    LH_Sold: '1',
    LH_Complete: '1',
    LH_ItemCondition: '3000',
    _udhi: '200',
    _sop: '13',
    rt: 'nc',
  });
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  };
  const first = await fetch(url, { headers, redirect: 'manual' });
  const cookies = (first.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const second = await fetch(url, {
    headers: { ...headers, Cookie: cookies, Referer: 'https://www.ebay.de/' },
  });
  const html = await second.text();
  fs.writeFileSync(path.join(__dirname, '_sold-sample.html'), html);

  // Find JSON configs
  const jsonMarkers = [
    /"items":\s*\[/,
    /"itemListElement"/,
    /application\/ld\+json/,
    /s-item__info/,
    /"listingId"/,
    /"itemId"/,
  ];
  for (const re of jsonMarkers) console.log(String(re), re.test(html));

  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  console.log('ld+json count', ld.length);
  if (ld[0]) console.log('ld0', ld[0][1].slice(0, 400));

  // Typical s-item card chunk
  const itemStart = html.indexOf('s-item s-item__pl-on-bottom');
  console.log('itemStart', itemStart);
  if (itemStart >= 0) {
    console.log(html.slice(itemStart, itemStart + 2500).replace(/\s+/g, ' ').slice(0, 2000));
  }

  // Alternative class
  const alt = html.indexOf('class="s-item');
  console.log('alt', alt);
  console.log(html.slice(alt, alt + 1800).replace(/\s+/g, ' ').slice(0, 1500));
})().catch(console.error);
