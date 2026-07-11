/**
 * Server-side image fetch for persisting remote product photos (eBay, search, etc.).
 * Avoids browser CORS blocks when importing images into Firebase Storage.
 */

const MAX_BYTES = 15 * 1024 * 1024;

function isAllowedImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function handleImageFetch(req, res) {
  const url = String(req.query?.url || '').trim();
  if (!url || !isAllowedImageUrl(url)) {
    return res.status(400).json({ error: 'Invalid or disallowed image URL.' });
  }

  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Could not download image (HTTP ${upstream.status}).` });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return res.status(400).json({ error: 'Image too large (max 15 MB).' });
    }
    if (buf.length < 32) {
      return res.status(400).json({ error: 'Downloaded file is empty or invalid.' });
    }

    const ctHeader = upstream.headers.get('content-type') || 'image/jpeg';
    const contentType = ctHeader.split(';')[0].trim().toLowerCase();
    const safeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';

    res.setHeader('Content-Type', safeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : 'Image download failed.',
    });
  }
}
