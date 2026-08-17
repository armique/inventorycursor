import { lookupPhotoThumb } from './photoThumbCache';

const IMGUR_SIZE_SUFFIX = /^([a-zA-Z0-9]+)([stbmlh])(\.(?:jpe?g|png|gif|webp))$/i;

/**
 * Pick a smaller hosted derivative for list/card thumbnails.
 * Falls back to the original URL when no smaller variant is known.
 */
export function toListImageUrl(url: string, maxEdge = 256): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return trimmed;

  const cached = lookupPhotoThumb(trimmed);
  if (cached) return cached;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (host.includes('ebayimg.com') || host.includes('ebaystatic.com')) {
      const ebayEdge = maxEdge <= 300 ? 225 : maxEdge <= 640 ? 500 : 960;
      const next = trimmed.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i, `/s-l${ebayEdge}.$1$2`);
      if (next !== trimmed) return next;
      const dollar = trimmed.replace(/\$_\d+\.(JPG|JPEG|PNG|WEBP|jpg|jpeg|png|webp)/g, '$_1.$1');
      if (dollar !== trimmed) return dollar;
    }

    if (host === 'i.imgur.com' || host === 'imgur.com') {
      const file = parsed.pathname.split('/').pop() || '';
      const sized = file.match(IMGUR_SIZE_SUFFIX);
      const suffix = maxEdge <= 160 ? 'b' : maxEdge <= 320 ? 'm' : 'l';
      if (sized) {
        if (sized[2] === suffix) return trimmed;
        parsed.pathname = parsed.pathname.replace(file, `${sized[1]}${suffix}${sized[3]}`);
        return parsed.toString();
      }
      const plain = file.match(/^([a-zA-Z0-9]+)(\.(?:jpe?g|png|gif|webp))$/i);
      if (plain) {
        parsed.pathname = parsed.pathname.replace(file, `${plain[1]}${suffix}${plain[2]}`);
        return parsed.toString();
      }
    }
  } catch {
    /* data: / relative / malformed */
  }

  return trimmed;
}

/** Hero / LCP plane: medium-large derivative, not the 1600px original. */
export function toHeroImageUrl(url: string): string {
  return toListImageUrl(url, 960);
}
