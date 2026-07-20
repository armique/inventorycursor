/**
 * Auto-fill tech specs using any available AI.
 * FREE options: Groq, Ollama, Gemini, Together, Mistral (add keys to .env).
 * Paid: OpenAI, Anthropic.
 * When one provider fails (rate limit, etc.) the system tries the next in order until one succeeds.
 */

import { correctGpuVramInSpecs } from './gpuVramCorrection';
import { correctRamSpecsFromPartNumber } from './ramPartNumberCorrection';
import { filterSpecsToEssentialKeys } from './essentialSpecFields';
import { loadAISettings } from './aiSettings';
import { ItemStatus } from '../types';

const getEnv = (key: string): string => {
  try {
    return (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env[key] as string)) || '';
  } catch {
    return '';
  }
};

type Provider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'together' | 'mistral';

export type AIProviderId = Provider;

/** Text models — lite first (higher free-tier quota). */
const GEMINI_TEXT_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(message: string): boolean {
  return /429|rate.?limit|resource.?exhausted|quota|too many requests/i.test(message);
}

export function formatAIProviderError(provider: AIProviderId, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const label = PROVIDER_LABELS[provider] || provider;
  if (isRateLimitError(msg)) {
    return `${label}: quota exceeded (429). Uncheck ${label} and use Groq/Together/Mistral, or wait a few minutes.`;
  }
  if (msg.startsWith(`${label}:`) || msg.startsWith('Gemini:')) {
    return msg.replace(/^Gemini:/, `${label}:`);
  }
  return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
}

/** Default Card Studio providers — Groq/Together first; Gemini last (strict free quota). */
export function getDefaultCardStudioProviderIds(
  providers: { id: AIProviderId }[]
): AIProviderId[] {
  const nonGemini = providers.filter((p) => p.id !== 'gemini');
  const ordered =
    nonGemini.length >= 3
      ? nonGemini
      : [...nonGemini, ...providers.filter((p) => p.id === 'gemini')];
  return ordered.slice(0, 3).map((p) => p.id);
}

async function fetchGeminiText(
  apiKey: string,
  prompt: string,
  generationConfig: Record<string, unknown>
): Promise<string> {
  let lastError: Error | null = null;
  for (const model of GEMINI_TEXT_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
          }),
        }
      );
      if (res.status === 429 && attempt === 0) {
        await sleep(2500);
        continue;
      }
      if (!res.ok) {
        const errBody = await res.text();
        lastError = new Error(
          res.status === 429
            ? `Gemini: 429 quota exceeded (${model}). Free tier limits — try Groq or wait ~1 min.`
            : `Gemini: ${res.status} ${errBody.slice(0, 200)}`
        );
        if (res.status === 429) break;
        throw lastError;
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
    }
  }
  throw lastError ?? new Error('Gemini: all models failed');
}

const PAID_PROVIDERS: Provider[] = ['openai', 'anthropic'];

/** Order: free / generous first, then paid. Used for cycling when one fails. */
const PROVIDER_ORDER: Provider[] = ['groq', 'ollama', 'gemini', 'together', 'mistral', 'openai', 'anthropic'];

/** Returns list of providers that have required env set, in priority order. */
function getAvailableProviders(): Provider[] {
  const env = {
    groq: getEnv('VITE_GROQ_API_KEY')?.trim(),
    ollama: getEnv('VITE_OLLAMA_URL')?.trim(),
    gemini: getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim(),
    together: getEnv('VITE_TOGETHER_API_KEY')?.trim(),
    mistral: getEnv('VITE_MISTRAL_API_KEY')?.trim(),
    openai: getEnv('VITE_OPENAI_API_KEY')?.trim(),
    anthropic: getEnv('VITE_ANTHROPIC_API_KEY')?.trim(),
  };
  let order: Provider[] = PROVIDER_ORDER;
  try {
    const prefs = loadAISettings();
    const priority = prefs.providerPriority.filter((p): p is Provider => PROVIDER_ORDER.includes(p as Provider));
    order = [...priority, ...PROVIDER_ORDER.filter((p) => !priority.includes(p))];
    if (prefs.preferGroqForSpecs && env.groq) {
      order = ['groq', ...order.filter((p) => p !== 'groq')];
    }
  } catch {
    /* use default order */
  }
  return order.filter((p) => env[p]);
}

function getProvider(): Provider | null {
  const list = getAvailableProviders();
  return list.length > 0 ? list[0] : null;
}

function buildPrompt(name: string, rawCategory: string, knownKeys: string[]): string {
  let fieldInstruction = '';
  if (knownKeys.length > 0) {
    fieldInstruction = `
ESSENTIAL KEYS ONLY — return specs using EXACTLY these keys and nothing else:
${JSON.stringify(knownKeys)}

Rules:
- Map synonyms to the closest key (e.g. "DDR4" → "Memory Type", "16GB" → "Kit Capacity").
- Do NOT add extra geeky fields (no lithography, cache, threads, PCIe lanes, process node, etc.) unless the key is in the list above.
- Omit a key if you are unsure; do not guess.
`;
  } else {
    fieldInstruction = `
Return at most ${10} practical comparison specs with short key names (e.g. Socket, Model, Capacity).
Skip deep enthusiast stats (cache sizes, lithography, lane counts, etc.).
`;
  }
  return `Look up this hardware/product and extract only the essential comparison specs for inventory resale.

Item: "${name}"
Category: ${rawCategory}
${fieldInstruction}

Return a valid JSON object with this exact structure (no markdown, no code fence):
{"standardizedName":"...","vendor":"...","specs":{...}}

Rules: specs values can be string or number. Only include keys allowed above.

GRAPHICS CARDS (GPUs): For the "VRAM" field, use the exact frame-buffer memory of that GPU model only (e.g. RTX 5070 has 12GB VRAM). Do not use system RAM, total memory across unrelated devices, or another GPU tier. If the product name includes a GB figure next to the chip name (e.g. "RTX 5070 12GB"), that GB value is the VRAM.

RAM / MEMORY MODULES (think carefully — especially older DDR2/DDR3 OEM sticks):
- Decode the full manufacturer part number (SK Hynix HMT…, Samsung M378…/M471…, Micron MT…). Do not invent modern DDR4/DDR5 from a single digit in the SKU.
- Digits mid-P/N are often density organization or revision — NOT always module capacity.
  Critical example: "SK Hynix HMT351U6EFR8C" = 4GB DDR3 UDIMM (PC3). It is NOT 8GB and NOT DDR4. The trailing "8" is not capacity.
- HMT3… → DDR3 generation. HMT4… → DDR4 generation. Never upgrade an older generation.
- Hynix density "351" on HMT3 modules → 4GB; "41G" → 8GB. Prefer datasheet-accurate Memory Type + GB per Stick / Kit Capacity.
- If the title has no explicit "8GB"/"16GB" and the P/N decodes to 4GB DDR3, output 4GB DDR3.
- When unsure between DDR3 and DDR4, omit Memory Type rather than guessing DDR4.
- Prefer slower, older, conservative specs over "upgrading" vintage parts.`;
}

export interface GenerateSpecsResult {
  specs: Record<string, string | number>;
  standardizedName?: string;
  vendor?: string;
}

async function callOpenAI(prompt: string): Promise<GenerateSpecsResult> {
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
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(text) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

async function callAnthropic(prompt: string): Promise<GenerateSpecsResult> {
  const apiKey = getEnv('VITE_ANTHROPIC_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1536,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic: ${res.status} ${err}`);
  }
  const data = await res.json();
  const block = data.content?.find((c: { type: string }) => c.type === 'text');
  const text = block?.text?.trim() || '{}';
  // Strip possible markdown code fence
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(clean) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

async function callGemini(prompt: string): Promise<GenerateSpecsResult> {
  const apiKey = getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY / VITE_API_KEY not set');

  const text = await fetchGeminiText(apiKey, prompt, {
    responseMimeType: 'application/json',
    temperature: 0.2,
    maxOutputTokens: 1536,
  });
  const parsed = JSON.parse(text) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

/** Groq: free tier at console.groq.com — OpenAI-compatible API */
async function callGroq(prompt: string): Promise<GenerateSpecsResult> {
  const apiKey = getEnv('VITE_GROQ_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(text) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

/** Ollama: 100% free, local — no API key. Run "ollama run llama3.2" (or similar) first. */
async function callOllama(prompt: string): Promise<GenerateSpecsResult> {
  const baseUrl = (getEnv('VITE_OLLAMA_URL') || 'http://localhost:11434').replace(/\/$/, '');
  const model = getEnv('VITE_OLLAMA_MODEL') || 'llama3.2';

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: 'json',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama: ${res.status}. Is Ollama running? Run "ollama run ${model}" in a terminal.`);
  }
  const data = await res.json();
  const text = data.message?.content?.trim() || '{}';
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(clean) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

/** Together: OpenAI-compatible. Key at https://api.together.xyz/settings/api-keys */
async function callTogether(prompt: string): Promise<GenerateSpecsResult> {
  const apiKey = getEnv('VITE_TOGETHER_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_TOGETHER_API_KEY not set');
  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1536,
    }),
  });
  if (!res.ok) throw new Error(`Together: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(clean) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

/** Mistral: free tier. Key at https://console.mistral.ai */
async function callMistral(prompt: string): Promise<GenerateSpecsResult> {
  const apiKey = getEnv('VITE_MISTRAL_API_KEY')?.trim();
  if (!apiKey) throw new Error('VITE_MISTRAL_API_KEY not set');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1536,
    }),
  });
  if (!res.ok) throw new Error(`Mistral: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(clean) as GenerateSpecsResult;
  return { specs: parsed.specs || {}, standardizedName: parsed.standardizedName, vendor: parsed.vendor };
}

async function callProviderSpecs(provider: Provider, prompt: string): Promise<GenerateSpecsResult> {
  if (provider === 'groq') return await callGroq(prompt);
  if (provider === 'ollama') return await callOllama(prompt);
  if (provider === 'gemini') return await callGemini(prompt);
  if (provider === 'together') return await callTogether(prompt);
  if (provider === 'mistral') return await callMistral(prompt);
  if (provider === 'openai') return await callOpenAI(prompt);
  if (provider === 'anthropic') return await callAnthropic(prompt);
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Generate technical specs. Tries each configured provider in order; on failure (rate limit, etc.) tries the next until one succeeds.
 */
export async function generateItemSpecs(
  name: string,
  rawCategory: string,
  knownKeys: string[] = []
): Promise<GenerateSpecsResult> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error(
      'No AI configured. Add one or more to .env: VITE_GROQ_API_KEY, VITE_OLLAMA_URL, VITE_GEMINI_API_KEY, VITE_TOGETHER_API_KEY, VITE_MISTRAL_API_KEY.'
    );
  }
  const prompt = buildPrompt(name, rawCategory, knownKeys);
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      const raw = await callProviderSpecs(provider, prompt);
      const afterGpu = correctGpuVramInSpecs(name, raw.standardizedName, raw.specs || {});
      const corrected = correctRamSpecsFromPartNumber(
        name,
        raw.standardizedName,
        afterGpu,
        rawCategory
      );
      return {
        ...raw,
        specs: filterSpecsToEssentialKeys(corrected, knownKeys),
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`Specs AI [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

async function getRawJsonFromProvider(provider: Provider, prompt: string, maxTokens: number = 512): Promise<string> {
  const cap = Math.max(256, Math.min(maxTokens, 8192));
  const apiKeyG = getEnv('VITE_GROQ_API_KEY')?.trim();
  const apiKeyO = getEnv('VITE_OPENAI_API_KEY')?.trim();
  const apiKeyA = getEnv('VITE_ANTHROPIC_API_KEY')?.trim();
  const apiKeyGe = getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim();
  const apiKeyT = getEnv('VITE_TOGETHER_API_KEY')?.trim();
  const apiKeyM = getEnv('VITE_MISTRAL_API_KEY')?.trim();
  const baseUrlOllama = (getEnv('VITE_OLLAMA_URL') || 'http://localhost:11434').replace(/\/$/, '');
  const modelOllama = getEnv('VITE_OLLAMA_MODEL') || 'llama3.2';

  if (provider === 'groq' && apiKeyG) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyG}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: cap,
      }),
    });
    if (!res.ok) throw new Error(`Groq: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '{}';
  }
  if (provider === 'ollama' && baseUrlOllama) {
    const res = await fetch(`${baseUrlOllama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelOllama,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { num_predict: cap },
      }),
    });
    if (!res.ok) throw new Error(`Ollama: ${res.status}`);
    const data = await res.json();
    return (data.message?.content?.trim() || '{}').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  if (provider === 'gemini' && apiKeyGe) {
    return fetchGeminiText(apiKeyGe, prompt, {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: cap,
    });
  }
  if (provider === 'together' && apiKeyT) {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyT}` },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: cap,
      }),
    });
    if (!res.ok) throw new Error(`Together: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';
    return text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  if (provider === 'mistral' && apiKeyM) {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyM}` },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: cap,
      }),
    });
    if (!res.ok) throw new Error(`Mistral: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';
    return text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  if (provider === 'openai' && apiKeyO) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyO}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: cap,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '{}';
  }
  if (provider === 'anthropic' && apiKeyA) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKeyA, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: cap,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic: ${res.status}`);
    const data = await res.json();
    const block = data.content?.find((c: { type: string }) => c.type === 'text');
    return (block?.text?.trim() || '{}').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  throw new Error(`Provider ${provider} not configured`);
}

/** Call AI with a custom prompt; tries each configured provider until one succeeds. */
async function getRawJsonFromAI(prompt: string, maxTokens: number = 512): Promise<string> {
  const providers = getAvailableProviders();
  if (providers.length === 0) throw new Error('No AI configured. Add at least one key to .env.');
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await getRawJsonFromProvider(provider, prompt, maxTokens);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`AI [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

/** Request AI and parse response as JSON. Used by category suggestion and bulk text parsing. */
export async function requestAIJson<T = unknown>(prompt: string, options?: { maxTokens?: number }): Promise<T> {
  const raw = await getRawJsonFromAI(prompt, options?.maxTokens ?? 512);
  return JSON.parse(raw) as T;
}

/** Call a specific configured provider (for compare / A-B tests). */
export async function requestAIJsonFromProvider<T = unknown>(
  provider: AIProviderId,
  prompt: string,
  options?: { maxTokens?: number }
): Promise<T> {
  const raw = await getRawJsonFromProvider(provider, prompt, options?.maxTokens ?? 512);
  return JSON.parse(raw) as T;
}

export function listConfiguredAIProviders(): { id: AIProviderId; label: string; tier: 'free' | 'paid' }[] {
  return getAvailableProviders().map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    tier: PAID_PROVIDERS.includes(id) ? 'paid' : 'free',
  }));
}

export function getAIProviderLabel(id: AIProviderId): string {
  return PROVIDER_LABELS[id] || id;
}

// --- Plain-text generation (e.g. store descriptions) ---

const DEFAULT_TEXT_MAX_TOKENS = 512;
const STORE_DESCRIPTION_MAX_TOKENS = 1536;

async function getRawTextFromProvider(provider: Provider, prompt: string, maxTokens: number = DEFAULT_TEXT_MAX_TOKENS): Promise<string> {
  const apiKeyG = getEnv('VITE_GROQ_API_KEY')?.trim();
  const apiKeyO = getEnv('VITE_OPENAI_API_KEY')?.trim();
  const apiKeyA = getEnv('VITE_ANTHROPIC_API_KEY')?.trim();
  const apiKeyGe = getEnv('VITE_GEMINI_API_KEY')?.trim() || getEnv('VITE_API_KEY')?.trim();
  const apiKeyT = getEnv('VITE_TOGETHER_API_KEY')?.trim();
  const apiKeyM = getEnv('VITE_MISTRAL_API_KEY')?.trim();
  const baseUrlOllama = (getEnv('VITE_OLLAMA_URL') || 'http://localhost:11434').replace(/\/$/, '');
  const modelOllama = getEnv('VITE_OLLAMA_MODEL') || 'llama3.2';

  if (provider === 'groq' && apiKeyG) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyG}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`Groq: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
  if (provider === 'ollama' && baseUrlOllama) {
    const res = await fetch(`${baseUrlOllama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelOllama, messages: [{ role: 'user', content: prompt }], stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama: ${res.status}`);
    const data = await res.json();
    return data.message?.content?.trim() || '';
  }
  if (provider === 'gemini' && apiKeyGe) {
    return fetchGeminiText(apiKeyGe, prompt, { temperature: 0.4, maxOutputTokens: maxTokens });
  }
  if (provider === 'together' && apiKeyT) {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyT}` },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`Together: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
  if (provider === 'mistral' && apiKeyM) {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyM}` },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`Mistral: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
  if (provider === 'openai' && apiKeyO) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyO}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
  if (provider === 'anthropic' && apiKeyA) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKeyA, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic: ${res.status}`);
    const data = await res.json();
    const block = data.content?.find((c: { type: string }) => c.type === 'text');
    return block?.text?.trim() || '';
  }
  throw new Error(`Provider ${provider} not configured`);
}

async function getRawTextFromAI(prompt: string, maxTokens: number = DEFAULT_TEXT_MAX_TOKENS): Promise<string> {
  const providers = getAvailableProviders();
  if (providers.length === 0) throw new Error('No AI configured. Add at least one key to .env.');
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await getRawTextFromProvider(provider, prompt, maxTokens);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`AI text [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

export interface StoreDescriptionHints {
  /** Short seller note the AI must factor into the listing. */
  aiDescriptionNote?: string;
}

/**
 * Generate a structured German marketplace listing body.
 * Uses the eBay.de / Kleinanzeigen professional listing prompt.
 * Prefer generateMarketplaceListing when you also need the eBay title.
 */
export async function generateStoreDescription(
  itemName: string,
  existingContext?: string,
  hints?: StoreDescriptionHints
): Promise<string> {
  const { generateMarketplaceListing } = await import('./marketplaceListingAI');
  const result = await generateMarketplaceListing(
    {
      id: 'tmp',
      name: itemName,
      buyPrice: 0,
      buyDate: new Date().toISOString().slice(0, 10),
      category: 'Misc',
      status: ItemStatus.IN_STOCK,
      comment1: existingContext || '',
      comment2: '',
      aiDescriptionNote: hints?.aiDescriptionNote,
    },
    hints
  );
  return result.listingText;
}

// --- Price suggestion from eBay sold listings ---

export interface SoldPriceSuggestion {
  priceLow: number;
  priceHigh: number;
  priceAverage: number;
  reasoning: string;
  soldExamples: { title: string; price: number }[];
}

/**
 * Ask AI to estimate a sell price based on eBay.de "Verkaufte Artikel" (sold items filter).
 * Uses the same multi-provider AI as specs/descriptions so it works with Groq, Gemini, OpenAI, etc.
 */
export async function suggestPriceFromSoldListings(itemName: string, condition: string = 'used'): Promise<SoldPriceSuggestion> {
  const condLower = condition.toLowerCase();
  const condLabel = condLower === 'new' ? 'Neu / new' : condLower === 'defective' ? 'Defekt / for parts' : 'gebraucht / used';
  const prompt = `You are a pricing expert for used electronics on eBay.de (Germany).

I need a realistic sell price for: "${itemName}" (condition: ${condLabel}).

CRITICAL – AVOID OVERPRICING:
- OLD/BUDGET components sell for very little: used CPUs from 2012–2015 (e.g. Intel i3/i5 4xxx, Celeron, Pentium, AMD FX) typically €5–20 on eBay.de.
- Do NOT confuse with newer models or retail prices. "Intel i5-4150" or similar old budget CPUs = €5–15, NOT €50+.
- DDR3 RAM, old HDDs, low-end mobos: often €5–15.
- When unsure, err LOWER – used PC parts are cheap.

RULES:
1. Base estimate ONLY on eBay.de sold/completed listings ("Verkaufte Artikel").
2. Ignore active listings. Only prices where a buyer actually paid.
3. Use knowledge of recent eBay.de sold prices. If rare, use comparable sold items.
4. Prices in EUR. Always provide range and average, never zeros.
5. Include 5–10 sold listing examples with realistic German eBay titles and actual sold prices.

Return a valid JSON object (no markdown, no code fence):
{
  "priceLow": <lowest typical sold price in EUR>,
  "priceHigh": <highest typical sold price in EUR>,
  "priceAverage": <average sold price in EUR>,
  "reasoning": "<1-2 sentences explaining your estimate, mention eBay.de Verkaufte Artikel>",
  "soldExamples": [
    { "title": "<actual sold listing title from eBay.de>", "price": <sold price in EUR> },
    { "title": "<actual sold listing title from eBay.de>", "price": <sold price in EUR> }
  ]
}

soldExamples MUST contain 5-10 entries with realistic German eBay listing titles and actual sold prices.`;

  const raw = await getRawJsonFromAI(prompt, 2048);
  const parsed = JSON.parse(raw) as SoldPriceSuggestion;

  if (!parsed.priceAverage && !parsed.priceLow && !parsed.priceHigh) {
    throw new Error('AI returned no pricing data.');
  }

  let avg = Number(parsed.priceAverage) || 0;
  const low = Number(parsed.priceLow) || 0;
  const high = Number(parsed.priceHigh) || 0;
  if (!avg && low && high) avg = (low + high) / 2;
  if (!avg) avg = low || high;

  return {
    priceLow: low,
    priceHigh: high,
    priceAverage: Math.round(avg * 100) / 100,
    reasoning: parsed.reasoning || '',
    soldExamples: Array.isArray(parsed.soldExamples) ? parsed.soldExamples : [],
  };
}

const PROVIDER_LABELS: Record<Provider, string> = {
  groq: 'Groq',
  ollama: 'Ollama',
  gemini: 'Gemini',
  together: 'Together',
  mistral: 'Mistral',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** Which providers are configured (first is default). Shown in UI; when multiple, we cycle on failure. */
export function getSpecsAIProvider(): string | null {
  const list = getAvailableProviders();
  if (list.length === 0) return null;
  const names = list.map((p) => PROVIDER_LABELS[p]);
  return names.length === 1 ? names[0] : `${names[0]} (+${names.length - 1} fallback)`;
}
