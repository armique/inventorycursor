import fs from 'node:fs';
import { ItemStatus, type InventoryItem } from '../types';

function load(p: string): InventoryItem[] {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(raw) ? raw : raw.inventory;
}

const ggPath = process.argv[2] || 'data/restore-reference-GG.json';
const curPath = process.argv[3] || String.raw`c:\Users\ADMIN\Downloads\deinventory-backup-2026-09-02.json`;

const gg = load(ggPath);
const cur = load(curPath);
const ggBy = new Map(gg.map((i) => [i.id, i]));
const curBy = new Map(cur.map((i) => [i.id, i]));

const isContainer = (i: InventoryItem) =>
  Boolean(i.isBundle || i.isPC || (i.componentIds && i.componentIds.length));

let compIdDiff = 0;
let parentDiff = 0;
let childSellDiff = 0;
let statusDiff = 0;
let abrechnungChildSellDiff = 0;
const compSamples: string[] = [];
const parentSamples: string[] = [];
const sellSamples: string[] = [];
const wrongBuyDateBundles: string[] = [];

for (const c of cur) {
  const g = ggBy.get(c.id);
  if (!g) continue;

  if (isContainer(c) || isContainer(g)) {
    const gc = JSON.stringify(g.componentIds || []);
    const cc = JSON.stringify(c.componentIds || []);
    if (gc !== cc) {
      compIdDiff++;
      if (compSamples.length < 20) {
        compSamples.push(
          `${c.name} | cur:${c.componentIds?.length ?? 0} gg:${g.componentIds?.length ?? 0}`,
        );
      }
    }
    if (c.buyDate === '2026-07-29' || c.buyDate === '2026-09-02') {
      wrongBuyDateBundles.push(`${c.name} (${c.buyDate})`);
    }
  }

  if ((g.parentContainerId || '') !== (c.parentContainerId || '')) {
    parentDiff++;
    if (parentSamples.length < 20) {
      parentSamples.push(
        `${c.name} cur=${c.parentContainerId || 'none'} gg=${g.parentContainerId || 'none'}`,
      );
    }
  }

  if (g.status === ItemStatus.IN_COMPOSITION && c.status !== ItemStatus.IN_COMPOSITION) {
    statusDiff++;
  }

  if (g.parentContainerId && Math.abs(Number(g.sellPrice || 0) - Number(c.sellPrice || 0)) > 0.01) {
    childSellDiff++;
    const linked = Boolean(c.ebayOrderId || c.ebayListingId || c.saleProceeds);
    if (linked) abrechnungChildSellDiff++;
    if (sellSamples.length < 20) {
      sellSamples.push(
        `${c.name} cur=${c.sellPrice} gg=${g.sellPrice} linked=${linked} status=${c.status}`,
      );
    }
  }
}

const newContainers = cur.filter((i) => isContainer(i) && !ggBy.has(i.id));
const retroToday = cur.filter(
  (i) =>
    i.id.startsWith('bundle-') &&
    (i.buyDate === '2026-09-02' || String(i.comment1 || '').includes('Retroactive')),
);

// Children that should be in a bundle per GG but are standalone in current
const orphanedFromGg = gg.filter(
  (g) =>
    g.parentContainerId &&
    curBy.has(g.id) &&
    !curBy.get(g.id)!.parentContainerId &&
    ggBy.get(g.parentContainerId),
);

console.log('=== STRUCTURAL DIFF (reference vs current) ===');
console.log(`reference: ${gg.length} items | current: ${cur.length} items`);
console.log(`componentIds differ: ${compIdDiff}`);
console.log(`parentContainerId differ: ${parentDiff}`);
console.log(`child sellPrice differ (gg has parent): ${childSellDiff} (${abrechnungChildSellDiff} abrechnung-linked)`);
console.log(`should be IN_COMPOSITION: ${statusDiff}`);
console.log(`bundles wrong buyDate (Jul29/Sep2): ${wrongBuyDateBundles.length}`);
console.log(`new containers in current only: ${newContainers.length}`);
console.log(`retro/today bundles: ${retroToday.length}`);
console.log(`gg-parented but current standalone: ${orphanedFromGg.length}`);

if (compSamples.length) {
  console.log('\ncomponentIds samples:');
  for (const s of compSamples) console.log('  ', s);
}
if (parentSamples.length) {
  console.log('\nparentContainerId samples:');
  for (const s of parentSamples) console.log('  ', s);
}
if (sellSamples.length) {
  console.log('\nchild sellPrice samples:');
  for (const s of sellSamples) console.log('  ', s);
}
if (wrongBuyDateBundles.length) {
  console.log('\nwrong buyDate bundles (first 15):');
  for (const s of wrongBuyDateBundles.slice(0, 15)) console.log('  ', s);
}
if (newContainers.length) {
  console.log('\nnew containers (first 10):');
  for (const i of newContainers.slice(0, 10)) {
    console.log('  ', i.name, i.id, 'parts=', i.componentIds?.length);
  }
}
if (retroToday.length) {
  console.log('\nretro bundles:');
  for (const i of retroToday.slice(0, 10)) {
    console.log('  ', i.name, i.buyDate, 'parts=', i.componentIds?.length);
  }
}
if (orphanedFromGg.length) {
  console.log('\norphaned from reference (first 10):');
  for (const g of orphanedFromGg.slice(0, 10)) {
    const c = curBy.get(g.id)!;
    console.log('  ', g.name, 'ggParent=', g.parentContainerId, 'curStatus=', c.status);
  }
}

// Orphan diagnosis: does parent container still exist in current?
let parentExists = 0;
let parentMissing = 0;
let parentMissingChildInList = 0;
for (const g of gg) {
  if (!g.parentContainerId || !curBy.has(g.id)) continue;
  const c = curBy.get(g.id)!;
  if (c.parentContainerId) continue;
  if (!curBy.has(g.parentContainerId)) {
    parentMissing++;
    continue;
  }
  parentExists++;
  const p = curBy.get(g.parentContainerId)!;
  if (!(p.componentIds || []).includes(g.id)) parentMissingChildInList++;
}

console.log('\n=== ORPHAN DIAGNOSIS ===');
console.log(`gg-parented, current standalone: ${parentExists + parentMissing}`);
console.log(`parent container exists in current: ${parentExists}`);
console.log(`parent container MISSING in current: ${parentMissing}`);
console.log(`parent exists but child not in componentIds: ${parentMissingChildInList}`);

// Missing containers in current that we could restore from reference
const restorableContainers: InventoryItem[] = [];
for (const g of gg) {
  if (!isContainer(g) || curBy.has(g.id)) continue;
  const childIds = (g.componentIds || []).filter((id) => curBy.has(id));
  if (childIds.length >= 2) {
    restorableContainers.push({ ...g, componentIds: childIds });
  }
}
console.log(`\n=== RESTORABLE CONTAINERS (missing in current, >=2 children still present) ===`);
console.log(`count: ${restorableContainers.length}`);
for (const c of restorableContainers.slice(0, 15)) {
  console.log(
    '  ',
    c.name,
    c.id,
    'parts=',
    c.componentIds?.length,
    'sell=',
    c.sellDate,
  );
}
