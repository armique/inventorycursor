import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import { buildContainerTitle, ramBits } from './buildTitle';

function ramItem(partial: Partial<InventoryItem> & { name: string }): InventoryItem {
  return {
    id: partial.id || 'ram-1',
    name: partial.name,
    buyPrice: 0,
    buyDate: '2026-01-01',
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    specs: partial.specs,
  };
}

describe('ramBits kit expansion', () => {
  it('treats 2x4GB kit row as 8GB total (not 1x4GB)', () => {
    const bits = ramBits([
      ramItem({ name: 'DDR3 8GB (2x4GB) DDR3 RAM' }),
    ]);
    expect(bits).toMatch(/^8GB \(2×4GB\) DDR3/);
  });

  it('keeps two separate 4GB sticks as 8GB (2×4GB)', () => {
    const bits = ramBits([
      ramItem({ id: 'a', name: 'DDR3 4GB' }),
      ramItem({ id: 'b', name: 'DDR3 4GB' }),
    ]);
    expect(bits).toMatch(/^8GB \(2×4GB\) DDR3/);
  });

  it('uses Modules + GB per Stick when name has no NxM kit', () => {
    const bits = ramBits([
      ramItem({
        name: 'Kingston DDR4',
        specs: { Modules: '2', 'GB per Stick': '8GB', 'Kit Capacity': '16GB', 'Memory Type': 'DDR4' },
      }),
    ]);
    // Kit Capacity "16GB" alone is not NxM; Modules=2 + stick 8 → 16GB (2×8GB)
    expect(bits).toMatch(/^16GB \(2×8GB\) DDR4/);
  });

  it('builds PC title with correct RAM kit total', () => {
    const title = buildContainerTitle('pc', [
      {
        id: 'mobo',
        name: 'Gigabyte GA-78LMT-S2P',
        buyPrice: 0,
        buyDate: '2026-01-01',
        category: 'Components',
        subCategory: 'Motherboards',
        status: ItemStatus.IN_STOCK,
        comment1: '',
        comment2: '',
      },
      {
        id: 'cpu',
        name: 'AMD FX-8350',
        buyPrice: 0,
        buyDate: '2026-01-01',
        category: 'Components',
        subCategory: 'Processors',
        status: ItemStatus.IN_STOCK,
        comment1: '',
        comment2: '',
      },
      ramItem({ name: 'DDR3 8GB (2x4GB) DDR3 RAM' }),
    ]);
    expect(title).toContain('8GB (2×4GB) DDR3');
    expect(title).not.toContain('4GB (1×4GB)');
  });
});
