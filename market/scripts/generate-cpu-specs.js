/**
 * Generates data/cpu-specs.json — curated desktop CPUs for AM4, AM5, Intel 6–15.
 * Relative indices: Ryzen 5 1600 = 100 (single + multi). Approximate gaming/CB-style.
 */
const fs = require('node:fs');
const path = require('node:path');

function cpu(partial) {
  const id = partial.id || String(partial.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    id,
    brand: partial.brand,
    name: partial.name,
    series: partial.series,
    socket: partial.socket,
    architecture: partial.architecture,
    generation: partial.generation,
    releaseYear: partial.releaseYear,
    processNm: partial.processNm,
    cores: partial.cores,
    threads: partial.threads,
    baseClockGhz: partial.base,
    boostClockGhz: partial.boost,
    l3CacheMb: partial.l3,
    tdpW: partial.tdp,
    memoryType: partial.memoryType,
    memoryChannels: partial.channels || 2,
    maxMemoryMhz: partial.memMhz || null,
    igpu: partial.igpu ?? false,
    pcie: partial.pcie,
    unlocked: partial.unlocked ?? false,
    launchPriceEur: partial.price ?? null,
    marketPriceEur: partial.market ?? null,
    relativeSingle: partial.st,
    relativeMulti: partial.mt,
    approx: partial.approx || false,
  };
}

const cpus = [];

// —— AMD AM4 ——
const am4 = (name, series, arch, year, nm, cores, threads, base, boost, l3, tdp, st, mt, extra = {}) =>
  cpus.push(cpu({
    brand: 'AMD', name, series, socket: 'AM4', architecture: arch, generation: series,
    releaseYear: year, processNm: nm, cores, threads, base, boost, l3, tdp,
    memoryType: 'DDR4', memMhz: extra.memMhz || 3200, igpu: !!extra.igpu,
    pcie: extra.pcie || '3.0 x16', unlocked: extra.unlocked !== false, price: extra.price, st, mt, approx: extra.approx,
  }));

// Ryzen 1000 (Zen)
am4('Ryzen 3 1200', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 4, 4, 3.1, 3.4, 8, 65, 95, 70, { price: 109 });
am4('Ryzen 3 1300X', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 4, 4, 3.5, 3.7, 8, 65, 102, 75, { price: 129 });
am4('Ryzen 5 1400', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 4, 8, 3.2, 3.4, 8, 65, 98, 95, { price: 169 });
am4('Ryzen 5 1500X', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 4, 8, 3.5, 3.7, 16, 65, 105, 105, { price: 189 });
am4('Ryzen 5 1600', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 6, 12, 3.2, 3.6, 16, 65, 100, 100, { price: 219 });
am4('Ryzen 5 1600X', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 6, 12, 3.6, 4.0, 16, 95, 108, 108, { price: 249 });
am4('Ryzen 7 1700', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 8, 16, 3.0, 3.7, 16, 65, 102, 130, { price: 329 });
am4('Ryzen 7 1700X', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 8, 16, 3.4, 3.8, 16, 95, 106, 138, { price: 399 });
am4('Ryzen 7 1800X', 'AM4 Ryzen 1000', 'Zen', 2017, 14, 8, 16, 3.6, 4.0, 16, 95, 112, 145, { price: 499 });

// Ryzen 2000 (Zen+ / Raven Ridge)
am4('Ryzen 3 2200G', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 4, 4, 3.5, 3.7, 4, 65, 108, 78, { igpu: true, price: 99 });
am4('Ryzen 5 2400G', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 4, 8, 3.6, 3.9, 4, 65, 112, 110, { igpu: true, price: 169 });
am4('Ryzen 5 2600', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 6, 12, 3.4, 3.9, 16, 65, 112, 115, { price: 199 });
am4('Ryzen 5 2600X', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 6, 12, 3.6, 4.2, 16, 95, 120, 122, { price: 229 });
am4('Ryzen 7 2700', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 8, 16, 3.2, 4.1, 16, 65, 115, 150, { price: 299 });
am4('Ryzen 7 2700X', 'AM4 Ryzen 2000', 'Zen+', 2018, 12, 8, 16, 3.7, 4.3, 16, 105, 125, 162, { price: 329 });

// Ryzen 3000 (Zen 2) + 3000G
am4('Ryzen 3 3100', 'AM4 Ryzen 3000', 'Zen 2', 2020, 7, 4, 8, 3.6, 3.9, 16, 65, 128, 125, { pcie: '4.0 x16', price: 99 });
am4('Ryzen 3 3300X', 'AM4 Ryzen 3000', 'Zen 2', 2020, 7, 4, 8, 3.8, 4.3, 16, 65, 138, 135, { pcie: '4.0 x16', price: 120 });
am4('Ryzen 3 3200G', 'AM4 Ryzen 3000', 'Zen+', 2019, 12, 4, 4, 3.6, 4.0, 4, 65, 115, 82, { igpu: true, price: 99 });
am4('Ryzen 5 3400G', 'AM4 Ryzen 3000', 'Zen+', 2019, 12, 4, 8, 3.7, 4.2, 4, 65, 120, 118, { igpu: true, price: 149 });
am4('Ryzen 5 3600', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 6, 12, 3.6, 4.2, 32, 65, 140, 155, { pcie: '4.0 x16', price: 199 });
am4('Ryzen 5 3600X', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 6, 12, 3.8, 4.4, 32, 95, 145, 160, { pcie: '4.0 x16', price: 249 });
am4('Ryzen 5 3600XT', 'AM4 Ryzen 3000', 'Zen 2', 2020, 7, 6, 12, 3.8, 4.5, 32, 95, 148, 162, { pcie: '4.0 x16', price: 249 });
am4('Ryzen 7 3700X', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 8, 16, 3.6, 4.4, 32, 65, 145, 205, { pcie: '4.0 x16', price: 329 });
am4('Ryzen 7 3800X', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 8, 16, 3.9, 4.5, 32, 105, 150, 215, { pcie: '4.0 x16', price: 399 });
am4('Ryzen 7 3800XT', 'AM4 Ryzen 3000', 'Zen 2', 2020, 7, 8, 16, 3.9, 4.7, 32, 105, 155, 220, { pcie: '4.0 x16', price: 399 });
am4('Ryzen 9 3900X', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 12, 24, 3.8, 4.6, 64, 105, 152, 300, { pcie: '4.0 x16', price: 499 });
am4('Ryzen 9 3900XT', 'AM4 Ryzen 3000', 'Zen 2', 2020, 7, 12, 24, 3.8, 4.7, 64, 105, 156, 305, { pcie: '4.0 x16', price: 499 });
am4('Ryzen 9 3950X', 'AM4 Ryzen 3000', 'Zen 2', 2019, 7, 16, 32, 3.5, 4.7, 64, 105, 150, 380, { pcie: '4.0 x16', price: 749 });

// Ryzen 4000G (Renoir)
am4('Ryzen 3 4300G', 'AM4 Ryzen 4000G', 'Zen 2', 2020, 7, 4, 8, 3.8, 4.0, 4, 65, 135, 130, { igpu: true, pcie: '3.0 x16', price: 99 });
am4('Ryzen 5 4600G', 'AM4 Ryzen 4000G', 'Zen 2', 2020, 7, 6, 12, 3.7, 4.2, 8, 65, 140, 160, { igpu: true, pcie: '3.0 x16', price: 154 });
am4('Ryzen 7 4700G', 'AM4 Ryzen 4000G', 'Zen 2', 2020, 7, 8, 16, 3.6, 4.4, 8, 65, 145, 210, { igpu: true, pcie: '3.0 x16', price: 229 });

// Ryzen 5000 (Zen 3) + 5000G
am4('Ryzen 5 5500', 'AM4 Ryzen 5000', 'Zen 3', 2022, 7, 6, 12, 3.6, 4.2, 16, 65, 155, 175, { pcie: '3.0 x16', price: 159 });
am4('Ryzen 5 5600', 'AM4 Ryzen 5000', 'Zen 3', 2022, 7, 6, 12, 3.5, 4.4, 32, 65, 168, 190, { pcie: '4.0 x16', price: 199 });
am4('Ryzen 5 5600X', 'AM4 Ryzen 5000', 'Zen 3', 2020, 7, 6, 12, 3.7, 4.6, 32, 65, 175, 198, { pcie: '4.0 x16', price: 299 });
am4('Ryzen 5 5600G', 'AM4 Ryzen 5000G', 'Zen 3', 2021, 7, 6, 12, 3.9, 4.4, 16, 65, 165, 185, { igpu: true, pcie: '3.0 x16', price: 259 });
am4('Ryzen 7 5700X', 'AM4 Ryzen 5000', 'Zen 3', 2022, 7, 8, 16, 3.4, 4.6, 32, 65, 172, 255, { pcie: '4.0 x16', price: 299 });
am4('Ryzen 7 5700G', 'AM4 Ryzen 5000G', 'Zen 3', 2021, 7, 8, 16, 3.8, 4.6, 16, 65, 168, 245, { igpu: true, pcie: '3.0 x16', price: 359 });
am4('Ryzen 7 5700X3D', 'AM4 Ryzen 5000', 'Zen 3', 2024, 7, 8, 16, 3.0, 4.1, 96, 105, 160, 240, { pcie: '4.0 x16', price: 249 });
am4('Ryzen 7 5800X', 'AM4 Ryzen 5000', 'Zen 3', 2020, 7, 8, 16, 3.8, 4.7, 32, 105, 180, 265, { pcie: '4.0 x16', price: 449 });
am4('Ryzen 7 5800X3D', 'AM4 Ryzen 5000', 'Zen 3', 2022, 7, 8, 16, 3.4, 4.5, 96, 105, 185, 255, { pcie: '4.0 x16', price: 449 });
am4('Ryzen 9 5900X', 'AM4 Ryzen 5000', 'Zen 3', 2020, 7, 12, 24, 3.7, 4.8, 64, 105, 182, 380, { pcie: '4.0 x16', price: 549 });
am4('Ryzen 9 5950X', 'AM4 Ryzen 5000', 'Zen 3', 2020, 7, 16, 32, 3.4, 4.9, 64, 105, 180, 480, { pcie: '4.0 x16', price: 799 });

// —— AMD AM5 ——
const am5 = (name, series, arch, year, nm, cores, threads, base, boost, l3, tdp, st, mt, extra = {}) =>
  cpus.push(cpu({
    brand: 'AMD', name, series, socket: 'AM5', architecture: arch, generation: series,
    releaseYear: year, processNm: nm, cores, threads, base, boost, l3, tdp,
    memoryType: 'DDR5', memMhz: extra.memMhz || 5200, igpu: extra.igpu !== false,
    pcie: '5.0 x16', unlocked: true, price: extra.price, st, mt, approx: extra.approx,
  }));

am5('Ryzen 5 7500F', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 6, 12, 3.7, 5.0, 32, 65, 200, 230, { igpu: false, price: 179 });
am5('Ryzen 5 7600', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 6, 12, 3.8, 5.1, 32, 65, 205, 235, { price: 229 });
am5('Ryzen 5 7600X', 'AM5 Ryzen 7000', 'Zen 4', 2022, 5, 6, 12, 4.7, 5.3, 32, 105, 215, 245, { price: 299 });
am5('Ryzen 7 7700', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 8, 16, 3.8, 5.3, 32, 65, 210, 310, { price: 329 });
am5('Ryzen 7 7700X', 'AM5 Ryzen 7000', 'Zen 4', 2022, 5, 8, 16, 4.5, 5.4, 32, 105, 218, 320, { price: 399 });
am5('Ryzen 7 7800X3D', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 8, 16, 4.2, 5.0, 96, 120, 210, 300, { price: 449 });
am5('Ryzen 9 7900', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 12, 24, 3.7, 5.4, 64, 65, 212, 450, { price: 429 });
am5('Ryzen 9 7900X', 'AM5 Ryzen 7000', 'Zen 4', 2022, 5, 12, 24, 4.7, 5.6, 64, 170, 222, 470, { price: 549 });
am5('Ryzen 9 7900X3D', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 12, 24, 4.4, 5.6, 128, 120, 215, 455, { price: 599 });
am5('Ryzen 9 7950X', 'AM5 Ryzen 7000', 'Zen 4', 2022, 5, 16, 32, 4.5, 5.7, 64, 170, 225, 600, { price: 699 });
am5('Ryzen 9 7950X3D', 'AM5 Ryzen 7000', 'Zen 4', 2023, 5, 16, 32, 4.2, 5.7, 128, 120, 218, 575, { price: 699 });

am5('Ryzen 5 8500G', 'AM5 Ryzen 8000G', 'Zen 4', 2024, 4, 6, 12, 3.5, 5.0, 16, 65, 195, 220, { memMhz: 5200, price: 229 });
am5('Ryzen 5 8600G', 'AM5 Ryzen 8000G', 'Zen 4', 2024, 4, 6, 12, 4.3, 5.0, 16, 65, 200, 225, { price: 229 });
am5('Ryzen 7 8700G', 'AM5 Ryzen 8000G', 'Zen 4', 2024, 4, 8, 16, 4.2, 5.1, 16, 65, 205, 295, { price: 329 });

am5('Ryzen 5 9600X', 'AM5 Ryzen 9000', 'Zen 5', 2024, 4, 6, 12, 3.9, 5.4, 32, 65, 235, 265, { price: 279 });
am5('Ryzen 7 9700X', 'AM5 Ryzen 9000', 'Zen 5', 2024, 4, 8, 16, 3.8, 5.5, 32, 65, 238, 340, { price: 359 });
am5('Ryzen 7 9800X3D', 'AM5 Ryzen 9000', 'Zen 5', 2024, 4, 8, 16, 4.7, 5.2, 96, 120, 230, 325, { price: 479 });
am5('Ryzen 9 9900X', 'AM5 Ryzen 9000', 'Zen 5', 2024, 4, 12, 24, 4.4, 5.6, 64, 120, 242, 500, { price: 499 });
am5('Ryzen 9 9900X3D', 'AM5 Ryzen 9000', 'Zen 5', 2025, 4, 12, 24, 4.4, 5.5, 128, 120, 235, 480, { price: 599, approx: true });
am5('Ryzen 9 9950X', 'AM5 Ryzen 9000', 'Zen 5', 2024, 4, 16, 32, 4.3, 5.7, 64, 170, 245, 640, { price: 649 });
am5('Ryzen 9 9950X3D', 'AM5 Ryzen 9000', 'Zen 5', 2025, 4, 16, 32, 4.3, 5.7, 128, 170, 240, 620, { price: 699, approx: true });

// —— Intel desktop helpers ——
function intel(name, genLabel, arch, socket, year, nm, cores, threads, base, boost, l3, tdp, st, mt, extra = {}) {
  cpus.push(cpu({
    brand: 'Intel',
    name,
    series: genLabel,
    socket,
    architecture: arch,
    generation: genLabel,
    releaseYear: year,
    processNm: nm,
    cores,
    threads,
    base,
    boost,
    l3,
    tdp,
    memoryType: extra.memoryType || 'DDR4',
    memMhz: extra.memMhz || 2666,
    channels: 2,
    igpu: extra.igpu !== false,
    pcie: extra.pcie || '3.0 x16',
    unlocked: !!extra.unlocked,
    price: extra.price,
    st,
    mt,
    approx: extra.approx,
  }));
}

// Gen 6 Skylake — LGA 1151
intel('Core i3-6100', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 2, 4, 3.7, 3.7, 3, 51, 95, 55, { memMhz: 2133, price: 117 });
intel('Core i3-6300', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 2, 4, 3.8, 3.8, 4, 51, 98, 58, { memMhz: 2133, price: 147 });
intel('Core i5-6400', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 4, 2.7, 3.3, 6, 65, 90, 72, { memMhz: 2133, price: 182 });
intel('Core i5-6500', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 4, 3.2, 3.6, 6, 65, 98, 80, { memMhz: 2133, price: 202 });
intel('Core i5-6600', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 4, 3.3, 3.9, 6, 65, 105, 85, { memMhz: 2133, price: 224 });
intel('Core i5-6600K', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 4, 3.5, 3.9, 6, 91, 108, 88, { unlocked: true, memMhz: 2133, price: 243 });
intel('Core i7-6700', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 8, 3.4, 4.0, 8, 65, 110, 115, { memMhz: 2133, price: 303 });
intel('Core i7-6700K', 'Intel 6th', 'Skylake', 'LGA 1151', 2015, 14, 4, 8, 4.0, 4.2, 8, 91, 118, 125, { unlocked: true, memMhz: 2133, price: 350 });

// Gen 7 Kaby Lake
intel('Core i3-7100', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 2, 4, 3.9, 3.9, 3, 51, 105, 60, { memMhz: 2400, price: 117 });
intel('Core i3-7300', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 2, 4, 4.0, 4.0, 4, 51, 108, 62, { memMhz: 2400, price: 147 });
intel('Core i5-7400', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 4, 3.0, 3.5, 6, 65, 100, 82, { memMhz: 2400, price: 182 });
intel('Core i5-7500', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 4, 3.4, 3.8, 6, 65, 108, 88, { memMhz: 2400, price: 202 });
intel('Core i5-7600', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 4, 3.5, 4.1, 6, 65, 114, 92, { memMhz: 2400, price: 224 });
intel('Core i5-7600K', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 4, 3.8, 4.2, 6, 91, 118, 95, { unlocked: true, memMhz: 2400, price: 242 });
intel('Core i7-7700', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 8, 3.6, 4.2, 8, 65, 120, 128, { memMhz: 2400, price: 303 });
intel('Core i7-7700K', 'Intel 7th', 'Kaby Lake', 'LGA 1151', 2017, 14, 4, 8, 4.2, 4.5, 8, 91, 128, 138, { unlocked: true, memMhz: 2400, price: 339 });

// Gen 8 Coffee Lake
intel('Core i3-8100', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 4, 4, 3.6, 3.6, 6, 65, 112, 95, { memMhz: 2400, price: 117 });
intel('Core i3-8350K', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 4, 4, 4.0, 4.0, 8, 91, 122, 102, { unlocked: true, memMhz: 2400, price: 168 });
intel('Core i5-8400', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 6, 6, 2.8, 4.0, 9, 65, 118, 130, { memMhz: 2666, price: 182 });
intel('Core i5-8500', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2018, 14, 6, 6, 3.0, 4.1, 9, 65, 122, 135, { memMhz: 2666, price: 202 });
intel('Core i5-8600', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2018, 14, 6, 6, 3.1, 4.3, 9, 65, 128, 140, { memMhz: 2666, price: 213 });
intel('Core i5-8600K', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 6, 6, 3.6, 4.3, 9, 95, 132, 145, { unlocked: true, memMhz: 2666, price: 257 });
intel('Core i7-8700', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 6, 12, 3.2, 4.6, 12, 65, 138, 185, { memMhz: 2666, price: 303 });
intel('Core i7-8700K', 'Intel 8th', 'Coffee Lake', 'LGA 1151', 2017, 14, 6, 12, 3.7, 4.7, 12, 95, 145, 195, { unlocked: true, memMhz: 2666, price: 359 });

// Gen 9 Coffee Lake Refresh
intel('Core i3-9100', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2018, 14, 4, 4, 3.6, 4.2, 6, 65, 120, 105, { memMhz: 2400, price: 122 });
intel('Core i3-9100F', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 4, 4, 3.6, 4.2, 6, 65, 120, 105, { igpu: false, memMhz: 2400, price: 97 });
intel('Core i3-9350K', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 4, 4, 4.0, 4.6, 8, 91, 132, 112, { unlocked: true, memMhz: 2400, price: 173 });
intel('Core i5-9400', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 6, 6, 2.9, 4.1, 9, 65, 125, 138, { memMhz: 2666, price: 182 });
intel('Core i5-9400F', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 6, 6, 2.9, 4.1, 9, 65, 125, 138, { igpu: false, memMhz: 2666, price: 157 });
intel('Core i5-9600', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 6, 6, 3.1, 4.6, 9, 65, 138, 148, { memMhz: 2666, price: 213 });
intel('Core i5-9600K', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2018, 14, 6, 6, 3.7, 4.6, 9, 95, 142, 152, { unlocked: true, memMhz: 2666, price: 262 });
intel('Core i5-9600KF', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 6, 6, 3.7, 4.6, 9, 95, 142, 152, { unlocked: true, igpu: false, memMhz: 2666, price: 237 });
intel('Core i7-9700', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 8, 8, 3.0, 4.7, 12, 65, 145, 175, { memMhz: 2666, price: 323 });
intel('Core i7-9700K', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2018, 14, 8, 8, 3.6, 4.9, 12, 95, 155, 188, { unlocked: true, memMhz: 2666, price: 374 });
intel('Core i7-9700KF', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 8, 8, 3.6, 4.9, 12, 95, 155, 188, { unlocked: true, igpu: false, memMhz: 2666, price: 349 });
intel('Core i9-9900', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 8, 16, 3.1, 5.0, 16, 65, 152, 235, { memMhz: 2666, price: 439 });
intel('Core i9-9900K', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2018, 14, 8, 16, 3.6, 5.0, 16, 95, 158, 245, { unlocked: true, memMhz: 2666, price: 488 });
intel('Core i9-9900KF', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 8, 16, 3.6, 5.0, 16, 95, 158, 245, { unlocked: true, igpu: false, memMhz: 2666, price: 463 });
intel('Core i9-9900KS', 'Intel 9th', 'Coffee Lake R', 'LGA 1151', 2019, 14, 8, 16, 4.0, 5.0, 16, 127, 162, 250, { unlocked: true, memMhz: 2666, price: 513 });

// Gen 10 Comet Lake — LGA 1200
intel('Core i3-10100', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 4, 8, 3.6, 4.3, 6, 65, 138, 145, { memMhz: 2666, pcie: '3.0 x16', price: 122 });
intel('Core i3-10100F', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 4, 8, 3.6, 4.3, 6, 65, 138, 145, { igpu: false, memMhz: 2666, price: 79 });
intel('Core i3-10300', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 4, 8, 3.7, 4.4, 8, 65, 142, 150, { memMhz: 2666, price: 143 });
intel('Core i3-10320', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 4, 8, 3.8, 4.6, 8, 65, 148, 155, { memMhz: 2666, price: 154 });
intel('Core i5-10400', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 2.9, 4.3, 12, 65, 145, 195, { memMhz: 2666, price: 182 });
intel('Core i5-10400F', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 2.9, 4.3, 12, 65, 145, 195, { igpu: false, memMhz: 2666, price: 157 });
intel('Core i5-10500', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 3.1, 4.5, 12, 65, 150, 202, { memMhz: 2666, price: 192 });
intel('Core i5-10600', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 3.3, 4.8, 12, 65, 158, 210, { memMhz: 2666, price: 213 });
intel('Core i5-10600K', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 4.1, 4.8, 12, 125, 162, 215, { unlocked: true, memMhz: 2666, price: 262 });
intel('Core i5-10600KF', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 6, 12, 4.1, 4.8, 12, 125, 162, 215, { unlocked: true, igpu: false, memMhz: 2666, price: 237 });
intel('Core i7-10700', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 8, 16, 2.9, 4.8, 16, 65, 158, 265, { memMhz: 2933, price: 323 });
intel('Core i7-10700F', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 8, 16, 2.9, 4.8, 16, 65, 158, 265, { igpu: false, memMhz: 2933, price: 298 });
intel('Core i7-10700K', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 8, 16, 3.8, 5.1, 16, 125, 168, 280, { unlocked: true, memMhz: 2933, price: 374 });
intel('Core i7-10700KF', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 8, 16, 3.8, 5.1, 16, 125, 168, 280, { unlocked: true, igpu: false, memMhz: 2933, price: 349 });
intel('Core i9-10900', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 10, 20, 2.8, 5.2, 20, 65, 165, 330, { memMhz: 2933, price: 439 });
intel('Core i9-10900F', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 10, 20, 2.8, 5.2, 20, 65, 165, 330, { igpu: false, memMhz: 2933, price: 422 });
intel('Core i9-10900K', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 10, 20, 3.7, 5.3, 20, 125, 172, 345, { unlocked: true, memMhz: 2933, price: 488 });
intel('Core i9-10900KF', 'Intel 10th', 'Comet Lake', 'LGA 1200', 2020, 14, 10, 20, 3.7, 5.3, 20, 125, 172, 345, { unlocked: true, igpu: false, memMhz: 2933, price: 472 });

// Gen 11 Rocket Lake — LGA 1200
intel('Core i5-11400', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 2.6, 4.4, 12, 65, 160, 210, { memMhz: 3200, pcie: '4.0 x16', price: 182 });
intel('Core i5-11400F', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 2.6, 4.4, 12, 65, 160, 210, { igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 157 });
intel('Core i5-11500', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 2.7, 4.6, 12, 65, 165, 218, { memMhz: 3200, pcie: '4.0 x16', price: 192 });
intel('Core i5-11600', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 2.8, 4.8, 12, 65, 172, 225, { memMhz: 3200, pcie: '4.0 x16', price: 213 });
intel('Core i5-11600K', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 3.9, 4.9, 12, 125, 178, 232, { unlocked: true, memMhz: 3200, pcie: '4.0 x16', price: 262 });
intel('Core i5-11600KF', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 6, 12, 3.9, 4.9, 12, 125, 178, 232, { unlocked: true, igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 237 });
intel('Core i7-11700', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 2.5, 4.9, 16, 65, 175, 285, { memMhz: 3200, pcie: '4.0 x16', price: 323 });
intel('Core i7-11700F', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 2.5, 4.9, 16, 65, 175, 285, { igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 298 });
intel('Core i7-11700K', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 3.6, 5.0, 16, 125, 182, 295, { unlocked: true, memMhz: 3200, pcie: '4.0 x16', price: 399 });
intel('Core i7-11700KF', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 3.6, 5.0, 16, 125, 182, 295, { unlocked: true, igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 374 });
intel('Core i9-11900', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 2.5, 5.2, 16, 65, 185, 300, { memMhz: 3200, pcie: '4.0 x16', price: 439 });
intel('Core i9-11900F', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 2.5, 5.2, 16, 65, 185, 300, { igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 422 });
intel('Core i9-11900K', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 3.5, 5.3, 16, 125, 192, 310, { unlocked: true, memMhz: 3200, pcie: '4.0 x16', price: 539 });
intel('Core i9-11900KF', 'Intel 11th', 'Rocket Lake', 'LGA 1200', 2021, 14, 8, 16, 3.5, 5.3, 16, 125, 192, 310, { unlocked: true, igpu: false, memMhz: 3200, pcie: '4.0 x16', price: 513 });

// Gen 12 Alder Lake — LGA 1700 (P+E)
intel('Core i3-12100', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 4, 8, 3.3, 4.3, 12, 60, 185, 175, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 122 });
intel('Core i3-12100F', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 4, 8, 3.3, 4.3, 12, 58, 185, 175, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 97 });
intel('Core i5-12400', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 6, 12, 2.5, 4.4, 18, 65, 190, 245, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 192 });
intel('Core i5-12400F', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 6, 12, 2.5, 4.4, 18, 65, 190, 245, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 167 });
intel('Core i5-12500', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 6, 12, 3.0, 4.6, 18, 65, 198, 255, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 202 });
intel('Core i5-12600', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 6, 12, 3.3, 4.8, 18, 65, 205, 262, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 223 });
intel('Core i5-12600K', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 10, 16, 3.7, 4.9, 20, 125, 210, 320, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 289 });
intel('Core i5-12600KF', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 10, 16, 3.7, 4.9, 20, 125, 210, 320, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 264 });
intel('Core i7-12700', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 12, 20, 2.1, 4.9, 25, 65, 208, 390, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 339 });
intel('Core i7-12700F', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 12, 20, 2.1, 4.9, 25, 65, 208, 390, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 314 });
intel('Core i7-12700K', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 12, 20, 3.6, 5.0, 25, 125, 215, 410, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 409 });
intel('Core i7-12700KF', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 12, 20, 3.6, 5.0, 25, 125, 215, 410, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 384 });
intel('Core i9-12900', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 16, 24, 2.4, 5.1, 30, 65, 218, 480, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 489 });
intel('Core i9-12900F', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 16, 24, 2.4, 5.1, 30, 65, 218, 480, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 464 });
intel('Core i9-12900K', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 16, 24, 3.2, 5.2, 30, 125, 225, 505, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 589 });
intel('Core i9-12900KF', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2021, 10, 16, 24, 3.2, 5.2, 30, 125, 225, 505, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 564 });
intel('Core i9-12900KS', 'Intel 12th', 'Alder Lake', 'LGA 1700', 2022, 10, 16, 24, 3.4, 5.5, 30, 150, 232, 520, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 739 });

// Gen 13 Raptor Lake
intel('Core i3-13100', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 4, 8, 3.4, 4.5, 12, 60, 195, 185, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 134 });
intel('Core i3-13100F', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 4, 8, 3.4, 4.5, 12, 58, 195, 185, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 109 });
intel('Core i5-13400', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 10, 16, 2.5, 4.6, 20, 65, 200, 320, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 221 });
intel('Core i5-13400F', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 10, 16, 2.5, 4.6, 20, 65, 200, 320, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 196 });
intel('Core i5-13500', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 14, 20, 2.5, 4.8, 24, 65, 208, 380, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 232 });
intel('Core i5-13600', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 14, 20, 2.7, 5.0, 24, 65, 215, 395, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 255 });
intel('Core i5-13600K', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 14, 20, 3.5, 5.1, 24, 125, 222, 420, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 319 });
intel('Core i5-13600KF', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 14, 20, 3.5, 5.1, 24, 125, 222, 420, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 294 });
intel('Core i7-13700', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 16, 24, 2.1, 5.2, 30, 65, 220, 480, { memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 384 });
intel('Core i7-13700F', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 16, 24, 2.1, 5.2, 30, 65, 220, 480, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 359 });
intel('Core i7-13700K', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 16, 24, 3.4, 5.4, 30, 125, 230, 510, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 409 });
intel('Core i7-13700KF', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 16, 24, 3.4, 5.4, 30, 125, 230, 510, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 384 });
intel('Core i9-13900', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 24, 32, 2.0, 5.6, 36, 65, 235, 620, { memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 549 });
intel('Core i9-13900F', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 24, 32, 2.0, 5.6, 36, 65, 235, 620, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 524 });
intel('Core i9-13900K', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 24, 32, 3.0, 5.8, 36, 125, 245, 660, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 589 });
intel('Core i9-13900KF', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2022, 10, 24, 32, 3.0, 5.8, 36, 125, 245, 660, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 564 });
intel('Core i9-13900KS', 'Intel 13th', 'Raptor Lake', 'LGA 1700', 2023, 10, 24, 32, 3.2, 6.0, 36, 150, 252, 680, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 699 });

// Gen 14 Raptor Lake Refresh
intel('Core i3-14100', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 4, 8, 3.5, 4.7, 12, 60, 200, 190, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 134 });
intel('Core i3-14100F', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 4, 8, 3.5, 4.7, 12, 58, 200, 190, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 109 });
intel('Core i5-14400', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 10, 16, 2.5, 4.7, 20, 65, 205, 330, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 221 });
intel('Core i5-14400F', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 10, 16, 2.5, 4.7, 20, 65, 205, 330, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 196 });
intel('Core i5-14500', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 14, 20, 2.6, 5.0, 24, 65, 215, 395, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 232 });
intel('Core i5-14600', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 14, 20, 2.7, 5.2, 24, 65, 220, 405, { memoryType: 'DDR4/DDR5', memMhz: 4800, pcie: '5.0 x16', price: 255 });
intel('Core i5-14600K', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 14, 20, 3.5, 5.3, 24, 125, 228, 430, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 319 });
intel('Core i5-14600KF', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 14, 20, 3.5, 5.3, 24, 125, 228, 430, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 294 });
intel('Core i7-14700', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 20, 28, 2.1, 5.4, 33, 65, 230, 560, { memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 384 });
intel('Core i7-14700F', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 20, 28, 2.1, 5.4, 33, 65, 230, 560, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 359 });
intel('Core i7-14700K', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 20, 28, 3.4, 5.6, 33, 125, 238, 590, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 409 });
intel('Core i7-14700KF', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 20, 28, 3.4, 5.6, 33, 125, 238, 590, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 384 });
intel('Core i9-14900', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 24, 32, 2.0, 5.8, 36, 65, 242, 640, { memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 549 });
intel('Core i9-14900F', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 24, 32, 2.0, 5.8, 36, 65, 242, 640, { igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 524 });
intel('Core i9-14900K', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 24, 32, 3.2, 6.0, 36, 125, 250, 680, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 589 });
intel('Core i9-14900KF', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2023, 10, 24, 32, 3.2, 6.0, 36, 125, 250, 680, { unlocked: true, igpu: false, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 564 });
intel('Core i9-14900KS', 'Intel 14th', 'Raptor Lake R', 'LGA 1700', 2024, 10, 24, 32, 3.2, 6.2, 36, 150, 258, 700, { unlocked: true, memoryType: 'DDR4/DDR5', memMhz: 5600, pcie: '5.0 x16', price: 689 });

// Gen 15 / Arrow Lake — Core Ultra 200S — LGA 1851
intel('Core Ultra 5 225', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2025, 3, 10, 10, 3.3, 4.9, 20, 65, 220, 320, { memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 249, approx: true });
intel('Core Ultra 5 225F', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2025, 3, 10, 10, 3.3, 4.9, 20, 65, 220, 320, { igpu: false, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 221, approx: true });
intel('Core Ultra 5 245K', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2024, 3, 14, 14, 4.2, 5.2, 24, 125, 235, 420, { unlocked: true, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 309 });
intel('Core Ultra 5 245KF', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2024, 3, 14, 14, 4.2, 5.2, 24, 125, 235, 420, { unlocked: true, igpu: false, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 294 });
intel('Core Ultra 7 265', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2025, 3, 20, 20, 2.4, 5.3, 30, 65, 238, 520, { memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 379, approx: true });
intel('Core Ultra 7 265F', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2025, 3, 20, 20, 2.4, 5.3, 30, 65, 238, 520, { igpu: false, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 354, approx: true });
intel('Core Ultra 7 265K', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2024, 3, 20, 20, 3.9, 5.5, 30, 125, 248, 560, { unlocked: true, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 394 });
intel('Core Ultra 7 265KF', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2024, 3, 20, 20, 3.9, 5.5, 30, 125, 248, 560, { unlocked: true, igpu: false, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 379 });
intel('Core Ultra 9 285', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2025, 3, 24, 24, 2.5, 5.6, 36, 65, 250, 620, { memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 579, approx: true });
intel('Core Ultra 9 285K', 'Intel 15th', 'Arrow Lake', 'LGA 1851', 2024, 3, 24, 24, 3.7, 5.7, 36, 125, 258, 650, { unlocked: true, memoryType: 'DDR5', memMhz: 6400, pcie: '5.0 x16', price: 589 });

const out = {
  version: 1,
  baselineId: 'ryzen-5-1600',
  updatedAt: '2026-07-24',
  source: 'curated-public-specs',
  note: 'Relative single/multi indices use Ryzen 5 1600 = 100. Desktop SKUs for AM4, AM5, and Intel 6th–15th (Arrow Lake Ultra 200S). Approx marked where early/estimated.',
  cpus,
};

const dest = path.join(__dirname, '..', 'data', 'cpu-specs.json');
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cpus.length} CPUs → ${dest}`);
