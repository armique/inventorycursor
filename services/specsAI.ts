/**
 * Auto-fill tech specs using any available AI.
 * FREE options: Groq, Ollama, Gemini, Together, Mistral (add keys to .env).
 * Paid: OpenAI, Anthropic.
 * When one provider fails (rate limit, etc.) the system tries the next in order until one succeeds.
 */

const getEnv = (key: string): string => {
  try {
    return (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env[key] as string)) || '';
  } catch {
    return '';
  }
};

type Provider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'together' | 'mistral';

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
  return PROVIDER_ORDER.filter((p) => env[p]);
}

function getProvider(): Provider | null {
  const list = getAvailableProviders();
  return list.length > 0 ? list[0] : null;
}

function buildPrompt(name: string, rawCategory: string, knownKeys: string[]): string {
  let fieldInstruction = '';
  if (knownKeys.length > 0) {
    fieldInstruction = `
PREFERRED KEYS (use these exact names when the spec matches): ${JSON.stringify(knownKeys)}
- If a spec matches one of these (e.g. "Ram" vs "Memory"), use the exact key from the list.
- You may also add any other important specs not in the list with clear, short key names (e.g. Cores, Threads, Base Clock, Max Turbo, Cache, TDP, Lithography, Socket).
`;
  } else {
    fieldInstruction = `
Use clear, short key names for all specs (e.g. Cores, Threads, Base Clock, Max Turbo, Cache, TDP, Socket, Cores, Memory, Storage, etc.).
`;
  }
  return `Look up this hardware/product and extract technical specifications from your knowledge (as if from product pages/specs). Return all important specs so they can be added to an item card.

Item: "${name}"
Category: ${rawCategory}
${fieldInstruction}

Examples by type:
- CPU: Cores, Threads, Base Clock, Max Turbo, Cache, TDP, Socket, Lithography, Integrated Graphics
- GPU: VRAM, Core Clock, Boost Clock, TDP, Interface, Outputs
- RAM: Capacity, Speed, Type, Form Factor
- Motherboard: Socket, Form Factor, Chipset, Memory Slots, Max Memory
- PSU: Wattage, Efficiency, Modular, Form Factor
- Storage: Capacity, Form Factor, Interface, Type (SSD/HDD/NVMe)

Return a valid JSON object with this exact structure (no markdown, no code fence):
{"standardizedName":"...","vendor":"...","specs":{...}}

Rules: specs values can be string or number. Include as many relevant specs as you know.`;
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
      model: 'gpt-4o-mini',
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 1536,
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
      return await callProviderSpecs(provider, prompt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`Specs AI [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

async function getRawJsonFromProvider(provider: Provider, prompt: string): Promise<string> {
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
        max_tokens: 512,
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
      body: JSON.stringify({ model: modelOllama, messages: [{ role: 'user', content: prompt }], stream: false, format: 'json' }),
    });
    if (!res.ok) throw new Error(`Ollama: ${res.status}`);
    const data = await res.json();
    return (data.message?.content?.trim() || '{}').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  }
  if (provider === 'gemini' && apiKeyGe) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKeyGe)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 512 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
  }
  if (provider === 'together' && apiKeyT) {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyT}` },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
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
        max_tokens: 512,
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
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 512,
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
        max_tokens: 512,
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
async function getRawJsonFromAI(prompt: string): Promise<string> {
  const providers = getAvailableProviders();
  if (providers.length === 0) throw new Error('No AI configured. Add at least one key to .env.');
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await getRawJsonFromProvider(provider, prompt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`AI [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

/** Request AI and parse response as JSON. Used by category suggestion. */
export async function requestAIJson<T = unknown>(prompt: string): Promise<T> {
  const raw = await getRawJsonFromAI(prompt);
  return JSON.parse(raw) as T;
}

// --- Plain-text generation (e.g. store descriptions) ---

async function getRawTextFromProvider(provider: Provider, prompt: string): Promise<string> {
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
        max_tokens: 512,
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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKeyGe)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  if (provider === 'together' && apiKeyT) {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyT}` },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
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
        max_tokens: 512,
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
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
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
        max_tokens: 512,
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

async function getRawTextFromAI(prompt: string): Promise<string> {
  const providers = getAvailableProviders();
  if (providers.length === 0) throw new Error('No AI configured. Add at least one key to .env.');
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await getRawTextFromProvider(provider, prompt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`AI text [${provider}] failed, trying next:`, lastError.message);
    }
  }
  throw lastError ?? new Error('All AI providers failed.');
}

/**
 * Generate a short, styled store item description in German. Used for the storefront.
 * Once set, it stays until the user clicks "Generate description" again or edits manually.
 */
export async function generateStoreDescription(itemName: string, existingContext?: string): Promise<string> {
  const context = existingContext?.trim() ? `\nExisting description or notes (you may use as inspiration): ${existingContext}` : '';
  const prompt = `Write a short, appealing product description in German for an online store. It should be 2–4 sentences, professional and inviting. Do not use bullet points or markdown. Output only the German text, nothing else.

Product name: "${itemName}"${context}`;
  const text = await getRawTextFromAI(prompt);
  return text.replace(/^["']|["']$/g, '').trim();
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
