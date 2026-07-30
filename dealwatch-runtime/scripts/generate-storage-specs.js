/**
 * Parses official UserBenchmark CSV dumps into Dealwatch storage specs.
 *
 * Sources (developer CSV):
 *   https://www.userbenchmark.com/resources/download/csv/SSD_UserBenchmarks.csv
 *   https://www.userbenchmark.com/resources/download/csv/HDD_UserBenchmarks.csv
 *
 * Effective speed: Samsung 850 Pro ≈ 100% (SSD), Seagate Barracuda-class ≈ 100% (HDD).
 *
 * Usage:
 *   node scripts/generate-storage-specs.js
 *   node scripts/generate-storage-specs.js --download
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT_SSD = path.join(ROOT, 'data', 'ssd-specs.json');
const OUT_HDD = path.join(ROOT, 'data', 'hdd-specs.json');

const SOURCES = {
  ssd: {
    url: 'https://www.userbenchmark.com/resources/download/csv/SSD_UserBenchmarks.csv',
    file: path.join(RAW, 'SSD_UserBenchmarks.csv'),
  },
  hdd: {
    url: 'https://www.userbenchmark.com/resources/download/csv/HDD_UserBenchmarks.csv',
    file: path.join(RAW, 'HDD_UserBenchmarks.csv'),
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, {
      headers: { 'User-Agent': 'Dealwatch/1.0 (+storage-specs)' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      reject(err);
    });
  });
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  // UserBenchmark CSVs are: Type,Part Number,Brand,Model,Rank,Benchmark,Samples,URL
  // Model can contain commas and inch marks (2.5"), so parse from the known schema.
  return lines.slice(1).map(parseUbRow).filter(Boolean);
}

function parseUbRow(line) {
  const urlMatch = String(line).match(/,(https?:\/\/\S+)\s*$/);
  if (!urlMatch) return null;
  const url = urlMatch[1];
  let rest = line.slice(0, urlMatch.index);

  const nums = rest.match(/,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)\s*$/);
  if (!nums) return null;
  const rank = nums[1];
  const benchmark = nums[2];
  const samples = nums[3];
  rest = rest.slice(0, nums.index);

  const typeSep = rest.indexOf(',');
  if (typeSep < 0) return null;
  const type = rest.slice(0, typeSep);
  rest = rest.slice(typeSep + 1);

  const pnSep = rest.indexOf(',');
  if (pnSep < 0) return null;
  const partNumber = rest.slice(0, pnSep);
  rest = rest.slice(pnSep + 1);

  const brandSep = rest.indexOf(',');
  if (brandSep < 0) return null;
  const brand = rest.slice(0, brandSep);
  const model = rest.slice(brandSep + 1);

  return {
    Type: type.trim(),
    'Part Number': partNumber.trim(),
    Brand: brand.trim(),
    Model: model.trim(),
    Rank: rank.trim(),
    Benchmark: benchmark.trim(),
    Samples: samples.trim(),
    URL: url.trim(),
  };
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseCapacityGb(model) {
  const text = String(model || '');
  const tb = text.match(/(\d+(?:\.\d+)?)\s*TB\b/i);
  if (tb) return Math.round(Number(tb[1]) * 1000);
  const gb = text.match(/(\d+(?:\.\d+)?)\s*GB\b/i);
  if (gb) return Math.round(Number(gb[1]));
  return null;
}

function detectInterface(model, type, benchmark = null) {
  const t = String(model || '').toLowerCase();
  if (type === 'HDD') return 'SATA';
  if (/\b(nvme|pcie|optane)\b/.test(t) || /\bm\.?\s*2\b/.test(t) || /\bu\.?\s*2\b/.test(t)) return 'NVMe';
  if (/\b(sata|2\.5"?|m\.?\s*sata)\b/.test(t)) return 'SATA';

  // Known SATA product families (no M.2 / NVMe in the name)
  if (/\b(870|860|850|840|830|750)\s*(evo|pro|qvo)\b/.test(t)) return 'SATA';
  if (/\b(mx\d{3}|bx\d{3}|bx500|mx500|mx300|mx200|mx100|m550|m500|m4\b)\b/.test(t)) return 'SATA';
  if (/\b(su\d{3}|sp\d{3}|ultimate su)\b/.test(t)) return 'SATA';
  if (/\b(vector|vertex|arc\s*\d+|vtx|octane|agility|neutron|force\s*gt|force\s*ls)\b/.test(t)) return 'SATA';
  if (/\b(ultra\s*3d|extreme\s*pro|extreme\s*ii|ultra\s*ii|ssd\s*plus)\b/.test(t)) return 'SATA';
  if (/\b(blue\s*3d|green\s*3d|s[46]\d{2}|s700)\b/.test(t)) return 'SATA';
  if (/\b(545s|730\s*series|530\s*series|320\s*series)\b/.test(t)) return 'SATA';
  if (/\b(m6\s*pro|m6v|m5\s*pro|m3)\b/.test(t)) return 'SATA';
  if (/\b(tr200|tr100|gt500|gt510|q300|cs2211|vt180)\b/.test(t)) return 'SATA';
  if (/\b(radeon\s*r7|premium\s*edition)\b/.test(t)) return 'SATA';

  // Known NVMe families that omit “NVMe” in the CSV model string
  if (/\b(990|980|970|960|950)\s*(pro|evo)\b/.test(t)) return 'NVMe';
  if (/\b(sn\d{3,4}|black\s*sn)\b/.test(t)) return 'NVMe';
  if (/\b(t\d{3}|p\d\s*plus|p5|p3|a2000|rocket|mp\d{3}|force\s*mp)\b/.test(t)) return 'NVMe';
  if (/\b(nm\d{3,4}|nm620|nm790|kc3000|kc2500|kc2000|nv1|nv2)\b/.test(t)) return 'NVMe';
  if (/\b(905p|900p|660p|760p|600p)\b/.test(t)) return 'NVMe';

  // Score-based fallback: UserBenchmark effective speed (850 Pro ≈ 100)
  // Consumer SATA tops out ~110–130; modern NVMe starts well above that.
  const bench = Number(benchmark);
  if (Number.isFinite(bench)) {
    if (bench >= 160) return 'NVMe';
    if (bench <= 130) return 'SATA';
  }

  return 'Other';
}

function detectFormFactor(model, iface) {
  const t = String(model || '').toLowerCase();
  if (/\bu\.?\s*2\b/.test(t)) return 'U.2';
  if (/\bm\.?\s*2\b/.test(t)) return 'M.2';
  if (/\bm\.?\s*sata\b/.test(t)) return 'mSATA';
  if (/\b2\.5"?\b/.test(t)) return '2.5"';
  if (/\b3\.5"?\b/.test(t)) return '3.5"';
  if (iface === 'NVMe') return 'M.2';
  if (iface === 'SATA') return '2.5"';
  return 'Unknown';
}

function detectFamily(brand, model) {
  let name = String(model || '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b\d+(?:\.\d+)?\s*(TB|GB)\b/gi, '')
    .replace(/\b(NVMe|PCIe|SATA|M\.?\s*2|U\.?\s*2|2\.5"?|3\.5"?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/[-–—]\s*$/, '').trim();
  if (!name) name = String(model || '').trim();
  const b = String(brand || '').trim();
  if (b && !name.toLowerCase().startsWith(b.toLowerCase())) {
    return `${b} ${name}`.trim();
  }
  return name || b || 'Unknown';
}

function detectPcieGen(model, iface) {
  if (iface !== 'NVMe') return null;
  const t = String(model || '').toLowerCase();
  if (/gen\s*5|pcie\s*5|phison\s*e26|t700|t705|t710|9100|sn8100|nm1090|mp700|force\s*mp700/i.test(t)) return '5.0';
  if (/gen\s*4|pcie\s*4|sn850|sn770|sn7100|990\s*pro|980\s*pro|t500|t600|p5\s*plus|rocket\s*4|mp600/i.test(t)) return '4.0';
  if (/gen\s*3|pcie\s*3|970\s*evo|960\s*evo|950\s*pro|sn750|sn550|a2000|p1\b|p3\b/i.test(t)) return '3.0';
  return null;
}

function yearFromModel(model) {
  const m = String(model || '').match(/\((20\d{2})\)/);
  return m ? Number(m[1]) : null;
}

function normalizeBrand(brand) {
  const raw = String(brand || '').trim();
  if (!raw) return 'Unknown';
  const map = {
    sandisk: 'SanDisk',
    wd: 'WD',
    adata: 'ADATA',
    hgst: 'HGST',
    seagate: 'Seagate',
    toshiba: 'Toshiba',
    samsung: 'Samsung',
    crucial: 'Crucial',
    kingston: 'Kingston',
    corsair: 'Corsair',
    intel: 'Intel',
    micron: 'Micron',
    mushkin: 'Mushkin',
    patriot: 'Patriot',
    pny: 'PNY',
    lexar: 'Lexar',
    team: 'TeamGroup',
    'teamgroup': 'TeamGroup',
    skhynix: 'SK hynix',
    'sk hynix': 'SK hynix',
    liteonit: 'Lite-On',
    'lite-on': 'Lite-On',
    ocz: 'OCZ',
    apple: 'Apple',
    hp: 'HP',
    dell: 'Dell',
  };
  const key = raw.toLowerCase();
  return map[key] || raw;
}

function buildDrive(row, kind) {
  const brand = normalizeBrand(row.Brand);
  const model = String(row.Model || '').replace(/\s+/g, ' ').trim();
  if (!model || model.length > 120 || /,https?:\/\//i.test(model) || /\bHDD,|\bSSD,/i.test(model)) return null;
  const benchmark = Number(row.Benchmark);
  const rank = Number(row.Rank);
  const samples = Number(row.Samples);
  if (!Number.isFinite(benchmark)) return null;

  const capacityGb = parseCapacityGb(model);
  const iface = detectInterface(model, kind, benchmark);
  const formFactor = detectFormFactor(model, iface);
  const family = detectFamily(brand, model);
  const pcie = detectPcieGen(model, iface);
  const releaseYear = yearFromModel(model);
  const partNumber = String(row['Part Number'] || '').trim() || null;
  const url = String(row.URL || '').trim() || null;

  const idBase = slugify(`${brand}-${model}`) || slugify(model) || 'drive';
  const displayName = brand && brand !== 'Unknown' && !model.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} ${model}`
    : model;

  return {
    id: idBase,
    name: displayName,
    brand,
    model,
    family,
    series: kind === 'HDD' ? brand : iface,
    interface: iface,
    formFactor,
    capacityGb,
    pcie,
    releaseYear,
    rank: Number.isFinite(rank) ? rank : null,
    relativeEffective: Math.round(benchmark * 10) / 10,
    samples: Number.isFinite(samples) ? samples : 0,
    partNumber,
    partNumbers: partNumber ? [partNumber] : [],
    url,
    source: 'userbenchmark-csv',
  };
}

function mergeDrives(rows, kind) {
  const byKey = new Map();
  for (const row of rows) {
    const drive = buildDrive(row, kind);
    if (!drive) continue;
    // Prefer URL as merge key; fall back to brand+model+rank
    const key = drive.url
      || `${drive.brand}|${drive.model}|${drive.rank}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, drive);
      continue;
    }
    if (drive.partNumber && !existing.partNumbers.includes(drive.partNumber)) {
      existing.partNumbers.push(drive.partNumber);
    }
    if ((drive.samples || 0) > (existing.samples || 0)) {
      existing.samples = drive.samples;
    }
    if (!existing.partNumber && drive.partNumber) existing.partNumber = drive.partNumber;
  }

  // Ensure unique ids
  const used = new Map();
  const list = [...byKey.values()].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
  for (const drive of list) {
    let id = drive.id;
    if (used.has(id)) {
      const suffix = drive.capacityGb ? `-${drive.capacityGb}gb` : `-${drive.rank || used.get(id) + 1}`;
      id = slugify(`${drive.id}${suffix}`);
      let n = 2;
      while (used.has(id)) {
        id = slugify(`${drive.id}${suffix}-${n}`);
        n += 1;
      }
    }
    used.set(id, true);
    drive.id = id;
  }
  return list;
}

function findBaseline(drives, preferNames) {
  for (const needle of preferNames) {
    const hit = drives.find(d => {
      const name = d.name.toLowerCase();
      return name === needle.toLowerCase() || name.startsWith(needle.toLowerCase());
    });
    if (hit) return hit.id;
  }
  for (const needle of preferNames) {
    const hit = drives.find(d => d.name.toLowerCase().includes(needle.toLowerCase()));
    if (hit) return hit.id;
  }
  // Prefer highest sample count among mid-pack consumer drives
  const popular = [...drives].sort((a, b) => (b.samples || 0) - (a.samples || 0))[0];
  return popular?.id || drives[0]?.id || '';
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const shouldDownload = process.argv.includes('--download');
  fs.mkdirSync(RAW, { recursive: true });

  for (const [key, src] of Object.entries(SOURCES)) {
    if (shouldDownload || !fs.existsSync(src.file)) {
      process.stdout.write(`Downloading ${key.toUpperCase()} CSV… `);
      await download(src.url, src.file);
      console.log('ok');
    }
  }

  const ssdRows = parseCsv(fs.readFileSync(SOURCES.ssd.file, 'utf8'));
  const hddRows = parseCsv(fs.readFileSync(SOURCES.hdd.file, 'utf8'));
  const ssds = mergeDrives(ssdRows, 'SSD');
  const hdds = mergeDrives(hddRows, 'HDD');

  const today = new Date().toISOString().slice(0, 10);
  const ssdBaseline = findBaseline(ssds, [
    'samsung 850 pro 256gb',
    'samsung 850 pro 512gb',
    'samsung 850 pro 1tb',
    '850 pro',
  ]);
  const hddBaseline = findBaseline(hdds, [
    'Seagate Barracuda 1TB (2016)',
    'Seagate Barracuda 2TB (2016)',
    'WD Blue 1TB (2012)',
    'Seagate Barracuda 7200.14 1TB',
  ]);

  writeJson(OUT_SSD, {
    version: 1,
    baselineId: ssdBaseline,
    updatedAt: today,
    source: 'userbenchmark-csv',
    sourceUrl: SOURCES.ssd.url,
    note: 'Effective speed from UserBenchmark (Samsung 850 Pro ≈ 100). Interface/form factor/family inferred from model names. Part numbers merged when the same model has multiple SKUs.',
    count: ssds.length,
    interfaces: [...new Set(ssds.map(d => d.interface))].sort(),
    brands: [...new Set(ssds.map(d => d.brand))].sort(),
    ssds,
  });

  writeJson(OUT_HDD, {
    version: 1,
    baselineId: hddBaseline,
    updatedAt: today,
    source: 'userbenchmark-csv',
    sourceUrl: SOURCES.hdd.url,
    note: 'Effective speed from UserBenchmark HDD chart. Capacity/family inferred from model names.',
    count: hdds.length,
    brands: [...new Set(hdds.map(d => d.brand))].sort(),
    hdds,
  });

  const nvme = ssds.filter(d => d.interface === 'NVMe').length;
  const sata = ssds.filter(d => d.interface === 'SATA').length;
  console.log(`SSD: ${ssds.length} unique (${nvme} NVMe / ${sata} SATA / ${ssds.length - nvme - sata} other) → ${OUT_SSD}`);
  console.log(`HDD: ${hdds.length} unique → ${OUT_HDD}`);
  console.log(`Baselines: SSD=${ssdBaseline} · HDD=${hddBaseline}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
