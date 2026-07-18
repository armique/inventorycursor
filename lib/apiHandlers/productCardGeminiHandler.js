/**
 * Gemini image generation: premium marketplace product card.
 * Requires GEMINI_API_KEY (Google AI Studio) — not the Gemini consumer app subscription.
 */
import { getProductCardStyle } from '../productCardStyles.js';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
];

/** Strip quotes / Bearer / accidental whitespace from pasted keys. */
function sanitizeApiKey(raw) {
  let k = String(raw || '').trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }
  k = k.replace(/^Bearer\s+/i, '').trim();
  return k.replace(/[\r\n\t]/g, '');
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
  if (buf.length > MAX_BYTES) throw new Error('Image too large (max 8 MB)');
  return { buf, mime: (res.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

function bufferFromBase64(dataUrlOrB64) {
  const raw = String(dataUrlOrB64 || '').trim();
  const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) throw new Error('Image too large (max 8 MB)');
  const mime = raw.startsWith('data:')
    ? raw.match(/^data:([^;]+);/)?.[1] || 'image/jpeg'
    : 'image/jpeg';
  return { buf, mime };
}

function buildCardPrompt({ name, category, subCategory, specs, comment, styleId }) {
  const style = getProductCardStyle(styleId);
  const specLines = Array.isArray(specs)
    ? specs
        .slice(0, 8)
        .map((s) => `• ${s.label}: ${s.value}`)
        .join('\n')
    : '';

  return `You are a senior Product Marketing Designer creating ONE premium product card PNG for eBay.de / Kleinanzeigen.

Follow this design style EXACTLY (this is the chosen look — do not mix with other styles):
${style.prompt}

PRODUCT NAME (source of truth — use exactly, do not invent a different product): ${name}
CATEGORY: ${category || 'Hardware'}${subCategory ? ` / ${subCategory}` : ''}
SPECIFICATIONS (source of truth — never invent, replace, or omit values):
${specLines || '• Use only details clearly present in the product name'}
${comment ? `NOTES: ${String(comment).slice(0, 200)}` : ''}

PHOTO RULES (if photos are attached):
- Use photos ONLY for product appearance: remove background, improve lighting/shadows/reflections, center the product.
- Do NOT redesign hardware. Do NOT add missing parts, RAM sticks, coolers, IO shields, or cables.
- Keep exact component counts visible in photos (e.g. if one RAM stick, keep one).
- Keep realistic scratches/cosmetic marks.

GLOBAL RULES:
- Fully AI-composed card (layout + typography + composition). No template placeholders.
- No watermarks, no fake brand logos floating in the design.
- Square high-resolution image suitable for marketplace listings.
- Return ONLY the image.`;
}

export async function handleProductCardGemini(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = sanitizeApiKey(getGeminiKeyForServer());
  if (!apiKey) {
    return res.status(503).json({
      error:
        'GEMINI_API_KEY not set. Create a key at https://aistudio.google.com/apikey and add GEMINI_API_KEY (Vercel) or VITE_GEMINI_API_KEY (.env). A Gemini app Pro subscription alone is not an API key.',
    });
  }
  if (!apiKey.startsWith('AIza')) {
    return res.status(401).json({
      error:
        'Gemini API key looks invalid (expected a key starting with AIza… from Google AI Studio). Do not paste an OAuth access token or Gemini app login cookie.',
      hint: 'https://aistudio.google.com/apikey → Create API key → put it in GEMINI_API_KEY / VITE_GEMINI_API_KEY, then restart the server / redeploy.',
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Product name required' });

  const specs = Array.isArray(body.specs) ? body.specs : [];
  const category = String(body.category || '');
  const subCategory = String(body.subCategory || '');
  const comment = String(body.comment || '');
  const styleId = String(body.styleId || '').trim();
  const style = getProductCardStyle(styleId);

  try {
    const imageParts = [];
    const rawList = [];
    if (Array.isArray(body.images)) rawList.push(...body.images);
    if (body.imageBase64) rawList.push({ imageBase64: body.imageBase64 });
    if (body.imageUrl) rawList.push({ imageUrl: body.imageUrl });

    for (const entry of rawList.slice(0, MAX_PHOTOS)) {
      try {
        if (entry?.imageBase64) {
          const { buf, mime } = bufferFromBase64(entry.imageBase64);
          imageParts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
        } else if (entry?.imageUrl && String(entry.imageUrl).startsWith('data:')) {
          const { buf, mime } = bufferFromBase64(entry.imageUrl);
          imageParts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
        } else if (entry?.imageUrl) {
          const { buf, mime } = await fetchImageBuffer(String(entry.imageUrl).trim());
          imageParts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
        }
      } catch {
        /* skip bad photo */
      }
    }

    const prompt = buildCardPrompt({ name, category, subCategory, specs, comment, styleId: style.id });
    const parts = [...imageParts, { text: prompt }];

    let lastError = '';
    let rateLimited = false;
    let authFailed = false;

    for (const model of IMAGE_MODELS) {
      try {
        const resAi = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                temperature: 0.4,
              },
            }),
          }
        );

        if (resAi.status === 401 || resAi.status === 403) {
          authFailed = true;
          const errText = await resAi.text();
          lastError =
            `Gemini auth failed (${resAi.status}). API key is rejected. ` +
            `Create a fresh key at https://aistudio.google.com/apikey, set GEMINI_API_KEY (and VITE_GEMINI_API_KEY locally), restart/redeploy. ` +
            errText.slice(0, 160);
          break;
        }
        if (resAi.status === 429) {
          rateLimited = true;
          lastError =
            'Gemini image quota exceeded (429). Image models have a separate (often low) free quota. ' +
            'Enable billing in Google AI Studio / Cloud, or wait for the quota reset. Text chat Pro does not raise this limit.';
          continue;
        }
        if (!resAi.ok) {
          const errText = await resAi.text();
          lastError = `${model}: ${resAi.status} ${errText.slice(0, 240)}`;
          continue;
        }

        const data = await resAi.json();
        const outParts = data.candidates?.[0]?.content?.parts || [];
        for (const part of outParts) {
          const inline = part.inlineData || part.inline_data;
          if (inline?.data) {
            return res.status(200).json({
              imageBase64: inline.data,
              mimeType: inline.mimeType || inline.mime_type || 'image/png',
              provider: 'Gemini',
              model,
              styleId: style.id,
              styleName: style.name,
              note: imageParts.length
                ? `${style.name} · specs + your photos`
                : `${style.name} · name & specs (no photos)`,
            });
          }
        }
        lastError = `${model}: no image in response`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Gemini request failed';
      }
    }

    return res.status(authFailed ? 401 : rateLimited ? 429 : 503).json({
      error: lastError || 'Gemini could not generate a product card image.',
      hint: authFailed
        ? 'Invalid/expired API key — not a model bug. Gemini app Pro ≠ API key. Use AI Studio key (starts with AIza).'
        : 'Use an API key from https://aistudio.google.com/apikey with image generation access.',
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Product card generation failed' });
  }
}
