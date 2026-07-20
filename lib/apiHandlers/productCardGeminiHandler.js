/**
 * AI product card image generation: Gemini and/or OpenAI (GPT Image).
 * Body.provider: "gemini" | "openai" (default openai if key present, else gemini).
 */
import { getProductCardStyle } from '../productCardStyles.js';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';
import { getServerAIKeys } from '../serverAIEnv.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;

const GEMINI_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
const OPENAI_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];

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

export function buildCardPrompt({
  name,
  category,
  subCategory,
  specs,
  comment,
  styleId,
  editFromPhoto,
  hasOVP,
  hasIOShield,
  perks,
  variantFocus,
  cardIndex,
  cardCount,
}) {
  const style = getProductCardStyle(styleId);
  const specLines = Array.isArray(specs)
    ? specs
        .slice(0, 8)
        .map((s) => `• ${s.label}: ${s.value}`)
        .join('\n')
    : '';

  const perkList = Array.isArray(perks)
    ? perks.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const perkLines = perkList.map((p) => `• ${p}`).join('\n');

  const accessoryLines = [];
  if (hasOVP === true) {
    accessoryLines.push(
      '• ORIGINAL BOX / OVP: YES — add a clear TEXT badge on the card such as "Mit OVP" or "Originalverpackung".'
    );
  }
  if (hasIOShield === true) {
    accessoryLines.push(
      '• IO SHIELD / IO-BLENDE: YES — add a clear TEXT badge on the card such as "IO-Blende inklusive" or "inkl. IO-Shield".'
    );
  }
  const accessoryBlock =
    accessoryLines.length > 0
      ? `ACCESSORY FLAGS (from inventory — TEXT BADGES ONLY):
${accessoryLines.join('\n')}
- These are listing badges only. Do NOT invent or draw a physical IO-shield plate, box, or cables into the product photo unless already visible in the attached photos.`
      : `ACCESSORY FLAGS:
- No OVP / IO-Blende flags for THIS card. Do NOT invent "Mit OVP" or "IO-Blende" badges on this variant.`;

  const photoBlock = editFromPhoto
    ? `PHOTO EDIT MODE (CRITICAL — photos ARE attached):
- You MUST edit / compose FROM the attached user photo(s). Do NOT invent a random different product image.
- Keep the exact same hardware identity from the photo: shape, ports, labels, stickers, component counts.
- Remove cluttered background → clean studio look matching the style below.
- Improve lighting, soft shadows, optional reflection if the style asks for it.
- Do NOT redesign hardware. Do NOT add missing parts, RAM sticks, coolers, IO shields, or cables.
- Keep realistic scratches/cosmetic marks from the photo.
- Then add premium title + spec labels around the product as a marketplace card.`
    : `PHOTO RULES (if photos are attached):
- Use photos ONLY for product appearance: remove background, improve lighting/shadows/reflections, center the product.
- Do NOT redesign hardware. Do NOT add missing parts, RAM sticks, coolers, IO shields, or cables.
- Keep exact component counts visible in photos (e.g. if one RAM stick, keep one).
- Keep realistic scratches/cosmetic marks.`;

  const total = Math.max(1, Number(cardCount) || 1);
  const idx = Math.max(0, Number(cardIndex) || 0);
  const variantBlock =
    total > 1
      ? `CARD VARIANT ${idx + 1} of ${total} (CRITICAL — make this card visually distinct from siblings):
- ${variantFocus || 'Use a different feature mix than other cards in this batch.'}
- ONLY show the specifications listed below for this variant — do NOT dump every possible spec.
- ONLY show the marketing perks listed below — do NOT reuse perks meant for other variants.
- Change layout emphasis (e.g. big specs vs perk badges vs accessory callouts) so cards don't look copy-pasted.
- Do NOT invent specs or perks that are not listed.`
      : variantFocus
        ? `CARD FOCUS:\n- ${variantFocus}`
        : '';

  return `You are a senior Product Marketing Designer creating ONE premium product card PNG for eBay.de / Kleinanzeigen.

Follow this design style EXACTLY (this is the chosen look — do not mix with other styles):
${style.prompt}

PRODUCT NAME (source of truth — use exactly, do not invent a different product): ${name}
CATEGORY: ${category || 'Hardware'}${subCategory ? ` / ${subCategory}` : ''}
SPECIFICATIONS FOR THIS CARD (source of truth — never invent values; only use these):
${specLines || '• Use only details clearly present in the product name'}
${perkLines ? `MARKETING PERKS FOR THIS CARD (use these, not a generic identical set):\n${perkLines}` : ''}
${comment ? `NOTES: ${String(comment).slice(0, 200)}` : ''}

${variantBlock}

${accessoryBlock}

${photoBlock}

GLOBAL RULES:
- Fully AI-composed card (layout + typography + composition). No template placeholders.
- No watermarks, no fake brand logos floating in the design.
- Square high-resolution image suitable for marketplace listings.
- Return ONLY the image.`;
}

async function collectPhotoBuffers(body) {
  const out = [];
  const rawList = [];
  if (Array.isArray(body.images)) rawList.push(...body.images);
  if (body.imageBase64) rawList.push({ imageBase64: body.imageBase64 });
  if (body.imageUrl) rawList.push({ imageUrl: body.imageUrl });

  for (const entry of rawList.slice(0, MAX_PHOTOS)) {
    try {
      if (entry?.imageBase64) {
        out.push(bufferFromBase64(entry.imageBase64));
      } else if (entry?.imageUrl && String(entry.imageUrl).startsWith('data:')) {
        out.push(bufferFromBase64(entry.imageUrl));
      } else if (entry?.imageUrl) {
        out.push(await fetchImageBuffer(String(entry.imageUrl).trim()));
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

async function generateWithGemini(apiKey, prompt, photoBuffers) {
  const imageParts = photoBuffers.map(({ buf, mime }) => ({
    inline_data: { mime_type: mime, data: buf.toString('base64') },
  }));
  const parts = [...imageParts, { text: prompt }];

  let lastError = '';
  let rateLimited = false;
  let authFailed = false;

  for (const model of GEMINI_MODELS) {
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
      lastError = `Gemini auth failed (${resAi.status}). ${(await resAi.text()).slice(0, 160)}`;
      break;
    }
    if (resAi.status === 429) {
      rateLimited = true;
      lastError =
        'Gemini image quota exceeded (429). Enable billing in AI Studio or wait for reset. Switch provider to OpenAI.';
      continue;
    }
    if (!resAi.ok) {
      lastError = `${model}: ${resAi.status} ${(await resAi.text()).slice(0, 240)}`;
      continue;
    }

    const data = await resAi.json();
    const outParts = data.candidates?.[0]?.content?.parts || [];
    for (const part of outParts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        return {
          imageBase64: inline.data,
          mimeType: inline.mimeType || inline.mime_type || 'image/png',
          provider: 'Gemini',
          model,
        };
      }
    }
    lastError = `${model}: no image in response`;
  }

  const err = new Error(lastError || 'Gemini could not generate a product card image.');
  err.status = authFailed ? 401 : rateLimited ? 429 : 503;
  throw err;
}

async function generateWithOpenAI(apiKey, prompt, photoBuffers) {
  let lastError = '';
  let rateLimited = false;
  let authFailed = false;

  for (const model of OPENAI_MODELS) {
    try {
      let resAi;
      if (photoBuffers.length > 0) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt.slice(0, 32000));
        form.append('size', '1024x1024');
        form.append('quality', 'medium');
        for (let i = 0; i < photoBuffers.length; i++) {
          const { buf, mime } = photoBuffers[i];
          const ext = /png/i.test(mime) ? 'png' : 'jpg';
          const blob = new Blob([Uint8Array.from(buf)], { type: mime || 'image/jpeg' });
          // Multipart: single → image; multi → image[]
          const field = photoBuffers.length === 1 ? 'image' : 'image[]';
          form.append(field, blob, `ref-${i}.${ext}`);
        }
        resAi = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } else {
        resAi = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt: prompt.slice(0, 32000),
            size: '1024x1024',
            quality: 'medium',
            n: 1,
          }),
        });
      }

      if (resAi.status === 401 || resAi.status === 403) {
        authFailed = true;
        lastError = `OpenAI auth failed (${resAi.status}). Check OPENAI_API_KEY. ${(await resAi.text()).slice(0, 160)}`;
        break;
      }
      if (resAi.status === 429) {
        rateLimited = true;
        lastError = 'OpenAI rate/quota exceeded (429). Check billing at platform.openai.com or retry later.';
        continue;
      }
      if (!resAi.ok) {
        lastError = `${model}: ${resAi.status} ${(await resAi.text()).slice(0, 280)}`;
        continue;
      }

      const data = await resAi.json();
      const b64 = data.data?.[0]?.b64_json;
      if (b64) {
        return {
          imageBase64: b64,
          mimeType: 'image/png',
          provider: 'OpenAI',
          model,
        };
      }
      lastError = `${model}: no image in response`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'OpenAI request failed';
    }
  }

  const err = new Error(lastError || 'OpenAI could not generate a product card image.');
  err.status = authFailed ? 401 : rateLimited ? 429 : 503;
  throw err;
}

export async function handleProductCardProviders(req, res) {
  // Ensure .env is merged (via gemini helper)
  getGeminiKeyForServer();
  const keys = getServerAIKeys();
  return res.status(200).json({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        available: Boolean(sanitizeApiKey(keys.openai)),
        blurb: 'GPT Image · ~$0.05/card (medium)',
      },
      {
        id: 'gemini',
        name: 'Gemini',
        available: Boolean(sanitizeApiKey(keys.gemini)),
        blurb: 'Flash Image · ~$0.04/card (quota limited on free)',
      },
    ],
  });
}

export async function handleProductCardGemini(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  getGeminiKeyForServer();
  const keys = getServerAIKeys();
  const geminiKey = sanitizeApiKey(keys.gemini);
  const openaiKey = sanitizeApiKey(keys.openai);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Product name required' });

  let provider = String(body.provider || '').trim().toLowerCase();
  if (provider !== 'gemini' && provider !== 'openai') {
    provider = openaiKey ? 'openai' : 'gemini';
  }

  if (provider === 'openai' && !openaiKey) {
    return res.status(503).json({
      error: 'OPENAI_API_KEY not set. Add it to .env / Vercel, or switch provider to Gemini.',
    });
  }
  if (provider === 'gemini' && !geminiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY not set. Add it to .env / Vercel, or switch provider to OpenAI.',
    });
  }

  const specs = Array.isArray(body.specs) ? body.specs : [];
  const category = String(body.category || '');
  const subCategory = String(body.subCategory || '');
  const comment = String(body.comment || '');
  const styleId = String(body.styleId || '').trim();
  const style = getProductCardStyle(styleId);
  const hasOVP = body.hasOVP === true || body.hasOVP === 'true' || body.hasOVP === 1;
  const hasIOShield =
    body.hasIOShield === true || body.hasIOShield === 'true' || body.hasIOShield === 1;
  const perks = Array.isArray(body.perks) ? body.perks : [];
  const variantFocus = String(body.variantFocus || '').trim();
  const cardIndex = Number.isFinite(Number(body.cardIndex)) ? Number(body.cardIndex) : 0;
  const cardCount = Number.isFinite(Number(body.cardCount)) ? Number(body.cardCount) : 1;

  try {
    const photoBuffers = await collectPhotoBuffers(body);
    const editFromPhoto = Boolean(body.editFromPhoto) || photoBuffers.length > 0;
    const prompt = buildCardPrompt({
      name,
      category,
      subCategory,
      specs,
      comment,
      styleId: style.id,
      editFromPhoto,
      hasOVP,
      hasIOShield,
      perks,
      variantFocus,
      cardIndex,
      cardCount,
    });

    const result =
      provider === 'openai'
        ? await generateWithOpenAI(openaiKey, prompt, photoBuffers)
        : await generateWithGemini(geminiKey, prompt, photoBuffers);

    return res.status(200).json({
      ...result,
      styleId: style.id,
      styleName: style.name,
      note: photoBuffers.length
        ? `${style.name} · specs + your photos`
        : `${style.name} · name & specs (no photos)`,
    });
  } catch (e) {
    const status = e?.status && Number.isFinite(e.status) ? e.status : 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Product card generation failed',
      hint:
        provider === 'openai'
          ? 'Check OPENAI_API_KEY and billing at https://platform.openai.com'
          : 'Check GEMINI_API_KEY / image quota, or switch provider to OpenAI.',
    });
  }
}
