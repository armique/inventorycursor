/**
 * Best-effort public Kleinanzeigen seller profile title fetch.
 * Profile pages may block bots — client falls back to paste-import.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const profileUrl = String(req.query.url || '').trim();
  if (!profileUrl) return res.status(400).json({ error: 'Missing url' });

  let parsed;
  try {
    parsed = new URL(profileUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (host !== 'kleinanzeigen.de' && host !== 'www.kleinanzeigen.de') {
    return res.status(400).json({ error: 'Only kleinanzeigen.de profile URLs are allowed' });
  }
  if (!/s-bestandsliste|s-anzeigen|profil/i.test(parsed.pathname + parsed.search)) {
    // Still allow if it's clearly a kleinanzeigen user path
    if (!parsed.pathname.includes('/s-')) {
      return res.status(400).json({
        error: 'Expected a public seller profile / bestandsliste URL',
      });
    }
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      return res.status(502).json({
        error: `Kleinanzeigen returned ${response.status}`,
        blocked: response.status === 403 || response.status === 429,
      });
    }
    const html = await response.text();
    const titles = extractTitles(html);
    return res.status(200).json({
      titles,
      count: titles.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Failed to fetch profile',
      blocked: true,
    });
  }
}

function extractTitles(html) {
  const out = [];
  const seen = new Set();

  // Common article title patterns on public profile / search result pages
  const patterns = [
    /data-testid="ad-title"[^>]*>([^<]+)</gi,
    /class="[^"]*ellipsis[^"]*"[^>]*>([^<]{8,160})</gi,
    /itemprop="name"[^>]*content="([^"]{8,160})"/gi,
    /<h2[^>]*class="[^"]*text-module-begin[^"]*"[^>]*>([^<]{8,160})</gi,
    /"title"\s*:\s*"([^"\\]{8,160})"/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const title = decodeHtml(m[1]).replace(/\s+/g, ' ').trim();
      if (title.length < 8 || title.length > 160) continue;
      if (/cookie|consent|datenschutz|impressum/i.test(title)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title });
      if (out.length >= 200) return out;
    }
  }

  // Ad detail links with title text
  const linkRe =
    /href="(https?:\/\/www\.kleinanzeigen\.de\/s-anzeige\/[^"]+)"[^>]*>([^<]{8,160})</gi;
  let lm;
  while ((lm = linkRe.exec(html)) !== null) {
    const url = lm[1];
    const title = decodeHtml(lm[2]).replace(/\s+/g, ' ').trim();
    if (title.length < 8) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
    if (out.length >= 200) break;
  }

  return out;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
