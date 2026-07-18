/**
 * Server-side product photo enhancement: background removal + cleanup.
 * Providers (first success wins): remove.bg · Gemini image · local-hints-only response.
 */
import { getGeminiKeyForServer } from '../geminiServerEnv.js';

const MAX_BYTES = 12 * 1024 * 1024;

function pickEnv(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function fetchImageBuffer(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'DeInventory-Pro/1.0',
      Accept: 'image/*',
    },
  });
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Image too large (max 12 MB)');
  return { buf, mime: (res.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

function bufferFromBase64(dataUrlOrB64) {
  const raw = String(dataUrlOrB64 || '').trim();
  const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) throw new Error('Image too large (max 12 MB)');
  const mime = raw.startsWith('data:') ? raw.match(/^data:([^;]+);/)?.[1] || 'image/jpeg' : 'image/jpeg';
  return { buf, mime };
}

async function enhanceWithRemoveBg(buf, mime) {
  const apiKey = pickEnv('REMOVE_BG_API_KEY');
  if (!apiKey) return null;

  const form = new FormData();
  form.append('image_file', new Blob([buf], { type: mime }), 'product.jpg');
  form.append('size', 'auto');
  form.append('type', 'product');
  form.append('format', 'png');
  form.append('bg_color', 'f5f5f7');

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`remove.bg: ${res.status} ${errText.slice(0, 200)}`);
  }
  const out = Buffer.from(await res.arrayBuffer());
  return {
    imageBase64: out.toString('base64'),
    mimeType: 'image/png',
    provider: 'remove.bg',
    note: 'Background removed · product preserved',
  };
}

async function enhanceWithGemini(buf, mime) {
  const apiKey = String(getGeminiKeyForServer() || '').trim();
  if (!apiKey) return { result: null, rateLimited: false };

  const b64 = buf.toString('base64');
  const models = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];

  const prompt = `Professional e-commerce product photo retouch for a marketplace listing (eBay/Kleinanzeigen).
Tasks:
1) Remove cluttered background — replace with clean soft off-white studio backdrop (#f5f5f7).
2) Subtly clean minor dust, glue marks, smudges on packaging — do NOT repaint or redesign the product.
3) Keep the product 100% authentic: same shape, labels, text, colors, proportions.
4) Slight clarity/sharpness boost only — no artistic filters, no fake 3D, no watermark.
Return ONLY the edited product photo.`;

  let rateLimited = false;

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inline_data: { mime_type: mime, data: b64 } },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 0.35,
            },
          }),
        }
      );
      if (res.status === 429) {
        rateLimited = true;
        continue;
      }
      if (!res.ok) continue;
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data;
        if (inline?.data) {
          return {
            result: {
              imageBase64: inline.data,
              mimeType: inline.mimeType || inline.mime_type || 'image/png',
              provider: 'Gemini',
              model,
              note: 'AI cleanup + studio background',
            },
            rateLimited: false,
          };
        }
      }
    } catch {
      /* try next model */
    }
  }
  return { result: null, rateLimited };
}

export async function handleProductPhotoEnhance(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { imageUrl, imageBase64 } = body;

  try {
    let buf;
    let mime;
    if (imageBase64) {
      ({ buf, mime } = bufferFromBase64(imageBase64));
    } else if (imageUrl) {
      ({ buf, mime } = await fetchImageBuffer(String(imageUrl).trim()));
    } else {
      return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });
    }

    const errors = [];

    const removeBg = await enhanceWithRemoveBg(buf, mime).catch((e) => {
      errors.push(e.message);
      return null;
    });
    if (removeBg) return res.status(200).json(removeBg);

    const { result: gemini, rateLimited } = await enhanceWithGemini(buf, mime);
    if (rateLimited) {
      errors.push(
        'Gemini image: quota exceeded (429). Image models have very low free limits — fix REMOVE_BG_API_KEY or wait ~1 min.'
      );
    }
    if (gemini) return res.status(200).json(gemini);

    return res.status(503).json({
      error: 'No photo AI available. Add REMOVE_BG_API_KEY (recommended) or GEMINI_API_KEY on server, or use local polish in the app.',
      fallback: 'local',
      details: errors,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Enhance failed' });
  }
}

export async function handleEnhanceProviders(req, res) {
  const providers = [];
  if (pickEnv('REMOVE_BG_API_KEY')) {
    providers.push({ id: 'removebg', label: 'remove.bg', tier: 'paid', features: ['bg remove'] });
  }
  if (getGeminiKeyForServer()) {
    providers.push({ id: 'gemini', label: 'Gemini Image', tier: 'free/paid', features: ['bg remove', 'dust cleanup'] });
  }
  providers.push({ id: 'local', label: 'Local polish (always)', tier: 'free', features: ['sharpen', 'contrast', 'studio bg'] });
  return res.status(200).json({ providers });
}
