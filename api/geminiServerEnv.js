/**
 * Gemini API key for Vercel Functions / local API routes.
 * Vercel often does not inject VITE_* into serverless runtime (client build only).
 * Use GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) on Vercel; keep VITE_GEMINI_API_KEY for the browser bundle.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let mergedLocalEnv = false;

function mergeLocalDotEnvOnce() {
  if (mergedLocalEnv) return;
  mergedLocalEnv = true;
  const cwd = process.cwd();
  for (const file of ['.env.local', '.env']) {
    const full = join(cwd, file);
    if (!existsSync(full)) continue;
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^export\s+/i.test(line)) line = line.replace(/^export\s+/i, '').trim();
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      const cur = process.env[key];
      if (cur === undefined || String(cur).trim() === '') {
        process.env[key] = val;
      }
    }
  }
}

/**
 * @returns {string} trimmed API key or ''
 */
export function getGeminiKeyForServer() {
  mergeLocalDotEnvOnce();

  const pick = (...names) => {
    for (const n of names) {
      const v = process.env[n];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };

  return pick(
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GOOGLE_API_KEY',
    'VITE_GEMINI_API_KEY',
    'VITE_API_KEY'
  );
}
