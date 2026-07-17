
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  /** PC builds only — no subcategories. Defective parts not allowed. */
  'PC': [],
  /** Compatible PC-style bundles (Aufrustkit / PC Bundle) — no subcategories. Defective not allowed. */
  'Bundle': [],
  /** Mixed bag of any parts/qty — defective allowed. Replaces legacy Lot Bundle. */
  'Mixed Bundle': [],
  'Laptops': ['Gaming Laptop', 'Ultrabook', 'MacBook', 'Chromebook', 'Office Laptop'],
  'Components': ['Graphics Cards', 'Processors', 'Motherboards', 'RAM', 'Storage (SSD/HDD)', 'Power Supplies', 'Cases', 'Cooling'],
  'Gadgets': ['Smartphones', 'Tablets', 'Smartwatches', 'Consoles', 'Cameras', 'Audio'],
  'Peripherals': ['Monitors', 'Keyboards', 'Mice', 'Headsets', 'Microphones', 'Webcams'],
  'Network': ['Routers', 'Switches', 'NAS', 'Cables'],
  'Software': ['OS Licenses', 'Office', 'Antivirus'],
  'Misc': ['Cables', 'Adapters', 'Tools', 'Merchandise', 'Spare Parts']
};

export const HIERARCHY_CATEGORIES = DEFAULT_CATEGORIES;

/** Dashboard widget ids (order + visibility). Synced to Firebase with dashboard preferences. */
export const DEFAULT_DASHBOARD_WIDGET_IDS = [
  'gamification',
  'statCards',
  'performanceChart',
  'capitalDistribution',
  'profitByCategory',
  'profitByMonth',
  'taxReport',
  'todoFromData',
  'tasks',
  'recentActivity',
] as const;
