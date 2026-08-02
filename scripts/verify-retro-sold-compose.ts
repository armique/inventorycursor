import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { buildRetroContainerAndComponents } from '../utils/retroSoldCompose';

function soldItem(id: string, name: string, buyPrice: number, sellPrice: number): InventoryItem {
  return {
    id,
    name,
    category: 'Components',
    subCategory: 'Graphics Cards',
    status: ItemStatus.SOLD,
    buyPrice,
    sellPrice,
    buyDate: '2026-01-01',
    sellDate: '2026-07-20',
    comment1: '',
    comment2: '',
  };
}

const items = [
  soldItem('gpu', 'RTX 3070', 260, 700),
  soldItem('cpu', 'Ryzen 5 5600X', 110, 180),
  soldItem('case', 'NZXT case', 45, 90),
];
const allItems = [...items];

{
  const { bundle, updatedComponents } = buildRetroContainerAndComponents({
    items,
    allItems,
    kind: 'pc',
    bundleName: 'Gaming PC',
    sellDate: '2026-07-20',
    useSmartDistribution: false,
  });
  assert.equal(bundle.category, 'PC');
  assert.equal(bundle.isPC, true);
  assert.equal(bundle.isBundle, false, 'PC Build must not also be flagged as Bundle');
  assert.equal(bundle.sellPrice, 970);
  assert.equal(updatedComponents.length, 3);
  assert.ok(updatedComponents.every((i) => i.status === ItemStatus.IN_COMPOSITION));
}

{
  const { bundle, updatedComponents } = buildRetroContainerAndComponents({
    items,
    allItems,
    kind: 'bundle',
    bundleName: 'Upgrade Bundle',
    sellDate: '2026-07-20',
    useSmartDistribution: true,
  });
  assert.equal(bundle.category, 'Bundle');
  assert.equal(bundle.isBundle, true);
  assert.equal(bundle.isPC, false, 'Bundle must not also be flagged as PC');
  const total = updatedComponents.reduce((s, i) => s + Number(i.sellPrice || 0), 0);
  assert.ok(total > 0);
}

console.log('verify-retro-sold-compose: ok');

