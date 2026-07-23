import { describe, expect, it } from 'vitest';
import {
  applyStorageKindToParsedItem,
  ensureStorageKindInName,
  inferStorageKind,
} from './ensureStorageKindInName';

describe('inferStorageKind', () => {
  it('detects NVMe from title', () => {
    expect(inferStorageKind('Samsung 980 PRO 1TB NVMe M.2')).toBe('NVMe');
    expect(inferStorageKind('WD Black SN850X 2TB PCIe 4.0')).toBe('NVMe');
  });

  it('detects SATA SSD', () => {
    expect(inferStorageKind('Crucial BX500 480GB SATA SSD 2.5')).toBe('SSD');
    expect(inferStorageKind('Samsung 870 EVO 1TB 2.5" SSD')).toBe('SSD');
  });

  it('detects HDD', () => {
    expect(inferStorageKind('Seagate Barracuda 2TB HDD 7200rpm')).toBe('HDD');
  });
});

describe('ensureStorageKindInName', () => {
  it('appends NVMe or SSD when missing', () => {
    expect(ensureStorageKindInName('Samsung 980 Pro 1TB', 'NVMe')).toBe('Samsung 980 Pro 1TB NVMe');
    expect(ensureStorageKindInName('Crucial BX500 480GB', 'SSD')).toBe('Crucial BX500 480GB SSD');
  });

  it('upgrades bare SSD to NVMe when kind is NVMe', () => {
    expect(ensureStorageKindInName('Samsung 980 Pro 1TB SSD', 'NVMe')).toBe(
      'Samsung 980 Pro 1TB NVMe'
    );
  });

  it('does not duplicate', () => {
    expect(ensureStorageKindInName('Samsung 980 Pro 1TB NVMe', 'NVMe')).toBe(
      'Samsung 980 Pro 1TB NVMe'
    );
  });
});

describe('applyStorageKindToParsedItem', () => {
  it('fixes storage names from purchase title', () => {
    const out = applyStorageKindToParsedItem({
      name: 'Samsung 980 Pro 1TB',
      category: 'Components',
      subCategory: 'Storage (SSD/HDD)',
      sourceText: 'Samsung 980 PRO 1TB NVMe SSD M.2 funktionsfähig',
      specs: { Capacity: '1TB' },
    });
    expect(out.name).toBe('Samsung 980 Pro 1TB NVMe');
    expect(out.specs['Drive Type']).toMatch(/NVMe/i);
  });
});
