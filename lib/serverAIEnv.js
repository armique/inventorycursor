/**
 * Server-side AI API keys (Vercel Functions / local API routes).
 * Tries multiple env names so one key can be set as GEMINI_API_KEY or VITE_*.
 */
import { getGeminiKeyForServer } from './geminiServerEnv.js';

function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** @returns {{ gemini: string; groq: string; together: string; mistral: string; openai: string }} */
export function getServerAIKeys() {
  return {
    gemini: getGeminiKeyForServer(),
    groq: pick('GROQ_API_KEY', 'VITE_GROQ_API_KEY'),
    together: pick('TOGETHER_API_KEY', 'VITE_TOGETHER_API_KEY'),
    mistral: pick('MISTRAL_API_KEY', 'VITE_MISTRAL_API_KEY'),
    openai: pick('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY'),
  };
}

export function listConfiguredServerProviders() {
  const k = getServerAIKeys();
  const out = [];
  if (k.gemini) out.push('gemini');
  if (k.groq) out.push('groq');
  if (k.together) out.push('together');
  if (k.mistral) out.push('mistral');
  if (k.openai) out.push('openai');
  return out;
}
