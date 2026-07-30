function normalizeListingText(text) {
  return String(text || '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function listingHasDdrGen(haystack, gen) {
  const n = String(gen);
  if (new RegExp(`\\bddr\\s*${n}\\b`).test(haystack) || new RegExp(`\\bddr${n}\\b`).test(haystack)) return true;
  if (n === '5' && /\bpc5[- ]?\d{3,5}\b/.test(haystack)) return true;
  if (n === '4' && /\bpc4[- ]?\d{3,5}\b/.test(haystack)) return true;
  if (n === '3' && /\bpc3[- ]?\d{3,5}\b/.test(haystack)) return true;
  return false;
}
function looksLikeLaptopRam(haystack) {
  if (/\b(so-?dimm|sodimm)\b/.test(haystack)) return true;
  if (/\b(laptop|notebook|macbook)\b/.test(haystack) && /\b(ram|ddr|arbeitsspeicher|memory)\b/.test(haystack)) {
    return true;
  }
  return false;
}
function ramSearchIntent(searchQuery = '') {
  const q = normalizeListingText(searchQuery);
  return {
    ddr5: listingHasDdrGen(q, 5),
    sodimm: /\b(so-?dimm|sodimm|laptop|notebook)\b/.test(q),
  };
}
function failsRamHardRules(haystack, searchQuery = '') {
  const want = ramSearchIntent(searchQuery);
  if (want.sodimm && !looksLikeLaptopRam(haystack)) return true;
  if (want.ddr5) {
    if (!listingHasDdrGen(haystack, 5)) return true;
    if (listingHasDdrGen(haystack, 4) || listingHasDdrGen(haystack, 3)) return true;
  }
  return false;
}
const q = 'DDR5 SODIMM';
console.log('intent', ramSearchIntent(q));
for (const t of [
  '16GB DDR5 SODIMM Laptop',
  '16GB DDR4 SODIMM',
  '8GB DDR3 SODIMM',
  '32GB DDR5 UDIMM Desktop',
  'PC5-4800 SODIMM 16GB',
]) {
  const h = normalizeListingText(t);
  console.log(failsRamHardRules(h, q) ? 'BLOCK' : 'KEEP ', t);
}
