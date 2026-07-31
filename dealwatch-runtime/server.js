const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || 'EBAY_DE';
const EBAY_APPLICATION_TOKEN = process.env.EBAY_APPLICATION_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
/** Full monitor cycle — keep ≥10–15 min with many eBay filters to avoid Browse API 429s. */
const MONITOR_INTERVAL_MINUTES = numberInRange(process.env.MONITOR_INTERVAL_MINUTES, 15, 1, 120);
/** Minimum gap between eBay Browse API calls (ms). */
const EBAY_MIN_GAP_MS = numberInRange(process.env.EBAY_MIN_GAP_MS, 500, 100, 10000);
/** Pause between monitored searches inside one cycle (ms). */
const MONITOR_SEARCH_GAP_MS = numberInRange(process.env.MONITOR_SEARCH_GAP_MS, 1500, 0, 30000);
const EBAY_MAX_RETRIES_ON_429 = numberInRange(process.env.EBAY_MAX_RETRIES_ON_429, 4, 0, 8);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_SEED_PATH = path.join(DATA_DIR, 'store.seed.json');
const STORE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'dealwatch-store.json')
  : path.join(DATA_DIR, 'store.json');
const PUBLIC_STORE_SEED = path.join(__dirname, '..', 'public', 'dealwatch', 'store.json');
const GPU_SPECS_PATH = path.join(DATA_DIR, 'gpu-specs.json');
const CPU_SPECS_PATH = path.join(DATA_DIR, 'cpu-specs.json');
const SSD_SPECS_PATH = path.join(DATA_DIR, 'ssd-specs.json');
const HDD_SPECS_PATH = path.join(DATA_DIR, 'hdd-specs.json');
const LEGACY_SEARCH_PATH = path.join(DATA_DIR, 'saved-search.json');
const CLASSIFIER_CONFIG_PATH = path.join(DATA_DIR, 'classifier-config.json');
const DEFAULT_FILTERS = {
  search: 'NVIDIA GeForce GTX 1080',
  minPrice: 1,
  maxPrice: 80,
  minFeedback: 90,
  condition: 'any',
  enabledSmartFilters: [],
  disabledSmartFilters: [],
  includeCapacities: [],
  categoryId: '',
  categoryName: '',
  categoryPath: [],
  marketplace: 'ebay',
};

const KA_BASE = 'https://www.kleinanzeigen.de';
const KA_PC_CATEGORY_ID = '225';
const KA_LOCATION_WALDSTETTEN = { locationId: '6699', locationLabel: '89367 Waldstetten' };
const KA_CATEGORIES = {
  all: { id: '', slug: '' },
  elektronik: { id: '161', slug: 'multimedia-elektronik' },
  'pc-zubehoer': { id: '225', slug: 'pc-zubehoer-software' },
  pcs: { id: '228', slug: 'pcs' },
  konsolen: { id: '279', slug: 'konsolen' },
};
const KA_RADIUS_OPTIONS = [0, 5, 10, 20, 30, 50, 60, 100, 150, 200];
const KA_GPU_SMART_FILTERS = [
  'parts-defekt',
  'ovp-waterblock',
  'gpu-adapter',
  'replacement-fans',
  'compat-dumps',
  'fake-replica',
  'laptop-mobile',
  'require-model',
  'require-complete',
  'wrong-ti',
  'wrong-gt',
  'nearby-models',
  'hard-junk',
  'storage-collision',
];
const DEFAULT_KA_GTX1080 = {
  id: 'ka-import-gtx-1080',
  name: 'GTX 1080 · Kleinanzeigen',
  search: 'GTX 1080',
  minPrice: 1,
  maxPrice: 150,
  minFeedback: 0,
  condition: 'any',
  marketplace: 'kleinanzeigen',
  enabledSmartFilters: KA_GPU_SMART_FILTERS,
  categoryId: '',
  categoryName: '',
  categoryPath: [],
  kaCategory: 'pc-zubehoer',
  locationId: '',
  locationLabel: '',
  radiusKm: 0,
  shippingOnly: false,
};

/** Saved searches copied from the user's Kleinanzeigen Favoriten screenshots. */
const KA_IMPORTED_SEARCHES = [
  { id: 'ka-import-ssd-512', search: 'ssd 512', maxPrice: 25, name: 'ssd 512 · KA' },
  { id: 'ka-import-rtx-3070', search: 'rtx 3070', maxPrice: 170, name: 'rtx 3070 · KA', enabledSmartFilters: KA_GPU_SMART_FILTERS, kaCategory: 'all' },
  { id: 'ka-import-8700k', search: '8700k', maxPrice: 150, name: '8700k · KA' },
  { id: 'ka-import-ddr4-32gb', search: 'ddr4 32gb', maxPrice: 50, name: 'ddr4 32gb · KA' },
  { id: 'ka-import-konvolut-elektronik', search: 'konvolut', maxPrice: 5000, name: 'konvolut · Elektronik · KA', kaCategory: 'elektronik' },
  { id: 'ka-import-b450', search: 'b450', maxPrice: 30, name: 'b450 · KA', shippingOnly: true },
  {
    id: 'ka-import-ps5',
    search: 'ps5',
    minPrice: 200,
    maxPrice: 300,
    name: 'ps5 · Konsolen · KA',
    kaCategory: 'konsolen',
    ...KA_LOCATION_WALDSTETTEN,
    radiusKm: 60,
  },
  { id: 'ka-import-ssd-500', search: 'ssd 500', maxPrice: 30, name: 'ssd 500 · KA' },
  { id: 'ka-import-16gb-sodimm-ddr5', search: '16gb sodimm ddr5', maxPrice: 70, name: '16gb sodimm ddr5 · KA' },
  { id: 'ka-import-4790k', search: '4790k', maxPrice: 100, name: '4790k · KA' },
  { id: 'ka-import-b550-mainboard', search: 'b550 mainboard', maxPrice: 50, name: 'b550 mainboard · KA' },
  { id: 'ka-import-bluray-laufwerk', search: 'bluray laufwerk', maxPrice: 35, name: 'bluray laufwerk · KA' },
  { id: 'ka-import-rtx-2080', search: 'rtx 2080', maxPrice: 150, name: 'rtx 2080 · KA', enabledSmartFilters: KA_GPU_SMART_FILTERS },
  { id: 'ka-import-ssd-1tb', search: 'ssd 1tb', maxPrice: 50, name: 'ssd 1tb · KA', shippingOnly: true },
  { id: 'ka-import-konvolut-pc-zubehoer', search: 'konvolut', maxPrice: 5000, name: 'konvolut · PC-Zubehör · KA', kaCategory: 'pc-zubehoer' },
  { id: 'ka-import-pc-bundle-elektronik', search: 'pc bundle', maxPrice: 200, name: 'pc bundle · Elektronik · KA', kaCategory: 'elektronik' },
  { id: 'ka-import-ryzen-bundle-80', search: 'ryzen bundle', maxPrice: 80, name: 'ryzen bundle · bis €80 · KA' },
  { id: 'ka-import-ryzen-bundle-150', search: 'ryzen bundle', maxPrice: 150, name: 'ryzen bundle · bis €150 · KA' },
  { id: 'ka-import-konvolut-pcs', search: 'konvolut', maxPrice: 5000, name: 'konvolut · PCs · KA', kaCategory: 'pcs' },
  { id: 'ka-import-rtx-3060', search: 'rtx 3060', maxPrice: 150, name: 'rtx 3060 · KA', enabledSmartFilters: KA_GPU_SMART_FILTERS },
  { id: 'ka-import-aufruestkit', search: 'aufrüstkit', maxPrice: 150, name: 'aufrüstkit · KA' },
  { id: 'ka-import-1080ti', search: '1080ti', maxPrice: 120, name: '1080ti · KA', enabledSmartFilters: KA_GPU_SMART_FILTERS },
  {
    id: 'ka-import-gaming-pc',
    search: 'gaming pc',
    maxPrice: 500,
    name: 'gaming pc · Waldstetten · KA',
    ...KA_LOCATION_WALDSTETTEN,
    radiusKm: 13,
  },
  { id: 'ka-import-32gb-sodimm-ddr5', search: '32gb sodimm ddr5', maxPrice: 150, name: '32gb sodimm ddr5 · KA' },
  DEFAULT_KA_GTX1080,
];
const PC_CATEGORY_SEED_PATH = path.join(__dirname, 'pc-categories.json');
const PC_CATEGORY_CACHE_PATH = path.join(DATA_DIR, 'ebay-pc-categories.json');
const PC_PARTS_ROOT_IDS = new Set([
  '175673', // Computer-Komponenten & -Teile
  '165',    // Laufwerke & Speichermedien
  '182094', // Kabel & Steckverbinder
  '171957', // Desktops & All-in-One-PCs
  '175672', // Notebooks & Netbooks
  '31530',  // Notebook- & Desktop-Zubehör
  '162497', // Monitore, Projektoren & Zubehör
  '3676',   // Tastaturen, Mäuse & Pointing
  '86722',  // Stromschutz & Stromverteilung
  '175698', // Firmennetzwerke & Server
  '11176',  // Heimnetzwerke & Zubehör
]);
let pcCategoryTree = null;
// Reject packaging-only, faulty, magazines, and accessory listings — keep actual GPUs.
// Patterns run on normalized lowercase ASCII text (punctuation collapsed to spaces).
const blockedPatterns = [
  /\bfor parts\b/,
  /\bparts only\b/,
  /\bnot working\b/,
  /\bdoes not work\b/,
  /\bas is\b/,
  /\bdefekt/,
  /\bdefect/,
  /\bbroken\b/,
  /\bkaputt\b/,
  /\bbeschadig/,
  /\bfunktioniert nicht\b/,
  /\buntested\b/,
  /\bungepruft/,
  /\bbastler/,
  /\bersatzteil/,
  /\breparatur/,
  /\brepair only\b/,
  /\bohne (grafikkarte|grafikarte|grafik karte|graka|gpu|videokarte|inhalt|karte)\b/,
  /\bkeine? (grafikkarte|grafikarte|grafik karte|graka|gpu|videokarte)\b/,
  /\bwithout (gpu|graphics? card|video card|card)\b/,
  /\bno (gpu|graphics? card|video card)\b/,
  /\bnur (ovp|karton|verpackung|box|originalverpackung|leerbox)\b/,
  /\b(ovp|karton|verpackung|box|originalverpackung) (only|ohne|leer|empty)\b/,
  /\bempty (box|carton|package|packaging)\b/,
  /\bbox only\b/,
  /\bpackaging only\b/,
  /\bcarton only\b/,
  /\bleere? (box|verpackung|ovp|karton)\b/,
  /\bleerbox\b/,
  /\battrappe\b/,
  /\bdummy\b/,
  /\bplatzhalter\b/,
  /\bmagazine\b/,
  /\bzeitschrift\b/,
  /\bsubscriber edition\b/,
  /\bpc magazine\b/,
  /\bcustom pc\b/,
  /\bfan only\b/,
  /\bluefter only\b/,
  /\bnur (luefter|kuehler|cooler|shroud|backplate)\b/,
  /\b(cooler|kuehler|heatsink|shroud|backplate) only\b/,
  /\bpcb only\b/,
];

const accessoryPatterns = [
  /\balphacool\b/,
  /\bnexxx?os\b/,
  /\bheatkiller\b/,
  /\bbykski\b/,
  /\bek water\b/,
  /\bekwb\b/,
  /\baquacomputer\b/,
  /\bphanteks glacer\b/,
  /\braiton\b/,
  /\bwass?er?k(?:ue|u)?hlblock/,
  /\bwassk(?:ue|u)?hlblock/,
  /\bk(?:ue|u)?hlblock/,
  /\bwater ?block\b/,
  /\bwasserblock\b/,
  /\bgpu ?block\b/,
  /\bcopper ?block\b/,
  /\bacryl(?:ic)? ?block\b/,
  /\bbackplate only\b/,
  /\bshroud only\b/,
  /\bheatsink only\b/,
  /\bnur (backplate|shroud|heatsink)\b/,
  /\bwaeserkuehler\b/,
  /\bwasserkuehler\b/,
  /\bwatercool/,
  /\bliquid cool/,
  // Protective cases/bags/brackets FOR a card — the product being sold is the
  // accessory, the card model in the title just says what it fits.
  // \w*gehaeuse / \w*tasche: German compounds concatenate without a space
  // ("Grafikkartengehäuse"), so a plain \bgehaeuse\b boundary match misses them.
  /\beva\b.{0,20}\b(case|\w*gehaeuse|\w*tasche|box|material)\b/,
  /\baufbewahrung(sbox|stasche)?\b/,
  /\btragetasche\b/,
  /\bschutzhuelle\b/,
  /\bschutztasche\b/,
  /\bcarrying (case|bag)\b/,
  /\bbracket for\b/,
  /\bhalterung fuer\b/,
];

// Replacement fans/parts — do NOT ban bare "fan" / "dual fan" (common on real GPU titles).
const replacementPartPatterns = [
  /\bcooling fans?\b/,
  /\breplacement fans?\b/,
  /\bersatzluefter\b/,
  /\bkuehlerluefter\b/,
  /\bgrafikkartenluefter\b/,
  /\b(gpu|vga|grafikkarten?)\s*luefter\b/,
  /\bluefter\s*(set|kit|paar|only|cooler|motor)\b/,
  /\bfan (set|kit|pair|only|motor)\b/,
  /\bfans (set|kit|pair|only)\b/,
  /\b\d+x\s*(kuehler)?luefter\b/,
  /\b(luefter|cooler|fan)s?\s*(fuer|for)\b/,
  /\b(fuer|for)\b.{0,40}\b(luefter|kuehlerluefter|ersatzluefter)\b/,
  /\bteil\s*(fuer|for)\b/,
  /\bersatzteil\b/,
  /\bventilator\b/,
  /\bgpu[- ]?fan\b/,
  /\bvga[- ]?fan\b/,
  /\bice shell\b/,
  /\bcooler shell\b/,
  /\bcooling shell\b/,
  /\bshell with fan\b/,
  /\bplastic shell\b/,
  /\bshroud with fan\b/,
  /\byingzhong\b/,
  /\b\d+\s*(pcs|pc|pair|stueck|stuck)\/?\s*(set)?\b/,
  /\b1pair\b/,
  /\b2pcs\b/,
  /\b3pcs\b/,
  /\bpld\d+/,
  /\b\d{2,3}\s*mm\b.*\b(fans?|luefter|cooler)\b/,
  /\b(fans?|luefter|cooler)\b.*\b\d{2,3}\s*mm\b/,
  /\b\d+pin\b.*\b(fans?|luefter)\b/,
  /\b(fans?|luefter)\b.*\b\d+pin\b/,
  /\bfor (strix|armor|windforce|gaming|aorus|dual|ventus)\b.*\b(fans?|luefter)\b/,
  /\bfans? for\b/,
  /\ba pair fans?\b/,
  /\bvga fan\b/,
  /\bcooler cooling fan\b/,
  /\breplacement for\b/,
  /\bheat ?sinks?\s*(fuer|for)\b/,
  /\bthermal module\b/,
];

let tokenCache = { token: '', expiresAt: 0 };
const scheduledAuctionIds = new Set();

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

function isFaultyCondition(condition, conditionId) {
  const id = String(conditionId || '');
  if (id === '7000' || id === '1750') return true;
  const normalized = normalizeListingText(condition);
  // Keep refurbished / seller restored; only block true for-parts / broken.
  if (/\b(refurbish|erneuert|generalüberholt|generaluberholt|refurbished)\b/.test(normalized)) {
    return false;
  }
  return /\b(parts only|for parts|not working|defekt|defect|ersatzteil|kaputt|broken|bastlerartikel)\b/.test(normalized);
}

// All buyable eBay conditions except for-parts (7000) and new-with-defects (1750).
const BUYABLE_CONDITION_IDS = [
  '1000', // New
  '1500', // New other
  '2000', // Manufacturer refurbished
  '2010', // Certified refurbished
  '2020', // Excellent refurbished
  '2030', // Very good refurbished
  '2040', // Good refurbished
  '2500', // Seller refurbished
  '2750', // Like new
  '3000', // Used
  '4000', // Used very good
  '5000', // Used good
  '6000', // Used acceptable
];

function isPackagingWithoutCard(haystack) {
  // Require explicit "no GPU" language — not "keine Originalverpackung" / "Die Karte".
  const missingCard = /\bohne (grafikkarte|grafikarte|grafik karte|graka|gpu|videokarte|inhalt)\b/.test(haystack)
    || /\bkeine? (grafikkarte|grafikarte|graka|gpu|videokarte)\b/.test(haystack)
    || /\bwithout (gpu|graphics? card|video card)\b/.test(haystack)
    || /\bno (gpu|graphics? card|video card)\b/.test(haystack);
  const packagingOnly = /\bnur (ovp|karton|verpackung|box|originalverpackung|leerbox)\b/.test(haystack)
    || /\b(ovp|karton|verpackung|originalverpackung) (only|leer|empty)\b/.test(haystack)
    || /\bleerbox\b/.test(haystack)
    || /\bempty (box|carton|package|packaging)\b/.test(haystack);
  const ovpPlusOhne = /\bovp\b/.test(haystack) && /\bohne\b/.test(haystack);
  return missingCard || packagingOnly || ovpPlusOhne;
}

function isFactoryWatercooledGpu(haystack) {
  const hasVram = /\b\d+\s*gb\b/.test(haystack) || /\bgddr\d*x?\b/.test(haystack);
  const hasGpu = /\b(geforce|radeon|gtx|rtx)\b/.test(haystack);
  const aftermarketBlock = /\b(alphacool|heatkiller|bykski|ekwb|aquacomputer|acryl|yingzhong)\b/.test(haystack)
    || /\bkuehlung fuer\b/.test(haystack)
    || /\bwasserkuehlung fuer\b/.test(haystack);
  return hasVram && hasGpu && !aftermarketBlock;
}

function isGpuAccessory(haystack) {
  if (!accessoryPatterns.some(pattern => pattern.test(haystack))) return false;
  // Allow complete cards sold as factory "Waterblock Edition" / AIO hybrids.
  if (isFactoryWatercooledGpu(haystack)) return false;
  return true;
}

function isReplacementPart(haystack) {
  return replacementPartPatterns.some(pattern => pattern.test(haystack));
}

// Fan/shell ads often list many compatible GPUs (sometimes without repeating "GTX").
function isCompatibilityDump(haystack) {
  const models = new Set();
  for (const match of haystack.matchAll(/\b(?:gtx|rtx|rx)\s*(\d{3,4})\s*(ti)?\b/g)) {
    models.add(`${match[1]}${match[2] || ''}`);
  }
  for (const match of haystack.matchAll(/\b(?:gtx|rtx|rx)(\d{3,4})(ti)?\b/g)) {
    models.add(`${match[1]}${match[2] || ''}`);
  }
  // Bare generations in compatibility lists: "GTX 1080 1070 1070ti 1060"
  for (const match of haystack.matchAll(/\b(9[567]0|10[45678]0|16[06]0|20[567]0|30[056]0|40[06]0)(ti)?\b/g)) {
    models.add(`${match[1]}${match[2] || ''}`);
  }
  return models.size >= 3;
}

function hasGpuIdentity(haystack) {
  return /\b(geforce|radeon)\b/.test(haystack)
    || /\b(?:gtx|rtx|rx)\s*\d{3,4}\b/.test(haystack)
    || /\b(?:gtx|rtx|rx)\d{3,4}\b/.test(haystack);
}

// Prefer VRAM when present, but also accept brand + GPU model (many sellers omit GB).
// Never treat bare "80GB" / HDD sizes as a GPU.
function looksLikeCompleteGpu(haystack) {
  if (isReplacementPart(haystack)) return false;
  if (isCompatibilityDump(haystack)) return false;
  if (!hasGpuIdentity(haystack)) return false;
  if (/\b\d+\s*gb\b/.test(haystack) || /\bgddr\d*x?\b/.test(haystack)) return true;
  if (/\bgv n[a-z0-9]+/.test(haystack)) return true;
  const hasBrand = /\b(msi|asus|asrock|gigabyte|gainward|zotac|evga|pny|palit|inno3d|galax|kfa2|manli|nvidia|aorus|colorful|maxsun|sapphire|xfx|powercolor)\b/.test(haystack);
  if (hasBrand) return true;
  if (/\bfounders( edition)?\b/.test(haystack)) return true;
  return false;
}

function parseGpuSearch(searchQuery) {
  const query = normalizeListingText(searchQuery);
  if (!query) return null;
  let match = query.match(/\b(rtx|gtx|rx)\s*(\d{3,4})\s*(ti|super)?\b/);
  if (!match) match = query.match(/\b(rtx|gtx|rx)(\d{3,4})(ti|super)?\b/);
  if (match) {
    return { series: match[1], model: match[2], suffix: match[3] || '' };
  }
  // "GeForce 2080" / "NVIDIA 1080 Ti" without explicit rtx/gtx — infer from era.
  match = query.match(/\b(\d{3,4})\s*(ti|super)?\b/);
  if (!match) return null;
  const model = match[1];
  const suffix = match[2] || '';
  const n = Number(model);
  let series = '';
  if (/\brx\b/.test(query) || /\bradeon\b/.test(query)) series = 'rx';
  else if (/\brtx\b/.test(query) || (n >= 2050 && n < 6000)) series = 'rtx';
  else if (/\bgtx\b/.test(query) || (n >= 600 && n < 2000)) series = 'gtx';
  else return null;
  return { series, model, suffix };
}

function listingHasGpuModel(haystack, { series, model, suffix }) {
  const suffixPart = suffix ? `(?:\\s*${suffix})` : '';
  if (new RegExp(`\\b${series}\\s*${model}${suffixPart}\\b`).test(haystack)) return true;
  if (new RegExp(`\\b${series}${model}${suffix || ''}\\b`).test(haystack)) return true;
  // Short titles like "GeForce 2080 Founders" sometimes omit RTX/GTX.
  if ((series === 'gtx' || series === 'rtx')
    && /\bgeforce\b/.test(haystack)
    && new RegExp(`\\b${model}${suffixPart}\\b`).test(haystack)
    && !/\bgt\s*\d{3,4}\b/.test(haystack)
    && !/\bgt\d{3,4}\b/.test(haystack)) {
    return true;
  }
  return false;
}

function listingHasModelTi(haystack, model) {
  return new RegExp(`\\b${model}\\s*ti\\b`).test(haystack)
    || new RegExp(`\\b(?:gtx|rtx|rx)${model}ti\\b`).test(haystack);
}

// eBay search is fuzzy ("2080" hits HDDs, "RTX 2080" can return GT 730). Require the real GPU token.
function matchesGpuSearch(haystack, searchQuery) {
  const wanted = parseGpuSearch(searchQuery);
  if (!wanted) return true;
  if (!listingHasGpuModel(haystack, wanted)) return false;
  const wantsTi = wanted.suffix === 'ti';
  const isTi = listingHasModelTi(haystack, wanted.model);
  if (!wantsTi && isTi) return false;
  if (wantsTi && !isTi) return false;
  if (wanted.suffix === 'super' && !/\bsuper\b/.test(haystack)) return false;
  return true;
}

function listingIs1080Ti(haystack) {
  return listingHasModelTi(haystack, '1080');
}

function searchWants1080Ti(searchQuery) {
  const wanted = parseGpuSearch(searchQuery);
  return Boolean(wanted && wanted.model === '1080' && wanted.suffix === 'ti');
}

// Keep 1080 and 1080 Ti searches from cross-contaminating each other.
function isWrongGpuVariant(haystack, searchQuery) {
  const wanted = parseGpuSearch(searchQuery);
  if (wanted) {
    const wantsTi = wanted.suffix === 'ti';
    const isTi = listingHasModelTi(haystack, wanted.model);
    if (!wantsTi && isTi) return true;
    if (wantsTi && listingHasGpuModel(haystack, { ...wanted, suffix: '' }) && !isTi) return true;
    return false;
  }
  const wantsTi = searchWants1080Ti(searchQuery);
  const isTi = listingIs1080Ti(haystack);
  if (!wantsTi && isTi) return true;
  if (wantsTi && /\b1080\b/.test(haystack) && !isTi) return true;
  return false;
}

function formatGpuLabel(wanted) {
  if (!wanted) return 'GPU';
  const suffix = wanted.suffix ? ` ${wanted.suffix}` : '';
  return `${wanted.series.toUpperCase()} ${wanted.model}${suffix}`.replace(/\s+/g, ' ').trim();
}

function nearbyGpuModels(model) {
  const n = Number(model);
  if (!Number.isFinite(n)) return [];
  const nearby = new Set();
  for (const delta of [-30, -20, -10, 10, 20, 30, 100, -100, 1000, -1000]) {
    const candidate = n + delta;
    if (candidate >= 600 && candidate <= 5090 && candidate !== n) nearby.add(String(candidate));
  }
  return [...nearby];
}

// Query-specific anti-fake / anti-mismatch rules shown in the UI and applied only when enabled.
const STORAGE_CATEGORY_IDS = new Set([
  '165', '182085', '175669', '56083', '131553', '106273', '51071',
  '175671', '158816', '158817', '169', '39976', '131542',
]);

function isStorageSearch(searchQuery = '', categoryId = '') {
  if (STORAGE_CATEGORY_IDS.has(String(categoryId || ''))) return true;
  const q = normalizeListingText(searchQuery);
  return /\b(ssd|nvme|m\.?2|festplatte|hard ?disk|hdd|nas|speichermedien|usb ?stick|storage)\b/.test(q);
}

function isGpuCategory(categoryId = '') {
  return String(categoryId || '') === '27386';
}

function isPcCategory(categoryId = '') {
  const id = String(categoryId || '');
  return id === '179' || id === '171957' || id === '111418';
}

function isRamCategory(categoryId = '') {
  return String(categoryId || '') === '170083';
}

function isRamSearch(searchQuery = '', categoryId = '') {
  if (isRamCategory(categoryId)) return true;
  const q = normalizeListingText(searchQuery);
  return /\b(ddr[45]|so-?dimm|sodimm|arbeitsspeicher|laptop ?ram|notebook ?ram)\b/.test(q);
}

function parseCapacityGb(haystack) {
  const text = String(haystack || '');
  const tb = text.match(/\b(\d+(?:[.,]\d+)?)\s*tb\b/i);
  if (tb) return Math.round(Number(tb[1].replace(',', '.')) * 1000);
  const gb = text.match(/\b(\d{1,4})\s*(?:gb|gbyte|gigabyte)s?\b/i);
  if (gb) return Number(gb[1]);
  // Compact titles: "512G", "256GBSSD", "120G "
  const compact = text.match(/\b(\d{2,4})\s*g(?:b)?(?=[a-z]|\b)/i);
  if (compact) return Number(compact[1]);
  return null;
}

function capacityInBand(haystack, minGb, maxGb) {
  const gb = parseCapacityGb(haystack);
  return gb != null && gb >= minGb && gb <= maxGb;
}

function capacityAtMost(haystack, maxGb) {
  const gb = parseCapacityGb(haystack);
  return gb != null && gb > 0 && gb <= maxGb;
}

function storageCapacityIncludes() {
  return [
    { id: 'cap-120', label: '120 GB', min: 115, max: 125, group: 'capacity' },
    { id: 'cap-120-128', label: '128 GB', min: 100, max: 140, group: 'capacity' },
    { id: 'cap-240-256', label: '256 GB', min: 200, max: 280, group: 'capacity' },
    { id: 'cap-480', label: '480 GB', min: 470, max: 485, group: 'capacity' },
    { id: 'cap-500', label: '500 GB', min: 490, max: 510, group: 'capacity' },
    { id: 'cap-480-512', label: '512 GB', min: 450, max: 560, group: 'capacity' },
    { id: 'cap-1tb', label: '1 TB', min: 900, max: 1100, group: 'capacity' },
    { id: 'cap-2tb', label: '2 TB', min: 1800, max: 2200, group: 'capacity' },
    { id: 'cap-4tb', label: '4 TB', min: 3600, max: 4400, group: 'capacity' },
  ];
}

function storageTypeIncludes() {
  return [
    {
      id: 'type-nvme',
      label: 'NVMe',
      group: 'type',
      test: haystack => /\bnvme\b/.test(haystack),
    },
    {
      id: 'type-m2',
      label: 'M.2',
      group: 'type',
      test: haystack => /\bm\.?2\b/.test(haystack),
    },
    {
      id: 'type-sata',
      label: 'SATA',
      group: 'type',
      test: haystack => /\bsata\b/.test(haystack),
    },
  ];
}

function storageIncludeDefs() {
  return [
    ...storageCapacityIncludes().map(({ id, label, group }) => ({ id, label, group })),
    ...storageTypeIncludes().map(({ id, label, group }) => ({ id, label, group })),
  ];
}

function pcTypeIncludes() {
  return [
    {
      id: 'pc-tower',
      label: 'Tower / Desktop',
      group: 'form',
      test: haystack => /\b(tower|midi[- ]?tower|midi|midtower|big tower|desktop|standgehaeuse|standgehause|office pc|gaming pc|komplett(?:system| pc)?)\b/.test(haystack)
        && !/\b(all[- ]?in[- ]?one|aio|mini[- ]?pc|nuc|sff|slim)\b/.test(haystack),
    },
    {
      id: 'pc-mini',
      label: 'Mini-PC / SFF',
      group: 'form',
      test: haystack => /\b(mini[- ]?pc|minipcs?|nuc|sff|small form|slim (pc|desktop)|usff|tinypc|tiny desktop|elitedesk|prodesk|optiplex micro|thinkcentre tiny|intel nuc)\b/.test(haystack),
    },
    {
      id: 'pc-aio',
      label: 'All-in-One',
      group: 'form',
      test: haystack => /\b(all[- ]?in[- ]?one|aio|einheit(?:s)?pc)\b/.test(haystack),
    },
  ];
}

function pcIncludeDefs() {
  return pcTypeIncludes().map(({ id, label, group }) => ({ id, label, group }));
}

function ramCapacityIncludes() {
  return [
    { id: 'ram-8', label: '8 GB', target: 8, group: 'capacity' },
    { id: 'ram-16', label: '16 GB', target: 16, group: 'capacity' },
    { id: 'ram-32', label: '32 GB', target: 32, group: 'capacity' },
    { id: 'ram-64', label: '64 GB', target: 64, group: 'capacity' },
  ];
}

function ramIncludeDefs() {
  return ramCapacityIncludes().map(({ id, label, group }) => ({ id, label, group }));
}

function parseRamCapacityTargets(haystack) {
  const text = String(haystack || '');
  const targets = new Set();
  for (const match of text.matchAll(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:gb|g)?\b/gi)) {
    const sticks = Number(match[1]);
    const each = Number(match[2]);
    if (sticks > 0 && each > 0) {
      targets.add(each);
      targets.add(sticks * each);
    }
  }
  const single = parseCapacityGb(text);
  if (single != null) targets.add(single);
  return [...targets];
}

function matchesRamCapacity(haystack, targetGb) {
  const wanted = Number(targetGb);
  if (!Number.isFinite(wanted) || wanted <= 0) return false;
  const tol = Math.max(1, Math.round(wanted * 0.06));
  return parseRamCapacityTargets(haystack).some(gb => Math.abs(gb - wanted) <= tol);
}

/**
 * The TOTAL kit capacity a RAM listing is selling — prefers a parsed "NxM" multiplication
 * (2x16GB -> 32, 4x32GB -> 128) over a bare capacity mention, because titles routinely state
 * both the per-stick and total size ("32GB (2x16GB)") and only the multiplied total answers
 * "how much RAM do I get", which is what a capacity-scoped search like "DDR4 32GB" means.
 */
function parseRamTotalCapacityGb(haystack) {
  const text = String(haystack || '');
  let total = null;
  for (const match of text.matchAll(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:gb|g)?\b/gi)) {
    const sticks = Number(match[1]);
    const each = Number(match[2]);
    if (sticks > 0 && each > 0) {
      const candidate = sticks * each;
      total = total == null ? candidate : Math.max(total, candidate);
    }
  }
  if (total != null) return total;
  return parseCapacityGb(text);
}

/** Unconditional (not opt-in) — used to require the query's requested total capacity. */
function matchesRamTotalCapacity(haystack, targetGb) {
  const wanted = Number(targetGb);
  if (!Number.isFinite(wanted) || wanted <= 0) return true;
  const total = parseRamTotalCapacityGb(haystack);
  if (total == null) return true; // couldn't parse a capacity — let other rules judge it
  const tol = Math.max(1, Math.round(wanted * 0.06));
  return Math.abs(total - wanted) <= tol;
}

function capacityIncludeDefs(searchQuery = '', categoryId = '') {
  if (isStorageSearch(searchQuery, categoryId)) return storageIncludeDefs();
  if (isRamSearch(searchQuery, categoryId)) return ramIncludeDefs();
  if (isPcCategory(categoryId)) return pcIncludeDefs();
  return [];
}

function matchesCapacityInclude(haystack, includeId) {
  const band = storageCapacityIncludes().find(item => item.id === includeId);
  if (band) return capacityInBand(haystack, band.min, band.max);
  const type = storageTypeIncludes().find(item => item.id === includeId);
  if (type) {
    try {
      return type.test(haystack);
    } catch {
      return false;
    }
  }
  const pc = pcTypeIncludes().find(item => item.id === includeId);
  if (pc) {
    try {
      return pc.test(haystack);
    } catch {
      return false;
    }
  }
  const ram = ramCapacityIncludes().find(item => item.id === includeId);
  if (ram) return matchesRamCapacity(haystack, ram.target);
  return false;
}

function failsCapacityIncludes(haystack, includeCapacities = []) {
  const wanted = [...new Set((includeCapacities || []).map(String))].filter(Boolean);
  if (!wanted.length) return false;
  const defs = [...storageIncludeDefs(), ...pcIncludeDefs(), ...ramIncludeDefs()]
    .filter(item => wanted.includes(item.id));
  if (!defs.length) return false;
  const groups = [...new Set(defs.map(item => item.group || 'any'))];
  // Within a group: OR. Across groups: AND.
  return groups.some(group => {
    const ids = defs.filter(item => (item.group || 'any') === group).map(item => item.id);
    return !ids.some(id => matchesCapacityInclude(haystack, id));
  });
}

function looksLikeStorageDrive(haystack) {
  return /\b(ssd|nvme|m\.?2|festplatte|hard ?disk|hdd|nas|sata|usb[- ]?stick)\b/.test(haystack);
}

function generateStorageSmartFilters() {
  return [
    {
      id: 'parts-defekt',
      label: 'Defekt / for parts',
      test: haystack => /\b(for parts|defekt|defect|ersatzteil|bastler|kaputt|not working|broken)\b/.test(haystack),
    },
    {
      id: 'fake-replica',
      label: 'Fake / lottery',
      test: haystack => /\b(fake|replica|nachbau|kopie|counterfeit|verlosung|gewinnspiel|lottery|raffle)\b/.test(haystack),
    },
    {
      id: 'reject-non-ssd',
      label: 'Non-SSD',
      test: haystack => !/\b(ssd|nvme|m\.?2)\b/.test(haystack),
    },
    {
      id: 'reject-hdd',
      label: 'HDD',
      test: haystack => /\b(hdd|hard ?disk|festplatte|spinning)\b/.test(haystack),
    },
    {
      id: 'reject-external',
      label: 'External / USB',
      test: haystack => /\b(external|externe|portable|extern|usb[- ]?(stick|drive|festplatte)|pendrive)\b/.test(haystack),
    },
    {
      id: 'reject-macbook-ssd',
      label: 'MacBook / A17xx SSD',
      test: haystack => /\b(macbook|a17\d{2}|a1466|a1502|656[- ]?\d{4}a?|apple ssd|fuer macbook|für macbook)\b/.test(haystack),
    },
    {
      id: 'reject-m2-2230',
      label: 'M.2 2230',
      test: haystack => /\b(2230|m\.?2\s*2230|nvme\s*2230)\b/.test(haystack),
    },
    {
      id: 'reject-m2-2242',
      label: 'M.2 2242',
      test: haystack => /\b(2242|m\.?2\s*2242|nvme\s*2242)\b/.test(haystack),
    },
    {
      id: 'reject-oem-mystery',
      label: 'Various brands / OEM pull',
      test: haystack => /\b(verschiedene marken|various brands|gemischt|mystery|random brand|oem pull)\b/.test(haystack),
    },
    {
      id: 'reject-tiny',
      label: '≤64 GB',
      test: haystack => capacityAtMost(haystack, 64),
    },
  ];
}

function generateGenericSmartFilters(searchQuery = '') {
  const q = normalizeListingText(searchQuery);
  const filters = [
    {
      id: 'parts-defekt',
      label: 'for parts / defekt',
      test: haystack => /\b(for parts|defekt|defect|ersatzteil|bastler|kaputt|not working|broken)\b/.test(haystack),
    },
    {
      id: 'fake-replica',
      label: 'fake / replica / lottery',
      test: haystack => /\b(fake|replica|nachbau|kopie|counterfeit|verlosung|gewinnspiel|lottery|raffle)\b/.test(haystack),
    },
  ];
  if (/\b4790\s*k\b/.test(q) || /\bi7\s*4790\b/.test(q)) {
    filters.push({
      id: 'require-4790k',
      label: 'must mention 4790K',
      test: haystack => !listingMentions4790k(haystack),
    });
  }
  if (/\b(bundle|aufruest|upgrade\s*kit|konvolut)\b/.test(q) && /\b4790\b/.test(q)) {
    filters.push({
      id: 'require-bundle-kit',
      label: 'must be Bundle / Aufrüstkit',
      test: haystack => !isBundleOrUpgradeKit(haystack),
    });
  }
  filters.push({
    id: 'hard-junk',
    label: 'hard junk title patterns',
    test: haystack => blockedPatterns.some(pattern => pattern.test(haystack)),
  });
  return filters;
}

function isPcEmptyCase(haystack) {
  return /\b(leergehaeuse|leergehause|empty case|case only|nur gehaeuse|nur gehause|gehaeuse only|gehause only|pc[- ]?gehaeuse|pc[- ]?gehause|midi[- ]?tower gehaeuse|tower gehaeuse)\b/.test(haystack)
    || (/\b(gehaeuse|gehause|case|chassis)\b/.test(haystack)
      && /\b(ohne|without|leer|empty|only|nur)\b/.test(haystack)
      && !hasPcComputeSignal(haystack));
}

function isPcAccessoryOnly(haystack) {
  const accessory = /\b(monitor|bildschirm|tastatur|keyboard|maus|mouse|lautsprecher|speaker|webcam|docking|dock station|kabel|cable|adapter|halterung|standfuss|fuß|foot)\b/.test(haystack);
  if (!accessory) return false;
  // Bundled desktop + monitor titles still look like PCs.
  if (hasPcComputeSignal(haystack)) return false;
  if (/\b(komplett(?:system| pc)?|desktop ?pc|office ?pc|gaming ?pc|mini[- ]?pc|all[- ]?in[- ]?one|\baio\b|workstation)\b/.test(haystack)) {
    return false;
  }
  return true;
}

function isPcPartOnly(haystack) {
  const partOnly = /\b(mainboard|motherboard|netzteil|power supply|\bpsu\b|prozessor only|cpu only|ram kit|arbeitsspeicher|grafikkarte|videokarte|luefter|kuehler|waermeleitpaste)\b/.test(haystack)
    || /\bnur (cpu|ram|mainboard|netzteil|gehaeuse|gehause|ssd|hdd)\b/.test(haystack)
    || /\b(cpu|ram|mainboard|netzteil) (only|alleine|einzeln)\b/.test(haystack);
  if (!partOnly) return false;
  // Real PCs often list CPU/RAM/SSD in the title — keep those.
  if (looksLikeCompletePc(haystack)) return false;
  return true;
}

function isPcBareboneIncomplete(haystack) {
  const bare = /\b(barebone|bare bone|ohnekpu|ohne cpu|ohne prozessor|without cpu|ohne ram|ohne speicher|ohne festplatte|ohne ssd|ohne hdd|ohne betriebssystem)\b/.test(haystack);
  if (!bare) return false;
  // "inkl. CPU/RAM" or full system wording wins.
  if (/\b(inkl|inklusive|mit)\b.{0,20}\b(cpu|prozessor|ram|ssd|hdd|windows)\b/.test(haystack)) return false;
  if (/\bkomplett(?:system| pc)?\b/.test(haystack)) return false;
  return true;
}

/** A specific CPU model/brand is named — narrower than hasPcComputeSignal (no RAM/DDR fallback). */
function hasCpuIdentity(haystack) {
  return /\b(core\s*i[3579]\b|ryzen|pentium|celeron|athlon|xeon|apple m[1-4]\b|snapdragon|intel\s*(n\d{2,4}|j\d{4}|atom))\b/.test(haystack)
    // Bare "i7-13700H" / "i5 8400" / "i9-14900HX" — real listings very often drop the
    // "Core" prefix entirely, especially laptop/mainboard ads (mobile CPU suffix H/HX/U).
    || /\bi[3579][- ]?\d{3,5}[a-z]{0,3}\b/.test(haystack)
    // "i7 12th gen" — generation wording instead of a model number.
    || /\bi[3579]\b[^.]{0,15}\bgen(eration)?\b/.test(haystack)
    // Bare Ryzen model "R7 7840HS" without the word "Ryzen" (same drop-the-brand pattern).
    || /\br[3579][- ]?\d{4}[a-z]{0,2}\b/.test(haystack);
}

function hasPcComputeSignal(haystack) {
  return hasCpuIdentity(haystack)
    || /\b(cpu|prozessor|soc)\b/.test(haystack)
    || /\b\d+\s*gb\b.{0,12}\b(ram|ddr\d?)\b/.test(haystack)
    || /\b(ddr[345]|ddr\d)\b/.test(haystack);
}

function looksLikeCompletePc(haystack) {
  if (isPcEmptyCase(haystack) || isPcAccessoryOnly(haystack)) return false;
  // Standalone memory / board kits are not PCs. Two bugs fixed here:
  // (1) "so-?dimm" never matched normalizeListingText's output — hyphens are already
  //     collapsed to spaces before this regex runs, so "SO-DIMM" arrives as "so dimm",
  //     which the old hyphen-or-nothing pattern silently failed to match.
  // (2) "mini-pc"/"komplett" don't belong in the PC-signal cancel-list below — they're
  //     exactly the words RAM/DIMM listings use to say "compatible with mini-PCs too",
  //     not evidence the listing itself is a whole system. ssd/nvme/hdd/festplatte/
  //     windows/desktop remain, since a real whole-PC ad genuinely mentioning RAM-kit
  //     wording overwhelmingly also states its storage/OS.
  if (/\b(ram kit|so[- ]?dimm|dimm kit|arbeitsspeicher)\b/.test(haystack)
    && !/\b(ssd|nvme|hdd|festplatte|windows|desktop)\b/.test(haystack)) {
    return false;
  }
  if (/\b(komplett(?:system| pc)?|fertig ?pc|desktop ?pc|office ?pc|gaming ?pc|workstation|all[- ]?in[- ]?one|\baio\b|mini[- ]?pc|intel nuc)\b/.test(haystack)) {
    return true;
  }
  // A literal "laptop"/"notebook" mention means the listing IS a laptop, not a desktop
  // component search hit — the RAM-kit guard above already exits early for SODIMM/RAM
  // wording that merely states laptop-*compatibility*, so by this point the word reliably
  // describes the item itself (e.g. a GPU search matching a whole gaming laptop's title).
  if (/\b(laptop|notebook|ultrabook|macbook|chromebook)\b/.test(haystack)) return true;
  const brandPc = /\b(dell|hp|hewlett|lenovo|fujitsu|acer|medion|packard ?bell|asus|msi|gigabyte|shuttle|be quiet|fractal|ibm|compaq|gateway|samsung|chuwi|minisforum|beelink|trigkey|gmkworld|celydd)\b/.test(haystack);
  const hasStorage = /\b(ssd|nvme|hdd|festplatte|m\.?2|emmc)\b/.test(haystack)
    || /\b\d+\s*tb\b/.test(haystack)
    || (/\b\d{2,4}\s*gb\b/.test(haystack) && !/\b(ram|ddr)\b/.test(haystack));
  const hasOs = /\b(windows|win\s?1[01]|win\s?7|linux|ubuntu|chrome ?os)\b/.test(haystack);
  const compute = hasPcComputeSignal(haystack);
  if (brandPc && (compute || hasStorage || hasOs)) return true;
  if (compute && (hasStorage || hasOs || brandPc)) return true;
  if (/\bpc\b/.test(haystack) && compute && hasStorage) return true;
  return false;
}

/**
 * Single lot-type classifier, shared by sold-median cleanup and live tagging.
 * Combines existing GPU-accessory rules with the existing whole-PC/bundle
 * rules (previously only used one-sidedly, for the opposite search direction).
 */
function classifyLotType(haystack) {
  if (isPackagingWithoutCard(haystack) || isGpuAccessory(haystack) || isReplacementPart(haystack)) {
    return 'accessory_only';
  }
  // Checked independently of looksLikeCompletePc: a CPU+mobo/RAM/GPU Konvolut is a donor
  // bundle even when it has no whole-PC signal at all (no OS/storage/brand-PC wording).
  if (isBundleOrUpgradeKit(haystack)) {
    return 'donor_bundle';
  }
  if (looksLikeCompletePc(haystack)) {
    return 'whole_pc';
  }
  // Neither explicit bundle wording nor a recognizable whole-PC signal, but a specific GPU
  // model AND a specific CPU model are both named — an assembled rig sold as one lot without
  // "PC"/"bundle" wording ("Gaming Setup R7 5800X RTX3060 32gb DDR4 RAM"). Checked last so
  // explicit bundle/whole-PC wording above always wins (e.g. "Gaming PC RTX 5070 Ryzen
  // 7800X3D" must stay whole_pc, not fall into this generic donor_bundle inference).
  if (hasGpuIdentity(haystack) && hasCpuIdentity(haystack)) {
    return 'donor_bundle';
  }
  return 'component';
}

function quantile(sortedNumbers, q) {
  if (!sortedNumbers.length) return null;
  const pos = (sortedNumbers.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedNumbers[base + 1] !== undefined) {
    return sortedNumbers[base] + rest * (sortedNumbers[base + 1] - sortedNumbers[base]);
  }
  return sortedNumbers[base];
}

/**
 * Flags sold 'component' lots that are cheap AND wording-ambiguous (OVP/Karton/...)
 * as probable accessory-only sales, so they don't drag the median down.
 * Needs >=4 component samples for IQR to mean anything — otherwise passes through.
 */
function filterSoldMedianOutliers(items, config) {
  const componentTotals = items
    .filter(item => item.lotType === 'component')
    .map(item => item.total)
    .sort((a, b) => a - b);
  if (componentTotals.length < 4) {
    return { clean: items, flagged: [] };
  }
  const q1 = quantile(componentTotals, 0.25);
  const q3 = quantile(componentTotals, 0.75);
  const median = quantile(componentTotals, 0.5);
  const iqr = q3 - q1;
  const lowerFence = q1 - config.iqrMultiplier * iqr;
  const priceFloor = median * config.minPriceRatioOfMedian;
  const keywords = (config.ambiguousAccessoryKeywords || []).map(kw => normalizeListingText(kw));

  const clean = [];
  const flagged = [];
  for (const item of items) {
    const haystack = normalizeListingText(item.sourceText || '');
    const isLowOutlier = item.total < lowerFence || item.total < priceFloor;
    const hasAmbiguousKeyword = keywords.some(kw => kw && haystack.includes(kw));
    if (item.lotType === 'component' && isLowOutlier && hasAmbiguousKeyword) {
      flagged.push({ ...item, probableAccessory: true });
    } else {
      clean.push(item);
    }
  }
  return { clean, flagged };
}

/**
 * Tukey-fenced low/high: the displayed band should read as "where this actually
 * trades", not get dragged to whatever single mislabeled/miskeyworded listing slipped
 * through classification (a "defekt" single at €22, a bundle misclassified as a
 * component at €2164). Below 4 samples IQR is meaningless, so pass raw min/max through
 * unchanged — same threshold filterSoldMedianOutliers already uses for the same reason.
 */
function robustBand(sortedTotals, iqrMultiplier = 1.5) {
  if (!sortedTotals.length) return { low: null, high: null };
  if (sortedTotals.length < 4) {
    return { low: sortedTotals[0], high: sortedTotals[sortedTotals.length - 1] };
  }
  const q1 = quantile(sortedTotals, 0.25);
  const q3 = quantile(sortedTotals, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - iqrMultiplier * iqr;
  const upperFence = q3 + iqrMultiplier * iqr;
  const withinFence = sortedTotals.filter(n => n >= lowerFence && n <= upperFence);
  if (!withinFence.length) return { low: sortedTotals[0], high: sortedTotals[sortedTotals.length - 1] };
  return { low: withinFence[0], high: withinFence[withinFence.length - 1] };
}

/** Shared by sold-median and by the live eBay/KA buckets in the buy-helper bridge. */
function summarizeComponentTotals(items) {
  const totals = items
    .filter(item => item.lotType === 'component')
    .map(item => item.total)
    .sort((a, b) => a - b);
  if (!totals.length) return { median: null, low: null, high: null, count: 0 };
  const { low, high } = robustBand(totals);
  return {
    median: totals[Math.floor((totals.length - 1) / 2)],
    low,
    high,
    count: totals.length,
  };
}

/** One consistent {median,low,high,count,items} shape for every source bucket in a buy-helper quote. */
function buildQuoteBucket(rawItems) {
  const items = rawItems || [];
  const summary = summarizeComponentTotals(items);
  if (!summary.count) return null;
  return {
    median: summary.median,
    low: summary.low,
    high: summary.high,
    count: summary.count,
    items: items.filter(item => item.lotType === 'component'),
  };
}

function generatePcSmartFilters() {
  return [
    {
      id: 'parts-defekt',
      label: 'for parts / defekt',
      test: haystack => /\b(for parts|defekt|defect|ersatzteil|bastler|kaputt|not working|broken|defekte)\b/.test(haystack),
    },
    {
      id: 'empty-case',
      label: 'empty case / Gehäuse only',
      test: haystack => isPcEmptyCase(haystack),
    },
    {
      id: 'pc-parts-only',
      label: 'parts only (CPU/RAM/board/PSU)',
      test: haystack => isPcPartOnly(haystack),
    },
    {
      id: 'pc-accessories',
      label: 'monitor / keyboard / accessories',
      test: haystack => isPcAccessoryOnly(haystack),
    },
    {
      id: 'laptop-notebook',
      label: 'laptop / notebook',
      test: haystack => /\b(laptop|notebook|macbook|chromebook|convertible)\b/.test(haystack)
        && !/\b(docking|dock station|fuer (laptop|notebook)|fuer laptop)\b/.test(haystack),
    },
    {
      id: 'barebone-incomplete',
      label: 'barebone / incomplete',
      test: haystack => isPcBareboneIncomplete(haystack),
    },
    {
      id: 'fake-replica',
      label: 'fake / replica / lottery',
      test: haystack => /\b(fake|replica|nachbau|kopie|counterfeit|verlosung|gewinnspiel|lottery|raffle)\b/.test(haystack),
    },
    {
      id: 'require-complete',
      label: 'must look like a complete PC',
      test: haystack => !looksLikeCompletePc(haystack),
    },
    {
      id: 'hard-junk',
      label: 'hard junk title patterns',
      test: haystack => blockedPatterns.some(pattern => pattern.test(haystack)),
    },
  ];
}

function looksLikeLaptopRam(haystack) {
  if (/\b(so-?dimm|sodimm)\b/.test(haystack)) return true;
  if (/\b(laptop|notebook|macbook)\b/.test(haystack) && /\b(ram|ddr|arbeitsspeicher|memory)\b/.test(haystack)) {
    return true;
  }
  return false;
}

/** Registered/ECC server memory — a different physical/electrical class from consumer DIMMs. */
function looksLikeServerRam(haystack) {
  return /\b(rdimm|lrdimm|fbdimm|registered dimm|reg ?ecc|ecc ?reg)\b/.test(haystack)
    || (/\becc\b/.test(haystack) && /\b(server|workstation|xeon|epyc)\b/.test(haystack));
}

function isDesktopDimmRam(haystack) {
  if (looksLikeLaptopRam(haystack)) return false;
  return /\b(udimm|dimm|desktop|pc ram|pc arbeitsspeicher|fuer desktop|for desktop|dimm only)\b/.test(haystack)
    || (/\bram\b/.test(haystack) && /\b(desktop|tower|pc)\b/.test(haystack) && !/\b(laptop|notebook|so-?dimm)\b/.test(haystack));
}

function listingHasDdrGen(haystack, gen) {
  const n = String(gen);
  if (new RegExp(`\\bddr\\s*${n}\\b`).test(haystack) || new RegExp(`\\bddr${n}\\b`).test(haystack)) return true;
  // JEDEC module codes: PC5-4800 = DDR5, PC4-25600 = DDR4, PC3-12800 = DDR3
  if (n === '5' && /\bpc5[- ]?\d{3,5}\b/.test(haystack)) return true;
  if (n === '4' && /\bpc4[- ]?\d{3,5}\b/.test(haystack)) return true;
  if (n === '3' && /\bpc3[- ]?\d{3,5}\b/.test(haystack)) return true;
  return false;
}

function ramSearchIntent(searchQuery = '') {
  const q = normalizeListingText(searchQuery);
  return {
    ddr5: listingHasDdrGen(q, 5),
    ddr4: listingHasDdrGen(q, 4),
    ddr3: listingHasDdrGen(q, 3),
    sodimm: /\b(so-?dimm|sodimm|laptop|notebook)\b/.test(q),
    server: /\b(rdimm|lrdimm|fbdimm|registered|server|workstation|xeon|epyc)\b/.test(q),
  };
}

function failsRamHardRules(haystack, searchQuery = '') {
  const want = ramSearchIntent(searchQuery);
  // SODIMM/DIMM adapters, converters, risers — not actual RAM sticks.
  if (/\badapt(?:e|o)r\b/.test(haystack)) return true;
  if (want.sodimm && !looksLikeLaptopRam(haystack)) return true;
  // Symmetric case: a plain desktop search ("DDR4 32GB", no sodimm/laptop/notebook wording)
  // must not surface laptop SO-DIMM either. Previously this direction only existed as the
  // opt-in 'desktop-dimm' smart filter, which the buy-helper bridge never enables — nothing
  // is watching the pills for an unattended background price check.
  if (!want.sodimm && looksLikeLaptopRam(haystack)) return true;
  // Same asymmetry for server RAM: registered/ECC memory needs a server/workstation board
  // and isn't a substitute for consumer desktop DIMMs, so it must not surface under a plain
  // "DDR4 32GB" search either. Conversely, an explicit RDIMM/server search must not accept
  // consumer unbuffered memory.
  if (!want.server && looksLikeServerRam(haystack)) return true;
  if (want.server && !looksLikeServerRam(haystack)) return true;
  if (want.ddr5) {
    if (!listingHasDdrGen(haystack, 5)) return true;
    if (listingHasDdrGen(haystack, 4) || listingHasDdrGen(haystack, 3)) return true;
  }
  if (want.ddr4) {
    if (!listingHasDdrGen(haystack, 4)) return true;
    if (listingHasDdrGen(haystack, 5) || listingHasDdrGen(haystack, 3)) return true;
  }
  if (want.ddr3) {
    if (!listingHasDdrGen(haystack, 3)) return true;
  }
  // A capacity mentioned in the search itself ("DDR4 32GB") means "this total kit size" —
  // reject kits whose actual total (from an "NxM" multiplication when present) doesn't match,
  // e.g. a 2x32GB=64GB kit or a 4x32GB=128GB kit surfacing under a "32GB" search.
  const targetCapacityGb = parseCapacityGb(searchQuery);
  if (targetCapacityGb != null && !matchesRamTotalCapacity(haystack, targetCapacityGb)) return true;
  return false;
}

function generateRamSmartFilters(searchQuery = '') {
  const want = ramSearchIntent(searchQuery);

  const rules = [
    {
      id: 'parts-defekt',
      label: 'for parts / defekt',
      test: haystack => /\b(for parts|defekt|defect|ersatzteil|bastler|kaputt|not working|broken)\b/.test(haystack),
    },
    {
      id: 'fake-replica',
      label: 'fake / replica / lottery',
      test: haystack => /\b(fake|replica|nachbau|kopie|counterfeit|verlosung|gewinnspiel|lottery|raffle)\b/.test(haystack),
    },
    {
      id: 'desktop-dimm',
      label: 'desktop DIMM (not laptop)',
      test: haystack => isDesktopDimmRam(haystack),
    },
    {
      id: 'ram-adapter',
      label: 'Adapter / converter',
      test: haystack => /\badapt(?:e|o)r\b/.test(haystack),
    },
    {
      id: 'storage-collision',
      label: 'SSD / HDD / storage false matches',
      test: haystack => {
        if (/\b(ddr|so-?dimm|sodimm|arbeitsspeicher|ram)\b/.test(haystack)) return false;
        return /\b(ssd|nvme|hdd|festplatte|usb[- ]?stick|speicherkarte)\b/.test(haystack);
      },
    },
    {
      id: 'hard-junk',
      label: 'hard junk title patterns',
      test: haystack => blockedPatterns.some(pattern => pattern.test(haystack)),
    },
  ];

  if (want.sodimm) {
    rules.push({
      id: 'require-sodimm',
      label: 'must be SODIMM / laptop RAM',
      test: haystack => !looksLikeLaptopRam(haystack),
    });
  }

  if (want.ddr5) {
    rules.push({
      id: 'require-ddr5',
      label: 'must be DDR5',
      test: haystack => !listingHasDdrGen(haystack, 5),
    });
    rules.push({
      id: 'wrong-ddr4',
      label: 'DDR4 (wrong generation)',
      test: haystack => listingHasDdrGen(haystack, 4),
    });
    rules.push({
      id: 'wrong-ddr3',
      label: 'DDR3 (wrong generation)',
      test: haystack => listingHasDdrGen(haystack, 3),
    });
  } else if (want.ddr4) {
    rules.push({
      id: 'require-ddr4',
      label: 'must be DDR4',
      test: haystack => !listingHasDdrGen(haystack, 4),
    });
  }

  return rules;
}

function generateGpuSmartFilters(searchQuery) {
  const wanted = parseGpuSearch(searchQuery);
  const rules = [
    {
      id: 'parts-defekt',
      label: 'for parts / defekt',
      test: haystack => /\b(for parts|defekt|defect|ersatzteil|bastler|kaputt|not working|broken)\b/.test(haystack),
    },
    {
      id: 'ovp-waterblock',
      label: 'OVP / waterblock / backplate only',
      test: haystack => isPackagingWithoutCard(haystack) || isGpuAccessory(haystack),
    },
    {
      id: 'gpu-adapter',
      label: 'Adapter / riser / converter',
      test: haystack => /\badapt(?:e|o)r\b/.test(haystack)
        || (/\b(riser|mining (?:frame|rack))\b/.test(haystack) && !looksLikeCompleteGpu(haystack)),
    },
    {
      id: 'replacement-fans',
      label: 'replacement fans / part kits',
      test: haystack => isReplacementPart(haystack),
    },
    {
      id: 'compat-dumps',
      label: 'multi-GPU compatibility dumps',
      test: haystack => isCompatibilityDump(haystack),
    },
    {
      id: 'fake-replica',
      label: 'fake / replica / lottery',
      test: haystack => /\b(fake|replica|nachbau|kopie|counterfeit|verlosung|gewinnspiel|lottery|raffle)\b/.test(haystack),
    },
    {
      id: 'laptop-mobile',
      label: 'laptop / Max-Q / notebook GPUs',
      test: haystack => /\b(laptop|notebook|max-?q|mobile (gpu|grafik)|fuer (laptop|notebook))\b/.test(haystack),
    },
  ];

  if (!wanted) {
    rules.push({
      id: 'hard-junk',
      label: 'hard junk title patterns',
      test: haystack => blockedPatterns.some(pattern => pattern.test(haystack)),
    });
    rules.push({
      id: 'require-complete',
      label: 'must look like a complete GPU',
      test: haystack => !looksLikeCompleteGpu(haystack),
    });
    return rules;
  }

  const label = formatGpuLabel(wanted);
  rules.push({
    id: 'require-model',
    label: `must be ${label}`,
    test: haystack => !matchesGpuSearch(haystack, searchQuery),
  });
  rules.push({
    id: 'require-complete',
    label: 'must look like a complete GPU',
    test: haystack => !looksLikeCompleteGpu(haystack),
  });

  if (!wanted.suffix) {
    rules.push({
      id: 'wrong-ti',
      label: `${wanted.model} Ti (different card)`,
      test: haystack => listingHasModelTi(haystack, wanted.model),
    });
  } else if (wanted.suffix === 'ti') {
    rules.push({
      id: 'require-ti',
      label: `must be ${wanted.model} Ti`,
      test: haystack => !listingHasModelTi(haystack, wanted.model),
    });
  }

  if (wanted.suffix === 'super') {
    rules.push({
      id: 'require-super',
      label: `must be ${wanted.model} Super`,
      test: haystack => !/\bsuper\b/.test(haystack),
    });
  }

  if (wanted.series === 'rtx' || wanted.series === 'gtx') {
    rules.push({
      id: 'wrong-gt',
      label: 'GT (not GTX/RTX) false matches',
      test: haystack => (/\bgt\s*\d{3,4}\b/.test(haystack) || /\bgt\d{3,4}\b/.test(haystack))
        && !listingHasGpuModel(haystack, wanted),
    });
  }

  const nearby = nearbyGpuModels(wanted.model);
  if (nearby.length) {
    rules.push({
      id: 'nearby-models',
      label: `other ${wanted.series.toUpperCase()} models (not ${wanted.model})`,
      test: haystack => {
        if (listingHasGpuModel(haystack, wanted)) return false;
        return nearby.some(model => listingHasGpuModel(haystack, { ...wanted, model, suffix: '' })
          || listingHasGpuModel(haystack, { ...wanted, model, suffix: 'ti' })
          || listingHasGpuModel(haystack, { ...wanted, model, suffix: 'super' }));
      },
    });
  }

  rules.push({
    id: 'hard-junk',
    label: 'hard junk title patterns',
    test: haystack => blockedPatterns.some(pattern => pattern.test(haystack)),
  });

  rules.push({
    id: 'storage-collision',
    label: `${wanted.model} in HDD/SSD product codes`,
    test: haystack => {
      if (listingHasGpuModel(haystack, wanted) || hasGpuIdentity(haystack)) return false;
      return new RegExp(`\\b\\w*${wanted.model}\\w*\\b`).test(haystack)
        && /\b(festplatte|hard ?disk|hdd|ssd|nvme|sata|nas)\b/.test(haystack);
    },
  });

  return rules;
}

function generateSmartFilters(searchQuery, categoryId = '') {
  if (isStorageSearch(searchQuery, categoryId)) return generateStorageSmartFilters();
  if (parseGpuSearch(searchQuery) || isGpuCategory(categoryId)) return generateGpuSmartFilters(searchQuery);
  if (isPcCategory(categoryId)) return generatePcSmartFilters();
  if (isRamSearch(searchQuery, categoryId)) return generateRamSmartFilters(searchQuery);
  return generateGenericSmartFilters(searchQuery);
}

function smartFilterDefs(searchQuery, categoryId = '') {
  return generateSmartFilters(searchQuery, categoryId).map(({ id, label }) => ({ id, label }));
}

function resolveEnabledSmartFilters(input = {}) {
  // Explicit list of active exclude-rules. Empty = nothing excluded (default).
  if (!Array.isArray(input.enabledSmartFilters)) return [];
  const aliases = {
    'require-ssd-nvme': 'reject-non-ssd',
  };
  return [...new Set(
    input.enabledSmartFilters
      .map(String)
      .map(id => aliases[id] || id)
      // Capacity belongs in includeCapacities now.
      .filter(id => !id.startsWith('capacity-') && !id.startsWith('cap-')),
  )].slice(0, 40);
}

function resolveIncludeCapacities(input = {}) {
  const allowed = new Set([
    ...storageIncludeDefs().map(item => item.id),
    ...pcIncludeDefs().map(item => item.id),
    ...ramIncludeDefs().map(item => item.id),
  ]);
  if (Array.isArray(input.includeCapacities)) {
    return [...new Set(input.includeCapacities.map(String))].filter(id => allowed.has(id)).slice(0, 20);
  }
  if (Array.isArray(input.enabledSmartFilters)) {
    const legacyMap = {
      'capacity-240-256': 'cap-240-256',
      'capacity-500-512': 'cap-480-512',
      'capacity-1tb': 'cap-1tb',
      'capacity-2tb': 'cap-2tb',
    };
    return [...new Set(
      input.enabledSmartFilters.map(String).map(id => legacyMap[id]).filter(Boolean),
    )].filter(id => allowed.has(id)).slice(0, 20);
  }
  return [];
}

function failsSmartFilters(haystack, searchQuery, enabledSmartFilters = [], categoryId = '') {
  const enabled = new Set(enabledSmartFilters || []);
  if (!enabled.size) return false;
  const rules = generateSmartFilters(searchQuery, categoryId).filter(rule => enabled.has(rule.id));
  return rules.some(rule => {
    try {
      return rule.test(haystack);
    } catch {
      return false;
    }
  });
}

function isBlockedListing(
  text,
  condition,
  conditionId,
  searchQuery = '',
  enabledSmartFilters = [],
  categoryId = '',
  includeCapacities = [],
) {
  if (isFaultyCondition(condition, conditionId)) return true;
  const haystack = normalizeListingText(`${text || ''} ${condition || ''}`);
  if (!haystack) return false;
  // Always enforce GPU model match when keywords parse as a card (not opt-in via pills).
  if (parseGpuSearch(searchQuery) && !matchesGpuSearch(haystack, searchQuery)) return true;
  if (isWrongGpuVariant(haystack, searchQuery)) return true;
  // Fan/shell kits often include the GPU name — never treat them as card matches.
  if ((parseGpuSearch(searchQuery) || isGpuCategory(categoryId)) && isReplacementPart(haystack)) return true;
  // Adapters, empty boxes, packaging-only — never treat as GPU cards.
  if ((parseGpuSearch(searchQuery) || isGpuCategory(categoryId)) && (
    isPackagingWithoutCard(haystack)
    || /\badapt(?:e|o)r\b/.test(haystack)
    || (/\b(riser|mining (?:frame|rack|rig only))\b/.test(haystack) && !looksLikeCompleteGpu(haystack))
  )) return true;
  // DDR5 / SODIMM keywords are hard requirements — not optional pills.
  if (isRamSearch(searchQuery, categoryId) && failsRamHardRules(haystack, searchQuery)) return true;
  if (failsSmartFilters(haystack, searchQuery, enabledSmartFilters, categoryId)) return true;
  if (failsCapacityIncludes(haystack, includeCapacities)) return true;
  return false;
}

if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
  console.warn('[dealwatch] EBAY_CLIENT_ID/SECRET missing — eBay search routes will fail until env is set.');
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0) process.env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
}

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function shortSearchLabel(search) {
  return String(search || '')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/^GeForce\s+/i, '')
    .trim() || 'Search';
}

function isGenericStorageKeyword(searchQuery = '') {
  const q = normalizeListingText(searchQuery);
  if (!q) return true;
  return /^(ssd|nvme|m\.?2|festplatte|speicher|speichermedien|storage|solid.?state)$/.test(q);
}

function storageBrowseQueries(query) {
  const variants = resolveSearchVariants(query);
  if (variants.length) return variants;

  const raw = String(query.search || '').trim();
  // Free-text search behaves like ebay.de: keywords drive Browse API `q`.
  if (raw) return [raw];

  const categoryId = String(query.categoryId || '');
  if (categoryId) return [''];

  if (isGenericStorageKeyword(raw)) {
    return ['SSD', 'NVMe', 'M.2'];
  }
  return [DEFAULT_FILTERS.search];
}

function resolveSearchVariants(input = {}) {
  if (Array.isArray(input.searchVariants)) {
    return [...new Set(input.searchVariants.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 6);
  }
  const raw = String(input.search || '');
  if (raw.includes('|')) {
    return [...new Set(raw.split('|').map(part => part.trim()).filter(Boolean))].slice(0, 6);
  }
  return [];
}

function isBundleOrUpgradeKit(haystack) {
  return /\b(bundle|konvolut|aufruest(?:kit|ung)?|upgrade(?:\s*kit)?|upgradekit)\b/.test(haystack);
}

function listingMentions4790k(haystack) {
  return /\b(?:i7[-\s]?)?4790\s*k\b/.test(haystack);
}

function makeSearchName(filters) {
  const min = Number(filters.minPrice) || 1;
  const max = Number(filters.maxPrice) || 0;
  const categoryHint = String(filters.categoryName || '').trim();
  const keyword = shortSearchLabel(filters.search);
  let base = 'Search';
  if (keyword && keyword !== 'Search') base = keyword;
  else if (/\bssd\b/i.test(categoryHint)) base = 'SSD';
  else if (categoryHint) {
    base = categoryHint
      .replace(/\(.*?\)/g, '')
      .replace(/Solid State Drives?/i, 'SSD')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ') || 'Search';
  }
  const capacityLabels = {
    'cap-120': '120 GB',
    'cap-120-128': '128 GB',
    'cap-240-256': '256 GB',
    'cap-480': '480 GB',
    'cap-500': '500 GB',
    'cap-480-512': '512 GB',
    'cap-1tb': '1 TB',
    'cap-2tb': '2 TB',
    'cap-4tb': '4 TB',
    'ram-8': '8 GB',
    'ram-16': '16 GB',
    'ram-32': '32 GB',
    'ram-64': '64 GB',
  };
  const order = [
    'cap-120',
    'cap-120-128',
    'cap-240-256',
    'cap-480',
    'cap-500',
    'cap-480-512',
    'cap-1tb',
    'cap-2tb',
    'cap-4tb',
    'ram-8',
    'ram-16',
    'ram-32',
    'ram-64',
  ];
  const selected = new Set(Array.isArray(filters.includeCapacities) ? filters.includeCapacities.map(String) : []);
  const sizes = order.filter(id => selected.has(id)).map(id => capacityLabels[id]).filter(Boolean);
  const head = sizes.length ? `${base} ${sizes.join(', ')}` : base;
  if (min > 1) return `${head} €${min}–${max}`;
  return `${head} under €${max}`;
}

function normalizeCategoryPath(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') return { id: '', name: String(item).slice(0, 80) };
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim().slice(0, 80);
      if (!id && !name) return null;
      return { id, name };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeKaCategory(input = {}) {
  const raw = String(input.kaCategory || '').trim().toLowerCase();
  if (KA_CATEGORIES[raw]) return raw;
  const byId = String(input.kaCategoryId || input.categoryId || '').replace(/\D/g, '');
  if (byId === '161') return 'elektronik';
  if (byId === '225') return 'pc-zubehoer';
  if (byId === '228') return 'pcs';
  if (byId === '279') return 'konsolen';
  return 'all';
}

function normalizeFilters(input = {}) {
  let minPrice = numberInRange(input.minPrice, DEFAULT_FILTERS.minPrice, 0, 5000);
  let maxPrice = numberInRange(input.maxPrice, DEFAULT_FILTERS.maxPrice, 1, 5000);
  if (minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  if (minPrice < 1) minPrice = 1;
  const categoryId = String(input.categoryId || '').replace(/\D/g, '').slice(0, 12);
  const categoryName = String(input.categoryName || '').trim().slice(0, 80);
  const categoryPath = normalizeCategoryPath(input.categoryPath);
  if (categoryId && categoryName && !categoryPath.length) {
    categoryPath.push({ id: categoryId, name: categoryName });
  }
  const rawSearch = String(input.search ?? '').trim().slice(0, 100);
  // Keywords optional: empty + category = browse category; keywords = ebay.de-style search.
  const search = rawSearch || (categoryId ? '' : DEFAULT_FILTERS.search);
  const enabledSmartFilters = resolveEnabledSmartFilters(input);
  const includeCapacities = resolveIncludeCapacities(input);
  const searchVariants = resolveSearchVariants(input);
  const marketplace = String(input.marketplace || '').toLowerCase() === 'kleinanzeigen'
    ? 'kleinanzeigen'
    : 'ebay';
  const kaCategory = marketplace === 'kleinanzeigen' ? normalizeKaCategory(input) : 'all';
  const locationId = marketplace === 'kleinanzeigen'
    ? String(input.locationId || '').replace(/\D/g, '').slice(0, 12)
    : '';
  const locationLabel = marketplace === 'kleinanzeigen'
    ? String(input.locationLabel || '').trim().slice(0, 80)
    : '';
  let radiusKm = Number(input.radiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm < 0) radiusKm = 0;
  radiusKm = KA_RADIUS_OPTIONS.includes(Math.floor(radiusKm))
    ? Math.floor(radiusKm)
    : Math.min(200, Math.max(0, Math.round(radiusKm)));
  if (!locationId) radiusKm = 0;
  return {
    search,
    minPrice,
    maxPrice,
    minFeedback: numberInRange(input.minFeedback, DEFAULT_FILTERS.minFeedback, 0, 100),
    condition: input.condition === 'used' ? 'used' : 'any',
    enabledSmartFilters,
    disabledSmartFilters: [],
    includeCapacities,
    searchVariants,
    categoryId: marketplace === 'kleinanzeigen' ? '' : categoryId,
    categoryName: marketplace === 'kleinanzeigen'
      ? ''
      : (categoryId ? (categoryName || categoryPath.at(-1)?.name || '') : ''),
    categoryPath: marketplace === 'kleinanzeigen' ? [] : (categoryId ? categoryPath : []),
    marketplace,
    kaCategory,
    locationId,
    locationLabel,
    radiusKm,
    shippingOnly: marketplace === 'kleinanzeigen' && Boolean(input.shippingOnly),
  };
}

const DEFAULT_BUY_HELPER_QUOTE_MAX_PRICE = 3000;

// A normal saved search defaults smart filters to "none" because a human is curating
// the results and can opt in via the pills. The buy-helper bridge has no one watching —
// it's a background price check — so it always keeps these two baseline exclusions on.
// Both ids exist verbatim in every category's smart-filter set (GPU/PC/RAM/storage/generic),
// so this is safe regardless of what the query turns out to be.
const BUY_HELPER_QUOTE_BASELINE_SMART_FILTERS = ['parts-defekt', 'fake-replica'];

/** Builds an ad-hoc, non-persisted query for /api/buy-helper/quote — no saved search involved. */
function buildBuyHelperQuoteQuery(searchParams, marketplace) {
  const explicitSmartFilters = searchParams.get('enabledSmartFilters')
    ? String(searchParams.get('enabledSmartFilters')).split(',').filter(Boolean)
    : [];
  return normalizeFilters({
    search: searchParams.get('query') || '',
    minPrice: searchParams.get('minPrice') || 1,
    maxPrice: searchParams.get('maxPrice') || DEFAULT_BUY_HELPER_QUOTE_MAX_PRICE,
    minFeedback: 0,
    condition: 'any',
    marketplace,
    categoryId: marketplace === 'ebay' ? (searchParams.get('categoryId') || '') : '',
    kaCategory: marketplace === 'kleinanzeigen' ? (searchParams.get('kaCategory') || 'all') : 'all',
    enabledSmartFilters: [...new Set([...BUY_HELPER_QUOTE_BASELINE_SMART_FILTERS, ...explicitSmartFilters])],
    includeCapacities: searchParams.get('includeCapacities')
      ? String(searchParams.get('includeCapacities')).split(',').filter(Boolean)
      : [],
  });
}

function createTrackedSearch(input = {}, { touch = true } = {}) {
  const filters = normalizeFilters(input);
  const now = new Date().toISOString();
  const rawName = String(input.name || makeSearchName(filters))
    .replace(/\s+до\s+€/gi, ' under €')
    .trim()
    .slice(0, 80);
  const monitor = Object.prototype.hasOwnProperty.call(input, 'monitor')
    ? !(input.monitor === false || input.monitor === 0 || input.monitor === '0')
    : true;
  return {
    id: input.id || crypto.randomUUID(),
    name: rawName || makeSearchName(filters),
    ...filters,
    monitor,
    smartFilters: smartFilterDefs(filters.search, filters.categoryId),
    capacityIncludes: capacityIncludeDefs(filters.search, filters.categoryId),
    createdAt: input.createdAt || now,
    updatedAt: touch ? now : (input.updatedAt || now),
  };
}

function slimCategoryNode(node) {
  const kids = (node.childCategoryTreeNodes || []).map(slimCategoryNode);
  return {
    id: String(node.category?.categoryId || ''),
    name: String(node.category?.categoryName || ''),
    leaf: Boolean(node.leafCategoryTreeNode) || kids.length === 0,
    children: kids,
  };
}

function loadPcCategoryTreeFromDisk() {
  for (const filePath of [PC_CATEGORY_CACHE_PATH, PC_CATEGORY_SEED_PATH]) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(raw?.categories) && raw.categories.length) return raw;
    } catch {
      // try next source
    }
  }
  return {
    marketplace: EBAY_MARKETPLACE_ID,
    rootId: '58058',
    rootName: 'Computer, Tablets & Netzwerk',
    updatedAt: null,
    categories: [],
  };
}

function getPcCategoryTree() {
  if (!pcCategoryTree) pcCategoryTree = loadPcCategoryTreeFromDisk();
  return pcCategoryTree;
}

function findCategoryNode(nodes, id, trail = []) {
  for (const node of nodes || []) {
    const nextTrail = [...trail, { id: node.id, name: node.name }];
    if (String(node.id) === String(id)) return { node, path: nextTrail };
    const nested = findCategoryNode(node.children, id, nextTrail);
    if (nested) return nested;
  }
  return null;
}

function listCategoryChildren(parentId = '') {
  const tree = getPcCategoryTree();
  if (!parentId) {
    return {
      marketplace: tree.marketplace || EBAY_MARKETPLACE_ID,
      rootId: tree.rootId || '58058',
      rootName: tree.rootName || 'Computer, Tablets & Netzwerk',
      updatedAt: tree.updatedAt || null,
      parent: null,
      path: [],
      categories: (tree.categories || []).map(node => ({
        id: node.id,
        name: node.name,
        leaf: Boolean(node.leaf) || !(node.children || []).length,
        childCount: (node.children || []).length,
      })),
    };
  }
  const found = findCategoryNode(tree.categories || [], parentId);
  if (!found) {
    const error = new Error(`Unknown category ${parentId}`);
    error.status = 404;
    throw error;
  }
  return {
    marketplace: tree.marketplace || EBAY_MARKETPLACE_ID,
    rootId: tree.rootId || '58058',
    rootName: tree.rootName || 'Computer, Tablets & Netzwerk',
    updatedAt: tree.updatedAt || null,
    parent: { id: found.node.id, name: found.node.name, leaf: Boolean(found.node.leaf) },
    path: found.path,
    categories: (found.node.children || []).map(node => ({
      id: node.id,
      name: node.name,
      leaf: Boolean(node.leaf) || !(node.children || []).length,
      childCount: (node.children || []).length,
    })),
  };
}

function normalizeCategoryQuery(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// English / slang → German eBay category keywords (and optional preferred category ids).
const CATEGORY_SEARCH_ALIASES = {
  gpu: { terms: 'grafik videokarten graka', prefer: ['27386'] },
  gpus: { terms: 'grafik videokarten', prefer: ['27386'] },
  graphics: { terms: 'grafik videokarten', prefer: ['27386'] },
  'graphics card': { terms: 'grafik videokarten', prefer: ['27386'] },
  'video card': { terms: 'grafik videokarten', prefer: ['27386'] },
  graka: { terms: 'grafik videokarten', prefer: ['27386'] },
  cpu: { terms: 'cpus prozessoren', prefer: ['164'] },
  cpus: { terms: 'cpus prozessoren', prefer: ['164'] },
  processor: { terms: 'prozessoren', prefer: ['164'] },
  processors: { terms: 'prozessoren', prefer: ['164'] },
  ram: { terms: 'arbeitsspeicher ram', prefer: ['170083'] },
  memory: { terms: 'arbeitsspeicher ram', prefer: ['170083'] },
  storage: { terms: 'laufwerke speichermedien festplatten ssd nas hdd usb sticks', prefer: ['165', '182085'] },
  drive: { terms: 'laufwerke festplatten', prefer: ['165', '182085'] },
  drives: { terms: 'laufwerke festplatten', prefer: ['165', '182085'] },
  disk: { terms: 'festplatten speichermedien', prefer: ['182085'] },
  disks: { terms: 'festplatten speichermedien', prefer: ['182085'] },
  harddrive: { terms: 'festplatten hdd', prefer: ['56083', '182085'] },
  'hard drive': { terms: 'festplatten hdd', prefer: ['56083', '182085'] },
  'hard disk': { terms: 'festplatten hdd', prefer: ['56083', '182085'] },
  hdd: { terms: 'festplatten hdd', prefer: ['56083', '182085'] },
  ssd: { terms: 'solid state drives ssd festplatten', prefer: ['175669', '182085'] },
  nvme: { terms: 'solid state drives ssd', prefer: ['175669'] },
  nas: { terms: 'netzgebundener speicher nas festplatten', prefer: ['106273', '182085'] },
  external: { terms: 'externe', prefer: ['131553'] },
  internal: { terms: 'interne', prefer: ['56083'] },
  'flash drive': { terms: 'usb sticks', prefer: ['51071'] },
  'usb stick': { terms: 'usb sticks', prefer: ['51071'] },
  'usb sticks': { terms: 'usb sticks', prefer: ['51071'] },
  thumbdrive: { terms: 'usb sticks', prefer: ['51071'] },
  psu: { terms: 'netzteile', prefer: ['42017'] },
  'power supply': { terms: 'netzteile', prefer: ['42017'] },
  powersupply: { terms: 'netzteile', prefer: ['42017'] },
  motherboard: { terms: 'mainboards', prefer: ['1244'] },
  mobo: { terms: 'mainboards', prefer: ['1244'] },
  mainboard: { terms: 'mainboards', prefer: ['1244'] },
  case: { terms: 'computergehause gehause', prefer: ['42014', '175674'] },
  chassis: { terms: 'computergehause', prefer: ['42014'] },
  cooler: { terms: 'lufter kuehlkorper kuehlung', prefer: ['42000'] },
  cooling: { terms: 'lufter kuehlkorper kuehlung', prefer: ['42000'] },
  fan: { terms: 'gehauselufter lufter', prefer: ['131487'] },
  fans: { terms: 'gehauselufter lufter', prefer: ['131487'] },
  'water cooling': { terms: 'wasserkuhlung', prefer: ['131503'] },
  aio: { terms: 'wasserkuhlung', prefer: ['131503'] },
  monitor: { terms: 'monitore projektoren', prefer: ['162497'] },
  display: { terms: 'monitore', prefer: ['162497'] },
  laptop: { terms: 'notebooks netbooks', prefer: ['175672'] },
  notebook: { terms: 'notebooks netbooks', prefer: ['175672'] },
  desktop: { terms: 'desktops all in one', prefer: ['171957'] },
  pc: { terms: 'desktops computer komponenten', prefer: ['171957', '175673'] },
  keyboard: { terms: 'tastaturen', prefer: ['3676'] },
  mouse: { terms: 'mause pointing', prefer: ['3676'] },
  cable: { terms: 'kabel steckverbinder', prefer: ['182094'] },
  cables: { terms: 'kabel steckverbinder', prefer: ['182094'] },
  network: { terms: 'heimnetzwerke router switches', prefer: ['11176'] },
  router: { terms: 'router heimnetzwerke', prefer: ['11176'] },
  wifi: { terms: 'wlan router access points', prefer: ['11176'] },
  server: { terms: 'firmennetzwerke server', prefer: ['175698'] },
  soundcard: { terms: 'soundkarten', prefer: ['44980'] },
  'sound card': { terms: 'soundkarten', prefer: ['44980'] },
};

function resolveCategoryAlias(phrase) {
  const key = normalizeCategoryQuery(phrase);
  const hit = CATEGORY_SEARCH_ALIASES[key];
  if (!hit) return null;
  return {
    terms: normalizeCategoryQuery(hit.terms).split(/\s+/).filter(Boolean),
    prefer: new Set((hit.prefer || []).map(String)),
  };
}

function resolveCategorySearch(query) {
  const raw = String(query || '').trim();
  const normalized = normalizeCategoryQuery(raw);
  if (!normalized) return { tokens: [], prefer: new Set(), alias: false };

  const full = resolveCategoryAlias(normalized);
  if (full) {
    return { tokens: full.terms, prefer: full.prefer, alias: true };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  const tokens = [];
  const prefer = new Set();
  let alias = false;
  // Try multi-word alias chunks (longest first), then single words.
  let i = 0;
  while (i < parts.length) {
    let matched = null;
    let consumed = 1;
    for (let size = Math.min(3, parts.length - i); size >= 1; size -= 1) {
      const chunk = parts.slice(i, i + size).join(' ');
      const hit = resolveCategoryAlias(chunk);
      if (hit) {
        matched = hit;
        consumed = size;
        break;
      }
    }
    if (matched) {
      alias = true;
      matched.terms.forEach(term => tokens.push(term));
      matched.prefer.forEach(id => prefer.add(id));
    } else {
      tokens.push(parts[i]);
    }
    i += consumed;
  }
  return { tokens: [...new Set(tokens)], prefer, alias };
}

function searchPcCategories(query, limit = 40) {
  const { tokens, prefer, alias } = resolveCategorySearch(query);
  if (!tokens.length) {
    return { query: '', results: [] };
  }
  const original = normalizeCategoryQuery(query);
  const results = [];
  const walk = (nodes, trail) => {
    for (const node of nodes || []) {
      const path = [...trail, { id: String(node.id), name: node.name }];
      const nameHay = normalizeCategoryQuery(node.name);
      const pathHay = normalizeCategoryQuery(path.map(item => item.name).join(' '));
      const hay = `${nameHay} ${pathHay}`;
      const matchedInName = tokens.filter(token => nameHay.includes(token));
      const matchedInPath = tokens.filter(token => hay.includes(token));
      if (!matchedInPath.length) {
        if (node.children?.length) walk(node.children, path);
        continue;
      }
      let score = 0;
      if (nameHay === original) score = 100;
      else if (matchedInName.length === tokens.length) score = 92;
      else if (matchedInName.length) score = 70 + matchedInName.length * 6;
      else if (matchedInPath.length === tokens.length) score = 60;
      else score = 35 + matchedInPath.length * 4;

      if (prefer.has(String(node.id))) score += 25;
      if (alias && matchedInName.length) score += 8;
      // Prefer tighter/more specific categories when equally relevant.
      score += Math.max(0, 6 - path.length);

      results.push({
        id: String(node.id),
        name: node.name,
        leaf: Boolean(node.leaf) || !(node.children || []).length,
        childCount: (node.children || []).length,
        path,
        pathLabel: path.map(item => item.name).join(' › '),
        score,
      });
      if (node.children?.length) walk(node.children, path);
    }
  };
  walk(getPcCategoryTree().categories || [], []);
  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.name.localeCompare(b.name, 'de'));
  return {
    query: String(query || '').trim(),
    results: results.slice(0, limit).map(({ score, ...item }) => item),
  };
}

async function refreshPcCategoryTreeFromEbay() {
  const token = await accessToken({ forceRefresh: false });
  const treeIdRes = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(EBAY_MARKETPLACE_ID)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const treeIdJson = await treeIdRes.json();
  if (!treeIdRes.ok) throw new Error(treeIdJson.errors?.[0]?.message || 'Could not resolve eBay category tree id.');
  const treeId = treeIdJson.categoryTreeId;
  const subtreeRes = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree?category_id=58058`,
    { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' } },
  );
  const subtree = await subtreeRes.json();
  if (!subtreeRes.ok) throw new Error(subtree.errors?.[0]?.message || 'Could not fetch eBay computer categories.');
  const computer = slimCategoryNode(subtree.categorySubtreeNode || {});
  const categories = (computer.children || [])
    .filter(node => PC_PARTS_ROOT_IDS.has(String(node.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const payload = {
    marketplace: EBAY_MARKETPLACE_ID,
    rootId: computer.id || '58058',
    rootName: computer.name || 'Computer, Tablets & Netzwerk',
    categoryTreeId: String(treeId),
    updatedAt: new Date().toISOString(),
    categories,
  };
  ensureDataDir();
  fs.writeFileSync(PC_CATEGORY_CACHE_PATH, JSON.stringify(payload, null, 2));
  fs.writeFileSync(PC_CATEGORY_SEED_PATH, JSON.stringify(payload, null, 2));
  pcCategoryTree = payload;
  return payload;
}

function ensureDataDir() {
  const dir = process.env.VERCEL ? path.dirname(STORE_PATH) : DATA_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function emptyStore() {
  const searches = KA_IMPORTED_SEARCHES.map(item => createTrackedSearch({
    ...item,
    marketplace: 'kleinanzeigen',
    minPrice: item.minPrice ?? 1,
    minFeedback: 0,
    condition: 'any',
    kaCategory: item.kaCategory || 'all',
    enabledSmartFilters: item.enabledSmartFilters || [],
  }, { touch: false }));
  return {
    activeId: searches[0]?.id || '',
    alerts: true,
    searches,
    trash: [],
    watchlist: [],
    seenBySearch: {},
    offersSent: [],
    notifications: [],
    kaPurchases: [],
    kaSales: [],
  };
}

function ensureKleinanzeigenImportedSearches(store) {
  const byId = new Map(store.searches.map(item => [item.id, item]));
  const imported = [];
  for (const spec of KA_IMPORTED_SEARCHES) {
    if (byId.has(spec.id)) {
      imported.push(byId.get(spec.id));
      continue;
    }
    imported.push(createTrackedSearch({
      ...spec,
      marketplace: 'kleinanzeigen',
      minPrice: spec.minPrice ?? 1,
      minFeedback: 0,
      condition: 'any',
      kaCategory: spec.kaCategory || 'all',
      enabledSmartFilters: spec.enabledSmartFilters || [],
    }, { touch: false }));
  }
  const importedIds = new Set(imported.map(item => item.id));
  const rest = store.searches.filter(item => !importedIds.has(item.id));
  store.searches = [...imported, ...rest];
  if (!store.searches.some(item => item.id === store.activeId)) {
    store.activeId = store.searches[0]?.id || '';
  }
  return store;
}

function normalizeSeenBySearch(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [searchId, ids] of Object.entries(raw)) {
    if (!searchId || !Array.isArray(ids)) continue;
    out[String(searchId)] = [...new Set(ids.map(String))].slice(0, 2000);
  }
  return out;
}

function normalizeOffersSent(raw = []) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(Boolean))].slice(0, 2000);
}

function normalizeNotifications(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && item.id && item.itemId)
    .map(item => ({
      id: String(item.id),
      searchId: String(item.searchId || ''),
      searchName: String(item.searchName || '').slice(0, 80),
      itemId: String(item.itemId),
      title: String(item.title || '').slice(0, 200),
      price: Number(item.price) || 0,
      total: Number(item.total) || 0,
      url: String(item.url || ''),
      image: String(item.image || ''),
      createdAt: item.createdAt || new Date().toISOString(),
      read: Boolean(item.read),
    }))
    .slice(0, 100);
}

function normalizeKaPurchases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && item.id)
    .map(item => ({
      id: String(item.id),
      conversationId: String(item.conversationId || ''),
      title: String(item.displayName || item.title || '').slice(0, 200),
      displayName: String(item.displayName || item.title || '').slice(0, 200),
      adId: String(item.adId || ''),
      seller: String(item.seller || item.counterparty || '').slice(0, 120),
      buyer: String(item.buyer || 'You').slice(0, 120),
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
      purchasedAt: item.purchasedAt || item.paidAt || item.at || item.importedAt || new Date().toISOString(),
      paidAt: item.paidAt || item.purchasedAt || item.at || null,
      evidence: String(item.evidence || '').slice(0, 400),
      url: String(item.url || ''),
      role: String(item.role || ''),
      channel: String(item.channel || 'chat'),
      score: Number(item.score) || 0,
      period: String(item.period || ''),
      source: String(item.source || 'extension'),
      confirmed: item.confirmed !== false,
      importedAt: item.importedAt || new Date().toISOString(),
    }))
    .sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)))
    .slice(0, 300);
}

function normalizeKaSales(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && item.id)
    .map(item => ({
      id: String(item.id),
      conversationId: String(item.conversationId || ''),
      title: String(item.displayName || item.title || '').slice(0, 200),
      displayName: String(item.displayName || item.title || '').slice(0, 200),
      adId: String(item.adId || ''),
      buyer: String(item.buyer || item.counterparty || '').slice(0, 120),
      seller: String(item.seller || 'You').slice(0, 120),
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
      soldAt: item.soldAt || item.paidAt || item.at || item.purchasedAt || item.importedAt || new Date().toISOString(),
      paidAt: item.paidAt || item.soldAt || item.at || null,
      evidence: String(item.evidence || '').slice(0, 400),
      url: String(item.url || ''),
      role: String(item.role || ''),
      channel: String(item.channel || 'chat'),
      score: Number(item.score) || 0,
      period: String(item.period || ''),
      source: String(item.source || 'extension'),
      confirmed: item.confirmed !== false,
      importedAt: item.importedAt || new Date().toISOString(),
    }))
    .sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt)))
    .slice(0, 300);
}

function normalizeStore(raw = {}) {
  const searches = Array.isArray(raw.searches) ? raw.searches.map(item => createTrackedSearch(item, { touch: false })) : [];
  const trash = Array.isArray(raw.trash)
    ? raw.trash.map(item => ({ ...createTrackedSearch(item, { touch: false }), deletedAt: item.deletedAt || new Date().toISOString() }))
    : [];
  const watchlist = Array.isArray(raw.watchlist)
    ? raw.watchlist.filter(item => item && item.id).map(item => ({
      id: String(item.id),
      legacyItemId: String(item.legacyItemId || ''),
      title: String(item.title || ''),
      seller: String(item.seller || ''),
      feedback: Number(item.feedback) || 0,
      feedbackScore: Number.isFinite(Number(item.feedbackScore)) ? Number(item.feedbackScore) : null,
      condition: String(item.condition || ''),
      price: Number(item.price) || 0,
      shipping: Number(item.shipping) || 0,
      total: Number(item.total) || 0,
      image: String(item.image || ''),
      endDate: item.endDate || null,
      url: String(item.url || ''),
      isAuction: Boolean(item.isAuction),
      bestOffer: Boolean(item.bestOffer),
      dealScore: Number(item.dealScore) || 0,
      savedAt: item.savedAt || new Date().toISOString(),
    }))
    : [];

  let store = {
    activeId: raw.activeId || '',
    alerts: raw.alerts !== false && raw.alerts !== '0' && raw.alerts !== 0,
    searches,
    trash,
    watchlist,
    seenBySearch: normalizeSeenBySearch(raw.seenBySearch),
    offersSent: normalizeOffersSent(raw.offersSent),
    notifications: normalizeNotifications(raw.notifications),
    kaPurchases: normalizeKaPurchases(raw.kaPurchases),
    kaSales: normalizeKaSales(raw.kaSales),
  };

  if (!store.searches.length) {
    const seeded = emptyStore();
    store = {
      ...seeded,
      trash: store.trash,
      watchlist: store.watchlist,
      alerts: store.alerts,
      seenBySearch: store.seenBySearch,
      offersSent: store.offersSent || [],
      notifications: store.notifications,
      kaPurchases: store.kaPurchases || [],
      kaSales: store.kaSales || [],
    };
  }
  if (!store.searches.some(item => item.id === store.activeId)) {
    store.activeId = store.searches[0].id;
  }
  store = ensureKleinanzeigenImportedSearches(store);
  // Drop seen/notification rows for deleted searches.
  const liveIds = new Set(store.searches.map(item => item.id));
  store.seenBySearch = Object.fromEntries(
    Object.entries(store.seenBySearch).filter(([id]) => liveIds.has(id)),
  );
  store.notifications = store.notifications.filter(item => !item.searchId || liveIds.has(item.searchId));
  return store;
}

function migrateLegacySearch() {
  if (!fs.existsSync(LEGACY_SEARCH_PATH)) return null;
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_SEARCH_PATH, 'utf8'));
    const search = createTrackedSearch(legacy);
    return {
      activeId: search.id,
      alerts: legacy.alerts !== false,
      searches: [search],
      trash: [],
      watchlist: [],
    };
  } catch {
    return null;
  }
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const seedFrom =
        (fs.existsSync(STORE_SEED_PATH) && STORE_SEED_PATH)
        || (fs.existsSync(PUBLIC_STORE_SEED) && PUBLIC_STORE_SEED)
        || null;
      if (seedFrom) {
        ensureDataDir();
        fs.copyFileSync(seedFrom, STORE_PATH);
      }
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      const store = normalizeStore(raw);
      const rawIds = new Set((Array.isArray(raw.searches) ? raw.searches : []).map(item => item?.id).filter(Boolean));
      const kaMissing = KA_IMPORTED_SEARCHES.some(spec => !rawIds.has(spec.id));
      if (kaMissing) {
        ensureDataDir();
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
      }
      return store;
    }
    const migrated = migrateLegacySearch();
    if (migrated) {
      return saveStore(migrated);
    }
  } catch {
    // fall through
  }
  return saveStore(emptyStore());
}

function saveStore(store) {
  ensureDataDir();
  const normalized = normalizeStore(store);
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function getActiveSearch(store = loadStore()) {
  return store.searches.find(item => item.id === store.activeId) || store.searches[0];
}

function storeMeta(store = loadStore()) {
  return {
    ...store,
    monitorIntervalMinutes: MONITOR_INTERVAL_MINUTES,
    telegramConfigured: telegramConfigured(),
  };
}

async function readJsonBody(request) {
  // Vercel may already parse JSON onto req.body.
  if (request && request.body != null && request.body !== '') {
    if (typeof request.body === 'string') {
      try {
        return JSON.parse(request.body);
      } catch {
        return {};
      }
    }
    if (typeof request.body === 'object') return request.body;
  }
  const chunks = [];
  try {
    for await (const chunk of request) chunks.push(chunk);
  } catch {
    return {};
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function corsHeaders(request) {
  const origin = String(request?.headers?.origin || '');
  const allow =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : '';
  if (!allow) return {};
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

const DEFAULT_CLASSIFIER_CONFIG = {
  soldMedianOutlier: {
    iqrMultiplier: 1.5,
    minPriceRatioOfMedian: 0.4,
    ambiguousAccessoryKeywords: ['ovp', 'karton', 'verpackung', 'originalverpackung', 'box'],
  },
};

/** Tunable classifier/outlier thresholds — edit data/classifier-config.json, no code change needed. */
function loadClassifierConfig() {
  if (!fs.existsSync(CLASSIFIER_CONFIG_PATH)) return DEFAULT_CLASSIFIER_CONFIG;
  try {
    const raw = JSON.parse(fs.readFileSync(CLASSIFIER_CONFIG_PATH, 'utf8'));
    const outlier = raw.soldMedianOutlier || {};
    return {
      soldMedianOutlier: {
        iqrMultiplier: Number.isFinite(Number(outlier.iqrMultiplier))
          ? Number(outlier.iqrMultiplier)
          : DEFAULT_CLASSIFIER_CONFIG.soldMedianOutlier.iqrMultiplier,
        minPriceRatioOfMedian: Number.isFinite(Number(outlier.minPriceRatioOfMedian))
          ? Number(outlier.minPriceRatioOfMedian)
          : DEFAULT_CLASSIFIER_CONFIG.soldMedianOutlier.minPriceRatioOfMedian,
        ambiguousAccessoryKeywords: Array.isArray(outlier.ambiguousAccessoryKeywords)
          ? outlier.ambiguousAccessoryKeywords.map(String)
          : DEFAULT_CLASSIFIER_CONFIG.soldMedianOutlier.ambiguousAccessoryKeywords,
      },
    };
  } catch (error) {
    console.error('Failed to load classifier-config.json:', error.message);
    return DEFAULT_CLASSIFIER_CONFIG;
  }
}

function loadGpuSpecsDb() {
  ensureDataDir();
  if (!fs.existsSync(GPU_SPECS_PATH)) {
    return { version: 1, baselineId: 'gtx-980', gpus: [], note: 'No GPU specs database found.' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(GPU_SPECS_PATH, 'utf8'));
    const gpus = Array.isArray(raw.gpus) ? raw.gpus : [];
    return {
      version: Number(raw.version) || 1,
      baselineId: String(raw.baselineId || 'gtx-980'),
      updatedAt: raw.updatedAt || null,
      note: raw.note || '',
      source: raw.source || '',
      gpus,
    };
  } catch (error) {
    console.error('Failed to load gpu-specs.json:', error.message);
    return { version: 1, baselineId: 'gtx-980', gpus: [], note: 'GPU specs database is unreadable.' };
  }
}

function findGpuById(id) {
  const needle = String(id || '').trim().toLowerCase();
  if (!needle) return null;
  return (loadGpuSpecsDb().gpus || []).find(gpu => String(gpu.id || '').toLowerCase() === needle) || null;
}

const GPU_COMPARE_FIELDS = [
  { key: 'relativeRaster', label: 'Relative raster (GTX 980 = 100)', kind: 'number', higherBetter: true, unit: '' },
  { key: 'releaseYear', label: 'Release year', kind: 'number', higherBetter: true, unit: '' },
  { key: 'architecture', label: 'Architecture', kind: 'text' },
  { key: 'processNm', label: 'Process', kind: 'number', higherBetter: false, unit: 'nm' },
  { key: 'shaders', label: 'CUDA cores / shaders', kind: 'number', higherBetter: true, unit: '' },
  { key: 'rtCores', label: 'RT cores', kind: 'number', higherBetter: true, unit: '' },
  { key: 'tensorCores', label: 'Tensor cores', kind: 'number', higherBetter: true, unit: '' },
  { key: 'baseClockMhz', label: 'Base clock', kind: 'number', higherBetter: true, unit: 'MHz' },
  { key: 'boostClockMhz', label: 'Boost clock', kind: 'number', higherBetter: true, unit: 'MHz' },
  { key: 'memoryGb', label: 'VRAM', kind: 'number', higherBetter: true, unit: 'GB' },
  { key: 'memoryType', label: 'Memory type', kind: 'text' },
  { key: 'memoryBusBits', label: 'Memory bus', kind: 'number', higherBetter: true, unit: '-bit' },
  { key: 'bandwidthGBs', label: 'Bandwidth', kind: 'number', higherBetter: true, unit: 'GB/s' },
  { key: 'tdpW', label: 'TDP', kind: 'number', higherBetter: false, unit: 'W' },
  { key: 'launchPriceEur', label: 'Launch MSRP', kind: 'number', higherBetter: false, unit: 'EUR' },
  { key: 'marketPriceEur', label: 'Used market', kind: 'number', higherBetter: false, unit: 'EUR' },
  { key: 'pcie', label: 'PCIe', kind: 'text' },
  { key: 'rayTracing', label: 'Ray tracing', kind: 'bool' },
  { key: 'dlss', label: 'DLSS', kind: 'bool' },
];

function pctDelta(value, baseline, higherBetter = true) {
  const a = Number(value);
  const b = Number(baseline);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const raw = ((a - b) / Math.abs(b)) * 100;
  return {
    pct: Math.round(raw * 10) / 10,
    better: higherBetter ? a > b : a < b,
    equal: a === b,
  };
}

function buildGpuComparison(ids = [], baselineId = '') {
  const db = loadGpuSpecsDb();
  const byId = new Map((db.gpus || []).map(gpu => [String(gpu.id), gpu]));
  const cards = ids.map(id => byId.get(String(id))).filter(Boolean);
  if (!cards.length) {
    return { error: 'No matching GPUs for those ids.', cards: [], rows: [], pairwise: [] };
  }
  const baseline = byId.get(String(baselineId)) || cards[0];
  const rows = GPU_COMPARE_FIELDS.map(field => {
    const values = cards.map(card => {
      const raw = card[field.key];
      const delta = field.kind === 'number'
        ? pctDelta(raw, baseline[field.key], field.higherBetter !== false)
        : null;
      return {
        gpuId: card.id,
        value: raw == null ? null : raw,
        delta,
      };
    });
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      unit: field.unit || '',
      higherBetter: field.higherBetter !== false,
      values,
    };
  });

  const pairwise = cards.map(card => {
    const vsBaseline = pctDelta(card.relativeRaster, baseline.relativeRaster, true);
    const vsOthers = cards
      .filter(other => other.id !== card.id)
      .map(other => ({
        vsId: other.id,
        vsName: other.name,
        delta: pctDelta(card.relativeRaster, other.relativeRaster, true),
      }));
    return {
      id: card.id,
      name: card.name,
      relativeRaster: card.relativeRaster,
      relativeScore: card.relativeRaster,
      vsBaseline,
      vsOthers,
    };
  });

  const vsMatrix = cards.map(rowCard => ({
    vsId: rowCard.id,
    vsName: rowCard.name,
    values: cards.map(colCard => ({
      gpuId: colCard.id,
      delta: colCard.id === rowCard.id
        ? null
        : pctDelta(colCard.relativeRaster, rowCard.relativeRaster, true),
    })),
  }));

  return {
    baselineId: baseline.id,
    baselineName: baseline.name,
    note: db.note,
    scoreKey: 'relativeRaster',
    scoreLabel: 'Relative raster',
    cards,
    rows,
    pairwise,
    vsMatrix,
  };
}

function loadCpuSpecsDb() {
  ensureDataDir();
  if (!fs.existsSync(CPU_SPECS_PATH)) {
    return { version: 1, baselineId: 'ryzen-5-1600', cpus: [], note: 'No CPU specs database found.' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CPU_SPECS_PATH, 'utf8'));
    const cpus = Array.isArray(raw.cpus) ? raw.cpus : [];
    return {
      version: Number(raw.version) || 1,
      baselineId: String(raw.baselineId || 'ryzen-5-1600'),
      updatedAt: raw.updatedAt || null,
      note: raw.note || '',
      source: raw.source || '',
      cpus,
    };
  } catch (error) {
    console.error('Failed to load cpu-specs.json:', error.message);
    return { version: 1, baselineId: 'ryzen-5-1600', cpus: [], note: 'CPU specs database is unreadable.' };
  }
}

function findCpuById(id) {
  const needle = String(id || '').trim().toLowerCase();
  if (!needle) return null;
  return (loadCpuSpecsDb().cpus || []).find(cpu => String(cpu.id || '').toLowerCase() === needle) || null;
}

const CPU_COMPARE_FIELDS = [
  { key: 'relativeSingle', label: 'Relative single-thread (R5 1600 = 100)', kind: 'number', higherBetter: true, unit: '' },
  { key: 'relativeMulti', label: 'Relative multi-thread (R5 1600 = 100)', kind: 'number', higherBetter: true, unit: '' },
  { key: 'releaseYear', label: 'Release year', kind: 'number', higherBetter: true, unit: '' },
  { key: 'brand', label: 'Brand', kind: 'text' },
  { key: 'series', label: 'Series / generation', kind: 'text' },
  { key: 'socket', label: 'Socket', kind: 'text' },
  { key: 'architecture', label: 'Architecture', kind: 'text' },
  { key: 'processNm', label: 'Process', kind: 'number', higherBetter: false, unit: 'nm' },
  { key: 'cores', label: 'Cores', kind: 'number', higherBetter: true, unit: '' },
  { key: 'threads', label: 'Threads', kind: 'number', higherBetter: true, unit: '' },
  { key: 'baseClockGhz', label: 'Base clock', kind: 'number', higherBetter: true, unit: 'GHz' },
  { key: 'boostClockGhz', label: 'Boost clock', kind: 'number', higherBetter: true, unit: 'GHz' },
  { key: 'l3CacheMb', label: 'L3 cache', kind: 'number', higherBetter: true, unit: 'MB' },
  { key: 'tdpW', label: 'TDP', kind: 'number', higherBetter: false, unit: 'W' },
  { key: 'memoryType', label: 'Memory', kind: 'text' },
  { key: 'maxMemoryMhz', label: 'Official memory speed', kind: 'number', higherBetter: true, unit: 'MHz' },
  { key: 'pcie', label: 'PCIe', kind: 'text' },
  { key: 'igpu', label: 'Integrated graphics', kind: 'bool' },
  { key: 'unlocked', label: 'Unlocked', kind: 'bool' },
  { key: 'launchPriceEur', label: 'Launch MSRP', kind: 'number', higherBetter: false, unit: 'EUR' },
  { key: 'marketPriceEur', label: 'Used market', kind: 'number', higherBetter: false, unit: 'EUR' },
];

function buildCpuComparison(ids = [], baselineId = '', scoreKey = 'relativeMulti') {
  const db = loadCpuSpecsDb();
  const byId = new Map((db.cpus || []).map(cpu => [String(cpu.id), cpu]));
  const cards = ids.map(id => byId.get(String(id))).filter(Boolean);
  if (!cards.length) {
    return { error: 'No matching CPUs for those ids.', cards: [], rows: [], pairwise: [] };
  }
  const baseline = byId.get(String(baselineId)) || cards[0];
  const activeScore = scoreKey === 'relativeSingle' ? 'relativeSingle' : 'relativeMulti';
  const rows = CPU_COMPARE_FIELDS.map(field => {
    const values = cards.map(card => {
      const raw = card[field.key];
      const delta = field.kind === 'number'
        ? pctDelta(raw, baseline[field.key], field.higherBetter !== false)
        : null;
      return {
        gpuId: card.id,
        value: raw == null ? null : raw,
        delta,
      };
    });
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      unit: field.unit || '',
      higherBetter: field.higherBetter !== false,
      values,
    };
  });

  const pairwise = cards.map(card => {
    const vsBaseline = pctDelta(card[activeScore], baseline[activeScore], true);
    const vsOthers = cards
      .filter(other => other.id !== card.id)
      .map(other => ({
        vsId: other.id,
        vsName: other.name,
        delta: pctDelta(card[activeScore], other[activeScore], true),
      }));
    return {
      id: card.id,
      name: card.name,
      relativeSingle: card.relativeSingle,
      relativeMulti: card.relativeMulti,
      relativeScore: card[activeScore],
      vsBaseline,
      vsOthers,
    };
  });

  const vsMatrix = cards.map(rowCard => ({
    vsId: rowCard.id,
    vsName: rowCard.name,
    values: cards.map(colCard => ({
      gpuId: colCard.id,
      delta: colCard.id === rowCard.id
        ? null
        : pctDelta(colCard[activeScore], rowCard[activeScore], true),
    })),
  }));

  return {
    baselineId: baseline.id,
    baselineName: baseline.name,
    note: db.note,
    scoreKey: activeScore,
    scoreLabel: activeScore === 'relativeSingle' ? 'Relative single-thread' : 'Relative multi-thread',
    cards,
    rows,
    pairwise,
    vsMatrix,
  };
}

function loadSsdSpecsDb() {
  ensureDataDir();
  if (!fs.existsSync(SSD_SPECS_PATH)) {
    return { version: 1, baselineId: 'samsung-850-pro-256gb', ssds: [], note: 'No SSD specs database found.' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SSD_SPECS_PATH, 'utf8'));
    const ssds = Array.isArray(raw.ssds) ? raw.ssds : [];
    return {
      version: Number(raw.version) || 1,
      baselineId: String(raw.baselineId || 'samsung-850-pro-256gb'),
      updatedAt: raw.updatedAt || null,
      note: raw.note || '',
      source: raw.source || '',
      ssds,
    };
  } catch (error) {
    console.error('Failed to load ssd-specs.json:', error.message);
    return { version: 1, baselineId: 'samsung-850-pro-256gb', ssds: [], note: 'SSD specs database is unreadable.' };
  }
}

function findSsdById(id) {
  const needle = String(id || '').trim().toLowerCase();
  if (!needle) return null;
  return (loadSsdSpecsDb().ssds || []).find(ssd => String(ssd.id || '').toLowerCase() === needle) || null;
}

function loadHddSpecsDb() {
  ensureDataDir();
  if (!fs.existsSync(HDD_SPECS_PATH)) {
    return { version: 1, baselineId: 'seagate-barracuda-1tb-2016', hdds: [], note: 'No HDD specs database found.' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(HDD_SPECS_PATH, 'utf8'));
    const hdds = Array.isArray(raw.hdds) ? raw.hdds : [];
    return {
      version: Number(raw.version) || 1,
      baselineId: String(raw.baselineId || 'seagate-barracuda-1tb-2016'),
      updatedAt: raw.updatedAt || null,
      note: raw.note || '',
      source: raw.source || '',
      hdds,
    };
  } catch (error) {
    console.error('Failed to load hdd-specs.json:', error.message);
    return { version: 1, baselineId: 'seagate-barracuda-1tb-2016', hdds: [], note: 'HDD specs database is unreadable.' };
  }
}

function findHddById(id) {
  const needle = String(id || '').trim().toLowerCase();
  if (!needle) return null;
  return (loadHddSpecsDb().hdds || []).find(hdd => String(hdd.id || '').toLowerCase() === needle) || null;
}

const SSD_COMPARE_FIELDS = [
  { key: 'relativeEffective', label: 'Effective speed (850 Pro ≈ 100)', kind: 'number', higherBetter: true, unit: '' },
  { key: 'rank', label: 'UserBenchmark rank', kind: 'number', higherBetter: false, unit: '' },
  { key: 'brand', label: 'Brand', kind: 'text' },
  { key: 'family', label: 'Product family', kind: 'text' },
  { key: 'interface', label: 'Interface', kind: 'text' },
  { key: 'formFactor', label: 'Form factor', kind: 'text' },
  { key: 'capacityGb', label: 'Capacity', kind: 'number', higherBetter: true, unit: 'GB' },
  { key: 'pcie', label: 'PCIe gen', kind: 'text' },
  { key: 'samples', label: 'Samples', kind: 'number', higherBetter: true, unit: '' },
  { key: 'partNumber', label: 'Part number', kind: 'text' },
];

const HDD_COMPARE_FIELDS = [
  { key: 'relativeEffective', label: 'Effective speed', kind: 'number', higherBetter: true, unit: '' },
  { key: 'rank', label: 'UserBenchmark rank', kind: 'number', higherBetter: false, unit: '' },
  { key: 'brand', label: 'Brand', kind: 'text' },
  { key: 'family', label: 'Product family', kind: 'text' },
  { key: 'formFactor', label: 'Form factor', kind: 'text' },
  { key: 'capacityGb', label: 'Capacity', kind: 'number', higherBetter: true, unit: 'GB' },
  { key: 'releaseYear', label: 'Release year', kind: 'number', higherBetter: true, unit: '' },
  { key: 'samples', label: 'Samples', kind: 'number', higherBetter: true, unit: '' },
  { key: 'partNumber', label: 'Part number', kind: 'text' },
];

function buildStorageComparison(kind, ids = [], baselineId = '') {
  const isSsd = kind === 'ssd';
  const db = isSsd ? loadSsdSpecsDb() : loadHddSpecsDb();
  const list = isSsd ? (db.ssds || []) : (db.hdds || []);
  const fields = isSsd ? SSD_COMPARE_FIELDS : HDD_COMPARE_FIELDS;
  const byId = new Map(list.map(item => [String(item.id), item]));
  const cards = ids.map(id => byId.get(String(id))).filter(Boolean);
  if (!cards.length) {
    return { error: `No matching ${kind.toUpperCase()}s for those ids.`, cards: [], rows: [], pairwise: [] };
  }
  const baseline = byId.get(String(baselineId)) || cards[0];
  const rows = fields.map(field => {
    const values = cards.map(card => {
      const raw = card[field.key];
      const delta = field.kind === 'number'
        ? pctDelta(raw, baseline[field.key], field.higherBetter !== false)
        : null;
      return {
        gpuId: card.id,
        value: raw == null ? null : raw,
        delta,
      };
    });
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      unit: field.unit || '',
      higherBetter: field.higherBetter !== false,
      values,
    };
  });

  const pairwise = cards.map(card => {
    const vsBaseline = pctDelta(card.relativeEffective, baseline.relativeEffective, true);
    const vsOthers = cards
      .filter(other => other.id !== card.id)
      .map(other => ({
        vsId: other.id,
        vsName: other.name,
        delta: pctDelta(card.relativeEffective, other.relativeEffective, true),
      }));
    return {
      id: card.id,
      name: card.name,
      relativeEffective: card.relativeEffective,
      relativeScore: card.relativeEffective,
      vsBaseline,
      vsOthers,
    };
  });

  const vsMatrix = cards.map(rowCard => ({
    vsId: rowCard.id,
    vsName: rowCard.name,
    values: cards.map(colCard => ({
      gpuId: colCard.id,
      delta: colCard.id === rowCard.id
        ? null
        : pctDelta(colCard.relativeEffective, rowCard.relativeEffective, true),
    })),
  }));

  return {
    baselineId: baseline.id,
    baselineName: baseline.name,
    note: db.note,
    scoreKey: 'relativeEffective',
    scoreLabel: 'Effective speed',
    cards,
    rows,
    pairwise,
    vsMatrix,
  };
}

async function accessToken({ forceRefresh = false } = {}) {
  // Prefer client-credentials tokens (auto-refresh ~every 2h).
  // EBAY_APPLICATION_TOKEN from the developer portal is short-lived (~2h) and only a fallback.
  if (!forceRefresh && EBAY_CLIENT_ID && EBAY_CLIENT_SECRET) {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    const authorization = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || 'eBay did not return an access token.');
    tokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
    return tokenCache.token;
  }
  if (EBAY_APPLICATION_TOKEN) return EBAY_APPLICATION_TOKEN;
  throw new Error('Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env (recommended), or a fresh EBAY_APPLICATION_TOKEN.');
}

function shippingCost(item) {
  const costs = (item.shippingOptions || [])
    .map(option => Number(option.shippingCost?.value))
    .filter(Number.isFinite);
  return costs.length ? Math.min(...costs) : null;
}

function ebayImageRank(url) {
  const match = String(url).match(/s-l(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function enlargeEbayImage(url) {
  if (!url) return '';
  return String(url)
    .replace(/\/thumbs\/images\//i, '/images/')
    .replace(/\/thumbs\//i, '/')
    .replace(/\/s-l\d+\./ig, '/s-l1600.')
    .replace(/s-l\d+\./ig, 's-l1600.');
}

function listingImage(raw) {
  const candidates = [
    raw.image?.imageUrl,
    ...((raw.additionalImages || []).map(image => image?.imageUrl)),
    ...((raw.thumbnailImages || []).map(image => image?.imageUrl)),
  ].filter(Boolean);
  candidates.sort((a, b) => ebayImageRank(b) - ebayImageRank(a));
  return enlargeEbayImage(candidates[0] || '');
}

function score(item, maxPrice) {
  const budgetScore = Math.max(0, Math.min(70, ((maxPrice - item.total) / maxPrice) * 70 + 28));
  const sellerScore = Math.max(0, Math.min(25, (item.feedback - 95) * 5));
  const freshScore = (Date.now() - new Date(item.originDate).getTime()) < 6 * 60 * 60 * 1000 ? 5 : 0;
  return Math.round(budgetScore + sellerScore + freshScore);
}

function berlinDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}

function endsTodayInBerlin(endDate) {
  return endDate && berlinDate(endDate) === berlinDate(Date.now());
}

function telegramConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

async function sendTelegram(text) {
  if (!telegramConfigured()) return false;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
  return true;
}

function scheduleAuctionReminder(item, alertsEnabled) {
  if (!alertsEnabled || !telegramConfigured() || scheduledAuctionIds.has(item.id) || !item.endDate) return false;
  const notifyAt = new Date(item.endDate).getTime() - 5 * 60 * 1000;
  const delay = Math.max(0, notifyAt - Date.now());
  scheduledAuctionIds.add(item.id);
  setTimeout(async () => {
    try {
      if (!loadStore().alerts) return;
      await sendTelegram(`Auction ends in 5 minutes:\n${item.title}\n${item.total.toFixed(2)} EUR incl. shipping\n${item.url}`);
    } catch (error) {
      console.error(`Telegram reminder failed for ${item.id}:`, error.message);
    }
  }, delay);
  return true;
}

function buildEbayFilter(query) {
  const maxPrice = Number(query.maxPrice);
  const minPrice = Number.isFinite(query.minPrice) ? Math.max(0, query.minPrice) : 0;
  const hi = Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : 10000;
  const lo = Math.min(minPrice, hi);
  const parts = [
    `price:[${Math.max(0, lo)}..${hi}]`,
    'priceCurrency:EUR',
    'deliveryCountry:DE',
  ];

  const conditionKey = String(query.condition || 'any');
  if (conditionKey === 'used') {
    parts.push('conditionIds:{3000|4000|5000|6000}');
  } else if (conditionKey === 'new') {
    parts.push('conditionIds:{1000|1500}');
  } else if (conditionKey === 'refurbished') {
    parts.push('conditionIds:{2000|2010|2020|2030|2040|2500|2750}');
  } else if (conditionKey !== 'all') {
    // Default / any: everything buyable — exclude for-parts / new-with-defects
    parts.push(`conditionIds:{${BUYABLE_CONDITION_IDS.join('|')}}`);
  }

  const buying = Array.isArray(query.buyingOptions)
    ? [...new Set(query.buyingOptions.map(String).filter(Boolean))]
    : [];
  if (buying.length) {
    parts.push(`buyingOptions:{${buying.join('|')}}`);
  } else if (query.explore) {
    // Browse API returns FIXED_PRICE only by default — include auctions & offers for explore.
    parts.push('buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}');
  }

  if (query.freeShipping) parts.push('deliveryOptions:{FREE_SHIPPING}');
  if (query.returnsAccepted) parts.push('returnsAccepted:true');
  if (query.itemLocationCountry) {
    parts.push(`itemLocationCountry:${String(query.itemLocationCountry).toUpperCase().slice(0, 2)}`);
  }

  return parts.join(',');
}

function resolveBrowseSort(query) {
  const sort = String(query.sort || 'newlyListed');
  const allowed = new Set(['newlyListed', 'price', 'priceDesc', 'endingSoonest']);
  return allowed.has(sort) ? sort : 'newlyListed';
}

function buildSoldSearchUrl(query) {
  const params = new URLSearchParams({
    _nkw: query.search,
    _sacat: query.categoryId || '0',
    LH_Sold: '1',
    LH_Complete: '1',
    rt: 'nc',
    _sop: '13',
    _ipg: '60',
  });
  if (Number.isFinite(query.minPrice) && query.minPrice > 1) params.set('_udlo', String(query.minPrice));
  if (Number.isFinite(query.maxPrice) && query.maxPrice > 0) params.set('_udhi', String(query.maxPrice));
  if (query.condition === 'used') params.set('LH_ItemCondition', '3000');
  return `https://www.ebay.de/sch/i.html?${params}`;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '');
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEuroAmount(text) {
  const match = String(text || '').replace(/\s+/g, ' ').match(/(?:EUR|€)\s*([\d.]+(?:,\d{2})?)/i)
    || String(text || '').match(/([\d.]+(?:,\d{2})?)\s*(?:EUR|€)/i);
  if (!match) return null;
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseSoldDate(text) {
  const match = String(text || '').match(/Verkauft\s+(\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]{3,}\.?\s*\d{4})/i);
  if (!match) return null;
  const parsed = Date.parse(match[1].replace(/\./g, ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function fetchEbayHtml(pageUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  };
  const first = await fetch(pageUrl, { headers, redirect: 'manual' });
  const cookies = (first.headers.getSetCookie?.() || []).map(cookie => cookie.split(';')[0]).join('; ');
  const response = await fetch(pageUrl, {
    headers: {
      ...headers,
      Cookie: cookies,
      Referer: 'https://www.ebay.de/',
    },
  });
  const html = await response.text();
  if (!response.ok || html.length < 5000 || /Error Page \| eBay/i.test(html)) {
    throw new Error(`eBay sold search blocked or unavailable (HTTP ${response.status}).`);
  }
  return html;
}

function parseSoldCards(html) {
  const cards = [];
  const re = /<li class="s-card[^"]*"([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const body = match[2];
    const legacyItemId = (attrs.match(/data-listingid=([^\s>"']+)/i) || [])[1] || '';
    if (!/^\d{6,16}$/.test(legacyItemId)) continue;
    if (!/ebay\.de\/itm\//i.test(body)) continue;

    const titleRaw = stripHtml((body.match(/class="?s-card__title[^"]*"?[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
    const title = titleRaw
      .replace(/\s*Wird in neuem Fenster oder Tab geöffnet\s*/gi, '')
      .replace(/^Shop on eBay$/i, '')
      .trim();
    if (!title) continue;

    const price = parseEuroAmount((body.match(/s-card__price[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
    if (!Number.isFinite(price)) continue;

    const shippingMatch = body.match(/\+?\s*(?:EUR|€)\s*[\d.,]+\s*(?:Lieferung|Versand)/i)
      || body.match(/Kostenloser Versand|Gratis Versand|Free delivery/i);
    const shippingKnown = Boolean(shippingMatch);
    const shipping = /Kostenloser Versand|Gratis Versand|Free delivery/i.test(body)
      ? 0
      : (parseEuroAmount(shippingMatch?.[0] || '') ?? 0);

    const sellerMatch = body.match(/su-styled-text primary large">\s*([^<]+?)\s*<\/span>\s*<span class="su-styled-text primary large">\s*([\d.,]+)%\s*positiv/i);
    const seller = sellerMatch ? decodeHtmlEntities(sellerMatch[1]).trim() : 'eBay seller';
    const feedback = sellerMatch ? Number(String(sellerMatch[2]).replace(',', '.')) : null;
    const feedbackScoreMatch = body.match(/\((\d[\d.,\s]*)\s*(?:Bewertungen|Feedback)?\)/i)
      || body.match(/feedback[_-]?score[^>]*>\s*([\d.,\s]+)/i);
    const feedbackScoreRaw = feedbackScoreMatch
      ? Number(String(feedbackScoreMatch[1]).replace(/[.\s]/g, '').replace(',', ''))
      : NaN;

    const href = decodeHtmlEntities((body.match(/href=(https:\/\/www\.ebay\.de\/itm\/[^>\s]+)/i) || [])[1] || '');
    const image = enlargeEbayImage(decodeHtmlEntities(
      (body.match(/src=(https:\/\/i\.ebayimg\.com\/[^>\s]+)/i)
        || body.match(/data-defer-load=(https:\/\/i\.ebayimg\.com\/[^>\s]+)/i)
        || [])[1] || '',
    ));
    const soldText = stripHtml((body.match(/>(Verkauft\s+[^<]+)</i) || [])[1] || '')
      || stripHtml((body.match(/\bVerkauft\s+\d{1,2}\.\s*[A-Za-zäöüÄÖÜ.]+\s*\d{4}/i) || [])[0] || '');
    const endDate = parseSoldDate(soldText);
    const isAuction = /\b\d+\s*Gebote?\b/i.test(body);

    cards.push({
      id: `sold|${legacyItemId}`,
      legacyItemId,
      title,
      seller,
      feedback: Number.isFinite(feedback) ? feedback : 100,
      feedbackScore: Number.isFinite(feedbackScoreRaw) ? feedbackScoreRaw : null,
      feedbackKnown: Number.isFinite(feedback),
      condition: 'Sold',
      conditionId: '',
      price,
      shipping,
      shippingKnown,
      total: price + shipping,
      image,
      endDate,
      originDate: endDate,
      url: href || `https://www.ebay.de/itm/${legacyItemId}`,
      isAuction,
      bestOffer: false,
      sold: true,
      soldLabel: soldText || 'Sold',
      sourceText: title,
    });
  }
  return cards;
}

async function searchSoldListings(query) {
  const pageUrl = buildSoldSearchUrl(query);
  const html = await fetchEbayHtml(pageUrl);
  const scanned = parseSoldCards(html);
  const accepted = scanned.filter(item =>
    item.price >= (query.minPrice || 1)
    && item.price <= query.maxPrice
    && (!item.feedbackKnown || item.feedback >= query.minFeedback)
    && !isBlockedListing(
      item.sourceText,
      item.condition,
      String(item.conditionId),
      query.search,
      query.enabledSmartFilters,
      query.categoryId,
      query.includeCapacities,
    ));
  const classified = accepted
    .map(({ feedbackKnown, ...item }) => ({
      ...item,
      lotType: classifyLotType(normalizeListingText(item.sourceText)),
      dealScore: score(item, query.maxPrice),
    }))
    .sort((a, b) => a.total - b.total);
  const { clean: cleanWithSource, flagged: flaggedWithSource } =
    filterSoldMedianOutliers(classified, loadClassifierConfig().soldMedianOutlier);
  const stripSource = ({ sourceText, ...item }) => item;
  const items = cleanWithSource.map(stripSource);
  const excludedProbableAccessories = flaggedWithSource.map(stripSource);
  // Median/low/high scoped to lotType==='component' only — whole_pc/donor_bundle/accessory_only
  // sales stay visible in `items` (nothing hidden), but must never move the single-part price.
  const componentSummary = summarizeComponentTotals(items);
  return {
    items,
    excludedProbableAccessories,
    scanned: scanned.length,
    rejected: scanned.length - accepted.length,
    median: componentSummary.median,
    medianLow: componentSummary.low,
    medianHigh: componentSummary.high,
    medianSampleSize: componentSummary.count,
    pageUrl,
    source: 'ebay-sold-html',
  };
}

let ebayNextAllowedAt = 0;
let ebayGate = Promise.resolve();
/** When set, background monitor skips cycles until this timestamp. */
let monitorPausedUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function pauseMonitor(ms, reason = '') {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  if (until > monitorPausedUntil) monitorPausedUntil = until;
  if (reason) {
    console.warn(`[dealwatch] monitor paused ${Math.round(ms / 1000)}s — ${reason}`);
  }
}

/**
 * Serialize Browse API calls with a short gap. Long 429 waits happen OUTSIDE the lock
 * so interactive Scan is not stuck behind the background monitor.
 */
function withEbayRateLimit(fn, { maxWaitMs = 8000 } = {}) {
  const run = ebayGate.then(async () => {
    const wait = Math.max(0, ebayNextAllowedAt - Date.now());
    if (wait > maxWaitMs) {
      const err = new Error(
        `eBay API cooling down (~${Math.ceil(wait / 1000)}s). Wait a moment, then Scan again.`
      );
      err.code = 'EBAY_COOLDOWN';
      throw err;
    }
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      ebayNextAllowedAt = Math.max(ebayNextAllowedAt, Date.now() + EBAY_MIN_GAP_MS);
    }
  });
  ebayGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchBrowseOnce(query, searchText) {
  const searchParams = new URLSearchParams({
    limit: '100',
    sort: resolveBrowseSort(query),
    fieldgroups: 'EXTENDED',
    filter: buildEbayFilter(query),
  });
  const q = String(searchText ?? query.search ?? '').trim();
  if (q) searchParams.set('q', q);
  if (query.categoryId) searchParams.set('category_ids', String(query.categoryId));
  if (query.searchInDescription) searchParams.set('auto_correct', 'KEYWORD');
  if (!q && !query.categoryId) {
    throw new Error('Keywords or an eBay category is required.');
  }

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${searchParams}`;
  const interactive = Boolean(query.interactive);
  const maxRetries = interactive ? Math.min(2, EBAY_MAX_RETRIES_ON_429) : EBAY_MAX_RETRIES_ON_429;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    let data;
    ({ response, data } = await withEbayRateLimit(async () => {
      let token = await accessToken();
      let res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID },
      });
      let body = await res.json().catch(() => ({}));

      if (!res.ok && /invalid.?access.?token|unauthorized|401/i.test(JSON.stringify(body) + res.status)) {
        tokenCache = { token: '', expiresAt: 0 };
        token = await accessToken({ forceRefresh: true });
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID },
        });
        body = await res.json().catch(() => ({}));
      }
      return { response: res, data: body };
    }, { maxWaitMs: interactive ? 5000 : 20000 }));

    if (response.status !== 429) {
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || 'eBay did not return search results.');
      }
      return data;
    }

    const headerWait = Number(response.headers.get('retry-after'));
    const waitSec = Number.isFinite(headerWait) && headerWait > 0
      ? Math.min(interactive ? 20 : 60, headerWait)
      : Math.min(interactive ? 12 : 45, 4 * (2 ** attempt));
    console.warn(`[dealwatch] eBay 429 — cooldown ${waitSec}s (retry ${attempt + 1}/${maxRetries})`);
    ebayNextAllowedAt = Date.now() + waitSec * 1000;
    pauseMonitor(Math.max(60_000, waitSec * 1000), 'eBay 429');
    if (attempt >= maxRetries) break;
    // Sleep outside the lock so UI Scan is not frozen behind monitor backoff.
    await sleep(waitSec * 1000);
  }

  pauseMonitor(5 * 60_000, 'eBay still rate-limiting');
  throw new Error(
    'eBay API: Too many requests. Monitor paused 5 min — wait, then Scan again (or raise MONITOR_INTERVAL_MINUTES).'
  );
}

async function fetchBrowseItemSummaries(query) {
  const queries = storageBrowseQueries(query);
  if (queries.length === 1) {
    return fetchBrowseOnce(query, queries[0]);
  }

  // Sequential merges — parallel Promise.all stacks Browse calls and trips rate limits.
  const pages = [];
  let hardError = null;
  for (const q of queries) {
    try {
      pages.push(await fetchBrowseOnce(query, q));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/too many requests|cooling down|429|EBAY_COOLDOWN/i.test(msg) || error?.code === 'EBAY_COOLDOWN') {
        hardError = error instanceof Error ? error : new Error(msg);
        break;
      }
      pages.push({ itemSummaries: [] });
    }
  }
  if (hardError && !pages.some((page) => (page.itemSummaries || []).length)) {
    throw hardError;
  }
  const byId = new Map();
  for (const page of pages) {
    for (const item of page.itemSummaries || []) {
      const id = item?.itemId || item?.legacyItemId;
      if (!id || byId.has(id)) continue;
      byId.set(id, item);
    }
  }
  return {
    itemSummaries: [...byId.values()],
    total: byId.size,
    source: queries.length > 1 ? 'merged-multi-query' : 'browse',
  };
}

function mapBrowseItems(rawItems = []) {
  return (rawItems || []).map(raw => {
    const price = Number(raw.price?.value);
    const shippingRaw = shippingCost(raw);
    const shipping = shippingRaw === null ? 0 : shippingRaw;
    const feedback = Number(raw.seller?.feedbackPercentage);
    const feedbackScore = Number(raw.seller?.feedbackScore);
    if (!Number.isFinite(price) || !Number.isFinite(feedback)) return null;
    const total = price + shipping;
    return {
      id: raw.itemId,
      legacyItemId: raw.legacyItemId || '',
      title: raw.title || '',
      seller: raw.seller?.username || 'eBay seller',
      feedback,
      feedbackScore: Number.isFinite(feedbackScore) ? feedbackScore : null,
      condition: raw.condition || 'Condition not specified',
      conditionId: raw.conditionId || '',
      price,
      shipping,
      shippingKnown: shippingRaw !== null,
      total,
      image: listingImage(raw),
      endDate: raw.itemEndDate,
      originDate: raw.itemOriginDate,
      url: raw.itemWebUrl || `https://www.ebay.de/itm/${raw.legacyItemId}`,
      isAuction: (raw.buyingOptions || []).includes('AUCTION'),
      bestOffer: (raw.buyingOptions || []).includes('BEST_OFFER'),
      sourceText: raw.title || '',
    };
  }).filter(Boolean);
}

function passesListingRules(item, query, { ignoreBudget = false } = {}) {
  if (!ignoreBudget) {
    if (item.price < (query.minPrice || 1) || item.price > query.maxPrice) return false;
  }
  const isKa = item.marketplace === 'kleinanzeigen' || query.marketplace === 'kleinanzeigen';
  if (!isKa && item.feedback < query.minFeedback) return false;
  if (isBlockedListing(
    item.sourceText,
    item.condition,
    String(item.conditionId),
    query.search,
    query.enabledSmartFilters,
    query.categoryId,
    query.includeCapacities,
  )) {
    return false;
  }
  if (query.condition === 'used' && !(String(item.conditionId) === '3000' || /gebraucht|used|sehr gut|gut|in ordnung/i.test(item.condition))) {
    return false;
  }
  if (!query.explore && item.isAuction && !endsTodayInBerlin(item.endDate)) return false;
  return true;
}

function passesExploreRules(item, query) {
  const minPrice = Number.isFinite(query.minPrice) ? query.minPrice : 0;
  const maxPrice = Number.isFinite(query.maxPrice) ? query.maxPrice : 10000;
  if (item.price < minPrice || item.price > maxPrice) return false;
  if (item.feedback < (query.minFeedback || 0)) return false;
  return true;
}

async function searchExplore(query) {
  const data = await fetchBrowseItemSummaries(query);
  const scanned = data.itemSummaries || [];
  const items = mapBrowseItems(scanned);
  const accepted = items.filter(item => passesExploreRules(item, query));
  const sorted = finalizeListingItems(accepted, query.maxPrice || 100);
  return {
    items: sorted,
    scanned: scanned.length,
    rejected: scanned.length - accepted.length,
    totalAvailable: Number(data.total) || scanned.length,
    source: data.source || 'browse',
    ebayUrl: buildExploreEbayUrl(query),
  };
}

function buildExploreEbayUrl(query) {
  const params = new URLSearchParams({
    _nkw: query.search || '',
    _sacat: query.categoryId || '0',
    rt: 'nc',
    _ipg: '60',
  });
  if (Number.isFinite(query.minPrice) && query.minPrice > 0) params.set('_udlo', String(query.minPrice));
  if (Number.isFinite(query.maxPrice) && query.maxPrice > 0) params.set('_udhi', String(query.maxPrice));
  if (query.condition === 'used') params.set('LH_ItemCondition', '3000');
  if (query.condition === 'new') params.set('LH_ItemCondition', '1000');
  if (query.freeShipping) params.set('LH_FS', '1');
  if (query.buyingOptions?.includes('AUCTION') && !query.buyingOptions?.includes('FIXED_PRICE')) {
    params.set('LH_Auction', '1');
  }
  if (query.buyingOptions?.includes('FIXED_PRICE') && !query.buyingOptions?.includes('AUCTION')) {
    params.set('LH_BIN', '1');
  }
  if (query.buyingOptions?.includes('BEST_OFFER')) params.set('LH_BO', '1');
  return `https://www.ebay.de/sch/i.html?${params}`;
}

function finalizeListingItems(items, maxPrice) {
  return items.map(({ sourceText, conditionId, ...item }) => ({
    ...item,
    lotType: classifyLotType(normalizeListingText(sourceText)),
    dealScore: score(item, maxPrice),
  }));
}

function suggestionBudgetCeiling(maxPrice) {
  const base = Number(maxPrice) || 80;
  return Math.min(5000, Math.ceil(Math.max(base * 2.2, base + 50, 120)));
}

async function searchNearbySuggestions(query) {
  if (query.marketplace === 'kleinanzeigen') {
    return { suggestions: [], searchedUpTo: query.maxPrice, scanned: 0, totalAvailable: 0 };
  }
  const originalMax = Number(query.maxPrice) || 80;
  const raisedMax = suggestionBudgetCeiling(originalMax);
  const wideQuery = {
    ...query,
    minPrice: Math.max(1, originalMax + 1),
    maxPrice: raisedMax,
  };
  const data = await fetchBrowseItemSummaries(wideQuery);
  const mapped = mapBrowseItems(data.itemSummaries || []);
  const near = mapped
    .filter(item => passesListingRules(item, query, { ignoreBudget: true }))
    .filter(item => item.price > originalMax && item.price <= raisedMax)
    .sort((a, b) => a.price - b.price || a.total - b.total)
    .slice(0, 3);
  return {
    suggestions: finalizeListingItems(near, originalMax).map(item => ({
      ...item,
      suggestion: true,
      overBudgetBy: Math.round((item.price - originalMax) * 100) / 100,
    })),
    searchedUpTo: raisedMax,
    scanned: (data.itemSummaries || []).length,
    totalAvailable: Number(data.total) || (data.itemSummaries || []).length,
  };
}

function slugifyKleinanzeigenKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'suche';
}

function buildKleinanzeigenSearchUrl(query, page = 1) {
  const keyword = slugifyKleinanzeigenKeyword(query.search);
  const kaCat = KA_CATEGORIES[normalizeKaCategory(query)] || KA_CATEGORIES.all;
  const segments = [];

  if (kaCat.slug) {
    segments.push(`s-${kaCat.slug}`);
    segments.push('anzeige:angebote');
  } else if (query.shippingOnly) {
    segments.push('s-versand:ja');
  }

  const min = Number.isFinite(query.minPrice) && query.minPrice > 1 ? Math.floor(query.minPrice) : '';
  const max = Number.isFinite(query.maxPrice) && query.maxPrice > 0 && query.maxPrice < 5000
    ? Math.ceil(query.maxPrice)
    : '';
  const hasPrice = min !== '' || max !== '';

  if (!kaCat.slug && !query.shippingOnly) {
    segments.push(hasPrice ? `s-preis:${min}:${max}` : `s-${keyword}`);
  } else if (hasPrice) {
    segments.push(`preis:${min}:${max}`);
  }

  if (page > 1) segments.push(`seite:${page}`);
  if (segments[0] !== `s-${keyword}`) segments.push(keyword);

  let key = 'k0';
  if (kaCat.id) key += `c${kaCat.id}`;
  const locationId = String(query.locationId || '').replace(/\D/g, '');
  if (locationId) {
    key += `l${locationId}`;
    const radius = Number(query.radiusKm);
    if (Number.isFinite(radius) && radius > 0) key += `r${Math.floor(radius)}`;
  }

  const attrs = [];
  if (query.shippingOnly && kaCat.id) {
    const prefix = kaCat.slug.replace(/-/g, '_');
    attrs.push(`+${prefix}.versand_s:ja`);
  }

  return `${KA_BASE}/${segments.join('/')}/${key}${attrs.join('')}`;
}

async function fetchKleinanzeigenHtml(pageUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  };
  const response = await fetch(pageUrl, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen HTTP ${response.status}`);
  }
  return response.text();
}

function parseKleinanzeigenPrice(text) {
  const raw = stripHtml(text || '');
  if (!raw || /zu verschenken|vb\b|verhandlungsbasis|preis auf anfrage/i.test(raw)) return null;
  return parseEuroAmount(raw);
}

function parseKleinanzeigenAds(html) {
  const ads = [];
  const re = /<article class="aditem"[^>]*data-adid="(\d+)"[^>]*data-href="([^"]+)"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const href = decodeHtmlEntities(match[2]);
    const body = match[3];
    if (!/^\d{6,16}$/.test(id) || !href) continue;

    const title = stripHtml(
      (body.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '',
    );
    if (!title || title.length < 4) continue;
    // Wanted / empty / placeholder noise
    if (/^\s*(suche|gesucht|gesuch)\b/i.test(title)) continue;
    if (/^(n\/?a|test|asdf|\.+)$/i.test(title)) continue;

    const description = stripHtml(
      (body.match(/class="aditem-main--middle--description"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '',
    );
    const price = parseKleinanzeigenPrice(
      (body.match(/aditem-main--middle--price-shipping--price[^>]*>([\s\S]*?)<\/p>/i) || [])[1]
      || (body.match(/aditem-main--middle--price[^>]*>([\s\S]*?)<\/p>/i) || [])[1]
      || '',
    );
    if (!Number.isFinite(price) || price <= 0) continue;

    const location = stripHtml(
      (body.match(/aditem-main--top--left[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '',
    ).replace(/^.*?icon-pin[^>]*>\s*/i, '').trim();
    const dateText = stripHtml(
      (body.match(/aditem-main--top--right[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '',
    );
    const image = decodeHtmlEntities(
      (body.match(/img\.kleinanzeigen\.de[^"'\s>]+/) || [])[0]
      || (body.match(/src="(https:\/\/img\.kleinanzeigen\.de[^"]+)"/i) || [])[1]
      || '',
    );
    const tags = [...body.matchAll(/class="simpletag[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map(item => stripHtml(item[1]))
      .filter(Boolean);
    const tagText = tags.join(' ');
    const offerText = `${title} ${description} ${tagText}`;
    const pickupOnly = /\bnur\s*(selbst)?abholung\b|\bpick[\s-]?up\s*only\b|\bselbstabholung\b|\bkeine[rn]?\s*versand\b|\bversand\s*(nicht|ausgeschlossen)\b|\bohne\s*versand\b/i.test(offerText)
      || tags.some(tag => /nur\s*(selbst)?abholung|pick[\s-]?up\s*only|selbstabholung/i.test(tag));
    const shippingPossible = !pickupOnly && (
      tags.some(tag => /versand/i.test(tag))
      || /versand\s*m[oö]glich/i.test(offerText)
    );
    const sourceText = offerText;

    // Drop empty-box / packaging junk even before smart filters.
    const hay = normalizeListingText(sourceText);
    if (!hay) continue;
    if (isPackagingWithoutCard(hay) || isReplacementPart(hay)) continue;
    if (blockedPatterns.some(pattern => pattern.test(hay))) continue;

    ads.push({
      id: `ka|${id}`,
      legacyItemId: id,
      title,
      location,
      seller: location || 'Kleinanzeigen',
      feedback: 100,
      feedbackScore: null,
      condition: tags.find(tag => /neu|sehr gut|gut|in ordnung|defekt/i.test(tag)) || 'Kleinanzeigen',
      conditionId: '',
      price,
      shipping: 0,
      shippingKnown: false,
      total: price,
      image: image.startsWith('http') ? image : (image ? `https://${image}` : ''),
      endDate: null,
      originDate: null,
      listedLabel: dateText || '',
      url: href.startsWith('http') ? href : `${KA_BASE}${href}`,
      isAuction: false,
      bestOffer: /direkt kaufen|vb|verhandlungsbasis/i.test(`${title} ${description} ${tags.join(' ')}`),
      marketplace: 'kleinanzeigen',
      sourceText,
      shippingPossible,
      pickupOnly,
      lotType: classifyLotType(hay),
    });
  }
  return ads;
}

async function searchKleinanzeigenListings(query) {
  const pages = [1, 2];
  const pageUrl = buildKleinanzeigenSearchUrl(query, 1);
  const scanned = [];
  for (const page of pages) {
    const url = buildKleinanzeigenSearchUrl(query, page);
    try {
      const html = await fetchKleinanzeigenHtml(url);
      const ads = parseKleinanzeigenAds(html);
      if (!ads.length) break;
      scanned.push(...ads);
      if (ads.length < 10) break;
    } catch (error) {
      if (!scanned.length) throw error;
      console.error(`Kleinanzeigen page ${page} failed:`, error.message);
      break;
    }
  }

  // De-dupe by ad id
  const byId = new Map();
  for (const ad of scanned) {
    if (!byId.has(ad.id)) byId.set(ad.id, ad);
  }
  const unique = [...byId.values()];
  const accepted = unique.filter(item => passesListingRules(item, query));
  const resultItems = finalizeListingItems(accepted, query.maxPrice)
    .sort((a, b) => a.price - b.price || a.total - b.total);

  return {
    items: resultItems,
    suggestions: [],
    suggestionMeta: null,
    scanned: unique.length,
    rejected: unique.length - accepted.length,
    totalAvailable: unique.length,
    remindersScheduled: 0,
    telegramConfigured: telegramConfigured(),
    alerts: Boolean(query.alerts),
    monitorIntervalMinutes: MONITOR_INTERVAL_MINUTES,
    source: 'kleinanzeigen-html',
    marketplace: 'kleinanzeigen',
    pageUrl,
  };
}

async function searchListings(query) {
  if (query.marketplace === 'kleinanzeigen') {
    return searchKleinanzeigenListings(query);
  }
  const data = await fetchBrowseItemSummaries(query);
  const scanned = data.itemSummaries || [];
  const items = mapBrowseItems(scanned).map(item => ({ ...item, marketplace: 'ebay' }));
  const accepted = items.filter(item => passesListingRules(item, query));
  const resultItems = finalizeListingItems(accepted, query.maxPrice);
  const remindersScheduled = query.alerts
    ? resultItems.filter(item => item.isAuction).filter(item => scheduleAuctionReminder(item, true)).length
    : 0;

  let suggestions = [];
  let suggestionMeta = null;
  // Background monitor skips nearby upsell searches — they double Browse API usage.
  if (!resultItems.length && !query.skipSuggestions) {
    try {
      const nearby = await searchNearbySuggestions(query);
      suggestions = nearby.suggestions;
      suggestionMeta = {
        reason: 'price',
        originalMax: query.maxPrice,
        searchedUpTo: nearby.searchedUpTo,
        cheapestAbove: suggestions[0]?.price ?? null,
        scanned: nearby.scanned,
      };
    } catch (error) {
      console.error('Nearby suggestion search failed:', error.message);
    }
  }

  return {
    items: resultItems,
    suggestions,
    suggestionMeta,
    scanned: scanned.length,
    rejected: scanned.length - accepted.length,
    totalAvailable: Number(data.total) || scanned.length,
    remindersScheduled,
    telegramConfigured: telegramConfigured(),
    alerts: Boolean(query.alerts),
    monitorIntervalMinutes: MONITOR_INTERVAL_MINUTES,
    source: data.source || 'browse',
    marketplace: 'ebay',
  };
}

function contentType(filePath) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(filePath)] || 'application/octet-stream';
}

function decodeId(value) {
  return decodeURIComponent(value);
}

async function handleDealwatchRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const { pathname } = url;

  // Allow same-origin / localhost panel embedding without a second server.
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...corsHeaders(request), 'Content-Length': '0' });
    response.end();
    return;
  }
  const originalWriteHead = response.writeHead.bind(response);
  response.writeHead = (statusCode, headers) => {
    const merged = { ...corsHeaders(request), ...(headers || {}) };
    return originalWriteHead(statusCode, merged);
  };

  try {
    if (pathname === '/api/ka/purchases' && request.method === 'GET') {
      const store = loadStore();
      sendJson(response, 200, {
        purchases: store.kaPurchases || [],
        count: (store.kaPurchases || []).length,
        ...storeMeta(store),
      });
      return;
    }

    if (pathname === '/api/ka/purchases' && request.method === 'POST') {
      const body = await readJsonBody(request);
      if (body.confirmed !== true) {
        sendJson(response, 400, { error: 'Purchases must be confirmed before import.' });
        return;
      }
      const incoming = normalizeKaPurchases(body.purchases || body.items || [])
        .filter(item => item.confirmed !== false);
      if (!incoming.length) {
        sendJson(response, 400, { error: 'No confirmed purchases to import.' });
        return;
      }
      const store = loadStore();
      const period = String(body.period || '');
      const source = String(body.source || 'extension-confirmed');
      const importedAt = body.importedAt || new Date().toISOString();
      const stamped = incoming.map(item => ({
        ...item,
        period: item.period || period,
        source: item.source || source,
        confirmed: true,
        importedAt,
      }));
      const byId = new Map((store.kaPurchases || []).map(item => [item.id, item]));
      let added = 0;
      for (const item of stamped) {
        if (!byId.has(item.id)) added += 1;
        byId.set(item.id, { ...byId.get(item.id), ...item });
      }
      store.kaPurchases = normalizeKaPurchases([...byId.values()]);
      sendJson(response, 200, {
        added,
        total: store.kaPurchases.length,
        purchases: store.kaPurchases,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/ka/sales' && request.method === 'GET') {
      const store = loadStore();
      sendJson(response, 200, {
        sales: store.kaSales || [],
        count: (store.kaSales || []).length,
        ...storeMeta(store),
      });
      return;
    }

    if (pathname === '/api/ka/sales' && request.method === 'POST') {
      const body = await readJsonBody(request);
      if (body.confirmed !== true) {
        sendJson(response, 400, { error: 'Sales must be confirmed before import.' });
        return;
      }
      const incoming = normalizeKaSales(body.sales || body.items || [])
        .filter(item => item.confirmed !== false);
      if (!incoming.length) {
        sendJson(response, 400, { error: 'No confirmed sales to import.' });
        return;
      }
      const store = loadStore();
      const period = String(body.period || '');
      const source = String(body.source || 'extension-confirmed');
      const importedAt = body.importedAt || new Date().toISOString();
      const stamped = incoming.map(item => ({
        ...item,
        period: item.period || period,
        source: item.source || source,
        confirmed: true,
        importedAt,
      }));
      const byId = new Map((store.kaSales || []).map(item => [item.id, item]));
      let added = 0;
      for (const item of stamped) {
        if (!byId.has(item.id)) added += 1;
        byId.set(item.id, { ...byId.get(item.id), ...item });
      }
      store.kaSales = normalizeKaSales([...byId.values()]);
      sendJson(response, 200, {
        added,
        total: store.kaSales.length,
        sales: store.kaSales,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/ka/sales' && request.method === 'DELETE') {
      const body = await readJsonBody(request).catch(() => ({}));
      const store = loadStore();
      if (body?.all) {
        store.kaSales = [];
      } else {
        const ids = new Set((Array.isArray(body?.ids) ? body.ids : []).map(String));
        store.kaSales = (store.kaSales || []).filter(item => !ids.has(item.id));
      }
      sendJson(response, 200, {
        sales: store.kaSales,
        count: store.kaSales.length,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/ka/purchases' && request.method === 'DELETE') {
      const body = await readJsonBody(request).catch(() => ({}));
      const store = loadStore();
      if (body?.all) {
        store.kaPurchases = [];
      } else {
        const ids = new Set((Array.isArray(body?.ids) ? body.ids : []).map(String));
        store.kaPurchases = (store.kaPurchases || []).filter(item => !ids.has(item.id));
      }
      sendJson(response, 200, {
        purchases: store.kaPurchases,
        count: store.kaPurchases.length,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/ka/locations' && request.method === 'GET') {
      try {
        const q = String(url.searchParams.get('q') || '').trim();
        if (q.length < 2) {
          sendJson(response, 200, { locations: [] });
          return;
        }
        const res = await fetch(`${KA_BASE}/s-ort-empfehlungen.json?query=${encodeURIComponent(q)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const locations = Object.entries(data || {})
          .map(([key, label]) => ({
            id: String(key).replace(/^_/, ''),
            label: String(label || ''),
          }))
          .filter(item => item.id && item.id !== '0' && item.label)
          .slice(0, 12);
        sendJson(response, 200, { locations });
      } catch (error) {
        sendJson(response, 502, { error: `Location lookup failed: ${error.message}` });
      }
      return;
    }

    if (pathname === '/api/store' && request.method === 'GET') {
      sendJson(response, 200, storeMeta());
      return;
    }

    if (pathname === '/api/alerts' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request);
      const store = loadStore();
      store.alerts = body.alerts !== false && body.alerts !== '0' && body.alerts !== 0;
      sendJson(response, 200, storeMeta(saveStore(store)));
      return;
    }

    if (pathname === '/api/notifications' && request.method === 'GET') {
      const store = loadStore();
      const unread = store.notifications.filter(item => !item.read).length;
      sendJson(response, 200, {
        notifications: store.notifications,
        unread,
        ...storeMeta(store),
      });
      return;
    }

    if (pathname === '/api/notifications/read' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request);
      const store = loadStore();
      const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
      store.notifications = store.notifications.map(item => {
        if (ids && ids.size && !ids.has(item.id)) return item;
        return { ...item, read: true };
      });
      sendJson(response, 200, {
        notifications: store.notifications,
        unread: store.notifications.filter(item => !item.read).length,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/notifications' && request.method === 'DELETE') {
      const store = loadStore();
      store.notifications = [];
      sendJson(response, 200, {
        notifications: [],
        unread: 0,
        ...storeMeta(saveStore(store)),
      });
      return;
    }

    if (pathname === '/api/smart-filters' && request.method === 'GET') {
      const query = String(url.searchParams.get('query') || '').trim();
      const categoryId = String(url.searchParams.get('categoryId') || '').trim();
      sendJson(response, 200, {
        query,
        categoryId,
        smartFilters: smartFilterDefs(query || DEFAULT_FILTERS.search, categoryId),
        capacityIncludes: capacityIncludeDefs(query || DEFAULT_FILTERS.search, categoryId),
      });
      return;
    }

    if (pathname === '/api/categories' && request.method === 'GET') {
      try {
        if (url.searchParams.get('refresh') === '1') {
          await refreshPcCategoryTreeFromEbay();
        }
        const query = String(url.searchParams.get('q') || '').trim();
        if (query) {
          sendJson(response, 200, searchPcCategories(query));
          return;
        }
        sendJson(response, 200, listCategoryChildren(String(url.searchParams.get('parent') || '').trim()));
      } catch (error) {
        sendJson(response, error.status || 502, { error: error.message });
      }
      return;
    }

    if (pathname === '/api/categories/refresh' && request.method === 'POST') {
      try {
        const tree = await refreshPcCategoryTreeFromEbay();
        sendJson(response, 200, {
          marketplace: tree.marketplace,
          rootId: tree.rootId,
          rootName: tree.rootName,
          updatedAt: tree.updatedAt,
          count: tree.categories.length,
        });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (pathname === '/api/searches' && request.method === 'GET') {
      sendJson(response, 200, storeMeta());
      return;
    }

    if (pathname === '/api/searches' && request.method === 'POST') {
      const body = await readJsonBody(request);
      if (!String(body?.search || '').trim()) {
        sendJson(response, 400, { error: 'Keywords are required — enter what you’d search on ebay.de.' });
        return;
      }
      const store = loadStore();
      const created = createTrackedSearch(body);
      store.searches.unshift(created);
      store.activeId = created.id;
      sendJson(response, 201, { search: created, ...storeMeta(saveStore(store)) });
      return;
    }

    if (pathname === '/api/searches/active' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request);
      const store = loadStore();
      if (!store.searches.some(item => item.id === body.id)) {
        sendJson(response, 404, { error: 'Search not found.' });
        return;
      }
      store.activeId = body.id;
      sendJson(response, 200, storeMeta(saveStore(store)));
      return;
    }

    if (pathname === '/api/searches/reorder' && (request.method === 'PUT' || request.method === 'POST')) {
      const body = await readJsonBody(request);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const store = loadStore();
      const byId = new Map(store.searches.map(item => [item.id, item]));
      if (!ids.length || ids.length !== store.searches.length || ids.some(id => !byId.has(id))) {
        sendJson(response, 400, { error: 'Invalid filter order.' });
        return;
      }
      // Reject duplicate ids.
      if (new Set(ids).size !== ids.length) {
        sendJson(response, 400, { error: 'Invalid filter order.' });
        return;
      }
      store.searches = ids.map(id => byId.get(id));
      sendJson(response, 200, storeMeta(saveStore(store)));
      return;
    }

    const searchMatch = pathname.match(/^\/api\/searches\/([^/]+)(?:\/(restore))?$/);
    if (searchMatch) {
      const id = decodeId(searchMatch[1]);
      const action = searchMatch[2];
      const store = loadStore();

      if (action === 'restore' && request.method === 'POST') {
        const index = store.trash.findIndex(item => item.id === id);
        if (index < 0) {
          sendJson(response, 404, { error: 'Filter not found in trash.' });
          return;
        }
        const [restored] = store.trash.splice(index, 1);
        delete restored.deletedAt;
        const clean = createTrackedSearch(restored);
        store.searches.unshift(clean);
        store.activeId = clean.id;
        sendJson(response, 200, { search: clean, ...storeMeta(saveStore(store)) });
        return;
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        const index = store.searches.findIndex(item => item.id === id);
        if (index < 0) {
          sendJson(response, 404, { error: 'Search not found.' });
          return;
        }
        const body = await readJsonBody(request);
        const updated = createTrackedSearch({
          ...store.searches[index],
          ...body,
          id,
          createdAt: store.searches[index].createdAt,
        });
        store.searches[index] = updated;
        // Keep the open filter unless this update is for the active one (or setActive is forced).
        if (id === store.activeId || body.setActive === true) {
          store.activeId = id;
        }
        sendJson(response, 200, { search: updated, ...storeMeta(saveStore(store)) });
        return;
      }

      if (request.method === 'DELETE') {
        const index = store.searches.findIndex(item => item.id === id);
        if (index < 0) {
          sendJson(response, 404, { error: 'Search not found.' });
          return;
        }
        if (store.searches.length === 1) {
          sendJson(response, 400, { error: 'Cannot delete the last active filter. Create a new one first, then delete this one.' });
          return;
        }
        const [removed] = store.searches.splice(index, 1);
        store.trash.unshift({ ...removed, deletedAt: new Date().toISOString() });
        if (store.activeId === id) store.activeId = store.searches[0].id;
        sendJson(response, 200, storeMeta(saveStore(store)));
        return;
      }
    }

    const trashMatch = pathname.match(/^\/api\/trash\/([^/]+)$/);
    if (trashMatch && request.method === 'DELETE') {
      const id = decodeId(trashMatch[1]);
      const store = loadStore();
      const next = store.trash.filter(item => item.id !== id);
      if (next.length === store.trash.length) {
        sendJson(response, 404, { error: 'Filter not found in trash.' });
        return;
      }
      store.trash = next;
      sendJson(response, 200, storeMeta(saveStore(store)));
      return;
    }

    if (pathname === '/api/watchlist' && request.method === 'GET') {
      const store = loadStore();
      sendJson(response, 200, { watchlist: store.watchlist, ...storeMeta(store) });
      return;
    }

    if (pathname === '/api/offers-sent' && request.method === 'PUT') {
      const body = await readJsonBody(request);
      const itemId = String(body.id || body.itemId || '').trim();
      if (!itemId) {
        sendJson(response, 400, { error: 'Listing id is required.' });
        return;
      }
      const store = loadStore();
      const sent = body.sent !== false && body.sent !== 0 && body.sent !== '0';
      setOfferSent(store, itemId, sent);
      sendJson(response, 200, { offersSent: saveStore(store).offersSent, id: itemId, sent });
      return;
    }

    if (pathname === '/api/watchlist' && request.method === 'POST') {
      const body = await readJsonBody(request);
      if (!body.id) {
        sendJson(response, 400, { error: 'Listing id is required.' });
        return;
      }
      const store = loadStore();
      if (store.watchlist.some(item => item.id === body.id)) {
        sendJson(response, 200, { watchlist: store.watchlist, alreadySaved: true, ...storeMeta(store) });
        return;
      }
      store.watchlist.unshift({
        id: String(body.id),
        legacyItemId: String(body.legacyItemId || ''),
        title: String(body.title || ''),
        seller: String(body.seller || ''),
        feedback: Number(body.feedback) || 0,
        feedbackScore: Number.isFinite(Number(body.feedbackScore)) ? Number(body.feedbackScore) : null,
        condition: String(body.condition || ''),
        price: Number(body.price) || 0,
        shipping: Number(body.shipping) || 0,
        total: Number(body.total) || 0,
        image: String(body.image || ''),
        endDate: body.endDate || null,
        url: String(body.url || ''),
        isAuction: Boolean(body.isAuction),
        bestOffer: Boolean(body.bestOffer),
        dealScore: Number(body.dealScore) || 0,
        savedAt: new Date().toISOString(),
      });
      sendJson(response, 201, { watchlist: store.watchlist, ...storeMeta(saveStore(store)) });
      return;
    }

    const watchMatch = pathname.match(/^\/api\/watchlist\/([^/]+)$/);
    if (watchMatch && request.method === 'DELETE') {
      const id = decodeId(watchMatch[1]);
      const store = loadStore();
      const next = store.watchlist.filter(item => item.id !== id);
      if (next.length === store.watchlist.length) {
        sendJson(response, 404, { error: 'Listing is not on the watchlist.' });
        return;
      }
      store.watchlist = next;
      sendJson(response, 200, { watchlist: store.watchlist, ...storeMeta(saveStore(store)) });
      return;
    }

    if (pathname === '/api/listings') {
      let marketplaceHint = 'ebay';
      try {
        const store = loadStore();
        const active = getActiveSearch(store);
        const query = {
          ...normalizeFilters({
            search: url.searchParams.get('query') ?? active.search,
            minPrice: url.searchParams.get('minPrice') ?? active.minPrice,
            maxPrice: url.searchParams.get('maxPrice') ?? active.maxPrice,
            minFeedback: url.searchParams.get('minFeedback') ?? active.minFeedback,
            condition: url.searchParams.get('condition') ?? active.condition,
            disabledSmartFilters: url.searchParams.get('disabledSmartFilters') != null
              ? String(url.searchParams.get('disabledSmartFilters') || '').split(',').filter(Boolean)
              : active.disabledSmartFilters,
            enabledSmartFilters: url.searchParams.get('enabledSmartFilters') != null
              ? String(url.searchParams.get('enabledSmartFilters') || '').split(',').filter(Boolean)
              : active.enabledSmartFilters,
            includeCapacities: url.searchParams.get('includeCapacities') != null
              ? String(url.searchParams.get('includeCapacities') || '').split(',').filter(Boolean)
              : active.includeCapacities,
            categoryId: url.searchParams.has('categoryId')
              ? url.searchParams.get('categoryId')
              : active.categoryId,
            categoryName: url.searchParams.get('categoryName') ?? active.categoryName,
            categoryPath: active.categoryPath,
            marketplace: url.searchParams.get('marketplace') ?? active.marketplace,
            kaCategory: url.searchParams.get('kaCategory') ?? active.kaCategory,
            locationId: url.searchParams.get('locationId') ?? active.locationId,
            locationLabel: url.searchParams.get('locationLabel') ?? active.locationLabel,
            radiusKm: url.searchParams.get('radiusKm') ?? active.radiusKm,
            shippingOnly: url.searchParams.has('shippingOnly')
              ? url.searchParams.get('shippingOnly') === '1'
              : active.shippingOnly,
          }),
          alerts: url.searchParams.has('alerts')
            ? url.searchParams.get('alerts') !== '0'
            : store.alerts,
        };
        marketplaceHint = query.marketplace;
        // Prefer UI Scan over the background monitor; fail fast on eBay cooldown.
        pauseMonitor(45_000, 'interactive Scan');
        query.interactive = true;
        const result = await searchListings(query);
        const ids = (result.items || []).map(item => String(item.id)).filter(Boolean);
        const items = active?.id
          ? annotateListingFreshness(store, active.id, result.items || [])
          : (result.items || []).map(item => ({
            ...item,
            isNew: false,
            offerSent: Boolean(item.id && (store.offersSent || []).includes(String(item.id))),
          }));
        // After tagging isNew, remember current matches so the next scan only highlights fresh lots.
        if (active?.id && ids.length) {
          rememberSeenIds(store, active.id, ids);
          saveStore(store);
        }
        sendJson(response, 200, {
          ...result,
          items,
          activeSearch: active,
          watchlistIds: store.watchlist.map(item => item.id),
          offersSent: store.offersSent || [],
          store: storeMeta(store),
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Listings request failed:', error.message);
        sendJson(response, 502, {
          error: marketplaceHint === 'kleinanzeigen'
            ? `Kleinanzeigen: ${error.message}`
            : `eBay API: ${error.message}`,
        });
      }
      return;
    }

    if (pathname === '/api/explore') {
      try {
        const buyingRaw = String(url.searchParams.get('buyingOptions') || '')
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean);
        const allowedBuying = new Set(['FIXED_PRICE', 'AUCTION', 'BEST_OFFER']);
        const buyingOptions = buyingRaw.filter(v => allowedBuying.has(v));
        const minPrice = Number(url.searchParams.get('minPrice'));
        const maxPrice = Number(url.searchParams.get('maxPrice'));
        const minFeedback = Number(url.searchParams.get('minFeedback'));
        const categoryId = String(url.searchParams.get('categoryId') || '').trim();
        const query = {
          explore: true,
          search: String(url.searchParams.get('query') || '').trim(),
          minPrice: Number.isFinite(minPrice) ? Math.max(0, minPrice) : 0,
          maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.min(100000, maxPrice) : 10000,
          minFeedback: Number.isFinite(minFeedback) ? Math.max(0, minFeedback) : 0,
          condition: String(url.searchParams.get('condition') || 'any'),
          categoryId: categoryId || null,
          categoryName: String(url.searchParams.get('categoryName') || '').trim(),
          buyingOptions,
          freeShipping: url.searchParams.get('freeShipping') === '1',
          returnsAccepted: url.searchParams.get('returnsAccepted') === '1',
          itemLocationCountry: url.searchParams.get('locatedInDE') === '1' ? 'DE' : '',
          sort: String(url.searchParams.get('sort') || 'newlyListed'),
        };
        if (!query.search && !query.categoryId) {
          sendJson(response, 400, { error: 'Enter keywords or pick a category.' });
          return;
        }
        pauseMonitor(45_000, 'interactive Explore');
        query.interactive = true;
        const result = await searchExplore(query);
        const store = loadStore();
        const seenKey = exploreSeenKey(query);
        const ids = (result.items || []).map(item => String(item.id)).filter(Boolean);
        const items = annotateListingFreshness(store, seenKey, result.items || []);
        if (ids.length) {
          rememberSeenIds(store, seenKey, ids);
          saveStore(store);
        }
        const sorted = [...items].sort((a, b) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)));
        sendJson(response, 200, {
          ...result,
          items: sorted,
          newCount: sorted.filter(item => item.isNew).length,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Explore search failed:', error.message);
        sendJson(response, 502, { error: `eBay API: ${error.message}` });
      }
      return;
    }

    if (pathname === '/api/sold') {
      try {
        const store = loadStore();
        const active = getActiveSearch(store);
        const query = normalizeFilters({
          search: url.searchParams.get('query') ?? active.search,
          minPrice: url.searchParams.get('minPrice') ?? active.minPrice,
          maxPrice: url.searchParams.get('maxPrice') ?? active.maxPrice,
          minFeedback: url.searchParams.get('minFeedback') ?? active.minFeedback,
          condition: url.searchParams.get('condition') ?? active.condition,
          disabledSmartFilters: url.searchParams.get('disabledSmartFilters') != null
            ? String(url.searchParams.get('disabledSmartFilters') || '').split(',').filter(Boolean)
            : active.disabledSmartFilters,
          enabledSmartFilters: url.searchParams.get('enabledSmartFilters') != null
            ? String(url.searchParams.get('enabledSmartFilters') || '').split(',').filter(Boolean)
            : active.enabledSmartFilters,
          includeCapacities: url.searchParams.get('includeCapacities') != null
            ? String(url.searchParams.get('includeCapacities') || '').split(',').filter(Boolean)
            : active.includeCapacities,
          categoryId: url.searchParams.has('categoryId')
            ? url.searchParams.get('categoryId')
            : active.categoryId,
          categoryName: url.searchParams.get('categoryName') ?? active.categoryName,
          categoryPath: active.categoryPath,
        });
        const result = await searchSoldListings(query);
        sendJson(response, 200, {
          ...result,
          activeSearch: active,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('eBay sold scrape failed:', error.message);
        sendJson(response, 502, { error: `Sold comps: ${error.message}` });
      }
      return;
    }

    // Read-only bridge for Buy Helper: combines eBay sold, eBay live, and Kleinanzeigen live
    // into one quote. Deliberately does NOT touch store.seenBySearch/activeId/monitor state —
    // /api/listings ties results to the currently active saved search, which would corrupt
    // that search's freshness tracking for an unrelated ad-hoc query. Reuses searchSoldListings/
    // searchListings as-is; no new scraping/parsing logic.
    if (pathname === '/api/buy-helper/quote' && request.method === 'GET') {
      const rawQuery = String(url.searchParams.get('query') || '').trim();
      if (!rawQuery) {
        sendJson(response, 400, { error: 'query is required' });
        return;
      }
      const ebayQuery = buildBuyHelperQuoteQuery(url.searchParams, 'ebay');
      const kaQuery = buildBuyHelperQuoteQuery(url.searchParams, 'kleinanzeigen');

      const [soldSettled, ebayLiveSettled, kaLiveSettled] = await Promise.allSettled([
        searchSoldListings(ebayQuery),
        searchListings({ ...ebayQuery, alerts: false }),
        searchListings({ ...kaQuery, alerts: false }),
      ]);

      const errors = {};
      const reasonMessage = (reason) => (reason instanceof Error ? reason.message : String(reason));

      const ebaySold = soldSettled.status === 'fulfilled' ? buildQuoteBucket(soldSettled.value.items) : null;
      if (soldSettled.status === 'rejected') errors.ebaySold = reasonMessage(soldSettled.reason);

      const ebayLive = ebayLiveSettled.status === 'fulfilled' ? buildQuoteBucket(ebayLiveSettled.value.items) : null;
      if (ebayLiveSettled.status === 'rejected') errors.ebayLive = reasonMessage(ebayLiveSettled.reason);

      const kaLive = kaLiveSettled.status === 'fulfilled' ? buildQuoteBucket(kaLiveSettled.value.items) : null;
      if (kaLiveSettled.status === 'rejected') errors.kaLive = reasonMessage(kaLiveSettled.reason);

      sendJson(response, 200, {
        query: rawQuery,
        ebaySold,
        ebayLive,
        kaLive,
        errors: Object.keys(errors).length ? errors : undefined,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (pathname === '/api/gpus' && request.method === 'GET') {
      const db = loadGpuSpecsDb();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const series = String(url.searchParams.get('series') || '').trim();
      let gpus = db.gpus || [];
      if (series) gpus = gpus.filter(gpu => String(gpu.series || '') === series);
      if (q) {
        gpus = gpus.filter(gpu => `${gpu.name} ${gpu.id} ${gpu.architecture} ${gpu.series}`
          .toLowerCase()
          .includes(q));
      }
      sendJson(response, 200, {
        baselineId: db.baselineId,
        updatedAt: db.updatedAt,
        note: db.note,
        series: [...new Set((db.gpus || []).map(gpu => gpu.series).filter(Boolean))],
        gpus,
        count: gpus.length,
      });
      return;
    }

    if (pathname === '/api/gpus/compare' && request.method === 'GET') {
      const ids = String(url.searchParams.get('ids') || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const baselineId = String(url.searchParams.get('baseline') || '').trim();
      if (!ids.length) {
        sendJson(response, 400, { error: 'Pass ids=gpu-id,gpu-id to compare.' });
        return;
      }
      sendJson(response, 200, buildGpuComparison(ids, baselineId || ids[0]));
      return;
    }

    const gpuMatch = pathname.match(/^\/api\/gpus\/([^/]+)$/);
    if (gpuMatch && request.method === 'GET') {
      const gpu = findGpuById(decodeURIComponent(gpuMatch[1]));
      if (!gpu) {
        sendJson(response, 404, { error: 'GPU not found.' });
        return;
      }
      sendJson(response, 200, { gpu });
      return;
    }

    if (pathname === '/api/cpus' && request.method === 'GET') {
      const db = loadCpuSpecsDb();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const series = String(url.searchParams.get('series') || '').trim();
      const socket = String(url.searchParams.get('socket') || '').trim();
      let cpus = db.cpus || [];
      if (series) cpus = cpus.filter(cpu => String(cpu.series || '') === series);
      if (socket) cpus = cpus.filter(cpu => String(cpu.socket || '') === socket);
      if (q) {
        cpus = cpus.filter(cpu => `${cpu.name} ${cpu.id} ${cpu.architecture} ${cpu.series} ${cpu.socket} ${cpu.brand}`
          .toLowerCase()
          .includes(q));
      }
      sendJson(response, 200, {
        baselineId: db.baselineId,
        updatedAt: db.updatedAt,
        note: db.note,
        series: [...new Set((db.cpus || []).map(cpu => cpu.series).filter(Boolean))],
        sockets: [...new Set((db.cpus || []).map(cpu => cpu.socket).filter(Boolean))],
        cpus,
        count: cpus.length,
      });
      return;
    }

    if (pathname === '/api/cpus/compare' && request.method === 'GET') {
      const ids = String(url.searchParams.get('ids') || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const baselineId = String(url.searchParams.get('baseline') || '').trim();
      const score = String(url.searchParams.get('score') || 'relativeMulti').trim();
      if (!ids.length) {
        sendJson(response, 400, { error: 'Pass ids=cpu-id,cpu-id to compare.' });
        return;
      }
      sendJson(response, 200, buildCpuComparison(ids, baselineId || ids[0], score));
      return;
    }

    const cpuMatch = pathname.match(/^\/api\/cpus\/([^/]+)$/);
    if (cpuMatch && request.method === 'GET') {
      const cpu = findCpuById(decodeURIComponent(cpuMatch[1]));
      if (!cpu) {
        sendJson(response, 404, { error: 'CPU not found.' });
        return;
      }
      sendJson(response, 200, { cpu });
      return;
    }

    if (pathname === '/api/ssds' && request.method === 'GET') {
      const db = loadSsdSpecsDb();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const series = String(url.searchParams.get('series') || '').trim();
      const brand = String(url.searchParams.get('brand') || '').trim();
      let ssds = db.ssds || [];
      if (series) ssds = ssds.filter(ssd => String(ssd.series || ssd.interface || '') === series);
      if (brand) ssds = ssds.filter(ssd => String(ssd.brand || '') === brand);
      if (q) {
        ssds = ssds.filter(ssd => `${ssd.name} ${ssd.id} ${ssd.family} ${ssd.brand} ${ssd.interface} ${ssd.partNumber || ''}`
          .toLowerCase()
          .includes(q));
      }
      sendJson(response, 200, {
        baselineId: db.baselineId,
        updatedAt: db.updatedAt,
        note: db.note,
        series: [...new Set((db.ssds || []).map(ssd => ssd.series || ssd.interface).filter(Boolean))],
        brands: [...new Set((db.ssds || []).map(ssd => ssd.brand).filter(Boolean))].sort(),
        ssds,
        count: ssds.length,
      });
      return;
    }

    if (pathname === '/api/ssds/compare' && request.method === 'GET') {
      const ids = String(url.searchParams.get('ids') || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const baselineId = String(url.searchParams.get('baseline') || '').trim();
      if (!ids.length) {
        sendJson(response, 400, { error: 'Pass ids=ssd-id,ssd-id to compare.' });
        return;
      }
      sendJson(response, 200, buildStorageComparison('ssd', ids, baselineId || ids[0]));
      return;
    }

    const ssdMatch = pathname.match(/^\/api\/ssds\/([^/]+)$/);
    if (ssdMatch && request.method === 'GET') {
      const ssd = findSsdById(decodeURIComponent(ssdMatch[1]));
      if (!ssd) {
        sendJson(response, 404, { error: 'SSD not found.' });
        return;
      }
      sendJson(response, 200, { ssd });
      return;
    }

    if (pathname === '/api/hdds' && request.method === 'GET') {
      const db = loadHddSpecsDb();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const series = String(url.searchParams.get('series') || '').trim();
      const brand = String(url.searchParams.get('brand') || '').trim();
      let hdds = db.hdds || [];
      if (series) hdds = hdds.filter(hdd => String(hdd.series || hdd.brand || '') === series);
      if (brand) hdds = hdds.filter(hdd => String(hdd.brand || '') === brand);
      if (q) {
        hdds = hdds.filter(hdd => `${hdd.name} ${hdd.id} ${hdd.family} ${hdd.brand} ${hdd.partNumber || ''}`
          .toLowerCase()
          .includes(q));
      }
      const brandSeries = [...new Set((db.hdds || []).map(hdd => hdd.brand).filter(Boolean))].sort();
      sendJson(response, 200, {
        baselineId: db.baselineId,
        updatedAt: db.updatedAt,
        note: db.note,
        series: brandSeries,
        brands: brandSeries,
        hdds,
        count: hdds.length,
      });
      return;
    }

    if (pathname === '/api/hdds/compare' && request.method === 'GET') {
      const ids = String(url.searchParams.get('ids') || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const baselineId = String(url.searchParams.get('baseline') || '').trim();
      if (!ids.length) {
        sendJson(response, 400, { error: 'Pass ids=hdd-id,hdd-id to compare.' });
        return;
      }
      sendJson(response, 200, buildStorageComparison('hdd', ids, baselineId || ids[0]));
      return;
    }

    const hddMatch = pathname.match(/^\/api\/hdds\/([^/]+)$/);
    if (hddMatch && request.method === 'GET') {
      const hdd = findHddById(decodeURIComponent(hddMatch[1]));
      if (!hdd) {
        sendJson(response, 404, { error: 'HDD not found.' });
        return;
      }
      sendJson(response, 200, { hdd });
      return;
    }
  } catch (error) {
    console.error('API error:', error.message);
    sendJson(response, 400, { error: error.message || 'Server error.' });
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : path.basename(pathname);
  const filePath = path.join(__dirname, relativePath);
  if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath)) { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
}

function pushNotification(store, search, item) {
  store.notifications.unshift({
    id: crypto.randomUUID(),
    searchId: search.id,
    searchName: search.name,
    itemId: String(item.id),
    title: String(item.title || '').slice(0, 200),
    price: Number(item.price) || 0,
    total: Number(item.total) || Number(item.price) || 0,
    url: String(item.url || ''),
    image: String(item.image || ''),
    createdAt: new Date().toISOString(),
    read: false,
  });
}

function exploreSeenKey(query) {
  const buying = Array.isArray(query.buyingOptions) ? [...query.buyingOptions].sort().join('|') : '';
  return [
    'explore',
    String(query.search || '').trim().toLowerCase(),
    String(query.categoryId || ''),
    String(query.condition || 'any'),
    String(query.minPrice ?? 0),
    String(query.maxPrice ?? ''),
    String(query.minFeedback ?? 0),
    buying,
    query.freeShipping ? '1' : '0',
    query.returnsAccepted ? '1' : '0',
    query.itemLocationCountry || '',
    String(query.sort || 'newlyListed'),
  ].join('::');
}

function rememberSeenIds(store, searchId, itemIds) {
  const prev = store.seenBySearch[searchId] || [];
  store.seenBySearch[searchId] = [...new Set([...itemIds.map(String), ...prev])].slice(0, 2000);
}

function setOfferSent(store, itemId, sent = true) {
  const id = String(itemId || '');
  if (!id) return store.offersSent || [];
  const set = new Set(store.offersSent || []);
  if (sent) set.add(id);
  else set.delete(id);
  store.offersSent = [...set].slice(0, 2000);
  return store.offersSent;
}

function annotateListingFreshness(store, searchId, items = []) {
  const known = store.seenBySearch[searchId];
  const isFirstPass = !known;
  const seen = new Set(known || []);
  return (items || []).map(item => {
    const id = item?.id ? String(item.id) : '';
    return {
      ...item,
      isNew: Boolean(id && !isFirstPass && !seen.has(id)),
      offerSent: Boolean(id && (store.offersSent || []).includes(id)),
    };
  });
}

async function monitorSearches() {
  const store = loadStore();
  if (!store.alerts) return;

  if (Date.now() < monitorPausedUntil) {
    const left = Math.ceil((monitorPausedUntil - Date.now()) / 1000);
    console.log(`[dealwatch] monitor skip — paused ${left}s more (UI Scan / rate limit)`);
    return;
  }

  let changed = false;
  const monitored = store.searches.filter(search => search.monitor !== false);
  const canTelegram = telegramConfigured();
  let ebay429Streak = 0;

  for (const search of monitored) {
    if (Date.now() < monitorPausedUntil) {
      console.log('[dealwatch] monitor cycle interrupted — UI Scan or cooldown');
      break;
    }
    try {
      const result = await searchListings({
        ...search,
        alerts: canTelegram,
        skipSuggestions: true,
      });
      ebay429Streak = 0;
      const items = Array.isArray(result.items) ? result.items : [];
      const ids = items.map(item => String(item.id)).filter(Boolean);
      const known = store.seenBySearch[search.id];

      if (!known) {
        // First pass: seed seen IDs so existing matches are not treated as "new".
        rememberSeenIds(store, search.id, ids);
        changed = true;
      } else {
        const seen = new Set(known);
        const fresh = items.filter(item => item.id && !seen.has(String(item.id)));
        for (const item of fresh) {
          pushNotification(store, search, item);
          changed = true;
        }
        if (ids.length || fresh.length) {
          rememberSeenIds(store, search.id, ids);
          changed = true;
        }
      }

      if (canTelegram) {
        console.log(
          `Monitor [${search.name}]: ${items.length} matches, ${result.remindersScheduled || 0} auction reminders.`,
        );
      } else {
        console.log(`Monitor [${search.name}]: ${items.length} matches.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Monitor failed for ${search.name}:`, msg);
      if (/too many requests|429/i.test(msg)) {
        ebay429Streak += 1;
        const coolSec = Math.min(120, 15 * ebay429Streak);
        pauseMonitor(coolSec * 1000, `monitor 429 streak ${ebay429Streak}`);
        if (ebay429Streak >= 3) {
          console.warn('[dealwatch] stopping this monitor cycle early — eBay still rate-limiting');
          break;
        }
        continue;
      }
    }

    if (MONITOR_SEARCH_GAP_MS > 0) await sleep(MONITOR_SEARCH_GAP_MS);
  }

  if (changed) {
    store.notifications = store.notifications.slice(0, 100);
    saveStore(store);
  }
}

let marketRuntimeStarted = false;

function startDealwatchRuntime() {
  if (marketRuntimeStarted) return;
  marketRuntimeStarted = true;
  if (process.env.VERCEL) {
    // Serverless: no long-lived background monitor. Store still loads on demand.
    const store = loadStore();
    const active = getActiveSearch(store);
    console.log(`[dealwatch] Vercel mode ready · tracked filters: ${store.searches.length}; active: ${active?.name || '—'}`);
    return;
  }
  ensureDataDir();
  const store = saveStore(loadStore());
  const active = getActiveSearch(store);
  console.log(`[dealwatch] Active search: ${active.name}; tracked filters: ${store.searches.length}; in trash: ${store.trash.length}`);
  startBackgroundMonitor();
  console.log(`[dealwatch] Background monitor interval: ${MONITOR_INTERVAL_MINUTES} min.`);
}

function startBackgroundMonitor() {
  monitorSearches().catch((error) => console.error('[dealwatch] monitor error:', error));
  setInterval(() => {
    monitorSearches().catch((error) => console.error('[dealwatch] monitor error:', error));
  }, MONITOR_INTERVAL_MINUTES * 60 * 1000);
}

function createDealwatchServer() {
  return http.createServer((request, response) => {
    handleDealwatchRequest(request, response).catch((error) => {
      console.error('[market] Unhandled request error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Server error.' }));
      }
    });
  });
}

module.exports = {
  handleDealwatchRequest,
  startDealwatchRuntime,
  createDealwatchServer,
  PORT,
  classifyLotType,
  filterSoldMedianOutliers,
  robustBand,
  summarizeComponentTotals,
  buildQuoteBucket,
  buildBuyHelperQuoteQuery,
  loadClassifierConfig,
  normalizeListingText,
  isRamSearch,
  failsRamHardRules,
  matchesRamTotalCapacity,
  isBlockedListing,
};

if (require.main === module) {
  const server = createDealwatchServer();
  server.listen(PORT, () => {
    console.log(`Dealwatch (standalone) running: http://localhost:${PORT}`);
    startDealwatchRuntime();
  });
}
