import React, { useState } from 'react';
import {
  Cpu, Monitor, HardDrive, Zap, Wind, Laptop, Smartphone, Tablet, Watch,
  Gamepad2, Camera, Headphones, Keyboard, Mouse, Mic, Webcam, Router, Network,
  Cable, Wrench, Gift, Package, Disc, Server, Database,
  CircuitBoard, PcCase, Layers, Puzzle, Component,
  type LucideIcon,
} from 'lucide-react';
import { InventoryItem } from '../types';
import { CATEGORY_IMAGES } from '../services/hardwareDB';

/** Minimalistic icon per subcategory (then category fallback). Covers DEFAULT_CATEGORIES + Optical Drives, Fans, etc. */
const SUBCATEGORY_ICON: Record<string, LucideIcon> = {
  // Components
  'Graphics Cards': Monitor,
  'Processors': Cpu,
  'Motherboards': CircuitBoard,
  'RAM': Database,
  'Storage (SSD/HDD)': HardDrive,
  'Power Supplies': Zap,
  'Cases': PcCase,
  'Cooling': Wind,
  'Optical Drives': Disc,
  'Fans': Wind,
  // PC
  'Custom Built PC': Cpu,
  'Pre-Built PC': Laptop,
  'Server': Server,
  'Workstation': Monitor,
  // Laptops
  'Gaming Laptop': Laptop,
  'Ultrabook': Laptop,
  'MacBook': Laptop,
  'Chromebook': Laptop,
  'Office Laptop': Laptop,
  // Gadgets
  'Smartphones': Smartphone,
  'Tablets': Tablet,
  'Smartwatches': Watch,
  'Consoles': Gamepad2,
  'Cameras': Camera,
  'Audio': Headphones,
  // Peripherals
  'Monitors': Monitor,
  'Keyboards': Keyboard,
  'Mice': Mouse,
  'Headsets': Headphones,
  'Microphones': Mic,
  'Webcams': Webcam,
  // Network
  'Routers': Router,
  'Switches': Network,
  'NAS': HardDrive,
  'Cables': Cable,
  // Software
  'OS Licenses': Database,
  'Office': Database,
  'Antivirus': Database,
  // Bundle
  'PC Bundle': Gift,
  'Peripheral Bundle': Gift,
  'Component Set': Layers,
  // Misc
  'Cables': Cable,
  'Adapters': Cable,
  'Tools': Wrench,
  'Merchandise': Gift,
  'Spare Parts': Puzzle,
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  'Components': Component,
  'PC': Cpu,
  'Laptops': Laptop,
  'Gadgets': Smartphone,
  'Peripherals': Keyboard,
  'Network': Router,
  'Software': Database,
  'Bundle': Gift,
  'Misc': Package,
  'Unknown': Package,
};

function getIconForItem(item: { category?: string; subCategory?: string }): LucideIcon {
  const sub = item.subCategory?.trim();
  const cat = item.category?.trim();
  if (sub && SUBCATEGORY_ICON[sub]) return SUBCATEGORY_ICON[sub];
  if (cat && SUBCATEGORY_ICON[cat]) return SUBCATEGORY_ICON[cat];
  if (cat && CATEGORY_ICON[cat]) return CATEGORY_ICON[cat];
  return Package;
}

/** Returns a placeholder image URL for the item (subcategory/category) or null if none. */
export function getCategoryImageUrl(item: { category?: string; subCategory?: string }): string | null {
  const sub = item.subCategory?.trim();
  const cat = item.category?.trim();
  if (sub && CATEGORY_IMAGES[sub]) return CATEGORY_IMAGES[sub];
  if (cat && CATEGORY_IMAGES[cat]) return CATEGORY_IMAGES[cat];
  return null;
}

interface ItemThumbnailProps {
  item: InventoryItem;
  className?: string;
  size?: number;
  /** If true, use category image URL when no item.imageUrl (SVG placeholders). If false, use icon only when no image. */
  useCategoryImage?: boolean;
}

/**
 * Renders item thumbnail: item.imageUrl if set, else category/subcategory image (if useCategoryImage)
 * or a minimalistic Lucide icon so we never show 2-letter avatars.
 */
const ItemThumbnail: React.FC<ItemThumbnailProps> = ({
  item,
  className = 'w-12 h-12 rounded-xl object-cover shadow-sm border border-slate-100',
  size = 48,
  useCategoryImage = false,
}) => {
  const [imageError, setImageError] = useState(false);
  const imgSrc = !imageError
    ? item.imageUrl || (useCategoryImage ? getCategoryImageUrl(item) : null) || undefined
    : undefined;
  const Icon = getIconForItem(item);

  if (imgSrc) {
    return (
      <img
        src={imgSrc}
        alt=""
        className={className}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <div
      className={`rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 ${className}`}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
};

/** Icon-only block for when you only have category/subcategory (e.g. draft items). */
export function CategoryIconBox({
  category,
  subCategory,
  className = 'w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0',
  size = 20,
}: {
  category?: string;
  subCategory?: string;
  className?: string;
  size?: number;
}) {
  const Icon = getIconForItem({ category, subCategory });
  return (
    <div className={className}>
      <Icon size={size} strokeWidth={2} />
    </div>
  );
}

export default ItemThumbnail;
export { getIconForItem, SUBCATEGORY_ICON, CATEGORY_ICON };
