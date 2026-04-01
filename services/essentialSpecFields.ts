/**
 * Minimal spec field lists for the asset editor so the form stays short.
 * Settings → "Load recommended" uses the same map plus Condition / Warranty.
 */

export const ESSENTIAL_SPEC_FIELDS: Record<string, string[]> = {
  // PC
  'PC:Custom Built PC': ['CPU', 'GPU', 'RAM', 'Storage'],
  'PC:Pre-Built PC': ['CPU', 'GPU', 'RAM', 'Storage'],
  'PC:Server': ['CPU', 'RAM', 'Storage'],
  'PC:Workstation': ['CPU', 'GPU', 'RAM', 'Storage'],

  // Laptops
  'Laptops:Gaming Laptop': ['Screen Size', 'CPU', 'GPU', 'RAM', 'Storage'],
  'Laptops:Ultrabook': ['Screen Size', 'CPU', 'RAM', 'Storage'],
  'Laptops:MacBook': ['Screen Size', 'Chip', 'RAM', 'Storage'],
  'Laptops:Chromebook': ['Screen Size', 'CPU', 'RAM', 'Storage'],
  'Laptops:Office Laptop': ['Screen Size', 'CPU', 'RAM', 'Storage'],

  // Components
  'Components:Graphics Cards': ['Chipset', 'VRAM', 'Memory Type'],
  'Components:Processors': ['Socket', 'Cores', 'TDP'],
  'Components:Motherboards': ['Socket', 'Form Factor', 'Chipset'],
  'Components:RAM': ['Memory Type', 'Speed', 'Capacity'],
  'Components:Storage (SSD/HDD)': ['Type', 'Capacity', 'Interface'],
  'Components:Power Supplies': ['Wattage', 'Efficiency', 'Modularity'],
  'Components:Cases': ['Form Factor', 'Color'],
  'Components:Cooling': ['Type', 'Socket', 'TDP'],

  // Gadgets
  'Gadgets:Smartphones': ['Brand', 'Model', 'Storage'],
  'Gadgets:Tablets': ['Brand', 'Model', 'Storage'],
  'Gadgets:Smartwatches': ['Brand', 'Model'],
  'Gadgets:Consoles': ['Brand', 'Model', 'Storage'],
  'Gadgets:Cameras': ['Brand', 'Model'],
  'Gadgets:Audio': ['Brand', 'Model'],

  // Peripherals
  'Peripherals:Monitors': ['Size', 'Resolution', 'Refresh Rate'],
  'Peripherals:Keyboards': ['Brand', 'Layout'],
  'Peripherals:Mice': ['Brand', 'DPI'],
  'Peripherals:Headsets': ['Brand', 'Connection'],
  'Peripherals:Microphones': ['Brand', 'Connection'],
  'Peripherals:Webcams': ['Brand', 'Resolution'],

  // Network
  'Network:Routers': ['Speed', 'WiFi', 'Ports'],
  'Network:Switches': ['Ports', 'Speed'],
  'Network:NAS': ['Drive Bays', 'Capacity'],
  'Network:Cables': ['Type', 'Length'],

  // Software
  'Software:OS Licenses': ['Version', 'Seats'],
  'Software:Office': ['Version'],
  'Software:Antivirus': ['Seats'],

  // Bundle
  'Bundle:PC Bundle': ['CPU', 'GPU', 'RAM'],
  'Bundle:Peripheral Bundle': ['Contents'],
  'Bundle:Component Set': ['Contents'],

  // Misc
  'Misc:Cables': ['Type', 'Length'],
  'Misc:Adapters': ['Type'],
  'Misc:Tools': ['Type'],
  'Misc:Merchandise': ['Type'],
  'Misc:Spare Parts': ['Type'],
};

/** Always shown after category-specific essentials (resale basics). */
export const UNIVERSAL_SPEC_DEFAULTS = ['Condition', 'Warranty'] as const;

/**
 * Ordered list of field names to show in the compact asset editor for this category.
 */
export function getEssentialSpecFieldKeys(category: string, subCategory: string | undefined): string[] {
  const sub = (subCategory || '').trim();
  const k = `${category}:${sub}`;
  const list = ESSENTIAL_SPEC_FIELDS[k];
  if (list?.length) return [...list];
  return [];
}
