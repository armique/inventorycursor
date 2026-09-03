import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ItemStatus, type InventoryItem } from '../types';
import { mergeInventoryFromBackup, hasAbrechnungLinkage } from '../utils/mergeInventoryFromBackup';

function loadInventory(path: string): InventoryItem[] {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.inventory)) return raw.inventory;
  throw new Error(`No inventory in ${path}`);
}

const backupPath = process.argv[2] || 'data/restore-reference-GG.json';
if (!fs.existsSync(backupPath)) {
  console.log(`skip: ${backupPath} not found`);
  process.exit(0);
}

const backup = loadInventory(backupPath);
console.log(`backup: ${backup.length} items`);

// Identity: backup merged into itself → zero changes
{
  const { report } = mergeInventoryFromBackup(backup, backup);
  assert.equal(report.fieldChanges, 0, 'identity merge must change nothing');
  console.log('identity merge: ok (0 changes)');
}

// Synthetic: broken bundle + abrechnung guard
{
  const bundleId = 'test-bundle-1';
  const childA: InventoryItem = {
    id: 'child-a',
    name: 'GPU',
    category: 'Components',
    status: ItemStatus.SOLD,
    buyPrice: 100,
    sellPrice: 50,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
    ebayOrderId: 'ORDER-123',
  };
  const childB: InventoryItem = {
    id: 'child-b',
    name: 'CPU',
    category: 'Components',
    status: ItemStatus.SOLD,
    buyPrice: 80,
    sellPrice: 40,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
  };
  const bundle: InventoryItem = {
    id: bundleId,
    name: 'Gaming PC',
    category: 'PC',
    status: ItemStatus.SOLD,
    buyPrice: 180,
    sellPrice: 90,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
    isPC: true,
    isBundle: false,
    componentIds: ['child-a', 'child-b'],
  };

  const reference = [bundle, { ...childA, parentContainerId: bundleId, status: ItemStatus.IN_COMPOSITION, sellPrice: 60 }, { ...childB, parentContainerId: bundleId, status: ItemStatus.IN_COMPOSITION, sellPrice: 30 }];
  const broken = [
    { ...bundle, isPC: false, isBundle: false, componentIds: [] },
    { ...childA, parentContainerId: undefined },
    { ...childB, parentContainerId: undefined, status: ItemStatus.SOLD },
  ];

  assert.ok(hasAbrechnungLinkage(childA));

  const { merged, report } = mergeInventoryFromBackup(broken, reference);
  const mergedBundle = merged.find((i) => i.id === bundleId)!;
  const mergedA = merged.find((i) => i.id === 'child-a')!;
  const mergedB = merged.find((i) => i.id === 'child-b')!;

  assert.equal(mergedBundle.isPC, true);
  assert.deepEqual(mergedBundle.componentIds, ['child-a', 'child-b']);
  assert.equal(mergedA.parentContainerId, bundleId);
  assert.equal(mergedB.parentContainerId, bundleId);
  assert.equal(mergedB.status, ItemStatus.IN_COMPOSITION);
  assert.equal(mergedA.sellPrice, 60, 'bundle member gets reference composition sell price');
  assert.equal(mergedB.sellPrice, 30, 'unlinked child gets backup sell price');
  assert.ok(report.skippedAbrechnungPrice >= 0);
  console.log('synthetic merge: ok');
}

// Missing container restore
{
  const bundleId = 'bundle-ref-1';
  const childA: InventoryItem = {
    id: 'child-a',
    name: 'GPU',
    category: 'Components',
    status: ItemStatus.SOLD,
    buyPrice: 100,
    sellPrice: 50,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
  };
  const childB: InventoryItem = {
    id: 'child-b',
    name: 'CPU',
    category: 'Components',
    status: ItemStatus.SOLD,
    buyPrice: 80,
    sellPrice: 40,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
  };
  const bundle: InventoryItem = {
    id: bundleId,
    name: 'Gaming PC',
    category: 'PC',
    status: ItemStatus.SOLD,
    buyPrice: 180,
    sellPrice: 90,
    buyDate: '2025-01-01',
    sellDate: '2025-06-01',
    comment1: '',
    comment2: '',
    isPC: true,
    isBundle: false,
    componentIds: ['child-a', 'child-b'],
    ebayOrderId: 'SHOULD-NOT-COPY',
  };
  const reference = [
    bundle,
    { ...childA, parentContainerId: bundleId, status: ItemStatus.IN_COMPOSITION, sellPrice: 60 },
    { ...childB, parentContainerId: bundleId, status: ItemStatus.IN_COMPOSITION, sellPrice: 30 },
  ];
  const broken = [
    { ...childA, parentContainerId: undefined, sellPrice: 50 },
    { ...childB, parentContainerId: undefined, sellPrice: 40 },
  ];

  const { merged, report } = mergeInventoryFromBackup(broken, reference);
  assert.equal(report.containersRestored, 1);
  assert.ok(merged.some((i) => i.id === bundleId));
  const ma = merged.find((i) => i.id === 'child-a')!;
  assert.equal(ma.parentContainerId, bundleId);
  assert.equal(ma.sellPrice, 60);
  assert.equal(ma.status, ItemStatus.IN_COMPOSITION);
  assert.equal(merged.find((i) => i.id === bundleId)!.ebayOrderId, undefined);
  console.log('missing container restore: ok');
}

console.log('verify-merge-inventory-from-backup: ok');
