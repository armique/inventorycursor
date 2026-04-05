/**
 * Parse eBay order screenshots (e.g. Seller Hub / Verkäufer-Cockpit) via vision models.
 * Uses VITE_GEMINI_API_KEY (inline image) and/or VITE_OPENAI_API_KEY (URL or inline).
 */

export interface ParsedEbayOrderScreenshot {
  ebayOrderId: string | null;
  ebayUsername: string | null;
  buyerFullName: string | null;
  shippingAddress: string | null;
  phone?: string | null;
}

const getEnv = (key: string): string => {
  try {
    return (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env[key] as string)) || '';
  } catch {
    return '';
  }
};

const EXTRACTION_PROMPT = `You are reading an eBay or eBay.de order details screenshot. Labels may be German:
- "Bestellung" = order ID
- "Lieferadresse" / shipping section = delivery address
- "Käufer" = buyer line, often "Full Name (ebay_username)"

Return one JSON object only (no markdown):
{
  "ebayOrderId": string | null,
  "ebayUsername": string | null,
  "buyerFullName": string | null,
  "shippingAddress": string | null,
  "phone": string | null
}

Rules:
- ebayOrderId: ID like "19-11447-34715" (digits and dashes) next to Bestellung / Order.
- ebayUsername: ONLY the eBay member id. If the buyer line is "Name (handle)", use "handle". Never put the real name here.
- buyerFullName: recipient name from the shipping address block.
- shippingAddress: street, postal code + city, country as plain text; use newline characters between lines. Do not put phone here.
- phone: only if clearly shown (e.g. +49 ...).

Use null for anything not visible. Do not invent data.`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Turn imgur.com/xxxxx page links into a direct i.imgur.com image URL (best effort). */
export function normalizeImgurImageUrl(url: string): string {
  const trimmed = url.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'imgur.com') return trimmed;
  if (u.pathname.startsWith('/a/') || u.pathname.startsWith('/gallery/')) return trimmed;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return trimmed;
  const id = segments[0];
  if (!id || !/^[a-zA-Z0-9]+$/.test(id)) return trimmed;
  return `https://i.imgur.com/${id}.jpg`;
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Could not load image (${res.status}). Try a direct i.imgur.com/….jpg link or upload the file.`);
  const blob = await res.blob();
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg';
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { mime, base64 };
}

function normalizeParsed(raw: unknown): ParsedEbayOrderScreenshot {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    ebayOrderId: str(o.ebayOrderId),
    ebayUsername: str(o.ebayUsername),
    buyerFullName: str(o.buyerFullName),
    shippingAddress: str(o.shippingAddress),
    phone: str(o.phone) ?? undefined,
  };
}

async function parseWithGemini(mime: string, base64: string): Promise<ParsedEbayOrderScreenshot> {
  const apiKey = getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: mime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
  const parsed = JSON.parse(text) as unknown;
  return normalizeParsed(parsed);
}

async function parseWithOpenAI(imageUrl: string): Promise<ParsedEbayOrderScreenshot> {
  const apiKey = getEnv('VITE_OPENAI_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(text) as unknown;
  return normalizeParsed(parsed);
}

/**
 * @param rawInput - Image data URL (e.g. from file upload) or public https image URL (Imgur direct links, etc.)
 */
export async function parseEbayOrderFromImageInput(rawInput: string): Promise<ParsedEbayOrderScreenshot> {
  const input = rawInput.trim();
  if (!input) throw new Error('Paste an image URL or upload a screenshot first.');

  let geminiMime = 'image/jpeg';
  let geminiBase64: string | null = null;
  let openAiRef: string | null = null;

  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]*);base64,(.+)$/);
    if (!m) throw new Error('Invalid image data URL.');
    geminiMime = m[1] && m[1].length > 0 ? m[1] : 'image/jpeg';
    geminiBase64 = m[2] ?? null;
    openAiRef = input;
  } else if (/^https?:\/\//i.test(input)) {
    const url = normalizeImgurImageUrl(input);
    openAiRef = url;
    try {
      const { mime, base64 } = await fetchImageAsBase64(url);
      geminiMime = mime;
      geminiBase64 = base64;
      openAiRef = `data:${mime};base64,${base64}`;
    } catch {
      /* OpenAI may still fetch the https URL server-side */
    }
  } else {
    throw new Error('Use an https image link or upload a file from this device.');
  }

  const hasGemini = !!(getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim());
  const hasOpenAI = !!getEnv('VITE_OPENAI_API_KEY')?.trim();

  if (!hasGemini && !hasOpenAI) {
    throw new Error('Add VITE_GEMINI_API_KEY or VITE_OPENAI_API_KEY in .env for AI screenshot parsing.');
  }

  const errors: string[] = [];

  if (geminiBase64 && hasGemini) {
    try {
      return await parseWithGemini(geminiMime, geminiBase64);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (hasOpenAI && openAiRef) {
    try {
      return await parseWithOpenAI(openAiRef);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (hasOpenAI && /^https?:\/\//i.test(input) && openAiRef !== input) {
    try {
      return await parseWithOpenAI(normalizeImgurImageUrl(input));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  throw new Error(errors.length ? errors.join(' · ') : 'Could not parse screenshot.');
}
