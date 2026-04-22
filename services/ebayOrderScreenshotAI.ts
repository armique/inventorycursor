/**
 * Parse eBay order screenshots (e.g. Seller Hub / Verkäufer-Cockpit) via vision models.
 * Production: prefers /api/parse-ebay-order-screenshot (server fetches URLs, fixes Imgur CORS).
 * Fallback: browser → Gemini (VITE_GEMINI_API_KEY) or OpenAI.
 */

import { EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT } from '../lib/ebayOrderScreenshotPrompt.js';

export interface ParsedEbayOrderScreenshot {
  ebayOrderId: string | null;
  ebayUsername: string | null;
  buyerFullName: string | null;
  shippingAddress: string | null;
  phone?: string | null;
  /** Seller's net EUR after eBay / ad fees when visible on the screenshot. */
  amountReceivedNetEur?: number | null;
}

/**
 * Vite only embeds `VITE_*` values when you use static property access.
 * Dynamic `import.meta.env[key]` stays empty in production builds — do not use it here.
 */
function clientGeminiKey(): string {
  const gemini = import.meta.env.VITE_GEMINI_API_KEY;
  const legacy = import.meta.env.VITE_API_KEY;
  const g = typeof gemini === 'string' ? gemini.trim() : '';
  const l = typeof legacy === 'string' ? legacy.trim() : '';
  return g || l;
}

function clientOpenAIKey(): string {
  const v = import.meta.env.VITE_OPENAI_API_KEY;
  return typeof v === 'string' ? v.trim() : '';
}

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Could not load image (${res.status}). Try upload or a direct i.imgur.com link.`);
  const blob = await res.blob();
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg';
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { mime, base64 };
}

function parseNetEurAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeParsed(raw: unknown): ParsedEbayOrderScreenshot {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const net = parseNetEurAmount(o.amountReceivedNetEur);
  return {
    ebayOrderId: str(o.ebayOrderId),
    ebayUsername: str(o.ebayUsername),
    buyerFullName: str(o.buyerFullName),
    shippingAddress: str(o.shippingAddress),
    phone: str(o.phone) ?? undefined,
    amountReceivedNetEur: net,
  };
}

type ServerParseOutcome =
  | { kind: 'ok'; parsed: ParsedEbayOrderScreenshot }
  | { kind: 'no_api' }
  | { kind: 'fail'; message: string };

/** Vercel /api route: server-side Gemini + image fetch (no CORS). */
async function parseViaServerApi(body: {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<ServerParseOutcome> {
  try {
    const res = await fetch('/api/parse-ebay-order-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { parsed?: ParsedEbayOrderScreenshot; error?: string } | null;
    if (res.ok && data?.parsed) return { kind: 'ok', parsed: data.parsed };
    if (res.status === 404) return { kind: 'no_api' };
    return { kind: 'fail', message: data?.error || `Screenshot API failed (${res.status}).` };
  } catch {
    return { kind: 'no_api' };
  }
}

const GEMINI_VISION_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function parseWithGemini(mime: string, base64: string): Promise<ParsedEbayOrderScreenshot> {
  const apiKey = clientGeminiKey();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set');

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT },
          {
            inlineData: {
              mimeType: mime,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  });

  const errors: string[] = [];
  for (const model of GEMINI_VISION_MODELS) {
    let handled = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }
      );
      const raw = await res.text();
      if (!res.ok) {
        const transient = res.status === 429 || res.status === 500 || res.status === 503;
        if (res.status === 404) {
          errors.push(`${model}: ${res.status}`);
          handled = true;
          break;
        }
        if (transient && attempt < 3) {
          await sleep(250 * attempt);
          continue;
        }
        if (transient) {
          errors.push(`${model}: ${res.status}`);
          handled = true;
          break;
        }
        throw new Error(`Gemini: ${res.status} ${raw.slice(0, 300)}`);
      }
      let data: {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        promptFeedback?: { blockReason?: string };
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error('Gemini returned invalid JSON envelope');
      }
      const cand = data.candidates?.[0];
      if (!cand) {
        errors.push(`${model}: blocked (${data.promptFeedback?.blockReason || 'unknown'})`);
        handled = true;
        break;
      }
      const text = cand.content?.parts?.[0]?.text?.trim() || '{}';
      const parsed = JSON.parse(text) as unknown;
      return normalizeParsed(parsed);
    }
    if (!handled) continue;
  }

  throw new Error(`Gemini: no model worked (${errors.join('; ')})`);
}

async function parseWithOpenAI(imageUrl: string): Promise<ParsedEbayOrderScreenshot> {
  const apiKey = clientOpenAIKey();
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
            { type: 'text', text: EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT },
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
  let normalizedHttpUrl: string | null = null;

  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]*);base64,(.+)$/);
    if (!m) throw new Error('Invalid image data URL.');
    geminiMime = m[1] && m[1].length > 0 ? m[1] : 'image/jpeg';
    geminiBase64 = m[2] ?? null;
    openAiRef = input;
  } else if (/^https?:\/\//i.test(input)) {
    const url = normalizeImgurImageUrl(input);
    normalizedHttpUrl = url;
    openAiRef = url;
    try {
      const { mime, base64 } = await fetchImageAsBase64(url);
      geminiMime = mime;
      geminiBase64 = base64;
      openAiRef = `data:${mime};base64,${base64}`;
    } catch {
      /* Server API or OpenAI may still load the URL */
    }
  } else {
    throw new Error('Use an https image link or upload a file from this device.');
  }

  // 1) Vercel /api route: server downloads https images (fixes Imgur CORS) and calls Gemini.
  let serverOutcome: ServerParseOutcome = { kind: 'no_api' };
  if (input.startsWith('data:') && geminiBase64) {
    serverOutcome = await parseViaServerApi({ imageBase64: geminiBase64, mimeType: geminiMime });
  } else if (normalizedHttpUrl) {
    serverOutcome = await parseViaServerApi({ imageUrl: normalizedHttpUrl });
  }
  if (serverOutcome.kind === 'ok') return serverOutcome.parsed;

  const hasGemini = !!clientGeminiKey();
  const hasOpenAI = !!clientOpenAIKey();

  if (!hasGemini && !hasOpenAI) {
    if (serverOutcome.kind === 'fail') {
      throw new Error(
        `${serverOutcome.message} On Vercel, add GEMINI_API_KEY (recommended) or ensure API routes receive your key, then redeploy. Locally use .env / .env.local with GEMINI_API_KEY or VITE_GEMINI_API_KEY; use \`vercel dev\` if you need /api on localhost.`
      );
    }
    throw new Error(
      'Add VITE_GEMINI_API_KEY or VITE_OPENAI_API_KEY: in .env (local) restart the dev server; on Vercel set it for Production and redeploy so the key is included in the build.'
    );
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
