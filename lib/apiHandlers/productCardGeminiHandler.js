/**
 * Gemini image generation: premium marketplace product card.
 * Requires GEMINI_API_KEY (Google AI Studio) — not the Gemini consumer app subscription.
 */

function pickEnv(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-2.5-flash-image-preview',
];

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

function buildCardPrompt({ name, category, subCategory, specs, comment }) {
  const specLines = Array.isArray(specs)
    ? specs
        .slice(0, 8)
        .map((s) => `• ${s.label}: ${s.value}`)
        .join('\n')
    : '';

  return `You are a senior Product Marketing Designer creating ONE premium product card PNG for eBay.de / Kleinanzeigen.

STYLE: Apple-inspired minimalism, premium, clean, high-end, modern. Pure white or very light gray gradient background. No clutter, no RGB gaming effects, no neon glow, no watermarks.

PRODUCT NAME (source of truth): ${name}
CATEGORY: ${category || 'Hardware'}${subCategory ? ` / ${subCategory}` : ''}
SPECIFICATIONS (source of truth — never invent or replace):
${specLines || '• Use only details clearly present in the product name'}
${comment ? `NOTES: ${String(comment).slice(0, 200)}` : ''}

PHOTO RULES (if photos are attached):
- Use photos ONLY for product appearance: remove background, improve lighting/shadows/reflections, center the product.
- Do NOT redesign hardware. Do NOT add missing parts, RAM sticks, coolers, IO shields, or cables.
- Keep exact component counts visible in photos (e.g. if one RAM stick, keep one).
- Keep realistic scratches/cosmetic marks.

LAYOUT:
- Product centered, ~60–70% of canvas, lots of white space.
- Large bold product title at top.
- Small premium spec labels around the product without covering it.
- Thin separators, soft shadows, rounded info chips only.
- Colors: white, light gray, dark gray, black + ONE brand accent (Intel blue / AMD orange / NVIDIA green / ASUS red as appropriate).

OUTPUT: One square high-resolution product card image suitable for marketplace listings. Return ONLY the image.`;
}

export async function handleProductCardGemini(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = pickEnv('GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'VITE_API_KEY');
  if (!apiKey) {
    return res.status(503).json({
      error:
        'GEMINI_API_KEY not set. Create a key at https://aistudio.google.com/apikey and add GEMINI_API_KEY (Vercel) or VITE_GEMINI_API_KEY (.env). A Gemini app Pro subscription alone is not an API key.',
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Product name required' });

  const specs = Array.isArray(body.specs) ? body.specs : [];
  const category = String(body.category || '');
  const subCategory = String(body.subCategory || '');
  const comment = String(body.comment || '');

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

    const prompt = buildCardPrompt({ name, category, subCategory, specs, comment });
    const parts = [...imageParts, { text: prompt }];

    let lastError = '';
    let rateLimited = false;

    for (const model of IMAGE_MODELS) {
      try {
        const resAi = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                temperature: 0.4,
              },
            }),
          }
        );

        if (resAi.status === 429) {
          rateLimited = true;
          lastError = 'Gemini image quota exceeded (429). Wait a minute or check billing/quota in Google AI Studio.';
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
              note: imageParts.length
                ? 'Premium card from specs + your photos'
                : 'Premium card from product name & specs (no photos attached)',
            });
          }
        }
        lastError = `${model}: no image in response`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Gemini request failed';
      }
    }

    return res.status(rateLimited ? 429 : 503).json({
      error: lastError || 'Gemini could not generate a product card image.',
      hint: 'Use an API key from https://aistudio.google.com/apikey with image generation access. Consumer Gemini Pro chat subscription is separate.',
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Product card generation failed' });
  }
}
