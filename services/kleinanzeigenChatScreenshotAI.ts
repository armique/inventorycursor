/**
 * Parse Kleinanzeigen chat screenshots via vision models (mirror of eBay order screenshot flow).
 */
import {
  KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT,
  parseExtractedSaleDate,
} from '../lib/kleinanzeigenChatScreenshotPrompt.js';
import { normalizeImgurImageUrl } from './ebayOrderScreenshotAI';

export interface ParsedKleinanzeigenChatScreenshot {
  buyerName: string | null;
  agreedPriceEur: number | null;
  paymentMethod: string | null;
  saleDate: string | null;
  chatUrl: string | null;
  itemTitle: string | null;
}

function clientGeminiKey(): string {
  const gemini = import.meta.env.VITE_GEMINI_API_KEY;
  const legacy = import.meta.env.VITE_API_KEY;
  const g = typeof gemini === 'string' ? gemini.trim() : '';
  const l = typeof legacy === 'string' ? legacy.trim() : '';
  return g || l;
}

function parseEur(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeParsed(raw: unknown): ParsedKleinanzeigenChatScreenshot {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    buyerName: str(o.buyerName),
    agreedPriceEur: parseEur(o.agreedPriceEur),
    paymentMethod: str(o.paymentMethod),
    saleDate: parseExtractedSaleDate(o.saleDate),
    chatUrl: str(o.chatUrl),
    itemTitle: str(o.itemTitle),
  };
}

async function parseViaServerApi(body: {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<ParsedKleinanzeigenChatScreenshot | null> {
  try {
    const res = await fetch('/api/parse-kleinanzeigen-chat-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { parsed?: ParsedKleinanzeigenChatScreenshot; error?: string } | null;
    if (res.ok && data?.parsed) return data.parsed;
    if (res.status === 500 && data?.error?.includes('missing Gemini')) return null;
    if (!res.ok && data?.error) throw new Error(data.error);
  } catch (e) {
    if (e instanceof Error && !e.message.includes('Failed to fetch')) throw e;
  }
  return null;
}

export function mapKleinanzeigenPaymentMethod(raw: string | null): import('../types').PaymentType {
  const m = (raw || '').toLowerCase();
  if (m.includes('paypal')) return 'Kleinanzeigen (Paypal)';
  if (m.includes('direkt')) return 'Kleinanzeigen (Direkt Kaufen)';
  if (m.includes('überweis') || m.includes('wire') || m.includes('bank')) return 'Kleinanzeigen (Wire Transfer)';
  if (m.includes('cash') || m.includes('bar')) return 'Kleinanzeigen (Cash)';
  return 'Kleinanzeigen (Cash)';
}

export async function parseKleinanzeigenChatFromImageInput(rawInput: string): Promise<ParsedKleinanzeigenChatScreenshot> {
  const input = rawInput.trim();
  if (!input) throw new Error('Upload a chat screenshot or paste an image URL first.');

  let geminiMime = 'image/jpeg';
  let geminiBase64: string | null = null;
  let normalizedHttpUrl: string | null = null;

  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]*);base64,(.+)$/);
    if (!m) throw new Error('Invalid image data URL.');
    geminiMime = m[1] && m[1].length > 0 ? m[1] : 'image/jpeg';
    geminiBase64 = m[2] ?? null;
  } else if (/^https?:\/\//i.test(input)) {
    normalizedHttpUrl = normalizeImgurImageUrl(input);
  } else {
    throw new Error('Use an https image link or upload a file from this device.');
  }

  let parsed: ParsedKleinanzeigenChatScreenshot | null = null;
  if (geminiBase64) {
    parsed = await parseViaServerApi({ imageBase64: geminiBase64, mimeType: geminiMime });
  } else if (normalizedHttpUrl) {
    parsed = await parseViaServerApi({ imageUrl: normalizedHttpUrl });
  }
  if (parsed) return parsed;

  if (!clientGeminiKey()) {
    throw new Error('No AI key configured. Add GEMINI_API_KEY on Vercel or VITE_GEMINI_API_KEY locally.');
  }
  throw new Error('Could not parse chat screenshot. Try a clearer screenshot or upload directly.');
}
