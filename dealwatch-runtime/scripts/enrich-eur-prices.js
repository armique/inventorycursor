/**
 * Adds launchPriceEur + marketPriceEur (used/street) to GPU and CPU DBs.
 * Launch: USD→EUR (~0.92) or existing EUR. Dealwatch: curated used DE/EU estimates.
 */
const fs = require('node:fs');
const path = require('node:path');

const USD_EUR = 0.92;
const DATA = path.join(__dirname, '..', 'data');

/** Curated used/street EUR estimates (Germany/EU, approx mid-2026). */
const GPU_MARKET = {
  'gtx-980': 45,
  'gtx-980-ti': 55,
  'gtx-1060-6gb': 50,
  'gtx-1070': 65,
  'gtx-1070-ti': 75,
  'gtx-1080': 80,
  'gtx-1080-ti': 110,
  'rtx-2060': 95,
  'rtx-2060-super': 110,
  'rtx-2070': 120,
  'rtx-2070-super': 135,
  'rtx-2080': 145,
  'rtx-2080-super': 155,
  'rtx-2080-ti': 190,
  'rtx-3060': 160,
  'rtx-3060-ti': 185,
  'rtx-3070': 210,
  'rtx-3070-ti': 230,
  'rtx-3080-10gb': 280,
  'rtx-3080-ti': 320,
  'rtx-3090': 420,
  'rtx-4060': 240,
  'rtx-4060-ti-8gb': 280,
  'rtx-4070': 360,
  'rtx-4070-super': 400,
  'rtx-4070-ti': 430,
  'rtx-4080': 620,
  'rtx-4080-super': 650,
  'rtx-4090': 1100,
  'rtx-5060': 290,
  'rtx-5070': 520,
  'rtx-5070-ti': 650,
  'rtx-5080': 850,
  'rtx-5090': 1900,
};

const CPU_MARKET = {
  'ryzen-5-1600': 35,
  'ryzen-5-3600': 55,
  'ryzen-5-5600x': 95,
  'ryzen-5-5600': 85,
  'ryzen-7-5700x': 120,
  'ryzen-7-5800x3d': 180,
  'ryzen-5-7600x': 160,
  'ryzen-7-7800x3d': 320,
  'ryzen-5-9600x': 210,
  'ryzen-7-9800x3d': 450,
  'core-i5-6500': 25,
  'core-i7-6700k': 40,
  'core-i5-8400': 40,
  'core-i7-8700k': 70,
  'core-i5-9600k': 55,
  'core-i9-9900k': 110,
  'core-i5-10400f': 55,
  'core-i7-10700k': 110,
  'core-i5-12400f': 95,
  'core-i5-12600k': 140,
  'core-i7-12700k': 180,
  'core-i9-12900k': 240,
  'core-i5-13400f': 130,
  'core-i5-13600k': 200,
  'core-i7-13700k': 250,
  'core-i9-13900k': 360,
  'core-i5-14600k': 220,
  'core-i7-14700k': 290,
  'core-i9-14900k': 400,
  'core-ultra-5-245k': 250,
  'core-ultra-7-265k': 330,
  'core-ultra-9-285k': 520,
};

function toEur(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * USD_EUR);
}

function gpuMarket(gpu) {
  if (GPU_MARKET[gpu.id] != null) return GPU_MARKET[gpu.id];
  const score = Number(gpu.relativeRaster) || 100;
  const age = Math.max(0, 2026 - (Number(gpu.releaseYear) || 2018));
  const ageFactor = Math.max(0.35, 1 - age * 0.07);
  return Math.max(25, Math.round(score * 1.05 * ageFactor));
}

function cpuMarket(cpu) {
  if (CPU_MARKET[cpu.id] != null) return CPU_MARKET[cpu.id];
  const score = Number(cpu.relativeMulti) || 100;
  const age = Math.max(0, 2026 - (Number(cpu.releaseYear) || 2018));
  const ageFactor = Math.max(0.3, 1 - age * 0.08);
  return Math.max(20, Math.round(score * 0.55 * ageFactor));
}

function enrichGpu() {
  const file = path.join(DATA, 'gpu-specs.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  db.gpus = (db.gpus || []).map(gpu => {
    const launchPriceEur = gpu.launchPriceEur ?? toEur(gpu.launchPriceUsd);
    const marketPriceEur = gpu.marketPriceEur ?? gpuMarket(gpu);
    const next = { ...gpu, launchPriceEur, marketPriceEur };
    delete next.launchPriceUsd;
    return next;
  });
  db.note = `${db.note || ''} Prices in EUR: launch ≈ original MSRP, used Dealwatch ≈ typical eBay.de/street used (approx).`.trim();
  db.updatedAt = '2026-07-24';
  fs.writeFileSync(file, `${JSON.stringify(db, null, 2)}\n`);
  console.log(`GPUs enriched: ${db.gpus.length}`);
}

function enrichCpu() {
  const file = path.join(DATA, 'cpu-specs.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  db.cpus = (db.cpus || []).map(cpu => {
    const launchPriceEur = cpu.launchPriceEur ?? toEur(cpu.launchPriceUsd ?? cpu.launchPriceUsd);
    // generator stored launchPriceUsd from `price` field
    const fromUsd = toEur(cpu.launchPriceUsd);
    const launch = launchPriceEur ?? fromUsd;
    const marketPriceEur = cpu.marketPriceEur ?? cpuMarket(cpu);
    const next = { ...cpu, launchPriceEur: launch, marketPriceEur };
    delete next.launchPriceUsd;
    return next;
  });
  db.note = `${(db.note || '').replace(/\s*Prices in EUR:.*/, '')} Prices in EUR: launch ≈ original MSRP, used Dealwatch ≈ typical eBay.de/street used (approx).`.trim();
  db.updatedAt = '2026-07-24';
  fs.writeFileSync(file, `${JSON.stringify(db, null, 2)}\n`);
  console.log(`CPUs enriched: ${db.cpus.length}`);
}

enrichGpu();
enrichCpu();
