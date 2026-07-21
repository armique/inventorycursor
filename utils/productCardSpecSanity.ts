/**
 * Product-card spec sanity: drop impossible / anachronistic rows before AI draws them.
 * Shared logic mirrored in lib/productCardSpecSanity.js for the API handler.
 */

export type CardSpecLine = { label: string; value: string };

export type SpecSanityContext = {
  name?: string;
  category?: string;
  subCategory?: string;
};

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haystack(ctx: SpecSanityContext, specs: CardSpecLine[]): string {
  const fromSpecs = specs.map((s) => `${s.label} ${s.value}`).join(' ');
  return norm(`${ctx.name || ''} ${ctx.category || ''} ${ctx.subCategory || ''} ${fromSpecs}`);
}

function labelOf(s: CardSpecLine): string {
  return norm(s.label);
}

function valueOf(s: CardSpecLine): string {
  return norm(s.value);
}

function isMotherboard(ctx: SpecSanityContext): boolean {
  const c = norm(`${ctx.category || ''} ${ctx.subCategory || ''}`);
  return c.includes('motherboard') || c.includes('mainboard');
}

function isGpu(ctx: SpecSanityContext): boolean {
  const c = norm(`${ctx.category || ''} ${ctx.subCategory || ''} ${ctx.name || ''}`);
  return (
    c.includes('graphics') ||
    c.includes('gpu') ||
    /\b(rtx|gtx|rx\s*\d|radeon|geforce)\b/.test(c)
  );
}

function isCpu(ctx: SpecSanityContext): boolean {
  const c = norm(`${ctx.category || ''} ${ctx.subCategory || ''}`);
  return c.includes('processor') || c.includes('cpu') || /\b(ryzen|core i[3579]|xeon)\b/.test(norm(ctx.name || ''));
}

function isRam(ctx: SpecSanityContext): boolean {
  const c = norm(`${ctx.category || ''} ${ctx.subCategory || ''}`);
  return c === 'ram' || c.includes(' memory') || /(^| )ram( |$)/.test(c);
}

function isStorage(ctx: SpecSanityContext): boolean {
  const c = norm(`${ctx.category || ''} ${ctx.subCategory || ''}`);
  return c.includes('storage') || c.includes('ssd') || c.includes('hdd') || c.includes('nvme');
}

/** Boards / platforms that almost never had native M.2 / NVMe / Wi‑Fi 6 / PCIe 4+. */
export function isPreM2EraPlatform(hay: string): boolean {
  if (
    /\b(lga\s*)?(775|1156|1366)\b/.test(hay) ||
    /\b(socket\s*)?(939|754|940)\b/.test(hay) ||
    /\bam2\+?\b/.test(hay) ||
    /\bam3\+(?!\s*am4)/.test(hay) ||
    (/\bam3\b/.test(hay) && !/\bam3\+/.test(hay) && !/\bam4\b/.test(hay) && !/\bam5\b/.test(hay))
  ) {
    return true;
  }
  // Classic chipsets before native M.2 was common (match Z77 / Z77X / H61 …)
  if (
    /\b(g31|g41|g43|p35|p43|p45|x38|x48|x58|p55|h55|h57|q57|p67|h67|z68|b75|h61|h77|z77|b85|h81|z87|h87|q87)[a-z0-9]*\b/.test(
      hay
    )
  ) {
    return true;
  }
  // Explicit DDR2 era cues
  if (/\bddr2\b/.test(hay) && !/\bddr[345]\b/.test(hay)) return true;
  return false;
}

function isDdr2Era(hay: string): boolean {
  return /\bddr2\b/.test(hay) && !/\bddr[345]\b/.test(hay);
}

function isDdr3Era(hay: string): boolean {
  return (
    (/\bddr3\b/.test(hay) && !/\bddr[45]\b/.test(hay)) ||
    /\b(lga\s*)?(1155|1150|775|1156|1366)\b/.test(hay) ||
    /\bam3\+?\b/.test(hay)
  );
}

function looksLikeModernWireless(label: string, value: string): boolean {
  const t = `${label} ${value}`;
  return (
    /\b(wifi\s*6e?|wi-?fi\s*6e?|wifi\s*7|wi-?fi\s*7|802\.11ax|802\.11be|bluetooth\s*5\.[2-9]|bt\s*5\.[2-9])\b/.test(
      t
    ) || /\bm\.?\s*2\b/.test(t) && /\b(wifi|wlan|wireless)\b/.test(t)
  );
}

function looksLikeM2OrNvme(label: string, value: string): boolean {
  const t = `${label} ${value}`;
  return /\b(m\.?\s*2|nvme|pcie\s*4|pcie\s*5|pciegen\s*[45]|gen\s*[45]\s*nvme)\b/.test(t);
}

function looksLikePcie4Or5(label: string, value: string): boolean {
  const t = `${label} ${value}`;
  return /\b(pcie?\s*(gen\s*)?[45](\.0)?|gen\s*[45]\s*pcie?)\b/.test(t);
}

function looksLikeDdr4Or5(label: string, value: string): boolean {
  const t = `${label} ${value}`;
  return /\bddr\s*[45]\b/.test(t);
}

function looksLikeDdr3(label: string, value: string): boolean {
  return /\bddr\s*3\b/.test(`${label} ${value}`);
}

function looksLikeDdr5(label: string, value: string): boolean {
  return /\bddr\s*5\b/.test(`${label} ${value}`);
}

function looksLikeRayTracingOrDlss(label: string, value: string): boolean {
  const t = `${label} ${value}`;
  return /\b(ray\s*tracing|rtx|dlss|frame\s*gen|reflex)\b/.test(t);
}

/** Very old GPUs that never had RTX / DLSS features. */
function isPreRtxGpu(hay: string): boolean {
  if (/\b(rtx|rx\s*6|rx\s*7|rx\s*5[56]|arc\s*a)\b/.test(hay)) return false;
  return (
    /\b(gtx\s*)?(9[0-9]{2}|[789][0-9]{2}|[456][0-9]{2})\b/.test(hay) ||
    /\b(gtx\s*)?(970|960|950|780|770|760|680|670|580|570|480)\b/.test(hay) ||
    /\b(hd\s*)?(7[0-9]{3}|6[0-9]{3}|5[0-9]{3})\b/.test(hay) ||
    /\b(r[79]\s*2[0-9]{2}|r[79]\s*3[0-9]{2})\b/.test(hay)
  );
}

function categoryMismatch(ctx: SpecSanityContext, line: CardSpecLine): boolean {
  const l = labelOf(line);
  const v = valueOf(line);

  if (isGpu(ctx)) {
    if (/\b(socket|chipset|form factor|m\.?\s*2 slots?|memory slots?)\b/.test(l)) return true;
    if (/\b(am4|am5|lga\s*17|lga\s*12|lga\s*1151)\b/.test(v) && /\bsocket\b/.test(l)) return true;
  }
  if (isCpu(ctx)) {
    if (/\b(vram|boost clock|cuda|ray tracing|memory type)\b/.test(l) && /\bgddr|gddr\b/.test(v))
      return true;
    if (/\b(form factor|chipset|m\.?\s*2)\b/.test(l)) return true;
  }
  if (isRam(ctx)) {
    if (/\b(socket|chipset|vram|tdp|cuda|form factor)\b/.test(l)) return true;
  }
  if (isStorage(ctx)) {
    if (/\b(socket|chipset|vram|memory slots?)\b/.test(l)) return true;
  }
  if (isMotherboard(ctx)) {
    if (/\b(vram|cuda cores|ray tracing|dlss)\b/.test(l)) return true;
  }
  return false;
}

/**
 * Drop spec rows that are impossible for this product / category / era.
 * Keeps order; does not invent replacements.
 */
export function sanitizeProductCardSpecs(
  specs: CardSpecLine[],
  ctx: SpecSanityContext
): CardSpecLine[] {
  if (!Array.isArray(specs) || !specs.length) return [];
  const cleaned = specs
    .map((s) => ({
      label: String(s?.label || '').trim(),
      value: String(s?.value || '').trim(),
    }))
    .filter((s) => s.label && s.value);

  const hay = haystack(ctx, cleaned);
  const preM2 = isPreM2EraPlatform(hay);
  const ddr2 = isDdr2Era(hay);
  const ddr3 = isDdr3Era(hay);
  const preRtx = isGpu(ctx) && isPreRtxGpu(hay);
  const sataOnlyStorage =
    isStorage(ctx) &&
    /\b(2\.5|3\.5|sata)\b/.test(hay) &&
    !/\b(nvme|m\.?\s*2)\b/.test(norm(ctx.name || ''));

  const out: CardSpecLine[] = [];
  for (const line of cleaned) {
    const l = labelOf(line);
    const v = valueOf(line);

    if (categoryMismatch(ctx, line)) continue;

    if (preM2) {
      if (looksLikeM2OrNvme(l, v)) continue;
      if (looksLikePcie4Or5(l, v)) continue;
      if (looksLikeModernWireless(l, v)) continue;
      if (ddr2 && looksLikeDdr4Or5(l, v)) continue;
      if (ddr3 && looksLikeDdr4Or5(l, v)) continue;
    }

    // Memory generation consistency on boards / RAM
    if ((isMotherboard(ctx) || isRam(ctx)) && ddr2 && looksLikeDdr4Or5(l, v)) continue;
    if ((isMotherboard(ctx) || isRam(ctx)) && ddr3 && looksLikeDdr5(l, v)) continue;
    if ((isMotherboard(ctx) || isRam(ctx)) && /\bddr5\b/.test(hay) && looksLikeDdr3(l, v) && !/\bddr5\b/.test(v)) {
      // keep DDR5 rows; drop conflicting DDR3 if name/chipset is DDR5
      if (/\bddr\s*3\b/.test(v)) continue;
    }

    if (preRtx && looksLikeRayTracingOrDlss(l, v) && !/\brtx\b/.test(hay)) continue;

    if (sataOnlyStorage && looksLikeM2OrNvme(l, v)) continue;

    // Never print empty / placeholder junk
    if (/^(n\/?a|none|unknown|-|—|–)$/i.test(line.value.trim())) continue;

    out.push(line);
  }
  return out;
}

/** Extra prompt bullets based on detected era / category risks. */
export function buildProductCardSpecGuardrails(ctx: SpecSanityContext, specs: CardSpecLine[]): string {
  const hay = haystack(ctx, specs);
  const lines: string[] = [
    'SPEC ACCURACY (CRITICAL):',
    '- Only print specification rows from SPECIFICATIONS above. Do NOT invent extra features.',
    '- Do NOT add modern features that the product could not have (anachronisms).',
    '- If a feature is uncertain, omit it — never guess.',
  ];

  if (isMotherboard(ctx) || isPreM2EraPlatform(hay)) {
    lines.push(
      '- Motherboards: never claim M.2 / NVMe / Wi-Fi 6/7 / PCIe 4.0+ / DDR4/DDR5 unless that exact value is listed in SPECIFICATIONS.',
      '- Older platforms (e.g. LGA775, AM2/AM3, DDR2/DDR3 chipsets like G41/P45/X58/Z77) must NOT show M.2 or NVMe.'
    );
  }
  if (isGpu(ctx)) {
    lines.push(
      '- GPUs: never invent VRAM size, bus width, or RTX/DLSS features not listed in SPECIFICATIONS.',
      '- Do not show motherboard fields (Socket, Chipset, M.2) on a graphics card.'
    );
  }
  if (isCpu(ctx)) {
    lines.push('- CPUs: do not invent core/thread counts or show GPU VRAM / motherboard chipset rows.');
  }
  if (isRam(ctx)) {
    lines.push('- RAM: keep DDR generation consistent with SPECIFICATIONS; do not invent RGB/XMP unless listed.');
  }
  if (isStorage(ctx)) {
    lines.push('- Storage: do not claim NVMe/M.2 on a clearly SATA 2.5"/3.5" drive unless listed.');
  }
  if (isPreM2EraPlatform(hay)) {
    lines.push('- This product looks pre-M.2 era from its name/specs — forbid M.2, NVMe, PCIe Gen4/5, Wi-Fi 6/7 on the card.');
  }
  if (isGpu(ctx) && isPreRtxGpu(hay)) {
    lines.push('- This GPU looks pre-RTX — do not mention Ray Tracing, DLSS, or RTX features.');
  }

  return lines.join('\n');
}
