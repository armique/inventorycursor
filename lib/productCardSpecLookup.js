/**
 * Before product-card image GEN: use Gemini + Google Search to check official specs.
 * Image models cannot browse the web themselves — this is the real lookup step.
 */

import { sanitizeProductCardSpecs } from './productCardSpecSanity.js';

const LOOKUP_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildLookupPrompt({ name, category, subCategory, specs }) {
  const specLines = (specs || [])
    .slice(0, 10)
    .map((s) => `• ${s.label}: ${s.value}`)
    .join('\n');
  return `You are a PC hardware fact-checker for a German reseller's product card.

TASK:
1) Use Google Search to find the manufacturer's official product page or a trusted datasheet for this exact product.
2) Prefer: Asus/MSI/Gigabyte/ASRock/Intel/AMD/Samsung/Corsair/etc. official sites, then reputable databases (TechPowerUp, CPU-World, manufacturer PDF).
3) Verify which specs are REAL for this model. Reject anachronisms (e.g. M.2 / NVMe / Wi-Fi 6 on old LGA775 / AM2 / DDR2-era boards).

PRODUCT NAME: ${name}
CATEGORY: ${category || 'Hardware'}${subCategory ? ` / ${subCategory}` : ''}
SPECS CURRENTLY ON FILE (may be wrong — double-check):
${specLines || '(none)'}

Return JSON ONLY:
{
  "confidence": "high" | "medium" | "low",
  "officialName": "string",
  "sourceUrls": ["https://...", "..."],
  "specs": [{"label":"Socket","value":"LGA775"}, ...],
  "rejectClaims": ["M.2", "NVMe", "Wi-Fi 6"],
  "notes": "short note"
}

Rules for "specs":
- Only include facts you found for THIS model (max 8 rows).
- Use short marketplace labels: Socket, Chipset, Form Factor, Memory, M.2, VRAM, TDP, Cores, Interface, Capacity, etc.
- If the product cannot have a feature, put it in rejectClaims — do NOT list it in specs.
- If you cannot find a reliable source, set confidence to "low" and return specs: [] with rejectClaims for anything clearly impossible from the product era.
- Do not invent modern upgrades.`;
}

async function callGeminiWithGoogleSearch(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const toolVariants = [{ google_search: {} }, { googleSearch: {} }];
  let lastErr = null;

  for (const tools of toolVariants) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [tools],
        generationConfig: { temperature: 0.1 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || data?.error?.status || `HTTP ${res.status}`;
      lastErr = new Error(errMsg);
      const m = errMsg.toLowerCase();
      if (m.includes('429') || m.includes('quota') || m.includes('404') || m.includes('not found')) {
        continue;
      }
      throw lastErr;
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const urls = chunks
      .map((c) => c?.web?.uri)
      .filter(Boolean)
      .slice(0, 6);
    return { text, urls };
  }
  if (lastErr) throw lastErr;
  return { text: '', urls: [] };
}

function labelsMatch(a, b) {
  const na = String(a || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const nb = String(b || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function shouldReject(line, rejectClaims) {
  const hay = `${line.label} ${line.value}`.toLowerCase();
  return (rejectClaims || []).some((claim) => {
    const c = String(claim || '')
      .toLowerCase()
      .trim();
    if (!c) return false;
    return hay.includes(c) || labelsMatch(line.label, c);
  });
}

/**
 * Merge inventory specs with Google-verified official specs.
 */
export function mergeVerifiedCardSpecs(localSpecs, lookup, ctx) {
  const local = Array.isArray(localSpecs) ? localSpecs : [];
  const rejectClaims = Array.isArray(lookup?.rejectClaims) ? lookup.rejectClaims : [];
  const official = Array.isArray(lookup?.specs) ? lookup.specs : [];
  const confidence = String(lookup?.confidence || 'low').toLowerCase();

  let merged = local.filter((s) => !shouldReject(s, rejectClaims));

  if (confidence === 'high' || confidence === 'medium') {
    for (const row of official) {
      const label = String(row?.label || '').trim();
      const value = String(row?.value || '').trim();
      if (!label || !value) continue;
      if (shouldReject({ label, value }, rejectClaims)) continue;
      const idx = merged.findIndex((s) => labelsMatch(s.label, label));
      if (idx >= 0) {
        merged[idx] = { label: merged[idx].label || label, value };
      } else if (merged.length < 8) {
        merged.push({ label, value });
      }
    }
  } else {
    // Low confidence: still drop rejected anachronisms, but don't replace wholesale
    merged = merged.filter((s) => !shouldReject(s, rejectClaims));
  }

  return sanitizeProductCardSpecs(merged, ctx).slice(0, 8);
}

/**
 * @returns {{ specs, verified, sourceUrls, notes, confidence, model } | null}
 */
export async function lookupOfficialProductCardSpecs(apiKey, ctx) {
  const key = String(apiKey || '').trim();
  if (!key) return null;

  const name = String(ctx?.name || '').trim();
  if (!name) return null;

  const localSpecs = sanitizeProductCardSpecs(ctx.specs || [], ctx);
  const prompt = buildLookupPrompt({
    name,
    category: ctx.category,
    subCategory: ctx.subCategory,
    specs: localSpecs,
  });

  let lastErr = null;
  for (const model of LOOKUP_MODELS) {
    try {
      const { text, urls } = await callGeminiWithGoogleSearch(key, model, prompt);
      const parsed = extractJsonObject(text);
      if (!parsed) {
        lastErr = new Error('No JSON from spec lookup');
        continue;
      }
      const sourceUrls = Array.isArray(parsed.sourceUrls)
        ? [...parsed.sourceUrls, ...urls].filter(Boolean).slice(0, 6)
        : urls;
      const lookup = {
        confidence: parsed.confidence || 'low',
        officialName: parsed.officialName,
        sourceUrls,
        specs: Array.isArray(parsed.specs) ? parsed.specs : [],
        rejectClaims: Array.isArray(parsed.rejectClaims) ? parsed.rejectClaims : [],
        notes: parsed.notes || '',
      };
      const merged = mergeVerifiedCardSpecs(localSpecs, lookup, ctx);
      return {
        specs: merged,
        verified: lookup.confidence === 'high' || lookup.confidence === 'medium',
        sourceUrls,
        notes: lookup.notes,
        confidence: lookup.confidence,
        model,
        rejectClaims: lookup.rejectClaims,
      };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/429|quota|404|not found|503|unavailable/i.test(msg)) {
        // non-retryable — stop trying models
        break;
      }
    }
  }

  if (lastErr) {
    console.warn('[product-card-spec-lookup]', lastErr instanceof Error ? lastErr.message : lastErr);
  }
  return null;
}
