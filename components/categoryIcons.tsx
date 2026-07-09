import React from 'react';
import {
  Antenna,
  Apple,
  BadgeCheck,
  Cable,
  Camera,
  Disc,
  FileText,
  Gamepad2,
  Gift,
  HardDrive,
  Headphones,
  KeyRound,
  Keyboard,
  Mic,
  Mouse,
  Package,
  Puzzle,
  Router,
  ShieldCheck,
  Smartphone,
  Tablet,
  Wand2,
  Watch,
  Webcam,
  Wind,
  Wrench,
} from 'lucide-react';

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = React.ComponentType<IconProps>;

const IconBase: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 24,
  strokeWidth = 1.6,
  className,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/**
 * Custom line icons — drawn to match the Voltra reference (simple, single-stroke,
 * self-explanatory), used everywhere a category/subcategory icon is needed:
 * the storefront and the admin dashboard both render through getCategoryIcon().
 */
export const GraphicsCardIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="8" cy="12" r="2.4" />
    <circle cx="15" cy="12" r="2.4" />
  </IconBase>
);

export const ProcessorIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </IconBase>
);

export const TowerPcIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <circle cx="12" cy="7.5" r="1.2" />
    <path d="M9 12.5h6M9 15.5h6" />
  </IconBase>
);

export const LaptopIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
  </IconBase>
);

export const MonitorIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 16v5" />
  </IconBase>
);

export const ComponentsIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </IconBase>
);

export const RamIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="2" y="9" width="20" height="6" rx="1" />
    <path d="M5 9v6M8 9v6M11 9v6M14 9v6M17 9v6M20 9v6" />
  </IconBase>
);

export const MotherboardIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="4" height="4" />
    <path d="M14 7h3M14 11h3M7 14h3M7 17h3M14 14h3" />
  </IconBase>
);

export const PsuIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M15 10h3M15 14h3" />
  </IconBase>
);

export const CaseIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M9 7h.01M9 10h.01M9 13h.01" />
  </IconBase>
);

export const StorageIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <circle cx="7" cy="12" r="1" />
    <path d="M11 12h8" />
  </IconBase>
);

export const BundleIcon: IconComponent = (props) => (
  <IconBase {...props}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M4 8l8-5 8 5" />
    <path d="M12 3v17" />
  </IconBase>
);

/**
 * Maps a category or subcategory name (case-insensitive) to an icon.
 * Covers every entry in services/constants.ts DEFAULT_CATEGORIES.
 * Add new exact-name entries here as new categories are introduced.
 */
const NAME_OVERRIDES: Record<string, IconComponent> = {
  // PC
  'pc': TowerPcIcon,
  'custom built pc': TowerPcIcon,
  'pre-built pc': TowerPcIcon,
  'prebuilt pcs': TowerPcIcon,
  'server': TowerPcIcon,
  'workstation': TowerPcIcon,
  // Laptops
  'laptops': LaptopIcon,
  'gaming laptop': LaptopIcon,
  'ultrabook': LaptopIcon,
  'macbook': LaptopIcon,
  'chromebook': LaptopIcon,
  'office laptop': LaptopIcon,
  // Components
  'components': ComponentsIcon,
  'graphics cards': GraphicsCardIcon,
  'grafikkarten': GraphicsCardIcon,
  'processors': ProcessorIcon,
  'prozessoren': ProcessorIcon,
  'motherboards': MotherboardIcon,
  'mainboards': MotherboardIcon,
  'ram': RamIcon,
  'arbeitsspeicher': RamIcon,
  'storage (ssd/hdd)': StorageIcon,
  'storage': StorageIcon,
  'ssd': StorageIcon,
  'hdd': StorageIcon,
  'power supplies': PsuIcon,
  'netzteile': PsuIcon,
  'cases': CaseIcon,
  'gehäuse': CaseIcon,
  'cooling': Wind as unknown as IconComponent,
  'kühlung': Wind as unknown as IconComponent,
  'fans': Wind as unknown as IconComponent,
  'optical drives': Disc as unknown as IconComponent,
  // Gadgets
  'gadgets': Smartphone as unknown as IconComponent,
  'smartphones': Smartphone as unknown as IconComponent,
  'tablets': Tablet as unknown as IconComponent,
  'smartwatches': Watch as unknown as IconComponent,
  'consoles': Gamepad2 as unknown as IconComponent,
  'cameras': Camera as unknown as IconComponent,
  'audio': Headphones as unknown as IconComponent,
  // Peripherals
  'peripherals': Keyboard as unknown as IconComponent,
  'monitors': MonitorIcon,
  'keyboards': Keyboard as unknown as IconComponent,
  'mice': Mouse as unknown as IconComponent,
  'headsets': Headphones as unknown as IconComponent,
  'microphones': Mic as unknown as IconComponent,
  'webcams': Webcam as unknown as IconComponent,
  // Network
  'network': Router as unknown as IconComponent,
  'routers': Router as unknown as IconComponent,
  'switches': Antenna as unknown as IconComponent,
  'nas': HardDrive as unknown as IconComponent,
  'cables': Cable as unknown as IconComponent,
  // Software
  'software': FileText as unknown as IconComponent,
  'os licenses': KeyRound as unknown as IconComponent,
  'office': FileText as unknown as IconComponent,
  'antivirus': ShieldCheck as unknown as IconComponent,
  // Bundle
  'bundle': BundleIcon,
  'pc bundle': BundleIcon,
  'peripheral bundle': BundleIcon,
  'component set': BundleIcon,
  // Misc
  'misc': Package as unknown as IconComponent,
  'adapters': Cable as unknown as IconComponent,
  'tools': Wrench as unknown as IconComponent,
  'merchandise': Gift as unknown as IconComponent,
  'spare parts': Puzzle as unknown as IconComponent,
  'unknown': Package as unknown as IconComponent,
  // Brand-specific / custom categories seen in the wild
  'apple': Apple as unknown as IconComponent,
  'mac': Apple as unknown as IconComponent,
  'accessories': Wand2 as unknown as IconComponent,
  'certified': BadgeCheck as unknown as IconComponent,
};

/** Loose keyword fallback for category names that don't exactly match the map above. */
const KEYWORD_RULES: [RegExp, IconComponent][] = [
  [/grafik|gpu|graphic/i, GraphicsCardIcon],
  [/prozessor|cpu|processor|chip/i, ProcessorIcon],
  [/ram|speicher|memory/i, RamIcon],
  [/mainboard|motherboard/i, MotherboardIcon],
  [/ssd|hdd|storage|festplatte|nas/i, StorageIcon],
  [/netzteil|psu|power supply/i, PsuIcon],
  [/gehäuse|\bcase\b/i, CaseIcon],
  [/kühl|cooler|lüfter|\bfan\b/i, Wind as unknown as IconComponent],
  [/monitor|display|bildschirm/i, MonitorIcon],
  [/laptop|notebook|macbook|chromebook|ultrabook/i, LaptopIcon],
  [/apple|\bmac\b/i, Apple as unknown as IconComponent],
  [/bundle|paket|\bset\b/i, BundleIcon],
  [/server|workstation|\btower\b/i, TowerPcIcon],
  [/\bpc\b/i, TowerPcIcon],
  [/cable|kabel|adapter/i, Cable as unknown as IconComponent],
  [/keyboard|tastatur/i, Keyboard as unknown as IconComponent],
  [/mouse|maus/i, Mouse as unknown as IconComponent],
  [/headset|kopfhörer|audio/i, Headphones as unknown as IconComponent],
  [/router|switch|network|netzwerk/i, Router as unknown as IconComponent],
  [/phone|handy/i, Smartphone as unknown as IconComponent],
  [/tablet/i, Tablet as unknown as IconComponent],
  [/watch|uhr/i, Watch as unknown as IconComponent],
  [/camera|kamera/i, Camera as unknown as IconComponent],
  [/mic|mikrofon/i, Mic as unknown as IconComponent],
  [/webcam/i, Webcam as unknown as IconComponent],
  [/license|lizenz|key/i, KeyRound as unknown as IconComponent],
  [/software|office|antivirus/i, FileText as unknown as IconComponent],
  [/tool|werkzeug/i, Wrench as unknown as IconComponent],
  [/merch|gift/i, Gift as unknown as IconComponent],
];

/** Resolve a category or subcategory name to an icon component. Falls back to a generic package icon. */
export function getCategoryIcon(name: string | undefined | null): IconComponent {
  if (!name) return Package as unknown as IconComponent;
  const key = name.trim().toLowerCase();
  if (NAME_OVERRIDES[key]) return NAME_OVERRIDES[key];
  const rule = KEYWORD_RULES.find(([re]) => re.test(name));
  if (rule) return rule[1];
  return Package as unknown as IconComponent;
}

/** Resolve the best icon for an item: subcategory first, then category, then generic fallback. */
export function getCategoryIconForItem(item: { category?: string; subCategory?: string }): IconComponent {
  const sub = item.subCategory?.trim();
  if (sub && getCategoryIcon(sub) !== (Package as unknown as IconComponent)) return getCategoryIcon(sub);
  return getCategoryIcon(item.category);
}
