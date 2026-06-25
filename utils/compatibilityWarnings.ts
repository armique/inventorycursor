import type { InventoryItem } from '../types';

export type CompatWarning = { level: 'warn' | 'error'; message: string };

/** Basic compatibility hints on item form (#51). */
export function getCompatibilityWarnings(item: InventoryItem, allItems: InventoryItem[]): CompatWarning[] {
  const warnings: CompatWarning[] = [];
  const specs = item.specs || {};
  const socket = String(specs.Socket || specs.socket || '').toLowerCase();
  const ddr = String(specs['Memory Type'] || specs.DDR || specs.RAM || '').toLowerCase();
  const tdp = Number(specs.TDP || specs.tdp || 0);

  if (item.category === 'CPU' && socket && item.parentContainerId) {
    const pc = allItems.find((i) => i.id === item.parentContainerId);
    const mobo = pc?.componentIds
      ?.map((id) => allItems.find((x) => x.id === id))
      .find((x) => x?.category === 'Motherboard');
    const moboSocket = String(mobo?.specs?.Socket || mobo?.specs?.socket || '').toLowerCase();
    if (moboSocket && socket && moboSocket !== socket) {
      warnings.push({ level: 'error', message: `CPU socket (${socket}) ≠ motherboard (${moboSocket})` });
    }
  }

  if (item.category === 'RAM' && ddr.includes('ddr4') && item.parentContainerId) {
    const pc = allItems.find((i) => i.id === item.parentContainerId);
    const cpu = pc?.componentIds?.map((id) => allItems.find((x) => x.id === id)).find((x) => x?.category === 'CPU');
    const cpuName = (cpu?.name || '').toLowerCase();
    if (cpuName.includes('7000') || cpuName.includes('am5')) {
      warnings.push({ level: 'warn', message: 'DDR4 RAM in AM5 build — usually needs DDR5' });
    }
  }

  if (item.category === 'GPU' && tdp > 300) {
    const pc = allItems.find((i) => i.id === item.parentContainerId);
    const psu = pc?.componentIds?.map((id) => allItems.find((x) => x.id === id)).find((x) => x?.category === 'PSU');
    const watt = Number(psu?.specs?.Wattage || psu?.specs?.wattage || 0);
    if (watt > 0 && watt < tdp + 150) {
      warnings.push({ level: 'warn', message: `GPU TDP ~${tdp}W may need stronger PSU than ${watt}W` });
    }
  }

  return warnings;
}
