/**
 * Shared Gemini vision + JSON extraction for screenshot parsers.
 * Model order matters: free-tier keys often exhaust gemini-2.0-* quota while 2.5 still works.
 */

/** Prefer models that support image input + JSON output on the Generative Language API. */
export const GEMINI_VISION_MODELS = [
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseGeminiErrorMessage(rawText) {
  try {
    const data = JSON.parse(rawText);
    const msg = data?.error?.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    /* ignore */
  }
  return rawText.slice(0, 200).replace(/\s+/g, ' ').trim();
}

function isQuotaError(status, rawText) {
  if (status !== 429) return false;
  const lower = rawText.toLowerCase();
  return lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('rate limit');
}

function retryDelayMs(res, attempt) {
  const header = res.headers?.get?.('retry-after');
  if (header) {
    const sec = parseInt(header, 10);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 30000);
  }
  return Math.min(12000, 800 * 2 ** (attempt - 1));
}

/**
 * @param {{ apiKey: string; prompt: string; mime: string; base64: string; maxOutputTokens?: number }} opts
 * @returns {Promise<{ parsed: unknown; model: string }>}
 */
export async function callGeminiVisionJson(opts) {
  const { apiKey, prompt, mime, base64, maxOutputTokens = 1024 } = opts;
  if (!apiKey?.trim()) throw new Error('Gemini API key missing');

  const geminiBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mime, data: base64.replace(/\s/g, '') } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens,
    },
  };

  const errors = [];
  let sawGlobalQuota = false;

  for (const model of GEMINI_VISION_MODELS) {
    if (sawGlobalQuota && /gemini-2\.0-flash/.test(model)) {
      continue;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      const rawText = await res.text();

      if (!res.ok) {
        const msg = parseGeminiErrorMessage(rawText);
        if (res.status === 404) {
          errors.push(`${model}: unavailable`);
          break;
        }
        if (res.status === 429 || res.status === 503 || res.status === 500) {
          if (attempt < 3) {
            await sleep(retryDelayMs(res, attempt));
            continue;
          }
          errors.push(`${model}: ${res.status}`);
          if (isQuotaError(res.status, rawText) && /gemini-2\.0/.test(model)) {
            sawGlobalQuota = true;
          }
          break;
        }
        throw new Error(`Gemini ${model}: ${res.status} ${msg}`);
      }

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error('Gemini returned invalid JSON envelope');
      }

      const candidate = data.candidates?.[0];
      if (!candidate) {
        errors.push(`${model}: blocked (${data.promptFeedback?.blockReason || 'unknown'})`);
        break;
      }

      const text = candidate.content?.parts?.[0]?.text?.trim() || '{}';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Gemini ${model} returned non-JSON content`);
      }

      return { parsed, model };
    }
  }

  throw new Error(formatGeminiVisionFailure(errors));
}

export function formatGeminiVisionFailure(errors) {
  const detail = errors.length ? errors.join('; ') : 'unknown error';
  if (/429|quota|503/i.test(detail)) {
    return (
      `Gemini vision unavailable (${detail}). ` +
      'Your free-tier quota for older Flash models may be exhausted — wait a few minutes or enable billing in Google AI Studio. ' +
      'Alternatively add VITE_OPENAI_API_KEY for GPT-4o vision fallback.'
    );
  }
  return `Gemini: no model worked (${detail})`;
}
