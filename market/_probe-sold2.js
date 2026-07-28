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
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
  };

  const first = await fetch(url, { headers, redirect: 'manual' });
  const cookies = (first.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  console.log('first', first.status, 'cookies', cookies.slice(0, 120));

  const second = await fetch(url, {
    headers: { ...headers, Cookie: cookies, Referer: 'https://www.ebay.de/' },
    redirect: 'follow',
  });
  const html = await second.text();
  console.log('second', second.status, 'len', html.length, 's-item', html.includes('s-item'), 'NEXT', html.includes('__NEXT_DATA__'));
  console.log(html.slice(0, 300).replace(/\s+/g, ' '));
})().catch(console.error);
