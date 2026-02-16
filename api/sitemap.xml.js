/**
 * Vercel serverless: GET /api/sitemap.xml
 * Returns sitemap XML for the store (home, legal pages, categories, item URLs).
 * Reads store catalog from Firestore via REST API (public document).
 */

const PROJECT_ID = process.env.VERCEL_FIREBASE_PROJECT_ID || 'inventorycursor-e9000';
const API_KEY = process.env.FIREBASE_API_KEY || process.env.VERCEL_FIREBASE_API_KEY || 'AIzaSyA1KbcJ1oI0g7WBqplaiRoLttr4TkgR9XY';

async function fetchStoreCatalog() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/storeCatalog/public?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.fields) return null;
  const raw = data.fields?.items?.arrayValue?.values;
  if (!Array.isArray(raw)) return [];
  const items = raw.map((v) => {
    const map = v.mapValue?.fields || {};
    const get = (key) => {
      const f = map[key];
      if (!f) return undefined;
      if (f.stringValue !== undefined) return f.stringValue;
      if (f.integerValue !== undefined) return Number(f.integerValue);
      if (f.doubleValue !== undefined) return f.doubleValue;
      if (f.booleanValue !== undefined) return f.booleanValue;
      if (f.nullValue !== undefined) return null;
      return undefined;
    };
    return { id: get('id'), name: get('name'), category: get('category'), subCategory: get('subCategory') };
  });
  return items.filter((i) => i && i.id);
}

function escapeXml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'armiktech.com';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'https';
  const base = `${proto}://${host}`;

  const items = await fetchStoreCatalog();

  const urls = [
    { loc: base + '/', changefreq: 'daily', priority: '1.0' },
    { loc: base + '/impressum', changefreq: 'monthly', priority: '0.3' },
    { loc: base + '/datenschutz', changefreq: 'monthly', priority: '0.3' },
    { loc: base + '/agb', changefreq: 'monthly', priority: '0.3' },
  ];

  const categories = new Set();
  if (Array.isArray(items)) {
    items.forEach((i) => {
      if (i.category) categories.add(i.category);
      urls.push({ loc: `${base}/item/${encodeURIComponent(i.id)}`, changefreq: 'weekly', priority: '0.8' });
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate');
  res.status(200).send(xml);
}
