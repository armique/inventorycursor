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

/** eBay/thumbnail URLs often fail at small sizes — try larger variants server-side. */
function remotePhotoFetchVariants(url) {
  const trimmed = String(url || '').trim();
  const out = [trimmed];
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host.includes('ebayimg.com')) {
      const l1600 = trimmed.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/s-l1600.$1$2');
      if (l1600 !== trimmed) out.push(l1600);
      const dollar57 = trimmed.replace(/\$_\d+\.(JPG|JPEG|PNG|jpg|jpeg|png)/g, '$_57.$1');
      if (dollar57 !== trimmed) out.push(dollar57);
      const noQuery = trimmed.split('?')[0];
      if (noQuery !== trimmed) out.push(noQuery);
    }
    if (host.includes('imgur.com') && !host.includes('i.imgur.com')) {
      out.push(trimmed.replace(/^https?:\/\/(?:www\.)?imgur\.com\//i, 'https://i.imgur.com/'));
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out.filter(Boolean))];
}

async function fetchUpstreamImage(url) {
  const upstream = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://www.ebay.de/',
    },
  });
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, error: `HTTP ${upstream.status}` };
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: 'Image too large (max 15 MB).' };
  }
  if (buf.length < 32) {
    return { ok: false, error: 'Downloaded file is empty or invalid.' };
  }

  const ctHeader = upstream.headers.get('content-type') || 'image/jpeg';
  const contentType = ctHeader.split(';')[0].trim().toLowerCase();
  const safeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';
  return { ok: true, buf, contentType: safeType };
}

export async function handleImageFetch(req, res) {
  const url = String(req.query?.url || '').trim();
  if (!url || !isAllowedImageUrl(url)) {
    return res.status(400).json({ error: 'Invalid or disallowed image URL.' });
  }

  const variants = remotePhotoFetchVariants(url);
  let lastError = 'Image download failed.';

  try {
    for (const candidate of variants) {
      const result = await fetchUpstreamImage(candidate);
      if (!result.ok) {
        lastError = result.error || lastError;
        continue;
      }
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).end(result.buf);
    }
    return res.status(502).json({ error: lastError });
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : 'Image download failed.',
    });
  }
}
