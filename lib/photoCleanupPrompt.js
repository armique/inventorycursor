/** Prompt + parsing for the item-photo cleanup pass (crop suggestion, clutter flag, card score). */

export const PHOTO_CLEANUP_PROMPT = `You are looking at one photo of a used electronics item (PC part, laptop, peripheral, etc.) that a reseller is about to list for sale.

Return ONLY JSON, no markdown, no commentary, matching exactly this shape:
{
  "cropBox": { "x": number, "y": number, "width": number, "height": number },
  "hasClutter": boolean,
  "clutterNote": string or null,
  "cardScore": number
}

Rules:
- cropBox: a TIGHT crop around the item itself, as fractions of the full image (0 to 1, origin top-left). Leave a small margin (roughly 4-8% of the item's size) so the item isn't touching the edge. If the item already fills the frame well, return {"x":0,"y":0,"width":1,"height":1}.
- hasClutter: true if the background has visible dust, fingerprints, unrelated objects, packaging, or a messy surface that a buyer would notice. false if the background is clean/neutral or the clutter is minor.
- clutterNote: if hasClutter is true, one short phrase (under 8 words) naming what's distracting, e.g. "dust on the fan blades" or "cluttered desk in background". null if hasClutter is false.
- cardScore: 0 to 1, how well this specific photo would work as the ONE main listing photo (the "card" photo buyers see first) — reward a clear, well-lit, well-framed shot of the whole item; penalize blur, extreme close-ups, odd angles, or mostly-background shots.

Respond with JSON only.`;

/** Clamp a fraction into [0,1], defaulting to `fallback` when not a finite number. */
function clampFraction(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {unknown} raw
 * @returns {{ cropBox: { x: number; y: number; width: number; height: number }; hasClutter: boolean; clutterNote: string | null; cardScore: number }}
 */
export function parsePhotoCleanupResult(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const box = o.cropBox && typeof o.cropBox === 'object' ? o.cropBox : {};
  let x = clampFraction(box.x, 0);
  let y = clampFraction(box.y, 0);
  let width = clampFraction(box.width, 1);
  let height = clampFraction(box.height, 1);
  // Guard against a box that runs off the right/bottom edge or is degenerate.
  width = Math.min(width, 1 - x) || 1 - x;
  height = Math.min(height, 1 - y) || 1 - y;
  if (width <= 0.05 || height <= 0.05) {
    x = 0;
    y = 0;
    width = 1;
    height = 1;
  }
  const clutterNoteRaw = typeof o.clutterNote === 'string' ? o.clutterNote.trim() : '';
  return {
    cropBox: { x, y, width, height },
    hasClutter: Boolean(o.hasClutter),
    clutterNote: clutterNoteRaw ? clutterNoteRaw.slice(0, 80) : null,
    cardScore: clampFraction(o.cardScore, 0.5),
  };
}
