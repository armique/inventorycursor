/**
 * Vercel serverless: GET /api/sitemap.xml
 * Returns sitemap XML for the store (home, legal pages, categories, item URLs).
 * Reads store catalog from Supabase via REST API.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

async function fetchStoreCatalog() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  try {
    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/storefront_catalog?select=catalog_data&order=updated_at.desc&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]?.catalog_data) return [];
    const catalog = data[0].catalog_data;
    const items = catalog.items || [];
    return items.filter((i) => i && i.id);
  } catch (err) {
    console.warn('[sitemap] Failed to fetch catalog from Supabase:', err);
    return [];
  }
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

  if (Array.isArray(items)) {
    items.forEach((i) => {
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
